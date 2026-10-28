// Popis već izrađenih XRechnunga projekta (s diska) i njihovo "brisanje": datoteke se premještaju u podmapu _obrisano
// (nikad se ne brišu trajno), a račun se uklanja iz niza u kumulativ.json ako je zadnji u njemu.
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { Greska } from "./pretvori.js";
import { nadjiMapuProjekta, nadjiMapeRacuna } from "./mapa.js";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, parseTagValue: false, trimValues: true });
const tekst = (v) => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));
const izbjegni = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OBRISANO = "_obrisano";

// Isto kao u obradi.js: dio naziva datoteke za broj računa.
export const oznakaRacuna = (broj) => broj.replace(/[\\/:*?"<>|\s]+/g, "-");

// Sve mape "XRechnung" ispod mapa računa projekta (do 4 razine), osim _obrisano.
function mapeXRechnung(mapeRacuna) {
  const rezultat = [];
  for (const mapaRacuna of mapeRacuna) {
    const obidi = (dir, dubina) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name === OBRISANO) continue;
        const p = path.join(dir, e.name);
        if (/^xrechnung$/i.test(e.name)) rezultat.push({ mapa: p, mapaRacuna }); else if (dubina < 4) obidi(p, dubina + 1);
      }
    };
    obidi(mapaRacuna, 0);
  }
  return rezultat;
}

function citajXRechnung(putanja) {
  try {
    const inv = parser.parse(fs.readFileSync(putanja, "utf8").replace(/^﻿/, "")).Invoice;
    if (!inv) return null;
    const prilozi = [].concat(inv.AdditionalDocumentReference || []).map((r) => r.Attachment?.EmbeddedDocumentBinaryObject?.["@_filename"]).filter(Boolean);
    return {
      broj: tekst(inv.ID), datum: tekst(inv.IssueDate),
      kupac: tekst(inv.AccountingCustomerParty?.Party?.PartyName?.Name), eAdresa: tekst(inv.AccountingCustomerParty?.Party?.EndpointID),
      zaPlatiti: Number(tekst(inv.LegalMonetaryTotal?.PayableAmount)) || 0, prilozi,
    };
  } catch { return null; }
}

// Datoteke koje pripadaju jednom XRechnungu: ona s njegovim brojem u nazivu (XRechnung_*, Zahlungsspezifikation_*, Pruefbericht_*)
// i prilozi navedeni u samom XML-u. Broj mora stajati uz granicu (npr. "13-1-8" ne smije pogoditi "113-1-8").
function datotekeRacuna(mapa, oznaka, prilozi) {
  const re = new RegExp(`(?:^|_)${izbjegni(oznaka)}(?:_|\\.|$)`);
  return fs.readdirSync(mapa, { withFileTypes: true })
    .filter((e) => e.isFile() && ((/^(XRechnung_|Zahlungsspezifikation_|Pruefbericht_)/.test(e.name) && re.test(e.name)) || prilozi.includes(e.name)))
    .map((e) => e.name);
}

export async function popisXRechnunga(z, okolina) {
  const mapaProjekta = nadjiMapuProjekta(okolina.korijen, z.sifra, z.mapa);
  const mape = nadjiMapeRacuna(mapaProjekta, okolina.postavke.mapeRacuna || ["Fakture"]);
  const xrechnungi = [];
  for (const { mapa } of mapeXRechnung(mape)) {
    for (const e of fs.readdirSync(mapa, { withFileTypes: true })) {
      if (!e.isFile() || !/^XRechnung_.*\.xml$/i.test(e.name)) continue;
      const p = path.join(mapa, e.name);
      const podaci = citajXRechnung(p);
      if (!podaci) continue;
      xrechnungi.push({
        broj: podaci.broj, datum: podaci.datum, kupac: podaci.kupac, eAdresa: podaci.eAdresa, zaPlatiti: podaci.zaPlatiti,
        valjan: !/_NEVALJAN\.xml$/i.test(e.name), mapa, promijenjeno: fs.statSync(p).mtime.toISOString(),
        datoteke: datotekeRacuna(mapa, oznakaRacuna(podaci.broj), podaci.prilozi),
      });
    }
  }
  xrechnungi.sort((a, b) => `${b.datum}${b.promijenjeno}`.localeCompare(`${a.datum}${a.promijenjeno}`));
  return { status: "Gotovo", xrechnungi, poruke: [xrechnungi.length ? `Pronađeno XRechnunga: ${xrechnungi.length}` : "Za ovaj projekt još nema izrađenih XRechnunga."] };
}

export async function obrisiXRechnung(z, okolina) {
  if (!z.racunBroj) throw new Greska("Nije zadan broj računa.");
  const popis = (await popisXRechnunga(z, okolina)).xrechnungi.filter((x) => x.broj === z.racunBroj);
  if (!popis.length) throw new Greska(`XRechnung za račun ${z.racunBroj} nije pronađen u mapi projekta.`);
  const poruke = [];
  const oznaka = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const mapaProjekta = nadjiMapuProjekta(okolina.korijen, z.sifra, z.mapa);
  const mape = nadjiMapeRacuna(mapaProjekta, okolina.postavke.mapeRacuna || ["Fakture"]);

  for (const x of popis) {
    if (okolina.probno) { poruke.push(`PROBNO — ništa nije premješteno: ${x.datoteke.join(", ")} (${x.mapa})`); continue; }
    const cilj = path.join(x.mapa, OBRISANO, `${oznakaRacuna(x.broj)}_${oznaka}`);
    fs.mkdirSync(cilj, { recursive: true });
    for (const naziv of x.datoteke) fs.renameSync(path.join(x.mapa, naziv), path.join(cilj, naziv));
    poruke.push(`Premješteno ${x.datoteke.length} datoteka u ${path.relative(mapaProjekta, cilj)} (mogu se vratiti ručno).`);
  }

  // Račun se uklanja iz niza kumulativa samo ako je zadnji u njemu — inače bi se pokvario izračun kasnijih računa.
  for (const mapa of mape) {
    const datoteka = path.join(mapa, "kumulativ.json");
    if (!fs.existsSync(datoteka)) continue;
    let cfg; try { cfg = JSON.parse(fs.readFileSync(datoteka, "utf8")); } catch { continue; }
    const i = (cfg.racuni || []).findIndex((r) => r.broj === z.racunBroj && r.vrsta !== "aconto");
    if (i === -1) continue;
    if (i !== cfg.racuni.length - 1) { poruke.push(`Račun ${z.racunBroj} nije zadnji u nizu kumulativa pa je u kumulativ.json ostao.`); break; }
    if (okolina.probno) { poruke.push(`PROBNO — račun ${z.racunBroj} bi bio uklonjen iz kumulativ.json.`); break; }
    fs.copyFileSync(datoteka, `${datoteka}.bak-${oznaka}`);
    cfg.racuni.splice(i, 1);
    fs.writeFileSync(datoteka, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    poruke.push(`Račun ${z.racunBroj} je uklonjen iz niza u kumulativ.json (sigurnosna kopija je sačuvana).`);
    break;
  }
  return { status: "Gotovo", poruke };
}

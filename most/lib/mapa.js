// Pronalazak mape projekta na Z: i najnovijeg Konplastovog XML računa u njezinoj mapi Fakture.
import fs from "node:fs";
import path from "node:path";
import { Greska, procitajKonplast } from "./pretvori.js";

const izbjegni = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Korijeni projektnih mapa iz postavke KORIJEN_PROJEKTI: jedna ili više putanja odvojenih s ";". Oznaka {godina} u putanji
// zamjenjuje se tekućom godinom i dvjema prethodnima (Z:/ECON_{godina}/ECON_{godina}/Econ_{godina}_Projekti → 2027, 2026, 2025),
// pa projekt iz 2026. nastavlja raditi i nakon 1.1.2027., a novi 2027. projekti rade čim mapa ECON_2027 postoji (ne mora postojati
// unaprijed). Prazna postavka = ta zadana putanja. Redoslijed je prednost: prvi korijen u kojem postoji mapa projekta pobjeđuje.
export const ZADANI_KORIJEN_PROJEKTA = "Z:/ECON_{godina}/ECON_{godina}/Econ_{godina}_Projekti";
export function korijeniProjekata(postavka, sada = new Date()) {
  const popis = String(postavka || ZADANI_KORIJEN_PROJEKTA).split(";").map((s) => s.trim()).filter(Boolean);
  const g = sada.getFullYear();
  const rezultat = [];
  for (const p of popis) {
    if (p.includes("{godina}")) for (const god of [g, g - 1, g - 2]) rezultat.push(p.split("{godina}").join(String(god)));
    else rezultat.push(p);
  }
  return [...new Set(rezultat)];
}

// Usluge radione (RN 40-04-NN) nemaju vlastitu mapu u korijenu: svaki posao je podmapa "NN-Kupac-opis" zbirne mape "RN 40-04_Usluge radione".
export const SIFRA_USLUGE = /^rn\s*40-04-0*(\d+)\s*$/i;
export const ZBIRNA_USLUGE = /^rn 40-04(?:[_ ]|$)/i;
export const NAZIV_ZBIRNE_USLUGE = "RN 40-04_Usluge radione";

// Mapa projekta: ručno upisana putanja iz ERP-a ("Mapa projekta") ako postoji, inače mapa u korijenu čije ime počinje šifrom
// projekta (npr. "RN 170-208_B&O F-O2_Quartier ..."), a za usluge radione (RN 40-04-NN) podmapa "NN-…" zbirne mape usluga.
// korijen = jedna putanja ili popis putanja (vidi korijeniProjekata): korijeni koji (još) ne postoje preskaču se, a greška se javlja
// tek kad nijedan nije dostupan ili u njima nema mape projekta. Ako upisana mapa više ne postoji (npr. mapa je preimenovana), traži se
// po šifri; tek kad ni to ne uspije, javlja se da upisana mapa ne postoji. Greška "nema mape" nosi kod "nema" (vidi lib/dokumenti.js).
export function nadjiMapuProjekta(korijen, sifra, zadanaMapa) {
  if (zadanaMapa) {
    const p = path.normalize(zadanaMapa);
    if (fs.existsSync(p)) return p;
    try { return trazi(korijen, sifra); } catch { throw new Greska(`Mapa projekta iz ERP-a ne postoji ili nije dostupna na ovom računalu: ${p}`); }
  }
  return trazi(korijen, sifra);
}
function trazi(korijen, sifra) {
  const korijeni = Array.isArray(korijen) ? korijen : [korijen];
  const dostupni = korijeni.filter((k) => fs.existsSync(k));
  if (!dostupni.length) throw new Greska(`Korijenska mapa projekata nije dostupna: ${korijeni.join(" ; ")} (je li Z: spojen?)`);
  const re = new RegExp(`^${izbjegni(sifra)}(?:[_ ]|$)`, "i");
  const usluga = String(sifra).trim().match(SIFRA_USLUGE);
  for (const k of dostupni) {
    const mape = fs.readdirSync(k, { withFileTypes: true }).filter((d) => d.isDirectory());
    const pogodci = mape.filter((d) => re.test(d.name));
    if (pogodci.length > 1) throw new Greska(`Za šifru "${sifra}" postoji više mapa (${pogodci.map((d) => d.name).join("; ")}). U ERP-u upiši "Mapa projekta" na projektu.`);
    if (pogodci.length === 1) return path.join(k, pogodci[0].name);
    if (usluga) {
      for (const z of mape.filter((d) => ZBIRNA_USLUGE.test(d.name))) {
        const poslovi = fs.readdirSync(path.join(k, z.name), { withFileTypes: true }).filter((d) => d.isDirectory() && Number((d.name.match(/^0*(\d+)\s*[-_ ]/) || [])[1]) === Number(usluga[1]));
        if (poslovi.length > 1) throw new Greska(`Za šifru "${sifra}" u mapi ${z.name} postoji više podmapa (${poslovi.map((d) => d.name).join("; ")}). U ERP-u upiši "Mapa projekta" na projektu.`);
        if (poslovi.length === 1) return path.join(k, z.name, poslovi[0].name);
      }
    }
  }
  throw Object.assign(new Greska(`U ${dostupni.join(" ; ")} nema mape čije ime počinje s "${sifra}".`), { kod: "nema" });
}

// Mape izlaznih računa u mapi projekta: svaka čije ime je jedno od zadanih (postavke.json → mapeRacuna, npr. Fakture, Rechnungen,
// Rechnung) ili počinje njime uz razmak/_/- (npr. "Fakture 2026"); redni broj ispred naziva se ne gleda ("07 Fakture" u strukturi
// novih projekata, vidi lib/dokumenti.js). Mape poput "Računi plaćeni preko B&O" nisu na popisu pa se ne gledaju.
export function nadjiMapeRacuna(mapaProjekta, imena) {
  const osnove = imena.map((i) => i.toLowerCase());
  const mape = fs.readdirSync(mapaProjekta, { withFileTypes: true })
    .filter((e) => e.isDirectory() && osnove.some((o) => { const n = e.name.toLowerCase().replace(/^\d{1,2}[ ._-]+/, ""); return n === o || (n.startsWith(o) && /[\s_-]/.test(n[o.length])); }))
    .map((e) => path.join(mapaProjekta, e.name));
  if (!mape.length) throw new Greska(`U mapi projekta nema mape računa (traži se: ${imena.join(", ")}): ${mapaProjekta}`);
  return mape;
}

// Svi XML računi ispod zadanih mapa (do 4 razine), osim izlaznih mapa "XRechnung*". Najnoviji je onaj s najkasnijim datumom računa.
// Svaki zapis pamti i mapu računa (mapaRacuna) u kojoj je pronađen — uz nju stoji kumulativ.json.
export function nadjiRacune(mapeRacuna) {
  const rezultat = [];
  for (const mapaRacuna of mapeRacuna) {
    const obidi = (dir, dubina) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (dubina < 4 && !/^xrechnung/i.test(e.name)) obidi(p, dubina + 1); continue; }
        if (!/\.xml$/i.test(e.name)) continue;
        try {
          const r = procitajKonplast(fs.readFileSync(p, "utf8"));
          if (r.broj && r.datum && r.linije.length) rezultat.push({ putanja: p, mapaRacuna, broj: r.broj, datum: r.datum, vrijeme: r.vrijeme, mtime: fs.statSync(p).mtimeMs });
        } catch { /* nije račun — preskoči */ }
      }
    };
    obidi(mapaRacuna, 0);
  }
  return rezultat.sort((a, b) => `${b.datum}${b.vrijeme}`.localeCompare(`${a.datum}${a.vrijeme}`) || b.mtime - a.mtime);
}

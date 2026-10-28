// Obrada jednog zadatka iz ERP-a: mapa projekta → najnoviji XML računa → XRechnung (+ tablica kumulativa) → službena provjera → datoteke.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Greska, procitajKonplast, izradi } from "./pretvori.js";
import { nadjiMapuProjekta, nadjiMapeRacuna, nadjiRacune } from "./mapa.js";
import { validirajXml } from "./validator.js";
import { napraviPrikazPdf } from "./prikaz.js";

// Postavke kumulativa (ugovor, avans, prijašnji računi) žive uz račune u kumulativ.json: prvo u mapi računa u kojoj je pronađen
// račun, a ako je tamo nema, u drugoj mapi računa istog projekta. Ako datoteke nema, račun se pretvara kao običan (bez
// kumulativa). U probnom načinu postoji rezervni primjer iz mape primjeri.
function ucitajKumulativ(mapeRacuna, sifra, okolina) {
  for (const mapa of mapeRacuna) {
    const datoteka = path.join(mapa, "kumulativ.json");
    if (fs.existsSync(datoteka)) return { cfg: JSON.parse(fs.readFileSync(datoteka, "utf8")), datoteka };
  }
  const primjer = path.join(okolina.primjeri, `kumulativ-${sifra.replace(/\s+/g, "-")}.json`);
  if (okolina.probno && fs.existsSync(primjer)) return { cfg: JSON.parse(fs.readFileSync(primjer, "utf8")), datoteka: null };
  return null;
}

// Računi nakon kojih je ovaj već unesen u niz ne smiju mijenjati povijest: dopušten je samo zadnji račun u nizu.
function nizDoRacuna(cfg, broj) {
  const i = cfg.racuni.findIndex((r) => r.broj === broj);
  if (i === -1) return cfg;
  if (i !== cfg.racuni.length - 1) throw new Greska(`Račun ${broj} nije zadnji u nizu u kumulativ.json — nakon njega već postoje noviji računi.`);
  return { ...cfg, racuni: cfg.racuni.slice(0, i) };
}

export async function obradi(zadatak, okolina) {
  const poruke = [];
  const mapaProjekta = nadjiMapuProjekta(okolina.korijen, zadatak.sifra, zadatak.mapa);
  const mapeRacuna = nadjiMapeRacuna(mapaProjekta, okolina.postavke.mapeRacuna || ["Fakture"]);
  const racuni = nadjiRacune(mapeRacuna);
  if (!racuni.length) throw new Greska(`U mapama računa nema XML računa (Konplast izvoz): ${mapeRacuna.map((m) => path.basename(m)).join(", ")}`);
  const odabran = zadatak.racunBroj ? racuni.find((r) => r.broj === zadatak.racunBroj) : racuni[0];
  if (!odabran) throw new Greska(`Račun ${zadatak.racunBroj} nije pronađen u mapama računa (${mapeRacuna.map((m) => path.basename(m)).join(", ")}).`);
  poruke.push(`Račun: ${odabran.broj} od ${odabran.datum} (${path.relative(mapaProjekta, odabran.putanja)})`);

  const racun = procitajKonplast(fs.readFileSync(odabran.putanja, "utf8"));
  const kum = ucitajKumulativ([odabran.mapaRacuna, ...mapeRacuna.filter((m) => m !== odabran.mapaRacuna)], zadatak.sifra, okolina);
  const cfg = kum ? nizDoRacuna(kum.cfg, racun.broj) : null;
  poruke.push(cfg ? "Način: Abschlag s kumulativom (kumulativ.json)" : "Način: običan račun (nema kumulativ.json)");
  // Zaštita: Abschlagsrechnung (stavka "... nach Abrechnungsblatt") bez kumulativ.json ne smije se spremiti kao običan račun — iznos za
  // platiti u XML-u (Konplast) nije onaj koji kupac plaća (odbitak avansa). U probnom načinu to je samo upozorenje.
  if (!cfg && racun.linije.some((l) => /abrechnungsblatt/i.test(l.naziv))) {
    const upozorenje = `Račun ${racun.broj} izgleda kao Abschlagsrechnung (stavka "nach Abrechnungsblatt"), a uz račune nema kumulativ.json — iznos za platiti u XRechnungu ne bi odgovarao PDF-u kupcu (odbitak avansa). Dodaj kumulativ.json (ugovor, avans, prijašnji računi).`;
    if (!okolina.probno) throw new Greska(upozorenje);
    poruke.push(`UPOZORENJE: ${upozorenje}`);
  }

  const ishod = await izradi(racun, { prodavatelj: okolina.postavke.prodavatelj, eAdresa: zadatak.eAdresa, referenca: zadatak.referenca, sifra: zadatak.sifra, kumulativ: cfg });
  poruke.push(...ishod.poruke);

  // Provjera se radi u privremenoj mapi; u mapu računa ide samo gotov rezultat.
  const oznaka = racun.broj.replace(/[\\/:*?"<>|\s]+/g, "-"); // bez razmaka i zabranjenih znakova (validator ne podnosi razmak u nazivu datoteke)
  const privremena = fs.mkdtempSync(path.join(os.tmpdir(), "econ-most-"));
  try {
    const xmlPrivremeni = path.join(privremena, `XRechnung_${oznaka}.xml`);
    fs.writeFileSync(xmlPrivremeni, ishod.xml, "utf8");
    const val = await validirajXml({ java: okolina.java, jar: okolina.jar, konfig: okolina.konfig, xmlPutanja: xmlPrivremeni, izlaz: path.join(privremena, "izvjestaj") });
    if (val.pogreska) poruke.push(`Službena provjera nije provedena: ${val.pogreska}`);

    const izlaznaMapa = okolina.probno
      ? path.join(okolina.probnoIzlaz, zadatak.sifra.replace(/\s+/g, "-"), path.basename(path.dirname(odabran.putanja)))
      : path.join(path.dirname(odabran.putanja), "XRechnung");
    fs.mkdirSync(izlaznaMapa, { recursive: true });

    const valjan = val.ocjena === "Valjano";
    const datoteke = [];
    const zapisi = (naziv, sadrzaj) => { const p = path.join(izlaznaMapa, naziv); fs.writeFileSync(p, sadrzaj); datoteke.push({ naziv, putanja: p }); };
    zapisi(`XRechnung_${oznaka}${valjan ? "" : "_NEVALJAN"}.xml`, ishod.xml);
    // Čitljiv PDF prikaz samog XRechnunga (za provjeru prije slanja); neuspjeh prikaza ne ruši izradu računa.
    try { zapisi(`XRechnung_${oznaka}${valjan ? "" : "_NEVALJAN"}_Ansicht.pdf`, await napraviPrikazPdf(ishod.xml)); } catch (e) { poruke.push(`PDF prikaz nije napravljen: ${e.message}`); }
    if (ishod.pdfBytes) zapisi(ishod.pdfNaziv, ishod.pdfBytes);
    if (val.izvjestajHtml) zapisi(`Pruefbericht_${oznaka}.html`, fs.readFileSync(val.izvjestajHtml));

    // Račun ulazi u niz kumulativa tek kad je XRechnung valjan, i samo u pravom (ne probnom) načinu rada.
    if (valjan && kum?.datoteka && ishod.kumulativRacun && !okolina.probno) {
      const izvorni = kum.cfg;
      const i = izvorni.racuni.findIndex((r) => r.broj === racun.broj);
      const unos = { oznaka: i >= 0 ? izvorni.racuni[i].oznaka : `R${izvorni.racuni.length + 1}`, vrsta: "racun", ...ishod.kumulativRacun };
      if (i >= 0) izvorni.racuni[i] = unos; else izvorni.racuni.push(unos);
      fs.writeFileSync(kum.datoteka, JSON.stringify(izvorni, null, 2), "utf8");
      poruke.push(`Račun ${racun.broj} je upisan u kumulativ.json (${unos.oznaka}).`);
    }

    return {
      status: valjan ? "Valjano" : val.ocjena === "Nevaljano" ? "Nevaljano" : "Greška",
      poruke, sazetak: ishod.sazetak, kontrole: ishod.kontrole,
      validacija: { ocjena: val.ocjena, greske: val.greske, upozorenja: val.upozorenja },
      datoteke, izlaznaMapa, probno: !!okolina.probno,
    };
  } finally {
    fs.rmSync(privremena, { recursive: true, force: true });
  }
}

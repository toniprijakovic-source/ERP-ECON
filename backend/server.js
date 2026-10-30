// ČELIK-MONT / Econ ERP — backend
// Arhitektura: frontend (erp.jsx) zadržava SVU poslovnu logiku (kalkulacije,
// PDF ispis, raspored proizvodnje) — mijenjaju se samo dva mjesta:
//   1. početno učitavanje baze (umjesto window.storage.get za svaki ključ)
//   2. update() funkcija (umjesto window.storage.set)
// Vidi PRIJELAZ-NA-PRAVU-APLIKACIJU.md za točan dijff tih dviju funkcija.

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.disable("x-powered-by");
// Render (Cloudflare + balanser) stoji ispred poslužitelja; req.ip je tako adresa koju vidi prvi posrednik, a ne adresa balansera.
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use((req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); next(); });

// Express 4 ne hvata greške iz async ruta: odbijeno obećanje (npr. bcrypt.compare bez lozinke) ostaje neuhvaćeno i u Nodeu 15+
// RUŠI CIJELI PROCES — jedan neispravan zahtjev bez prijave bi spustio ERP i kiosk. Zato se svaka funkcija predana
// app.get/post/put/patch/delete omota tako da greška ide u zajednički error handler na kraju (JSON 500) umjesto rušenja.
["get", "post", "put", "patch", "delete"].forEach((metoda) => {
  const izvorna = app[metoda].bind(app);
  app[metoda] = (...args) => {
    if (metoda === "get" && args.length === 1) return izvorna(...args); // app.get("postavka")
    return izvorna(...args.map((a) => (typeof a !== "function" ? a : (req, res, next) => {
      try {
        const r = a(req, res, next);
        if (r && typeof r.catch === "function") r.catch(next);
      } catch (e) { next(e); }
    })));
  };
});

// Adresa klijenta za ograničenja pokušaja. Na Renderu svaki zahtjev prolazi kroz Cloudflare, koji CF-Connecting-IP uvijek
// sam postavi (klijentova vrijednost se prepisuje); inače (lokalno) vrijedi req.ip. Prvi unos X-Forwarded-For se NE koristi
// jer ga klijent može lažirati.
const klijentIp = (req) => String(req.headers["cf-connecting-ip"] || req.ip || req.socket.remoteAddress || "nepoznat").trim();
// Brojač NEUSPJELIH pokušaja po adresi u kliznom prozoru (u memoriji; restart ga briše, ali restart se više ne može izazvati zahtjevom).
const brojacNeuspjelih = (maxPokusaja, prozorMs) => {
  const mapa = new Map();
  setInterval(() => { const sada = Date.now(); mapa.forEach((t, k) => { const ostaju = t.filter((x) => sada - x < prozorMs); if (ostaju.length) mapa.set(k, ostaju); else mapa.delete(k); }); }, prozorMs).unref();
  const nedavni = (k) => (mapa.get(k) || []).filter((x) => Date.now() - x < prozorMs);
  return {
    blokiran: (k) => nedavni(k).length >= maxPokusaja,
    zabiljezi: (k) => { if (mapa.size > 20000) mapa.clear(); mapa.set(k, [...nedavni(k), Date.now()]); },
  };
};
const neuspjeliLogin = brojacNeuspjelih(30, 10 * 60 * 1000); // ukupno po adresi, preko svih računa (uz postojećih 5 po računu)
const neuspjeliKiosk = brojacNeuspjelih(30, 10 * 60 * 1000); // neprepoznate kartice po adresi

// ---------- Evidencija aktivnosti u aplikaciji (vidi tablicu aktivnost_dan; pregled samo za glavnog administratora) ----------
// Izmjene: svaki uspješan upis (PUT/POST/DELETE) prijavljenog korisnika broji se po danu i po ključu podataka. Ne bilježe se
// prijava, kiosk, obavijesti i sama evidencija aktivnosti. Radi se nakon odgovora, pa ne usporava rad i ne smije srušiti zahtjev.
const danZagreb = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zagreb" });
app.use((req, res, next) => {
  if (!["PUT", "POST", "DELETE", "PATCH"].includes(req.method) || !req.path.startsWith("/api/")) return next();
  res.on("finish", () => {
    try {
      if (res.statusCode >= 400 || !req.zaposlenikId) return;
      const dijelovi = req.path.split("/").filter(Boolean);
      const kljuc = dijelovi[1] === "data" ? dijelovi[2] : dijelovi[1];
      if (!kljuc || ["aktivnost", "auth", "kiosk", "obavijesti"].includes(kljuc)) return;
      pool.query(
        `INSERT INTO aktivnost_dan (zaposlenik_id, dan, izmjene, izmjene_kljucevi, zadnja) VALUES ($1, $2, 1, jsonb_build_object($3::text, 1), now())
         ON CONFLICT (zaposlenik_id, dan) DO UPDATE SET izmjene = aktivnost_dan.izmjene + 1,
           izmjene_kljucevi = jsonb_set(aktivnost_dan.izmjene_kljucevi, ARRAY[$3::text], to_jsonb(COALESCE((aktivnost_dan.izmjene_kljucevi->>$3::text)::int, 0) + 1))`,
        [req.zaposlenikId, danZagreb(), String(kljuc).slice(0, 40)]
      ).catch(() => {});
    } catch { /* bilježenje nikad ne smije utjecati na zahtjev */ }
  });
  next();
});

// Veza prema bazi se drži otvorenom (idle 10 min + redovit SELECT 1): kiosk skenira rijetko, a nova
// veza prema Supabase poolera košta ~0,3-0,8 s koje bi osoba čekala ispred čitača.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined, idleTimeoutMillis: 10 * 60 * 1000, keepAlive: true });
setInterval(() => { pool.query("SELECT 1").catch(() => {}); }, 30 * 1000);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error("JWT_SECRET nije postavljen u .env — vidi .env.example"); process.exit(1); }

const DOZVOLJENI_KLJUCEVI = [
  "kupci", "dobavljaci", "materijali", "projekti", "narudzbenice", "ponude",
  "radniNalozi", "fakture", "cjenikRada", "katalogProfila", "pozicijeZaposlenika",
  "zaposlenici", "standardniZadaci", "programiRezanja", "kapacitetiDana",
  "postavkeTvrtke", "upitiNabave", "radniCentri", "evidencijaRada",
  "narudzbe", "otpremnice", "podlogeZaFakturu", "normativi",
  "postavkePlaca", "praznici", "kvaliteteMaterijala", "ponudeLasera", "doplaciPlaca",
  "satiPoNalogu", "izdatnice", "cmr", "slobodniZadaci", "planProizvodnje", "nedovrsenaProizvodnja", "rezervacije", "maticnaKnjiga", "upitiTransporta", "narudzbeTransporta", "godisnjiOdmor", "xrechnungPostavke",
];

// Svaki modul (isti "moduli" popis kao u pozicijeZaposlenika) dijeli se na kartice — iste
// kartice/tabove koje App.jsx prikazuje unutar tog modula. Za svaku karticu je popisano koje
// ključeve ta kartica čita i koje smije mijenjati. Pozicija po zadanom ima puni pristup (čitanje
// i izmjene) svakoj kartici modula koji joj je dodijeljen — vidi dozvolaZaKarticu() — a admin to
// može suziti po poziciji preko pozicija.karticeDozvole (postavljeno kroz "Pozicije" ekran).
const KARTICE_MODULA = {
  dashboard: {
    pregled: { citanje: ["cjenikRada", "fakture", "materijali", "ponude", "projekti", "radniNalozi", "slobodniZadaci"], pisanje: [] },
  },
  skladiste: {
    zalihe: { citanje: ["materijali", "katalogProfila", "kvaliteteMaterijala", "projekti", "izdatnice", "zaposlenici", "rezervacije", "narudzbenice", "dobavljaci", "postavkeTvrtke", "maticnaKnjiga"], pisanje: ["materijali", "izdatnice", "rezervacije"] },
    katalog: { citanje: ["katalogProfila"], pisanje: ["katalogProfila"] },
    kvaliteta: { citanje: ["kvaliteteMaterijala"], pisanje: ["kvaliteteMaterijala"] },
    izdatnice: { citanje: ["izdatnice", "materijali", "projekti", "zaposlenici", "rezervacije", "maticnaKnjiga"], pisanje: ["izdatnice", "materijali", "rezervacije"] },
  },
  nabava: {
    narudzbenice: { citanje: ["narudzbenice", "dobavljaci", "katalogProfila", "materijali", "projekti", "kvaliteteMaterijala", "rezervacije", "postavkeTvrtke", "maticnaKnjiga"], pisanje: ["narudzbenice", "materijali", "rezervacije", "maticnaKnjiga"] },
    upiti: { citanje: ["upitiNabave", "dobavljaci", "materijali", "kvaliteteMaterijala", "katalogProfila"], pisanje: ["upitiNabave", "narudzbenice", "materijali"] },
    postavke: { citanje: ["postavkeTvrtke"], pisanje: ["postavkeTvrtke"] },
  },
  proizvodnja: {
    tablica: { citanje: ["radniNalozi", "projekti", "materijali", "katalogProfila", "narudzbenice", "satiPoNalogu", "izdatnice", "zaposlenici", "rezervacije", "maticnaKnjiga"], pisanje: ["radniNalozi", "materijali", "izdatnice", "rezervacije"] },
    // Plan proizvodnje (nekad "Gantogram"): uz naloge čita i postavke plana, praznike i sate po nalozima;
    // piše sate po nalozima (dnevni unos voditelja proizvodnje), projekte (hitno / na čekanju,
    // završna obrada, faze, "spremno za otpremu" kupaonica) i postavke plana. Normativ i odsutnosti
    // ne čita izravno nego preko /api/plan/podaci (bez cijena i bez vrste odsutnosti).
    gantogram: { citanje: ["radniNalozi", "radniCentri", "kapacitetiDana", "projekti", "zaposlenici", "planProizvodnje", "praznici", "satiPoNalogu"], pisanje: ["radniNalozi", "radniCentri", "kapacitetiDana", "planProizvodnje", "satiPoNalogu", "projekti"] },
    rezanje: { citanje: ["programiRezanja", "katalogProfila", "materijali", "radniNalozi", "zaposlenici", "evidencijaRada"], pisanje: ["programiRezanja", "kapacitetiDana", "materijali"] },
    isporuke: { citanje: ["projekti"], pisanje: ["projekti"] },
  },
  // Projekti i Ponude su od 2026-10 zasebni moduli (prije jedan "Projekti i ponude"), kao i
  // Otpremnice i CMR naspram Financija (prije jedan "Otpremnice i fakturiranje").
  projekti: {
    projekti: { citanje: ["cjenikRada", "katalogProfila", "kupci", "materijali", "projekti", "radniNalozi", "standardniZadaci", "narudzbe", "otpremnice", "normativi", "zaposlenici", "upitiNabave", "kvaliteteMaterijala", "narudzbenice", "dobavljaci", "narudzbeTransporta"], pisanje: ["projekti", "standardniZadaci", "narudzbe", "otpremnice", "normativi", "materijali", "radniNalozi", "upitiNabave"] },
    zavrseni: { citanje: ["projekti", "radniNalozi", "kupci", "narudzbe"], pisanje: [] },
    // Popis potvrda narudžbe (Auftragsbestätigung) — potvrda se sprema na narudžbu kupca.
    potvrde: { citanje: ["narudzbe", "projekti", "kupci", "zaposlenici", "postavkeTvrtke"], pisanje: ["narudzbe"] },
  },
  ponude: {
    ponude: { citanje: ["cjenikRada", "katalogProfila", "materijali", "ponude", "kupci", "kvaliteteMaterijala", "narudzbenice"], pisanje: ["ponude", "cjenikRada", "materijali", "projekti", "radniNalozi"] },
    laser: { citanje: ["ponudeLasera", "kupci", "kvaliteteMaterijala", "postavkeTvrtke"], pisanje: ["ponudeLasera"] },
  },
  otpremnice: {
    otpremnice: { citanje: ["otpremnice", "projekti", "kupci", "narudzbe", "podlogeZaFakturu"], pisanje: ["otpremnice"] },
    cmr: { citanje: ["cmr", "otpremnice", "projekti", "kupci", "dobavljaci", "narudzbe", "postavkeTvrtke"], pisanje: ["cmr"] },
  },
  // Financije (ključ ostaje "fakturiranje" zbog postojećih pozicija).
  fakturiranje: {
    // Faktura se veže uz podlogu za fakturu (faktura.podlogaId) pa kartice Fakture i Podloge čitaju oba popisa.
    fakture: { citanje: ["fakture", "kupci", "projekti", "podlogeZaFakturu", "narudzbe", "otpremnice"], pisanje: ["fakture"] },
    podloge: { citanje: ["podlogeZaFakturu", "projekti", "materijali", "otpremnice", "narudzbe", "kupci", "fakture"], pisanje: ["podlogeZaFakturu", "otpremnice"] },
    // Fakturirano po mjesecima: samo pregled zbroja podloga za fakturu (po mjesecu, kupcu), naplaćenosti (status vezane fakture) i ispis podloge.
    fakturirano: { citanje: ["podlogeZaFakturu", "projekti", "otpremnice", "narudzbe", "kupci", "fakture"], pisanje: [] },
    // XRechnung: postavke po projektu (e-adresa kupca za račune, referenca kupca) u xrechnungPostavke. Zadaci za lokalni "most"
    // idu posebnim rutama /api/xrechnung/* (dozvola = čitanje/pisanje xrechnungPostavke), a most se prijavljuje tajnom MOST_TOKEN.
    xrechnung: { citanje: ["projekti", "kupci", "xrechnungPostavke"], pisanje: ["xrechnungPostavke"] },
    nedovrsena: { citanje: ["nedovrsenaProizvodnja", "projekti", "radniNalozi", "satiPoNalogu", "izdatnice", "materijali", "otpremnice", "narudzbe", "kupci", "dobavljaci", "narudzbeTransporta"], pisanje: ["nedovrsenaProizvodnja"] },
    analiza: { citanje: ["projekti", "radniNalozi", "ponude", "izdatnice", "materijali", "kupci", "cjenikRada", "katalogProfila", "kvaliteteMaterijala"], pisanje: [] },
    // Produktivnost (kg/h): po projektima masa ÷ sati upisani na naloge, po mjesecima isporučena masa ÷ sati
    // radione s kioska. Piše samo ručno upisanu masu projekta (projekt.masaKonstrukcijeKg).
    produktivnost: { citanje: ["projekti", "radniNalozi", "satiPoNalogu", "narudzbe", "otpremnice", "normativi", "katalogProfila", "kvaliteteMaterijala", "kupci", "evidencijaRada", "postavkePlaca"], pisanje: ["projekti"] },
    // Projekcija prihoda i troškova: narudžbe kupca, otpremnice, projekti (rokovi, dodaci, kupaonice), plan proizvodnje
    // (nalozi, praznici, kapaciteti, postavke, normativ, odsutnosti iz evidencije), narudžbenice i ponude (materijal),
    // transport. Piše samo postavke projekcije (trošak sata, % materijala, fiksni troškovi, ručni raspored) u nedovrsenaProizvodnja.
    projekcija: { citanje: ["nedovrsenaProizvodnja", "projekti", "narudzbe", "otpremnice", "kupci", "normativi", "radniNalozi", "satiPoNalogu", "planProizvodnje", "praznici", "kapacitetiDana", "evidencijaRada", "postavkePlaca", "narudzbenice", "materijali", "ponude", "cjenikRada", "katalogProfila", "kvaliteteMaterijala", "narudzbeTransporta", "postavkeTvrtke"], pisanje: ["nedovrsenaProizvodnja"] },
  },
  // Transporti (od 2026-10): upiti prijevoznicima, narudžbe za transport (+ CMR iz narudžbe).
  transporti: {
    upiti: { citanje: ["upitiTransporta", "narudzbeTransporta", "dobavljaci", "projekti", "kupci", "zaposlenici", "postavkeTvrtke"], pisanje: ["upitiTransporta", "narudzbeTransporta"] },
    narudzbe: { citanje: ["narudzbeTransporta", "upitiTransporta", "cmr", "otpremnice", "dobavljaci", "projekti", "kupci", "narudzbe", "zaposlenici", "postavkeTvrtke"], pisanje: ["narudzbeTransporta", "cmr"] },
  },
  // Kontrola kvalitete (od 2026-10): matična knjiga materijala i popis ugrađenog materijala po projektu.
  kontrola: {
    maticna: { citanje: ["maticnaKnjiga", "materijali", "dobavljaci", "narudzbenice", "projekti", "kvaliteteMaterijala", "izdatnice", "postavkeTvrtke"], pisanje: ["maticnaKnjiga"] },
    ugradeni: { citanje: ["maticnaKnjiga", "izdatnice", "projekti", "materijali", "kupci", "zaposlenici", "radniNalozi", "postavkeTvrtke"], pisanje: [] },
  },
  partneri: {
    kupci: { citanje: ["kupci"], pisanje: ["kupci"] },
    dobavljaci: { citanje: ["dobavljaci"], pisanje: ["dobavljaci"] },
  },
  // Evidencija sati (odvojeno od modula Zaposlenici od 24.10.2026.): evidencija rada i sati po nalozima.
  evidencijasati: {
    evidencija: { citanje: ["evidencijaRada", "postavkePlaca", "praznici"], pisanje: ["evidencijaRada"] },
    satinalozi: { citanje: ["evidencijaRada", "postavkePlaca", "radniNalozi", "zaposlenici", "satiPoNalogu"], pisanje: ["satiPoNalogu", "radniNalozi"] },
  },
  zaposlenici: {
    zaposlenici: { citanje: ["zaposlenici"], pisanje: ["zaposlenici"] },
    pozicije: { citanje: ["pozicijeZaposlenika"], pisanje: ["pozicijeZaposlenika"] },
    obracun: { citanje: ["evidencijaRada", "postavkePlaca", "praznici", "zaposlenici", "doplaciPlaca", "postavkeTvrtke"], pisanje: ["postavkePlaca", "praznici", "doplaciPlaca"] },
    // Godišnji odmor: pravo na dane (staž izvan Econa, složenost, preneseno, korekcija — upis u godisnjiOdmor) i iskorišteni
    // dani iz evidencije rada (godišnji i detašman - godišnji), uz praznike i pozicije za skupine radiona / režija.
    godisnji: { citanje: ["godisnjiOdmor", "evidencijaRada", "praznici", "zaposlenici", "pozicijeZaposlenika", "postavkeTvrtke"], pisanje: ["godisnjiOdmor"] },
  },
};

// Ključevi koje App.jsx čita na najvišoj razini (zaglavlje, navigacija, prijava) —
// potrebni SVAKOM prijavljenom zaposleniku bez obzira na modul, inače se aplikacija
// uopće ne može ispravno prikazati (ime tvrtke, vlastita pozicija/navigacija).
// Zadatke svih zaposlenika (slobodniZadaci) vide samo ove pozicije; ostali dobivaju samo zadatke
// koji su njima dodijeljeni ili koje su sami dodali.
const POZICIJE_SVI_ZADACI = ["poz-direktor", "poz-administrator"];
// Ove pozicije smiju zadavati zadatke drugima s nadzorne ploče i bez pristupa projektima (npr. voditelj proizvodnje).
const POZICIJE_ZADAVANJE_ZADATAKA = ["poz-voditelj-proizvodnje"];
const filtrirajSlobodneZadatke = (zadaci, pozicija, zaposlenikId) => (Array.isArray(zadaci) && !POZICIJE_SVI_ZADACI.includes(pozicija?.id)
  ? zadaci.filter((z) => z.dodijeljenoId === zaposlenikId || z.kreiraoId === zaposlenikId)
  : zadaci);

const UVIJEK_CITLJIVO = ["zaposlenici", "pozicijeZaposlenika", "postavkeTvrtke"];

// Ključevi čija je vrijednost objekt (ne niz) — koristi se za ispravan "prazan" placeholder.
const OBJEKT_KLJUCEVI = new Set(["cjenikRada", "postavkeTvrtke", "normativi", "postavkePlaca", "planProizvodnje", "nedovrsenaProizvodnja", "godisnjiOdmor", "xrechnungPostavke"]);

async function ucitajPozicijuZaposlenika(zaposlenikId) {
  const [zaposlenici, pozicije] = await Promise.all([ucitajKljuc("zaposlenici"), ucitajKljuc("pozicijeZaposlenika")]);
  const zaposlenik = (zaposlenici || []).find((z) => z.id === zaposlenikId);
  return (pozicije || []).find((p) => p.id === zaposlenik?.pozicijaId) || null;
}

// Dozvola za jednu karticu jednog modula — po zadanom TRUE (naslijeđeno od dodjele modula),
// osim ako je admin za tu točno tu poziciju/modul/karticu eksplicitno postavio false.
function dozvolaZaKarticu(pozicija, modulKey, karticaKey) {
  const eksplicitno = pozicija?.karticeDozvole?.[modulKey]?.[karticaKey];
  return { pristup: eksplicitno?.pristup !== false, izmjene: eksplicitno?.izmjene !== false };
}

// Za danu poziciju izračunava skup ključeva koje smije ČITATI i skup koje smije MIJENJATI,
// obilazeći module pozicije i unutar svakog module njegove kartice (uz gornju dozvolu).
function izracunajDozvoljeneKljuceve(pozicija) {
  const moduli = pozicija?.moduli?.length ? pozicija.moduli : ["dashboard"];
  const citljivo = new Set(UVIJEK_CITLJIVO);
  const pisivo = new Set();
  moduli.forEach((modulKey) => {
    const kartice = KARTICE_MODULA[modulKey];
    if (!kartice) return;
    Object.entries(kartice).forEach(([karticaKey, def]) => {
      const { pristup, izmjene } = dozvolaZaKarticu(pozicija, modulKey, karticaKey);
      if (!pristup) return;
      def.citanje.forEach((k) => citljivo.add(k));
      def.pisanje.forEach((k) => { citljivo.add(k); if (izmjene) pisivo.add(k); });
    });
  });
  return { citljivo, pisivo };
}

// ---------- pomoćne funkcije ----------
async function ucitajKljuc(key) {
  const r = await pool.query("SELECT value FROM app_data WHERE key = $1", [key]);
  return r.rows[0]?.value ?? null;
}
async function spremiKljuc(key, value) {
  await pool.query(
    `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

// Radni nalozi se iz preglednika spremaju kao CIJELI popis, a preglednik ih učita samo jednom (pri
// otvaranju aplikacije) — sesija otvorena prije nego što je nalogu promijenjena oznaka ili naziv bi
// pri sljedećem spremanju bilo čega vratila staru vrijednost. Zato poslužitelj kod svake promjene
// oznake/naziva zapamti prethodnu vrijednost (prethodniBroj / prethodniNaziv), a ako zatim stigne
// točno ta prethodna vrijednost od preglednika koji ne zna za promjenu, zadrži novu. Ostala polja
// (status, sati…) spremaju se kako su poslana. Namjernu promjenu natrag (npr. šifra projekta vraćena
// na staru) preglednik označi slanjem prethodne vrijednosti jednake trenutnoj, pa prolazi.
function zadrziNoveOznakeNaloga(dolazni, trenutni) {
  const trenutniPoId = new Map(trenutni.map((n) => [n.id, n]));
  return dolazni.map((n) => {
    const t = n && trenutniPoId.get(n.id);
    if (!t) return n;
    const rezultat = { ...n };
    for (const [polje, prethodno] of [["broj", "prethodniBroj"], ["naziv", "prethodniNaziv"]]) {
      if (n[polje] === t[polje]) {
        if (t[prethodno] !== undefined) rezultat[prethodno] = t[prethodno];
      } else if (t[prethodno] !== undefined && n[polje] === t[prethodno] && n[prethodno] !== t[polje]) {
        rezultat[polje] = t[polje];
        rezultat[prethodno] = t[prethodno];
      } else {
        rezultat[prethodno] = t[polje];
      }
    }
    return rezultat;
  });
}
// Utrošeni sati na radnom nalogu su izvedeni: zbroj zapisa u satiPoNalogu za taj nalog. Preglednik ih
// računa iz svoje kopije zapisa, koja može biti zastarjela (npr. ne zna za uvezene sate), pa ih poslužitelj
// kod svakog spremanja naloga ili sati ponovno izračuna iz zapisa u bazi.
const uskladiUtrosenoSati = (nalozi, sati) => {
  const zbroj = new Map();
  (sati || []).forEach((z) => zbroj.set(z.radniNalogId, (zbroj.get(z.radniNalogId) || 0) + (Number(z.sati) || 0)));
  return nalozi.map((n) => (n && n.id ? { ...n, utrosenoSati: zbroj.get(n.id) || 0 } : n));
};
// Uvoz sati iz Excela nalozima otvorenim s preostalim satima povećao je plan za uvezene sate (planUvecanZaUvoz).
// Preglednik učitan prije uvoza šalje nalog bez tog polja i sa starim planom — tada ostaje plan s poslužitelja,
// inače bi plan proizvodnje mislio da je faza već gotova.
function zadrziUvozniPlan(dolazni, trenutni) {
  const poId = new Map(trenutni.map((n) => [n.id, n]));
  return dolazni.map((n) => {
    const t = n && poId.get(n.id);
    if (!t || t.planUvecanZaUvoz == null || n.planUvecanZaUvoz != null) return n;
    const stariPlan = (Number(t.planiranoSati) || 0) - Number(t.planUvecanZaUvoz);
    if (Math.abs((Number(n.planiranoSati) || 0) - stariPlan) < 0.01) return { ...n, planiranoSati: t.planiranoSati, planUvecanZaUvoz: t.planUvecanZaUvoz };
    return { ...n, planUvecanZaUvoz: t.planUvecanZaUvoz };
  });
}
const ucitajSatiPoNalogu = async (client) => (await client.query("SELECT value FROM app_data WHERE key = 'satiPoNalogu'")).rows[0]?.value || [];
// Nakon promjene sati: utrošeno na svim nalozima iz novih zapisa (piše se samo ako se nešto promijenilo).
async function uskladiNalogeSaSatima(client, sati) {
  const r = await client.query("SELECT value FROM app_data WHERE key = 'radniNalozi' FOR UPDATE");
  const nalozi = r.rows[0]?.value || [];
  const novi = uskladiUtrosenoSati(nalozi, sati);
  if (JSON.stringify(novi) !== JSON.stringify(nalozi)) {
    await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'radniNalozi'", [JSON.stringify(novi)]);
  }
}

async function spremiRadneNaloge(dolazni) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'radniNalozi' FOR UPDATE");
    const trenutni = r.rows[0]?.value || [];
    const rezultat = uskladiUtrosenoSati(zadrziUvozniPlan(zadrziNoveOznakeNaloga(dolazni, trenutni), trenutni), await ucitajSatiPoNalogu(client));
    await client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ('radniNalozi', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(rezultat)]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------- auth middleware ----------
function autentikacija(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Nedostaje token." });
  try {
    req.zaposlenikId = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }).zaposlenikId;
    next();
  } catch {
    return res.status(401).json({ error: "Token nije valjan ili je istekao." });
  }
}

// Provjerava smije li prijavljeni zaposlenik MIJENJATI zadani ključ, prema karticama
// njegove pozicije (vidi izracunajDozvoljeneKljuceve/KARTICE_MODULA gore).
async function autorizacijaPisanja(req, res, next) {
  const key = req.params.key;
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { pisivo } = izracunajDozvoljeneKljuceve(pozicija);
  if (!pisivo.has(key)) {
    return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za mijenjanje ovih podataka." });
  }
  next();
}

// ---------- Tko se smije prijaviti u aplikaciju ----------
// Oznaka zaposlenik.prijavaUAplikaciju (uređuje se u Zaposlenici → "Izbornik za prijavu", ruta PUT /api/zaposlenici/prijava):
// false = nije u padajućem izborniku za prijavu i ne može se prijaviti. Bez oznake (stari zapisi) = dopušteno, da uvođenje
// ne zaključa nikoga; novi zaposlenik dobiva false (vidi PUT /api/data/zaposlenici). Kiosk (kartica) na ovo ne utječe.
// Što klijent smije vidjeti od zaposlenika: hashevi lozinki (i stari PIN) NIKAD — umjesto njih samo imaJakuLozinku; RFID kod je vjerodajnica
// za kiosk (?rfid=KOD), pa ga vide samo oni koji smiju uređivati zaposlenike. Hasheve upravlja isključivo poslužitelj
// (PUT /api/zaposlenici/:id/lozinka), a PUT /api/data/zaposlenici ih uvijek zadržava iz baze.
const ZAPOSLENIK_TAJNA_POLJA = ["lozinkaHash", "pinHash", "pin"];
// Podaci o plaći pojedinca (bodovi, satnica kooperanta, fiksni iznos, naknada za prijevoz) idu samo pozicijama s karticom Obračun plaća
// (vidiPlace, vidi smijeObracun); ostali ih ne dobivaju, a PUT /api/data/zaposlenici im ih ne dopušta mijenjati (zadržava se vrijednost iz baze).
const ZAPOSLENIK_PLACNA_POLJA = ["bodovi", "satnicaKooperant", "fiksniMjesecniIznos", "naknadaPrijevoz"];
const zaposleniciZaKlijenta = (popis, vidiKartice, vidiPlace = false) => (Array.isArray(popis) ? popis : []).map((z) => {
  if (!z || typeof z !== "object") return z;
  const { lozinkaHash, pinHash, pin, rfidKod, ...ostalo } = z;
  if (!vidiPlace) ZAPOSLENIK_PLACNA_POLJA.forEach((k) => { delete ostalo[k]; });
  return { ...ostalo, imaJakuLozinku: !!lozinkaHash, ...(vidiKartice && rfidKod !== undefined ? { rfidKod } : {}) };
});
const smijeUAplikaciju = (z) => !!z && z.status !== "Neaktivan" && z.prijavaUAplikaciju !== false;
const imaLozinku = (z) => !!(z.lozinkaHash || z.pinHash || (typeof z.pin === "string" && z.pin));

// ---------- Povijest korekcija (bodovi, radno vrijeme, plaće) ----------
// Tablica korekcije_bodova (stvara je pripremiKorekcije pri pokretanju). Zapis nastaje SAM na poslužitelju kad se spremi promjena
// praćenog polja zaposlenika (PUT /api/data/zaposlenici) ili vrijednosti boda (PUT /api/data/postavkePlaca), pa ne ovisi o tome
// hoće li netko zapamtiti da je nešto ispravio. Zapisi se ne brišu ni mijenjaju; jedino se naknadno upisuje razlog gdje ga nema.
// Razlog (neobavezan) dolazi u zaglavlju X-Korekcija-Razlog (URL-kodiran), a za zaposlenike uz X-Korekcija-Zaposlenik (čiji je zapis).
// Čitaju je samo pozicije s karticom Obračun plaća (u njoj su plaće). Greška pri bilježenju nikad ne smije spriječiti spremanje.
const PRACENA_POLJA_ZAPOSLENIKA = [
  { polje: "bodovi", naziv: "Bodovi", tip: "broj" },
  { polje: "radnoVrijeme", naziv: "Radno vrijeme", tip: "tekst" },
  { polje: "polaRadnoVrijemeOd", naziv: "Pola radnog vremena od", tip: "datum" },
  { polje: "fiksnaPlacaBezPolovice", naziv: "Bodovi su već iznos za pola radnog vremena", tip: "logicko" },
  { polje: "dodatniStazGodine", naziv: "Dodatni staž (godine)", tip: "broj" },
  { polje: "datumZaposlenja", naziv: "Zaposlen od", tip: "datum" },
  { polje: "satnicaKooperant", naziv: "Satnica kooperanta (€/h)", tip: "broj" },
  { polje: "fiksniMjesecniIznos", naziv: "Fiksni mjesečni iznos (€)", tip: "broj" },
  { polje: "naknadaPrijevoz", naziv: "Naknada za prijevoz (€)", tip: "broj" },
  { polje: "pozicijaId", naziv: "Pozicija", tip: "tekst" },
  { polje: "status", naziv: "Status", tip: "tekst" },
];
const PRACENA_POLJA_POSTAVKI = [
  { polje: "vrijednostBoda", naziv: "Vrijednost boda (€)", tip: "broj" },
  { polje: "dodatakStazPoGodini", naziv: "Dodatak na staž (€ po godini staža)", tip: "broj" },
  { polje: "fondSatiMjesec", naziv: "Godišnji fond sati (prosjek mjesečno)", tip: "broj" },
];
const tekstKorekcije = ({ polje, tip }, v, pozicije) => {
  if (polje === "radnoVrijeme") return v === "pola" ? "Pola radnog vremena" : "Puno radno vrijeme";
  if (polje === "status") return v === "Neaktivan" ? "Neaktivan" : "Aktivan";
  if (polje === "pozicijaId") return (pozicije.find((p) => p.id === v)?.naziv) || "";
  if (tip === "broj") return String(Number(v) || 0);
  if (tip === "logicko") return v ? "Da" : "Ne";
  return v == null ? "" : String(v);
};
const imeZaposlenika = (z) => `${z?.prezime || ""} ${z?.ime || ""}`.trim();
function korekcijeZaposlenika(stari, novi, pozicije) {
  const redovi = [];
  const nazivPozicije = (z) => pozicije.find((p) => p.id === z.pozicijaId)?.naziv || "";
  const vidjeni = new Set();
  novi.forEach((z) => {
    if (!z || typeof z !== "object") return;
    vidjeni.add(z.id);
    const prije = stari.get(z.id);
    if (!prije) {
      const bodovi = Number(z.bodovi) || 0;
      redovi.push({ zaposlenikId: z.id, zaposlenik: imeZaposlenika(z), polje: "novi", naziv: "Novi zaposlenik", tip: "tekst", staro: "", novo: `${nazivPozicije(z)}${bodovi > 0 ? `, ${bodovi} bodova` : ""}` });
      return;
    }
    PRACENA_POLJA_ZAPOSLENIKA.forEach((def) => {
      const staro = tekstKorekcije(def, prije[def.polje], pozicije), novo = tekstKorekcije(def, z[def.polje], pozicije);
      if (staro !== novo) redovi.push({ zaposlenikId: z.id, zaposlenik: imeZaposlenika(z), polje: def.polje, naziv: def.naziv, tip: def.tip, staro, novo });
    });
  });
  stari.forEach((prije, id) => {
    if (vidjeni.has(id)) return;
    const bodovi = Number(prije.bodovi) || 0;
    redovi.push({ zaposlenikId: id, zaposlenik: imeZaposlenika(prije), polje: "uklonjen", naziv: "Zaposlenik uklonjen", tip: "tekst", staro: `${nazivPozicije(prije)}${bodovi > 0 ? `, ${bodovi} bodova` : ""}`, novo: "" });
  });
  return redovi;
}
function korekcijePostavki(stare, nove) {
  return PRACENA_POLJA_POSTAVKI.flatMap((def) => {
    const staro = tekstKorekcije(def, stare[def.polje], []), novo = tekstKorekcije(def, nove[def.polje], []);
    return staro !== novo ? [{ zaposlenikId: null, zaposlenik: "Svi zaposlenici", polje: def.polje, naziv: def.naziv, tip: def.tip, staro, novo }] : [];
  });
}
const razlogIzZaglavlja = (req) => {
  try { return decodeURIComponent(String(req.get("x-korekcija-razlog") || "")).trim().slice(0, 300) || null; } catch { return null; }
};
// Upis unutar transakcije klijenta; SAVEPOINT osigurava da neuspjeh bilježenja ne poništi samo spremanje podataka.
async function zapisiKorekcije(client, redovi, korisnik) {
  if (!redovi.length) return;
  try {
    await client.query("SAVEPOINT korekcije");
    const polja = 10;
    const params = [];
    const vrijednosti = redovi.map((r, i) => {
      params.push(r.zaposlenikId || null, r.zaposlenik || "", r.polje, r.naziv, r.tip, r.staro ?? "", r.novo ?? "", korisnik?.id || null, imeZaposlenika(korisnik), r.razlog || null);
      return `(${Array.from({ length: polja }, (_, k) => `$${i * polja + k + 1}`).join(",")})`;
    });
    await client.query(`INSERT INTO korekcije_bodova (zaposlenik_id, zaposlenik, polje, naziv, tip, staro, novo, korisnik_id, korisnik, razlog) VALUES ${vrijednosti.join(",")}`, params);
    await client.query("RELEASE SAVEPOINT korekcije");
    console.log(`Korekcije: ${redovi.length} zapisa (${redovi.map((r) => `${r.zaposlenik}: ${r.naziv} ${r.staro} → ${r.novo}`).join("; ")}), promijenio ${korisnik?.id}`);
  } catch (e) {
    console.error("Greška kod bilježenja korekcija (spremanje podataka nije ometeno):", e);
    await client.query("ROLLBACK TO SAVEPOINT korekcije").catch(() => {});
  }
}
// Kartica Obračun plaća modula Zaposlenici: pristup (čitanje) ili i izmjene.
const smijeObracun = (pozicija, zaIzmjene = false) => {
  if (!(pozicija?.moduli || []).includes("zaposlenici")) return false;
  const d = dozvolaZaKarticu(pozicija, "zaposlenici", "obracun");
  return d.pristup && (!zaIzmjene || d.izmjene);
};
// Gumbi na kartici Zaposlenici (izbornikprijave, popisbodova, povijestkorekcija) imaju zasebnu kvačicu u Pozicije (karticeDozvole.zaposlenici.<ključ>.pristup).
// Po zadanom su dopušteni (kao i kartice) i vrijede UZ pravo koje inače trebaju: oznaka ih samo sužava, nikad ne proširuje.
const smijeFunkciju = (pozicija, kljuc) => dozvolaZaKarticu(pozicija, "zaposlenici", kljuc).pristup;

// ---------- Popis zaposlenika za login ekran (bez PIN-a/pinHash-a, ne treba token — koristi se za padajući izbornik prije prijave) ----------
app.get("/api/auth/zaposlenici", async (req, res) => {
  const zaposlenici = (await ucitajKljuc("zaposlenici")) || [];
  const lista = zaposlenici
    .filter((z) => z.status === "Aktivan" && z.prijavaUAplikaciju !== false)
    .map((z) => ({ id: z.id, ime: z.ime, prezime: z.prezime })) // pozicija se ne otkriva prije prijave (izbornik je ne koristi)
    .sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr"));
  res.json(lista);
});

// ---------- LOGIN ----------
// Podržava tri razine unatrag: novi lozinkaHash (jaka lozinka), stari pinHash
// (hashirani 4-znamenkasti PIN), i legacy plaintext pin — tim redom prioriteta.
// Ovo omogućuje postupnu migraciju zaposlenika na jače lozinke bez trenutnog
// zaključavanja svih dok im netko ne postavi novu lozinku (vidi PUT .../lozinka).
const pokusajiLogina = new Map(); // zaposlenikId -> [timestamps]
app.post("/api/auth/login", async (req, res) => {
  const zaposlenikId = req.body?.zaposlenikId;
  const lozinka = req.body?.lozinka ?? req.body?.pin;
  // Oba polja moraju biti tekst: bez lozinke se prije izvršavala usporedba undefined === undefined (račun bez lozinke je
  // prihvaćao prijavu) odnosno bcrypt.compare bacao grešku koja je rušila poslužitelj.
  if (typeof zaposlenikId !== "string" || zaposlenikId.length > 100 || typeof lozinka !== "string" || !lozinka || lozinka.length > 200) {
    return res.status(400).json({ error: "Odaberite zaposlenika i unesite lozinku." });
  }
  const ip = klijentIp(req);
  if (neuspjeliLogin.blokiran(ip)) return res.status(429).json({ error: "Previše neuspjelih pokušaja s ove adrese. Pokušaj ponovno za nekoliko minuta." });
  const zaposlenici = (await ucitajKljuc("zaposlenici")) || [];
  const zaposlenik = zaposlenici.find((z) => z.id === zaposlenikId);
  // Zaposlenik kojemu je prijava isključena odgovara kao da ne postoji (ne otkriva se da je to valjan račun).
  if (!zaposlenik || zaposlenik.prijavaUAplikaciju === false) { neuspjeliLogin.zabiljezi(ip); return res.status(401).json({ error: "Nepoznat zaposlenik." }); }

  const sada = Date.now();
  const pokusaji = (pokusajiLogina.get(zaposlenikId) || []).filter((t) => sada - t < 5 * 60 * 1000);
  if (pokusaji.length >= 5) return res.status(429).json({ error: "Previše pokušaja. Pokušaj ponovno za 5 minuta." });

  // Račun bez ikakve lozinke se ne može prijaviti; neaktivan zaposlenik također ne (popis za prijavu ih već izostavlja).
  if (!imaLozinku(zaposlenik)) return res.status(401).json({ error: "Za ovaj račun lozinka još nije postavljena. Obratite se administratoru." });
  if (zaposlenik.status === "Neaktivan") return res.status(403).json({ error: "Račun nije aktivan." });
  const ispravan = zaposlenik.lozinkaHash ? await bcrypt.compare(lozinka, zaposlenik.lozinkaHash)
    : zaposlenik.pinHash ? await bcrypt.compare(lozinka, zaposlenik.pinHash)
    : lozinka === zaposlenik.pin;
  await pool.query("INSERT INTO login_log (zaposlenik_id, uspjesno) VALUES ($1,$2)", [zaposlenikId, ispravan]);
  if (!ispravan) {
    pokusaji.push(sada);
    pokusajiLogina.set(zaposlenikId, pokusaji);
    neuspjeliLogin.zabiljezi(ip);
    return res.status(401).json({ error: "Pogrešna lozinka." });
  }
  pokusajiLogina.delete(zaposlenikId);
  const token = jwt.sign({ zaposlenikId }, JWT_SECRET, { expiresIn: "12h", algorithm: "HS256" });
  res.json({ token, zaposlenik: { id: zaposlenik.id, ime: zaposlenik.ime, prezime: zaposlenik.prezime, pozicijaId: zaposlenik.pozicijaId } });
});

// ---------- Postavljanje lozinke (zamjenjuje stari PIN) ----------
// Zasebna, autorizirana ruta — lozinka se hashira na backendu i NIKAD se ne
// sprema/vraća u čistom tekstu (za razliku od stare prakse gdje se PIN mijenjao
// kroz opću PUT /api/data/zaposlenici formu kao obično polje).
function lozinkaJeValjana(lozinka) {
  return typeof lozinka === "string" && lozinka.length >= 8
    && /[A-Za-z]/.test(lozinka) && /[0-9]/.test(lozinka) && /[^A-Za-z0-9]/.test(lozinka);
}
app.put("/api/zaposlenici/:id/lozinka", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  // pisivo uzima u obzir i je li modul Zaposlenici uopće dodijeljen poziciji (dozvolaZaKarticu sama po zadanom dopušta sve).
  if (!izracunajDozvoljeneKljuceve(pozicija).pisivo.has("zaposlenici")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za promjenu lozinki." });

  const { lozinka } = req.body;
  if (!lozinkaJeValjana(lozinka)) {
    return res.status(400).json({ error: "Lozinka mora imati najmanje 8 znakova te sadržavati slovo, broj i poseban znak." });
  }
  const zaposlenici = (await ucitajKljuc("zaposlenici")) || [];
  if (!zaposlenici.some((z) => z.id === req.params.id)) return res.status(404).json({ error: "Zaposlenik nije pronađen." });

  const lozinkaHash = await bcrypt.hash(lozinka, 10);
  const novi = zaposlenici.map((z) => {
    if (z.id !== req.params.id) return z;
    const { pin, pinHash, ...ostalo } = z;
    return { ...ostalo, lozinkaHash };
  });
  await spremiKljuc("zaposlenici", novi);
  console.log(`Lozinka postavljena: zaposlenik ${req.params.id}, postavio ${req.zaposlenikId}`);
  res.json({ ok: true });
});

// ---------- Izbornik za prijavu: tko se smije prijaviti u aplikaciju ----------
// Prima popis id-eva koji ostaju (svi ostali zaposlenici dobivaju false). Mijenja samo tu oznaku, na trenutnom zapisu u bazi
// (zaključanom), pa ne može prepisati tuđe izmjene zaposlenika. Zaštita od zaključavanja: pozivatelj ostaje u popisu i barem
// jedan aktivni glavni administrator s lozinkom mora ostati omogućen.
app.put("/api/zaposlenici/prijava", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  if (!izracunajDozvoljeneKljuceve(pozicija).pisivo.has("zaposlenici") || !smijeFunkciju(pozicija, "izbornikprijave")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za promjenu izbornika za prijavu." });
  const omoguceni = req.body?.omoguceni;
  if (!Array.isArray(omoguceni) || omoguceni.length > 1000 || omoguceni.some((id) => typeof id !== "string")) return res.status(400).json({ error: "Neispravan popis zaposlenika." });
  const skup = new Set(omoguceni);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'zaposlenici' FOR UPDATE");
    const zaposlenici = r.rows[0]?.value || [];
    const dopusteno = (z) => skup.has(z.id) && z.status !== "Neaktivan";
    let poruka = null;
    if (!zaposlenici.some((z) => z.id === req.zaposlenikId && dopusteno(z))) poruka = "Svoj račun ne možeš isključiti iz izbornika za prijavu.";
    else if (!zaposlenici.some((z) => dopusteno(z) && z.pozicijaId === "poz-administrator" && imaLozinku(z))) poruka = "U izborniku za prijavu mora ostati barem jedan glavni administrator s lozinkom.";
    if (poruka) { await client.query("ROLLBACK"); return res.status(400).json({ error: poruka }); }
    const novi = zaposlenici.map((z) => ({ ...z, prijavaUAplikaciju: dopusteno(z) }));
    await client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ('zaposlenici', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(novi)]
    );
    await client.query("COMMIT");
    res.json({ ok: true, omoguceno: novi.filter((z) => z.prijavaUAplikaciju).length });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

// ---------- KIOSK prijava dolaska/odlaska (bez potrebe za login/PIN) ----------
const KIOSK_BLOKADA_MIN = 3;
app.post("/api/kiosk/scan", async (req, res) => {
  // rfidKod mora biti tekst (broj ili objekt je prije rušio poslužitelj); neprepoznate kartice se broje po adresi
  // da se kodovi ne mogu pogađati.
  const sirovi = req.body?.rfidKod;
  if (sirovi != null && (typeof sirovi !== "string" || sirovi.length > 40)) return res.status(400).json({ error: "Kartica nije prepoznata." });
  const kod = (sirovi || "").trim().toUpperCase();
  if (!kod) return res.status(404).json({ error: "Kartica nije prepoznata." });
  const ipKiosk = klijentIp(req);
  if (neuspjeliKiosk.blokiran(ipKiosk)) return res.status(429).json({ error: "Previše neprepoznatih kartica — pokušaj ponovno za nekoliko minuta." });
  // Brzina je bitna (osoba čeka ispred čitača), a svaki upit prema bazi košta mrežno putovanje —
  // zato su ovdje samo DVA upita i baza sama filtrira i mijenja samo potrebno (ne prenosi se cijela
  // evidencija ni popis zaposlenika):
  //  1) jedan upit vraća zaposlenika s tom karticom i samo njegove zapise evidencije;
  //  2) jedan jedini UPDATE upis (dodaj dolazak / zatvori otvoreni zapis) koji se izvršava samo
  //     ako se u međuvremenu nije promijenilo stanje tog zaposlenika (broj zapisa, otvoren zapis).
  // Drugi istovremeni zahtjev čeka zaključani red, vidi da uvjet više ne vrijedi, ne upisuje ništa
  // i cijeli postupak ponavlja na svježim podacima — dakle nijedan upis se ne gubi niti dupla.
  try {
    for (let pokusaj = 0; pokusaj < 3; pokusaj++) {
      const r = await pool.query(
        `SELECT z.elem AS zaposlenik,
           (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM app_data a, jsonb_array_elements(a.value) e WHERE a.key = 'evidencijaRada' AND e->>'zaposlenikId' = z.elem->>'id') AS moji,
           (SELECT count(*) FROM app_data WHERE key = 'evidencijaRada') AS ima_red
         FROM (SELECT elem FROM app_data, jsonb_array_elements(value) elem WHERE key = 'zaposlenici' AND upper(elem->>'rfidKod') = $1 LIMIT 1) z`,
        [kod]
      );
      const red = r.rows[0];
      if (!red) { neuspjeliKiosk.zabiljezi(ipKiosk); return res.status(404).json({ error: "Kartica nije prepoznata." }); }
      const zaposlenik = red.zaposlenik;
      const moji = red.moji || [];
      const otvorena = moji.find((e) => !e.vrijemeOdlaska);
      const sada = new Date();

      // Blokada slučajnog dvostrukog očitanja kartice — ista osoba ne može ponovno
      // prijaviti dolazak/odlazak unutar KIOSK_BLOKADA_MIN minuta od svoje zadnje akcije.
      // Samo stvarni dolasci/odlasci koji su se već dogodili: cjelodnevni zapisi (godišnji, bolovanje…) i zapisi u
      // budućnosti (npr. unaprijed upisan godišnji, vrijeme 00:00) nisu "zadnje skeniranje" i ne smiju blokirati kiosk.
      const zadnjaAkcija = moji.reduce((naj, e) => {
        if ((e.vrsta || "rad") !== "rad") return naj;
        const vrijeme = e.vrijemeOdlaska || e.vrijemeDolaska;
        if (!vrijeme || new Date(vrijeme) > sada) return naj;
        return !naj || new Date(vrijeme) > new Date(naj) ? vrijeme : naj;
      }, null);
      if (zadnjaAkcija) {
        const proteklaMin = (sada - new Date(zadnjaAkcija)) / 60000;
        if (proteklaMin < KIOSK_BLOKADA_MIN) {
          // Ne samo "pričekaj" — javi i ŠTO je zadnja akcija bila i kada, da osoba vidi da je
          // njeno prethodno skeniranje stvarno uspjelo (a ne da izgleda kao nova greška).
          return res.status(429).json({
            error: "Već zabilježeno.",
            cooldown: true,
            zadnjaAkcija: { tip: otvorena ? "dolazak" : "odlazak", vrijeme: zadnjaAkcija },
            ime: zaposlenik.ime, prezime: zaposlenik.prezime,
          });
        }
      }

      const sadaISO = sada.toISOString();
      let odgovor, upisano;
      if (otvorena) {
        const u = await pool.query(
          `UPDATE app_data SET updated_at = now(), value = (
             SELECT coalesce(jsonb_agg(CASE WHEN e.elem->>'id' = $1 THEN e.elem || jsonb_build_object('vrijemeOdlaska', $2::text) ELSE e.elem END ORDER BY e.ord), '[]'::jsonb)
             FROM jsonb_array_elements(value) WITH ORDINALITY AS e(elem, ord))
           WHERE key = 'evidencijaRada'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(value) x WHERE x->>'id' = $1 AND x->>'vrijemeOdlaska' IS NULL)
             AND (SELECT count(*) FROM jsonb_array_elements(value) x WHERE x->>'zaposlenikId' = $3) = $4`,
          [otvorena.id, sadaISO, zaposlenik.id, moji.length]
        );
        upisano = u.rowCount === 1;
        odgovor = { tip: "odlazak", ime: zaposlenik.ime, prezime: zaposlenik.prezime, vrijeme: sadaISO, dolazak: otvorena.vrijemeDolaska };
      } else {
        const nova = { id: `evr-${Date.now()}`, zaposlenikId: zaposlenik.id, vrijemeDolaska: sadaISO, vrijemeOdlaska: null, vrsta: "rad", autoOdjava: false, potvrdenoRacunovodstvo: false, unioRucnoId: null };
        const u = Number(red.ima_red) > 0
          ? await pool.query(
              `UPDATE app_data SET value = value || $1::jsonb, updated_at = now()
               WHERE key = 'evidencijaRada'
                 AND (SELECT count(*) FROM jsonb_array_elements(value) x WHERE x->>'zaposlenikId' = $2) = $3`,
              [JSON.stringify([nova]), zaposlenik.id, moji.length]
            )
          : await pool.query("INSERT INTO app_data (key, value, updated_at) VALUES ('evidencijaRada', $1, now()) ON CONFLICT (key) DO NOTHING", [JSON.stringify([nova])]);
        upisano = u.rowCount === 1;
        odgovor = { tip: "dolazak", ime: zaposlenik.ime, prezime: zaposlenik.prezime, vrijeme: sadaISO };
      }
      if (upisano) {
        res.json(odgovor);
        if (odgovor.tip === "odlazak") podijeliZaboravljeneProgrameRezanja().catch(() => {});
        return;
      }
      // stanje tog zaposlenika se u međuvremenu promijenilo (istovremeno skeniranje) — ponovi na svježim podacima
    }
    res.status(503).json({ error: "Poslužitelj je zauzet — pokušaj ponovno." });
  } catch (e) {
    console.error("Greška kod kiosk skeniranja:", e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  }
});

// Lagana ruta bez upita u bazu — koristi je kiosk zaslon za povremeni "ping" da spriječi
// uspavljivanje besplatnog Render plana (usnivanje nakon 15 min neaktivnosti uzrokuje da prvi
// pravi zahtjev nakon toga čeka 30-50 s, što u gužvi na početku smjene izgleda kao da se
// prijava "ne registrira").
app.get("/api/kiosk/ping", (req, res) => res.json({ ok: true }));
// Vrijeme poslužitelja — preglednik iz njega računa koliko sat uređaja odstupa (npr. računalo na
// laseru s krivom vremenskom zonom), pa se početak/kraj rezanja bilježi prema poslužitelju.
// verzija = commit koji trenutno radi na Renderu (za provjeru je li nova verzija objavljena).
// Otkucaj aktivnosti: preglednik ga šalje svake minute dok je kartica otvorena i korisnik je nešto radio u zadnjih 5 minuta.
// Dva otkucaja unutar 45 s (npr. dvije kartice) broje se kao jedna minuta.
app.post("/api/aktivnost/ping", autentikacija, async (req, res) => {
  const modul = String(req.body?.modul || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "nepoznato";
  const uredaj = req.body?.uredaj === "mobitel" ? "mobitel" : "racunalo";
  try {
    await pool.query(
      `INSERT INTO aktivnost_dan (zaposlenik_id, dan, minuta, moduli, uredaj, zadnja) VALUES ($1, $2, 1, jsonb_build_object($3::text, 1), jsonb_build_object($4::text, 1), now())
       ON CONFLICT (zaposlenik_id, dan) DO UPDATE SET minuta = aktivnost_dan.minuta + 1,
         moduli = jsonb_set(aktivnost_dan.moduli, ARRAY[$3::text], to_jsonb(COALESCE((aktivnost_dan.moduli->>$3::text)::int, 0) + 1)),
         uredaj = jsonb_set(aktivnost_dan.uredaj, ARRAY[$4::text], to_jsonb(COALESCE((aktivnost_dan.uredaj->>$4::text)::int, 0) + 1)),
         zadnja = now()
       WHERE aktivnost_dan.zadnja < now() - interval '45 seconds'`,
      [req.zaposlenikId, danZagreb(), modul, uredaj]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Greška." }); }
});

// Pregled aktivnosti za mjesec (YYYY-MM): samo glavni administrator.
app.get("/api/aktivnost", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  if (pozicija?.id !== "poz-administrator") return res.status(403).json({ error: "Nemaš pristup." });
  const mjesec = /^\d{4}-\d{2}$/.test(String(req.query.mjesec || "")) ? req.query.mjesec : danZagreb().slice(0, 7);
  const od = `${mjesec}-01`;
  try {
    const [dani, prijave, zadnjePrijave, zadnjeAktivnosti, pocetak] = await Promise.all([
      pool.query("SELECT zaposlenik_id, to_char(dan, 'YYYY-MM-DD') AS dan, minuta, izmjene, moduli, uredaj, izmjene_kljucevi, zadnja FROM aktivnost_dan WHERE dan >= $1::date AND dan < ($1::date + interval '1 month') ORDER BY dan", [od]),
      pool.query("SELECT zaposlenik_id, count(*) FILTER (WHERE uspjesno)::int AS uspjesne, count(*) FILTER (WHERE NOT uspjesno)::int AS neuspjesne, array_agg(DISTINCT to_char(vrijeme AT TIME ZONE 'Europe/Zagreb', 'YYYY-MM-DD')) FILTER (WHERE uspjesno) AS dani FROM login_log WHERE (vrijeme AT TIME ZONE 'Europe/Zagreb') >= $1::timestamp AND (vrijeme AT TIME ZONE 'Europe/Zagreb') < ($1::timestamp + interval '1 month') GROUP BY zaposlenik_id", [od]),
      pool.query("SELECT zaposlenik_id, max(vrijeme) AS zadnja FROM login_log WHERE uspjesno GROUP BY zaposlenik_id"),
      pool.query("SELECT zaposlenik_id, max(zadnja) AS zadnja FROM aktivnost_dan GROUP BY zaposlenik_id"),
      pool.query("SELECT to_char(min(dan), 'YYYY-MM-DD') AS pocetak FROM aktivnost_dan"),
    ]);
    res.json({ mjesec, dani: dani.rows, prijave: prijave.rows, zadnjePrijave: zadnjePrijave.rows, zadnjeAktivnosti: zadnjeAktivnosti.rows, pocetakPracenja: pocetak.rows[0]?.pocetak || null });
  } catch (e) {
    console.error("Greška kod čitanja aktivnosti:", e);
    res.status(500).json({ error: "Greška kod čitanja aktivnosti." });
  }
});

app.get("/api/vrijeme", (req, res) => res.json({ sada: new Date().toISOString(), verzija: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || null }));

// ---------- Javna kartica matičnog broja (QR kod s naljepnice materijala, bez prijave) ----------
// Isti podaci kao kartica u aplikaciji (materijal, šarža, atest, dobavljač, narudžbenica, količine, izdavanja na
// projekte) — bez cijena. Matični brojevi idu redom, pa je broj upita po IP adresi ograničen da se cijela knjiga
// ne može brzo pokupiti; skeniranje naljepnica u skladištu (i inventura) ostaje unutar ograničenja.
const JAVNO_UPITA = 120, JAVNO_PROZOR_MS = 10 * 60 * 1000;
const javniUpiti = new Map(); // ip -> [vremena upita]
setInterval(() => { const sada = Date.now(); javniUpiti.forEach((t, ip) => { const ostaju = t.filter((x) => sada - x < JAVNO_PROZOR_MS); if (ostaju.length) javniUpiti.set(ip, ostaju); else javniUpiti.delete(ip); }); }, JAVNO_PROZOR_MS);
const zaokruziKolicinu = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
// Isto kao netoPoMaticnim u App.jsx: povrat se oduzima od zadnje dodijeljenih matičnih brojeva stavke izdatnice.
const netoPoMaticnim = (st) => {
  const alok = (st.matBrojevi || []).map((a) => ({ ...a }));
  let vraceno = Number(st.kolicinaVraceno) || 0;
  for (let i = alok.length - 1; i >= 0 && vraceno > 0; i--) {
    const v = Math.min(alok[i].kolicina, vraceno);
    alok[i].kolicina = zaokruziKolicinu(alok[i].kolicina - v);
    vraceno -= v;
  }
  return alok.filter((a) => a.kolicina > 0.0005);
};
// Dimenzije matičnog broja s narudžbenice (isto kao dimenzijeStavkeNarudzbenice / dimenzijeMaticnog u aplikaciji): novi
// zapisi ih dobiju kod zaprimanja; za starije se traže na narudžbenici — kad je isti materijal na njoj u više formata,
// k-ti matični broj (po broju) pripada k-toj takvoj stavci.
const dimenzijeStavkeNarudzbenice = (n, s, i, materijali) => {
  const su = n.stavkeUpita && n.stavkeUpita.length === (n.stavke || []).length ? n.stavkeUpita[i] : null;
  const t = (v) => String(v ?? "").trim();
  if (su) return su.vrstaStavke === "lim" && t(su.sirinaMM) ? `${t(su.dimenzijaMM)} × ${t(su.sirinaMM)} mm` : t(su.dimenzijaMM) ? `${t(su.dimenzijaMM)} mm` : "";
  const mm = (v) => Math.round((Number(v) || 0) * 1000);
  if (s.nacinUnosa === "duzina" && Number(s.duzinaM) > 0) return `${mm(s.duzinaM)} mm`;
  if (s.nacinUnosa === "lim" && Number(s.duzinaM) > 0) return `${mm(s.duzinaM)} × ${mm(s.sirinaM)} mm`;
  return (materijali || []).find((x) => x.id === s.materijalId)?.dimenzije || "";
};
const dimenzijeMaticnog = (z, knjiga, narudzbenice, materijali) => {
  if (z.dimenzije) return z.dimenzije;
  const n = z.narudzbenicaId ? (narudzbenice || []).find((x) => x.id === z.narudzbenicaId) : null;
  if (!n) return "";
  const kand = (n.stavke || []).map((s, i) => ({ s, i })).filter(({ s }) => s.materijalId === z.materijalId);
  const dim = kand.map(({ s, i }) => dimenzijeStavkeNarudzbenice(n, s, i, materijali));
  if (dim.length && dim.every((d) => d === dim[0])) return dim[0];
  const lotovi = (knjiga || []).filter((x) => x.narudzbenicaId === n.id && x.materijalId === z.materijalId && x.izvor === "zaprimanje").sort((a, b) => (Number(a.broj) || 0) - (Number(b.broj) || 0));
  return lotovi.length === kand.length ? dim[lotovi.findIndex((x) => x.id === z.id)] || "" : "";
};
app.get("/api/javno/maticni/:broj", async (req, res) => {
  const ip = klijentIp(req); // ne prvi unos X-Forwarded-For: klijent ga može lažirati i tako zaobići ograničenje
  const sada = Date.now();
  const nedavni = (javniUpiti.get(ip) || []).filter((t) => sada - t < JAVNO_PROZOR_MS);
  if (nedavni.length >= JAVNO_UPITA) return res.status(429).json({ error: "Previše upita s ovog uređaja — pokušaj ponovno za nekoliko minuta." });
  nedavni.push(sada);
  javniUpiti.set(ip, nedavni);
  try {
    const [knjiga, dobavljaci, izdatnice, projekti, narudzbenice, materijali] = await Promise.all(["maticnaKnjiga", "dobavljaci", "izdatnice", "projekti", "narudzbenice", "materijali"].map(ucitajKljuc));
    const z = (knjiga || []).find((x) => String(x.broj) === String(req.params.broj).trim());
    if (!z) return res.status(404).json({ error: `Matični broj ${String(req.params.broj).slice(0, 20)} nije pronađen.` });
    let iskoristeno = 0;
    const izdano = [];
    (izdatnice || []).forEach((i) => (i.stavke || []).forEach((st) => netoPoMaticnim(st).filter((a) => a.maticniId === z.id).forEach((a) => {
      iskoristeno += a.kolicina;
      const p = (projekti || []).find((x) => x.id === i.projektId);
      izdano.push({ id: `${i.id}-${st.id}`, izdatnica: i.broj, datum: i.datum, projekt: p ? `${p.sifra} — ${p.naziv}` : "—", kolicina: a.kolicina, jm: st.jm || z.jm });
    })));
    izdano.sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
    res.json({
      broj: z.broj, naziv: z.naziv, sifra: z.sifra, dimenzije: dimenzijeMaticnog(z, knjiga, narudzbenice, materijali), kvaliteta: z.kvaliteta, sarza: z.sarza, atestBroj: z.atestBroj, atestVrsta: z.atestVrsta,
      dobavljac: (dobavljaci || []).find((d) => d.id === z.dobavljacId)?.naziv || "", narudzbenicaBroj: z.narudzbenicaBroj, otpremnicaDobavljaca: z.otpremnicaDobavljaca || "", datum: z.datum,
      kolicinaPrimljeno: z.kolicinaPrimljeno, iskoristeno: zaokruziKolicinu(iskoristeno), preostalo: zaokruziKolicinu((Number(z.kolicinaPrimljeno) || 0) - iskoristeno),
      jm: z.jm, napomena: z.napomena, izdano,
    });
  } catch (e) {
    console.error("Greška kod javne kartice matičnog broja:", e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  }
});

// ---------- Ciljana izmjena evidencijaRada (Evidencija rada u glavnoj aplikaciji) ----------
// Obična PUT /api/data/evidencijaRada šalje CIJELI popis kakav ga je preglednik zadnji put
// dohvatio — ako je u međuvremenu (dok je taj preglednik otvoren) netko prijavio/odjavio
// dolazak na kiosku, taj zapis ne postoji u poslanom popisu pa se pri spremanju TIHO IZBRIŠE.
// Ova ruta umjesto toga prima samo ŠTO se mijenja (upsert: zapisi za dodati/izmijeniti po id-u,
// remove: id-evi za ukloniti) i primjenjuje to na TRENUTNI popis u bazi, zaključan istom
// SELECT ... FOR UPDATE transakcijom kao i kiosk skeniranje — tako da paralelna kiosk prijava i
// ručna izmjena u Evidenciji rada više ne mogu jedna drugu prepisati.
app.put("/api/evidencija/patch", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { pisivo } = izracunajDozvoljeneKljuceve(pozicija);
  if (!pisivo.has("evidencijaRada")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za mijenjanje evidencije." });

  const upsert = Array.isArray(req.body.upsert) ? req.body.upsert : [];
  const remove = Array.isArray(req.body.remove) ? req.body.remove : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'evidencijaRada' FOR UPDATE");
    const trenutno = r.rows[0]?.value || [];
    const removeSet = new Set(remove);
    const upsertMap = new Map(upsert.map((z) => [z.id, z]));
    const postojeciIds = new Set(trenutno.map((e) => e.id));
    const rezultat = trenutno
      .filter((e) => !removeSet.has(e.id))
      .map((e) => (upsertMap.has(e.id) ? upsertMap.get(e.id) : e));
    upsert.forEach((z) => { if (!postojeciIds.has(z.id)) rezultat.push(z); });

    await client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ('evidencijaRada', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(rezultat)]
    );
    await client.query("COMMIT");
    res.json({ ok: true, evidencijaRada: rezultat });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod izmjene evidencije:", e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  } finally {
    client.release();
  }
});

// ---------- Ciljana izmjena JEDNOG projekta (po id-u) ----------
// Isti problem kao kod evidencije: projekt se u ProjektDetaljModalu uređuje često i u sitnim
// koracima (raspored isporuka, zadaci, stavke materijala) dok je stranica otvorena — obična PUT
// /api/data/projekti šalje CIJELI popis projekata kakav ga je preglednik zadnji put dohvatio, pa
// bi svaka takva sitna izmjena s malo starijom kopijom tiho prepisala nečiju noviju izmjenu na
// ISTOM ili DRUGOM projektu. Ova ruta prima samo koja polja se mijenjaju (patch) za JEDAN projekt
// i primjenjuje ih (plitko spajanje, kao {...postojeci, ...patch}) na trenutni zapis u bazi,
// zaključan cijelo vrijeme transakcije.
app.put("/api/projekti/:id/patch", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { pisivo } = izracunajDozvoljeneKljuceve(pozicija);
  if (!pisivo.has("projekti")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za mijenjanje projekata." });

  const patch = req.body.patch && typeof req.body.patch === "object" ? req.body.patch : {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'projekti' FOR UPDATE");
    const trenutno = r.rows[0]?.value || [];
    if (!trenutno.some((p) => p.id === req.params.id)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Projekt nije pronađen." });
    }
    const rezultat = trenutno.map((p) => (p.id === req.params.id ? { ...p, ...patch } : p));

    await client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ('projekti', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(rezultat)]
    );
    await client.query("COMMIT");
    res.json({ ok: true, projekti: rezultat });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod izmjene projekta:", e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  } finally {
    client.release();
  }
});

// ---------- Ciljano označavanje zadatka projekta kao izvršenog (self-service) ----------
// Za razliku od /api/projekti/:id/patch (traži ovlaštenje za cijeli modul "projekti"), ovo
// dopušta zaposleniku da označi SVOJ dodijeljeni zadatak izvršenim bez obzira ima li uopće
// pristup modulu Projekti — obavijest o zadatku na nadzornoj ploči mora biti upotrebljiva
// svakome kome je zadatak dodijeljen, ne samo voditeljima projekata.
app.put("/api/projekti/:projektId/zadatak/:zadId/izvrseno", autentikacija, async (req, res) => {
  const izvrseno = !!req.body.izvrseno;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'projekti' FOR UPDATE");
    const trenutno = r.rows[0]?.value || [];
    const projekt = trenutno.find((p) => p.id === req.params.projektId);
    const zadatak = (projekt?.zadaci || []).find((z) => z.id === req.params.zadId);
    if (!projekt || !zadatak) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zadatak nije pronađen." });
    }
    if (zadatak.dodijeljenoId !== req.zaposlenikId) {
      const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
      const { pisivo } = izracunajDozvoljeneKljuceve(pozicija);
      if (!pisivo.has("projekti")) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Ovaj zadatak nije dodijeljen tebi." });
      }
    }
    const rezultat = trenutno.map((p) => (p.id !== req.params.projektId ? p : {
      ...p,
      zadaci: (p.zadaci || []).map((z) => (z.id !== req.params.zadId ? z : {
        ...z, izvrseno,
        datumIzvrsenja: izvrseno ? (z.datumIzvrsenja || new Date().toISOString().slice(0, 10)) : null,
        izvrsioId: izvrseno ? (z.izvrsioId || req.zaposlenikId) : null,
        ...(izvrseno ? {} : { zavrsetakVidjenZadao: null, zavrsetakVidjenDatum: null }),
      })),
    }));
    await client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ('projekti', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(rezultat)]
    );
    await client.query("COMMIT");
    res.json({ ok: true, projekti: rezultat });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod označavanja zadatka:", e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  } finally {
    client.release();
  }
});

// ---------- Podaci za Plan proizvodnje ----------
// Plan treba (1) normativ kupaonica — samo učinak (kg/h) i raspodjelu sati po fazama, BEZ ugovorenih
// cijena — i (2) tko je kojih dana odsutan (godišnji, bolovanje…) — samo zaposlenik i datum, BEZ
// vrste odsutnosti. Zato ih ne čita izravno iz "normativi"/"evidencijaRada" (to bi svakome tko vidi
// plan otkrilo cijene i bolovanja), nego preko ove rute. Pravo: tko smije čitati planProizvodnje.
app.get("/api/plan/podaci", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { citljivo } = izracunajDozvoljeneKljuceve(pozicija);
  if (!citljivo.has("planProizvodnje")) return res.status(403).json({ error: "Vaša pozicija nema pristup planu proizvodnje." });
  const [normativi, evidencija, projekti, kupci, narudzbe] = await Promise.all([ucitajKljuc("normativi"), ucitajKljuc("evidencijaRada"), ucitajKljuc("projekti"), ucitajKljuc("kupci"), ucitajKljuc("narudzbe")]);
  // Za popis aktivnih projekata: samo naziv kupca i brojevi narudžbi kupca — bez ugovorenih cijena (zato ne čita izravno kupce i narudžbe).
  const nazivKupca = new Map((kupci || []).map((k) => [k.id, k.naziv]));
  const brojeviNarudzbi = {};
  (narudzbe || []).forEach((n) => { if (n.projektId && n.broj) (brojeviNarudzbi[n.projektId] = brojeviNarudzbi[n.projektId] || []).push(n.broj); });
  const odDatuma = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const odsutnosti = [];
  const vidjeno = new Set();
  (evidencija || []).forEach((e) => {
    const datum = (e.vrijemeDolaska || "").slice(0, 10);
    if ((e.vrsta || "rad") === "rad" || !datum || datum < odDatuma) return;
    const kljuc = `${e.zaposlenikId}|${datum}`;
    if (vidjeno.has(kljuc)) return;
    vidjeno.add(kljuc);
    odsutnosti.push({ zaposlenikId: e.zaposlenikId, datum });
  });
  res.json({
    normativ: { naziv: normativi?.naziv || "", grupe: (normativi?.grupe || []).map((g) => ({ kljuc: g.kljuc, naziv: g.naziv, ucinakKgH: Number(g.ucinakKgH) || 0, raspodjela: g.raspodjela || {} })) },
    odsutnosti,
    projektiPregled: Object.fromEntries((projekti || []).map((p) => [p.id, { kupac: nazivKupca.get(p.kupacId) || "", narudzbe: brojeviNarudzbi[p.id] || [] }])),
  });
});

// ---------- XRechnung: zadaci za lokalni "most" ----------
// ERP je na internetu pa ne vidi mrežni disk Z:. Zato "Kreiraj XRechnung" u ERP-u samo upiše zadatak u red čekanja;
// MOST (program na uredskom računalu s pristupom Z:) svakih par sekundi pita ima li zadataka, obradi ih lokalno (mapa Fakture
// projekta, Konplastov XML, izrada i službena provjera XRechnunga) i vrati rezultat. Most se prijavljuje tajnom MOST_TOKEN
// (zaglavlje X-Most-Token) i samo se javlja ovamo — ništa se ne otvara prema vani.
// Red čekanja je u memoriji poslužitelja: zadaci su kratkotrajni, a rezultat (datoteke) ostaje na Z:. Restart poslužitelja
// briše popis, a zadatak koji čeka/obrađuje se samo ponovno zada.
const MOST_TOKEN = process.env.MOST_TOKEN || "";
const xrZadaci = [];
let mostZadnjiPut = null;
const XR_STATUSI_ZAVRSNI = ["Valjano", "Nevaljano", "Greška", "Gotovo"];
// Vrste zadataka: izrada XRechnunga te čitanje/spremanje postavki kumulativa (kumulativ.json u mapi računa projekta).
const XR_VRSTE = ["xrechnung", "kumulativ-citaj", "kumulativ-spremi", "xrechnung-popis", "xrechnung-obrisi"];
// Popis izrađenih XRechnunga samo čita pa ne blokira (i ne blokira ga) druge zadatke istog projekta.
const xrBlokira = (z) => z.vrsta !== "xrechnung-popis" && (z.status === "Čeka" || z.status === "Obrada");

const mostAutentikacija = (req, res, next) => {
  if (MOST_TOKEN.length < 24) return res.status(503).json({ error: "Most nije podešen (MOST_TOKEN nije postavljen na poslužitelju)." });
  const dan = Buffer.from(String(req.headers["x-most-token"] || ""));
  const tajna = Buffer.from(MOST_TOKEN);
  if (dan.length !== tajna.length || !crypto.timingSafeEqual(dan, tajna)) return res.status(401).json({ error: "Neispravan token mosta." });
  next();
};
const xrDozvola = async (req) => izracunajDozvoljeneKljuceve(await ucitajPozicijuZaposlenika(req.zaposlenikId));
const xrJavni = (z) => ({ id: z.id, vrsta: z.vrsta, racunBroj: z.racunBroj, projektId: z.projektId, sifra: z.sifra, naziv: z.naziv, eAdresa: z.eAdresa, referenca: z.referenca, status: z.status, kreiraoIme: z.kreiraoIme, kreirano: z.kreirano, zavrseno: z.zavrseno || null, rezultat: z.rezultat || null });
const xrTekst = (v, max) => String(v ?? "").slice(0, max);
// Postavke kumulativa (ugovor, avans, prijašnji računi) — poslužitelj samo ograničava oblik i duljine; brojeve i smislenost provjerava most.
const xrIznos = (v) => (typeof v === "number" && Number.isFinite(v) ? v : xrTekst(v, 30));
const xrKumulativ = (v) => {
  if (!v || typeof v !== "object") return null;
  const isp = v.isporuka && typeof v.isporuka === "object" ? { ulica: xrTekst(v.isporuka.ulica, 100), posta: xrTekst(v.isporuka.posta, 12), grad: xrTekst(v.isporuka.grad, 60), drzava: xrTekst(v.isporuka.drzava, 2) } : undefined;
  return {
    ...(v._napomena ? { _napomena: xrTekst(v._napomena, 500) } : {}), ...(v.projekt ? { projekt: xrTekst(v.projekt, 60) } : {}), ...(v.pozicija ? { pozicija: xrTekst(v.pozicija, 60) } : {}),
    gesamtauftrag: xrIznos(v.gesamtauftrag), vorauszahlung: xrIznos(v.vorauszahlung),
    racuni: (Array.isArray(v.racuni) ? v.racuni.slice(0, 40) : []).map((r) => ({ oznaka: xrTekst(r?.oznaka, 10), vrsta: r?.vrsta === "aconto" ? "aconto" : "racun", broj: xrTekst(r?.broj, 40), datum: xrTekst(r?.datum, 10), iznos: xrIznos(r?.iznos), ...(r?.kumulativ != null ? { kumulativ: xrIznos(r.kumulativ) } : {}) })),
    ...(isp ? { isporuka: isp } : {}),
  };
};

app.get("/api/xrechnung/zadaci", autentikacija, async (req, res) => {
  const { citljivo } = await xrDozvola(req);
  if (!citljivo.has("xrechnungPostavke")) return res.status(403).json({ error: "Vaša pozicija nema pristup kartici XRechnung." });
  res.json({ zadaci: xrZadaci.slice(0, 30).map(xrJavni), most: { povezan: !!mostZadnjiPut && Date.now() - mostZadnjiPut < 30000, zadnjiPut: mostZadnjiPut ? new Date(mostZadnjiPut).toISOString() : null } });
});

app.post("/api/xrechnung/zadaci", autentikacija, async (req, res) => {
  const { pisivo } = await xrDozvola(req);
  if (!pisivo.has("xrechnungPostavke")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za izradu XRechnunga." });
  const { projektId, eAdresa, referenca, racunBroj } = req.body || {};
  const vrsta = XR_VRSTE.includes(req.body?.vrsta) ? req.body.vrsta : "xrechnung";
  const [projekti, zaposlenici] = await Promise.all([ucitajKljuc("projekti"), ucitajKljuc("zaposlenici")]);
  const projekt = (projekti || []).find((p) => p.id === projektId);
  if (!projekt) return res.status(404).json({ error: "Projekt nije pronađen." });
  const email = String(eAdresa || "").trim();
  if (vrsta === "xrechnung" && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return res.status(400).json({ error: "E-adresa kupca nije ispravna." });
  const kumulativ = vrsta === "kumulativ-spremi" ? xrKumulativ(req.body?.kumulativ) : null;
  if (vrsta === "kumulativ-spremi" && !kumulativ) return res.status(400).json({ error: "Nedostaju podaci o kumulativu." });
  if (vrsta === "xrechnung-obrisi" && !String(racunBroj || "").trim()) return res.status(400).json({ error: "Nije zadan broj računa." });
  if (vrsta !== "xrechnung-popis" && xrZadaci.some((z) => z.projektId === projektId && xrBlokira(z))) return res.status(409).json({ error: "Za ovaj projekt već postoji zadatak koji čeka ili se obrađuje." });
  const ja = (zaposlenici || []).find((z) => z.id === req.zaposlenikId);
  const zadatak = {
    id: crypto.randomUUID(), vrsta, projektId, sifra: xrTekst(projekt.sifra, 60), naziv: xrTekst(projekt.naziv, 160), mapa: xrTekst(projekt.mapa, 400),
    eAdresa: vrsta === "xrechnung" ? email : "", referenca: xrTekst(referenca, 100).trim(), racunBroj: xrTekst(racunBroj, 40).trim(), kumulativ,
    status: "Čeka", kreirao: req.zaposlenikId, kreiraoIme: ja ? `${ja.ime} ${ja.prezime}` : "", kreirano: new Date().toISOString(),
  };
  xrZadaci.unshift(zadatak);
  if (xrZadaci.length > 100) xrZadaci.length = 100;
  res.json({ ok: true, zadatak: xrJavni(zadatak) });
});

app.delete("/api/xrechnung/zadaci/:id", autentikacija, async (req, res) => {
  const { pisivo } = await xrDozvola(req);
  if (!pisivo.has("xrechnungPostavke")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za izradu XRechnunga." });
  const z = xrZadaci.find((q) => q.id === req.params.id);
  if (!z) return res.status(404).json({ error: "Zadatak nije pronađen." });
  if (z.status !== "Čeka") return res.status(409).json({ error: "Zadatak se već obrađuje ili je završen." });
  z.status = "Otkazano";
  z.zavrseno = new Date().toISOString();
  res.json({ ok: true });
});

// Most: dohvaća i preuzima zadatke koji čekaju (svaki poziv je i "otkucaj" da je most živ).
app.get("/api/most/zadaci", mostAutentikacija, (req, res) => {
  mostZadnjiPut = Date.now();
  xrZadaci.forEach((z) => { // zadatak koji most nije završio u 10 minuta (npr. prekinut rad) ne ostaje vječno "u obradi"
    if (z.status === "Obrada" && Date.now() - z.preuzeto > 10 * 60 * 1000) { z.status = "Greška"; z.zavrseno = new Date().toISOString(); z.rezultat = { poruke: ["Most nije javio rezultat u 10 minuta. Pokušaj ponovno."] }; }
  });
  const cekaju = xrZadaci.filter((z) => z.status === "Čeka");
  cekaju.forEach((z) => { z.status = "Obrada"; z.preuzeto = Date.now(); });
  res.json({ zadaci: cekaju.map((z) => ({ id: z.id, vrsta: z.vrsta, sifra: z.sifra, naziv: z.naziv, mapa: z.mapa, eAdresa: z.eAdresa, referenca: z.referenca, racunBroj: z.racunBroj, kumulativ: z.kumulativ })) });
});

app.post("/api/most/zadaci/:id/rezultat", mostAutentikacija, (req, res) => {
  const z = xrZadaci.find((q) => q.id === req.params.id);
  if (!z) return res.status(404).json({ error: "Zadatak nije pronađen." });
  const b = req.body || {};
  const popis = (v, max, duljina) => (Array.isArray(v) ? v.slice(0, max).map((s) => xrTekst(s, duljina)) : []);
  const pravila = (v) => (Array.isArray(v) ? v.slice(0, 30).map((g) => ({ id: xrTekst(g?.id, 60), tekst: xrTekst(g?.tekst, 400) })) : []);
  z.status = XR_STATUSI_ZAVRSNI.includes(b.status) ? b.status : "Greška";
  z.zavrseno = new Date().toISOString();
  z.rezultat = {
    poruke: popis(b.poruke, 20, 500),
    sazetak: b.sazetak && typeof b.sazetak === "object" ? Object.fromEntries(Object.entries(b.sazetak).slice(0, 20).map(([k, v]) => [xrTekst(k, 40), typeof v === "number" ? v : xrTekst(v, 200)])) : null,
    kontrole: Array.isArray(b.kontrole) ? b.kontrole.slice(0, 20).map((k) => ({ ok: !!k?.ok, opis: xrTekst(k?.opis, 300) })) : [],
    validacija: b.validacija ? { ocjena: xrTekst(b.validacija.ocjena, 30), greske: pravila(b.validacija.greske), upozorenja: pravila(b.validacija.upozorenja) } : null,
    datoteke: Array.isArray(b.datoteke) ? b.datoteke.slice(0, 10).map((d) => ({ naziv: xrTekst(d?.naziv, 200), putanja: xrTekst(d?.putanja, 500) })) : [],
    izlaznaMapa: xrTekst(b.izlaznaMapa, 500), probno: !!b.probno,
    kumulativ: xrKumulativ(b.kumulativ), mapaKumulativa: xrTekst(b.mapaKumulativa, 500),
    xrechnungi: Array.isArray(b.xrechnungi) ? b.xrechnungi.slice(0, 50).map((x) => ({
      broj: xrTekst(x?.broj, 40), datum: xrTekst(x?.datum, 10), kupac: xrTekst(x?.kupac, 160), eAdresa: xrTekst(x?.eAdresa, 254),
      zaPlatiti: Number(x?.zaPlatiti) || 0, valjan: !!x?.valjan, mapa: xrTekst(x?.mapa, 500), promijenjeno: xrTekst(x?.promijenjeno, 30),
      datoteke: Array.isArray(x?.datoteke) ? x.datoteke.slice(0, 12).map((d) => xrTekst(d, 200)) : [],
    })) : null,
    zadnjiRacun: b.zadnjiRacun && typeof b.zadnjiRacun === "object" ? { broj: xrTekst(b.zadnjiRacun.broj, 40), datum: xrTekst(b.zadnjiRacun.datum, 10) } : null,
  };
  res.json({ ok: true });
});

// ---------- Obavijesti o zadacima (zvonce u aplikaciji) ----------
// Dvije vrste: "dodjela" — netko mi je zadao zadatak (dok ga ne potvrdim ili izvršim) i
// "zavrsetak" — netko je izvršio zadatak koji sam ja zadao (dok ne potvrdim "U redu"). Vrijedi samo
// za zadatke koji imaju zapisano tko ih je zadao (zadaoId — od uvođenja ove funkcije).
const obavijestiZadataka = (ja, projekti, slobodni) => {
  const out = [];
  const obradi = (z, izvor, p) => {
    if (!z.zadaoId) return;
    const baza = { izvor, projektId: p?.id || null, projektSifra: p?.sifra || "", projektNaziv: p?.naziv || "", zadId: z.id, naziv: z.naziv, planiraniDatum: z.planiraniDatum || null, napomena: z.napomena || null };
    if (z.dodijeljenoId === ja && z.zadaoId !== ja && !z.izvrseno && !z.dodjelaVidjena) out.push({ ...baza, vrsta: "dodjela", od: z.zadaoId, datum: z.zadanoDatum || null });
    if (z.zadaoId === ja && z.izvrseno && z.izvrsioId && z.izvrsioId !== ja && !z.zavrsetakVidjenZadao) out.push({ ...baza, vrsta: "zavrsetak", od: z.izvrsioId, datum: z.datumIzvrsenja || null });
  };
  (projekti || []).forEach((p) => (p.zadaci || []).forEach((z) => obradi(z, "projekt", p)));
  (slobodni || []).forEach((z) => obradi(z, "slobodni", null));
  return out.sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")));
};
app.get("/api/obavijesti", autentikacija, async (req, res) => {
  const [projekti, slobodni] = await Promise.all([ucitajKljuc("projekti"), ucitajKljuc("slobodniZadaci")]);
  res.json({ obavijesti: obavijestiZadataka(req.zaposlenikId, projekti, slobodni) });
});
app.put("/api/obavijesti/potvrdi", autentikacija, async (req, res) => {
  const stavke = Array.isArray(req.body.stavke) ? req.body.stavke.slice(0, 500) : [];
  const ja = req.zaposlenikId;
  const danas = new Date().toISOString().slice(0, 10);
  const primijeni = (z, s) => {
    if (s.vrsta === "dodjela" && z.dodijeljenoId === ja) return { ...z, dodjelaVidjena: true };
    if (s.vrsta === "zavrsetak" && z.zadaoId === ja) return { ...z, zavrsetakVidjenZadao: true, zavrsetakVidjenDatum: danas };
    return z;
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const projekti = (await client.query("SELECT value FROM app_data WHERE key = 'projekti' FOR UPDATE")).rows[0]?.value || [];
    const slobodni = (await client.query("SELECT value FROM app_data WHERE key = 'slobodniZadaci' FOR UPDATE")).rows[0]?.value || [];
    let promjenaP = false, promjenaS = false;
    const projektiNovi = projekti.map((p) => {
      const moje = stavke.filter((s) => s.izvor === "projekt" && s.projektId === p.id);
      if (!moje.length) return p;
      promjenaP = true;
      return { ...p, zadaci: (p.zadaci || []).map((z) => moje.filter((s) => s.zadId === z.id).reduce(primijeni, z)) };
    });
    const slobodniNovi = slobodni.map((z) => {
      const moje = stavke.filter((s) => s.izvor === "slobodni" && s.zadId === z.id);
      if (!moje.length) return z;
      promjenaS = true;
      return moje.reduce(primijeni, z);
    });
    const spremi = (kljuc, v) => client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [kljuc, JSON.stringify(v)]);
    if (promjenaP) await spremi("projekti", projektiNovi);
    if (promjenaS) await spremi("slobodniZadaci", slobodniNovi);
    await client.query("COMMIT");
    const pozicija = await ucitajPozicijuZaposlenika(ja);
    const { citljivo } = izracunajDozvoljeneKljuceve(pozicija);
    res.json({
      ok: true,
      ...(citljivo.has("projekti") ? { projekti: projektiNovi } : {}),
      ...(citljivo.has("slobodniZadaci") ? { slobodniZadaci: filtrirajSlobodneZadatke(slobodniNovi, pozicija, ja) } : {}),
      obavijesti: obavijestiZadataka(ja, projektiNovi, slobodniNovi),
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod potvrde obavijesti:", e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  } finally {
    client.release();
  }
});

// ---------- Zadaci na nadzornoj ploči koji nisu vezani uz projekt ("slobodniZadaci") ----------
// Svaki zaposlenik smije dodati zadatak sebi i označiti svoje zadatke izvršenima (bez obzira na
// module), a tko ima pravo mijenjati projekte smije ih zadavati i drugima te uređivati/brisati
// bilo čiji. Isti oblik kao ostali patch endpointi (upsert po id-u + remove), primijenjen na
// trenutni zaključani popis u bazi, da istodobne izmjene ne prepišu jedna drugu.
app.put("/api/slobodniZadaci/patch", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const upravitelj = izracunajDozvoljeneKljuceve(pozicija).pisivo.has("projekti") || POZICIJE_ZADAVANJE_ZADATAKA.includes(pozicija?.id);
  const upsert = Array.isArray(req.body.upsert) ? req.body.upsert : [];
  const remove = Array.isArray(req.body.remove) ? req.body.remove : [];
  const danas = new Date().toISOString().slice(0, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'slobodniZadaci' FOR UPDATE");
    const trenutno = r.rows[0]?.value || [];
    const postojeci = new Map(trenutno.map((z) => [z.id, z]));
    const mojeJe = (z) => z && (z.dodijeljenoId === req.zaposlenikId || z.kreiraoId === req.zaposlenikId);

    for (const u of upsert) {
      const staro = postojeci.get(u.id);
      if (!upravitelj) {
        if (staro ? !mojeJe(staro) : u.dodijeljenoId !== req.zaposlenikId) {
          await client.query("ROLLBACK");
          return res.status(403).json({ error: "Zadatak možeš dodati samo sebi, a mijenjati samo svoje zadatke." });
        }
        if (u.dodijeljenoId !== req.zaposlenikId && u.dodijeljenoId !== staro?.dodijeljenoId) {
          await client.query("ROLLBACK");
          return res.status(403).json({ error: "Zadatke drugima mogu zadavati samo korisnici s pristupom projektima." });
        }
      }
    }
    for (const id of remove) {
      if (!upravitelj && postojeci.has(id) && postojeci.get(id).kreiraoId !== req.zaposlenikId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Zadatak može obrisati samo osoba koja ga je dodala." });
      }
    }

    const removeSet = new Set(remove);
    const upsertMap = new Map(upsert.map((u) => [u.id, u]));
    const obradi = (u, staro) => {
      const z = { ...u, kreiraoId: staro?.kreiraoId || u.kreiraoId || req.zaposlenikId };
      // tko je zadao zadatak: kod novog zadatka uvijek onaj tko ga sprema (ako je zadao), kasnije se ne mijenja
      z.zadaoId = staro ? (staro.zadaoId || null) : (u.zadaoId ? req.zaposlenikId : null);
      z.dodjelaVidjena = !!(staro?.dodjelaVidjena || u.dodjelaVidjena);
      if (z.izvrseno) {
        z.datumIzvrsenja = staro?.datumIzvrsenja || z.datumIzvrsenja || danas; z.izvrsioId = staro?.izvrsioId || req.zaposlenikId;
        z.zavrsetakVidjenZadao = !!(staro?.zavrsetakVidjenZadao || u.zavrsetakVidjenZadao);
        z.zavrsetakVidjenDatum = staro?.zavrsetakVidjenDatum || u.zavrsetakVidjenDatum || null;
      } else { z.datumIzvrsenja = null; z.izvrsioId = null; z.zavrsetakVidjenZadao = null; z.zavrsetakVidjenDatum = null; }
      return z;
    };
    const rezultat = trenutno.filter((z) => !removeSet.has(z.id)).map((z) => (upsertMap.has(z.id) ? obradi(upsertMap.get(z.id), z) : z));
    upsert.forEach((u) => { if (!postojeci.has(u.id) && !removeSet.has(u.id)) rezultat.push(obradi(u, null)); });

    await client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ('slobodniZadaci', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(rezultat)]
    );
    await client.query("COMMIT");
    res.json({ ok: true, slobodniZadaci: filtrirajSlobodneZadatke(rezultat, pozicija, req.zaposlenikId) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod izmjene zadataka:", e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  } finally {
    client.release();
  }
});

// ---------- Napomena uz zadatak projekta (self-service) ----------
// Ista pravila kao kod označavanja izvršenim: napomenu smije upisati osoba kojoj je zadatak
// dodijeljen (i bez pristupa modulu Projekti, npr. s nadzorne ploče) ili tko smije mijenjati projekte.
app.put("/api/projekti/:projektId/zadatak/:zadId/napomena", autentikacija, async (req, res) => {
  const napomena = String(req.body.napomena ?? "").trim().slice(0, 2000) || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'projekti' FOR UPDATE");
    const trenutno = r.rows[0]?.value || [];
    const projekt = trenutno.find((p) => p.id === req.params.projektId);
    const zadatak = (projekt?.zadaci || []).find((z) => z.id === req.params.zadId);
    if (!projekt || !zadatak) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zadatak nije pronađen." });
    }
    if (zadatak.dodijeljenoId !== req.zaposlenikId) {
      const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
      if (!izracunajDozvoljeneKljuceve(pozicija).pisivo.has("projekti")) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Ovaj zadatak nije dodijeljen tebi." });
      }
    }
    const danas = new Date().toISOString().slice(0, 10);
    const rezultat = trenutno.map((p) => (p.id !== req.params.projektId ? p : {
      ...p,
      zadaci: (p.zadaci || []).map((z) => (z.id !== req.params.zadId ? z : {
        ...z, napomena, napomenaAutorId: napomena ? req.zaposlenikId : null, napomenaDatum: napomena ? danas : null,
      })),
    }));
    await client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ('projekti', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(rezultat)]
    );
    await client.query("COMMIT");
    res.json({ ok: true, projekti: rezultat });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod napomene zadatka:", e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  } finally {
    client.release();
  }
});

// ---------- Ciljana izmjena upitiNabave (Upiti materijala u Nabavi) ----------
// Isti oblik kao /api/evidencija/patch (upsert po id-u + remove) — ponuda dobavljača u jednom
// upitu uređuje se često i u sitnim koracima (cijena, jedinica, dodatak, napomena po svakoj
// ponudi), pa obična PUT /api/data/upitiNabave sa cijelim popisom nosi isti rizik tihog
// prepisivanja tuđe/novije izmjene kao i evidencijaRada/projekti.
app.put("/api/upiti/patch", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { pisivo } = izracunajDozvoljeneKljuceve(pozicija);
  if (!pisivo.has("upitiNabave")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za mijenjanje upita nabave." });

  const upsert = Array.isArray(req.body.upsert) ? req.body.upsert : [];
  const remove = Array.isArray(req.body.remove) ? req.body.remove : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'upitiNabave' FOR UPDATE");
    const trenutno = r.rows[0]?.value || [];
    const removeSet = new Set(remove);
    const upsertMap = new Map(upsert.map((u) => [u.id, u]));
    const postojeciIds = new Set(trenutno.map((u) => u.id));
    const rezultat = trenutno
      .filter((u) => !removeSet.has(u.id))
      .map((u) => (upsertMap.has(u.id) ? upsertMap.get(u.id) : u));
    upsert.forEach((u) => { if (!postojeciIds.has(u.id)) rezultat.push(u); });

    await client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ('upitiNabave', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(rezultat)]
    );
    await client.query("COMMIT");
    res.json({ ok: true, upitiNabave: rezultat });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod izmjene upita nabave:", e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  } finally {
    client.release();
  }
});

// ---------- Ciljana izmjena popisa dokumenata s brojem (otpremnice, CMR): upsert po id-u + remove ----------
// Isti oblik kao /api/upiti/patch. Cijeli popis poslan iz zastarjele kopije preglednika znao je tiho
// obrisati dokument koji je netko drugi upravo izdao — a pritom bi novi dobio ISTI broj (broj se
// računao iz zastarjelog popisa). Zato server primjenjuje izmjenu na trenutni zaključani popis, a
// novi dokument čiji je broj već zauzet dobiva sljedeći slobodan broj. prilagodiUpsert (neobavezno)
// dobiva poslane zapise i trenutni popis prije spajanja (radni nalozi: zadrziNoveOznakeNaloga).
const patchPoIdHandler = (kljuc, brojRegex, naziv, prilagodiUpsert = (upsert) => upsert, sirinaBroja = 0, poSpremanju = null) => async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { pisivo } = izracunajDozvoljeneKljuceve(pozicija);
  if (!pisivo.has(kljuc)) return res.status(403).json({ error: `Vaša pozicija nema ovlaštenje za mijenjanje: ${naziv}.` });

  const poslano = Array.isArray(req.body.upsert) ? req.body.upsert : [];
  const remove = Array.isArray(req.body.remove) ? req.body.remove : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = $1 FOR UPDATE", [kljuc]);
    const trenutno = r.rows[0]?.value || [];
    const upsert = await prilagodiUpsert(poslano, trenutno, client);
    const removeSet = new Set(remove);
    const upsertMap = new Map(upsert.map((u) => [u.id, u]));
    const postojeciIds = new Set(trenutno.map((u) => u.id));
    const rezultat = trenutno
      .filter((u) => !removeSet.has(u.id))
      .map((u) => (upsertMap.has(u.id) ? upsertMap.get(u.id) : u));
    const promijenjeniBrojevi = [];
    upsert.forEach((u) => {
      if (postojeciIds.has(u.id)) return;
      const m = brojRegex.exec(u.broj || "");
      if (m && rezultat.some((o) => o.broj === u.broj)) {
        const brojevi = rezultat.filter((o) => o.broj && o.broj.startsWith(m[1]) && o.broj.endsWith(m[3])).map((o) => parseInt(o.broj.slice(m[1].length, o.broj.length - m[3].length), 10)).filter((n) => !isNaN(n));
        const novi = `${m[1]}${String(Math.max(...brojevi) + 1).padStart(sirinaBroja, "0")}${m[3]}`;
        promijenjeniBrojevi.push({ id: u.id, staro: u.broj, novo: novi });
        rezultat.push({ ...u, broj: novi });
      } else {
        rezultat.push(u);
      }
    });

    await client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [kljuc, JSON.stringify(rezultat)]
    );
    if (poSpremanju) await poSpremanju(client, rezultat);
    await client.query("COMMIT");
    res.json({ ok: true, [kljuc]: rezultat, promijenjeniBrojevi });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`Greška kod izmjene (${kljuc}):`, e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  } finally {
    client.release();
  }
};
app.put("/api/otpremnice/patch", autentikacija, patchPoIdHandler("otpremnice", /^(OTP-\d{2}-\d{2}-)(\d+)(\/\d{2})$/, "otpremnica"));
app.put("/api/cmr/patch", autentikacija, patchPoIdHandler("cmr", /^(CMR-\d{2}-\d{2}-)(\d+)(\/\d{2})$/, "CMR-a"));
// Radni nalozi: oznaka "<šifra projekta>/<broj>" — novi nalog čija je oznaka već zauzeta dobiva
// sljedeći slobodan broj tog projekta.
// Materijali i rezervacije: isto ciljano spremanje po id-u (nema broja dokumenta, pa se regex nikad ne podudara).
app.put("/api/materijali/patch", autentikacija, patchPoIdHandler("materijali", /^(?!)$/, "materijala"));
// Transporti: TU-GGGG-NNN (upit) i TN-GGGG-NNN (narudžba); zauzet broj dobiva sljedeći slobodan.
app.put("/api/upitiTransporta/patch", autentikacija, patchPoIdHandler("upitiTransporta", /^(TU-\d{4}-)(\d+)()$/, "upita za transport", (upsert) => upsert, 3));
// Narudžbenice (materijal dobavljačima): isto kao otpremnice — izmjena po id-u na trenutnom zaključanom popisu, a broj
// (NAR-2026-017) koji je u međuvremenu zauzet dobiva sljedeći slobodan. Prije je cijeli popis stizao iz zastarjelog
// preglednika pa je nova narudžbenica prepisivala postojeću s istim brojem.
app.put("/api/narudzbenice/patch", autentikacija, patchPoIdHandler("narudzbenice", /^(NAR-\d{4}-)(\d+)()$/, "narudžbenica", (upsert) => upsert, 3));
app.put("/api/narudzbeTransporta/patch", autentikacija, patchPoIdHandler("narudzbeTransporta", /^(TN-\d{4}-)(\d+)()$/, "narudžbi za transport", (upsert) => upsert, 3));
app.put("/api/rezervacije/patch", autentikacija, patchPoIdHandler("rezervacije", /^(?!)$/, "rezervacija"));
// Matična knjiga: matični broj (od 3700, uzlazno) dodjeljuje isključivo poslužitelj, pod zaključanim popisom —
// preglednik sa zastarjelim popisom inače bi dvaput dobio isti broj. Broj postojećeg zapisa se ne može promijeniti.
const POCETNI_MATICNI_BROJ = 3700;
// Iznimka: materijal evidentiran prije matične knjige može ući s ranije dodijeljenim brojem (izvor "ranije",
// rucniBroj) — prihvaća se samo ako broj nije zauzet (inače dobiva sljedeći automatski) i ne pomiče slijed.
const dodijeliMaticneBrojeve = (poslano, trenutno) => {
  const postojeci = new Map(trenutno.map((z) => [z.id, z]));
  const zauzeti = new Set(trenutno.map((z) => Number(z.broj)).filter(Boolean));
  let iduci = Math.max(POCETNI_MATICNI_BROJ - 1, ...trenutno.filter((z) => z.izvor !== "ranije").map((z) => Number(z.broj) || 0)) + 1;
  return poslano.map((z) => {
    if (postojeci.has(z.id)) return { ...z, broj: postojeci.get(z.id).broj };
    const rucni = z.izvor === "ranije" ? Math.floor(Number(z.rucniBroj)) : NaN;
    if (rucni > 0 && !zauzeti.has(rucni)) {
      zauzeti.add(rucni);
      const { rucniBroj, ...ostalo } = z;
      return { ...ostalo, broj: rucni };
    }
    while (zauzeti.has(iduci)) iduci++;
    zauzeti.add(iduci);
    const { rucniBroj, ...ostalo } = z;
    return { ...ostalo, broj: iduci++ };
  });
};
app.put("/api/maticnaKnjiga/patch", autentikacija, patchPoIdHandler("maticnaKnjiga", /^(?!)$/, "matične knjige", dodijeliMaticneBrojeve));
app.put("/api/radniNalozi/patch", autentikacija, patchPoIdHandler("radniNalozi", /^(.*\/)(\d+)()$/, "radnih naloga",
  async (poslano, trenutno, client) => uskladiUtrosenoSati(zadrziUvozniPlan(zadrziNoveOznakeNaloga(poslano, trenutno), trenutno), await ucitajSatiPoNalogu(client))));
// Sati po nalozima (dnevni unos u Planu proizvodnje i Sati po nalozima, uvoz iz Excela): izmjena po id-u, pa
// zastarjela kopija u pregledniku više ne briše tuđe zapise; nakon spremanja se preračuna utrošeno na nalozima.
app.put("/api/satiPoNalogu/patch", autentikacija, patchPoIdHandler("satiPoNalogu", /^(?!)$/, "sati po nalozima", (upsert) => upsert, 0, uskladiNalogeSaSatima));
// Ponude (PON-2026-025) i ponude za lasersko rezanje (LAS-2026-003): izmjena po id-u na trenutnom popisu, pa kartica
// otvorena prije tuđe izmjene više ne vraća tuđe ponude na staro; nova ponuda čiji je broj u međuvremenu zauzet
// dobiva sljedeći slobodan broj.
app.put("/api/ponude/patch", autentikacija, patchPoIdHandler("ponude", /^(PON-\d{4}-)(\d+)()$/, "ponuda", (upsert) => upsert, 3));
app.put("/api/ponudeLasera/patch", autentikacija, patchPoIdHandler("ponudeLasera", /^(LAS-\d{4}-)(\d+)()$/, "ponuda za laser", (upsert) => upsert, 3));

// ---------- Ciljana izmjena projekata (upsert po id-u + remove) ----------
// Isti oblik kao /api/evidencija/patch i /api/upiti/patch — dodavanje/uređivanje/brisanje CIJELOG
// projekta (kreiranje, uređivanje osnovnih podataka, ručno sortiranje, brisanje). Nadopunjuje
// /api/projekti/:id/patch (koji mijenja SAMO navedena polja jednog projekta, za česte sitne
// izmjene poput unosa dimenzija materijala) — ova ruta služi za operacije koje mijenjaju CIJELE
// zapise ili više projekata odjednom. Bez ovoga, ti pozivi su i dalje slali cijeli popis projekata
// prema zastarjeloj lokalnoj kopiji preglednika, pa je paralelna izmjena (npr. s kioska ili druge
// kartice) znala tiho nestati — točno ono što se dogodilo projektu RN 170-314.
app.put("/api/projekti/patch", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { pisivo } = izracunajDozvoljeneKljuceve(pozicija);
  if (!pisivo.has("projekti")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za mijenjanje projekata." });

  const upsert = Array.isArray(req.body.upsert) ? req.body.upsert : [];
  const remove = Array.isArray(req.body.remove) ? req.body.remove : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'projekti' FOR UPDATE");
    const trenutno = r.rows[0]?.value || [];
    const removeSet = new Set(remove);
    const upsertMap = new Map(upsert.map((p) => [p.id, p]));
    const postojeciIds = new Set(trenutno.map((p) => p.id));
    const rezultat = trenutno
      .filter((p) => !removeSet.has(p.id))
      .map((p) => (upsertMap.has(p.id) ? upsertMap.get(p.id) : p));
    upsert.forEach((p) => { if (!postojeciIds.has(p.id)) rezultat.push(p); });

    await client.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ('projekti', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(rezultat)]
    );
    await client.query("COMMIT");
    res.json({ ok: true, projekti: rezultat });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod izmjene projekata:", e);
    res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
  } finally {
    client.release();
  }
});

// ---------- podaci (sve zaštićeno loginom) ----------
// Vraća SVE ključeve odjednom — koristi se pri pokretanju aplikacije. Ključevi izvan
// zaposlenikovih dopuštenih kartica vraćaju se kao prazan placeholder (a ne izostavljeni)
// da frontend ne padne na db.<kljuc>.find/.filter — vidi izracunajDozvoljeneKljuceve().
app.get("/api/data", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { citljivo, pisivo } = izracunajDozvoljeneKljuceve(pozicija);

  const r = await pool.query("SELECT key, value FROM app_data");
  const stvarno = {};
  r.rows.forEach((row) => { stvarno[row.key] = row.value; });
  // Otvorena prijava (token vrijedi do 12 h) prestaje čim zaposleniku isključe prijavu ili ga deaktiviraju, najkasnije pri sljedećem učitavanju podataka.
  if (!smijeUAplikaciju((stvarno.zaposlenici || []).find((z) => z.id === req.zaposlenikId))) return res.status(401).json({ error: "Prijava u aplikaciju nije omogućena za ovaj račun." });

  const rezultat = {};
  DOZVOLJENI_KLJUCEVI.forEach((key) => {
    rezultat[key] = citljivo.has(key) ? (stvarno[key] ?? (OBJEKT_KLJUCEVI.has(key) ? {} : [])) : (OBJEKT_KLJUCEVI.has(key) ? {} : []);
  });
  rezultat.slobodniZadaci = filtrirajSlobodneZadatke(rezultat.slobodniZadaci, pozicija, req.zaposlenikId);
  rezultat.zaposlenici = zaposleniciZaKlijenta(rezultat.zaposlenici, pisivo.has("zaposlenici"), smijeObracun(pozicija));
  res.json(rezultat);
});

app.get("/api/data/:key", autentikacija, async (req, res) => {
  const key = req.params.key;
  if (!DOZVOLJENI_KLJUCEVI.includes(key)) return res.status(400).json({ error: "Nepoznat ključ." });
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { citljivo, pisivo } = izracunajDozvoljeneKljuceve(pozicija);
  if (!citljivo.has(key)) return res.status(403).json({ error: "Vaša pozicija nema pristup ovim podacima." });
  const vrijednost = await ucitajKljuc(key);
  res.json(key === "slobodniZadaci" ? filtrirajSlobodneZadatke(vrijednost, pozicija, req.zaposlenikId)
    : key === "zaposlenici" ? zaposleniciZaKlijenta(vrijednost, pisivo.has("zaposlenici"), smijeObracun(pozicija))
    : vrijednost);
});

app.put("/api/data/:key", autentikacija, async (req, res, next) => {
  if (!DOZVOLJENI_KLJUCEVI.includes(req.params.key)) return res.status(400).json({ error: "Nepoznat ključ." });
  next();
}, autorizacijaPisanja, async (req, res) => {
  if (req.params.key === "radniNalozi") {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: "Neispravan popis radnih naloga." });
    try {
      await spremiRadneNaloge(req.body);
    } catch (e) {
      console.error("Greška kod spremanja radnih naloga:", e);
      return res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
    }
    return res.json({ ok: true });
  }
  // Ponude iz preglednika sa starom verzijom aplikacije (cijeli popis): ponude koje su na poslužitelju, a nema ih u
  // poslanom popisu, ostaju — nova verzija briše ponudu samo izričito, preko /api/ponude/patch (remove).
  if (req.params.key === "ponude" || req.params.key === "ponudeLasera") {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: "Neispravan popis ponuda." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query("SELECT value FROM app_data WHERE key = $1 FOR UPDATE", [req.params.key]);
      const poslaniIds = new Set(req.body.map((p) => p?.id));
      const rezultat = [...req.body, ...(r.rows[0]?.value || []).filter((p) => !poslaniIds.has(p.id))];
      await client.query(
        `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [req.params.key, JSON.stringify(rezultat)]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Greška kod spremanja ponuda:", e);
      return res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
    } finally {
      client.release();
    }
    return res.json({ ok: true });
  }
  // Preglednik sa starom verzijom aplikacije šalje cijeli popis sati kakav je zapamtio — uvezeni zapisi
  // (izvor "uvoz") kojih u njemu nema ostaju; utrošeno na nalozima se preračuna.
  if (req.params.key === "satiPoNalogu") {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: "Neispravan popis sati." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query("SELECT value FROM app_data WHERE key = 'satiPoNalogu' FOR UPDATE");
      const poslaniIds = new Set(req.body.map((z) => z?.id));
      const rezultat = [...req.body, ...(r.rows[0]?.value || []).filter((z) => z.izvor === "uvoz" && !poslaniIds.has(z.id))];
      await client.query(
        `INSERT INTO app_data (key, value, updated_at) VALUES ('satiPoNalogu', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(rezultat)]
      );
      await uskladiNalogeSaSatima(client, rezultat);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Greška kod spremanja sati po nalozima:", e);
      return res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
    } finally {
      client.release();
    }
    return res.json({ ok: true });
  }
  // Oznaka "prijavaUAplikaciju" mijenja se samo preko PUT /api/zaposlenici/prijava (sa zaštitom od zaključavanja). Preglednik koji je
  // otvoren odavno šalje cijeli popis bez te oznake (ili sa starom), pa se ovdje za postojeće zaposlenike zadržava ona u bazi, a novi
  // zaposlenik počinje bez prava prijave dok ga administrator ne označi.
  if (req.params.key === "zaposlenici") {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: "Neispravan popis zaposlenika." });
    // Podatke o plaći (bodovi i sl.) smije mijenjati samo tko smije mijenjati karticu Obračun plaća; za ostale ostaje vrijednost iz baze.
    const smijePlace = smijeObracun(await ucitajPozicijuZaposlenika(req.zaposlenikId), true);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query("SELECT value FROM app_data WHERE key = 'zaposlenici' FOR UPDATE");
      const stari = new Map((r.rows[0]?.value || []).map((z) => [z.id, z]));
      const rezultat = req.body.map((z) => {
        if (!z || typeof z !== "object") return z;
        // Klijent ne vidi (a time ni ne smije mijenjati) hasheve lozinki ni oznaku prijave: sve to ostaje onako kako je u bazi.
        const { prijavaUAplikaciju: _poslano, imaJakuLozinku: _izvedeno, lozinkaHash: _h, pinHash: _ph, pin: _pin, ...ostalo } = z;
        const prije = stari.get(z.id);
        if (!smijePlace) ZAPOSLENIK_PLACNA_POLJA.forEach((k) => { if (prije?.[k] !== undefined) ostalo[k] = prije[k]; else delete ostalo[k]; });
        if (!prije) return { ...ostalo, prijavaUAplikaciju: false };
        const zadrzano = {};
        ZAPOSLENIK_TAJNA_POLJA.forEach((k) => { if (prije[k] !== undefined) zadrzano[k] = prije[k]; });
        if (prije.prijavaUAplikaciju !== undefined) zadrzano.prijavaUAplikaciju = prije.prijavaUAplikaciju;
        return { ...ostalo, ...zadrzano };
      });
      await client.query(
        `INSERT INTO app_data (key, value, updated_at) VALUES ('zaposlenici', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(rezultat)]
      );
      // Povijest korekcija: što se razlikuje od onoga što je do sada bilo u bazi (vidi korekcijeZaposlenika).
      const pozicije = (await client.query("SELECT value FROM app_data WHERE key = 'pozicijeZaposlenika'")).rows[0]?.value || [];
      const razlog = razlogIzZaglavlja(req), razlogZaposlenik = String(req.get("x-korekcija-zaposlenik") || "");
      const korekcije = korekcijeZaposlenika(stari, rezultat, Array.isArray(pozicije) ? pozicije : [])
        .map((k) => (razlog && k.zaposlenikId === razlogZaposlenik ? { ...k, razlog } : k));
      await zapisiKorekcije(client, korekcije, stari.get(req.zaposlenikId) || { id: req.zaposlenikId });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return res.json({ ok: true });
  }
  // Vrijednost boda, dodatak na staž i fond sati utječu na sve plaće — svaka promjena ide u povijest korekcija.
  if (req.params.key === "postavkePlaca" && req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query("SELECT value FROM app_data WHERE key = 'postavkePlaca' FOR UPDATE");
      const stare = r.rows[0]?.value;
      await client.query(
        `INSERT INTO app_data (key, value, updated_at) VALUES ('postavkePlaca', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(req.body)]
      );
      if (stare && typeof stare === "object") {
        const razlog = razlogIzZaglavlja(req);
        const korisnik = ((await client.query("SELECT value FROM app_data WHERE key = 'zaposlenici'")).rows[0]?.value || []).find((z) => z.id === req.zaposlenikId) || { id: req.zaposlenikId };
        await zapisiKorekcije(client, korekcijePostavki(stare, req.body).map((k) => (razlog ? { ...k, razlog } : k)), korisnik);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return res.json({ ok: true });
  }
  await spremiKljuc(req.params.key, req.body);
  res.json({ ok: true });
});

// ---------- Povijest korekcija: pregled i naknadni upis razloga ----------
app.get("/api/korekcije-bodova", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  if (!smijeObracun(pozicija) || !smijeFunkciju(pozicija, "povijestkorekcija")) return res.status(403).json({ error: "Vaša pozicija nema pristup povijesti korekcija." });
  const r = await pool.query("SELECT id, vrijeme, zaposlenik_id, zaposlenik, polje, naziv, tip, staro, novo, korisnik, razlog FROM korekcije_bodova ORDER BY vrijeme DESC, id DESC LIMIT 5000");
  res.json({ korekcije: r.rows.map((k) => ({ id: String(k.id), vrijeme: k.vrijeme, zaposlenikId: k.zaposlenik_id, zaposlenik: k.zaposlenik, polje: k.polje, naziv: k.naziv, tip: k.tip, staro: k.staro, novo: k.novo, korisnik: k.korisnik, razlog: k.razlog || "" })) });
});
// Razlog se može upisati samo ondje gdje ga još nema — postojeći zapisi se ne prepisuju.
app.put("/api/korekcije-bodova/:id/razlog", autentikacija, async (req, res) => {
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  if (!smijeObracun(pozicija, true) || !smijeFunkciju(pozicija, "povijestkorekcija")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za izmjene obračuna plaća." });
  const razlog = typeof req.body?.razlog === "string" ? req.body.razlog.trim().slice(0, 300) : "";
  if (!razlog || !/^\d{1,18}$/.test(req.params.id)) return res.status(400).json({ error: "Neispravan zahtjev." });
  const r = await pool.query("UPDATE korekcije_bodova SET razlog = $1 WHERE id = $2 AND (razlog IS NULL OR razlog = '')", [razlog, req.params.id]);
  if (!r.rowCount) return res.status(409).json({ error: "Razlog je već upisan ili zapis ne postoji." });
  res.json({ ok: true });
});

// ---------- Automatska odjava zaostalih (nezavršenih) smjena ----------
// Prije se ova provjera pokretala SAMO u pregledniku, kad bi netko otvorio tab "Evidencija rada"
// u glavnoj aplikaciji — ako to nitko nije napravio na vrijeme (npr. cijeli dan zaokupljen nekim
// drugim problemom), otvorene smjene bi ostale otvorene satima dulje nego što je prag nalagao,
// iako bi se, kad se konačno provjeri, vrijeme odlaska ispravno izračunalo kao dolazak+prag.
// Ovdje se ista logika pokreće sama na serveru, neovisno o tome ima li itko aplikaciju otvorenu.
async function provjeriAutoOdjavu() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [rE, rP] = await Promise.all([
      client.query("SELECT value FROM app_data WHERE key = 'evidencijaRada' FOR UPDATE"),
      client.query("SELECT value FROM app_data WHERE key = 'postavkePlaca'"),
    ]);
    const evidencija = rE.rows[0]?.value || [];
    const satiDoAutoOdjave = Number(rP.rows[0]?.value?.autoOdjavaSati) || 12;
    const sada = Date.now();
    let promijenjeno = false;
    const nova = evidencija.map((e) => {
      if (e.vrijemeOdlaska) return e;
      const proteklo = (sada - new Date(e.vrijemeDolaska).getTime()) / 3600000;
      if (proteklo < satiDoAutoOdjave) return e;
      promijenjeno = true;
      const auto = new Date(new Date(e.vrijemeDolaska).getTime() + satiDoAutoOdjave * 3600000);
      return { ...e, vrijemeOdlaska: auto.toISOString(), autoOdjava: true };
    });
    if (promijenjeno) {
      await client.query(
        `INSERT INTO app_data (key, value, updated_at) VALUES ('evidencijaRada', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(nova)]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod automatske odjave:", e);
  } finally {
    client.release();
  }
}

// ---------- Automatska podjela programa rezanja nakon odjave operatera ----------
// Operater pokrene program na laseru, ode kući i zaboravi ga pauzirati/podijeliti — program ostaje
// "Početak" i stvarno vrijeme teče cijelu noć. Ovdje se takav program (status "Početak", operater
// više nema otvorenu smjenu, a zadnja odjava je poslije početka segmenta) dijeli na isti način kao
// gumb "Podijeli": postojeći se zatvara kao "Završeno" s vremenom odrađenim DO ODJAVE, a preostalo
// vrijeme ide u novi program-nastavak (broj/NN, "Na čekanju"). Pokreće se nakon svake odjave na
// kiosku i svakih 15 min (hvata i zaostale programe te automatske odjave).
const bazniBrojPrograma = (broj) => {
  const k = String(broj).lastIndexOf("/");
  if (k === -1) return String(broj);
  return /^\d+$/.test(String(broj).slice(k + 1)) ? String(broj).slice(0, k) : String(broj);
};
const sljedeciBrojNastavka = (programi, originalBroj) => {
  const baza = bazniBrojPrograma(originalBroj);
  let max = 0;
  programi.forEach((pr) => {
    if (pr.brojPrograma !== baza && bazniBrojPrograma(pr.brojPrograma) === baza) {
      const n = parseInt(pr.brojPrograma.slice(baza.length + 1), 10);
      if (!isNaN(n)) max = Math.max(max, n);
    }
  });
  return `${baza}/${String(max + 1).padStart(2, "0")}`;
};
let podjelaProgramaUTijeku = false;
async function podijeliZaboravljeneProgrameRezanja() {
  if (podjelaProgramaUTijeku) return;
  podjelaProgramaUTijeku = true;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rP = await client.query("SELECT value FROM app_data WHERE key = 'programiRezanja' FOR UPDATE");
    const programi = rP.rows[0]?.value || [];
    const aktivni = programi.filter((pr) => pr.status === "Početak" && pr.segmentPocetak && (pr.operaterId || pr.pokrenuoId));
    if (aktivni.length === 0) { await client.query("COMMIT"); return; }
    const evidencija = (await client.query("SELECT value FROM app_data WHERE key = 'evidencijaRada'")).rows[0]?.value || [];
    const sada = new Date();
    let nova = [...programi];
    const dodani = [];
    let promijenjeno = false;
    for (const pr of aktivni) {
      const operaterId = pr.operaterId || pr.pokrenuoId;
      const moji = evidencija.filter((e) => e.zaposlenikId === operaterId);
      if (moji.length === 0 || moji.some((e) => !e.vrijemeOdlaska)) continue; // još je prijavljen (ili ga kiosk ne prati)
      const pocetak = new Date(pr.segmentPocetak).getTime();
      const odlazak = moji.reduce((naj, e) => Math.max(naj, new Date(e.vrijemeOdlaska).getTime()), 0);
      if (!(odlazak > pocetak) || odlazak > sada.getTime() + 60000) continue; // odjava je bila prije pokretanja programa
      const odlazakISO = new Date(odlazak).toISOString();
      const odradjenoMin = (Number(pr.odradjenoMin) || 0) + Math.max(0, Math.round((odlazak - pocetak) / 60000));
      const preostaloMin = Math.max(0, (Number(pr.trajanjeMin) || 0) - odradjenoMin);
      // Utrošak materijala se ne može znati: ako ima preostalog vremena, nedovršene stavke u cijelosti
      // prelaze na nastavak (skladište se ne mijenja, kao kod "Podijeli" s nula utrošenog); ako je
      // planirano vrijeme već potrošeno, program se zatvara s planiranim utroškom.
      const zatvorene = [], noveStavke = [];
      (pr.stavkeMaterijala || []).forEach((st) => {
        if (st.finalizirano) { zatvorene.push(st); return; }
        if (preostaloMin > 0) {
          zatvorene.push({ ...st, stvarnoKolicina: 0, finalizirano: true });
          noveStavke.push({ id: `prm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, materijalId: st.materijalId, planiranoKolicina: st.planiranoKolicina, stvarnoKolicina: null, finalizirano: false });
        } else {
          zatvorene.push({ ...st, stvarnoKolicina: st.planiranoKolicina, finalizirano: true });
        }
      });
      const zatvoren = { ...pr, status: "Završeno", zavrsetak: odlazakISO, odradjenoMin, segmentPocetak: null, zavrsioId: operaterId, stavkeMaterijala: zatvorene, autoPodijeljen: preostaloMin > 0 };
      nova = nova.map((x) => (x.id === pr.id ? zatvoren : x));
      if (preostaloMin > 0) {
        const broj = sljedeciBrojNastavka(nova, pr.brojPrograma);
        dodani.push({
          id: `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, stroj: pr.stroj, brojPrograma: broj,
          trajanjeMin: preostaloMin, radniNalogId: pr.radniNalogId, napomena: pr.napomena, status: "Na čekanju",
          stavkeMaterijala: noveStavke, operaterId: "", pokrenuoId: null, zavrsioId: null, segmentPocetak: null, odradjenoMin: 0, autoPodijeljen: true,
        });
        // nastavak ostaje na mjestu programa koji je podijeljen (odmah iza njega), ne ide na kraj reda
        nova.splice(nova.findIndex((x) => x.id === pr.id) + 1, 0, dodani[dodani.length - 1]);
      }
      promijenjeno = true;
      console.log(`Program rezanja ${pr.brojPrograma} automatski ${preostaloMin > 0 ? "podijeljen" : "zatvoren"} nakon odjave operatera ${operaterId} (${odlazakISO}).`);
    }
    if (promijenjeno) {
      await client.query(
        `INSERT INTO app_data (key, value, updated_at) VALUES ('programiRezanja', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(nova)]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod automatske podjele programa rezanja:", e);
  } finally {
    client.release();
    podjelaProgramaUTijeku = false;
  }
}

// Tablica aktivnosti: jedan redak po korisniku i danu (minute aktivnosti, broj izmjena, minute po modulu i uređaju). Zaključana za
// Supabase Data API (RLS uključen, bez dozvola za anon/authenticated); čita se samo preko poslužitelja. Podaci se čuvaju 3 mjeseca.
async function pripremiAktivnost() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS aktivnost_dan (
      zaposlenik_id text NOT NULL, dan date NOT NULL, minuta integer NOT NULL DEFAULT 0, izmjene integer NOT NULL DEFAULT 0,
      moduli jsonb NOT NULL DEFAULT '{}', uredaj jsonb NOT NULL DEFAULT '{}', izmjene_kljucevi jsonb NOT NULL DEFAULT '{}',
      zadnja timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (zaposlenik_id, dan))`);
    await pool.query("ALTER TABLE aktivnost_dan ENABLE ROW LEVEL SECURITY");
    await pool.query("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON aktivnost_dan FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON aktivnost_dan FROM authenticated; END IF; END $$");
    await pool.query("DELETE FROM aktivnost_dan WHERE dan < (current_date - interval '3 months')");
  } catch (e) {
    console.error("Greška kod pripreme tablice aktivnosti:", e);
  }
}

// Tablica povijesti korekcija (vidi PRACENA_POLJA_ZAPOSLENIKA): zaključana za Supabase Data API kao i aktivnost_dan, zapisi se ne brišu.
async function pripremiKorekcije() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS korekcije_bodova (
      id bigserial PRIMARY KEY, vrijeme timestamptz NOT NULL DEFAULT now(),
      zaposlenik_id text, zaposlenik text NOT NULL DEFAULT '', polje text NOT NULL, naziv text NOT NULL, tip text NOT NULL DEFAULT 'tekst',
      staro text NOT NULL DEFAULT '', novo text NOT NULL DEFAULT '', korisnik_id text, korisnik text NOT NULL DEFAULT '', razlog text)`);
    await pool.query("CREATE INDEX IF NOT EXISTS idx_korekcije_bodova_vrijeme ON korekcije_bodova (vrijeme DESC)");
    await pool.query("ALTER TABLE korekcije_bodova ENABLE ROW LEVEL SECURITY");
    await pool.query("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON korekcije_bodova FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON korekcije_bodova FROM authenticated; END IF; END $$");
  } catch (e) {
    console.error("Greška kod pripreme tablice korekcija:", e);
  }
}

// Jednokratna (idempotentna) migracija: kartice Evidencija rada i Sati po nalozima prešle su iz modula Zaposlenici u novi modul
// Evidencija sati. Svaka pozicija koja ima modul Zaposlenici dobije i novi modul, a postavke tih kartica (pristup, izmjene,
// ograničenje po grupama) kopiraju se, pa nitko ne gubi ni dobiva pristup. Ako pozicija nema pristup ni jednoj od dvije kartice,
// modul joj se ne dodaje. Pozicije koje već imaju novi modul se ne diraju.
async function migrirajEvidencijaSati() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'pozicijeZaposlenika' FOR UPDATE");
    const pozicije = r.rows[0]?.value;
    if (!Array.isArray(pozicije)) { await client.query("ROLLBACK"); return; }
    let promijenjeno = 0;
    const nove = pozicije.map((p) => {
      const moduli = Array.isArray(p.moduli) ? p.moduli : [];
      if (!moduli.includes("zaposlenici") || moduli.includes("evidencijasati")) return p;
      const staro = p.karticeDozvole?.zaposlenici || {};
      const imaPristup = (k) => staro[k]?.pristup !== false;
      if (!imaPristup("evidencija") && !imaPristup("satinalozi")) return p;
      const kopija = {};
      ["evidencija", "satinalozi"].forEach((k) => { if (staro[k]) kopija[k] = staro[k]; });
      promijenjeno++;
      return { ...p, moduli: [...moduli, "evidencijasati"], karticeDozvole: { ...(p.karticeDozvole || {}), ...(Object.keys(kopija).length ? { evidencijasati: kopija } : {}) } };
    });
    if (promijenjeno > 0) {
      await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'pozicijeZaposlenika'", [JSON.stringify(nove)]);
      console.log(`Migracija: modul Evidencija sati dodan na ${promijenjeno} pozicija.`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Greška kod migracije modula Evidencija sati:", e);
  } finally {
    client.release();
  }
}

// Zajednički error handler: greške iz ruta (vidi omotač async ruta gore) i neispravan JSON u tijelu zahtjeva vraćaju se kao JSON,
// a poslužitelj ostaje živ.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err?.status || err?.statusCode);
  if (status >= 400 && status < 500) return res.status(status).json({ error: status === 413 ? "Zahtjev je prevelik." : "Neispravan zahtjev." });
  console.error("Greška u ruti:", req.method, req.path, err);
  res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
});
// Zadnja zaštita za pozadinske zadatke izvan ruta (satni poslovi): zabilježi i nastavi, ne ruši proces.
process.on("unhandledRejection", (e) => console.error("Neuhvaćeno odbijeno obećanje:", e));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ERP backend sluša na portu ${PORT}`);
  migrirajEvidencijaSati();
  pripremiKorekcije();
  pripremiAktivnost();
  setInterval(pripremiAktivnost, 6 * 60 * 60 * 1000);
  provjeriAutoOdjavu();
  setInterval(provjeriAutoOdjavu, 15 * 60 * 1000);
  podijeliZaboravljeneProgrameRezanja();
  setInterval(podijeliZaboravljeneProgrameRezanja, 15 * 60 * 1000);
});

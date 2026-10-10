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
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

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
  "satiPoNalogu", "izdatnice", "cmr", "slobodniZadaci", "planProizvodnje", "nedovrsenaProizvodnja", "rezervacije", "maticnaKnjiga", "upitiTransporta", "narudzbeTransporta",
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
    fakture: { citanje: ["fakture", "kupci", "projekti"], pisanje: ["fakture"] },
    podloge: { citanje: ["podlogeZaFakturu", "projekti", "materijali", "otpremnice", "narudzbe", "kupci"], pisanje: ["podlogeZaFakturu", "otpremnice"] },
    nedovrsena: { citanje: ["nedovrsenaProizvodnja", "projekti", "radniNalozi", "satiPoNalogu", "izdatnice", "materijali", "otpremnice", "narudzbe", "kupci", "dobavljaci", "narudzbeTransporta"], pisanje: ["nedovrsenaProizvodnja"] },
    analiza: { citanje: ["projekti", "radniNalozi", "ponude", "izdatnice", "materijali", "kupci", "cjenikRada", "katalogProfila", "kvaliteteMaterijala"], pisanje: [] },
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
  zaposlenici: {
    zaposlenici: { citanje: ["zaposlenici"], pisanje: ["zaposlenici"] },
    pozicije: { citanje: ["pozicijeZaposlenika"], pisanje: ["pozicijeZaposlenika"] },
    evidencija: { citanje: ["evidencijaRada", "postavkePlaca", "praznici"], pisanje: ["evidencijaRada"] },
    obracun: { citanje: ["evidencijaRada", "postavkePlaca", "praznici", "zaposlenici", "doplaciPlaca", "postavkeTvrtke"], pisanje: ["postavkePlaca", "praznici", "doplaciPlaca"] },
    satinalozi: { citanje: ["evidencijaRada", "postavkePlaca", "radniNalozi", "zaposlenici", "satiPoNalogu"], pisanje: ["satiPoNalogu", "radniNalozi"] },
  },
};

// Ključevi koje App.jsx čita na najvišoj razini (zaglavlje, navigacija, prijava) —
// potrebni SVAKOM prijavljenom zaposleniku bez obzira na modul, inače se aplikacija
// uopće ne može ispravno prikazati (ime tvrtke, vlastita pozicija/navigacija).
// Zadatke svih zaposlenika (slobodniZadaci) vide samo ove pozicije; ostali dobivaju samo zadatke
// koji su njima dodijeljeni ili koje su sami dodali.
const POZICIJE_SVI_ZADACI = ["poz-direktor", "poz-administrator"];
const filtrirajSlobodneZadatke = (zadaci, pozicija, zaposlenikId) => (Array.isArray(zadaci) && !POZICIJE_SVI_ZADACI.includes(pozicija?.id)
  ? zadaci.filter((z) => z.dodijeljenoId === zaposlenikId || z.kreiraoId === zaposlenikId)
  : zadaci);

const UVIJEK_CITLJIVO = ["zaposlenici", "pozicijeZaposlenika", "postavkeTvrtke"];

// Ključevi čija je vrijednost objekt (ne niz) — koristi se za ispravan "prazan" placeholder.
const OBJEKT_KLJUCEVI = new Set(["cjenikRada", "postavkeTvrtke", "normativi", "postavkePlaca", "planProizvodnje", "nedovrsenaProizvodnja"]);

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
async function spremiRadneNaloge(dolazni) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key = 'radniNalozi' FOR UPDATE");
    const rezultat = zadrziNoveOznakeNaloga(dolazni, r.rows[0]?.value || []);
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
    req.zaposlenikId = jwt.verify(token, JWT_SECRET).zaposlenikId;
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

// ---------- Popis zaposlenika za login ekran (bez PIN-a/pinHash-a, ne treba token — koristi se za padajući izbornik prije prijave) ----------
app.get("/api/auth/zaposlenici", async (req, res) => {
  const zaposlenici = (await ucitajKljuc("zaposlenici")) || [];
  const lista = zaposlenici
    .filter((z) => z.status === "Aktivan")
    .map((z) => ({ id: z.id, ime: z.ime, prezime: z.prezime, pozicijaId: z.pozicijaId }))
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
  const { zaposlenikId } = req.body;
  const lozinka = req.body.lozinka ?? req.body.pin;
  const zaposlenici = (await ucitajKljuc("zaposlenici")) || [];
  const zaposlenik = zaposlenici.find((z) => z.id === zaposlenikId);
  if (!zaposlenik) return res.status(401).json({ error: "Nepoznat zaposlenik." });

  const sada = Date.now();
  const pokusaji = (pokusajiLogina.get(zaposlenikId) || []).filter((t) => sada - t < 5 * 60 * 1000);
  if (pokusaji.length >= 5) return res.status(429).json({ error: "Previše pokušaja. Pokušaj ponovno za 5 minuta." });

  const ispravan = zaposlenik.lozinkaHash ? await bcrypt.compare(lozinka, zaposlenik.lozinkaHash)
    : zaposlenik.pinHash ? await bcrypt.compare(lozinka, zaposlenik.pinHash)
    : lozinka === zaposlenik.pin;
  await pool.query("INSERT INTO login_log (zaposlenik_id, uspjesno) VALUES ($1,$2)", [zaposlenikId, ispravan]);
  if (!ispravan) {
    pokusaji.push(sada);
    pokusajiLogina.set(zaposlenikId, pokusaji);
    return res.status(401).json({ error: "Pogrešna lozinka." });
  }
  pokusajiLogina.delete(zaposlenikId);
  const token = jwt.sign({ zaposlenikId }, JWT_SECRET, { expiresIn: "12h" });
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
  if (!dozvolaZaKarticu(pozicija, "zaposlenici", "zaposlenici").izmjene) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za promjenu lozinki." });

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
  res.json({ ok: true });
});

// ---------- KIOSK prijava dolaska/odlaska (bez potrebe za login/PIN) ----------
const KIOSK_BLOKADA_MIN = 3;
app.post("/api/kiosk/scan", async (req, res) => {
  const kod = (req.body.rfidKod || "").trim().toUpperCase();
  if (!kod) return res.status(404).json({ error: "Kartica nije prepoznata." });
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
      if (!red) return res.status(404).json({ error: "Kartica nije prepoznata." });
      const zaposlenik = red.zaposlenik;
      const moji = red.moji || [];
      const otvorena = moji.find((e) => !e.vrijemeOdlaska);
      const sada = new Date();

      // Blokada slučajnog dvostrukog očitanja kartice — ista osoba ne može ponovno
      // prijaviti dolazak/odlazak unutar KIOSK_BLOKADA_MIN minuta od svoje zadnje akcije.
      const zadnjaAkcija = moji.reduce((naj, e) => {
        const vrijeme = e.vrijemeOdlaska || e.vrijemeDolaska;
        return vrijeme && (!naj || new Date(vrijeme) > new Date(naj)) ? vrijeme : naj;
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
app.get("/api/vrijeme", (req, res) => res.json({ sada: new Date().toISOString(), verzija: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || null }));

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
  const upravitelj = izracunajDozvoljeneKljuceve(pozicija).pisivo.has("projekti");
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
const patchPoIdHandler = (kljuc, brojRegex, naziv, prilagodiUpsert = (upsert) => upsert, sirinaBroja = 0) => async (req, res) => {
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
    const upsert = prilagodiUpsert(poslano, trenutno);
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
app.put("/api/narudzbeTransporta/patch", autentikacija, patchPoIdHandler("narudzbeTransporta", /^(TN-\d{4}-)(\d+)()$/, "narudžbi za transport", (upsert) => upsert, 3));
app.put("/api/rezervacije/patch", autentikacija, patchPoIdHandler("rezervacije", /^(?!)$/, "rezervacija"));
// Matična knjiga: matični broj (od 3700, uzlazno) dodjeljuje isključivo poslužitelj, pod zaključanim popisom —
// preglednik sa zastarjelim popisom inače bi dvaput dobio isti broj. Broj postojećeg zapisa se ne može promijeniti.
const POCETNI_MATICNI_BROJ = 3700;
const dodijeliMaticneBrojeve = (poslano, trenutno) => {
  const postojeci = new Map(trenutno.map((z) => [z.id, z]));
  let iduci = Math.max(POCETNI_MATICNI_BROJ - 1, ...trenutno.map((z) => Number(z.broj) || 0)) + 1;
  return poslano.map((z) => (postojeci.has(z.id) ? { ...z, broj: postojeci.get(z.id).broj } : { ...z, broj: iduci++ }));
};
app.put("/api/maticnaKnjiga/patch", autentikacija, patchPoIdHandler("maticnaKnjiga", /^(?!)$/, "matične knjige", dodijeliMaticneBrojeve));
app.put("/api/radniNalozi/patch", autentikacija, patchPoIdHandler("radniNalozi", /^(.*\/)(\d+)()$/, "radnih naloga", zadrziNoveOznakeNaloga));

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
  const { citljivo } = izracunajDozvoljeneKljuceve(pozicija);

  const r = await pool.query("SELECT key, value FROM app_data");
  const stvarno = {};
  r.rows.forEach((row) => { stvarno[row.key] = row.value; });

  const rezultat = {};
  DOZVOLJENI_KLJUCEVI.forEach((key) => {
    rezultat[key] = citljivo.has(key) ? (stvarno[key] ?? (OBJEKT_KLJUCEVI.has(key) ? {} : [])) : (OBJEKT_KLJUCEVI.has(key) ? {} : []);
  });
  rezultat.slobodniZadaci = filtrirajSlobodneZadatke(rezultat.slobodniZadaci, pozicija, req.zaposlenikId);
  res.json(rezultat);
});

app.get("/api/data/:key", autentikacija, async (req, res) => {
  const key = req.params.key;
  if (!DOZVOLJENI_KLJUCEVI.includes(key)) return res.status(400).json({ error: "Nepoznat ključ." });
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { citljivo } = izracunajDozvoljeneKljuceve(pozicija);
  if (!citljivo.has(key)) return res.status(403).json({ error: "Vaša pozicija nema pristup ovim podacima." });
  const vrijednost = await ucitajKljuc(key);
  res.json(key === "slobodniZadaci" ? filtrirajSlobodneZadatke(vrijednost, pozicija, req.zaposlenikId) : vrijednost);
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
  await spremiKljuc(req.params.key, req.body);
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
        nova = [...nova, dodani[dodani.length - 1]];
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ERP backend sluša na portu ${PORT}`);
  provjeriAutoOdjavu();
  setInterval(provjeriAutoOdjavu, 15 * 60 * 1000);
  podijeliZaboravljeneProgrameRezanja();
  setInterval(podijeliZaboravljeneProgrameRezanja, 15 * 60 * 1000);
});

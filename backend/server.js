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

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error("JWT_SECRET nije postavljen u .env — vidi .env.example"); process.exit(1); }

const DOZVOLJENI_KLJUCEVI = [
  "kupci", "dobavljaci", "materijali", "projekti", "narudzbenice", "ponude",
  "radniNalozi", "fakture", "cjenikRada", "katalogProfila", "pozicijeZaposlenika",
  "zaposlenici", "standardniZadaci", "programiRezanja", "kapacitetiDana",
  "postavkeTvrtke", "upitiNabave", "radniCentri", "evidencijaRada",
  "narudzbe", "otpremnice", "podlogeZaFakturu", "normativi",
  "postavkePlaca", "praznici", "kvaliteteMaterijala", "ponudeLasera",
];

// Svaki modul (isti "moduli" popis kao u pozicijeZaposlenika) dijeli se na kartice — iste
// kartice/tabove koje App.jsx prikazuje unutar tog modula. Za svaku karticu je popisano koje
// ključeve ta kartica čita i koje smije mijenjati. Pozicija po zadanom ima puni pristup (čitanje
// i izmjene) svakoj kartici modula koji joj je dodijeljen — vidi dozvolaZaKarticu() — a admin to
// može suziti po poziciji preko pozicija.karticeDozvole (postavljeno kroz "Pozicije" ekran).
const KARTICE_MODULA = {
  dashboard: {
    pregled: { citanje: ["cjenikRada", "fakture", "materijali", "ponude", "projekti", "radniNalozi"], pisanje: [] },
  },
  skladiste: {
    zalihe: { citanje: ["materijali", "katalogProfila", "kvaliteteMaterijala"], pisanje: ["materijali"] },
    katalog: { citanje: ["katalogProfila"], pisanje: ["katalogProfila"] },
    kvaliteta: { citanje: ["kvaliteteMaterijala"], pisanje: ["kvaliteteMaterijala"] },
  },
  nabava: {
    narudzbenice: { citanje: ["narudzbenice", "dobavljaci", "katalogProfila", "materijali"], pisanje: ["narudzbenice", "materijali"] },
    upiti: { citanje: ["upitiNabave", "dobavljaci", "materijali"], pisanje: ["upitiNabave", "narudzbenice", "materijali"] },
    postavke: { citanje: ["postavkeTvrtke"], pisanje: ["postavkeTvrtke"] },
  },
  proizvodnja: {
    tablica: { citanje: ["radniNalozi", "projekti", "materijali", "katalogProfila", "narudzbenice"], pisanje: ["radniNalozi", "materijali"] },
    gantogram: { citanje: ["radniNalozi", "radniCentri", "kapacitetiDana", "projekti", "zaposlenici"], pisanje: ["radniNalozi", "radniCentri", "kapacitetiDana"] },
    rezanje: { citanje: ["programiRezanja", "katalogProfila", "materijali", "radniNalozi", "zaposlenici"], pisanje: ["programiRezanja", "kapacitetiDana", "materijali"] },
    isporuke: { citanje: ["projekti"], pisanje: ["projekti"] },
  },
  projekti: {
    projekti: { citanje: ["cjenikRada", "katalogProfila", "kupci", "materijali", "projekti", "radniNalozi", "standardniZadaci", "narudzbe", "otpremnice", "normativi", "zaposlenici", "upitiNabave", "kvaliteteMaterijala", "narudzbenice"], pisanje: ["projekti", "standardniZadaci", "narudzbe", "otpremnice", "normativi", "materijali", "radniNalozi", "upitiNabave"] },
    ponude: { citanje: ["cjenikRada", "katalogProfila", "materijali", "ponude", "kupci", "kvaliteteMaterijala", "narudzbenice"], pisanje: ["ponude", "cjenikRada", "materijali", "projekti", "radniNalozi"] },
    laser: { citanje: ["ponudeLasera", "kupci", "kvaliteteMaterijala", "postavkeTvrtke"], pisanje: ["ponudeLasera"] },
  },
  fakturiranje: {
    fakture: { citanje: ["fakture", "kupci", "projekti"], pisanje: ["fakture"] },
    otpremnice: { citanje: ["otpremnice", "projekti", "kupci", "narudzbe"], pisanje: ["otpremnice"] },
    podloge: { citanje: ["podlogeZaFakturu", "projekti", "materijali"], pisanje: ["podlogeZaFakturu"] },
  },
  partneri: {
    kupci: { citanje: ["kupci"], pisanje: ["kupci"] },
    dobavljaci: { citanje: ["dobavljaci"], pisanje: ["dobavljaci"] },
  },
  zaposlenici: {
    zaposlenici: { citanje: ["zaposlenici"], pisanje: ["zaposlenici"] },
    pozicije: { citanje: ["pozicijeZaposlenika"], pisanje: ["pozicijeZaposlenika"] },
    evidencija: { citanje: ["evidencijaRada", "postavkePlaca", "praznici"], pisanje: ["evidencijaRada"] },
    obracun: { citanje: ["evidencijaRada", "postavkePlaca", "praznici", "zaposlenici"], pisanje: ["postavkePlaca", "praznici"] },
  },
};

// Ključevi koje App.jsx čita na najvišoj razini (zaglavlje, navigacija, prijava) —
// potrebni SVAKOM prijavljenom zaposleniku bez obzira na modul, inače se aplikacija
// uopće ne može ispravno prikazati (ime tvrtke, vlastita pozicija/navigacija).
const UVIJEK_CITLJIVO = ["zaposlenici", "pozicijeZaposlenika", "postavkeTvrtke"];

// Ključevi čija je vrijednost objekt (ne niz) — koristi se za ispravan "prazan" placeholder.
const OBJEKT_KLJUCEVI = new Set(["cjenikRada", "postavkeTvrtke", "normativi", "postavkePlaca"]);

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
  const zaposlenici = (await ucitajKljuc("zaposlenici")) || [];
  const zaposlenik = zaposlenici.find((z) => (z.rfidKod || "").toUpperCase() === kod);
  if (!zaposlenik) return res.status(404).json({ error: "Kartica nije prepoznata." });

  const evidencija = (await ucitajKljuc("evidencijaRada")) || [];
  const moji = evidencija.filter((e) => e.zaposlenikId === zaposlenik.id);
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
      const preostaloSek = Math.ceil((KIOSK_BLOKADA_MIN - proteklaMin) * 60);
      return res.status(429).json({ error: `Pričekaj još ${preostaloSek} s prije sljedeće prijave/odjave.`, cooldown: true });
    }
  }

  const sadaISO = sada.toISOString();
  let nova;
  if (otvorena) {
    nova = evidencija.map((e) => (e.id === otvorena.id ? { ...e, vrijemeOdlaska: sadaISO } : e));
    await spremiKljuc("evidencijaRada", nova);
    return res.json({ tip: "odlazak", ime: zaposlenik.ime, prezime: zaposlenik.prezime, vrijeme: sadaISO, dolazak: otvorena.vrijemeDolaska });
  }
  nova = [...evidencija, { id: `evr-${Date.now()}`, zaposlenikId: zaposlenik.id, vrijemeDolaska: sadaISO, vrijemeOdlaska: null, vrsta: "rad", autoOdjava: false, potvrdenoRacunovodstvo: false, unioRucnoId: null }];
  await spremiKljuc("evidencijaRada", nova);
  res.json({ tip: "dolazak", ime: zaposlenik.ime, prezime: zaposlenik.prezime, vrijeme: sadaISO });
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
  res.json(rezultat);
});

app.get("/api/data/:key", autentikacija, async (req, res) => {
  const key = req.params.key;
  if (!DOZVOLJENI_KLJUCEVI.includes(key)) return res.status(400).json({ error: "Nepoznat ključ." });
  const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
  const { citljivo } = izracunajDozvoljeneKljuceve(pozicija);
  if (!citljivo.has(key)) return res.status(403).json({ error: "Vaša pozicija nema pristup ovim podacima." });
  res.json(await ucitajKljuc(key));
});

app.put("/api/data/:key", autentikacija, async (req, res, next) => {
  if (!DOZVOLJENI_KLJUCEVI.includes(req.params.key)) return res.status(400).json({ error: "Nepoznat ključ." });
  next();
}, autorizacijaPisanja, async (req, res) => {
  await spremiKljuc(req.params.key, req.body);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ERP backend sluša na portu ${PORT}`));

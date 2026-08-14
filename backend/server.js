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
  "narudzbe", "otpremnice", "podlogeZaFakturu",
];

// Koji modul (isti "moduli" popis kao u pozicijeZaposlenika) smije MIJENJATI koji ključ.
// evidencijaRada nema dopušten modul jer je trenutno piše isključivo kiosk endpoint, ne
// korisničko sučelje.
const MODUL_ZA_KLJUC = {
  kupci: ["partneri"],
  dobavljaci: ["partneri"],
  materijali: ["skladiste", "nabava", "proizvodnja", "projekti"],
  projekti: ["projekti"],
  narudzbenice: ["nabava"],
  ponude: ["projekti"],
  radniNalozi: ["proizvodnja", "projekti"],
  fakture: ["fakturiranje"],
  cjenikRada: ["projekti"],
  katalogProfila: ["skladiste"],
  pozicijeZaposlenika: ["zaposlenici"],
  zaposlenici: ["zaposlenici"],
  standardniZadaci: ["projekti"],
  programiRezanja: ["proizvodnja"],
  kapacitetiDana: ["proizvodnja"],
  postavkeTvrtke: ["nabava"],
  upitiNabave: ["nabava"],
  radniCentri: ["proizvodnja"],
  evidencijaRada: [],
  narudzbe: ["projekti"],
  otpremnice: ["projekti"],
  podlogeZaFakturu: ["fakturiranje"],
};

// Ključevi koje App.jsx čita na najvišoj razini (zaglavlje, navigacija, prijava) —
// potrebni SVAKOM prijavljenom zaposleniku bez obzira na modul, inače se aplikacija
// uopće ne može ispravno prikazati (ime tvrtke, vlastita pozicija/navigacija).
const UVIJEK_CITLJIVO = ["zaposlenici", "pozicijeZaposlenika", "postavkeTvrtke"];

// Koje dodatne ključeve pojedini modul čita (uključujući unakrsne reference — npr. ime
// kupca na projektu, materijal na radnom nalogu) — izračunato analizom App.jsx (koje
// db.<ključ> vrijednosti svaka stranica i njeni modali stvarno koriste).
const MODUL_ZA_CITANJE = {
  dashboard: ["cjenikRada", "fakture", "materijali", "ponude", "projekti", "radniNalozi"],
  skladiste: ["katalogProfila", "materijali"],
  nabava: ["dobavljaci", "katalogProfila", "materijali", "narudzbenice", "upitiNabave"],
  proizvodnja: ["kapacitetiDana", "katalogProfila", "materijali", "programiRezanja", "projekti", "radniCentri", "radniNalozi"],
  projekti: ["cjenikRada", "katalogProfila", "kupci", "materijali", "ponude", "projekti", "radniNalozi", "standardniZadaci", "narudzbe", "otpremnice"],
  fakturiranje: ["fakture", "kupci", "materijali", "projekti", "narudzbe", "otpremnice", "podlogeZaFakturu"],
  partneri: ["kupci", "dobavljaci"],
  zaposlenici: ["evidencijaRada"],
};

// Ključevi čija je vrijednost objekt (ne niz) — koristi se za ispravan "prazan" placeholder.
const OBJEKT_KLJUCEVI = new Set(["cjenikRada", "postavkeTvrtke"]);

async function mojiModuli(zaposlenikId) {
  const [zaposlenici, pozicije] = await Promise.all([ucitajKljuc("zaposlenici"), ucitajKljuc("pozicijeZaposlenika")]);
  const zaposlenik = (zaposlenici || []).find((z) => z.id === zaposlenikId);
  const pozicija = (pozicije || []).find((p) => p.id === zaposlenik?.pozicijaId);
  return pozicija?.moduli?.length ? pozicija.moduli : ["dashboard"];
}

function citljiviKljucevi(moduli) {
  const set = new Set(UVIJEK_CITLJIVO);
  moduli.forEach((m) => (MODUL_ZA_CITANJE[m] || []).forEach((k) => set.add(k)));
  return set;
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

// Provjerava smije li prijavljeni zaposlenik MIJENJATI zadani ključ, prema modulima
// njegove pozicije (ista logika kao "dopusteniKljucevi" u frontendu, App.jsx).
async function autorizacijaPisanja(req, res, next) {
  const key = req.params.key;
  const dopusteniModuli = MODUL_ZA_KLJUC[key] || [];
  if (dopusteniModuli.length === 0) return res.status(403).json({ error: "Ovaj ključ nije moguće mijenjati preko API-ja." });

  const moduli = await mojiModuli(req.zaposlenikId);
  if (!dopusteniModuli.some((m) => moduli.includes(m))) {
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

// ---------- LOGIN (zamjenjuje PIN-provjeru koja je bila u frontend kodu) ----------
// NAPOMENA: 4-znamenkasti PIN je slab (10.000 kombinacija) čak i hashiran —
// donji rate-limit je minimalna zaštita. Za pravu produkciju razmisli o
// pravoj lozinci (min. 8 znakova) ili duljem PIN-u + 2FA za osjetljivije uloge.
const pokusajiLogina = new Map(); // zaposlenikId -> [timestamps]
app.post("/api/auth/login", async (req, res) => {
  const { zaposlenikId, pin } = req.body;
  const zaposlenici = (await ucitajKljuc("zaposlenici")) || [];
  const zaposlenik = zaposlenici.find((z) => z.id === zaposlenikId);
  if (!zaposlenik) return res.status(401).json({ error: "Nepoznat zaposlenik." });

  const sada = Date.now();
  const pokusaji = (pokusajiLogina.get(zaposlenikId) || []).filter((t) => sada - t < 5 * 60 * 1000);
  if (pokusaji.length >= 5) return res.status(429).json({ error: "Previše pokušaja. Pokušaj ponovno za 5 minuta." });

  const ispravan = zaposlenik.pinHash ? await bcrypt.compare(pin, zaposlenik.pinHash) : pin === zaposlenik.pin; // podržava i stare, još nehashirane zapise
  await pool.query("INSERT INTO login_log (zaposlenik_id, uspjesno) VALUES ($1,$2)", [zaposlenikId, ispravan]);
  if (!ispravan) {
    pokusaji.push(sada);
    pokusajiLogina.set(zaposlenikId, pokusaji);
    return res.status(401).json({ error: "Pogrešan PIN." });
  }
  pokusajiLogina.delete(zaposlenikId);
  const token = jwt.sign({ zaposlenikId }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, zaposlenik: { id: zaposlenik.id, ime: zaposlenik.ime, prezime: zaposlenik.prezime, pozicijaId: zaposlenik.pozicijaId } });
});

// ---------- KIOSK prijava dolaska/odlaska (bez potrebe za login/PIN) ----------
app.post("/api/kiosk/scan", async (req, res) => {
  const kod = (req.body.rfidKod || "").trim().toUpperCase();
  const zaposlenici = (await ucitajKljuc("zaposlenici")) || [];
  const zaposlenik = zaposlenici.find((z) => (z.rfidKod || "").toUpperCase() === kod);
  if (!zaposlenik) return res.status(404).json({ error: "Kartica nije prepoznata." });

  const evidencija = (await ucitajKljuc("evidencijaRada")) || [];
  const otvorena = evidencija.find((e) => e.zaposlenikId === zaposlenik.id && !e.vrijemeOdlaska);
  const sada = new Date().toISOString();
  let nova;
  if (otvorena) {
    nova = evidencija.map((e) => (e.id === otvorena.id ? { ...e, vrijemeOdlaska: sada } : e));
    await spremiKljuc("evidencijaRada", nova);
    return res.json({ tip: "odlazak", ime: zaposlenik.ime, prezime: zaposlenik.prezime, vrijeme: sada, dolazak: otvorena.vrijemeDolaska });
  }
  nova = [...evidencija, { id: `evr-${Date.now()}`, zaposlenikId: zaposlenik.id, vrijemeDolaska: sada, vrijemeOdlaska: null }];
  await spremiKljuc("evidencijaRada", nova);
  res.json({ tip: "dolazak", ime: zaposlenik.ime, prezime: zaposlenik.prezime, vrijeme: sada });
});

// ---------- podaci (sve zaštićeno loginom) ----------
// Vraća SVE ključeve odjednom — koristi se pri pokretanju aplikacije. Ključevi izvan
// zaposlenikovih dopuštenih modula vraćaju se kao prazan placeholder (a ne izostavljeni)
// da frontend ne padne na db.<kljuc>.find/.filter — vidi citljiviKljucevi().
app.get("/api/data", autentikacija, async (req, res) => {
  const moduli = await mojiModuli(req.zaposlenikId);
  const citljivo = citljiviKljucevi(moduli);

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
  const moduli = await mojiModuli(req.zaposlenikId);
  if (!citljiviKljucevi(moduli).has(key)) return res.status(403).json({ error: "Vaša pozicija nema pristup ovim podacima." });
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

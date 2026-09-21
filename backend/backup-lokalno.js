// Automatski satni backup cijele baze na lokalni disk — pokreće ga Windows Task Scheduler.
// Isključivo ČITA iz baze (nikad ne piše), sprema jednu JSON datoteku po pokretanju u istom
// formatu koji aplikacija sama koristi za svoj "Backup" gumb (Zaposlenici → ... → Backup), pa se
// po potrebi može vratiti natrag kroz tu istu opciju u aplikaciji.
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const MAPA_BACKUPA = "C:\\Users\\Econ\\Desktop\\ERP _ECON\\ERP-Backupovi";
const DANA_CUVATI = 30;

// Isti popis ključeva kao STORAGE_KEYS u frontend/src/App.jsx — ručno održavano jer skripta ne
// uvozi frontend kod. Ako se u aplikaciji doda novi ključ, treba ga dodati i ovdje.
const KLJUCEVI = [
  "kupci", "dobavljaci", "materijali", "projekti", "narudzbenice", "ponude",
  "radniNalozi", "fakture", "cjenikRada", "katalogProfila", "pozicijeZaposlenika",
  "zaposlenici", "standardniZadaci", "programiRezanja", "kapacitetiDana",
  "postavkeTvrtke", "upitiNabave", "radniCentri", "evidencijaRada",
  "narudzbe", "otpremnice", "podlogeZaFakturu", "normativi",
  "postavkePlaca", "praznici", "kvaliteteMaterijala", "ponudeLasera", "doplaciPlaca",
  "satiPoNalogu", "izdatnice",
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

const nazivDatoteke = (datum) => {
  const p2 = (n) => String(n).padStart(2, "0");
  return `backup-${datum.getFullYear()}-${p2(datum.getMonth() + 1)}-${p2(datum.getDate())}_${p2(datum.getHours())}${p2(datum.getMinutes())}.json`;
};

const obrisiStareBackupove = () => {
  const granica = Date.now() - DANA_CUVATI * 24 * 3600 * 1000;
  const datoteke = fs.readdirSync(MAPA_BACKUPA).filter((f) => f.startsWith("backup-") && f.endsWith(".json"));
  let obrisano = 0;
  datoteke.forEach((f) => {
    const puniPut = path.join(MAPA_BACKUPA, f);
    if (fs.statSync(puniPut).mtimeMs < granica) { fs.unlinkSync(puniPut); obrisano++; }
  });
  return obrisano;
};

(async () => {
  fs.mkdirSync(MAPA_BACKUPA, { recursive: true });

  const r = await pool.query("SELECT key, value FROM app_data");
  const stvarno = Object.fromEntries(r.rows.map((row) => [row.key, row.value]));
  const podaci = Object.fromEntries(KLJUCEVI.map((k) => [k, stvarno[k] ?? []]));
  const paket = { __erp_backup: true, verzija: 1, datum: new Date().toISOString(), podaci };

  const datum = new Date();
  const odrediste = path.join(MAPA_BACKUPA, nazivDatoteke(datum));
  fs.writeFileSync(odrediste, JSON.stringify(paket, null, 2), "utf8");

  const obrisano = obrisiStareBackupove();
  console.log(`[${datum.toISOString()}] Backup spremljen: ${odrediste} (${(fs.statSync(odrediste).size / 1024).toFixed(1)} KB)${obrisano ? ` — obrisano ${obrisano} starih backupova (>${DANA_CUVATI} dana)` : ""}`);

  await pool.end();
})().catch((e) => { console.error("Greška kod izrade backupa:", e); process.exit(1); });

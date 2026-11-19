// Automatski satni backup cijele baze na lokalni disk — pokreće ga Windows Task Scheduler.
// Isključivo ČITA iz baze (nikad ne piše), sprema jednu JSON datoteku po pokretanju u istom
// formatu koji aplikacija sama koristi za svoj "Backup" gumb (Zaposlenici → ... → Backup), pa se
// po potrebi može vratiti natrag kroz tu istu opciju u aplikaciji.
//
// SPREMA SVE: ključeve iz app_data uzima SAMA iz baze (nema ručno održavanog popisa, pa novi ključ
// ulazi u kopiju već pri sljedećem pokretanju), a uz njih i tablice izvan app_data (popis TABLICE iz
// backup-sef.js: korekcije_bodova, aktivnost_dan, login_log) u polju "tablice". Aplikacijski gumb
// "Uvoz" čita samo polje "podaci", pa dodatna polja ne smetaju; tablice se vraćaju skriptom
// vrati-backup.js iz šifrirane (.sef) kopije.
// Nakon upisa datoteka se odmah pročita i provjeri; neispravna se briše i skripta javlja grešku.
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { TABLICE, procitajTablicu } = require("./backup-sef"); // jedini popis tablica izvan app_data (fiksan, nikad iz vanjskog unosa)

const MAPA_BACKUPA = "C:\\Users\\Econ\\Desktop\\ERP _ECON\\ERP-Backupovi";
const DANA_CUVATI = 30;

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

// pool: objekt s query() (pg Pool). Vraća sažetak napravljene kopije. Baca grešku ako kopija nije ispravna.
async function napraviKopiju({ pool, mapa = MAPA_BACKUPA, sada = new Date() }) {
  fs.mkdirSync(mapa, { recursive: true });

  const r = await pool.query("SELECT key, value FROM app_data ORDER BY key");
  if (!r.rows.length) throw new Error("app_data je prazna — kopija bez podataka se ne sprema (provjeri DATABASE_URL).");
  const podaci = Object.fromEntries(r.rows.map((row) => [row.key, row.value]));

  // Tablice kao JSON koji sastavlja sama baza (json_agg/row_to_json), isto kao u backup-sef.js: datumi i brojevi ostaju točni.
  const tablice = {};
  for (const t of TABLICE) tablice[t] = await procitajTablicu(pool, t);

  const paket = { __erp_backup: true, verzija: 1, datum: sada.toISOString(), podaci, tablice };
  const odrediste = path.join(mapa, nazivDatoteke(sada));
  fs.writeFileSync(odrediste, JSON.stringify(paket, null, 2), "utf8");

  // Provjera odmah nakon upisa: datoteka se mora pročitati i imati iste ključeve i iste brojeve redaka kao što smo upisali.
  try {
    const provjera = JSON.parse(fs.readFileSync(odrediste, "utf8"));
    if (Object.keys(provjera.podaci).length !== Object.keys(podaci).length) throw new Error("broj ključeva u kopiji se ne poklapa");
    for (const t of TABLICE) if (provjera.tablice[t].length !== tablice[t].length) throw new Error(`broj redaka tablice ${t} se ne poklapa`);
  } catch (e) {
    fs.unlinkSync(odrediste);
    throw new Error(`Kopija je odmah nakon upisa provjerena i NIJE ispravna (obrisana): ${e.message}`);
  }

  return { odrediste, kljuceva: Object.keys(podaci).length, tablice: Object.fromEntries(TABLICE.map((t) => [t, tablice[t].length])), velicinaKB: fs.statSync(odrediste).size / 1024 };
}

module.exports = { napraviKopiju, nazivDatoteke };

if (require.main === module) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  (async () => {
    const sada = new Date();
    const s = await napraviKopiju({ pool, sada });
    const obrisano = obrisiStareBackupove();
    console.log(`[${sada.toISOString()}] Backup spremljen: ${s.odrediste} (${s.velicinaKB.toFixed(1)} KB, ${s.kljuceva} ključeva + tablice ${Object.entries(s.tablice).map(([t, n]) => `${t}: ${n}`).join(", ")})${obrisano ? ` — obrisano ${obrisano} starih backupova (>${DANA_CUVATI} dana)` : ""}`);
  })()
    .catch((e) => { console.error("Greška kod izrade backupa:", e.message || e); process.exitCode = 1; })
    .finally(() => pool.end().catch(() => {}));
}

// Jednokratna ugradnja ključa "statistikaIsporuka" (Otpremnice i CMR → Statistika isporuka: zaključani mjeseci poslani DZS-u i ručno uneseni mjeseci) u CHECK ogradu
// na app_data.key. Već dopušteni ključevi čitaju se iz same ograde u bazi (ne iz popisa u ovoj skripti), pa se nijedan ne može izgubiti. Ne dira nikakve podatke.
// `node add-statistika-isporuka-key.js --probno` samo ispiše što bi se promijenilo.
require("dotenv").config();
const { Pool } = require("pg");

const NOVI = ["statistikaIsporuka"];
const probno = process.argv.includes("--probno");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

const dohvatiKljuceve = async () => {
  const r = await pool.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'app_data_key_check' AND conrelid = 'app_data'::regclass");
  if (!r.rows[0]) throw new Error("Ograda app_data_key_check ne postoji — ništa se ne mijenja.");
  return [...r.rows[0].def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

(async () => {
  const postojeci = await dohvatiKljuceve();
  const dodaje = NOVI.filter((k) => !postojeci.includes(k));
  console.log(`Ograda sada dopušta ${postojeci.length} ključeva. Dodaje se: ${dodaje.length ? dodaje.join(", ") : "ništa (već su dopušteni)"}.`);
  if (!dodaje.length || probno) { if (probno) console.log("Probni način: ništa nije promijenjeno."); await pool.end(); return; }
  const svi = [...postojeci, ...dodaje];
  await pool.query(`
    ALTER TABLE app_data DROP CONSTRAINT app_data_key_check;
    ALTER TABLE app_data ADD CONSTRAINT app_data_key_check CHECK (key IN (${svi.map((k) => `'${k}'`).join(",")}));
  `);
  const poslije = await dohvatiKljuceve();
  const nedostaje = svi.filter((k) => !poslije.includes(k));
  if (nedostaje.length) throw new Error(`Nakon izmjene nedostaju ključevi: ${nedostaje.join(", ")}`);
  console.log(`CHECK ograda proširena: sada dopušta ${poslije.length} ključeva (dodano ${dodaje.length}).`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

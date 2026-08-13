// Uvozi podatke iz JSON backupa (isti fajl koji dobiješ klikom na "Backup" -> "Preuzmi backup" u aplikaciji)
// Upotreba:  node seed.js putanja/do/backup-erp-2026-08-03.json
require("dotenv").config();
const fs = require("fs");
const { Pool } = require("pg");

const putanja = process.argv[2];
if (!putanja) {
  console.error("Upotreba: node seed.js putanja/do/backup-erp-DATUM.json");
  process.exit(1);
}

const sirovo = JSON.parse(fs.readFileSync(putanja, "utf8"));
const podaci = sirovo.podaci || sirovo; // podržava i backup-format i goli objekt s ključevima

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined });

(async () => {
  const kljucevi = Object.keys(podaci);
  for (const kljuc of kljucevi) {
    await pool.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [kljuc, JSON.stringify(podaci[kljuc])]
    );
    console.log(`✓ ${kljuc} (${Array.isArray(podaci[kljuc]) ? podaci[kljuc].length + " zapisa" : "objekt"})`);
  }
  console.log("Gotovo — svi podaci iz backupa su u bazi.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

// Jednokratna migracija: hashira sve plain-text PIN-ove zaposlenika (polje "pin") u bcrypt "pinHash" i briše "pin".
// Sigurno je pokrenuti više puta — zaposlenike koji već imaju pinHash preskače.
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

(async () => {
  const r = await pool.query("SELECT value FROM app_data WHERE key = 'zaposlenici'");
  const zaposlenici = r.rows[0]?.value || [];
  let izmijenjeno = 0;
  const novi = zaposlenici.map((z) => {
    if (z.pinHash || !z.pin) return z;
    izmijenjeno++;
    const { pin, ...ostalo } = z;
    return { ...ostalo, pinHash: bcrypt.hashSync(pin, 10) };
  });
  await pool.query(
    `UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'zaposlenici'`,
    [JSON.stringify(novi)]
  );
  console.log(`Hashirano ${izmijenjeno} od ${zaposlenici.length} zaposlenika.`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

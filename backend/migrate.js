// Pokreće schema.sql na bazi iz DATABASE_URL. Alternativa za psql (koji ne mora biti instaliran).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Shema uspješno primijenjena.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

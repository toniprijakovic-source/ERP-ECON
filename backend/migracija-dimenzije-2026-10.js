// Jednokratno: iz teksta "dimenzije" materijala uklanja zapisanu kvalitetu (npr. "6000 mm, S235JR" → "6000 mm"),
// jer se kvaliteta vodi u vlastitom polju i dio je šifre. Bez argumenta samo ispisuje; "provedi" sprema.
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SUFIKS = /,\s*(S\d{3}\w*|Poc lim \w+|1\.\d{4}|EN AW-\d+|DX51\S*)\s*$/i;
(async () => {
  const provedi = process.argv[2] === "provedi";
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const m = (await c.query("SELECT value FROM app_data WHERE key='materijali' FOR UPDATE")).rows[0].value;
    let n = 0;
    const novo = m.map((x) => {
      const d = String(x.dimenzije || "");
      const cisto = d.replace(SUFIKS, "");
      if (cisto === d) return x;
      n++;
      console.log(`${x.sifra}  "${d}" → "${cisto}"`);
      return { ...x, dimenzije: cisto };
    });
    console.log(`\npromijenjeno ${n} od ${m.length}`);
    if (provedi) { await c.query("UPDATE app_data SET value=$1, updated_at=now() WHERE key='materijali'", [JSON.stringify(novo)]); await c.query("COMMIT"); console.log("spremljeno"); }
    else { await c.query("ROLLBACK"); console.log("(samo pregled)"); }
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("GREŠKA:", e.message); } finally { c.release(); await pool.end(); }
})();

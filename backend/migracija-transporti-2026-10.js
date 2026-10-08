// Jednokratno: pozicije Glavni administrator, Administrator, Voditelj projekta i Tehnolog dobivaju modul "transporti".
// Prethodno treba pokrenuti add-transporti-keys.js. Bez argumenta samo ispisuje; "provedi" sprema (uz snimku pozicija iznad repozitorija).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const POZICIJE = ["poz-administrator", "poz-mu5z57ev-s8qf", "poz-voditelj-projekta", "poz-tehnolog"];

(async () => {
  const provedi = process.argv[2] === "provedi";
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const pozicije = (await c.query("SELECT value FROM app_data WHERE key='pozicijeZaposlenika' FOR UPDATE")).rows[0].value;
    const nove = pozicije.map((p) => {
      if (!POZICIJE.includes(p.id) || (p.moduli || []).includes("transporti")) return p;
      console.log(`pozicija "${p.naziv}": dodan modul transporti`);
      return { ...p, moduli: [...(p.moduli || []), "transporti"] };
    });
    POZICIJE.forEach((id) => { if (!pozicije.some((p) => p.id === id)) console.log(`UPOZORENJE: pozicija ${id} ne postoji`); });
    if (provedi) {
      fs.writeFileSync(path.join(__dirname, "..", "..", "transporti-prije-migracije.json"), JSON.stringify(pozicije));
      await c.query("UPDATE app_data SET value=$1, updated_at=now() WHERE key='pozicijeZaposlenika'", [JSON.stringify(nove)]);
      await c.query("COMMIT");
      console.log("spremljeno");
    } else { await c.query("ROLLBACK"); console.log("(samo pregled)"); }
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("GREŠKA:", e.message); } finally { c.release(); await pool.end(); }
})();

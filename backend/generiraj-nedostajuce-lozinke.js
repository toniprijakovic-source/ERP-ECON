// Generira novu 8-znamenkastu lozinku (slovo+broj+znak) SAMO za zaposlenike koji je JOŠ NEMAJU
// (bez lozinkaHash) — za razliku od generiraj-lozinke.js, ne dira nikoga tko već ima postavljenu
// lozinku. Hashira je i sprema u bazu, te ispisuje JSON popis {ime, prezime, pozicijaId, lozinka}
// na stdout za dalju obradu (PDF).
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

const VELIKA = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // bez I, O
const MALA = "abcdefghjkmnpqrstuvwxyz"; // bez i, l, o
const BROJEVI = "23456789"; // bez 0, 1
const ZNAKOVI = "!@#$%&*?";
const SVI = VELIKA + MALA + BROJEVI + ZNAKOVI;

function nasumicniZnak(skup) {
  return skup[Math.floor(Math.random() * skup.length)];
}

function generirajLozinku() {
  const obavezni = [nasumicniZnak(VELIKA), nasumicniZnak(MALA), nasumicniZnak(BROJEVI), nasumicniZnak(ZNAKOVI)];
  const ostatak = Array.from({ length: 4 }, () => nasumicniZnak(SVI));
  const znakovi = [...obavezni, ...ostatak];
  for (let i = znakovi.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [znakovi[i], znakovi[j]] = [znakovi[j], znakovi[i]];
  }
  return znakovi.join("");
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT value FROM app_data WHERE key='zaposlenici' FOR UPDATE");
    const zaposlenici = r.rows[0].value;
    const popis = [];

    const novi = [];
    for (const z of zaposlenici) {
      if (z.lozinkaHash) { novi.push(z); continue; }
      const lozinka = generirajLozinku();
      const lozinkaHash = await bcrypt.hash(lozinka, 10);
      const { pin, pinHash, ...ostalo } = z;
      novi.push({ ...ostalo, lozinkaHash });
      popis.push({ id: z.id, ime: z.ime, prezime: z.prezime, pozicijaId: z.pozicijaId, lozinka });
    }

    await client.query(
      `UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'zaposlenici'`,
      [JSON.stringify(novi)]
    );
    await client.query("COMMIT");

    const fs = require("fs");
    fs.writeFileSync(process.argv[2], JSON.stringify(popis, null, 2));
    console.error(`Gotovo — ${popis.length} novih lozinki postavljeno (samo zaposlenicima bez lozinke) i spremljeno u ${process.argv[2]}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });

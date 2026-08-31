// Generira novu 8-znamenkastu lozinku (slovo+broj+znak) za SVAKOG zaposlenika,
// hashira je i sprema u bazu, te ispisuje JSON popis {ime, prezime, lozinka} na
// stdout za dalju obradu (npr. PDF). Izbjegava dvosmislene znakove (0/O, 1/l/I).
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
  const r = await pool.query("SELECT value FROM app_data WHERE key='zaposlenici'");
  const zaposlenici = r.rows[0].value;
  const popis = [];

  const novi = [];
  for (const z of zaposlenici) {
    const lozinka = generirajLozinku();
    const lozinkaHash = await bcrypt.hash(lozinka, 10);
    const { pin, pinHash, ...ostalo } = z;
    novi.push({ ...ostalo, lozinkaHash });
    popis.push({ id: z.id, ime: z.ime, prezime: z.prezime, pozicijaId: z.pozicijaId, lozinka });
  }

  await pool.query(
    `INSERT INTO app_data (key, value, updated_at) VALUES ('zaposlenici', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(novi)]
  );

  const fs = require("fs");
  fs.writeFileSync(process.argv[2], JSON.stringify(popis, null, 2));
  console.error(`Gotovo — ${popis.length} novih lozinki postavljeno i spremljeno u ${process.argv[2]}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

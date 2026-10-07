// Sigurnosna ograda demo baze. Demo (DEMO_MODE=1 na serveru, i skripte demo:init / demo:reset)
// BRIŠE i iznova puni podatke, pa se smije spojiti ISKLJUČIVO na DEMO_DATABASE_URL — nikad na
// DATABASE_URL (koji na vlasnikovom računalu u backend/.env pokazuje na PRODUKCIJU).
//
// Dvije provjere prije bilo kakvog brisanja:
//  1) adresa: DEMO_DATABASE_URL ne smije pokazivati na istu bazu kao DATABASE_URL (iz okoline ili
//     iz backend/.env) — uspoređuje se Supabase projekt (ref) ili host:port/baza, ne cijeli tekst,
//     pa isti projekt preko poolera i preko izravne veze također pada;
//  2) oznaka u samoj bazi: tablica demo_oznaka. Postavlja je samo demo:init, i to samo na PRAZNOJ
//     bazi (bez ijednog zapisa u app_data) — produkcijska baza je nikad ne može dobiti, pa je ni
//     reset nikad ne može obrisati.
// DATABASE_URL se ovdje samo čita radi usporedbe; veza se na nju nikad ne otvara.
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const OZNAKA_TABLICA = "demo_oznaka";

// Identitet baze iz connection stringa: za Supabase ref projekta (iz db.<ref>.supabase.co ili
// korisnika postgres.<ref> kod poolera), inače host:port/baza.
function identitetBaze(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const korisnik = decodeURIComponent(u.username || "").toLowerCase();
  const ref = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host)?.[1] || /^postgres\.([a-z0-9]+)$/.exec(korisnik)?.[1];
  if (ref) return `supabase:${ref}`;
  return `${host}:${u.port || "5432"}/${(u.pathname || "/").slice(1) || "postgres"}`;
}

// DATABASE_URL iz backend/.env, pročitan izravno iz datoteke (bez dotenv-a, koji ne bi prepisao
// već postavljenu varijablu okoline pa bismo mogli propustiti usporedbu s datotekom).
function produkcijskeAdrese() {
  const adrese = [];
  if (process.env.DATABASE_URL) adrese.push(process.env.DATABASE_URL);
  try {
    const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    const m = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m.exec(env);
    if (m) adrese.push(m[1].replace(/^["']|["']$/g, ""));
  } catch { /* nema backend/.env — u redu (npr. na Renderu) */ }
  return adrese;
}

function demoAdresa() {
  const url = process.env.DEMO_DATABASE_URL;
  if (!url) throw new Error("DEMO_DATABASE_URL nije postavljen — demo se NIKAD ne spaja na DATABASE_URL.");
  const demoId = identitetBaze(url);
  if (!demoId) throw new Error("DEMO_DATABASE_URL nije ispravan connection string.");
  for (const prod of produkcijskeAdrese()) {
    if (prod.trim() === url.trim() || identitetBaze(prod) === demoId) {
      throw new Error("DEMO_DATABASE_URL pokazuje na istu bazu kao DATABASE_URL (produkcija) — prekidam.");
    }
  }
  return url;
}

function demoPool() {
  const url = demoAdresa();
  return new Pool({ connectionString: url, ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined, idleTimeoutMillis: 10 * 60 * 1000, keepAlive: true });
}

// Baca grešku ako baza nema demo oznaku. client može biti pool ili klijent unutar transakcije.
async function provjeriOznaku(client) {
  const r = await client.query("SELECT to_regclass($1) AS t", [`public.${OZNAKA_TABLICA}`]);
  if (!r.rows[0].t) throw new Error(`Baza nema demo oznaku (tablica ${OZNAKA_TABLICA}) — nije demo baza. Za novu, praznu demo bazu pokreni "npm run demo:init".`);
  const o = await client.query(`SELECT 1 FROM ${OZNAKA_TABLICA} WHERE id = 1`);
  if (!o.rows.length) throw new Error(`Demo oznaka je prazna — prekidam.`);
}

module.exports = { demoAdresa, demoPool, provjeriOznaku, identitetBaze, OZNAKA_TABLICA };

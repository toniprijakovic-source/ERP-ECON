// Postavljanje i noćni reset DEMO baze. Koristi se iz servera (DEMO_MODE=1) i iz naredbenog retka:
//   npm run demo:init    — jednom, na novoj PRAZNOJ demo bazi: shema + demo oznaka + početni podaci
//   npm run demo:reset   — ručni reset (inače ga server radi sam svake noći u 03:00 po Zagrebu)
// Oboje se spaja isključivo na DEMO_DATABASE_URL — vidi demo/baza.js.
const fs = require("fs");
const path = require("path");
const { demoPool, provjeriOznaku, OZNAKA_TABLICA } = require("./baza");
const { demoPodaci } = require("./podaci");

// "Dan reseta": datum u Zagrebu pomaknut za 3 sata, pa se mijenja točno u 03:00 po Zagrebu.
const SAT_RESETA = 3;
const resetDan = (sada = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit" })
  .format(new Date(sada.getTime() - SAT_RESETA * 3600 * 1000));

const shemaSql = () => fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");

async function napuni(client) {
  await client.query(shemaSql());
  await client.query("DELETE FROM app_data");
  const podaci = demoPodaci();
  for (const [kljuc, vrijednost] of Object.entries(podaci)) {
    await client.query("INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())", [kljuc, JSON.stringify(vrijednost)]);
  }
  await client.query("DELETE FROM login_log");
  await client.query(`UPDATE ${OZNAKA_TABLICA} SET zadnji_reset_dan = $1, zadnji_reset = now() WHERE id = 1`, [resetDan()]);
  return Object.keys(podaci).length;
}

// Jednokratno: označi novu demo bazu i napuni je. Odbija ako baza već ima podatke, a nije označena.
async function inicijaliziraj(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const oznaka = await client.query("SELECT to_regclass($1) AS t", [`public.${OZNAKA_TABLICA}`]);
    if (!oznaka.rows[0].t) {
      const app = await client.query("SELECT to_regclass('public.app_data') AS t");
      if (app.rows[0].t) {
        const n = await client.query("SELECT count(*)::int AS n FROM app_data");
        if (n.rows[0].n > 0) throw new Error("Baza već sadrži podatke (app_data) i nema demo oznaku — to nije nova demo baza. Prekidam, ništa nije promijenjeno.");
      }
      await client.query(`CREATE TABLE ${OZNAKA_TABLICA} (id INT PRIMARY KEY CHECK (id = 1), oznaceno TIMESTAMPTZ NOT NULL DEFAULT now(), zadnji_reset_dan TEXT, zadnji_reset TIMESTAMPTZ)`);
      await client.query(`INSERT INTO ${OZNAKA_TABLICA} (id) VALUES (1)`);
    }
    await provjeriOznaku(client);
    const n = await napuni(client);
    await client.query("COMMIT");
    return n;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function resetiraj(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await provjeriOznaku(client);
    // Zaključavanje oznake: dva istovremena reseta (npr. dvije instance servera) se ne preklapaju.
    await client.query(`SELECT 1 FROM ${OZNAKA_TABLICA} WHERE id = 1 FOR UPDATE`);
    const n = await napuni(client);
    await client.query("COMMIT");
    return n;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Za server: resetira samo ako danas (po "danu reseta") još nije resetirano. Brzo kad nije potrebno.
let poznatiDan = null;
let uTijeku = null;
function resetirajAkoTreba(pool) {
  const dan = resetDan();
  if (poznatiDan === dan) return Promise.resolve(false);
  if (!uTijeku) {
    uTijeku = (async () => {
      // Prvo pokretanje na novoj, praznoj demo bazi: postavi je (inicijaliziraj odbija bazu s podacima).
      const oznaka = await pool.query("SELECT to_regclass($1) AS t", [`public.${OZNAKA_TABLICA}`]);
      if (!oznaka.rows[0].t) {
        const n = await inicijaliziraj(pool);
        poznatiDan = dan;
        console.log(`Nova demo baza postavljena (${n} ključeva).`);
        return true;
      }
      const r = await pool.query(`SELECT zadnji_reset_dan FROM ${OZNAKA_TABLICA} WHERE id = 1`);
      if (r.rows[0]?.zadnji_reset_dan === dan) { poznatiDan = dan; return false; }
      const n = await resetiraj(pool);
      poznatiDan = dan;
      console.log(`Demo baza resetirana (${n} ključeva) za dan ${dan}.`);
      return true;
    })().finally(() => { uTijeku = null; });
  }
  return uTijeku;
}

module.exports = { inicijaliziraj, resetiraj, resetirajAkoTreba, resetDan };

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  const naredba = process.argv[2];
  if (!["init", "reset"].includes(naredba)) { console.error("Upotreba: node demo/reset.js init|reset"); process.exit(1); }
  let pool;
  (async () => {
    pool = demoPool();
    const n = naredba === "init" ? await inicijaliziraj(pool) : await resetiraj(pool);
    console.log(`Demo baza ${naredba === "init" ? "postavljena" : "resetirana"} — ${n} ključeva podataka.`);
  })().catch((e) => { console.error("GREŠKA:", e.message); process.exitCode = 1; }).finally(() => pool?.end());
}

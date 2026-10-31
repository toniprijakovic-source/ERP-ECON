// Lažni "pg" sa stanjem u memoriji — za testove, nikakva veza prema stvarnoj bazi. app_data je Map, a početni podaci dolaze iz datoteke SEED_FILE.
// Podržava samo upite koje poslužitelj koristi za ključeve app_data (SELECT, INSERT … ON CONFLICT, UPDATE); sve ostalo (DDL, druge tablice) vraća prazno.
// Zaključavanje (FOR UPDATE) ovdje ne postoji, pa testovi ne mogu dokazati istodobnost — ona se oslanja na zaključavanje retka u pravoj bazi.
const store = process.env.SEED_FILE ? JSON.parse(require("fs").readFileSync(process.env.SEED_FILE, "utf8")) : {};
const odgovor = (rows) => ({ rows, rowCount: rows.length });
const klon = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
async function query(sql, params = []) {
  const s = String(sql);
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)) return odgovor([]);
  if (/SELECT key, value FROM app_data/.test(s)) return odgovor(Object.entries(store).map(([key, value]) => ({ key, value: klon(value) })));
  let m = s.match(/SELECT value FROM app_data WHERE key = '([^']+)'/);
  if (m) return odgovor(store[m[1]] === undefined ? [] : [{ value: klon(store[m[1]]) }]);
  if (/SELECT value FROM app_data WHERE key = \$1/.test(s)) return odgovor(store[params[0]] === undefined ? [] : [{ value: klon(store[params[0]]) }]);
  m = s.match(/INSERT INTO app_data \(key, value, updated_at\) VALUES \('([^']+)', \$1/);
  if (m) { store[m[1]] = JSON.parse(params[0]); return odgovor([]); }
  if (/INSERT INTO app_data \(key, value, updated_at\) VALUES \(\$1, \$2/.test(s)) { store[params[0]] = JSON.parse(params[1]); return odgovor([]); }
  m = s.match(/UPDATE app_data SET value = \$1[^]*WHERE key = '([^']+)'/);
  if (m) { store[m[1]] = JSON.parse(params[0]); return odgovor([]); }
  return odgovor([]);
}
class Pool {
  query(sql, params) { return query(sql, params); }
  async end() {}
  async connect() { return { query, release() {} }; }
}
module.exports = { Pool };

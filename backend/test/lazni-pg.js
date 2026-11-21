// Lažni "pg" sa stanjem u memoriji — za testove, nikakva veza prema stvarnoj bazi. app_data je Map, a početni podaci dolaze iz datoteke SEED_FILE.
// Podržava samo upite koje poslužitelj koristi za ključeve app_data (SELECT, INSERT … ON CONFLICT, UPDATE); sve ostalo (DDL, druge tablice) vraća prazno.
// Zaključavanje (FOR UPDATE) ovdje ne postoji, pa testovi ne mogu dokazati istodobnost — ona se oslanja na zaključavanje retka u pravoj bazi.
const store = process.env.SEED_FILE ? JSON.parse(require("fs").readFileSync(process.env.SEED_FILE, "utf8")) : {};
const odgovor = (rows) => ({ rows, rowCount: rows.length });
// Tablica potrosni_dnevnik (potrosni-rute.js): ovdje se oponašaju samo upiti koje ta ruta šalje (unos, provjera zahtjeva, razdoblje, radnik, jedan zapis, storno).
const dnevnikPM = [];
// Tablica kiosk_signal (kiosk-pracenje.js): signal (upsert), popis ID-eva, popis za pregled, preimenovanje i brisanje.
const kioskSignali = [];
const klon = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
async function query(sql, params = []) {
  const s = String(sql);
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)) return odgovor([]);
  if (/SELECT key, value FROM app_data/.test(s)) return odgovor(Object.entries(store).map(([key, value]) => ({ key, value: klon(value) })));
  if (/^\s*SELECT id FROM kiosk_signal\s*$/.test(s)) return odgovor(kioskSignali.map((x) => ({ id: x.id })));
  if (/^\s*INSERT INTO kiosk_signal/.test(s)) {
    const [id, vrsta, uredaj] = params;
    const x = kioskSignali.find((y) => y.id === id);
    const sada = new Date().toISOString();
    if (x) { x.zadnji = sada; x.signala += 1; x.vrsta = vrsta; x.uredaj = uredaj; } else kioskSignali.push({ id, vrsta, uredaj, naziv: "", prvi: sada, zadnji: sada, signala: 1 });
    return odgovor([]);
  }
  if (/FROM kiosk_signal WHERE signala >= \$1/.test(s)) return odgovor(kioskSignali.filter((x) => x.signala >= params[0]).sort((a, b) => b.zadnji.localeCompare(a.zadnji)).map((x) => ({ ...x })));
  if (/^\s*UPDATE kiosk_signal SET naziv/.test(s)) { const x = kioskSignali.find((y) => y.id === params[0]); if (x) x.naziv = params[1]; return odgovor(x ? [x] : []); }
  if (/^\s*DELETE FROM kiosk_signal WHERE id = \$1/.test(s)) { const i = kioskSignali.findIndex((y) => y.id === params[0]); if (i >= 0) kioskSignali.splice(i, 1); return odgovor(i >= 0 ? [{}] : []); }
  if (/^\s*INSERT INTO potrosni_dnevnik/.test(s)) {
    const [id, zaposlenik_id, zaposlenik, artikl_id, artikl, jm, kolicina, vrsta, zahtjev_id, korisnik_id, korisnik, napomena] = params;
    if (zahtjev_id && dnevnikPM.some((x) => x.zahtjev_id === zahtjev_id && x.artikl_id === artikl_id)) throw new Error("duplicate key value violates unique constraint");
    dnevnikPM.push({ id, vrijeme: new Date().toISOString(), zaposlenik_id, zaposlenik, artikl_id, artikl, jm, kolicina: String(kolicina), vrsta, zahtjev_id, korisnik_id, korisnik, napomena, storno: false });
    return odgovor([]);
  }
  if (/FROM potrosni_dnevnik WHERE zahtjev_id/.test(s)) return odgovor(dnevnikPM.filter((x) => x.zahtjev_id === params[0]).slice(0, 1).map(() => ({ "?column?": 1 })));
  if (/FROM potrosni_dnevnik WHERE vrsta = 'uzimanje'/.test(s)) return odgovor(dnevnikPM.filter((x) => x.vrsta === "uzimanje" && x.vrijeme >= params[0] && x.vrijeme < params[1]).map((x) => ({ ...x })));
  if (/FROM potrosni_dnevnik WHERE zaposlenik_id/.test(s)) return odgovor(dnevnikPM.filter((x) => x.zaposlenik_id === params[0] && x.vrijeme >= params[1] && x.vrijeme < params[2]).sort((a, b) => b.vrijeme.localeCompare(a.vrijeme)).map((x) => ({ ...x })));
  if (/FROM potrosni_dnevnik WHERE id = \$1/.test(s)) return odgovor(dnevnikPM.filter((x) => x.id === params[0]).map((x) => ({ ...x })));
  if (/^\s*UPDATE potrosni_dnevnik SET storno/.test(s)) { const x = dnevnikPM.find((y) => y.id === params[0]); if (x) x.storno = true; return odgovor(x ? [x] : []); }
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

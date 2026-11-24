// Lažni "pg" sa stanjem u memoriji — za testove, nikakva veza prema stvarnoj bazi. app_data je Map, a početni podaci dolaze iz datoteke SEED_FILE.
// Podržava samo upite koje poslužitelj koristi za ključeve app_data (SELECT, INSERT … ON CONFLICT, UPDATE); sve ostalo (DDL, druge tablice) vraća prazno.
// Zaključavanje (FOR UPDATE) ovdje ne postoji, pa testovi ne mogu dokazati istodobnost — ona se oslanja na zaključavanje retka u pravoj bazi.
const store = process.env.SEED_FILE ? JSON.parse(require("fs").readFileSync(process.env.SEED_FILE, "utf8")) : {};
const odgovor = (rows) => ({ rows, rowCount: rows.length });
// Tablica potrosni_dnevnik (potrosni-rute.js): ovdje se oponašaju samo upiti koje ta ruta šalje (unos, provjera zahtjeva, razdoblje, radnik, jedan zapis, storno).
const dnevnikPM = [];
// Tablica kiosk_signal (kiosk-pracenje.js): signal (upsert), popis ID-eva, popis za pregled, preimenovanje i brisanje.
const kioskSignali = [];
// Tablica utovar_slike (utovar.js): unos, redni broj, brojanje, popis projekta, jedna slika, brisanje, red za most i potvrde mosta.
const utovarSlike = [];
// Tablice montaza_pozicije i montaza_slike (montaza.js).
const montazaPoz = [];
const montazaSlike = [];
// Tablice nesukladnosti (nesukladnosti.js).
const nsZapisi = [];
const nsSlike = [];
const nsPdf = new Map();
const nsPostavke = new Map();
const nsJavni = (x) => ({ ...x, podaci: klon(x.podaci) });
const klon = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
async function query(sql, params = []) {
  const s = String(sql);
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)) return odgovor([]);
  if (/^\s*INSERT INTO nesukladnosti_postavke/.test(s)) { nsPostavke.set(params[0], params[1]); return odgovor([{}]); }
  if (/FROM nesukladnosti_postavke WHERE kljuc = \$1/.test(s)) return odgovor(nsPostavke.has(params[0]) ? [{ vrijednost: nsPostavke.get(params[0]) }] : []);
  if (/^\s*INSERT INTO nesukladnosti_pdf/.test(s)) { nsPdf.set(params[0], params[1]); return odgovor([{}]); }
  if (/FROM nesukladnosti_pdf WHERE ns_id = \$1/.test(s)) return odgovor(nsPdf.has(params[0]) ? [{ pdf: nsPdf.get(params[0]) }] : []);
  if (/^\s*INSERT INTO nesukladnosti_slike/.test(s)) {
    const [id, ns_id, redni, naziv, vrsta, slika, slicica, kreirao_id, zahtjev_id] = params;
    if (nsSlike.some((x) => x.ns_id === ns_id && x.redni === redni)) throw new Error("duplicate key value violates unique constraint");
    nsSlike.push({ id, ns_id, redni, naziv, vrsta, slika, slicica, kreirao_id, zahtjev_id, kreirano: new Date().toISOString(), spremljeno_z: null, z_putanja: "", z_greska: "", z_pokusaj: null });
    return odgovor([]);
  }
  if (/COALESCE\(MAX\(redni\), 0\) \+ 1 AS sljedeci FROM nesukladnosti_slike/.test(s)) return odgovor([{ sljedeci: Math.max(0, ...nsSlike.filter((x) => x.ns_id === params[0]).map((x) => x.redni)) + 1 }]);
  if (/SELECT COUNT\(\*\) AS n FROM nesukladnosti_slike/.test(s)) return odgovor([{ n: String(nsSlike.filter((x) => x.ns_id === params[0]).length) }]);
  if (/FROM nesukladnosti_slike WHERE zahtjev_id = \$1/.test(s)) return odgovor(nsSlike.filter((x) => x.zahtjev_id === params[0]).map((x) => ({ id: x.id, naziv: x.naziv })));
  if (/FROM nesukladnosti_slike WHERE ns_id = \$1 ORDER BY/.test(s)) return odgovor(nsSlike.filter((x) => x.ns_id === params[0]).sort((a, b) => a.redni - b.redni).map((x) => ({ ...x, slika: undefined, slicica: undefined, ima_slicicu: !!x.slicica })));
  if (/FROM nesukladnosti_slike WHERE id = \$1/.test(s) && /^\s*SELECT/.test(s)) return odgovor(nsSlike.filter((x) => x.id === params[0]).map((x) => ({ ...x })));
  if (/^\s*DELETE FROM nesukladnosti_slike WHERE id = \$1/.test(s)) { const i = nsSlike.findIndex((x) => x.id === params[0]); if (i >= 0) nsSlike.splice(i, 1); return odgovor(i >= 0 ? [{}] : []); }
  if (/FROM nesukladnosti_slike s JOIN nesukladnosti n/.test(s)) return odgovor(nsSlike.filter((x) => !x.spremljeno_z && !x.z_pokusaj).map((x) => ({ x, n: nsZapisi.find((z) => z.id === x.ns_id) })).filter((o) => o.n && o.n.z_ukljuceno).slice(0, 20).map(({ x, n }) => ({ id: x.id, naziv: x.naziv, vrsta: x.vrsta, godina: n.godina, z_mapa: n.z_mapa })));
  if (/^\s*UPDATE nesukladnosti_slike SET spremljeno_z = now\(\)/.test(s)) { const x = nsSlike.find((y) => y.id === params[0]); if (x) { x.spremljeno_z = new Date().toISOString(); x.z_putanja = params[1]; x.z_greska = ""; x.z_pokusaj = x.spremljeno_z; } return odgovor(x ? [x] : []); }
  if (/^\s*UPDATE nesukladnosti_slike SET z_greska/.test(s)) { const x = nsSlike.find((y) => y.id === params[0]); if (x) { x.z_greska = params[1]; x.z_pokusaj = new Date().toISOString(); } return odgovor(x ? [x] : []); }
  if (/^\s*INSERT INTO nesukladnosti \(/.test(s)) {
    const [id, godina, broj, podaci, status, kreirao_id, z_mapa] = params;
    if (nsZapisi.some((x) => x.godina === godina && x.broj === broj)) throw new Error("duplicate key value violates unique constraint");
    const sada = new Date().toISOString();
    nsZapisi.push({ id, godina, broj, podaci: JSON.parse(podaci), status, verzija: 1, kreirano: sada, izmijenjeno: sada, kreirao_id, izmijenio_id: kreirao_id, uvoz: false, z_ukljuceno: true, z_mapa, pdf_verzija: 0, pdf_z_verzija: 0, z_putanja: "", z_greska: "", z_pokusaj: null });
    return odgovor([]);
  }
  if (/COALESCE\(MAX\(broj\), 0\) \+ 1 AS sljedeci FROM nesukladnosti/.test(s)) return odgovor([{ sljedeci: Math.max(0, ...nsZapisi.filter((x) => x.godina === params[0]).map((x) => x.broj)) + 1 }]);
  if (/SELECT DISTINCT godina FROM nesukladnosti/.test(s)) return odgovor([...new Set(nsZapisi.map((x) => x.godina))].sort((a, b) => b - a).map((godina) => ({ godina })));
  if (/FROM nesukladnosti WHERE godina = \$1 ORDER BY broj DESC/.test(s)) return odgovor(nsZapisi.filter((x) => x.godina === params[0]).sort((a, b) => b.broj - a.broj).map((x) => ({ ...nsJavni(x), slika: String(nsSlike.filter((y) => y.ns_id === x.id).length) })));
  if (/FROM nesukladnosti WHERE id = \$1/.test(s) && /^\s*SELECT/.test(s)) return odgovor(nsZapisi.filter((x) => x.id === params[0]).map(nsJavni));
  if (/FROM nesukladnosti WHERE status NOT IN/.test(s)) return odgovor(nsZapisi.filter((x) => !["Zatvorena", "Poništena"].includes(x.status)).map(nsJavni));
  if (/FROM nesukladnosti WHERE z_ukljuceno AND pdf_verzija > pdf_z_verzija/.test(s)) return odgovor(nsZapisi.filter((x) => x.z_ukljuceno && x.pdf_verzija > x.pdf_z_verzija && !x.z_pokusaj).slice(0, 10).map(nsJavni));
  if (/^\s*UPDATE nesukladnosti SET podaci = \$2/.test(s)) { const x = nsZapisi.find((y) => y.id === params[0] && y.verzija === params[4]); if (x) { x.podaci = JSON.parse(params[1]); x.status = params[2]; x.verzija += 1; x.izmijenjeno = new Date().toISOString(); x.izmijenio_id = params[3]; } return odgovor(x ? [x] : []); }
  if (/^\s*UPDATE nesukladnosti SET pdf_verzija = pdf_verzija \+ 1/.test(s)) { const x = nsZapisi.find((y) => y.id === params[0]); if (x) { x.pdf_verzija += 1; x.z_pokusaj = null; } return odgovor(x ? [x] : []); }
  if (/^\s*UPDATE nesukladnosti SET z_ukljuceno = true/.test(s)) { const x = nsZapisi.find((y) => y.id === params[0]); if (x) x.z_ukljuceno = true; return odgovor(x ? [x] : []); }
  if (/^\s*UPDATE nesukladnosti SET pdf_z_verzija = GREATEST/.test(s)) { const x = nsZapisi.find((y) => y.id === params[0]); if (x) { x.pdf_z_verzija = Math.max(x.pdf_z_verzija, params[1]); x.z_putanja = params[2]; x.z_greska = ""; x.z_pokusaj = new Date().toISOString(); } return odgovor(x ? [x] : []); }
  if (/^\s*UPDATE nesukladnosti SET z_greska/.test(s)) { const x = nsZapisi.find((y) => y.id === params[0]); if (x) { x.z_greska = params[1]; x.z_pokusaj = new Date().toISOString(); } return odgovor(x ? [x] : []); }
  if (/^\s*INSERT INTO montaza_pozicije/.test(s)) {
    const [projekt_id, mapa, oznaka, poredak] = params;
    if (montazaPoz.some((x) => x.projekt_id === projekt_id && x.mapa === mapa)) return odgovor([]);
    montazaPoz.push({ projekt_id, mapa, oznaka, poredak, kreirano: new Date().toISOString(), montirano: null });
    return odgovor([{}]);
  }
  if (/SELECT COALESCE\(MAX\(poredak\), 0\) AS m FROM montaza_pozicije/.test(s)) return odgovor([{ m: Math.max(0, ...montazaPoz.filter((x) => x.projekt_id === params[0]).map((x) => x.poredak)) }]);
  if (/FROM montaza_pozicije WHERE projekt_id = \$1 ORDER BY/.test(s)) return odgovor(montazaPoz.filter((x) => x.projekt_id === params[0]).sort((a, b) => a.poredak - b.poredak || a.oznaka.localeCompare(b.oznaka)).map((x) => ({ ...x })));
  if (/FROM montaza_pozicije WHERE projekt_id = \$1 AND mapa = \$2/.test(s) && /^\s*SELECT/.test(s)) return odgovor(montazaPoz.filter((x) => x.projekt_id === params[0] && x.mapa === params[1]).map((x) => ({ ...x })));
  if (/^\s*DELETE FROM montaza_pozicije/.test(s)) { const i = montazaPoz.findIndex((x) => x.projekt_id === params[0] && x.mapa === params[1]); if (i >= 0) montazaPoz.splice(i, 1); return odgovor(i >= 0 ? [{}] : []); }
  if (/^\s*UPDATE montaza_pozicije SET montirano = now\(\)/.test(s)) { const x = montazaPoz.find((y) => y.projekt_id === params[0] && y.mapa === params[1]); if (x) x.montirano = new Date().toISOString(); return odgovor(x ? [x] : []); }
  if (/^\s*UPDATE montaza_pozicije SET montirano = NULL/.test(s)) { const x = montazaPoz.find((y) => y.projekt_id === params[0] && y.mapa === params[1]); if (x) x.montirano = null; return odgovor(x ? [x] : []); }
  if (/^\s*INSERT INTO montaza_slike/.test(s)) {
    const [id, projekt_id, projekt_sifra, mapa, oznaka, datum, redni, naziv, velicina, slika, slicica, zahtjev_id] = params;
    if (montazaSlike.some((x) => x.projekt_id === projekt_id && x.mapa === mapa && x.datum === datum && x.redni === redni)) throw new Error("duplicate key value violates unique constraint");
    montazaSlike.push({ id, projekt_id, projekt_sifra, mapa, oznaka, datum, redni, naziv, velicina, slika, slicica, zahtjev_id, kreirano: new Date().toISOString(), spremljeno_z: null, z_putanja: "", z_greska: "", z_pokusaj: null });
    return odgovor([]);
  }
  if (/SELECT COALESCE\(MAX\(redni\), 0\) \+ 1 AS sljedeci FROM montaza_slike/.test(s)) return odgovor([{ sljedeci: Math.max(0, ...montazaSlike.filter((x) => x.projekt_id === params[0] && x.mapa === params[1] && x.datum === params[2]).map((x) => x.redni)) + 1 }]);
  if (/SELECT COUNT\(\*\) AS n FROM montaza_slike/.test(s)) return odgovor([{ n: String(montazaSlike.filter((x) => x.projekt_id === params[0] && x.mapa === params[1]).length) }]);
  if (/FROM montaza_slike WHERE zahtjev_id = \$1/.test(s)) return odgovor(montazaSlike.filter((x) => x.zahtjev_id === params[0]).map((x) => ({ id: x.id, redni: x.redni, naziv: x.naziv })));
  if (/FROM montaza_slike WHERE id = \$1/.test(s) && /^\s*SELECT/.test(s)) return odgovor(montazaSlike.filter((x) => x.id === params[0]).map((x) => ({ ...x })));
  if (/FROM montaza_slike WHERE projekt_id = \$1 ORDER BY/.test(s)) return odgovor(montazaSlike.filter((x) => x.projekt_id === params[0]).sort((a, b) => a.mapa.localeCompare(b.mapa) || a.datum.localeCompare(b.datum) || a.redni - b.redni).map((x) => ({ ...x, slika: undefined, slicica: undefined, ima_original: !!x.slika })));
  if (/^\s*DELETE FROM montaza_slike WHERE id = \$1/.test(s)) { const i = montazaSlike.findIndex((x) => x.id === params[0]); if (i >= 0) montazaSlike.splice(i, 1); return odgovor(i >= 0 ? [{}] : []); }
  if (/FROM montaza_slike WHERE spremljeno_z IS NULL AND slika IS NOT NULL/.test(s)) return odgovor(montazaSlike.filter((x) => !x.spremljeno_z && x.slika && !x.z_pokusaj).slice(0, 20).map((x) => ({ ...x, slika: undefined, slicica: undefined })));
  if (/^\s*UPDATE montaza_slike SET spremljeno_z = now\(\)/.test(s)) { const x = montazaSlike.find((y) => y.id === params[0]); if (x) { x.spremljeno_z = new Date().toISOString(); x.z_putanja = params[1]; x.z_greska = ""; x.z_pokusaj = x.spremljeno_z; } return odgovor(x ? [x] : []); }
  if (/^\s*UPDATE montaza_slike SET z_greska/.test(s)) { const x = montazaSlike.find((y) => y.id === params[0]); if (x) { x.z_greska = params[1]; x.z_pokusaj = new Date().toISOString(); } return odgovor(x ? [x] : []); }
  if (/^\s*UPDATE montaza_slike SET slika = NULL/.test(s)) return odgovor([]);
  if (/^\s*INSERT INTO utovar_slike/.test(s)) {
    const [id, otpremnica_id, otpremnica_broj, projekt_id, projekt_sifra, datum, redni, naziv, velicina, slika, slicica, zahtjev_id] = params;
    if (utovarSlike.some((x) => x.otpremnica_id === otpremnica_id && x.datum === datum && x.redni === redni)) throw new Error("duplicate key value violates unique constraint");
    utovarSlike.push({ id, otpremnica_id, otpremnica_broj, projekt_id, projekt_sifra, datum, redni, naziv, velicina, slika, slicica, zahtjev_id, kreirano: new Date().toISOString(), spremljeno_z: null, z_putanja: "", z_greska: "", z_pokusaj: null });
    return odgovor([]);
  }
  if (/SELECT COALESCE\(MAX\(redni\), 0\) \+ 1 AS sljedeci FROM utovar_slike/.test(s)) return odgovor([{ sljedeci: Math.max(0, ...utovarSlike.filter((x) => x.otpremnica_id === params[0] && x.datum === params[1]).map((x) => x.redni)) + 1 }]);
  if (/SELECT COUNT\(\*\) AS n FROM utovar_slike/.test(s)) return odgovor([{ n: String(utovarSlike.filter((x) => x.otpremnica_id === params[0]).length) }]);
  if (/FROM utovar_slike WHERE zahtjev_id = \$1/.test(s)) return odgovor(utovarSlike.filter((x) => x.zahtjev_id === params[0]).map((x) => ({ id: x.id, redni: x.redni, naziv: x.naziv })));
  if (/FROM utovar_slike WHERE id = \$1/.test(s) && /^\s*SELECT/.test(s)) return odgovor(utovarSlike.filter((x) => x.id === params[0]).map((x) => ({ ...x })));
  if (/FROM utovar_slike WHERE projekt_id = \$1/.test(s)) return odgovor(utovarSlike.filter((x) => x.projekt_id === params[0]).sort((a, b) => b.datum.localeCompare(a.datum) || a.otpremnica_broj.localeCompare(b.otpremnica_broj) || a.redni - b.redni).map((x) => ({ ...x, slika: undefined, slicica: undefined, ima_original: !!x.slika })));
  if (/^\s*DELETE FROM utovar_slike WHERE id = \$1/.test(s)) { const i = utovarSlike.findIndex((x) => x.id === params[0]); if (i >= 0) utovarSlike.splice(i, 1); return odgovor(i >= 0 ? [{}] : []); }
  if (/FROM utovar_slike WHERE spremljeno_z IS NULL AND slika IS NOT NULL/.test(s)) return odgovor(utovarSlike.filter((x) => !x.spremljeno_z && x.slika && !x.z_pokusaj).slice(0, 20).map((x) => ({ ...x, slika: undefined, slicica: undefined })));
  if (/^\s*UPDATE utovar_slike SET spremljeno_z = now\(\)/.test(s)) { const x = utovarSlike.find((y) => y.id === params[0]); if (x) { x.spremljeno_z = new Date().toISOString(); x.z_putanja = params[1]; x.z_greska = ""; x.z_pokusaj = x.spremljeno_z; } return odgovor(x ? [x] : []); }
  if (/^\s*UPDATE utovar_slike SET z_greska/.test(s)) { const x = utovarSlike.find((y) => y.id === params[0]); if (x) { x.z_greska = params[1]; x.z_pokusaj = new Date().toISOString(); } return odgovor(x ? [x] : []); }
  if (/^\s*UPDATE utovar_slike SET slika = NULL/.test(s)) return odgovor([]);
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

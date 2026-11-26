// Probna obnova kopije (probna-obnova.js): logika i tijek s lažnim klijentom baze koji oponaša privremene tablice. Prava baza se ne koristi.
// Pokretanje: `node test/probna-obnova.test.js` (ulazi i u `npm test`). Stvarni SQL na Postgresu provjerava se ručno: node probna-obnova.js "kopija.sef".
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const P = require("../probna-obnova");
const { pakiraj } = require("../lib/sef");

(async () => {
  // kanonski oblik: redoslijed ključeva objekta nije bitan, redoslijed niza jest
  assert.strictEqual(P.kanonski({ b: 1, a: [1, { d: 2, c: 3 }] }), P.kanonski({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.notStrictEqual(P.kanonski([1, 2]), P.kanonski([2, 1]));

  // kada: nikad; uspjela ovaj mjesec → ne; uspjela prošli mjesec → da; neuspjela prije 2 h → ne; prije 21 h → da
  const sada = new Date(2026, 10, 26, 10, 15);
  assert.strictEqual(P.trebaProbnaObnova(null, sada), true);
  assert.strictEqual(P.trebaProbnaObnova({ ok: true, vrijeme: new Date(2026, 10, 1, 0, 15).toISOString() }, sada), false);
  assert.strictEqual(P.trebaProbnaObnova({ ok: true, vrijeme: new Date(2026, 9, 31, 23, 15).toISOString() }, sada), true);
  assert.strictEqual(P.trebaProbnaObnova({ ok: false, vrijeme: new Date(2026, 10, 26, 8, 15).toISOString() }, sada), false);
  assert.strictEqual(P.trebaProbnaObnova({ ok: false, vrijeme: new Date(2026, 10, 25, 13, 0).toISOString() }, sada), true);
  assert.strictEqual(P.trebaProbnaObnova({ ok: true, vrijeme: "nije datum" }, sada), true);

  // Lažni klijent: privremene tablice u memoriji, CHECK na ključeve app_data, stupci tablica.
  const lazniKlijent = ({ dopusteniKljucevi, stupci, uBazi, pokvariTablicu }) => {
    const temp = new Map();
    const upiti = [];
    return {
      upiti,
      release() {},
      async query(sql, params = []) {
        const s = String(sql).replace(/\s+/g, " ").trim();
        upiti.push(s);
        if (/^(BEGIN|ROLLBACK)$/.test(s)) { if (s === "ROLLBACK") temp.clear(); return { rows: [] }; }
        let m = s.match(/^CREATE TEMP TABLE (probna_\w+) \(LIKE (?:public\.)?(\w+) INCLUDING ALL\) ON COMMIT DROP$/);
        if (m) { temp.set(m[1], []); return { rows: [] }; }
        if (s.startsWith("INSERT INTO probna_app_data")) {
          const podaci = JSON.parse(params[0]);
          for (const k of Object.keys(podaci)) if (!dopusteniKljucevi.includes(k)) throw new Error(`new row for relation "probna_app_data" violates check constraint "app_data_key_check" (${k})`);
          // jsonb preslaže ključeve objekta — natrag dolaze obrnutim redom
          const obrni = (v) => (Array.isArray(v) ? v.map(obrni) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, obrni(v[k])])) : v);
          temp.set("probna_app_data", Object.entries(podaci).map(([key, value]) => ({ key, value: obrni(value) })));
          return { rows: [] };
        }
        if (s === "SELECT key, value FROM probna_app_data") return { rows: temp.get("probna_app_data") };
        if (s.startsWith("SELECT to_regclass")) { const t = params[0].replace("public.", ""); return { rows: [{ naziv: stupci[t] ? t : null }] }; }
        if (s.startsWith("SELECT attname FROM pg_attribute")) return { rows: stupci[params[0].replace("probna_", "")].map((attname) => ({ attname })) };
        m = s.match(/^INSERT INTO (probna_(\w+)) SELECT \* FROM json_populate_recordset/);
        if (m) {
          const st = stupci[m[2]];
          let redovi = JSON.parse(params[0]).map((r) => Object.fromEntries(st.map((c) => [c, r[c] === undefined ? null : r[c]])));
          if (pokvariTablicu === m[2]) redovi = redovi.slice(1);
          temp.set(m[1], redovi);
          return { rows: [] };
        }
        m = s.match(/FROM (probna_\w+) x$/);
        if (m) return { rows: [{ redovi: temp.get(m[1]) }] };
        if (s === "SELECT key FROM app_data") return { rows: uBazi.map((key) => ({ key })) };
        throw new Error(`neočekivan upit: ${s}`);
      },
    };
  };
  const paket = {
    __erp_backup_sef: true, datum: "2026-11-01T00:15:00.000Z",
    podaci: { projekti: [{ id: "p1", sifra: "RN 1", faze: { a: 1, b: 2 } }], postavkeTvrtke: { naziv: "Probna d.o.o.", oib: "x" } },
    tablice: { login_log: [{ id: 1, vrijeme: "2026-11-01T08:00:00+00:00", uspjeh: true }, { id: 2, vrijeme: "2026-11-01T09:00:00+00:00", uspjeh: false }], potrosni_dnevnik: [] },
  };
  const TABLICE = ["login_log", "potrosni_dnevnik", "nova_tablica"];
  const stupci = { login_log: ["id", "vrijeme", "uspjeh", "novi_stupac"], potrosni_dnevnik: ["id", "kolicina"] };

  // uspjeh: stupac dodan nakon kopije (novi_stupac) ne smeta; nepostojeća tablica bez redaka je samo poruka; novi ključ u bazi je poruka
  let k = lazniKlijent({ dopusteniKljucevi: ["projekti", "postavkeTvrtke", "zaposlenici"], stupci, uBazi: ["projekti", "postavkeTvrtke", "zaposlenici"] });
  let r = await P.provjeriObnovu(k, paket, TABLICE);
  assert.strictEqual(r.kljuceva, 2);
  assert.deepStrictEqual(r.tablice, { login_log: 2, potrosni_dnevnik: 0, nova_tablica: 0 });
  assert.ok(r.poruke.some((p) => /nova_tablica ne postoji/.test(p)));
  assert.ok(r.poruke.some((p) => /zaposlenici/.test(p)));
  assert.strictEqual(k.upiti[0], "BEGIN");
  assert.strictEqual(k.upiti[k.upiti.length - 1], "ROLLBACK", "transakcija uvijek završava poništavanjem");
  assert.ok(k.upiti.every((q) => !/^(INSERT|UPDATE|DELETE) (INTO )?(app_data|login_log|potrosni_dnevnik)\b/.test(q)), "prave tablice se ne diraju");

  // ključ koji ograničenje baze ne dopušta → greška (to je upravo ono što probna obnova treba otkriti) + ROLLBACK
  k = lazniKlijent({ dopusteniKljucevi: ["projekti"], stupci, uBazi: [] });
  await assert.rejects(P.provjeriObnovu(k, paket, TABLICE), /app_data_key_check/);
  assert.strictEqual(k.upiti[k.upiti.length - 1], "ROLLBACK");
  // tablica vrati manje redaka → greška
  k = lazniKlijent({ dopusteniKljucevi: ["projekti", "postavkeTvrtke"], stupci, uBazi: [], pokvariTablicu: "login_log" });
  await assert.rejects(P.provjeriObnovu(k, paket, TABLICE), /login_log: vraćeno 1 od 2/);
  // kopija ima stupac kojeg tablica više nema → greška
  k = lazniKlijent({ dopusteniKljucevi: ["projekti", "postavkeTvrtke"], stupci: { ...stupci, login_log: ["id", "vrijeme"] }, uBazi: [] });
  await assert.rejects(P.provjeriObnovu(k, paket, TABLICE), /uspjeh/);
  // tablica s redovima u kopiji ne postoji u bazi → greška
  k = lazniKlijent({ dopusteniKljucevi: ["projekti", "postavkeTvrtke"], stupci: { potrosni_dnevnik: ["id"] }, uBazi: [] });
  await assert.rejects(P.provjeriObnovu(k, paket, TABLICE), /login_log ne postoji/);

  // Automatski postupak na pravoj šifriranoj datoteci: najnovija mjesečna kopija, rezultat u probna-obnova.json i zapisnik
  const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-obnova-"));
  try {
    const SIFRA = "probna-lozinka-samo-za-test-1234";
    fs.mkdirSync(path.join(mapa, "Mjesecne"), { recursive: true });
    fs.mkdirSync(path.join(mapa, "Satne"), { recursive: true });
    fs.writeFileSync(path.join(mapa, "Mjesecne", "backup-2026-10-01_001500.sef"), pakiraj({ ...paket, podaci: { projekti: [] } }, SIFRA));
    fs.writeFileSync(path.join(mapa, "Mjesecne", "backup-2026-11-01_001500.sef"), pakiraj(paket, SIFRA));
    fs.writeFileSync(path.join(mapa, "Satne", "backup-2026-11-26_091500.sef"), pakiraj(paket, SIFRA));
    assert.strictEqual(path.basename(P.kopijaZaProvjeru(mapa)), "backup-2026-11-01_001500.sef");
    const zapisi = [];
    const pool = { connect: async () => lazniKlijent({ dopusteniKljucevi: ["projekti", "postavkeTvrtke"], stupci, uBazi: [] }) };
    r = await P.napraviProbnuObnovu({ pool, mapa, sifra: SIFRA, tablice: TABLICE, sada: new Date("2026-11-26T09:15:00.000Z"), dodajUZapisnik: (m, red) => zapisi.push(red) });
    assert.strictEqual(r.ok, true, r.greska);
    const stanje = P.procitajStanje(mapa);
    assert.deepStrictEqual([stanje.ok, stanje.kopija, stanje.kopijaOd, stanje.kljuceva], [true, "backup-2026-11-01_001500.sef", "2026-11-01T00:15:00.000Z", 2]);
    assert.match(zapisi[0], /PROBNA OBNOVA uspjela: backup-2026-11-01_001500\.sef \| 2 ključeva/);
    assert.strictEqual(P.trebaProbnaObnova(stanje, new Date(2026, 10, 27)), false);
    // pogrešna lozinka → neuspjeh zapisan (ne baca grešku)
    r = await P.napraviProbnuObnovu({ pool, mapa, sifra: "kriva-lozinka-samo-za-test-9999", tablice: TABLICE, dodajUZapisnik: (m, red) => zapisi.push(red) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(P.procitajStanje(mapa).ok, false);
    assert.match(zapisi[1], /PROBNA OBNOVA NIJE USPJELA/);
    // prazna mapa → neuspjeh "nema kopije"
    const prazna = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-obnova-prazna-"));
    r = await P.napraviProbnuObnovu({ pool, mapa: prazna, sifra: SIFRA, tablice: TABLICE });
    assert.strictEqual(r.ok, false);
    assert.match(r.greska, /nema nijedne kopije/);
    fs.rmSync(prazna, { recursive: true, force: true });
  } finally {
    fs.rmSync(mapa, { recursive: true, force: true });
  }
  console.log("probna-obnova: svi testovi prolaze");
})().catch((e) => { console.error(e); process.exit(1); });

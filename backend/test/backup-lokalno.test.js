// Test satne kopije (backup-lokalno.js): sprema SVE ključeve iz app_data (i one koji nisu na starom ručnom popisu) i tablice izvan app_data,
// ostaje u formatu koji čita gumb "Uvoz" u aplikaciji, a prazna baza ne daje kopiju. Lažni pool, privremena mapa, izmišljeni podaci — baza se ne dira.
// Pokretanje: `npm test` u mapi backend.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { napraviKopiju, nazivDatoteke } = require("../backup-lokalno");
const { TABLICE } = require("../backup-sef");

(async () => {
  const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-backup-"));
  // Ključevi koji su nedostajali na starom popisu (kadrovskiPodaci, pregledi, prijedlozi...) + jedan koji ni na jednom popisu ne postoji.
  const redovi = [
    { key: "kupci", value: [{ id: "k1", naziv: "Test kupac" }] },
    { key: "kadrovskiPodaci", value: [{ id: "x1" }] },
    { key: "pregledi", value: [{ id: "p1" }, { id: "p2" }] },
    { key: "zastitaPostavke", value: { rok: 12 } },
    { key: "buducniKljuc", value: [1, 2, 3] },
  ];
  const upiti = [];
  const pool = {
    query: async (sql) => {
      upiti.push(sql);
      if (/FROM app_data/.test(sql)) return { rows: redovi };
      if (/to_regclass/.test(sql)) return { rows: [{ naziv: "postoji" }] };
      const t = TABLICE.find((x) => new RegExp(`FROM ${x} t`).test(sql));
      if (t) return { rows: [{ redovi: t === "login_log" ? [{ id: 1, zaposlenik: "w1" }, { id: 2, zaposlenik: "w2" }] : [] }] };
      throw new Error("neočekivan upit: " + sql);
    },
  };

  const sada = new Date(2026, 10, 19, 14, 5, 0);
  const s = await napraviKopiju({ pool, mapa, sada });
  assert.strictEqual(path.basename(s.odrediste), nazivDatoteke(sada));
  assert.strictEqual(s.kljuceva, 5);
  assert.strictEqual(s.tablice.login_log, 2);

  const paket = JSON.parse(fs.readFileSync(s.odrediste, "utf8"));
  assert.strictEqual(paket.__erp_backup, true, "oznaka formata koju traži aplikacija");
  assert.deepStrictEqual(Object.keys(paket.podaci).sort(), redovi.map((r) => r.key).sort(), "svi ključevi iz baze, bez ručnog popisa");
  assert.deepStrictEqual(paket.podaci.pregledi, [{ id: "p1" }, { id: "p2" }]);
  assert.deepStrictEqual(paket.podaci.zastitaPostavke, { rok: 12 }, "objekt ostaje objekt (ne pretvara se u prazan popis)");
  assert.strictEqual(paket.tablice.login_log.length, 2);
  assert.deepStrictEqual(Object.keys(paket.tablice).sort(), [...TABLICE].sort());
  assert.ok(!upiti.some((q) => /INSERT|UPDATE|DELETE|ALTER|DROP/i.test(q)), "kopija samo čita iz baze");

  // Prazna baza: nema kopije (inače bi pogrešan DATABASE_URL tiho davao prazne datoteke).
  const praznaMapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-backup-prazna-"));
  await assert.rejects(napraviKopiju({ pool: { query: async () => ({ rows: [] }) }, mapa: praznaMapa, sada }), /prazna/);
  assert.deepStrictEqual(fs.readdirSync(praznaMapa), [], "nije ostala nikakva datoteka");

  // Tablica koja ne postoji: greška (kopija se ne smije tiho spremiti bez nje), a nepotpuna datoteka ne ostaje.
  const mapaGreska = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-backup-greska-"));
  const lomljen = { query: async (sql) => { if (/FROM app_data/.test(sql)) return { rows: redovi }; throw new Error('relation does not exist'); } };
  await assert.rejects(napraviKopiju({ pool: lomljen, mapa: mapaGreska, sada }), /relation does not exist/);
  assert.deepStrictEqual(fs.readdirSync(mapaGreska), [], "nepotpuna kopija se ne sprema");

  fs.rmSync(mapa, { recursive: true, force: true });
  fs.rmSync(praznaMapa, { recursive: true, force: true });
  fs.rmSync(mapaGreska, { recursive: true, force: true });
  console.log("backup-lokalno: svi testovi prolaze");
})().catch((e) => { console.error("backup-lokalno: TEST NIJE PROŠAO\n", e); process.exit(1); });

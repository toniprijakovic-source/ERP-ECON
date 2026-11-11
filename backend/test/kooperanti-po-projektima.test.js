// API test: Obračun plaća → Kooperanti → trošak po projektima. Ruta vraća SAMO sate kooperanata po projektu za mjesec (bez novca i bez drugih radnika),
// a samo onima koji smiju karticu Obračun plaća. Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3090); izmišljeni podaci.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_KOOP || 3090);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId, extra = {}) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15", ...extra });
const sat = (id, datum, zaposlenikId, radniNalogId, sati, extra = {}) => ({ id, datum, zaposlenikId, radniNalogId, sati, ...extra });
const seed = {
  zaposlenici: [zap("w1", "Obracun", "poz-obr"), zap("w2", "Otpremnik", "poz-otp"), zap("k1", "Kooperant1", "poz-koop", { satnicaKooperant: 10 }), zap("k2", "Kooperant2", "poz-koop", { satnicaKooperant: 14.5 }), zap("r1", "Radnik", "poz-radnik")],
  pozicijeZaposlenika: [
    { id: "poz-obr", naziv: "Računovodstvo", moduli: ["zaposlenici"] }, { id: "poz-otp", naziv: "Otpremnik", moduli: ["otpremnice"] },
    { id: "poz-koop", naziv: "Kooperant", moduli: [] }, { id: "poz-radnik", naziv: "Zaposlenik", moduli: [] },
  ],
  projekti: [{ id: "p1", sifra: "RN 99-01", naziv: "Prvi projekt" }, { id: "p2", sifra: "RN 99-02", naziv: "Drugi projekt" }, { id: "p3", sifra: "RN 99-03", naziv: "Neaktivan u listopadu" }],
  radniNalozi: [{ id: "n1", broj: "RN 99-01/1", projektId: "p1", faza: "Pila" }, { id: "n2", broj: "RN 99-02/1", projektId: "p2", faza: "Pila" }, { id: "n3", broj: "X/1", projektId: "", faza: "Ostalo" }, { id: "n4", broj: "RN 99-03/1", projektId: "p3", faza: "Pila" }],
  satiPoNalogu: [
    sat("1", "2026-10-05", "k1", "n1", 5), sat("2", "2026-10-06", "k1", "n1", 3), sat("3", "2026-10-06", "k1", "n2", 2), sat("4", "2026-10-07", "k2", "n1", 4),
    sat("5", "2026-11-02", "k1", "n1", 8), // drugi mjesec
    sat("6", "2026-10-07", "r1", "n1", 99), // nije kooperant
    sat("7", "2026-10-08", "k1", "stalni-P", 1, { projektId: "p2" }), // stalni posao vezan uz projekt → projekt
    sat("8", "2026-10-08", "k1", "stalni-S", 2), // stalni posao bez projekta
    sat("9", "2026-10-09", "k1", "n3", 1), // nalog bez projekta
    sat("10", "2026-10-09", "k1", "n4", 0), // nula sati
  ],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-koop-"));
const seedPutanja = path.join(mapa, "seed.json");
fs.writeFileSync(seedPutanja, JSON.stringify(seed));
const p = spawn(process.execPath, ["--require", path.join(__dirname, "lazni-pg-preload.js"), path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: String(PORT), JWT_SECRET: "test-tajna-samo-za-lokalni-test-0123456789", DATABASE_URL: "fake://lokalno", MOST_TOKEN: "", SEED_FILE: seedPutanja }, cwd: mapa });
const pocisti = (kod) => { p.once("exit", () => { try { fs.rmSync(mapa, { recursive: true, force: true }); } catch { /* privremena mapa ostaje */ } process.exit(kod); }); p.kill(); };
const dnevnik = [];
p.stdout.on("data", (d) => dnevnik.push(String(d)));
p.stderr.on("data", (d) => dnevnik.push(String(d)));
const h = async (metoda, ruta, tijelo, zaglavlja = {}) => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${ruta}`, { method: metoda, headers: { ...(tijelo !== undefined ? { "Content-Type": "application/json" } : {}), ...zaglavlja }, body: tijelo === undefined ? undefined : JSON.stringify(tijelo) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { s: r.status, j };
  } catch (e) { return { s: "PREKID", j: null }; }
};
let ok = 0, lose = 0;
const provjeri = (naziv, uvjet, detalj) => { (uvjet ? ok++ : lose++); console.log(`${uvjet ? "  ✔" : "  ✘"} ${naziv}${detalj !== undefined && !uvjet ? "  → " + detalj : ""}`); };

(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const prijava = async (id, ip) => { const r = await h("POST", "/api/auth/login", { zaposlenikId: id, lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": ip }); return { Authorization: `Bearer ${r.j?.token}` }; };
  const A = await prijava("w1", "198.51.100.91"), B = await prijava("w2", "198.51.100.92");
  const cijena = (r, z, k) => r.j.redovi.find((x) => x.zaposlenikId === z && x.kljuc === k)?.sati;

  console.log("\n— Sati kooperanata po projektima za listopad");
  let r = await h("GET", "/api/obracun/kooperanti-po-projektima?mjesec=2026-10", undefined, A);
  provjeri("odgovor 200", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);
  provjeri("  k1 na p1: 5 + 3 = 8 h", cijena(r, "k1", "p:p1") === 8, JSON.stringify(r.j?.redovi));
  provjeri("  k1 na p2: nalog 2 h + stalni posao s projektom 1 h = 3 h", cijena(r, "k1", "p:p2") === 3);
  provjeri("  k2 na p1: 4 h", cijena(r, "k2", "p:p1") === 4);
  provjeri("  stalni posao bez projekta: ključ s:stalni-S 2 h", cijena(r, "k1", "s:stalni-S") === 2);
  provjeri("  nalog bez projekta: ključ bez-projekta 1 h", cijena(r, "k1", "bez-projekta") === 1);
  provjeri("  drugi mjesec, nekooperant i nula sati se ne ubrajaju", !r.j.redovi.some((x) => x.zaposlenikId === "r1") && r.j.redovi.reduce((a, x) => a + x.sati, 0) === 18, String(r.j.redovi.reduce((a, x) => a + x.sati, 0)));
  provjeri("  popis projekata samo s kooperantskim satima (p1, p2), bez p3", JSON.stringify(r.j.projekti.map((x) => x.id).sort()) === JSON.stringify(["p1", "p2"]), JSON.stringify(r.j?.projekti));
  provjeri("  odgovor ne sadrži satnice ni iznose", !/satnica|iznos|trosak|cijena/i.test(JSON.stringify(r.j)));

  console.log("\n— Studeni i neispravan upit");
  r = await h("GET", "/api/obracun/kooperanti-po-projektima?mjesec=2026-11", undefined, A);
  provjeri("  studeni: samo k1 na p1 8 h", r.s === 200 && r.j.redovi.length === 1 && cijena(r, "k1", "p:p1") === 8, JSON.stringify(r.j?.redovi));
  r = await h("GET", "/api/obracun/kooperanti-po-projektima?mjesec=nije-mjesec", undefined, A);
  provjeri("  neispravan mjesec → 400", r.s === 400, `HTTP ${r.s}`);

  console.log("\n— Ovlasti");
  r = await h("GET", "/api/obracun/kooperanti-po-projektima?mjesec=2026-10", undefined, B);
  provjeri("  pozicija bez kartice Obračun plaća → 403", r.s === 403, `HTTP ${r.s}`);
  r = await h("GET", "/api/obracun/kooperanti-po-projektima?mjesec=2026-10");
  provjeri("  bez prijave → 401", r.s === 401, `HTTP ${r.s}`);

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-1500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

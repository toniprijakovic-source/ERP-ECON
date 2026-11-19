// API test: modul Direktorski pregled. Pri pokretanju ga dobivaju samo pozicije Direktor i Glavni administrator (migracija je idempotentna i ne vraća modul
// onome kome je oduzet), a pregled je samo za čitanje: podaci koje treba stižu preko /api/data, ali se ništa ne može upisati preko ovog modula.
// Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3094); izmišljeni podaci.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_DIR || 3094);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });
const seed = {
  zaposlenici: [zap("d1", "Direktor", "poz-direktor"), zap("a1", "Admin", "poz-administrator"), zap("v1", "Voditelj", "poz-voditelj-proizvodnje"), zap("n1", "Nabava", "poz-nabava")],
  // Voditelj proizvodnje i Nabava imaju svoje module, ali ne i direktorski pregled.
  pozicijeZaposlenika: [
    { id: "poz-direktor", naziv: "Direktor", moduli: ["dashboard", "projekti", "ponude"] },
    { id: "poz-administrator", naziv: "Glavni administrator", moduli: ["dashboard", "projekti", "zaposlenici"] },
    { id: "poz-voditelj-proizvodnje", naziv: "Voditelj proizvodnje", moduli: ["dashboard", "proizvodnja", "projekti"] },
    { id: "poz-nabava", naziv: "Nabava", moduli: ["nabava"] },
  ],
  projekti: [{ id: "p1", sifra: "RN 99-01", naziv: "Aktivni", status: "U izradi", vrijednost: 1000, kupacId: "k1", rokZavrsetka: "2026-12-31" }],
  radniNalozi: [{ id: "n1", projektId: "p1", status: "Planiran", planiranoSati: 10, utrosenoSati: 3 }],
  podlogeZaFakturu: [{ id: "pd1", projektId: "p1", zbroj: 250, otpremniceIds: [] }],
  narudzbenice: [], izdatnice: [], cmr: [], narudzbe: [], otpremnice: [], ponude: [], kupci: [{ id: "k1", naziv: "Kupac" }],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-dir-"));
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
  await new Promise((r) => setTimeout(r, 1800));
  const prijava = async (id, ip) => { const r = await h("POST", "/api/auth/login", { zaposlenikId: id, lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": ip }); return { Authorization: `Bearer ${r.j?.token}`, status: r.s }; };
  const D = await prijava("d1", "198.51.100.121"), A = await prijava("a1", "198.51.100.122"), V = await prijava("v1", "198.51.100.123"), N = await prijava("n1", "198.51.100.124");

  // Svi su se mogli prijaviti (zaglavlje Authorization nosi token).
  const zaglavlje = (x) => ({ Authorization: x.Authorization });

  console.log("\n— Migracija: modul Direktorski pregled dobivaju samo Direktor i Glavni administrator");
  let r = await h("GET", "/api/data/pozicijeZaposlenika", undefined, zaglavlje(A));
  const pozicije = r.j || [];
  const moduli = (id) => (pozicije.find((x) => x.id === id)?.moduli || []);
  provjeri("  pozicije se čitaju", r.s === 200 && pozicije.length === 4, `HTTP ${r.s}`);
  provjeri("  Direktor ima modul direktor", moduli("poz-direktor").includes("direktor"));
  provjeri("  Glavni administrator ima modul direktor", moduli("poz-administrator").includes("direktor"));
  provjeri("  Voditelj proizvodnje i Nabava ga nemaju", !moduli("poz-voditelj-proizvodnje").includes("direktor") && !moduli("poz-nabava").includes("direktor"));
  provjeri("  postojeći moduli nisu dirani", moduli("poz-direktor").join() === "dashboard,projekti,ponude,direktor", moduli("poz-direktor").join());

  console.log("\n— Podaci za pregled (čitanje)");
  const kljucevi = ["projekti", "radniNalozi", "podlogeZaFakturu", "narudzbenice", "izdatnice", "cmr", "narudzbe", "otpremnice", "ponude", "kupci", "zaposlenici"];
  for (const [ime, token] of [["Direktor", D], ["Glavni administrator", A]]) {
    const odgovori = await Promise.all(kljucevi.map((k) => h("GET", `/api/data/${k}`, undefined, zaglavlje(token))));
    provjeri(`  ${ime} čita sve ključeve pregleda`, odgovori.every((x) => x.s === 200), odgovori.map((x, i) => `${kljucevi[i]}:${x.s}`).join(" "));
  }
  r = await h("GET", "/api/data/podlogeZaFakturu", undefined, zaglavlje(D));
  provjeri("  Direktor vidi podloge za fakturu (zbroj)", r.s === 200 && r.j?.[0]?.zbroj === 250, `HTTP ${r.s}`);
  r = await h("GET", "/api/data/podlogeZaFakturu", undefined, zaglavlje(V));
  provjeri("  Voditelj proizvodnje NE vidi podloge za fakturu (nema modul)", r.s === 403, `HTTP ${r.s}`);
  r = await h("GET", "/api/data/podlogeZaFakturu", undefined, zaglavlje(N));
  provjeri("  Nabava NE vidi podloge za fakturu", r.s === 403, `HTTP ${r.s}`);

  console.log("\n— Pregled je samo za čitanje");
  r = await h("PUT", "/api/data/podlogeZaFakturu", [{ id: "pd1", projektId: "p1", zbroj: 1 }], zaglavlje(D));
  provjeri("  Direktor ne može pisati podloge preko ovog modula → 403", r.s === 403, `HTTP ${r.s}`);
  r = await h("GET", "/api/data/podlogeZaFakturu", undefined, zaglavlje(D));
  provjeri("  podloge nepromijenjene", r.j?.[0]?.zbroj === 250);
  r = await h("GET", "/api/data/podlogeZaFakturu");
  provjeri("  bez prijave → 401", r.s === 401, `HTTP ${r.s}`);

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-1500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

// API test: brojevi dokumenata u novoj godini (PON-2027-, LAS-2027-, NAR-2027-). Poslužitelj ne smije ostati vezan uz 2026.: novi broj nove godine se prihvaća,
// a zauzet broj (dvije osobe istodobno) dobiva sljedeći slobodan u istoj godini, bez dodira s brojevima prethodne godine.
// Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3093); izmišljeni podaci.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_BROJ || 3093);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });
const seed = {
  zaposlenici: [zap("w1", "Ponude", "poz-pon"), zap("w2", "Skladistar", "poz-skl")],
  pozicijeZaposlenika: [{ id: "poz-pon", naziv: "Ponude i nabava", moduli: ["ponude", "nabava"] }, { id: "poz-skl", naziv: "Skladištar", moduli: ["skladiste"] }],
  ponude: [{ id: "p1", broj: "PON-2026-040", naziv: "Stara" }],
  ponudeLasera: [{ id: "l1", broj: "LAS-2026-029", naziv: "Stara laser" }],
  narudzbenice: [{ id: "n1", broj: "NAR-2026-062", dobavljacId: "d1" }],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-brojevi-"));
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
  const A = await prijava("w1", "198.51.100.111"), B = await prijava("w2", "198.51.100.112");
  const brojevi = async (kljuc) => ((await h("GET", `/api/data/${kljuc}`, undefined, A)).j || []).map((x) => x.broj).join(",");

  const serije = [
    ["ponude", "/api/ponude/patch", "PON", "ponuda", { naziv: "x" }, "PON-2026-040"],
    ["ponudeLasera", "/api/ponudeLasera/patch", "LAS", "ponuda za laser", { naziv: "x" }, "LAS-2026-029"],
    ["narudzbenice", "/api/narudzbenice/patch", "NAR", "narudžbenica", { dobavljacId: "d1" }, "NAR-2026-062"],
  ];
  for (const [kljuc, ruta, oznaka, opis, dodatno, staraZadnja] of serije) {
    console.log(`\n— ${opis}: ${oznaka}-2027-`);
    let r = await h("PUT", ruta, { upsert: [{ id: "a2027", broj: `${oznaka}-2027-001`, ...dodatno }], remove: [] }, A);
    provjeri("  prvi broj nove godine se prihvaća", r.s === 200 && (await brojevi(kljuc)).endsWith(`${oznaka}-2027-001`), `HTTP ${r.s} ${r.j?.error || ""} ${await brojevi(kljuc)}`);
    provjeri("  broj prethodne godine ostaje netaknut", (await brojevi(kljuc)).startsWith(staraZadnja));
    // druga osoba istodobno dobila isti broj (zastarjeli preglednik) → sljedeći slobodan u 2027., ne u 2026.
    r = await h("PUT", ruta, { upsert: [{ id: "b2027", broj: `${oznaka}-2027-001`, ...dodatno }], remove: [] }, A);
    const nov = (r.j?.promijenjeniBrojevi || [])[0];
    provjeri("  zauzet broj → sljedeći slobodan 2027.", r.s === 200 && nov?.novo === `${oznaka}-2027-002`, JSON.stringify(r.j?.promijenjeniBrojevi));
    provjeri("  popis: stara godina + dva nova broja, bez duplikata", (await brojevi(kljuc)) === `${staraZadnja},${oznaka}-2027-001,${oznaka}-2027-002`, await brojevi(kljuc));
    r = await h("PUT", ruta, { upsert: [{ id: "c2026", broj: staraZadnja, ...dodatno }], remove: [] }, A);
    provjeri("  zauzet broj iz 2026. i dalje ide na sljedeći iz 2026.", r.s === 200 && (r.j?.promijenjeniBrojevi || [])[0]?.novo?.startsWith(`${oznaka}-2026-`) && (r.j?.promijenjeniBrojevi || [])[0]?.novo !== staraZadnja, JSON.stringify(r.j?.promijenjeniBrojevi));
  }

  console.log("\n— Ovlasti");
  let r = await h("PUT", "/api/ponude/patch", { upsert: [{ id: "x", broj: "PON-2027-099" }], remove: [] }, B);
  provjeri("  pozicija bez modula Ponude → 403", r.s === 403, `HTTP ${r.s}`);

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-1500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

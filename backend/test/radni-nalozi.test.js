// API test: radni nalog koji dobije sate automatski prelazi iz "Planiran" u "U tijeku". Pokretanje: `npm test` u mapi backend.
// PRAVI server.js s lažnim pg-om u memoriji (port 3087); svi podaci su izmišljeni.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_RN || 3087);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const nalog = (id, status, extra = {}) => ({ id, broj: `RN 99-01/${id.slice(1)}`, projektId: "p1", faza: "Pila", status, planiranoSati: 10, utrosenoSati: 0, ...extra });
const seed = {
  zaposlenici: [{ id: "w1", ime: "Ivo", prezime: "Radnik", status: "Aktivan", pozicijaId: "poz-zaposlenik", lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" }],
  pozicijeZaposlenika: [{ id: "poz-zaposlenik", naziv: "Zaposlenik", moduli: ["proizvodnja"] }],
  radniNalozi: [nalog("n1", "Planiran"), nalog("n2", "Pauziran"), nalog("n3", "Završen"), nalog("n4", "Planiran"), nalog("n5", "U tijeku")],
  satiPoNalogu: [],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-rn-"));
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
  const prijava = await h("POST", "/api/auth/login", { zaposlenikId: "w1", lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": "198.51.100.77" });
  const A = { Authorization: `Bearer ${prijava.j?.token}` };
  provjeri("prijava prolazi", !!prijava.j?.token);
  const status = async () => Object.fromEntries(((await h("GET", "/api/data/radniNalozi", undefined, A)).j || []).map((n) => [n.id, `${n.status}/${n.utrosenoSati}`]));

  console.log("\n— Sati preko /api/satiPoNalogu/patch");
  let r = await h("PUT", "/api/satiPoNalogu/patch", { upsert: [{ id: "s1", datum: "2026-11-09", zaposlenikId: "w1", radniNalogId: "n1", sati: 4 }, { id: "s2", datum: "2026-11-09", zaposlenikId: "w1", radniNalogId: "n2", sati: 3 }, { id: "s3", datum: "2026-11-09", zaposlenikId: "w1", radniNalogId: "n3", sati: 2 }] }, A);
  provjeri("spremanje sati prolazi", r.s === 200, `HTTP ${r.s}`);
  let st = await status();
  provjeri("  Planiran + sati → U tijeku (n1)", st.n1 === "U tijeku/4", st.n1);
  provjeri("  Pauziran ostaje Pauziran (n2)", st.n2 === "Pauziran/3", st.n2);
  provjeri("  Završen ostaje Završen (n3)", st.n3 === "Završen/2", st.n3);
  provjeri("  Planiran bez sati ostaje Planiran (n4)", st.n4 === "Planiran/0", st.n4);

  console.log("\n— Brisanje sati ne vraća status");
  r = await h("PUT", "/api/satiPoNalogu/patch", { remove: ["s1"] }, A);
  st = await status();
  provjeri("  n1 bez sati ostaje U tijeku (0 h)", st.n1 === "U tijeku/0", st.n1);

  console.log("\n— Stari preglednik šalje nalog kao Planiran (a sati postoje)");
  r = await h("PUT", "/api/satiPoNalogu/patch", { upsert: [{ id: "s4", datum: "2026-11-10", zaposlenikId: "w1", radniNalogId: "n4", sati: 1.5 }] }, A);
  r = await h("PUT", "/api/radniNalozi/patch", { upsert: [nalog("n4", "Planiran", { utrosenoSati: 0 })] }, A);
  provjeri("  spremanje naloga prolazi", r.s === 200, `HTTP ${r.s}`);
  st = await status();
  provjeri("  n4 se opet postavlja na U tijeku (sati 1,5)", st.n4 === "U tijeku/1.5", st.n4);

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-1500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

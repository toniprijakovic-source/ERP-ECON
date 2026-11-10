// API test: normativ kupaonica po projektu — promjena cijena jednog projekta / zadanog normativa ne mijenja postojeće projekte.
// Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om u memoriji (port 3089); svi podaci su izmišljeni.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_NORM || 3089);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const raspodjela = { pila: 50, laserProfili: 50 };
const grupe = (pod, komplet) => [
  { kljuc: "pod", naziv: "Pod (podna konstrukcija)", cijenaKg: String(pod), ucinakKgH: "16", raspodjela },
  { kljuc: "komplet", naziv: "Komplet (stranice)", cijenaKg: String(komplet), ucinakKgH: "10", raspodjela },
];
const seed = {
  zaposlenici: [
    { id: "w1", ime: "Ana", prezime: "Projekti", status: "Aktivan", pozicijaId: "poz-proj", lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" },
    { id: "w2", ime: "Ivo", prezime: "Otpremnik", status: "Aktivan", pozicijaId: "poz-otp", lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" },
  ],
  pozicijeZaposlenika: [{ id: "poz-proj", naziv: "Projekti", moduli: ["projekti"] }, { id: "poz-otp", naziv: "Otpremnik", moduli: ["otpremnice"] }],
  projekti: [
    { id: "p1", sifra: "RN 99-01", koristiNormativ: true, stavkePod: [{ id: "s1", oznaka: "A", masaJed: 100, komada: 2 }], stavkeKomplet: [] },
    { id: "p2", sifra: "RN 99-02", koristiNormativ: true, stavkePod: [], stavkeKomplet: [] },
    { id: "p3", sifra: "RN 99-03", koristiNormativ: false },
    { id: "p4", sifra: "RN 99-04", koristiNormativ: true, stavkePod: [], stavkeKomplet: [] },
  ],
  normativi: { naziv: "Kupaonice", grupe: grupe("3.15", "4.21"), poProjektima: { p4: { naziv: "Kupaonice", grupe: grupe("3.00", "4.00") } } },
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-norm-"));
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
const cijene = (n) => (n?.grupe || []).map((g) => g.cijenaKg).join("/");

(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const prijava = await h("POST", "/api/auth/login", { zaposlenikId: "w1", lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": "198.51.100.81" });
  const A = { Authorization: `Bearer ${prijava.j?.token}` };
  provjeri("prijava prolazi", !!prijava.j?.token);
  const prijava2 = await h("POST", "/api/auth/login", { zaposlenikId: "w2", lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": "198.51.100.82" });
  const B = { Authorization: `Bearer ${prijava2.j?.token}` };
  const norm = async () => (await h("GET", "/api/data/normativi", undefined, A)).j;

  console.log("\n— Vlastiti normativ jednog projekta");
  let r = await h("PUT", "/api/normativi/patch", { projektId: "p2", normativ: { naziv: "Kupaonice 2026-11", grupe: grupe("3.44", "4.69") } }, A);
  provjeri("spremanje prolazi", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);
  let n = await norm();
  provjeri("  p2 ima nove cijene", cijene(n.poProjektima.p2) === "3.44/4.69", cijene(n.poProjektima.p2));
  provjeri("  zadani normativ netaknut", cijene(n) === "3.15/4.21", cijene(n));
  provjeri("  p1 NIJE zamrznut (zadani nije mijenjan) i p4 zadržava svoj", !n.poProjektima.p1 && cijene(n.poProjektima.p4) === "3.00/4.00", JSON.stringify(Object.keys(n.poProjektima)));

  console.log("\n— Novi zadani normativ zamrzava projekte bez vlastitog normativa");
  r = await h("PUT", "/api/normativi/patch", { projektId: "p2", normativ: { naziv: "Kupaonice 2026-11", grupe: grupe("3.44", "4.69") }, zadano: { naziv: "Kupaonice 2026-11", grupe: grupe("3.44", "4.69") } }, A);
  provjeri("spremanje prolazi", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);
  n = await norm();
  provjeri("  zadani je sada nov", cijene(n) === "3.44/4.69", cijene(n));
  provjeri("  p1 zamrznut na STARIM cijenama", cijene(n.poProjektima.p1) === "3.15/4.21", cijene(n.poProjektima.p1));
  provjeri("  p4 ostaje na svome", cijene(n.poProjektima.p4) === "3.00/4.00", cijene(n.poProjektima.p4));
  provjeri("  p3 (nije po normativu) nema zapis", !n.poProjektima.p3);

  console.log("\n— Stari preglednik sprema cijeli normativ (obični PUT)");
  r = await h("PUT", "/api/data/normativi", { naziv: "Kupaonice 2027", grupe: grupe("3.60", "4.90") }, A);
  provjeri("spremanje prolazi", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);
  n = await norm();
  provjeri("  zadani promijenjen", cijene(n) === "3.60/4.90", cijene(n));
  provjeri("  vlastiti normativi svih projekata sačuvani", cijene(n.poProjektima.p1) === "3.15/4.21" && cijene(n.poProjektima.p2) === "3.44/4.69" && cijene(n.poProjektima.p4) === "3.00/4.00", JSON.stringify(n.poProjektima).slice(0, 200));

  console.log("\n— Nov projekt po normativu bez vlastitog zapisa se zamrzava kod sljedeće promjene zadanog");
  const projekti = (await h("GET", "/api/data/projekti", undefined, A)).j;
  await h("PUT", "/api/projekti/p3/patch", { patch: { koristiNormativ: true } }, A);
  n = await norm();
  provjeri("  p3 još nema zapis (koristi zadani)", !n.poProjektima.p3);
  await h("PUT", "/api/normativi/patch", { zadano: { naziv: "Kupaonice 2028", grupe: grupe("4.00", "5.00") } }, A);
  n = await norm();
  provjeri("  p3 zamrznut na cijenama koje su vrijedile (3.60/4.90)", cijene(n.poProjektima.p3) === "3.60/4.90", cijene(n.poProjektima.p3));
  provjeri("  popis projekata nije dirnut", projekti.length === 4);

  console.log("\n— Provjere unosa i ovlasti");
  r = await h("PUT", "/api/normativi/patch", { projektId: "p2", normativ: { naziv: "x", grupe: [{ ...grupe("3", "4")[0], raspodjela: { pila: 50 } }, grupe("3", "4")[1]] } }, A);
  provjeri("  raspodjela ne daje 100% → 400", r.s === 400 && /100%/.test(r.j?.error || ""), `HTTP ${r.s} ${r.j?.error}`);
  r = await h("PUT", "/api/normativi/patch", { projektId: "p2", normativ: { naziv: "x", grupe: grupe("-1", "4") } }, A);
  provjeri("  negativna cijena → 400", r.s === 400, `HTTP ${r.s} ${r.j?.error}`);
  r = await h("PUT", "/api/normativi/patch", { projektId: "nepostoji", normativ: { naziv: "x", grupe: grupe("3", "4") } }, A);
  provjeri("  nepoznat projekt → 404", r.s === 404, `HTTP ${r.s}`);
  r = await h("PUT", "/api/normativi/patch", { projektId: "p2", normativ: { naziv: "x", grupe: grupe("3", "4") } }, B);
  provjeri("  pozicija bez ovlasti za normativ → 403", r.s === 403, `HTTP ${r.s}`);
  n = await norm();
  provjeri("  nakon odbijenih zahtjeva ništa nije promijenjeno", cijene(n.poProjektima.p2) === "3.44/4.69" && cijene(n) === "4.00/5.00", cijene(n.poProjektima.p2));

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-1500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

// API test: skidanje sati radniku (PUT /api/korekcijeSati/patch, korekcije-sati.js). Posebna dozvola je po zadanom isključena, razlog je obavezan,
// sati po pola sata i ne više od prisutnosti, izmjena i brisanje čuvaju povijest, cijeli popis se ne smije spremiti. PRAVI server.js s lažnim pg-om (port 3091).
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_KS || 3091);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });
const seed = {
  zaposlenici: [zap("w1", "Voditelj", "poz-voditelj"), zap("w2", "Unos", "poz-unos"), zap("w3", "Radnik", "poz-radnik"), zap("w4", "Citac", "poz-citac"), zap("w5", "Nabava", "poz-nabava")],
  pozicijeZaposlenika: [
    { id: "poz-voditelj", naziv: "Voditelj proizvodnje", moduli: ["evidencijasati"], karticeDozvole: { evidencijasati: { skidanjesati: { pristup: true } } } },
    { id: "poz-unos", naziv: "Unos sati", moduli: ["evidencijasati"] },
    { id: "poz-radnik", naziv: "Zaposlenik", moduli: ["dashboard"] },
    // ima kvačicu za skidanje, ali kartica Sati po nalozima je samo za čitanje → ne smije skidati
    { id: "poz-citac", naziv: "Čitač", moduli: ["evidencijasati"], karticeDozvole: { evidencijasati: { satinalozi: { pristup: true, izmjene: false }, skidanjesati: { pristup: true } } } },
    { id: "poz-nabava", naziv: "Nabava", moduli: ["nabava"] },
  ],
  evidencijaRada: [
    { id: "e1", zaposlenikId: "w3", vrijemeDolaska: "2026-11-20T06:00:00", vrijemeOdlaska: "2026-11-20T14:00:00", vrsta: "rad" },
    { id: "e2", zaposlenikId: "w3", vrijemeDolaska: "2026-11-21T00:00:00", vrijemeOdlaska: "2026-11-21T00:00:00", vrsta: "godisnji" },
  ],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-ks-"));
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
  const prijava = async (id, ip) => ({ Authorization: `Bearer ${(await h("POST", "/api/auth/login", { zaposlenikId: id, lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": ip })).j?.token}` });
  const V = await prijava("w1", "198.51.100.91");
  const U = await prijava("w2", "198.51.100.92");
  const C = await prijava("w4", "198.51.100.94");
  const N = await prijava("w5", "198.51.100.95");
  const skini = (zaglavlja, z) => h("PUT", "/api/korekcijeSati/patch", { upsert: [z] }, zaglavlja);
  const aktivni = (popis) => (popis || []).filter((k) => !k.obrisano);

  console.log("\n— Dozvola");
  let r = await skini(U, { zaposlenikId: "w3", datum: "2026-11-20", sati: 1, razlog: "zabušavanje" });
  provjeri("bez posebne dozvole → 403 (po zadanom isključeno)", r.s === 403, `HTTP ${r.s}`);
  r = await skini(C, { zaposlenikId: "w3", datum: "2026-11-20", sati: 1, razlog: "zabušavanje" });
  provjeri("kvačica bez izmjena kartice Sati po nalozima → 403", r.s === 403, `HTTP ${r.s}`);
  r = await skini(N, { zaposlenikId: "w3", datum: "2026-11-20", sati: 1, razlog: "zabušavanje" });
  provjeri("pozicija bez modula Evidencija sati → 403", r.s === 403, `HTTP ${r.s}`);

  console.log("\n— Provjera unosa");
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-20", sati: 1, razlog: "  " });
  provjeri("bez razloga → 400", r.s === 400 && /razlog/i.test(r.j?.error || ""), `HTTP ${r.s} ${r.j?.error}`);
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-20", sati: 0.3, razlog: "x" });
  provjeri("0,3 h → 400 (samo po pola sata)", r.s === 400, `HTTP ${r.s}`);
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-20", sati: 8.5, razlog: "x" });
  provjeri("više od prisutnosti (8 h) → 400", r.s === 400, `HTTP ${r.s}`);
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-21", sati: 1, razlog: "x" });
  provjeri("dan bez prijave (godišnji) → 400", r.s === 400, `HTTP ${r.s}`);
  r = await skini(V, { zaposlenikId: "nepostoji", datum: "2026-11-20", sati: 1, razlog: "x" });
  provjeri("nepoznat radnik → 400", r.s === 400, `HTTP ${r.s}`);
  r = await skini(V, { zaposlenikId: "w3", datum: "2099-01-05", sati: 1, razlog: "x" });
  provjeri("budući dan → 400", r.s === 400, `HTTP ${r.s}`);
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-20", sati: -1, razlog: "x" });
  provjeri("negativni sati → 400", r.s === 400, `HTTP ${r.s}`);

  console.log("\n— Upis, izmjena, brisanje");
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-20", sati: 1, razlog: "zabušavanje kod brušenja" });
  const prvi = aktivni(r.j?.korekcijeSati)[0];
  provjeri("upis 1 h s razlogom → 200", r.s === 200 && prvi?.sati === 1 && prvi?.razlog === "zabušavanje kod brušenja", JSON.stringify(r.j));
  provjeri("  tko i kada upisuje poslužitelj", prvi?.unioId === "w1" && !!prvi?.unioVrijeme && prvi?.povijest?.length === 1 && prvi.povijest[0].radnja === "upis");
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-20", sati: 1.5, razlog: "zabušavanje kod brušenja" });
  const drugi = aktivni(r.j?.korekcijeSati);
  provjeri("izmjena na 1,5 h: isti zapis, jedan aktivni", r.s === 200 && drugi.length === 1 && drugi[0].id === prvi?.id && drugi[0].sati === 1.5, JSON.stringify(r.j));
  provjeri("  povijest ima upis i izmjenu", drugi[0]?.povijest?.map((x) => x.radnja).join(",") === "upis,izmjena" && drugi[0]?.promijenioId === "w1");
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-20", sati: 1.5, razlog: "zabušavanje kod brušenja" });
  provjeri("isti unos ponovno: bez nove stavke povijesti", r.s === 200 && aktivni(r.j?.korekcijeSati)[0]?.povijest?.length === 2);
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-20", sati: 0, razlog: "" });
  provjeri("0 h briše: nema aktivnog zapisa", r.s === 200 && aktivni(r.j?.korekcijeSati).length === 0, JSON.stringify(r.j));
  const obrisan = (r.j?.korekcijeSati || []).find((k) => k.id === prvi?.id);
  provjeri("  obrisani zapis ostaje s poviješću", obrisan?.obrisano === true && obrisan?.obrisaoId === "w1" && obrisan?.povijest?.length === 3 && obrisan.povijest[2].radnja === "brisanje");
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-20", sati: 0, razlog: "" });
  provjeri("brisanje kad nema aktivnog → 200 bez promjene", r.s === 200 && (r.j?.korekcijeSati || []).length === 1);
  r = await skini(V, { zaposlenikId: "w3", datum: "2026-11-20", sati: 2, razlog: "ponovno" });
  provjeri("ponovni upis nakon brisanja → novi zapis", r.s === 200 && aktivni(r.j?.korekcijeSati).length === 1 && aktivni(r.j?.korekcijeSati)[0].id !== prvi?.id && (r.j?.korekcijeSati || []).length === 2);

  console.log("\n— Čitanje i zaštita popisa");
  r = await h("PUT", "/api/data/korekcijeSati", [], V);
  provjeri("cijeli popis se ne smije spremiti (PUT /api/data) → 400", r.s === 400, `HTTP ${r.s}`);
  r = await h("GET", "/api/data", undefined, U);
  provjeri("Sati po nalozima čita korekcije (za raspodjelu i usklađenost)", aktivni(r.j?.korekcijeSati).length === 1, JSON.stringify(r.j?.korekcijeSati));
  r = await h("GET", "/api/data", undefined, N);
  provjeri("pozicija bez Evidencije sati ne dobiva korekcije", Array.isArray(r.j?.korekcijeSati) && r.j.korekcijeSati.length === 0, JSON.stringify(r.j?.korekcijeSati));
  r = await h("GET", "/api/data/evidencijaRada", undefined, V);
  const e1 = (r.j || []).find((e) => e.id === "e1");
  provjeri("vrijeme s kioska ostaje netaknuto (06:00–14:00)", e1?.vrijemeDolaska === "2026-11-20T06:00:00" && e1?.vrijemeOdlaska === "2026-11-20T14:00:00", JSON.stringify(e1));

  console.log(`\nUkupno: ${ok} prošlo, ${lose} palo`);
  if (lose) console.log(dnevnik.join("").slice(-3000));
  pocisti(lose ? 1 : 0);
})();

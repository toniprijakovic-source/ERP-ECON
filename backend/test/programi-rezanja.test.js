// API test: ciljano spremanje programa rezanja (Plan rezanja → laser). Zastarjela kopija preglednika ne smije vratiti program na staro stanje (10.11.2026.:
// 180-74-90x90 vraćen na "Pauzirano", pa se ~2 h 15 min rezanja nije zabilježilo), a red čekanja (redoslijed popisa) mora se moći mijenjati.
// Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3091); izmišljeni podaci.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_PROG || 3091);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });
const pr = (id, extra = {}) => ({ id, stroj: "laserProfili", brojPrograma: id.toUpperCase(), trajanjeMin: 100, status: "Na čekanju", odradjenoMin: 0, segmentPocetak: null, operaterId: "", stavkeMaterijala: [], ...extra });
const seed = {
  zaposlenici: [zap("w1", "Operater", "poz-laser"), zap("w2", "Skladistar", "poz-skl")],
  pozicijeZaposlenika: [{ id: "poz-laser", naziv: "Operater lasera", moduli: ["proizvodnja"] }, { id: "poz-skl", naziv: "Skladištar", moduli: ["skladiste"] }],
  programiRezanja: [
    pr("a"),
    pr("b", { status: "Početak", odradjenoMin: 45, segmentPocetak: "2026-11-10T10:05:15.751Z", operaterId: "w1" }), // program koji operater upravo vodi
    pr("c"),
  ],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-prog-"));
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
  const A = await prijava("w1", "198.51.100.101"), B = await prijava("w2", "198.51.100.102");
  const spremljeno = async () => (await h("GET", "/api/data/programiRezanja", undefined, A)).j || [];
  const redoslijed = async () => (await spremljeno()).map((x) => x.id).join(",");
  const patch = (tijelo, z = A) => h("PUT", "/api/programiRezanja/patch", tijelo, z);

  console.log("\n— Zastarjela kopija dodaje program (jučerašnji slučaj)");
  // Preglednik je popis učitao dok je program "b" bio pauziran; sada šalje samo NOVI program.
  let r = await patch({ upsert: [pr("d", { brojPrograma: "170-331-L150x100" })], remove: [] });
  provjeri("  odgovor 200", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);
  let popis = await spremljeno();
  const b = popis.find((x) => x.id === "b");
  provjeri("  program koji se vodi ostaje 'Početak' s početkom segmenta i odrađenih 45 min", b?.status === "Početak" && b?.segmentPocetak === "2026-11-10T10:05:15.751Z" && b?.odradjenoMin === 45, JSON.stringify(b));
  provjeri("  novi program je dodan na kraj", (await redoslijed()) === "a,b,c,d", await redoslijed());
  provjeri("  odgovor vraća cijeli popis s tuđim izmjenama", Array.isArray(r.j?.programiRezanja) && r.j.programiRezanja.length === 4);

  console.log("\n— Izmjena jednog programa ne dira ostale");
  r = await patch({ upsert: [{ ...b, status: "Pauzirano", odradjenoMin: 216, segmentPocetak: null }], remove: [] });
  popis = await spremljeno();
  provjeri("  b je pauziran s 216 min", popis.find((x) => x.id === "b")?.status === "Pauzirano" && popis.find((x) => x.id === "b")?.odradjenoMin === 216);
  provjeri("  a, c i d su nepromijenjeni, redoslijed isti", (await redoslijed()) === "a,b,c,d" && popis.find((x) => x.id === "a")?.status === "Na čekanju");

  console.log("\n— Red čekanja: pomak programa");
  r = await patch({ upsert: [], remove: [], redoslijed: ["a", "c", "b", "d"] });
  provjeri("  pomak c ispred b", r.s === 200 && (await redoslijed()) === "a,c,b,d", await redoslijed());
  provjeri("  odgovor nosi novi redoslijed", r.j?.programiRezanja?.map((x) => x.id).join(",") === "a,c,b,d");

  console.log("\n— Redoslijed iz zastarjele kopije ne dira programe koje preglednik ne poznaje");
  // Netko je u međuvremenu dodao 'e' (preglednik ga ne poznaje) pa se obrće redoslijed a, c, b.
  await patch({ upsert: [pr("e")], remove: [] });
  r = await patch({ upsert: [], remove: [], redoslijed: ["b", "c", "a"] });
  provjeri("  a, b, c zamijenjena mjesta, d i e ostaju gdje jesu", r.s === 200 && (await redoslijed()) === "b,c,a,d,e", await redoslijed());

  console.log("\n— Nastavak umetnut iza podijeljenog programa");
  const poz = (await spremljeno()).find((x) => x.id === "b");
  r = await patch({ upsert: [{ ...poz, status: "Završeno" }, pr("b-01", { brojPrograma: "B/01", trajanjeMin: 60 })], remove: [], redoslijed: ["b", "b-01", "c", "a", "d"] });
  // Preglednik ne poznaje 'e' (dodao ga je netko drugi): 'e' ostaje na svom mjestu, a poznati programi se slažu u preostala mjesta.
  provjeri("  nastavak je odmah iza podijeljenog programa, tuđi program 'e' ostaje na svom mjestu", r.s === 200 && (await redoslijed()) === "b,b-01,c,a,e,d", await redoslijed());

  console.log("\n— Brisanje");
  r = await patch({ upsert: [], remove: ["d", "ne-postoji"] });
  provjeri("  program obrisan, nepostojeći id se ignorira", r.s === 200 && (await redoslijed()) === "b,b-01,c,a,e", await redoslijed());

  console.log("\n— Neispravan redoslijed se ignorira");
  r = await patch({ upsert: [], remove: [], redoslijed: "nije-popis" });
  provjeri("  redoslijed koji nije popis → ništa se ne mijenja", r.s === 200 && (await redoslijed()) === "b,b-01,c,a,e", await redoslijed());
  r = await patch({ upsert: [], remove: [], redoslijed: [1, null, {}, "a"] });
  provjeri("  redoslijed s jednim valjanim id-em → ništa se ne mijenja", r.s === 200 && (await redoslijed()) === "b,b-01,c,a,e", await redoslijed());

  console.log("\n— Ovlasti");
  r = await patch({ upsert: [pr("x")], remove: [] }, B);
  provjeri("  pozicija bez modula Proizvodnja → 403", r.s === 403, `HTTP ${r.s}`);
  provjeri("  program nije dodan", !(await spremljeno()).some((x) => x.id === "x"));
  r = await h("PUT", "/api/programiRezanja/patch", { upsert: [], remove: [] });
  provjeri("  bez prijave → 401", r.s === 401, `HTTP ${r.s}`);

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-1500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

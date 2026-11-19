// API test: pridruživanje prihvaćene ponude POSTOJEĆEM projektu (dodatak umjesto novog projekta). Dodatak se PRIBRAJA na aktualni zapis projekta,
// ista ponuda ne smije dvaput ući ni u koji projekt, zatvoreni projekti i neprihvaćene ponude se odbijaju, neispravan dodatak ne mijenja ništa.
// Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3092); izmišljeni podaci.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_PUP || 3092);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });
const pon = (id, broj, extra = {}) => ({ id, broj, naziv: "Posao " + broj, datum: "2026-11-10", status: "Prihvaćena", projektId: null, ...extra });
const seed = {
  zaposlenici: [zap("w1", "Projekti", "poz-proj"), zap("w2", "Otpremnik", "poz-otp")],
  pozicijeZaposlenika: [{ id: "poz-proj", naziv: "Projekti", moduli: ["projekti", "ponude"] }, { id: "poz-otp", naziv: "Otpremnik", moduli: ["otpremnice"] }],
  projekti: [
    { id: "p1", sifra: "RN 99-01", naziv: "Aktivni projekt", status: "U izradi", vrijednost: 1000, faze: { Pila: 10, Zavarivanje: 5 }, pozicije: [{ id: "pz-stara", naziv: "Stara pozicija" }], materijalStavke: [], ostaleStavke: [] },
    { id: "p2", sifra: "RN 99-02", naziv: "Završeni", status: "Završen", vrijednost: 500, faze: {} },
    { id: "p3", sifra: "RN 99-03", naziv: "Otkazani", status: "Otkazan", vrijednost: 500, faze: {} },
    { id: "p4", sifra: "RN 99-04", naziv: "Drugi aktivni", status: "Odobren", vrijednost: 200 },
    { id: "p5", sifra: "RN 99-05", naziv: "Arhivirani", status: "Arhiviran", vrijednost: 300, faze: {} },
  ],
  ponude: [
    pon("o1", "PON-2026-901"),
    pon("o2", "PON-2026-902", { status: "Poslana" }),
    pon("o3", "PON-2026-903", { projektId: "p4" }),
    pon("o4", "PON-2026-904"),
    pon("o5", "PON-2026-905"),
  ],
  ponudeLasera: [pon("l1", "LAS-2026-901")],
  cmr: [{ id: "c1", broj: "CMR-14-10-1/26", projektId: "p1", datum: "2026-10-14" }],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-pup-"));
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
  const projekt = async (id) => ((await h("GET", "/api/data/projekti", undefined, A)).j || []).find((x) => x.id === id);
  const ponude = async (kljuc = "ponude") => (await h("GET", `/api/data/${kljuc}`, undefined, A)).j || [];
  const pridruzi = (projektId, tijelo, z = A) => h("PUT", `/api/projekti/${projektId}/pridruzi-ponudu`, tijelo, z);
  const dodatak = (extra = {}) => ({
    vrijednost: 500, faze: { Pila: 8.5, "Laser za limove": 4, Bojanje: 0 },
    pozicije: [{ id: "pz-nova", naziv: "Nova pozicija", kolicina: 3 }],
    materijalStavke: [{ id: "m1", kolicina: 12, izPonude: true }], ostaleStavke: [{ opis: "Transport", kolicina: 1, cijenaJed: 80 }], ...extra,
  });

  console.log("\n— Pridruživanje prihvaćene ponude aktivnom projektu");
  let r = await pridruzi("p1", { ponudaId: "o1", tip: "standard", dodatak: dodatak() });
  provjeri("  odgovor 200", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);
  let p1 = await projekt("p1");
  provjeri("  vrijednost je pribrojena (1000 + 500)", p1?.vrijednost === 1500, String(p1?.vrijednost));
  provjeri("  sati po fazama pribrojeni, nova faza dodana, nulte faze se ne dodaju, ostale nedirnute", p1?.faze?.Pila === 18.5 && p1?.faze?.["Laser za limove"] === 4 && p1?.faze?.Zavarivanje === 5 && !("Bojanje" in p1.faze), JSON.stringify(p1?.faze));
  provjeri("  stare pozicije ostaju, nova je dodana s oznakom ponude", p1?.pozicije?.length === 2 && p1.pozicije[0].id === "pz-stara" && p1.pozicije[1].izPonudeBroj === "PON-2026-901");
  provjeri("  materijal i ostale stavke dodani s oznakom ponude", p1?.materijalStavke?.[0]?.izPonudeBroj === "PON-2026-901" && p1?.ostaleStavke?.[0]?.izPonudeBroj === "PON-2026-901");
  provjeri("  zapis o pridruženoj ponudi (broj, tip, vrijednost, tko)", p1?.pridruzenePonude?.length === 1 && p1.pridruzenePonude[0].broj === "PON-2026-901" && p1.pridruzenePonude[0].tip === "standard" && p1.pridruzenePonude[0].vrijednost === 500 && p1.pridruzenePonude[0].pridruzioId === "w1", JSON.stringify(p1?.pridruzenePonude));
  provjeri("  osnovni podaci projekta nepromijenjeni", p1?.sifra === "RN 99-01" && p1?.naziv === "Aktivni projekt" && p1?.status === "U izradi");
  provjeri("  ponuda je povezana s projektom (u istoj transakciji)", (await ponude()).find((x) => x.id === "o1")?.projektId === "p1");
  provjeri("  odgovor nosi i popis ponuda s vezom", r.j?.ponude?.find((x) => x.id === "o1")?.projektId === "p1");

  console.log("\n— Ista ponuda se ne može pridružiti dvaput");
  r = await pridruzi("p1", { ponudaId: "o1", tip: "standard", dodatak: dodatak() });
  provjeri("  drugi put → 409", r.s === 409, `HTTP ${r.s}`);
  provjeri("  vrijednost nije udvostručena", (await projekt("p1"))?.vrijednost === 1500);
  r = await pridruzi("p4", { ponudaId: "o1", tip: "standard", dodatak: dodatak() });
  provjeri("  ni drugom projektu → 409 s brojem projekta", r.s === 409 && /RN 99-01/.test(r.j?.error || ""), `HTTP ${r.s} ${r.j?.error}`);
  provjeri("  drugi projekt nedirnut", (await projekt("p4"))?.vrijednost === 200 && !(await projekt("p4"))?.pridruzenePonude);
  r = await pridruzi("p4", { ponudaId: "o3", tip: "standard", dodatak: dodatak() });
  provjeri("  ponuda koja je već pretvorena u projekt → 409", r.s === 409, `HTTP ${r.s}`);

  console.log("\n— Dodatak se pribraja na aktualno stanje (ne prepisuje)");
  r = await pridruzi("p1", { ponudaId: "o4", tip: "standard", dodatak: dodatak({ vrijednost: 200, faze: { Pila: 1.5 }, pozicije: [], materijalStavke: [], ostaleStavke: [] }) });
  p1 = await projekt("p1");
  provjeri("  druga ponuda: vrijednost 1500 + 200", r.s === 200 && p1?.vrijednost === 1700, String(p1?.vrijednost));
  provjeri("  druga ponuda: Pila 18,5 + 1,5 = 20", p1?.faze?.Pila === 20, String(p1?.faze?.Pila));
  provjeri("  dvije pridružene ponude u zapisu", p1?.pridruzenePonude?.map((x) => x.broj).join(",") === "PON-2026-901,PON-2026-904");

  console.log("\n— Laserska ponuda");
  r = await pridruzi("p4", { ponudaId: "l1", tip: "laser", dodatak: dodatak({ vrijednost: 300, faze: { "Laser za profile": 2.5 }, pozicije: [], materijalStavke: [], ostaleStavke: [] }) });
  const p4 = await projekt("p4");
  provjeri("  200, vrijednost 200 + 300, faza laser dodana", r.s === 200 && p4?.vrijednost === 500 && p4?.faze?.["Laser za profile"] === 2.5, `HTTP ${r.s} ${r.j?.error || ""} ${JSON.stringify(p4)}`);
  provjeri("  zapis ima tip 'laser', a veza je na ponudi za laser", p4?.pridruzenePonude?.[0]?.tip === "laser" && (await ponude("ponudeLasera")).find((x) => x.id === "l1")?.projektId === "p4");
  provjeri("  standardna ponuda istog id-a se ne dira (veza samo u pravom popisu)", (await ponude()).every((x) => x.id !== "l1"));

  console.log("\n— Odbijanja");
  r = await pridruzi("p2", { ponudaId: "o5", tip: "standard", dodatak: dodatak() });
  provjeri("  završen projekt → 409", r.s === 409, `HTTP ${r.s}`);
  r = await pridruzi("p5", { ponudaId: "o5", tip: "standard", dodatak: dodatak() });
  provjeri("  arhiviran projekt → 409 uz objašnjenje", r.s === 409 && /arhiviran/.test(r.j?.error || ""), `HTTP ${r.s} ${r.j?.error}`);
  r = await pridruzi("p3", { ponudaId: "o5", tip: "standard", dodatak: dodatak() });
  provjeri("  otkazan projekt → 409", r.s === 409, `HTTP ${r.s}`);
  provjeri("  ponuda o5 ostaje slobodna", (await ponude()).find((x) => x.id === "o5")?.projektId === null);
  r = await pridruzi("p1", { ponudaId: "o2", tip: "standard", dodatak: dodatak() });
  provjeri("  ponuda koja nije prihvaćena → 409", r.s === 409, `HTTP ${r.s}`);
  r = await pridruzi("p1", { ponudaId: "nema", tip: "standard", dodatak: dodatak() });
  provjeri("  nepostojeća ponuda → 404", r.s === 404, `HTTP ${r.s}`);
  r = await pridruzi("nema", { ponudaId: "o5", tip: "standard", dodatak: dodatak() });
  provjeri("  nepostojeći projekt → 404", r.s === 404, `HTTP ${r.s}`);

  console.log("\n— Neispravan dodatak ne mijenja ništa");
  const prije = JSON.stringify(await projekt("p1"));
  for (const [naziv, losi] of [
    ["negativna vrijednost", dodatak({ vrijednost: -5 })],
    ["vrijednost nije broj", dodatak({ vrijednost: "abc" })],
    ["sati faze negativni", dodatak({ faze: { Pila: -1 } })],
    ["opasan naziv faze", dodatak({ faze: JSON.parse('{"__proto__": 5}') })],
    ["pozicije nisu popis", dodatak({ pozicije: "nije popis" })],
    ["stavka popisa nije objekt", dodatak({ ostaleStavke: [1, 2] })],
    ["bez dodatka", undefined],
  ]) {
    r = await pridruzi("p1", { ponudaId: "o5", tip: "standard", dodatak: losi });
    provjeri(`  ${naziv} → 400`, r.s === 400, `HTTP ${r.s} ${r.j?.error || ""}`);
  }
  provjeri("  projekt nepromijenjen, ponuda o5 slobodna", JSON.stringify(await projekt("p1")) === prije && (await ponude()).find((x) => x.id === "o5")?.projektId === null);

  console.log("\n— Rokovi i statusi: isporuke");
  r = await h("GET", "/api/data/cmr", undefined, A);
  provjeri("  pozicija s modulom Projekti čita CMR (prijedlog statusa po isporuci)", r.s === 200 && Array.isArray(r.j) && r.j.length === 1, `HTTP ${r.s}`);

  console.log("\n— Ovlasti");
  r = await pridruzi("p1", { ponudaId: "o5", tip: "standard", dodatak: dodatak() }, B);
  provjeri("  pozicija bez modula Projekti → 403", r.s === 403, `HTTP ${r.s}`);
  r = await h("PUT", "/api/projekti/p1/pridruzi-ponudu", { ponudaId: "o5", tip: "standard", dodatak: dodatak() });
  provjeri("  bez prijave → 401", r.s === 401, `HTTP ${r.s}`);
  provjeri("  nakon svega ponuda o5 i projekt p1 nedirnuti", (await ponude()).find((x) => x.id === "o5")?.projektId === null && JSON.stringify(await projekt("p1")) === prije);

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-1500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

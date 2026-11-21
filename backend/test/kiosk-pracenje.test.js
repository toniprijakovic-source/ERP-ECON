// API test: praćenje kioska — ping s oznakom uređaja, popis tek nakon 3 signala, ovlasti, preimenovanje i uklanjanje, granica broja uređaja.
// Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3096); izmišljeni podaci.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const { opisUredaja } = require("../kiosk-pracenje");
const PORT = Number(process.env.TEST_PORT_KIOSK || 3096);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });
const seed = {
  zaposlenici: [zap("e1", "Evidencija", "poz-evidencija"), zap("e2", "EvidencijaCitanje", "poz-evidencija-citanje"), zap("u1", "Ured", "poz-ured")],
  pozicijeZaposlenika: [
    { id: "poz-evidencija", naziv: "Evidencija", moduli: ["dashboard", "evidencijasati"] },
    { id: "poz-evidencija-citanje", naziv: "Evidencija (samo pregled)", moduli: ["dashboard", "evidencijasati"], karticeDozvole: { evidencijasati: { evidencija: { pristup: true, izmjene: false } } } },
    { id: "poz-ured", naziv: "Ured", moduli: ["dashboard", "projekti"] },
  ],
  projekti: [], evidencijaRada: [], praznici: [],
};
// opis uređaja iz User-Agent zaglavlja (čista funkcija)
assert.strictEqual(opisUredaja("Mozilla/5.0 (Linux; Android 14; SM-X306B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"), "Android tablet · Chrome");
assert.strictEqual(opisUredaja("Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36"), "Android mobitel · Chrome");
assert.strictEqual(opisUredaja("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"), "Windows · Firefox");
assert.strictEqual(opisUredaja("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0"), "Windows · Edge");
assert.strictEqual(opisUredaja(""), "nepoznat uređaj");

const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-kiosk-"));
const seedPutanja = path.join(mapa, "seed.json");
fs.writeFileSync(seedPutanja, JSON.stringify(seed));
const p = spawn(process.execPath, ["--require", path.join(__dirname, "lazni-pg-preload.js"), path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: String(PORT), JWT_SECRET: "test-tajna-samo-za-lokalni-test-0123456789", DATABASE_URL: "fake://lokalno", MOST_TOKEN: "", SEED_FILE: seedPutanja, KIOSK_RAZMAK_UPISA_MS: "0" }, cwd: mapa });
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
const UA_TABLET = { "User-Agent": "Mozilla/5.0 (Linux; Android 14; SM-X306B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" };
const pauza = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await pauza(1800);
  const prijava = async (id, ip) => { const r = await h("POST", "/api/auth/login", { zaposlenikId: id, lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": ip }); return { Authorization: `Bearer ${r.j?.token}` }; };
  const E1 = await prijava("e1", "198.51.100.141"), E2 = await prijava("e2", "198.51.100.142"), U1 = await prijava("u1", "198.51.100.143");
  // ping je asinkron nakon odgovora — kratka pauza prije čitanja popisa
  const ping = async (id, vrsta, zaglavlja = UA_TABLET) => { const r = await h("GET", `/api/kiosk/ping?id=${id}${vrsta ? `&vrsta=${vrsta}` : ""}`, undefined, zaglavlja); await pauza(40); return r; };
  const popis = async () => (await h("GET", "/api/kiosk/uredaji", undefined, E1)).j?.uredaji || [];

  console.log("\n— Ping");
  let r = await h("GET", "/api/kiosk/ping");
  provjeri("  ping bez oznake odgovara (drži poslužitelj budnim)", r.s === 200 && r.j?.ok === true, JSON.stringify(r));
  r = await ping("ima razmak!");
  provjeri("  neispravna oznaka uređaja odgovara 200, ali se ne bilježi", r.s === 200 && (await popis()).length === 0);
  await ping("kiosk-ulaz-1", "evidencija"); await ping("kiosk-ulaz-1", "evidencija");
  provjeri("  uređaj s 2 signala još nije na popisu (posjetitelj koji samo otvori stranicu ne ulazi)", (await popis()).length === 0);
  await ping("kiosk-ulaz-1", "evidencija");
  let u = await popis();
  provjeri("  nakon 3 signala uređaj je na popisu s opisom iz zaglavlja", u.length === 1 && u[0].id === "kiosk-ulaz-1" && u[0].signala === 3 && u[0].uredaj === "Android tablet · Chrome" && u[0].vrsta === "evidencija", JSON.stringify(u));
  for (let i = 0; i < 3; i++) await ping("kiosk-skladiste", "potrosni", { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0" });
  u = await popis();
  provjeri("  zaslon za potrošni materijal se vodi zasebno (vrsta potrosni)", u.length === 2 && u.find((x) => x.id === "kiosk-skladiste")?.vrsta === "potrosni" && u.find((x) => x.id === "kiosk-skladiste")?.uredaj === "Windows · Firefox", JSON.stringify(u));
  for (let i = 0; i < 3; i++) await ping("kiosk-nepoznat", "nesto");
  provjeri("  nepoznata vrsta pada na evidenciju", (await popis()).find((x) => x.id === "kiosk-nepoznat")?.vrsta === "evidencija");
  const poredak = await popis();
  provjeri("  popis je poredan po zadnjem signalu (najnoviji prvi)", poredak[0].id === "kiosk-nepoznat" && new Date(poredak[0].zadnji) >= new Date(poredak[poredak.length - 1].zadnji));

  console.log("\n— Ovlasti");
  r = await h("GET", "/api/kiosk/uredaji", undefined, E2);
  provjeri("  pozicija samo s pregledom kartice smije čitati popis", r.s === 200 && typeof r.j?.sada === "string", r.s);
  r = await h("GET", "/api/kiosk/uredaji", undefined, U1);
  provjeri("  ured (bez modula Evidencija sati) → 403", r.s === 403, r.s);
  r = await h("GET", "/api/kiosk/uredaji");
  provjeri("  bez prijave → 401", r.s === 401, r.s);

  console.log("\n— Preimenovanje i uklanjanje");
  r = await h("PUT", "/api/kiosk/uredaji/kiosk-ulaz-1/naziv", { naziv: "Ulaz — portirnica" }, E2);
  provjeri("  bez izmjena na kartici → 403", r.s === 403, r.s);
  r = await h("PUT", "/api/kiosk/uredaji/kiosk-ulaz-1/naziv", { naziv: "  Ulaz — portirnica  " }, E1);
  provjeri("  preimenovanje (razmaci se skidaju)", r.s === 200 && (await popis()).find((x) => x.id === "kiosk-ulaz-1")?.naziv === "Ulaz — portirnica", JSON.stringify(r));
  r = await h("PUT", "/api/kiosk/uredaji/kiosk-ulaz-1/naziv", { naziv: "x".repeat(100) }, E1);
  provjeri("  predugačak naziv se skraćuje na 40 znakova", r.s === 200 && (await popis()).find((x) => x.id === "kiosk-ulaz-1")?.naziv.length === 40);
  r = await h("PUT", "/api/kiosk/uredaji/nema-ga-nikad/naziv", { naziv: "Test" }, E1);
  provjeri("  nepoznat uređaj → 404", r.s === 404, r.s);
  r = await h("PUT", "/api/kiosk/uredaji/lo%C5%A1e/naziv", { naziv: "Test" }, E1);
  provjeri("  neispravna oznaka → 400", r.s === 400, r.s);
  r = await h("DELETE", "/api/kiosk/uredaji/kiosk-nepoznat", undefined, E2);
  provjeri("  uklanjanje bez izmjena → 403", r.s === 403, r.s);
  r = await h("DELETE", "/api/kiosk/uredaji/kiosk-nepoznat", undefined, E1);
  provjeri("  uklanjanje uređaja", r.s === 200 && !(await popis()).some((x) => x.id === "kiosk-nepoznat"), r.s);
  r = await h("DELETE", "/api/kiosk/uredaji/kiosk-nepoznat", undefined, E1);
  provjeri("  ponovno uklanjanje → 404", r.s === 404, r.s);

  console.log("\n— Granica broja uređaja (ping nema prijavu)");
  for (let i = 0; i < 40; i++) for (let k = 0; k < 3; k++) await h("GET", `/api/kiosk/ping?id=naplav-${String(i).padStart(2, "0")}&vrsta=evidencija`);
  await pauza(200);
  const svi = await popis();
  provjeri("  na popisu nikad više od 30 uređaja", svi.length <= 30 && svi.length >= 20, `${svi.length}`);
  provjeri("  postojeći uređaji i dalje primaju signale kad je granica puna", await (async () => { const prije = (await popis()).find((x) => x.id === "kiosk-ulaz-1")?.signala; await ping("kiosk-ulaz-1", "evidencija"); return (await popis()).find((x) => x.id === "kiosk-ulaz-1")?.signala === prije + 1; })());

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-2000));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

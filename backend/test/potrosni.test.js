// API test: potrošni materijal — kiosk (kartica, bez prijave), zalihe, upozorenje i zadatak za nabavu, storno, pregled potrošnje po radniku, ovlasti.
// Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3095); izmišljeni podaci, bez prave baze.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_POTR || 3095);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId, extra = {}) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15", ...extra });
const art = (id, naziv, stanje, min, extra = {}) => ({ id, naziv, jm: "kom", skupina: "", stanje, minZaliha: min, aktivan: true, naruciti: false, upozorenjeDatum: null, narucenoDatum: null, napomena: "", ...extra });
const seed = {
  zaposlenici: [
    zap("w1", "Radnik Prvi", "poz-zaposlenik", { rfidKod: "card1" }), zap("w2", "Radnik Drugi", "poz-zaposlenik", { rfidKod: "CARD2" }),
    zap("s1", "Skladištar", "poz-skladiste"), zap("s2", "SkladištarCitanje", "poz-skladiste-citanje"),
    zap("n1", "Nabava", "poz-nabava"), zap("a1", "Admin", "poz-administrator"), zap("u1", "Ured", "poz-ured"),
  ],
  pozicijeZaposlenika: [
    { id: "poz-zaposlenik", naziv: "Zaposlenik", moduli: ["dashboard"] },
    { id: "poz-skladiste", naziv: "Skladištar", moduli: ["dashboard", "skladiste"] },
    { id: "poz-skladiste-citanje", naziv: "Skladištar (storno isključen)", moduli: ["dashboard", "skladiste"], karticeDozvole: { skladiste: { potrosnja: { pristup: true, izmjene: false } } } },
    { id: "poz-nabava", naziv: "Nabava", moduli: ["dashboard", "nabava"] },
    { id: "poz-administrator", naziv: "Glavni administrator", moduli: ["dashboard", "skladiste", "nabava", "zaposlenici"] },
    { id: "poz-ured", naziv: "Ured", moduli: ["dashboard", "projekti"] },
  ],
  potrosniMaterijal: [art("a1", "Rukavice", 30, 20, { jm: "par", skupina: "Zaštita" }), art("a2", "Brusna ploča 125", 5, 0, { skupina: "Brušenje" }), art("a3", "Žica 1,0", 12, 10, { jm: "kg", skupina: "Varenje" }), art("a4", "Stari artikl", 4, 2, { aktivan: false })],
  potrosniPostavke: {}, slobodniZadaci: [], projekti: [],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-potr-"));
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
  const prijava = async (id, ip) => { const r = await h("POST", "/api/auth/login", { zaposlenikId: id, lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": ip }); return { Authorization: `Bearer ${r.j?.token}` }; };
  const S1 = await prijava("s1", "198.51.100.131"), S2 = await prijava("s2", "198.51.100.132"), N1 = await prijava("n1", "198.51.100.133"), A1 = await prijava("a1", "198.51.100.134"), U1 = await prijava("u1", "198.51.100.135");
  const kiosk = (ip) => ({ "CF-Connecting-IP": ip });
  const stanja = async () => Object.fromEntries(((await h("GET", "/api/data/potrosniMaterijal", undefined, A1)).j || []).map((a) => [a.id, a]));
  const mjesec = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zagreb" }).slice(0, 7);
  const godina = Number(mjesec.slice(0, 4));

  console.log("\n— Kiosk: prijava karticom");
  let r = await h("POST", "/api/kiosk/potrosni/prijava", { rfidKod: "NEPOZNATA" }, kiosk("203.0.113.1"));
  provjeri("  nepoznata kartica → 404", r.s === 404, r.s);
  r = await h("POST", "/api/kiosk/potrosni/prijava", { rfidKod: 12345 }, kiosk("203.0.113.1"));
  provjeri("  kod koji nije tekst → 400 (poslužitelj ne pada)", r.s === 400, r.s);
  r = await h("POST", "/api/kiosk/potrosni/prijava", { rfidKod: " card1 " }, kiosk("203.0.113.2"));
  provjeri("  kartica se prepoznaje bez obzira na velika/mala slova i razmake", r.s === 200 && r.j?.ime === "Test" && r.j?.prezime === "Radnik Prvi", JSON.stringify(r.j));
  provjeri("  popis ima samo aktivne artikle, s jedinicom i skupinom, bez stanja", r.j?.artikli?.length === 3 && r.j.artikli.every((a) => a.naziv && a.jm && !("stanje" in a)) && !r.j.artikli.some((a) => a.id === "a4"), JSON.stringify(r.j?.artikli));

  console.log("\n— Kiosk: uzimanje");
  r = await h("POST", "/api/kiosk/potrosni/uzmi", { rfidKod: "CARD1", zahtjevId: "z-1", stavke: [{ artiklId: "a1", kolicina: 5 }, { artiklId: "a2", kolicina: 1 }] }, kiosk("203.0.113.2"));
  provjeri("  uzimanje se bilježi", r.s === 200 && r.j?.ok === true && r.j.stavke.length === 2, JSON.stringify(r.j));
  let st = await stanja();
  provjeri("  stanje je umanjeno (30→25, 5→4), bez upozorenja", st.a1.stanje === 25 && st.a2.stanje === 4 && st.a1.naruciti === false, JSON.stringify([st.a1.stanje, st.a2.stanje]));
  r = await h("POST", "/api/kiosk/potrosni/uzmi", { rfidKod: "CARD1", zahtjevId: "z-1", stavke: [{ artiklId: "a1", kolicina: 5 }] }, kiosk("203.0.113.2"));
  st = await stanja();
  provjeri("  isti zahtjev poslan dvaput se ne zbraja", r.s === 200 && r.j?.vecZabiljezeno === true && st.a1.stanje === 25, `${r.s} ${st.a1.stanje}`);
  for (const [naziv, stavke] of [["količina 0", [{ artiklId: "a1", kolicina: 0 }]], ["negativna količina", [{ artiklId: "a1", kolicina: -3 }]], ["prevelika količina", [{ artiklId: "a1", kolicina: 5000 }]], ["nepoznat artikl", [{ artiklId: "nema", kolicina: 1 }]], ["neaktivan artikl", [{ artiklId: "a4", kolicina: 1 }]], ["prazan popis", []]]) {
    r = await h("POST", "/api/kiosk/potrosni/uzmi", { rfidKod: "CARD1", zahtjevId: `z-lose-${naziv}`, stavke }, kiosk("203.0.113.2"));
    provjeri(`  odbijeno: ${naziv} → 400`, r.s === 400, r.s);
  }
  r = await h("POST", "/api/kiosk/potrosni/uzmi", { rfidKod: "CARD1", stavke: [{ artiklId: "a1", kolicina: 1 }] }, kiosk("203.0.113.2"));
  provjeri("  bez zahtjevId → 400", r.s === 400, r.s);
  r = await h("POST", "/api/kiosk/potrosni/uzmi", { rfidKod: "NEPOZNATA", zahtjevId: "z-x", stavke: [{ artiklId: "a1", kolicina: 1 }] }, kiosk("203.0.113.3"));
  provjeri("  nepoznata kartica ne skida ništa → 404", r.s === 404 && (await stanja()).a1.stanje === 25, r.s);

  console.log("\n— Upozorenje za naručivanje (odgovorna osoba još nije određena)");
  r = await h("POST", "/api/kiosk/potrosni/uzmi", { rfidKod: "CARD1", zahtjevId: "z-2", stavke: [{ artiklId: "a1", kolicina: 6 }] }, kiosk("203.0.113.2"));
  st = await stanja();
  provjeri("  stanje 19 ≤ minimum 20 → artikl označen za naručivanje", r.s === 200 && st.a1.stanje === 19 && st.a1.naruciti === true && !!st.a1.upozorenjeDatum, JSON.stringify(st.a1));
  r = await h("GET", "/api/data/slobodniZadaci", undefined, A1);
  provjeri("  bez određene osobe zadatka nema", r.s === 200 && (r.j || []).length === 0, JSON.stringify(r.j));

  console.log("\n— Odgovorna osoba za naručivanje");
  r = await h("PUT", "/api/potrosni/postavke", { nabavaOsobaId: "n1" }, N1);
  provjeri("  Nabava ne može određivati osobu (nema Zalihe) → 403", r.s === 403, r.s);
  r = await h("PUT", "/api/potrosni/postavke", { nabavaOsobaId: "nema-tog" }, S1);
  provjeri("  nepostojeći zaposlenik → 400", r.s === 400, r.s);
  r = await h("PUT", "/api/potrosni/postavke", { nabavaOsobaId: "n1" }, S1);
  provjeri("  skladištar određuje osobu", r.s === 200 && r.j?.postavke?.nabavaOsobaId === "n1", JSON.stringify(r.j));
  r = await h("POST", "/api/kiosk/potrosni/uzmi", { rfidKod: "CARD2", zahtjevId: "z-3", stavke: [{ artiklId: "a3", kolicina: 3 }] }, kiosk("203.0.113.4"));
  r = await h("GET", "/api/data/slobodniZadaci", undefined, N1);
  const zad = (r.j || []).filter((z) => z.potrosniArtiklId === "a3");
  provjeri("  pad na minimum (12→9) stvara zadatak za osobu u nabavi", r.s === 200 && zad.length === 1 && zad[0].dodijeljenoId === "n1" && zad[0].zadaoId === "sustav" && /Žica 1,0/.test(zad[0].naziv) && zad[0].izvrseno === false, JSON.stringify(r.j));
  r = await h("POST", "/api/kiosk/potrosni/uzmi", { rfidKod: "CARD1", zahtjevId: "z-4", stavke: [{ artiklId: "a3", kolicina: 2 }] }, kiosk("203.0.113.2"));
  r = await h("GET", "/api/data/slobodniZadaci", undefined, N1);
  provjeri("  daljnje uzimanje ispod minimuma ne stvara drugi zadatak", (r.j || []).filter((z) => z.potrosniArtiklId === "a3").length === 1);
  r = await h("GET", "/api/obavijesti", undefined, N1);
  provjeri("  zadatak stiže u zvonce osobe u nabavi", r.s === 200 && (r.j?.obavijesti || []).some((o) => o.vrsta === "dodjela" && /Žica 1,0/.test(o.naziv)), JSON.stringify(r.j));

  console.log("\n— Zaprimanje, korekcija, naručeno");
  r = await h("POST", "/api/potrosni/zaprimi", { artiklId: "a3", kolicina: 20 }, N1);
  provjeri("  Nabava ne zaprima (nije skladište) → 403", r.s === 403, r.s);
  r = await h("POST", "/api/potrosni/zaprimi", { artiklId: "a3", kolicina: -5 }, S1);
  provjeri("  negativna količina → 400", r.s === 400, r.s);
  r = await h("POST", "/api/potrosni/naruceno", { artiklId: "a2" }, N1);
  provjeri("  naručeno za artikl koji nije ispod minimuma → 400", r.s === 400, r.s);
  r = await h("POST", "/api/potrosni/naruceno", { artiklId: "a1" }, N1);
  provjeri("  Nabava označi naručeno (smije)", r.s === 200 && !!r.j?.artikl?.narucenoDatum, JSON.stringify(r.j));
  r = await h("POST", "/api/potrosni/zaprimi", { artiklId: "a3", kolicina: 20, napomena: "Dostava" }, S1);
  st = await stanja();
  provjeri("  zaprimanje povećava stanje (7+20) i gasi upozorenje", r.s === 200 && st.a3.stanje === 27 && st.a3.naruciti === false, JSON.stringify(st.a3));
  r = await h("GET", "/api/data/slobodniZadaci", undefined, N1);
  provjeri("  zadatak za naručivanje se zatvara", (r.j || []).filter((z) => z.potrosniArtiklId === "a3").every((z) => z.izvrseno === true));
  r = await h("POST", "/api/potrosni/korekcija", { artiklId: "a2", novoStanje: 10, napomena: "Brojanje" }, S1);
  st = await stanja();
  provjeri("  korekcija postavlja stvarno stanje", r.s === 200 && st.a2.stanje === 10, JSON.stringify(st.a2));
  r = await h("POST", "/api/potrosni/korekcija", { artiklId: "a2", novoStanje: -1 }, S1);
  provjeri("  negativno stanje u korekciji → 400", r.s === 400, r.s);

  console.log("\n— Artikli i uvoz");
  r = await h("PUT", "/api/potrosni/artikl", { naziv: "Naočale", jm: "kom", skupina: "Zaštita", stanje: 12, minZaliha: 5 }, S1);
  provjeri("  novi artikl", r.s === 200 && r.j?.artikl?.stanje === 12 && r.j.artikl.id.startsWith("pm-"), JSON.stringify(r.j));
  const novId = r.j?.artikl?.id;
  r = await h("PUT", "/api/potrosni/artikl", { naziv: "rukavice" }, S1);
  provjeri("  isti naziv (bez obzira na velika slova) → 400", r.s === 400, r.s);
  r = await h("PUT", "/api/potrosni/artikl", { id: novId, naziv: "Naočale zaštitne", jm: "kom", minZaliha: 8, stanje: 999 }, S1);
  st = await stanja();
  provjeri("  izmjena artikla ne dira stanje", r.s === 200 && st[novId].stanje === 12 && st[novId].minZaliha === 8 && st[novId].naziv === "Naočale zaštitne");
  r = await h("PUT", "/api/potrosni/artikl", { naziv: "Čep" }, U1);
  provjeri("  ured (bez Skladišta) ne smije → 403", r.s === 403, r.s);
  r = await h("POST", "/api/potrosni/uvoz", { redovi: [{ naziv: "Disk 125", jm: "kom", stanje: 50, minZaliha: 20, skupina: "Brušenje" }, { naziv: "Rukavice" }, { naziv: "" }, { naziv: "Maska", stanje: 4 }] }, S1);
  provjeri("  uvoz dodaje nove i javlja preskočene", r.s === 200 && r.j?.dodano === 2 && r.j.preskoceno.length === 2, JSON.stringify(r.j));
  r = await h("PUT", "/api/data/potrosniMaterijal", [], A1);
  provjeri("  cijeli popis se ne može prepisati iz preglednika → 400", r.s === 400, r.s);
  r = await h("GET", "/api/data/potrosniMaterijal", undefined, U1);
  provjeri("  ured ne čita popis → 403", r.s === 403, r.s);
  r = await h("GET", "/api/data/potrosniMaterijal", undefined, N1);
  provjeri("  Nabava čita popis (za Za naručiti)", r.s === 200 && Array.isArray(r.j), r.s);

  console.log("\n— Potrošnja po radniku, storno");
  r = await h("GET", `/api/potrosni/potrosnja?godina=${godina}`, undefined, S1);
  const red = (radnik, artikl) => (r.j?.redovi || []).find((x) => x.zaposlenikId === radnik && x.artiklId === artikl);
  provjeri("  zbroj po radniku, mjesecu i artiklu (radnik 1: 11 pari rukavica u dva uzimanja)", r.s === 200 && red("w1", "a1")?.kolicina === 11 && red("w1", "a1")?.broj === 2 && red("w1", "a1")?.mjesec === mjesec, JSON.stringify(r.j));
  provjeri("  radnik 2: žica 3 kg; radnik 1: žica 2 kg", red("w2", "a3")?.kolicina === 3 && red("w1", "a3")?.kolicina === 2);
  r = await h("GET", `/api/potrosni/potrosnja?godina=${godina}`, undefined, U1);
  provjeri("  ured ne vidi potrošnju → 403", r.s === 403, r.s);
  r = await h("GET", `/api/potrosni/potrosnja?godina=${godina}`);
  provjeri("  bez prijave → 401", r.s === 401, r.s);
  r = await h("GET", `/api/potrosni/dnevnik?zaposlenikId=w1&mjesec=${mjesec}`, undefined, S2);
  const dn = r.j?.redovi || [];
  provjeri("  dnevnik radnika za mjesec (S2 smije čitati)", r.s === 200 && dn.length === 4 && dn.every((x) => x.vrsta === "uzimanje" && x.storno === false), JSON.stringify(r.j));
  const sest = dn.find((x) => x.artiklId === "a1" && x.kolicina === 6);
  r = await h("POST", "/api/potrosni/storno", { zapisId: sest?.id }, S2);
  provjeri("  storno bez izmjena na kartici Potrošnja → 403", r.s === 403, r.s);
  r = await h("POST", "/api/potrosni/storno", { zapisId: sest?.id }, S1);
  st = await stanja();
  provjeri("  storno vraća stanje (19+6=25) i gasi upozorenje", r.s === 200 && st.a1.stanje === 25 && st.a1.naruciti === false, JSON.stringify(st.a1));
  r = await h("POST", "/api/potrosni/storno", { zapisId: sest?.id }, S1);
  provjeri("  drugi storno istog zapisa → 400", r.s === 400, r.s);
  r = await h("GET", `/api/potrosni/potrosnja?godina=${godina}`, undefined, S1);
  provjeri("  stornirano se ne računa u potrošnju (11 → 5)", red("w1", "a1")?.kolicina === 5, JSON.stringify(red("w1", "a1")));
  r = await h("POST", "/api/potrosni/storno", { zapisId: "ne-postoji" }, S1);
  provjeri("  nepostojeći zapis → 404", r.s === 404, r.s);
  r = await h("GET", "/api/potrosni/zadnjih30", undefined, S1);
  provjeri("  potrošnja zadnjih 30 dana po artiklu", r.s === 200 && r.j?.potroseno?.a1 === 5 && r.j.potroseno.a3 === 5, JSON.stringify(r.j));

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-2500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

// API testovi: Zaštita na radu (uputnice RA-1) i prijedlozi korisnika. Pokretanje: `npm test` u mapi backend.
// Pokreće PRAVI server.js s lažnim pg-om u memoriji (test/lazni-pg.js, port 3086) — nikakav dodir sa stvarnom bazom; svi podaci su izmišljeni
// (repozitorij je javan). Zaključavanje redaka (FOR UPDATE) lažna baza ne provodi, pa istodobnost ovdje nije provjerena.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const PORT = Number(process.env.TEST_PORT || 3086);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const oibIz = (deset) => { let a = 10; for (const z of deset) { a = (a + Number(z)) % 10; if (a === 0) a = 10; a = (a * 2) % 11; } let k = 11 - a; if (k === 10) k = 0; return `${deset}${k}`; };
const OIB1 = oibIz("1234567890"), OIB2 = oibIz("2345678901"), OIB3 = oibIz("3456789012");
const zap = (id, ime, prezime, pozicijaId, extra = {}) => ({ id, ime, prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15", ...extra });
const seed = {
  zaposlenici: [
    zap("adm", "Toni", "Administratorić", "poz-administrator"), zap("dir", "Dora", "Direktorić", "poz-direktor"), zap("ured", "Uredna", "Uredić", "poz-ured"),
    zap("w1", "Ivo", "Radnik", "poz-zaposlenik"), zap("w2", "Ana", "Radnica", "poz-zaposlenik"), zap("zn", "Zdenko", "Znrić", "poz-znr"),
    zap("e1", "Marko", "Probić", "poz-zaposlenik"), zap("e2", "Luka", "Testić", "poz-zaposlenik"),
  ],
  pozicijeZaposlenika: [
    { id: "poz-administrator", naziv: "Glavni administrator", moduli: ["dashboard", "zaposlenici"] },
    { id: "poz-direktor", naziv: "Direktor", moduli: ["dashboard", "zaposlenici"] },
    { id: "poz-ured", naziv: "Ured", moduli: ["dashboard", "zaposlenici"] },
    { id: "poz-zaposlenik", naziv: "Zaposlenik", moduli: ["proizvodnja"] },
    { id: "poz-znr", naziv: "ZNR referent", moduli: ["dashboard"] },
  ],
  postavkeTvrtke: { naziv: "Probna tvrtka d.o.o.", adresa: "Ulica 1, 10000 Grad", oib: oibIz("9876543210") },
  godisnjiOdmor: { godine: { 2026: { zaposlenici: { e1: { stazIzvan: 5.5 } } } } },
};
// poslužitelj se pokreće iz prazne privremene mape, da ne učita pravi backend/.env
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-"));
const seedPutanja = path.join(mapa, "seed.json");
fs.writeFileSync(seedPutanja, JSON.stringify(seed));
const p = spawn(process.execPath, ["--require", path.join(__dirname, "lazni-pg-preload.js"), path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: String(PORT), JWT_SECRET: "test-tajna-samo-za-lokalni-test-0123456789", DATABASE_URL: "fake://lokalno", MOST_TOKEN: "", SEED_FILE: seedPutanja }, cwd: mapa });
// mapa se briše tek kad se proces poslužitelja zaustavi (Windows ne dopušta brisanje mape koja je nečija radna mapa)
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
let ipb = 0;
const prijava = async (id) => (await h("POST", "/api/auth/login", { zaposlenikId: id, lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": "198.51.100." + (++ipb) }));
const A = (t) => ({ Authorization: `Bearer ${t}` });
const kratko = (r) => `HTTP ${r.s} ${r.j?.error || ""}`;

(async () => {
  const L = await import(pathToFileURL(path.join(__dirname, "..", "..", "frontend", "src", "zastitaNaRadu.js")).href);
  await new Promise((r) => setTimeout(r, 1500));
  const T = {};
  for (const id of ["adm", "dir", "ured", "w1", "w2", "zn"]) T[id] = (await prijava(id)).j?.token;
  provjeri("prijave prolaze (6)", Object.values(T).every(Boolean), Object.entries(T).filter(([, v]) => !v).map(([k]) => k).join(","));

  console.log("\n— Modul i ovlasti");
  let r = await h("GET", "/api/data", undefined, A(T.adm));
  provjeri("migracija: Glavni administrator je dobio modul zastita", (r.j?.pozicijeZaposlenika || []).find((x) => x.id === "poz-administrator")?.moduli.includes("zastita"), JSON.stringify((r.j?.pozicijeZaposlenika || []).map((x) => [x.id, x.moduli.includes("zastita")])));
  provjeri("  ostale pozicije NISU dobile modul", (r.j?.pozicijeZaposlenika || []).filter((x) => x.id !== "poz-administrator").every((x) => !x.moduli.includes("zastita")));
  provjeri("  admin dobiva nove ključeve (uputnice, kadrovskiPodaci … kao nizovi, zastitaPostavke kao objekt)", Array.isArray(r.j.uputnice) && Array.isArray(r.j.kadrovskiPodaci) && Array.isArray(r.j.radnaMjesta) && Array.isArray(r.j.pregledi) && r.j.zastitaPostavke && !Array.isArray(r.j.zastitaPostavke));
  for (const id of ["ured", "dir", "w1"]) {
    r = await h("GET", "/api/data/kadrovskiPodaci", undefined, A(T[id]));
    provjeri(`  ${id} (bez modula) ne čita kadrovskiPodaci → 403`, r.s === 403, kratko(r));
    r = await h("GET", "/api/data", undefined, A(T[id]));
    provjeri(`  ${id}: u cijelom /api/data uputnice/kadrovskiPodaci/pregledi su prazni`, (r.j.uputnice || []).length === 0 && (r.j.kadrovskiPodaci || []).length === 0 && (r.j.pregledi || []).length === 0 && (r.j.radnaMjesta || []).length === 0);
  }
  // admin daje modul poziciji poz-znr (kroz Pozicije)
  const poz = (await h("GET", "/api/data/pozicijeZaposlenika", undefined, A(T.adm))).j;
  r = await h("PUT", "/api/data/pozicijeZaposlenika", poz.map((x) => (x.id === "poz-znr" ? { ...x, moduli: [...x.moduli, "zastita"] } : x)), A(T.adm));
  provjeri("admin dodjeljuje modul poziciji ZNR referent → 200", r.s === 200, kratko(r));
  provjeri("  PUT cijelog popisa uputnica je isključen (400)", (await h("PUT", "/api/data/uputnice", [], A(T.adm))).s === 400);
  provjeri("  ... i za kadrovskiPodaci, radnaMjesta, pregledi", (await h("PUT", "/api/data/kadrovskiPodaci", [], A(T.adm))).s === 400 && (await h("PUT", "/api/data/radnaMjesta", [], A(T.adm))).s === 400 && (await h("PUT", "/api/data/pregledi", [], A(T.adm))).s === 400);

  console.log("\n— Kadrovski podaci radnika");
  const kad = (id, oib, extra = {}) => ({ id, oib, datumRodjenja: "1990-05-20", mjestoRodjenja: "Probno", imeRoditelja: "Marko", zanimanje: "bravar", skolskaSprema: "SSS", radnoMjestoId: "rm-0305", dodatniPoslovi: [], datumPocetkaNaRadnomMjestu: "2022-01-10", stazPrijeGodine: 5, stazPrijeMjeseci: 6, ...extra });
  const kp = (t, upsert, remove = []) => h("PUT", "/api/kadrovskiPodaci/patch", { upsert, remove }, A(t));
  r = await kp(T.adm, [kad("e1", OIB1), kad("e2", OIB2)]);
  provjeri("admin sprema podatke dvaju radnika → 200", r.s === 200 && r.j.kadrovskiPodaci.length === 2, kratko(r));
  provjeri("  OIB spremljen kao samo znamenke", r.j.kadrovskiPodaci.find((k) => k.id === "e1")?.oib === OIB1);
  r = await kp(T.adm, [kad("e1", `${OIB1.slice(0, 10)}${(Number(OIB1[10]) + 1) % 10}`)]);
  provjeri("  neispravan OIB (kontrolna znamenka) → 400", r.s === 400 && /OIB/.test(r.j?.error || ""), kratko(r));
  r = await kp(T.adm, [kad("e2", OIB1)]);
  provjeri("  isti OIB drugom zaposleniku → 400", r.s === 400 && /već ima/.test(r.j?.error || ""), kratko(r));
  r = await kp(T.adm, [kad("nepostojeci", OIB3)]);
  provjeri("  nepoznat zaposlenik → 400", r.s === 400, kratko(r));
  r = await kp(T.adm, [{ ...kad("e1", OIB1), prljavo: "<script>", datumRodjenja: "nije datum" }]);
  provjeri("  nepoznata polja se ne spremaju, loš datum postaje prazan", r.s === 200 && !("prljavo" in r.j.kadrovskiPodaci.find((k) => k.id === "e1")) && r.j.kadrovskiPodaci.find((k) => k.id === "e1").datumRodjenja === "");
  await kp(T.adm, [kad("e1", OIB1)]);
  r = await kp(T.ured, [kad("e1", OIB1)]);
  provjeri("  Ured (bez modula) ne smije pisati → 403", r.s === 403, kratko(r));

  console.log("\n— Radna mjesta (predlošci)");
  const predlosci = L.predlosciIzProcjene();
  const rmp = (t, upsert) => h("PUT", "/api/radnaMjesta/patch", { upsert, remove: [] }, A(t));
  r = await rmp(T.adm, predlosci);
  provjeri("uvoz 22 predloška iz Procjene → 200", r.s === 200 && r.j.radnaMjesta.length === 22, kratko(r));
  provjeri("  nijedan nije odobren", r.j.radnaMjesta.every((x) => x.odobreno === null));
  const monter = r.j.radnaMjesta.find((x) => x.sifra === "0401");
  provjeri("  Monter: točke [16,17,18], podtočke [18,19]", JSON.stringify([monter.tocke, monter.podtocke]) === "[[16,17,18],[18,19]]");
  r = await rmp(T.adm, [{ ...monter, odobreno: true }]);
  let m1 = r.j?.radnaMjesta?.find((x) => x.id === monter.id);
  provjeri("odobrenje: poslužitelj upisuje tko i kada", r.s === 200 && m1.odobreno?.osobaId === "adm" && !!m1.odobreno.datum, kratko(r));
  r = await rmp(T.adm, [{ ...m1, kratakOpis: "Izmijenjeni opis" }]);
  provjeri("  izmjena sadržaja poništava odobrenje", r.j?.radnaMjesta?.find((x) => x.id === monter.id)?.odobreno === null);
  r = await rmp(T.adm, [{ ...monter, kratakOpis: "Izmijenjeni opis", odobreno: true }]);
  provjeri("  izmjena + izričito odobrenje u istom zahtjevu → odobreno", !!r.j?.radnaMjesta?.find((x) => x.id === monter.id)?.odobreno);
  const odobri = async (sifre) => { const sad = (await h("GET", "/api/data/radnaMjesta", undefined, A(T.adm))).j; return rmp(T.adm, sad.filter((x) => sifre.includes(x.sifra)).map((x) => ({ ...x, odobreno: true }))); };
  r = await odobri(["0305", "0402", "0201"]);
  provjeri("  odobreni Bravar, Platforma i Tehnički administrator", r.s === 200 && r.j.radnaMjesta.filter((x) => x.odobreno).length === 4, kratko(r));
  r = await rmp(T.adm, [{ ...predlosci[0], naziv: "" }]);
  provjeri("  radno mjesto bez naziva → 400", r.s === 400, kratko(r));

  console.log("\n— Uputnice");
  const radniciSad = (await h("GET", "/api/data/radnaMjesta", undefined, A(T.adm))).j;
  const rm = (sifra) => radniciSad.find((x) => x.sifra === sifra);
  const polja = (zapId, rmSifra, vrsta, datum, extra = {}) => {
    const z = seed.zaposlenici.find((x) => x.id === zapId);
    const r0 = kad(zapId, zapId === "e1" ? OIB1 : OIB2);
    return L.izradiPoljaUputnice({ zaposlenik: z, radnik: r0, radnoMjesto: rm(rmSifra), vrsta, datum, tvrtka: seed.postavkeTvrtke, ...extra });
  };
  const uput = (id, zapId, vrsta, datum, extra = {}) => ({ id, zaposlenikId: zapId, vrsta, datum, radnoMjestoId: extra.radnoMjestoId || rm("0305").id, dodatnaRadnaMjesta: undefined, polja: extra.polja || polja(zapId, "0305", vrsta, datum), ...extra, ...(extra.polja ? {} : {}) });
  const up = (t, upsert, remove = []) => h("PUT", "/api/uputnice/patch", { upsert, remove }, A(t));
  r = await up(T.adm, [uput("u0", "e1", "prethodni", "2026-10-29")]);
  provjeri("prije upisa početnog broja prva uputnica se odbija (inače bi se brojevi ponovili)", r.s === 400 && /zadnji već izdani broj/.test(r.j?.error || ""), kratko(r));
  r = await h("PUT", "/api/data/zastitaPostavke", { pocetniBrojevi: { 2026: 65 } }, A(T.adm));
  provjeri("upis početnog broja 65 (Postavke) → 200", r.s === 200, kratko(r));
  r = await up(T.adm, [uput("u1", "e1", "prethodni", "2026-10-29", { izradioId: "w1", broj: "999/2026", status: "Obavljeno" })]);
  const u1 = r.j?.uputnice?.find((x) => x.id === "u1");
  provjeri("prva uputnica dobiva broj 66/2026 (broj iz zahtjeva se ignorira)", r.s === 200 && u1?.broj === "66/2026" && u1.redniBroj === 66 && u1.godina === 2026, kratko(r) + " " + u1?.broj);
  provjeri("  autor je onaj tko sprema (ne podmetnuti w1), status Čeka rezultat, vrijeme izrade postavlja poslužitelj", u1?.izradioId === "adm" && u1.status === "Čeka rezultat" && !!u1.izradenoU, JSON.stringify([u1?.izradioId, u1?.status]));
  provjeri("  prethodni: blok o posljednjem pregledu i staž na poslovima su prazni", u1?.polja.posljednjiPregled === null && u1.polja.stazNaPoslovima === "");
  r = await up(T.adm, [uput("u2", "e2", "periodicki", "2026-10-30"), uput("u3", "e1", "izvanredni", "2026-10-30")]);
  provjeri("dvije uputnice u istom zahtjevu → 67/2026 i 68/2026", r.s === 200 && ["67/2026", "68/2026"].every((b) => r.j.uputnice.some((x) => x.broj === b)), kratko(r) + JSON.stringify(r.j?.uputnice?.map((x) => x.broj)));
  r = await up(T.adm, [uput("u2", "e2", "periodicki", "2026-10-30")]);
  provjeri("ponovno slanje istog id-a (npr. nakon prekida veze) ne stvara novu uputnicu", r.s === 200 && r.j.uputnice.length === 3, kratko(r) + r.j?.uputnice?.length);
  const tuđa = { ...u1, polja: { ...u1.polja, ime: "Podmetnuto", oib: "00000000000" }, broj: "1/2026", datum: "2020-01-01", zaposlenikId: "w2", vrsta: "izvanredni" };
  r = await up(T.adm, [tuđa]);
  const u1n = r.j?.uputnice?.find((x) => x.id === "u1");
  provjeri("izdana uputnica se ne mijenja (polja, broj, datum, radnik, vrsta ostaju)", r.s === 200 && u1n.polja.ime === u1.polja.ime && u1n.polja.oib === u1.polja.oib && u1n.broj === "66/2026" && u1n.datum === "2026-10-29" && u1n.zaposlenikId === "e1" && u1n.vrsta === "prethodni");
  r = await up(T.adm, [], ["u1"]);
  provjeri("brisanje uputnice nije dopušteno (400)", r.s === 400, kratko(r));
  await odobri(["0101"]);
  r = await up(T.adm, [uput("u4", "e1", "periodicki", "2026-10-30", { radnoMjestoId: rm("0101").id })]);
  provjeri("posao izvan F.6 bez izričitog zahtjeva → 400", r.s === 400 && /izričit zahtjev/.test(r.j?.error || ""), kratko(r));
  const rmUred = { ...rm("0201") };
  r = await up(T.adm, [uput("u5", "e1", "periodicki", "2026-10-30", { radnoMjestoId: rmUred.id, izricitoZatrazeno: true, polja: polja("e1", "0201", "periodicki", "2026-10-30") })]);
  provjeri("  isti posao uz izričit zahtjev (i odobren predložak) → 200", r.s === 200 && r.j.uputnice.some((x) => x.id === "u5" && x.izricitoZatrazeno), kratko(r));
  r = await up(T.adm, [uput("u6", "e1", "periodicki", "2026-10-30", { radnoMjestoId: rm("0310").id })]);
  provjeri("neodobren predložak radnog mjesta → 400", r.s === 400 && /nije odobren/.test(r.j?.error || ""), kratko(r));
  r = await up(T.adm, [uput("u7", "e1", "periodicki", "2026-10-30", { polja: { ...polja("e1", "0305", "periodicki", "2026-10-30"), oib: "12345678900" } })]);
  provjeri("neispravan OIB u uputnici → 400", r.s === 400 && /OIB/.test(r.j?.error || ""), kratko(r));
  r = await up(T.adm, [uput("u8", "e1", "", "2026-10-30")]);
  provjeri("bez vrste pregleda → 400", r.s === 400, kratko(r));
  r = await up(T.adm, [uput("u9", "nema", "periodicki", "2026-10-30")]);
  provjeri("nepoznat zaposlenik → 400", r.s === 400, kratko(r));
  r = await up(T.adm, [uput("u10", "e2", "periodicki", "2027-01-05")]);
  provjeri("nova godina: broj kreće ispočetka (1/2027)", r.s === 200 && r.j.uputnice.some((x) => x.id === "u10" && x.broj === "1/2027"), kratko(r));
  const sviPrije = (await h("GET", "/api/data/uputnice", undefined, A(T.adm))).j.length;
  r = await up(T.ured, [uput("u11", "e1", "periodicki", "2026-10-30")]);
  provjeri("Ured (bez modula) ne smije izdati uputnicu → 403", r.s === 403, kratko(r));
  r = await up(T.zn, [uput("u12", "e2", "izvanredni", "2026-10-30")]);
  provjeri("ZNR referent (modul dodijeljen kroz Pozicije) smije izdati uputnicu", r.s === 200 && r.j.uputnice.some((x) => x.id === "u12" && x.izradioId === "zn"), kratko(r));
  provjeri("  prije toga nitko nije dodao uputnicu bez dozvole (broj uputnica)", sviPrije === 5, String(sviPrije));
  // statusi
  r = await up(T.adm, [{ id: "u1", status: "Obavljeno", pregledId: "pg1" }]);
  provjeri("rezultat stigao: Čeka rezultat → Obavljeno (veza na pregled)", r.s === 200 && r.j.uputnice.find((x) => x.id === "u1").status === "Obavljeno" && r.j.uputnice.find((x) => x.id === "u1").pregledId === "pg1", kratko(r));
  r = await up(T.adm, [{ id: "u1", status: "Čeka rezultat" }]);
  provjeri("  vraćanje na Čeka rezultat (npr. pogrešan unos)", r.j.uputnice.find((x) => x.id === "u1").status === "Čeka rezultat");
  r = await up(T.adm, [{ id: "u3", status: "Poništena", ponistenaRazlog: "Pogrešan radnik" }]);
  const u3 = r.j?.uputnice?.find((x) => x.id === "u3");
  provjeri("poništavanje: status, razlog, datum i tko je poništio", u3?.status === "Poništena" && u3.ponistenaRazlog === "Pogrešan radnik" && u3.ponistioId === "adm" && !!u3.ponistenaDatum, kratko(r));
  r = await up(T.adm, [{ id: "u3", status: "Čeka rezultat" }]);
  provjeri("  poništena uputnica je konačna", r.j.uputnice.find((x) => x.id === "u3").status === "Poništena");
  r = await up(T.adm, [uput("u13", "e1", "periodicki", "2026-10-31")]);
  const brojevi2026 = r.j.uputnice.filter((x) => x.godina === 2026).map((x) => x.redniBroj).sort((a, b) => a - b);
  provjeri("brojevi 2026. idu redom bez rupa i ponavljanja, poništena se broji (nema ponovne upotrebe broja)", JSON.stringify(brojevi2026) === JSON.stringify([66, 67, 68, 69, 70, 71]) || (new Set(brojevi2026).size === brojevi2026.length && brojevi2026.every((b, i) => i === 0 || b === brojevi2026[i - 1] + 1)), JSON.stringify(brojevi2026));

  console.log("\n— Pregledi (rezultati)");
  const pr = (t, upsert, remove = []) => h("PUT", "/api/pregledi/patch", { upsert, remove }, A(t));
  r = await pr(T.adm, [{ id: "pg1", zaposlenikId: "e1", uputnicaId: "u1", datumPregleda: "2026-11-05", clanak: "3.", tocke: "1.,2.", ocjena: L.OCJENA_ZADANO, datumSljedeceg: "", unioId: "w1" }]);
  const pg1 = r.j?.pregledi?.find((x) => x.id === "pg1");
  provjeri("upis rezultata pregleda → 200, autora i vrijeme upisa postavlja poslužitelj", r.s === 200 && pg1?.unioId === "adm" && !!pg1.unesenoU && pg1.izvor === "uputnica", kratko(r));
  r = await pr(T.adm, [{ id: "pg2", zaposlenikId: "e1", datumPregleda: "2025-11-13", ocjena: "" }]);
  provjeri("  bez ocjene → 400", r.s === 400 && /ocjenu/.test(r.j?.error || ""), kratko(r));
  r = await pr(T.adm, [{ id: "pg2", zaposlenikId: "e1", datumPregleda: "", ocjena: "Sposoban" }]);
  provjeri("  bez datuma pregleda → 400", r.s === 400, kratko(r));
  r = await pr(T.adm, [{ id: "pg3", zaposlenikId: "e2", datumPregleda: "2025-11-13", ocjena: "Sposoban", clanak: "3.", tocke: "1.,2." }]);
  provjeri("  raniji pregled upisan ručno (bez uputnice) → izvor rucno", r.s === 200 && r.j.pregledi.find((x) => x.id === "pg3").izvor === "rucno", kratko(r));
  r = await pr(T.ured, [{ id: "pg4", zaposlenikId: "e2", datumPregleda: "2025-11-13", ocjena: "Sposoban" }]);
  provjeri("  Ured (bez modula) ne smije upisati → 403", r.s === 403, kratko(r));
  r = await pr(T.adm, [{ id: "pg1", zaposlenikId: "e1", uputnicaId: "u1", datumPregleda: "2026-11-06", ocjena: "Sposoban" }]);
  provjeri("  izmjena pregleda zadržava izvornog autora i vrijeme upisa", r.j.pregledi.find((x) => x.id === "pg1").unioId === "adm" && r.j.pregledi.find((x) => x.id === "pg1").unesenoU === pg1.unesenoU);

  console.log("\n— Prijedlozi korisnika");
  const pj = (t, upsert, remove = []) => h("PUT", "/api/prijedlozi/patch", { upsert, remove }, A(t));
  r = await pj(T.w1, [{ id: "p1", tekst: "Dodati gumb za ispis u tablicu naloga", modul: "proizvodnja", kreiraoId: "adm", status: "Gotovo", odgovor: "lažni odgovor" }]);
  const p1 = r.j?.prijedlozi?.find((x) => x.id === "p1");
  provjeri("obični zaposlenik šalje prijedlog → 200; autor, vrijeme i status postavlja poslužitelj", r.s === 200 && p1?.kreiraoId === "w1" && p1.status === "Novo" && p1.odgovor === "" && !!p1.datum, kratko(r) + JSON.stringify(p1));
  r = await pj(T.w2, [{ id: "p2", tekst: "Veći font u tablici sati" }]);
  provjeri("drugi zaposlenik šalje svoj prijedlog", r.s === 200);
  r = await h("GET", "/api/data/prijedlozi", undefined, A(T.w1));
  provjeri("  w1 vidi samo svoj prijedlog", r.s === 200 && r.j.length === 1 && r.j[0].id === "p1", JSON.stringify(r.j?.map((x) => x.id)));
  r = await h("GET", "/api/data", undefined, A(T.w2));
  provjeri("  w2 u cijelom /api/data vidi samo svoj", r.j.prijedlozi.length === 1 && r.j.prijedlozi[0].id === "p2");
  r = await h("GET", "/api/data/prijedlozi", undefined, A(T.adm));
  provjeri("  Glavni administrator vidi sve (2)", r.s === 200 && r.j.length === 2);
  r = await h("GET", "/api/data/prijedlozi", undefined, A(T.dir));
  provjeri("  Direktor vidi sve (2)", r.s === 200 && r.j.length === 2);
  r = await h("GET", "/api/data/prijedlozi", undefined, A(T.ured));
  provjeri("  Ured (nije upravitelj) ne vidi tuđe", r.s === 200 && r.j.length === 0);
  r = await pj(T.w1, [{ id: "p1", tekst: "Dodati gumb za ispis u tablicu naloga (ispravljeno)", status: "Gotovo" }]);
  const p1b = r.j?.prijedlozi?.find((x) => x.id === "p1");
  provjeri("autor ispravlja tekst dok je Novo; status ne može sam promijeniti", r.s === 200 && /ispravljeno/.test(p1b?.tekst) && p1b.status === "Novo", kratko(r));
  r = await pj(T.w2, [{ id: "p1", tekst: "Tuđi prijedlog prepisan" }]);
  provjeri("tuđi prijedlog se ne može mijenjati → 403", r.s === 403, kratko(r));
  r = await pj(T.adm, [{ id: "p1", status: "Planirano", odgovor: "Ide u sljedeću izmjenu.", tekst: "ne smije se mijenjati" }]);
  const p1c = r.j?.prijedlozi?.find((x) => x.id === "p1");
  provjeri("upravitelj mijenja status i piše odgovor (tekst autora ostaje)", r.s === 200 && p1c.status === "Planirano" && p1c.odgovor === "Ide u sljedeću izmjenu." && p1c.odgovorioId === "adm" && !!p1c.odgovorDatum && /ispravljeno/.test(p1c.tekst), kratko(r));
  r = await h("GET", "/api/data/prijedlozi", undefined, A(T.w1));
  provjeri("  autor vidi status i odgovor", r.j[0].status === "Planirano" && r.j[0].odgovor === "Ide u sljedeću izmjenu.");
  r = await pj(T.w1, [{ id: "p1", tekst: "Pokušaj izmjene nakon obrade" }]);
  provjeri("  nakon obrade autor više ne može mijenjati tekst → 403", r.s === 403, kratko(r));
  r = await pj(T.w1, [], ["p1"]);
  provjeri("  ni povući prijedlog koji više nije Novo → 403", r.s === 403, kratko(r));
  r = await pj(T.w2, [], ["p2"]);
  provjeri("autor povlači svoj prijedlog dok je Novo → 200", r.s === 200 && r.j.prijedlozi.length === 0, kratko(r));
  r = await pj(T.w1, [{ id: "p3", tekst: "   " }]);
  provjeri("prazan prijedlog → 400", r.s === 400, kratko(r));
  r = await pj(T.adm, [], ["p1"]);
  provjeri("upravitelj može ukloniti bilo koji prijedlog", r.s === 200 && r.j.prijedlozi.length === 0, kratko(r));
  provjeri("PUT cijelog popisa prijedloga je isključen (400)", (await h("PUT", "/api/data/prijedlozi", [], A(T.adm))).s === 400);
  let zadnji = null;
  for (let i = 0; i < 22; i++) zadnji = await pj(T.w1, [{ id: `spam${i}`, tekst: `Prijedlog ${i}` }]);
  provjeri("ograničenje: više od 20 prijedloga dnevno → 429", zadnji.s === 429, kratko(zadnji));

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\n--- zapisnik poslužitelja ---\n" + dnevnik.join("").slice(-1800));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error("GREŠKA TESTA:", e); console.log(dnevnik.join("").slice(-1500)); pocisti(2); });

// API test: nesukladnosti i popravne radnje — ovlasti (kartica kontrola.nesukladnosti, SUKO), brojevi po godini, statusi i radnje, zaštita od prepisivanja (verzija),
// slike (JPEG/PNG), PDF obrasca, red za most i podsjetnici (zadaci iz sustava). Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3099).
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const N = require("../nesukladnosti");
const PORT = Number(process.env.TEST_PORT_NES || 3099);
const MOST = "test-most-token-samo-za-lokalni-test-0123";
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, ime, prezime, pozicijaId) => ({ id, ime, prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });

// ----- čiste funkcije -----
assert.strictEqual(N.nazivMapeZ(2026, 46, "RN 170-313"), "46-26 RN 170-313");
assert.strictEqual(N.nazivMapeZ(2026, 7, ""), "07-26");
assert.strictEqual(N.nazivMapeZ(2027, 3, 'RN 1/2:"x"'), "03-27 RN 1 2 x");
assert.strictEqual(N.nazivPdf(2026, 6), "Nesukladnosti i popravne radnje 06-26.pdf");
assert.strictEqual(N.oznakaBroja(2026, 46), "46/26");
let p = N.ocistiPodatke({ opis: " Pukotina ", izvor: "nepoznato", mjere: ["ispravak", "ispravak", "x"], aktivnosti: [{ opis: "Zamijeniti cijev", rok: "2026-11-30" }, {}], ocjena: "podmetnuto", ucinkovito: true, nositeljPotvrda: { id: "x" } });
assert.strictEqual(p.opis, "Pukotina"); assert.strictEqual(p.izvor, "radni proces"); assert.deepStrictEqual(p.mjere, ["ispravak"]);
assert.strictEqual(p.aktivnosti.length, 1, "prazni redovi aktivnosti se izbacuju");
assert.strictEqual(p.ocjena, "", "ocjena SUKO-a se nikad ne uzima iz ulaza"); assert.strictEqual(p.ucinkovito, null); assert.strictEqual(p.nositeljPotvrda, null);
assert.strictEqual(N.statusIzSadrzaja({ uzrok: "", aktivnosti: [] }, "Otvorena"), "Otvorena");
assert.strictEqual(N.statusIzSadrzaja({ uzrok: "x", aktivnosti: [] }, "Otvorena"), "Mjere u tijeku");
assert.strictEqual(N.statusIzSadrzaja({ uzrok: "x", aktivnosti: [] }, "Čeka ocjenu"), "Čeka ocjenu");
const zap1 = { id: "n1", godina: 2026, broj: 46, status: "Mjere u tijeku", kreirao_id: "t1", podaci: { projektSifra: "RN 1", nositeljId: "v1", aktivnosti: [{ id: "a1", opis: "A", rok: "2026-11-01", provedeno: "" }, { id: "a2", opis: "B", rok: "2026-12-30", provedeno: "" }, { id: "a3", opis: "C", rok: "2026-11-01", provedeno: "2026-11-02" }] } };
let z = N.zeljeniZadaci([zap1, { ...zap1, id: "n2", status: "Čeka ocjenu", podaci: { ...zap1.podaci, nositeljPotvrda: { vrijeme: "t" } } }, { ...zap1, id: "n3", status: "Zatvorena" }], "suko", "2026-11-24");
assert.deepStrictEqual(z.map((x) => x.kljuc), ["ns:n1:akt:a1:2026-11-01", "ns:n2:ocjena:t"], "samo prošli rok bez provedbe i čekanje ocjene");
assert.strictEqual(z[0].dodijeljenoId, "v1"); assert.strictEqual(z[1].dodijeljenoId, "suko");
let u = N.uskladiZadatke([{ id: "x", nesukladnostKljuc: "ns:stari", izvrseno: false }, { id: "y", nesukladnostKljuc: "ns:n1:akt:a1:2026-11-01", izvrseno: true, izvrsioId: "v1" }, { id: "obican" }], z, "sada", () => "novi");
assert.strictEqual(u.zadaci.find((x) => x.id === "x").izvrseno, true, "nepotreban podsjetnik se zatvara");
assert.strictEqual(u.zadaci.filter((x) => x.nesukladnostKljuc === "ns:n1:akt:a1:2026-11-01").length, 1, "ručno završen podsjetnik se ne vraća");
assert.ok(u.zadaci.some((x) => x.nesukladnostKljuc === "ns:n2:ocjena:t" && x.zadaoId === "sustav" && !x.izvrseno));
assert.ok(u.zadaci.some((x) => x.id === "obican" && !x.izvrseno), "ostali zadaci ostaju netaknuti");
assert.strictEqual(N.vrstaSlike(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0])), "jpg");
assert.strictEqual(N.vrstaSlike(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0])), "png");
assert.strictEqual(N.vrstaSlike(Buffer.from("<html>…</html>")), null);

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("izmisljena-slika-za-test")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("izmisljena-png")]);
const PDF = Buffer.from("%PDF-1.4\n" + "x".repeat(200) + "\n%%EOF");
const seed = {
  zaposlenici: [zap("t1", "Test", "Tehnolog", "poz-tehnolog"), zap("v1", "Test", "Voditelj", "poz-tehnolog"), zap("c1", "Test", "Citanje", "poz-citanje"), zap("u1", "Test", "Ured", "poz-ured"), zap("a1", "Test", "Admin", "poz-administrator"), zap("s1", "Test", "Suko", "poz-ured"), zap("vp1", "Test", "Proizvodnja", "poz-voditelj-proizvodnje")],
  pozicijeZaposlenika: [
    { id: "poz-tehnolog", naziv: "Tehnolog", moduli: ["dashboard", "kontrola"] },
    { id: "poz-citanje", naziv: "Samo pregled", moduli: ["dashboard", "kontrola"], karticeDozvole: { kontrola: { nesukladnosti: { pristup: true, izmjene: false } } } },
    { id: "poz-ured", naziv: "Ured", moduli: ["dashboard"] },
    { id: "poz-administrator", naziv: "Glavni administrator", moduli: ["dashboard", "kontrola"] },
    { id: "poz-voditelj-proizvodnje", naziv: "Voditelj proizvodnje", moduli: ["dashboard", "proizvodnja"], karticeDozvole: { proizvodnja: { tablica: { pristup: true, izmjene: true } } } },
  ],
  projekti: [{ id: "p1", sifra: "RN 170-313", naziv: "Test", status: "U izradi" }], dobavljaci: [{ id: "d1", naziv: "Kooperant d.o.o." }], kupci: [], slobodniZadaci: [],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-nes-"));
const seedPutanja = path.join(mapa, "seed.json");
fs.writeFileSync(seedPutanja, JSON.stringify(seed));
const proc = spawn(process.execPath, ["--require", path.join(__dirname, "lazni-pg-preload.js"), path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: String(PORT), JWT_SECRET: "test-tajna-samo-za-lokalni-test-0123456789", DATABASE_URL: "fake://lokalno", MOST_TOKEN: MOST, SEED_FILE: seedPutanja }, cwd: mapa });
const pocisti = (kod) => { proc.once("exit", () => { try { fs.rmSync(mapa, { recursive: true, force: true }); } catch { /* ostaje */ } process.exit(kod); }); proc.kill(); };
const dnevnik = [];
proc.stdout.on("data", (d) => dnevnik.push(String(d)));
proc.stderr.on("data", (d) => dnevnik.push(String(d)));
const h = async (metoda, ruta, tijelo, zaglavlja = {}, sirovo) => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${ruta}`, { method: metoda, headers: { ...(tijelo !== undefined && !sirovo ? { "Content-Type": "application/json" } : {}), ...zaglavlja }, body: sirovo || (tijelo === undefined ? undefined : JSON.stringify(tijelo)) });
    const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString("utf8")); } catch {}
    return { s: r.status, j, buf, tip: r.headers.get("content-type") || "" };
  } catch (e) { return { s: "PREKID", j: null, buf: Buffer.alloc(0), tip: "" }; }
};
let ok = 0, lose = 0;
const provjeri = (naziv, uvjet, detalj) => { (uvjet ? ok++ : lose++); console.log(`${uvjet ? "  ✔" : "  ✘"} ${naziv}${detalj !== undefined && !uvjet ? "  → " + detalj : ""}`); };
const pauza = (ms) => new Promise((r) => setTimeout(r, ms));
const MOSTH = { "X-Most-Token": MOST };

(async () => {
  await pauza(1800);
  const prijava = async (id, ip) => { const r = await h("POST", "/api/auth/login", { zaposlenikId: id, lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": ip }); return { Authorization: `Bearer ${r.j?.token}` }; };
  const T = await prijava("t1", "198.51.100.171"), V = await prijava("v1", "198.51.100.172"), C = await prijava("c1", "198.51.100.173"), U = await prijava("u1", "198.51.100.174"), A = await prijava("a1", "198.51.100.175"), S = await prijava("s1", "198.51.100.176");
  const zadaci = async () => { await pauza(150); return (await h("GET", "/api/data/slobodniZadaci", undefined, A)).j || []; };
  const PDFH = (z) => ({ ...z, "Content-Type": "application/pdf" });

  console.log("\n— Voditelj proizvodnje (jednokratna prilagodba pozicije)");
  const VP = await prijava("vp1", "198.51.100.177");
  let rv = await h("GET", "/api/data/pozicijeZaposlenika", undefined, A);
  const vp = (rv.j || []).find((x) => x.id === "poz-voditelj-proizvodnje");
  provjeri("  pozicija dobiva modul kontrola, ali Matična knjiga i Ugrađeni materijal su isključeni; postojeće dozvole ostaju", vp?.moduli?.includes("kontrola") && vp.moduli.includes("proizvodnja") && vp.karticeDozvole?.kontrola?.maticna?.pristup === false && vp.karticeDozvole?.kontrola?.ugradeni?.pristup === false && vp.karticeDozvole?.proizvodnja?.tablica?.izmjene === true, JSON.stringify(vp));
  rv = await h("POST", "/api/nesukladnosti", { podaci: { datum: "2025-12-30", opis: "Voditelj proizvodnje bilježi" } }, VP);
  provjeri("  voditelj proizvodnje smije bilježiti nesukladnosti", rv.s === 200 && rv.j?.zapis?.oznaka === "1/25", JSON.stringify(rv.j));

  console.log("\n— Ovlasti i unos");
  let r = await h("GET", "/api/nesukladnosti?godina=2026");
  provjeri("  bez prijave → 401", r.s === 401, r.s);
  r = await h("GET", "/api/nesukladnosti?godina=2026", undefined, U);
  provjeri("  bez modula Kontrola kvalitete → 403", r.s === 403, r.s);
  r = await h("GET", "/api/nesukladnosti?godina=2026", undefined, C);
  provjeri("  pozicija sa samo pregledom kartice čita popis", r.s === 200 && r.j?.ovlasti?.izmjene === false, JSON.stringify(r.j?.ovlasti));
  r = await h("POST", "/api/nesukladnosti", { podaci: { opis: "x" } }, C);
  provjeri("  samo pregled ne smije unositi → 403", r.s === 403, r.s);
  r = await h("POST", "/api/nesukladnosti", { podaci: { opis: "  " } }, T);
  provjeri("  bez opisa → 400", r.s === 400, r.s);
  r = await h("POST", "/api/nesukladnosti", { podaci: { datum: "2026-11-24", opis: "Pukotina na cijevi Ø42,4", izvor: "reklamacija dobavljaču", projektId: "p1", dobavljacId: "d1", nositeljId: "v1" } }, T);
  const n1 = r.j?.zapis;
  provjeri("  tehnolog unosi: broj 1/26, evidentirao = on, nositelj, projekt, status Otvorena", r.s === 200 && n1?.oznaka === "1/26" && n1.podaci.evidentiraoId === "t1" && n1.podaci.evidentirao === "Test Tehnolog" && n1.podaci.nositelj === "Test Voditelj" && n1.podaci.projektSifra === "RN 170-313" && n1.status === "Otvorena" && n1.z.mapa === "01-26 RN 170-313", JSON.stringify(n1));
  r = await h("POST", "/api/nesukladnosti", { podaci: { datum: "2026-11-25", opis: "Druga", evidentirao: "B&O (kupac)" } }, T);
  const n2 = r.j?.zapis;
  provjeri("  druga dobiva 2/26, vanjski evidentirao (kupac) ostaje upisan", n2?.oznaka === "2/26" && n2.podaci.evidentirao === "B&O (kupac)" && !n2.podaci.evidentiraoId && n2.z.mapa === "02-26", JSON.stringify(n2?.podaci));
  r = await h("POST", "/api/nesukladnosti", { podaci: { datum: "2027-01-03", opis: "Nova godina" } }, T);
  provjeri("  nova godina kreće od 1 (1/27)", r.j?.zapis?.oznaka === "1/27", JSON.stringify(r.j?.zapis?.oznaka));
  r = await h("GET", "/api/nesukladnosti?godina=2026", undefined, T);
  provjeri("  popis 2026: 2 zapisa, najnoviji prvi, godine 2027, 2026 i 2025", r.j?.zapisi?.length === 2 && r.j.zapisi[0].oznaka === "2/26" && JSON.stringify(r.j.godine) === "[2027,2026,2025]", JSON.stringify(r.j?.godine));
  let zd = await zadaci();
  provjeri("  nositelj (drugi od unositelja) dobiva zadatak 'upiši uzrok i mjere'", zd.some((x) => x.dodijeljenoId === "v1" && x.nesukladnostId === n1.id && !x.izvrseno && x.zadaoId === "sustav"), JSON.stringify(zd));

  console.log("\n— Izmjene, verzija, statusi");
  let ver = n1.verzija;
  const podaci = { ...n1.podaci, uzrok: "Greška materijala dobavljača", mjere: ["ispravak", "popravna radnja"], aktivnosti: [{ opis: "Zamijeniti cijev", odgovoran: "Kooperant d.o.o.", rok: "2026-11-01", provedeno: "" }, { opis: "Reklamacija dobavljaču", odgovoran: "Test Voditelj", rok: "2099-01-01", provedeno: "" }] };
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci, verzija: ver }, V);
  provjeri("  nositelj upisuje uzrok i aktivnosti → Mjere u tijeku", r.s === 200 && r.j?.zapis?.status === "Mjere u tijeku" && r.j.zapis.verzija === ver + 1, JSON.stringify(r.j));
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci, verzija: ver }, T);
  provjeri("  spremanje sa zastarjelom verzijom → 409 (ništa se ne prepisuje)", r.s === 409, r.s);
  ver += 1;
  zd = await zadaci();
  provjeri("  zadatak 'upiši uzrok' se zatvara, a za prošli rok aktivnosti otvara podsjetnik", zd.some((x) => x.nesukladnostKljuc?.includes(":nositelj:") && x.izvrseno) && zd.some((x) => x.nesukladnostKljuc?.includes(":akt:") && x.dodijeljenoId === "v1" && !x.izvrseno && x.planiraniDatum === "2026-11-01") && !zd.some((x) => x.nesukladnostKljuc?.includes("2099")), JSON.stringify(zd.map((x) => [x.nesukladnostKljuc, x.izvrseno])));
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci: { ...podaci, aktivnosti: [{ ...podaci.aktivnosti[0], provedeno: "2026-11-20" }, podaci.aktivnosti[1]] }, verzija: ver }, V);
  ver += 1;
  zd = await zadaci();
  provjeri("  upisana provedba zatvara podsjetnik", zd.filter((x) => x.nesukladnostKljuc?.includes(":akt:")).every((x) => x.izvrseno), JSON.stringify(zd.map((x) => [x.nesukladnostKljuc, x.izvrseno])));
  r = await h("PUT", `/api/nesukladnosti/${n2.id}`, { podaci: n2.podaci, verzija: n2.verzija, akcija: "na_ocjenu" }, T);
  provjeri("  na ocjenu bez uzroka/mjera/aktivnosti → 400", r.s === 400, r.s);
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci: { ...podaci, ocjena: "podmetnuto" }, verzija: ver, akcija: "zatvori", ocjena: "Učinkovito" }, V);
  provjeri("  tehnolog ne smije zatvoriti → 403", r.s === 403, r.s);
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci: r.j ? podaci : podaci, verzija: ver, akcija: "na_ocjenu" }, V);
  provjeri("  nositelj šalje na ocjenu: potpis nositelja (ime + vrijeme), status Čeka ocjenu", r.s === 200 && r.j?.zapis?.status === "Čeka ocjenu" && r.j.zapis.podaci.nositeljPotvrda?.ime === "Test Voditelj", JSON.stringify(r.j?.zapis?.podaci?.nositeljPotvrda));
  ver += 1;
  zd = await zadaci();
  provjeri("  dok SUKO nije određen, nema zadatka za ocjenu", !zd.some((x) => x.nesukladnostKljuc?.includes(":ocjena:")));
  r = await h("PUT", "/api/nesukladnosti/postavke", { sukoId: "s1" }, T);
  provjeri("  SUKO-a ne određuje tehnolog → 403", r.s === 403, r.s);
  r = await h("PUT", "/api/nesukladnosti/postavke", { sukoId: "nepostoji" }, A);
  provjeri("  nepostojeći zaposlenik → 400", r.s === 400, r.s);
  r = await h("PUT", "/api/nesukladnosti/postavke", { sukoId: "s1" }, A);
  provjeri("  glavni administrator određuje SUKO-a", r.s === 200, r.s);
  zd = await zadaci();
  provjeri("  SUKO dobiva zadatak za ocjenu", zd.some((x) => x.nesukladnostKljuc?.includes(":ocjena:") && x.dodijeljenoId === "s1" && !x.izvrseno), JSON.stringify(zd.map((x) => [x.nesukladnostKljuc, x.dodijeljenoId])));
  r = await h("GET", "/api/nesukladnosti?godina=2026", undefined, S);
  provjeri("  SUKO bez modula Kontrola kvalitete ipak vidi popis (jeSuko)", r.s === 200 && r.j?.ovlasti?.jeSuko === true, r.s);
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci, verzija: ver, akcija: "zatvori" }, S);
  provjeri("  zatvaranje bez ocjene → 400", r.s === 400, r.s);
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci, verzija: ver, akcija: "neucinkovito", ocjena: "Ponovljeno na drugoj isporuci" }, S);
  provjeri("  SUKO: mjera nije učinkovita → natrag u Mjere u tijeku, potpis nositelja se briše", r.s === 200 && r.j?.zapis?.status === "Mjere u tijeku" && r.j.zapis.podaci.ucinkovito === false && !r.j.zapis.podaci.nositeljPotvrda, JSON.stringify(r.j?.zapis?.podaci));
  ver += 1;
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci, verzija: ver, akcija: "na_ocjenu" }, V); ver += 1;
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci, verzija: ver, akcija: "zatvori", ocjena: "U dogovoru s voditeljem proizvodnje utvrđen uzrok." }, S);
  provjeri("  SUKO zatvara: ocjena, učinkovito, potpis SUKO-a", r.s === 200 && r.j?.zapis?.status === "Zatvorena" && r.j.zapis.podaci.ucinkovito === true && r.j.zapis.podaci.ocijenio?.ime === "Test Suko" && r.j.zapis.podaci.ocjena.startsWith("U dogovoru"), JSON.stringify(r.j?.zapis?.podaci));
  ver += 1;
  zd = await zadaci();
  provjeri("  zatvaranje zatvara sve podsjetnike te nesukladnosti", zd.filter((x) => x.nesukladnostId === n1.id).every((x) => x.izvrseno), JSON.stringify(zd.filter((x) => x.nesukladnostId === n1.id).map((x) => [x.nesukladnostKljuc, x.izvrseno])));
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci: { ...podaci, opis: "promjena" }, verzija: ver }, V);
  provjeri("  zatvorena se ne mijenja → 409", r.s === 409, r.s);
  r = await h("PUT", `/api/nesukladnosti/${n1.id}`, { podaci, verzija: ver, akcija: "ponovno_otvori" }, A);
  provjeri("  glavni administrator može ponovno otvoriti", r.s === 200 && r.j?.zapis?.status === "Mjere u tijeku", JSON.stringify(r.j?.zapis?.status));
  ver += 1;

  console.log("\n— Slike");
  r = await h("POST", `/api/nesukladnosti/${n1.id}/slika`, { slika: JPEG.toString("base64"), slicica: JPEG.toString("base64"), zahtjevId: "ns-slika-1" }, T);
  provjeri("  JPEG slika: naziv 01-26_01.jpg", r.s === 200 && r.j?.naziv === "01-26_01.jpg", JSON.stringify(r.j));
  const sl1 = r.j?.id;
  r = await h("POST", `/api/nesukladnosti/${n1.id}/slika`, { slika: PNG.toString("base64") }, T);
  provjeri("  PNG slika (npr. iz starog Worda) bez sličice: 01-26_02.png", r.s === 200 && r.j?.naziv === "01-26_02.png", JSON.stringify(r.j));
  const sl2 = r.j?.id;
  r = await h("POST", `/api/nesukladnosti/${n1.id}/slika`, { slika: JPEG.toString("base64"), zahtjevId: "ns-slika-1" }, T);
  provjeri("  ponovno slanje iste slike ne stvara duplikat", r.j?.ponovljeno === true && r.j.id === sl1, JSON.stringify(r.j));
  r = await h("POST", `/api/nesukladnosti/${n1.id}/slika`, { slika: Buffer.from("<html>x</html>").toString("base64") }, T);
  provjeri("  datoteka koja nije slika → 400", r.s === 400, r.s);
  r = await h("POST", `/api/nesukladnosti/${n1.id}/slika`, { slika: JPEG.toString("base64") }, C);
  provjeri("  samo pregled ne dodaje slike → 403", r.s === 403, r.s);
  r = await h("GET", `/api/nesukladnosti/${n1.id}`, undefined, C);
  provjeri("  detalj: 2 slike, po redu", r.s === 200 && r.j?.slike?.length === 2 && r.j.slike[0].naziv === "01-26_01.jpg" && r.j.slike[1].vrsta === "png", JSON.stringify(r.j?.slike));
  r = await h("GET", `/api/nesukladnosti/slika/${sl2}`, undefined, C);
  provjeri("  PNG bez sličice se šalje kao PNG", r.s === 200 && r.tip.startsWith("image/png") && r.buf.equals(PNG), r.tip);
  r = await h("GET", `/api/nesukladnosti/slika/${sl1}?original=1`, undefined, C);
  provjeri("  original JPEG", r.s === 200 && r.tip.startsWith("image/jpeg") && r.buf.equals(JPEG), r.tip);
  r = await h("GET", `/api/nesukladnosti/slika/${sl1}`, undefined, U);
  provjeri("  slika bez ovlasti → 403", r.s === 403, r.s);

  console.log("\n— PDF obrasca");
  r = await h("PUT", `/api/nesukladnosti/${n1.id}/pdf`, null, PDFH(T), Buffer.from("nije pdf"));
  provjeri("  datoteka koja nije PDF → 400", r.s === 400, r.s);
  r = await h("PUT", `/api/nesukladnosti/${n1.id}/pdf`, null, PDFH(C), PDF);
  provjeri("  samo pregled ne šalje PDF → 403", r.s === 403, r.s);
  r = await h("PUT", `/api/nesukladnosti/${n1.id}/pdf`, null, PDFH(T), Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)]));
  provjeri("  PDF veći od 5 MB prolazi (zaseban put za binarni PDF)", r.s === 200, r.s);
  r = await h("PUT", `/api/nesukladnosti/${n1.id}/pdf`, null, PDFH(T), PDF);
  provjeri("  PDF se sprema", r.s === 200, r.s);
  r = await h("GET", `/api/nesukladnosti/${n1.id}/pdf`, undefined, C);
  provjeri("  PDF se čita s nazivom obrasca", r.s === 200 && r.buf.equals(PDF) && r.tip.startsWith("application/pdf"), r.s);
  r = await h("GET", `/api/nesukladnosti/${n2.id}/pdf`, undefined, C);
  provjeri("  bez PDF-a → 404", r.s === 404, r.s);

  console.log("\n— Most");
  r = await h("GET", "/api/most/nesukladnosti/cekaju");
  provjeri("  bez tokena mosta → 401", r.s === 401, r.s);
  r = await h("GET", "/api/most/nesukladnosti/cekaju", undefined, MOSTH);
  const red = r.j?.datoteke || [];
  const pdfZ = red.find((x) => x.vrsta === "pdf"), slZ = red.filter((x) => x.vrsta === "slika");
  provjeri("  red: zadnja verzija PDF-a i obje slike, s godinom i mapom", pdfZ?.id === n1.id && pdfZ.naziv === "Nesukladnosti i popravne radnje 01-26.pdf" && pdfZ.mapa === "01-26 RN 170-313" && pdfZ.godina === 2026 && pdfZ.verzija === 2 && slZ.length === 2, JSON.stringify(red));
  r = await h("GET", `/api/most/nesukladnosti/datoteka/pdf/${n1.id}`, undefined, MOSTH);
  provjeri("  most preuzima PDF", r.s === 200 && r.buf.equals(PDF), r.s);
  r = await h("GET", `/api/most/nesukladnosti/datoteka/slika/${sl2}`, undefined, MOSTH);
  provjeri("  most preuzima sliku", r.s === 200 && r.buf.equals(PNG), r.s);
  r = await h("POST", `/api/most/nesukladnosti/rezultat/pdf/${n1.id}`, { status: "spremljeno", verzija: 2, putanja: "Z:\\x\\2026\\01-26 RN 170-313\\Nesukladnosti i popravne radnje 01-26.pdf" }, MOSTH);
  provjeri("  most javlja spremljen PDF", r.s === 200, r.s);
  r = await h("POST", `/api/most/nesukladnosti/rezultat/slika/${sl1}`, { status: "spremljeno", putanja: "Z:\\x\\01-26_01.jpg" }, MOSTH);
  r = await h("POST", `/api/most/nesukladnosti/rezultat/slika/${sl2}`, { status: "greska", poruka: "Korijenska mapa nije dostupna" }, MOSTH);
  r = await h("GET", "/api/most/nesukladnosti/cekaju", undefined, MOSTH);
  provjeri("  spremljeno (i greška u zadnjih 10 min) više nije u redu", (r.j?.datoteke || []).length === 0, JSON.stringify(r.j));
  r = await h("GET", `/api/nesukladnosti/${n1.id}`, undefined, T);
  provjeri("  u zapisu se vidi PDF na Z: i stanje slika", r.j?.zapis?.z?.pdfNaZ === 2 && r.j.zapis.z.putanja.includes("01-26") && r.j.slike.find((x) => x.id === sl1)?.naZ === true && r.j.slike.find((x) => x.id === sl2)?.greskaZ.includes("Korijenska"), JSON.stringify(r.j?.zapis?.z));
  r = await h("PUT", `/api/nesukladnosti/${n1.id}/pdf`, null, PDFH(T), PDF);
  r = await h("GET", "/api/most/nesukladnosti/cekaju", undefined, MOSTH);
  provjeri("  nova verzija PDF-a opet ide mostu", (r.j?.datoteke || []).some((x) => x.vrsta === "pdf" && x.verzija === 3), JSON.stringify(r.j));

  console.log("\n— Uklanjanje slike i poništavanje");
  r = await h("DELETE", `/api/nesukladnosti/${n2.id}/slika/${sl1}`, undefined, T);
  provjeri("  slika druge nesukladnosti → 404", r.s === 404, r.s);
  r = await h("DELETE", `/api/nesukladnosti/${n1.id}/slika/${sl1}`, undefined, T);
  provjeri("  uklanjanje slike iz ERP-a", r.s === 200, r.s);
  r = await h("PUT", `/api/nesukladnosti/${n2.id}`, { podaci: n2.podaci, verzija: n2.verzija, akcija: "ponisti", ocjena: "Upisano dvaput" }, T);
  provjeri("  tehnolog ne poništava → 403", r.s === 403, r.s);
  r = await h("PUT", `/api/nesukladnosti/${n2.id}`, { podaci: n2.podaci, verzija: n2.verzija, akcija: "ponisti", ocjena: "Upisano dvaput" }, S);
  provjeri("  SUKO poništava (broj ostaje zauzet)", r.s === 200 && r.j?.zapis?.status === "Poništena", JSON.stringify(r.j?.zapis?.status));
  r = await h("POST", "/api/nesukladnosti", { podaci: { datum: "2026-11-26", opis: "Treća" } }, T);
  provjeri("  sljedeći broj ne preuzima poništeni (3/26)", r.j?.zapis?.oznaka === "3/26", JSON.stringify(r.j?.zapis?.oznaka));

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-2500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

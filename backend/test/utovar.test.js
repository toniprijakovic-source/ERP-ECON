// API test: fotografije utovara — potpisana QR veza s otpremnice (bez prijave), slanje JPEG slika, redni brojevi i nazivi, ponovno slanje, ograničenja,
// pregled u projektu uz ovlasti, uklanjanje i rute za most (preuzimanje i potvrda spremanja na Z:).
// Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3095); izmišljeni podaci.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const U = require("../utovar");
const PORT = Number(process.env.TEST_PORT_UTOVAR || 3095);
const TAJNA = "test-tajna-samo-za-lokalni-test-0123456789";
const MOST = "test-most-token-samo-za-lokalni-test-0123";
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });
const danas = U.zagrebDatum();
const pomak = (n) => new Date(Date.parse(`${danas}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ----- čiste funkcije -----
assert.strictEqual(U.sigurnoUNaziv("OTP-30-10-2/26"), "OTP-30-10-2-26");
assert.strictEqual(U.sigurnoUNaziv("  ../../x  "), "x");
assert.strictEqual(U.sigurnoUNaziv(""), "otpremnica");
assert.strictEqual(U.nazivDatoteke("2026-11-24", "OTP-30-10-2/26", 3), "utovar_2026-11-24_OTP-30-10-2-26_03.jpg");
assert.strictEqual(U.nazivDatoteke("2026-11-24", "OTP 1/26", 12), "utovar_2026-11-24_OTP-1-26_12.jpg");
const t = U.napraviToken(TAJNA, "otp-1");
assert.strictEqual(U.provjeriToken(TAJNA, t), "otp-1");
assert.strictEqual(U.provjeriToken(TAJNA, t.replace("otp-1", "otp-2")), null, "token vrijedi samo za svoju otpremnicu");
assert.strictEqual(U.provjeriToken(TAJNA, t.slice(0, -1) + (t.endsWith("A") ? "B" : "A")), null, "izmijenjen potpis");
assert.strictEqual(U.provjeriToken("druga-tajna", t), null, "potpis druge tajne");
assert.strictEqual(U.provjeriToken(TAJNA, ""), null);
assert.strictEqual(U.provjeriToken(TAJNA, "bez-tocke"), null);
assert.strictEqual(U.vezaVrijedi(danas), true);
assert.strictEqual(U.vezaVrijedi(pomak(-U.VEZA_DANA)), true);
assert.strictEqual(U.vezaVrijedi(pomak(-U.VEZA_DANA - 1)), false, "veza istječe nakon VEZA_DANA dana");
assert.strictEqual(U.vezaVrijedi(pomak(1)), true, "otpremnica izdana dan ranije");
assert.strictEqual(U.vezaVrijedi(pomak(5)), false);
assert.strictEqual(U.vezaVrijedi(""), false);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("izmisljena-slika-za-test")]);
assert.ok(U.dekodiraj(JPEG.toString("base64"), 1000));
assert.strictEqual(U.dekodiraj(Buffer.from("<html>nije slika</html>").toString("base64"), 1000), null, "nije JPEG");
assert.strictEqual(U.dekodiraj("!!!nije base64!!!", 1000), null);
assert.strictEqual(U.dekodiraj(Buffer.concat([JPEG, Buffer.alloc(2000)]).toString("base64"), 1000), null, "prevelika");

const seed = {
  zaposlenici: [zap("o1", "Otpremnice", "poz-otp"), zap("s1", "Skladiste", "poz-skl"), zap("u1", "Ured", "poz-ured")],
  pozicijeZaposlenika: [
    { id: "poz-otp", naziv: "Otpremnice", moduli: ["dashboard", "otpremnice", "projekti"] },
    { id: "poz-skl", naziv: "Skladište", moduli: ["dashboard", "skladiste"] },
    { id: "poz-ured", naziv: "Ured", moduli: ["dashboard"] },
  ],
  projekti: [{ id: "p1", sifra: "RN 99-01", naziv: "Test konstrukcija", status: "U izradi", kupacId: "k1" }, { id: "p2", sifra: "RN 99-02", naziv: "Drugi", status: "U izradi", kupacId: "k1", mapa: "Z:\\Projekti\\RN 99-02_Drugi" }],
  kupci: [{ id: "k1", naziv: "Kupac d.o.o." }], dobavljaci: [{ id: "d1", naziv: "Cinčaonica d.o.o." }],
  otpremnice: [
    { id: "otp-1", broj: "OTP-24-11-1/26", projektId: "p1", kupacId: "k1", datum: danas, stavke: [] },
    { id: "otp-2", broj: "OTP-24-11-2/26", projektId: "p2", dobavljacId: "d1", vrsta: "kooperant", datum: danas, stavke: [] },
    { id: "otp-stara", broj: "OTP-01-01-1/26", projektId: "p1", kupacId: "k1", datum: pomak(-40), stavke: [] },
    { id: "otp-bez-projekta", broj: "OTP-X", projektId: "nema", kupacId: "k1", datum: danas, stavke: [] },
  ],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-utovar-"));
const seedPutanja = path.join(mapa, "seed.json");
fs.writeFileSync(seedPutanja, JSON.stringify(seed));
const p = spawn(process.execPath, ["--require", path.join(__dirname, "lazni-pg-preload.js"), path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: String(PORT), JWT_SECRET: TAJNA, DATABASE_URL: "fake://lokalno", MOST_TOKEN: MOST, SEED_FILE: seedPutanja }, cwd: mapa });
const pocisti = (kod) => { p.once("exit", () => { try { fs.rmSync(mapa, { recursive: true, force: true }); } catch { /* privremena mapa ostaje */ } process.exit(kod); }); p.kill(); };
const dnevnik = [];
p.stdout.on("data", (d) => dnevnik.push(String(d)));
p.stderr.on("data", (d) => dnevnik.push(String(d)));
const h = async (metoda, ruta, tijelo, zaglavlja = {}) => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${ruta}`, { method: metoda, headers: { ...(tijelo !== undefined ? { "Content-Type": "application/json" } : {}), ...zaglavlja }, body: tijelo === undefined ? undefined : JSON.stringify(tijelo) });
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
  const O1 = await prijava("o1", "198.51.100.151"), S1 = await prijava("s1", "198.51.100.152"), U1 = await prijava("u1", "198.51.100.153");
  const slika = (zahtjevId, sadrzaj = JPEG) => ({ slika: sadrzaj.toString("base64"), slicica: JPEG.toString("base64"), ...(zahtjevId ? { zahtjevId } : {}) });
  const IP = (n) => ({ "CF-Connecting-IP": `203.0.113.${n}` });

  console.log("\n— Veza za QR kod (prijavljeni)");
  let r = await h("GET", "/api/utovar/veza-za/otp-1");
  provjeri("  bez prijave → 401", r.s === 401, r.s);
  r = await h("GET", "/api/utovar/veza-za/otp-1", undefined, U1);
  provjeri("  pozicija bez otpremnica → 403", r.s === 403, r.s);
  r = await h("GET", "/api/utovar/veza-za/otp-1", undefined, S1);
  provjeri("  skladište (ne čita otpremnice) → 403", r.s === 403, r.s);
  r = await h("GET", "/api/utovar/veza-za/otp-1", undefined, O1);
  provjeri("  pozicija s otpremnicama dobiva potpisani token", r.s === 200 && r.j?.token === U.napraviToken(TAJNA, "otp-1"), JSON.stringify(r.j));
  const T1 = r.j?.token;
  const T2 = (await h("GET", "/api/utovar/veza-za/otp-2", undefined, O1)).j?.token;
  r = await h("GET", "/api/utovar/veza-za/loš%20id", undefined, O1);
  provjeri("  neispravan id otpremnice → 400", r.s === 400, r.s);

  console.log("\n— Stranica na mobitelu (javna veza)");
  r = await h("GET", `/api/utovar/veza/${encodeURIComponent(T1)}`, undefined, IP(1));
  provjeri("  veza vraća otpremnicu, projekt i kupca — bez prijave", r.s === 200 && r.j?.otpremnica?.broj === "OTP-24-11-1/26" && r.j?.projekt?.sifra === "RN 99-01" && r.j?.primatelj === "Kupac d.o.o." && r.j?.vecDodano === 0 && r.j?.danas === danas, JSON.stringify(r.j));
  r = await h("GET", `/api/utovar/veza/${encodeURIComponent(T2)}`, undefined, IP(1));
  provjeri("  otpremnica kooperantu: primatelj je kooperant", r.s === 200 && r.j?.primatelj === "Cinčaonica d.o.o." && r.j?.otpremnica?.vrsta === "kooperant", JSON.stringify(r.j));
  r = await h("GET", "/api/utovar/veza/otp-1.izmisljenpotpis", undefined, IP(1));
  provjeri("  izmišljen potpis → 404", r.s === 404, r.s);
  r = await h("GET", `/api/utovar/veza/${encodeURIComponent(U.napraviToken(TAJNA, "otp-stara"))}`, undefined, IP(1));
  provjeri("  veza stare otpremnice (40 dana) → 410 istekla", r.s === 410, r.s);
  r = await h("GET", `/api/utovar/veza/${encodeURIComponent(U.napraviToken(TAJNA, "nepostojeca"))}`, undefined, IP(1));
  provjeri("  ispravan potpis, ali otpremnica ne postoji → 404", r.s === 404, r.s);
  r = await h("GET", `/api/utovar/veza/${encodeURIComponent(U.napraviToken(TAJNA, "otp-bez-projekta"))}`, undefined, IP(1));
  provjeri("  otpremnica bez projekta → 404", r.s === 404, r.s);

  console.log("\n— Slanje slika");
  r = await h("POST", `/api/utovar/veza/${encodeURIComponent(T1)}/slika`, slika("zahtjev-0001"), IP(2));
  provjeri("  prva slika: naziv po datumu i broju otpremnice", r.s === 200 && r.j?.naziv === `utovar_${danas}_OTP-24-11-1-26_01.jpg`, JSON.stringify(r.j));
  const id1 = r.j?.id;
  r = await h("POST", `/api/utovar/veza/${encodeURIComponent(T1)}/slika`, slika("zahtjev-0002"), IP(2));
  provjeri("  druga slika dobiva sljedeći redni broj", r.s === 200 && r.j?.naziv === `utovar_${danas}_OTP-24-11-1-26_02.jpg`, JSON.stringify(r.j));
  const id2 = r.j?.id;
  r = await h("POST", `/api/utovar/veza/${encodeURIComponent(T1)}/slika`, slika("zahtjev-0001"), IP(2));
  provjeri("  ponovno slanje iste slike (isti zahtjevId) ne stvara duplikat", r.s === 200 && r.j?.ponovljeno === true && r.j?.id === id1, JSON.stringify(r.j));
  r = await h("GET", `/api/utovar/veza/${encodeURIComponent(T1)}`, undefined, IP(2));
  provjeri("  broj dodanih slika = 2", r.j?.vecDodano === 2, JSON.stringify(r.j));
  r = await h("POST", `/api/utovar/veza/${encodeURIComponent(T2)}/slika`, slika("zahtjev-0003"), IP(2));
  provjeri("  otpremnica kooperantu: vlastiti niz brojeva (01)", r.s === 200 && r.j?.naziv === `utovar_${danas}_OTP-24-11-2-26_01.jpg`, JSON.stringify(r.j));
  const idK = r.j?.id;
  r = await h("POST", `/api/utovar/veza/${encodeURIComponent(T1)}/slika`, slika("zahtjev-0004", Buffer.from("<html>nije slika</html>")), IP(2));
  provjeri("  datoteka koja nije JPEG → 400", r.s === 400, JSON.stringify(r.j));
  r = await h("POST", `/api/utovar/veza/${encodeURIComponent(T1)}/slika`, { slika: JPEG.toString("base64") }, IP(2));
  provjeri("  bez sličice → 400", r.s === 400, r.s);
  r = await h("POST", `/api/utovar/veza/${encodeURIComponent(T1)}/slika`, slika("zahtjev-0005", Buffer.concat([JPEG, Buffer.alloc(3_100_000)])), IP(2));
  provjeri("  slika veća od 3 MB → 400", r.s === 400, r.s);
  r = await h("POST", "/api/utovar/veza/otp-1.krivipotpis/slika", slika("zahtjev-0006"), IP(2));
  provjeri("  slanje s krivim potpisom → 404", r.s === 404, r.s);
  r = await h("POST", `/api/utovar/veza/${encodeURIComponent(U.napraviToken(TAJNA, "otp-stara"))}/slika`, slika("zahtjev-0007"), IP(2));
  provjeri("  slanje uz isteklu vezu → 410", r.s === 410, r.s);

  console.log("\n— Ograničenje broja slika po otpremnici");
  let zadnji = null;
  for (let i = 0; i < U.MAX_PO_OTPREMNICI - 2; i++) zadnji = await h("POST", `/api/utovar/veza/${encodeURIComponent(T1)}/slika`, slika(`puno-${String(i).padStart(3, "0")}`), IP(3));
  provjeri(`  do ${U.MAX_PO_OTPREMNICI} slika prolazi`, zadnji?.s === 200, JSON.stringify(zadnji));
  r = await h("POST", `/api/utovar/veza/${encodeURIComponent(T1)}/slika`, slika("jedna-previse"), IP(3));
  provjeri("  slika preko granice → 409", r.s === 409, JSON.stringify(r.j));
  r = await h("POST", `/api/utovar/veza/${encodeURIComponent(T1)}/slika`, slika("puno-000"), IP(3));
  provjeri("  ponovljeno slanje već spremljene slike i dalje prolazi (nije nova)", r.s === 200 && r.j?.ponovljeno === true, JSON.stringify(r.j));

  console.log("\n— Pregled u projektu (prijavljeni)");
  r = await h("GET", "/api/utovar/projekt/p2", undefined, O1);
  provjeri("  popis slika projekta: jedna slika, bez sadržaja, s datumom i nazivom", r.s === 200 && r.j?.slike?.length === 1 && r.j.slike[0].datum === danas && r.j.slike[0].otpremnica === "OTP-24-11-2/26" && r.j.slike[0].imaOriginal === true && !("slika" in r.j.slike[0]) && !r.j.slike[0].spremljenoZ, JSON.stringify(r.j));
  r = await h("GET", "/api/utovar/projekt/p2");
  provjeri("  bez prijave → 401", r.s === 401, r.s);
  r = await h("GET", "/api/utovar/projekt/p2", undefined, U1);
  provjeri("  pozicija bez otpremnica → 403", r.s === 403, r.s);
  r = await h("GET", "/api/utovar/projekt/p2", undefined, S1);
  provjeri("  skladište (ne čita otpremnice) → 403", r.s === 403, r.s);
  r = await h("GET", `/api/utovar/slika/${idK}`, undefined, O1);
  provjeri("  sličica se dohvaća kao image/jpeg uz prijavu", r.s === 200 && r.tip.startsWith("image/jpeg") && r.buf.equals(JPEG), r.s + " " + r.tip);
  r = await h("GET", `/api/utovar/slika/${idK}?original=1`, undefined, O1);
  provjeri("  original se dohvaća kao image/jpeg", r.s === 200 && r.tip.startsWith("image/jpeg") && r.buf.equals(JPEG), r.s);
  r = await h("GET", `/api/utovar/slika/${idK}`, undefined, S1);
  provjeri("  slika bez ovlasti za otpremnice → 403", r.s === 403, r.s);
  r = await h("GET", `/api/utovar/slika/${idK}`);
  provjeri("  slika bez prijave → 401", r.s === 401, r.s);
  r = await h("GET", "/api/utovar/slika/nema-je", undefined, O1);
  provjeri("  nepoznata slika → 404", r.s === 404, r.s);

  console.log("\n— Uklanjanje");
  r = await h("DELETE", `/api/utovar/veza/${encodeURIComponent(T2)}/slika/${id1}`, undefined, IP(4));
  provjeri("  s mobitela se ne može ukloniti slika druge otpremnice → 404", r.s === 404, r.s);
  r = await h("DELETE", `/api/utovar/veza/${encodeURIComponent(T1)}/slika/${id2}`, undefined, IP(4));
  provjeri("  s mobitela se može ukloniti vlastita svježa slika", r.s === 200, r.s);
  r = await h("DELETE", `/api/utovar/slika/${id1}`, undefined, S1);
  provjeri("  skladište (bez izmjena otpremnica) ne uklanja → 403", r.s === 403, r.s);
  r = await h("DELETE", `/api/utovar/slika/${id1}`, undefined, O1);
  provjeri("  u ERP-u uklanja pozicija s izmjenama otpremnica", r.s === 200, r.s);
  r = await h("DELETE", `/api/utovar/slika/${id1}`, undefined, O1);
  provjeri("  ponovno uklanjanje → 404", r.s === 404, r.s);

  console.log("\n— Most");
  r = await h("GET", "/api/most/utovar/cekaju");
  provjeri("  bez tokena mosta → 401", r.s === 401, r.s);
  r = await h("GET", "/api/most/utovar/cekaju", undefined, { "X-Most-Token": "pogresan-token-pogresan-token-pogresan" });
  provjeri("  pogrešan token mosta → 401", r.s === 401, r.s);
  r = await h("GET", "/api/most/utovar/cekaju", undefined, O1);
  provjeri("  korisnički token nije token mosta → 401", r.s === 401, r.s);
  r = await h("GET", "/api/most/utovar/cekaju", undefined, MOSTH);
  const cekaju = r.j?.slike || [];
  const k = cekaju.find((x) => x.id === idK);
  provjeri("  red za most: slike koje čekaju, s projektom, mapom i datumom", r.s === 200 && cekaju.length > 0 && cekaju.length <= 20 && k?.sifra === "RN 99-02" && k?.mapa === "Z:\\Projekti\\RN 99-02_Drugi" && k?.datum === danas && k?.naziv === `utovar_${danas}_OTP-24-11-2-26_01.jpg`, JSON.stringify(k));
  provjeri("  red ne sadrži sadržaj slike", !JSON.stringify(r.j).includes(JPEG.toString("base64")));
  r = await h("GET", `/api/most/utovar/slika/${idK}`, undefined, MOSTH);
  provjeri("  most preuzima original", r.s === 200 && r.tip.startsWith("image/jpeg") && r.buf.equals(JPEG), r.s);
  r = await h("POST", `/api/most/utovar/slika/${idK}/rezultat`, { status: "spremljeno", putanja: `Z:\\Projekti\\RN 99-02_Drugi\\Fotografije - Utovar\\${danas}\\x.jpg` }, MOSTH);
  provjeri("  most javlja spremanje na Z:", r.s === 200, r.s);
  r = await h("GET", "/api/most/utovar/cekaju", undefined, MOSTH);
  provjeri("  spremljena slika više nije u redu", !(r.j?.slike || []).some((x) => x.id === idK));
  r = await h("GET", "/api/utovar/projekt/p2", undefined, O1);
  provjeri("  u projektu se vidi vrijeme spremanja i putanja", !!r.j?.slike?.[0]?.spremljenoZ && r.j.slike[0].putanjaZ.includes("Fotografije - Utovar") && r.j.slike[0].greskaZ === "", JSON.stringify(r.j?.slike?.[0]));
  r = await h("DELETE", `/api/utovar/veza/${encodeURIComponent(T2)}/slika/${idK}`, undefined, IP(4));
  provjeri("  spremljena slika se više ne uklanja s mobitela → 409", r.s === 409, r.s);
  const ostale = (await h("GET", "/api/most/utovar/cekaju", undefined, MOSTH)).j?.slike || [];
  const prva = ostale[0];
  r = await h("POST", `/api/most/utovar/slika/${prva.id}/rezultat`, { status: "greska", poruka: "U Z:\\Projekti nema mape čije ime počinje s RN 99-01." }, MOSTH);
  provjeri("  most javlja grešku (mapa nije pronađena)", r.s === 200, r.s);
  r = await h("GET", "/api/utovar/projekt/p1", undefined, O1);
  provjeri("  greška se vidi u projektu, slika nije označena kao spremljena", r.j?.slike?.some((x) => x.greskaZ.includes("nema mape") && !x.spremljenoZ), JSON.stringify(r.j?.slike?.slice(0, 2)));
  r = await h("POST", "/api/most/utovar/slika/nema-je/rezultat", { status: "spremljeno", putanja: "x" }, MOSTH);
  provjeri("  rezultat za nepoznatu sliku → 404", r.s === 404, r.s);
  r = await h("POST", `/api/most/utovar/slika/${idK}/rezultat`, { status: "spremljeno", putanja: "x" });
  provjeri("  rezultat bez tokena mosta → 401", r.s === 401, r.s);

  console.log("\n— Ograničenje zahtjeva po adresi");
  let zadnjiGet = null;
  for (let i = 0; i < 260; i++) zadnjiGet = await h("GET", `/api/utovar/veza/${encodeURIComponent(T1)}`, undefined, IP(9));
  provjeri("  nakon previše zahtjeva s jedne adrese → 429", zadnjiGet?.s === 429, zadnjiGet?.s);
  r = await h("GET", `/api/utovar/veza/${encodeURIComponent(T1)}`, undefined, IP(10));
  provjeri("  druga adresa nije pogođena", r.s === 200, r.s);

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-2000));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

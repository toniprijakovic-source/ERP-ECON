// API test: fotografije montaže po oznaci — učitavanje oznaka, potpisana QR veza po poziciji (bez prijave), slanje slika, status "montirano" (traži sliku),
// ovlasti, uklanjanje i rute za most. Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3098); izmišljeni podaci.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const M = require("../montaza");
const PORT = Number(process.env.TEST_PORT_MONTAZA || 3098);
const TAJNA = "test-tajna-samo-za-lokalni-test-0123456789";
const MOST = "test-most-token-samo-za-lokalni-test-0123";
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });
const danas = require("../utovar").zagrebDatum();

// ----- čiste funkcije (isti primjeri kao u frontend/src/montazaOznake.test.js) -----
assert.strictEqual(M.mapaOznake("J-3.OG"), "J-3.OG");
assert.strictEqual(M.mapaOznake("  A 1  "), "A-1");
assert.strictEqual(M.mapaOznake("B/2 (lijevo)"), "B-2-lijevo");
assert.strictEqual(M.mapaOznake("Čaplja 5"), "Čaplja-5");
assert.strictEqual(M.mapaOznake("..\\..\\x"), "x", "napad putanjom se pretvara u običan naziv");
assert.strictEqual(M.mapaOznake("a/../b"), "a-..-b");
assert.strictEqual(M.mapaOznake("C-7."), "C-7", "završna točka nije dopuštena u nazivu mape na Windowsu");
assert.strictEqual(M.mapaOznake("CON"), "CON_", "rezervirano ime Windowsa");
assert.strictEqual(M.mapaOznake("lpt1"), "lpt1_");
assert.strictEqual(M.mapaOznake("???"), "");
assert.strictEqual(M.ocistiOznaku("  J-3.OG \t"), "J-3.OG");
assert.strictEqual(M.ocistiOznaku("x".repeat(80)).length, 40);
assert.strictEqual(M.nazivSlike("2026-11-24", "J-3.OG", 3), "2026-11-24_J-3.OG_03.jpg");
const t = M.napraviToken(TAJNA, "proj-1", "J-3.OG");
assert.deepStrictEqual(M.provjeriToken(TAJNA, t), { projektId: "proj-1", mapa: "J-3.OG" });
assert.strictEqual(M.provjeriToken(TAJNA, t.replace("J-3.OG", "J-4.OG")), null, "token vrijedi samo za svoju poziciju");
assert.strictEqual(M.provjeriToken(TAJNA, t.replace("proj-1", "proj-2")), null, "i samo za svoj projekt");
assert.strictEqual(M.provjeriToken("druga-tajna", t), null);
assert.strictEqual(M.provjeriToken(TAJNA, "a~b"), null);
assert.strictEqual(M.provjeriToken(TAJNA, "proj-1~..~x"), null);
assert.strictEqual(M.provjeriToken(TAJNA, ""), null);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("izmisljena-slika-za-test")]);

const seed = {
  zaposlenici: [zap("o1", "Voditelj", "poz-projekti"), zap("s1", "Skladiste", "poz-skl"), zap("u1", "Ured", "poz-ured")],
  pozicijeZaposlenika: [
    { id: "poz-projekti", naziv: "Projekti", moduli: ["dashboard", "projekti"] },
    { id: "poz-skl", naziv: "Skladište", moduli: ["dashboard", "skladiste"] },
    { id: "poz-ured", naziv: "Ured", moduli: ["dashboard"] },
  ],
  projekti: [{ id: "p1", sifra: "RN 99-01", naziv: "Balkone test", status: "U izradi" }, { id: "p2", sifra: "RN 99-02", naziv: "Arhivirani", status: "Arhiviran" }, { id: "p3", sifra: "RN 99-03", naziv: "Drugi", status: "U izradi", mapa: "Z:\\Projekti\\RN 99-03_Drugi" }],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-montaza-"));
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
  const V = await prijava("o1", "198.51.100.161"), S = await prijava("s1", "198.51.100.162"), U = await prijava("u1", "198.51.100.163");
  const slika = (zahtjevId, sadrzaj = JPEG) => ({ slika: sadrzaj.toString("base64"), slicica: JPEG.toString("base64"), ...(zahtjevId ? { zahtjevId } : {}) });
  const IP = (n) => ({ "CF-Connecting-IP": `203.0.113.${n}` });
  const sveOznake = [...Array.from({ length: 7 }, (_, i) => `A-${i + 1}.OG`), ...["B", "C", "D", "E", "F", "G", "H", "I", "J"].flatMap((s) => [3, 4, 5, 6, 7].map((e) => `${s}-${e}.OG`))];

  console.log("\n— Učitavanje oznaka");
  let r = await h("PUT", "/api/montaza/projekt/p1/pozicije", { oznake: sveOznake });
  provjeri("  bez prijave → 401", r.s === 401, r.s);
  r = await h("PUT", "/api/montaza/projekt/p1/pozicije", { oznake: sveOznake }, U);
  provjeri("  pozicija bez izmjena projekata → 403", r.s === 403, r.s);
  r = await h("PUT", "/api/montaza/projekt/p1/pozicije", { oznake: sveOznake }, S);
  provjeri("  skladište (ne mijenja projekte) → 403", r.s === 403, r.s);
  r = await h("PUT", "/api/montaza/projekt/nema/pozicije", { oznake: ["A-1"] }, V);
  provjeri("  nepostojeći projekt → 404", r.s === 404, r.s);
  r = await h("PUT", "/api/montaza/projekt/p1/pozicije", { oznake: [] }, V);
  provjeri("  prazan popis → 400", r.s === 400, r.s);
  r = await h("PUT", "/api/montaza/projekt/p1/pozicije", { oznake: sveOznake.concat(["a-1.og", "  J-3.OG ", "", "???", "CON"]) }, V);
  provjeri("  52 oznake dodano; duplikati (i drukčija velika/mala slova), prazno i nedopušteno se preskaču", r.s === 200 && r.j?.dodano === 53 && r.j.preskoceno.length === 3 && r.j.preskoceno.filter((x) => x.razlog === "već postoji").length === 2, JSON.stringify(r.j));
  r = await h("PUT", "/api/montaza/projekt/p1/pozicije", { oznake: ["A-1.OG", "K-1.OG"] }, V);
  provjeri("  ponovni uvoz: postojeća se preskače, nova dodaje", r.s === 200 && r.j?.dodano === 1 && r.j.preskoceno.length === 1, JSON.stringify(r.j));
  r = await h("GET", "/api/montaza/projekt/p1", undefined, V);
  provjeri("  popis pozicija projekta (54), nijedna montirana, bez slika", r.s === 200 && r.j?.pozicije?.length === 54 && r.j.pozicije.every((x) => !x.montirano) && r.j.slike.length === 0, `${r.s} ${r.j?.pozicije?.length}`);
  provjeri("  redoslijed uvoza je sačuvan", r.j?.pozicije?.[0]?.oznaka === "A-1.OG" && r.j.pozicije[7]?.oznaka === "B-3.OG");
  r = await h("GET", "/api/montaza/projekt/p1", undefined, U);
  provjeri("  popis čita svatko tko vidi projekte (nadzorna ploča)", r.s === 200, r.s);
  r = await h("GET", "/api/montaza/projekt/p1");
  provjeri("  popis bez prijave → 401", r.s === 401, r.s);

  console.log("\n— Veze za ispis (QR naljepnice)");
  r = await h("GET", "/api/montaza/projekt/p1/veze", undefined, S);
  provjeri("  veze za ispis traže izmjene projekata → 403", r.s === 403, r.s);
  r = await h("GET", "/api/montaza/projekt/p1/veze");
  provjeri("  bez prijave → 401", r.s === 401, r.s);
  r = await h("GET", "/api/montaza/projekt/p1/veze", undefined, V);
  provjeri("  54 veze, svaka s potpisanim tokenom svoje pozicije", r.s === 200 && r.j?.veze?.length === 54 && r.j.veze.every((x) => x.token === M.napraviToken(TAJNA, "p1", x.mapa)), JSON.stringify(r.j?.veze?.[0]));
  const VEZE = r.j.veze;
  const token = (oznaka) => VEZE.find((x) => x.oznaka === oznaka).token;
  const Tj3 = token("J-3.OG"), Ta1 = token("A-1.OG");

  console.log("\n— Stranica na mobitelu (javna veza)");
  r = await h("GET", `/api/montaza/veza/${encodeURIComponent(Tj3)}`, undefined, IP(1));
  provjeri("  veza vraća projekt, oznaku i stanje — bez prijave", r.s === 200 && r.j?.projekt?.sifra === "RN 99-01" && r.j?.oznaka === "J-3.OG" && r.j?.vecDodano === 0 && r.j?.montirano === null && r.j?.danas === danas, JSON.stringify(r.j));
  r = await h("GET", "/api/montaza/veza/p1~J-3.OG~krivipotpis", undefined, IP(1));
  provjeri("  izmišljen potpis → 404", r.s === 404, r.s);
  r = await h("GET", `/api/montaza/veza/${encodeURIComponent(M.napraviToken(TAJNA, "p1", "Z-9.OG"))}`, undefined, IP(1));
  provjeri("  ispravan potpis, ali pozicija ne postoji → 404", r.s === 404, r.s);
  r = await h("GET", `/api/montaza/veza/${encodeURIComponent(M.napraviToken(TAJNA, "p2", "A-1"))}`, undefined, IP(1));
  provjeri("  arhiviran projekt → 410", r.s === 410, r.s);
  r = await h("GET", `/api/montaza/veza/${encodeURIComponent(M.napraviToken(TAJNA, "nema", "A-1"))}`, undefined, IP(1));
  provjeri("  nepostojeći projekt → 404", r.s === 404, r.s);

  console.log("\n— Slanje slika");
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Tj3)}/montirano`, { montirano: true }, IP(2));
  provjeri("  montirano bez ijedne slike → 409", r.s === 409, JSON.stringify(r.j));
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Tj3)}/slika`, slika("mz-0001"), IP(2));
  provjeri("  prva slika: naziv <datum>_<oznaka>_01.jpg", r.s === 200 && r.j?.naziv === `${danas}_J-3.OG_01.jpg`, JSON.stringify(r.j));
  const id1 = r.j?.id;
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Tj3)}/slika`, slika("mz-0002"), IP(2));
  provjeri("  druga slika dobiva sljedeći redni broj", r.s === 200 && r.j?.naziv === `${danas}_J-3.OG_02.jpg`, JSON.stringify(r.j));
  const id2 = r.j?.id;
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Tj3)}/slika`, slika("mz-0001"), IP(2));
  provjeri("  ponovno slanje iste slike ne stvara duplikat", r.s === 200 && r.j?.ponovljeno === true && r.j?.id === id1, JSON.stringify(r.j));
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Ta1)}/slika`, slika("mz-0003"), IP(2));
  provjeri("  druga pozicija ima vlastiti niz brojeva", r.s === 200 && r.j?.naziv === `${danas}_A-1.OG_01.jpg`, JSON.stringify(r.j));
  const idA1 = r.j?.id;
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Tj3)}/slika`, slika("mz-0004", Buffer.from("<html>nije slika</html>")), IP(2));
  provjeri("  datoteka koja nije JPEG → 400", r.s === 400, r.s);
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Tj3)}/slika`, slika("mz-0005", Buffer.concat([JPEG, Buffer.alloc(3_100_000)])), IP(2));
  provjeri("  slika veća od 3 MB → 400", r.s === 400, r.s);
  r = await h("POST", "/api/montaza/veza/p1~J-3.OG~krivipotpis/slika", slika("mz-0006"), IP(2));
  provjeri("  slanje s krivim potpisom → 404", r.s === 404, r.s);
  r = await h("GET", `/api/montaza/veza/${encodeURIComponent(Tj3)}`, undefined, IP(2));
  provjeri("  stranica pokazuje 2 slike", r.j?.vecDodano === 2, JSON.stringify(r.j));

  console.log("\n— Označavanje montiranim");
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Tj3)}/montirano`, { montirano: true }, IP(3));
  provjeri("  uz slike monter označava montirano", r.s === 200 && typeof r.j?.montirano === "string", JSON.stringify(r.j));
  const vrijeme = r.j?.montirano;
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Tj3)}/montirano`, { montirano: true }, IP(3));
  provjeri("  ponovno označavanje ne mijenja vrijeme", r.s === 200 && r.j?.montirano === vrijeme, JSON.stringify(r.j));
  r = await h("GET", `/api/montaza/veza/${encodeURIComponent(Tj3)}`, undefined, IP(3));
  provjeri("  stranica pokazuje montirano", r.j?.montirano === vrijeme, JSON.stringify(r.j));
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Tj3)}/montirano`, { montirano: false }, IP(3));
  provjeri("  monter može poništiti svježe označavanje", r.s === 200 && r.j?.montirano === null, JSON.stringify(r.j));
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(Tj3)}/montirano`, { montirano: true }, IP(3));
  provjeri("  i ponovno označiti", r.s === 200 && typeof r.j?.montirano === "string", JSON.stringify(r.j));

  console.log("\n— Pregled u projektu");
  r = await h("GET", "/api/montaza/projekt/p1", undefined, V);
  const j3 = r.j?.pozicije?.find((x) => x.mapa === "J-3.OG");
  provjeri("  popis: J-3.OG je montirana, slike su po pozicijama", r.s === 200 && !!j3?.montirano && r.j.slike.filter((x) => x.mapa === "J-3.OG").length === 2 && r.j.slike.length === 3 && !("slika" in r.j.slike[0]), JSON.stringify(j3));
  r = await h("GET", `/api/montaza/slika/${id1}`, undefined, V);
  provjeri("  sličica se dohvaća kao image/jpeg uz prijavu", r.s === 200 && r.tip.startsWith("image/jpeg") && r.buf.equals(JPEG), r.s);
  r = await h("GET", `/api/montaza/slika/${id1}?original=1`, undefined, V);
  provjeri("  original se dohvaća kao image/jpeg", r.s === 200 && r.buf.equals(JPEG), r.s);
  r = await h("GET", `/api/montaza/slika/${id1}`);
  provjeri("  slika bez prijave → 401", r.s === 401, r.s);
  r = await h("GET", "/api/montaza/slika/nema-je", undefined, V);
  provjeri("  nepoznata slika → 404", r.s === 404, r.s);

  console.log("\n— Izmjene u ERP-u");
  r = await h("POST", "/api/montaza/projekt/p1/pozicija/A-2.OG/montirano", { montirano: true }, S);
  provjeri("  bez izmjena projekata → 403", r.s === 403, r.s);
  r = await h("POST", "/api/montaza/projekt/p1/pozicija/A-2.OG/montirano", { montirano: true }, V);
  provjeri("  ured označava montirano i bez slike (npr. montirano prije uvođenja QR-a)", r.s === 200 && typeof r.j?.montirano === "string", JSON.stringify(r.j));
  r = await h("POST", "/api/montaza/projekt/p1/pozicija/A-2.OG/montirano", { montirano: false }, V);
  provjeri("  i poništava u bilo kojem trenutku", r.s === 200 && r.j?.montirano === null, JSON.stringify(r.j));
  r = await h("POST", "/api/montaza/projekt/p1/pozicija/Z-9.OG/montirano", { montirano: true }, V);
  provjeri("  nepoznata pozicija → 404", r.s === 404, r.s);
  r = await h("DELETE", "/api/montaza/projekt/p1/pozicija/J-3.OG", undefined, V);
  provjeri("  montiranu poziciju se ne briše → 409", r.s === 409, JSON.stringify(r.j));
  r = await h("POST", "/api/montaza/projekt/p1/pozicija/J-3.OG/montirano", { montirano: false }, V);
  r = await h("DELETE", "/api/montaza/projekt/p1/pozicija/J-3.OG", undefined, V);
  provjeri("  poziciju s fotografijama se ne briše → 409", r.s === 409, JSON.stringify(r.j));
  r = await h("DELETE", "/api/montaza/projekt/p1/pozicija/K-1.OG", undefined, S);
  provjeri("  brisanje bez izmjena projekata → 403", r.s === 403, r.s);
  r = await h("DELETE", "/api/montaza/projekt/p1/pozicija/K-1.OG", undefined, V);
  provjeri("  prazna pozicija se briše", r.s === 200, JSON.stringify(r.j));
  r = await h("GET", `/api/montaza/veza/${encodeURIComponent(M.napraviToken(TAJNA, "p1", "K-1.OG"))}`, undefined, IP(4));
  provjeri("  QR obrisane pozicije više ne radi → 404", r.s === 404, r.s);

  console.log("\n— Uklanjanje slika");
  r = await h("DELETE", `/api/montaza/veza/${encodeURIComponent(Ta1)}/slika/${id1}`, undefined, IP(5));
  provjeri("  s mobitela se ne može ukloniti slika druge pozicije → 404", r.s === 404, r.s);
  r = await h("DELETE", `/api/montaza/veza/${encodeURIComponent(Tj3)}/slika/${id2}`, undefined, IP(5));
  provjeri("  s mobitela se može ukloniti vlastita svježa slika", r.s === 200, r.s);
  r = await h("DELETE", `/api/montaza/slika/${id1}`, undefined, S);
  provjeri("  u ERP-u bez izmjena projekata → 403", r.s === 403, r.s);
  r = await h("DELETE", `/api/montaza/slika/${idA1}`, undefined, V);
  provjeri("  u ERP-u uklanja pozicija s izmjenama projekata", r.s === 200, r.s);
  r = await h("DELETE", `/api/montaza/slika/${idA1}`, undefined, V);
  provjeri("  ponovno uklanjanje → 404", r.s === 404, r.s);

  console.log("\n— Most");
  r = await h("GET", "/api/most/montaza/cekaju");
  provjeri("  bez tokena mosta → 401", r.s === 401, r.s);
  r = await h("GET", "/api/most/montaza/cekaju", undefined, V);
  provjeri("  korisnički token nije token mosta → 401", r.s === 401, r.s);
  r = await h("GET", "/api/most/montaza/cekaju", undefined, MOSTH);
  const red = r.j?.slike || [];
  provjeri("  red za most: slika koja čeka, s projektom, pozicijom i datumom", r.s === 200 && red.length === 1 && red[0].sifra === "RN 99-01" && red[0].pozicija === "J-3.OG" && red[0].datum === danas && red[0].naziv === `${danas}_J-3.OG_01.jpg`, JSON.stringify(red));
  provjeri("  red ne sadrži sadržaj slike", !JSON.stringify(r.j).includes(JPEG.toString("base64")));
  r = await h("GET", `/api/most/montaza/slika/${red[0]?.id}`, undefined, MOSTH);
  provjeri("  most preuzima original", r.s === 200 && r.buf.equals(JPEG), r.s);
  r = await h("POST", `/api/most/montaza/slika/${red[0]?.id}/rezultat`, { status: "spremljeno", putanja: `Z:\\Projekti\\x\\Fotografije - Montaža\\J-3.OG\\${danas}_J-3.OG_01.jpg` }, MOSTH);
  provjeri("  most javlja spremanje na Z:", r.s === 200, r.s);
  r = await h("GET", "/api/most/montaza/cekaju", undefined, MOSTH);
  provjeri("  spremljena slika više nije u redu", (r.j?.slike || []).length === 0);
  r = await h("GET", "/api/montaza/projekt/p1", undefined, V);
  const s1 = r.j?.slike?.find((x) => x.id === id1);
  provjeri("  u projektu se vidi vrijeme spremanja i putanja", !!s1?.spremljenoZ && s1.putanjaZ.includes("Fotografije - Montaža"), JSON.stringify(s1));
  r = await h("DELETE", `/api/montaza/veza/${encodeURIComponent(Tj3)}/slika/${id1}`, undefined, IP(5));
  provjeri("  spremljena slika se više ne uklanja s mobitela → 409", r.s === 409, r.s);
  const novi = await h("POST", `/api/montaza/veza/${encodeURIComponent(token("A-3.OG"))}/slika`, slika("mz-0010"), IP(5));
  r = await h("POST", `/api/most/montaza/slika/${novi.j?.id}/rezultat`, { status: "greska", poruka: "U Z:\\Projekti nema mape čije ime počinje s RN 99-01." }, MOSTH);
  provjeri("  most javlja grešku", r.s === 200, r.s);
  r = await h("GET", "/api/montaza/projekt/p1", undefined, V);
  provjeri("  greška se vidi u projektu, slika nije označena kao spremljena", r.j?.slike?.some((x) => x.id === novi.j?.id && x.greskaZ.includes("nema mape") && !x.spremljenoZ), JSON.stringify(r.j?.slike?.slice(-1)));
  r = await h("POST", "/api/most/montaza/slika/nema-je/rezultat", { status: "spremljeno", putanja: "x" }, MOSTH);
  provjeri("  rezultat za nepoznatu sliku → 404", r.s === 404, r.s);

  console.log("\n— Granica slika po poziciji");
  let zadnji = null;
  for (let i = 0; i < 30; i++) zadnji = await h("POST", `/api/montaza/veza/${encodeURIComponent(token("B-3.OG"))}/slika`, slika(`puno-${String(i).padStart(3, "0")}`), IP(6));
  provjeri("  do 30 slika prolazi", zadnji?.s === 200, JSON.stringify(zadnji?.j));
  r = await h("POST", `/api/montaza/veza/${encodeURIComponent(token("B-3.OG"))}/slika`, slika("jedna-previse"), IP(6));
  provjeri("  31. slika → 409", r.s === 409, r.s);

  console.log("\n— Ograničenje zahtjeva po adresi");
  let zadnjiGet = null;
  for (let i = 0; i < 260; i++) zadnjiGet = await h("GET", `/api/montaza/veza/${encodeURIComponent(Tj3)}`, undefined, IP(9));
  provjeri("  nakon previše zahtjeva s jedne adrese → 429", zadnjiGet?.s === 429, zadnjiGet?.s);
  r = await h("GET", `/api/montaza/veza/${encodeURIComponent(Tj3)}`, undefined, IP(10));
  provjeri("  druga adresa nije pogođena", r.s === 200, r.s);

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-2000));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

// API test: veza s mostom (most-veza.js) — trajni red zadataka (XRechnung), izvještaj o serveru i upozorenja u zvoncu, automatska "Mapa projekta".
// Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3100); izmišljeni podaci, bez prave baze i bez pravog mosta.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_MOST || 3100);
const TOKEN = "test-token-mosta-0123456789-abcdef";
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });
const prije = (min) => new Date(Date.now() - min * 60000).toISOString();
const seed = {
  zaposlenici: [zap("a1", "Direktor", "poz-direktor"), zap("f1", "Financije", "poz-financije"), zap("r1", "Radnik", "poz-radnik"), zap("c1", "Citanje", "poz-direktor-citanje")],
  pozicijeZaposlenika: [
    { id: "poz-direktor", naziv: "Direktor", moduli: ["dashboard", "direktor", "fakturiranje"] },
    { id: "poz-financije", naziv: "Financije", moduli: ["dashboard", "fakturiranje"] },
    { id: "poz-radnik", naziv: "Radnik", moduli: ["dashboard"] },
    { id: "poz-direktor-citanje", naziv: "Direktor bez izmjena servera", moduli: ["dashboard", "direktor"], karticeDozvole: { direktor: { server: { pristup: true, izmjene: false } } } },
  ],
  projekti: [
    { id: "p1", sifra: "RN 170-901", naziv: "Probni projekt jedan", status: "U izradi", mapa: "" },
    { id: "p2", sifra: "RN 170-902", naziv: "Probni projekt dva", status: "U izradi", mapa: "Z:\\Rucno\\RN 170-902 rucno" },
    { id: "p3", sifra: "RN 170-903", naziv: "Arhivirani", status: "Arhiviran" },
    { id: "p4", sifra: "", naziv: "Bez šifre", status: "U izradi" },
    { id: "p5", sifra: "RN 170-905", naziv: "Probni projekt pet", status: "Završen" },
  ],
  slobodniZadaci: [], xrechnungPostavke: {}, kupci: [],
  // Most se zadnji put javio prije 40 minuta (zapisano u bazi prije restarta poslužitelja).
  __mostStanje: { kontakt: { vrijednost: { zadnjiPut: prije(40) }, azurirano: prije(40) } },
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-most-"));
const seedPutanja = path.join(mapa, "seed.json");
fs.writeFileSync(seedPutanja, JSON.stringify(seed));
const p = spawn(process.execPath, ["--require", path.join(__dirname, "lazni-pg-preload.js"), path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: String(PORT), JWT_SECRET: "test-tajna-samo-za-lokalni-test-0123456789", DATABASE_URL: "fake://lokalno", MOST_TOKEN: TOKEN, SEED_FILE: seedPutanja }, cwd: mapa });
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
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const MOST = { "X-Most-Token": TOKEN };

(async () => {
  await cekaj(1800);
  const prijava = async (id, ip) => { const r = await h("POST", "/api/auth/login", { zaposlenikId: id, lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": ip }); return { Authorization: `Bearer ${r.j?.token}` }; };
  const A1 = await prijava("a1", "198.51.100.141"), F1 = await prijava("f1", "198.51.100.142"), R1 = await prijava("r1", "198.51.100.143"), C1 = await prijava("c1", "198.51.100.144");
  const zadaciServera = async () => ((await h("GET", "/api/data/slobodniZadaci", undefined, A1)).j || []).filter((z) => z.serverUpozorenje);

  console.log("\n— Stanje servera: most šuti (zadnji kontakt iz baze, prije restarta)");
  let r = await h("GET", "/api/server/stanje", undefined, F1);
  provjeri("  bez modula Direktorski pregled → 403", r.s === 403, r.s);
  r = await h("GET", "/api/server/stanje", undefined, A1);
  provjeri("  direktor vidi stanje; most nije povezan, zadnji kontakt iz baze", r.s === 200 && r.j?.most?.povezan === false && r.j.most.zadnjiKontakt === seed.__mostStanje.kontakt.vrijednost.zadnjiPut, JSON.stringify(r.j?.most));
  provjeri("  upozorenje: most se ne javlja (samo to, bez starog izvještaja)", r.j?.upozorenja?.length === 1 && r.j.upozorenja[0].kljuc === "most", JSON.stringify(r.j?.upozorenja));
  provjeri("  bez odabranog primatelja nema zadatka u zvoncu", (await zadaciServera()).length === 0);
  r = await h("PUT", "/api/server/postavke", { primateljId: "a1" }, C1);
  provjeri("  postavke bez izmjena na kartici → 403", r.s === 403, r.s);
  r = await h("PUT", "/api/server/postavke", { primateljId: "nepostojeci" }, A1);
  provjeri("  nepostojeći zaposlenik → 400", r.s === 400, r.s);
  r = await h("PUT", "/api/server/postavke", { primateljId: "a1" }, A1);
  await cekaj(300);
  let zs = await zadaciServera();
  provjeri("  primatelj odabran → zadatak 'most' u zvoncu direktora, zadao ERP (sustav)", r.s === 200 && zs.length === 1 && zs[0].serverUpozorenje === "most" && zs[0].dodijeljenoId === "a1" && zs[0].zadaoId === "sustav" && !zs[0].izvrseno, JSON.stringify(zs));
  r = await h("GET", "/api/obavijesti", undefined, A1);
  provjeri("  zvonce: obavijest o dodjeli zadatka", r.s === 200 && r.j?.obavijesti?.some((o) => o.vrsta === "dodjela" && o.naziv.startsWith("Server: Most na serveru")), JSON.stringify(r.j));
  r = await h("PUT", "/api/server/postavke", { primateljId: "a1" }, A1);
  await cekaj(300);
  provjeri("  ponovna provjera ne stvara drugi isti zadatak", (await zadaciServera()).length === 1);

  console.log("\n— Red zadataka (aplikacija)");
  r = await h("GET", "/api/xrechnung/zadaci", undefined, R1);
  provjeri("  bez pristupa kartici XRechnung → 403", r.s === 403, r.s);
  r = await h("GET", "/api/xrechnung/zadaci", undefined, F1);
  provjeri("  prazan red, most nije povezan", r.s === 200 && r.j?.zadaci?.length === 0 && r.j.most?.povezan === false, JSON.stringify(r.j));
  r = await h("POST", "/api/xrechnung/zadaci", { projektId: "p1", eAdresa: "nije-adresa" }, F1);
  provjeri("  neispravna e-adresa → 400", r.s === 400, r.s);
  r = await h("POST", "/api/xrechnung/zadaci", { projektId: "nema", eAdresa: "racuni@primjer.test" }, F1);
  provjeri("  nepoznat projekt → 404", r.s === 404, r.s);
  r = await h("POST", "/api/xrechnung/zadaci", { projektId: "p1", eAdresa: "racuni@primjer.test", referenca: "REF-1" }, F1);
  const z1 = r.j?.zadatak;
  provjeri("  zadatak XRechnung upisan (Čeka, šifra i ime osobe)", r.s === 200 && z1?.status === "Čeka" && z1.sifra === "RN 170-901" && z1.kreiraoIme === "Test Financije" && z1.referenca === "REF-1", JSON.stringify(r.j));
  r = await h("POST", "/api/xrechnung/zadaci", { projektId: "p1", eAdresa: "racuni@primjer.test" }, F1);
  provjeri("  drugi zadatak istog projekta dok prvi čeka → 409", r.s === 409, r.s);
  r = await h("POST", "/api/xrechnung/zadaci", { projektId: "p1", vrsta: "xrechnung-popis" }, F1);
  const zPopis = r.j?.zadatak;
  provjeri("  popis XRechnunga (samo čita) ne blokira se", r.s === 200 && zPopis?.vrsta === "xrechnung-popis", r.s);
  r = await h("POST", "/api/xrechnung/zadaci", { projektId: "p2", vrsta: "kumulativ-citaj" }, F1);
  const zOtkazi = r.j?.zadatak;
  r = await h("DELETE", `/api/xrechnung/zadaci/${zOtkazi?.id}`, undefined, F1);
  provjeri("  zadatak koji čeka može se otkazati", r.s === 200, r.s);
  r = await h("DELETE", "/api/xrechnung/zadaci/nema-ga", undefined, F1);
  provjeri("  otkazivanje nepostojećeg → 404", r.s === 404, r.s);

  console.log("\n— Red zadataka (most)");
  r = await h("GET", "/api/most/zadaci", undefined, { "X-Most-Token": "pogresan-token-0123456789-abcdefgh" });
  provjeri("  pogrešan token mosta → 401", r.s === 401, r.s);
  r = await h("GET", "/api/most/zadaci", undefined, MOST);
  provjeri("  most preuzima zadatke koji čekaju, najstariji prvi (bez otkazanog)", r.s === 200 && r.j?.zadaci?.map((z) => z.id).join(",") === [z1?.id, zPopis?.id].join(","), JSON.stringify(r.j));
  const zm = r.j?.zadaci?.[0];
  provjeri("  zadatak nosi šifru, e-adresu i referencu", zm?.sifra === "RN 170-901" && zm.eAdresa === "racuni@primjer.test" && zm.referenca === "REF-1" && zm.vrsta === "xrechnung", JSON.stringify(zm));
  r = await h("GET", "/api/most/zadaci", undefined, MOST);
  provjeri("  isti zadatak se ne preuzima dvaput", r.s === 200 && r.j?.zadaci?.length === 0, JSON.stringify(r.j));
  r = await h("DELETE", `/api/xrechnung/zadaci/${z1?.id}`, undefined, F1);
  provjeri("  zadatak u obradi se ne može otkazati → 409", r.s === 409, r.s);
  r = await h("POST", `/api/most/zadaci/${z1?.id}/rezultat`, { status: "Valjano", poruke: ["Račun: 13/1/8"], datoteke: [{ naziv: "XRechnung_13-1-8.xml", putanja: "Z:\\X\\XRechnung_13-1-8.xml" }], validacija: { ocjena: "Valjano", greske: [], upozorenja: [] } }, MOST);
  provjeri("  most vraća rezultat", r.s === 200, r.s);
  r = await h("POST", `/api/most/zadaci/${zPopis?.id}/rezultat`, { status: "Nešto čudno" }, MOST);
  r = await h("POST", "/api/most/zadaci/nema-ga/rezultat", { status: "Valjano" }, MOST);
  provjeri("  rezultat za nepostojeći zadatak → 404", r.s === 404, r.s);
  r = await h("GET", "/api/xrechnung/zadaci", undefined, F1);
  const poId = Object.fromEntries((r.j?.zadaci || []).map((z) => [z.id, z]));
  provjeri("  aplikacija vidi rezultat (Valjano, poruke, datoteke) i most je povezan", poId[z1?.id]?.status === "Valjano" && poId[z1?.id].rezultat?.poruke?.[0] === "Račun: 13/1/8" && poId[z1?.id].rezultat.datoteke?.length === 1 && poId[z1?.id].zavrseno && r.j.most?.povezan === true, JSON.stringify(poId[z1?.id]));
  provjeri("  nepoznat status rezultata postaje Greška; otkazani ostaje Otkazano", poId[zPopis?.id]?.status === "Greška" && poId[zOtkazi?.id]?.status === "Otkazano", JSON.stringify([poId[zPopis?.id]?.status, poId[zOtkazi?.id]?.status]));
  provjeri("  popis je od najnovijeg prema najstarijem", r.j?.zadaci?.[0]?.id === zOtkazi?.id, JSON.stringify((r.j?.zadaci || []).map((z) => z.vrsta)));
  r = await h("POST", "/api/xrechnung/zadaci", { projektId: "p1", eAdresa: "racuni@primjer.test" }, F1);
  provjeri("  nakon završenog zadatka projekt opet prima novi zadatak", r.s === 200, r.s);

  console.log("\n— Izvještaj mosta i upozorenja");
  r = await h("POST", "/api/most/stanje", { verzija: "x" }, {});
  provjeri("  izvještaj bez tokena → 401", r.s === 401, r.s);
  const izvjestaj = (zadnjaKopijaMin, slobodnoGB, obnova) => ({
    verzija: "2026-11-26", racunalo: "PROBNI-SERVER", pokrenut: prije(120), probno: false, sat: new Date(Date.now() + 392000).toISOString(),
    pogoni: [{ slovo: "Z:", ok: true, opis: "Pogon Z: spojen" }], korijeni: [{ putanja: "Z:/ECON_2026/ECON_2026/Econ_2026_Projekti", postoji: true }],
    diskovi: [{ oznaka: "Z:", slobodnoGB, ukupnoGB: 1000 }],
    kopije: { podeseno: true, mapa: "Z:/ECON_ERP/Kopije", dostupna: true, zadnja: { vrijeme: prije(zadnjaKopijaMin), naziv: "backup-x.sef", velicinaKB: 230, kljuceva: 49, tablice: { login_log: 5 }, poruke: [] }, greska: null, obnova },
    nepoznatoPolje: "x".repeat(5000),
  });
  r = await h("POST", "/api/most/stanje", izvjestaj(300, 4, { ok: true, vrijeme: prije(60 * 24 * 3), kopija: "backup-y.sef", kljuceva: 49, tablice: {}, poruke: [] }), MOST);
  provjeri("  izvještaj primljen", r.s === 200, r.s);
  await cekaj(400);
  zs = await zadaciServera();
  const otvoreni = zs.filter((z) => !z.izvrseno).map((z) => z.serverUpozorenje).sort().join(",");
  provjeri("  most se javio → zadatak 'most' zatvoren (sustav); nova upozorenja: stara kopija i malo prostora", zs.find((z) => z.serverUpozorenje === "most")?.izvrseno === true && zs.find((z) => z.serverUpozorenje === "most")?.izvrsioId === "sustav" && otvoreni === "kopija,prostor", JSON.stringify(zs.map((z) => [z.serverUpozorenje, z.izvrseno])));
  r = await h("GET", "/api/server/stanje", undefined, C1);
  provjeri("  stanje (i za direktora bez izmjena): izvještaj, most povezan, upozorenja, zadaci u 24 h", r.s === 200 && r.j?.izvjestaj?.racunalo === "PROBNI-SERVER" && r.j.izvjestajSvjez === true && r.j.most?.povezan === true && r.j.upozorenja?.map((u) => u.kljuc).sort().join(",") === "kopija,prostor" && r.j.zadaci24h?.Valjano === 1 && r.j.postavke?.primateljId === "a1", JSON.stringify(r.j && { u: r.j.upozorenja, z: r.j.zadaci24h }));
  provjeri("  nepoznata polja izvještaja se ne spremaju", r.j && !("nepoznatoPolje" in r.j.izvjestaj), Object.keys(r.j?.izvjestaj || {}).join(","));
  provjeri("  pomak sata servera izračunat (server žuri ≈ 392 s)", Math.abs((r.j?.izvjestaj?.pomakSataS ?? 0) - 392) <= 3, r.j?.izvjestaj?.pomakSataS);
  // Sve u redu: nova kopija, dovoljno prostora — zadaci se zatvaraju pri sljedećoj provjeri (izvještaj okida provjeru najviše jednom u minuti,
  // pa je ovdje okida spremanje postavki).
  await h("POST", "/api/most/stanje", izvjestaj(20, 800, { ok: true, vrijeme: prije(60), kopija: "backup-z.sef", kljuceva: 49, tablice: {}, poruke: [] }), MOST);
  await h("PUT", "/api/server/postavke", { primateljId: "a1" }, A1);
  await cekaj(400);
  zs = await zadaciServera();
  provjeri("  uzrok nestao → svi zadaci servera zatvoreni", zs.length === 3 && zs.every((z) => z.izvrseno && z.izvrsioId === "sustav"), JSON.stringify(zs.map((z) => [z.serverUpozorenje, z.izvrseno])));
  r = await h("GET", "/api/server/stanje", undefined, A1);
  provjeri("  stanje bez upozorenja", r.j?.upozorenja?.length === 0, JSON.stringify(r.j?.upozorenja));
  await h("POST", "/api/most/stanje", izvjestaj(20, 800, { ok: false, vrijeme: prije(5), kopija: "backup-z.sef", greska: "broj redaka tablice login_log se ne poklapa", poruke: [] }), MOST);
  await h("PUT", "/api/server/postavke", { primateljId: "a1" }, A1);
  await cekaj(400);
  zs = await zadaciServera();
  provjeri("  neuspjela probna obnova → novi zadatak s razlogom", zs.some((z) => z.serverUpozorenje === "obnova" && !z.izvrseno && z.naziv.includes("login_log")), JSON.stringify(zs.map((z) => z.naziv)));

  console.log("\n— Mapa projekta");
  r = await h("GET", "/api/most/projekti-bez-mape", undefined, {});
  provjeri("  bez tokena → 401", r.s === 401, r.s);
  r = await h("GET", "/api/most/projekti-bez-mape", undefined, MOST);
  provjeri("  samo projekti sa šifrom, bez mape, nearhivirani (p1, p5)", r.s === 200 && r.j?.projekti?.map((x) => x.id).sort().join(",") === "p1,p5", JSON.stringify(r.j));
  r = await h("POST", "/api/most/projekti/mapa", {
    pronadjene: [{ projektId: "p1", mapa: "Z:\\ECON_2026\\ECON_2026\\Econ_2026_Projekti\\RN 170-901_Probni" }, { projektId: "p2", mapa: "Z:\\Drugo\\RN 170-902" }, { projektId: "p5", mapa: "relativna\\putanja" }, { projektId: "nema", mapa: "Z:\\Nema" }],
    nepronadjene: [{ projektId: "p5", sifra: "RN 170-905", razlog: "U Z:/… nema mape čije ime počinje s \"RN 170-905\"." }],
  }, MOST);
  provjeri("  upisana samo mapa projekta p1 (p2 ima ručnu mapu, p5 neispravna putanja)", r.s === 200 && r.j?.upisano?.map((x) => x.projektId).join(",") === "p1", JSON.stringify(r.j));
  const projekti = Object.fromEntries(((await h("GET", "/api/data/projekti", undefined, A1)).j || []).map((x) => [x.id, x]));
  provjeri("  p1 ima mapu, p2 zadržava ručno upisanu, p5 bez mape", projekti.p1?.mapa === "Z:\\ECON_2026\\ECON_2026\\Econ_2026_Projekti\\RN 170-901_Probni" && projekti.p2?.mapa === "Z:\\Rucno\\RN 170-902 rucno" && !projekti.p5?.mapa && projekti.p1.naziv === "Probni projekt jedan", JSON.stringify([projekti.p1?.mapa, projekti.p2?.mapa, projekti.p5?.mapa]));
  r = await h("POST", "/api/most/projekti/mapa", { pronadjene: [{ projektId: "p1", mapa: "Z:\\Druga\\Mapa" }], nepronadjene: [] }, MOST);
  provjeri("  već upisana mapa se ne mijenja", r.j?.upisano?.length === 0 && ((await h("GET", "/api/data/projekti", undefined, A1)).j || []).find((x) => x.id === "p1")?.mapa.endsWith("RN 170-901_Probni"), JSON.stringify(r.j));
  r = await h("GET", "/api/server/stanje", undefined, A1);
  provjeri("  stanje: popis upisanih mapa i zadnja provjera", r.j?.mapeUpisane?.length === 1 && r.j.mapeUpisane[0].sifra === "RN 170-901" && r.j.mape?.provjereno === 1, JSON.stringify([r.j?.mapeUpisane, r.j?.mape]));
  r = await h("GET", "/api/most/projekti-bez-mape", undefined, MOST);
  provjeri("  p1 više nije na popisu bez mape", r.j?.projekti?.map((x) => x.id).join(",") === "p5", JSON.stringify(r.j));

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-2500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

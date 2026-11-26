// API test: dokumenti projekta (dokumenti-projekta.js) — struktura mapa samo za nove projekte, praćenje mapa, obavijesti u zvoncu
// (laser → odabrana osoba, nacrti → voditelj projekta i voditelji proizvodnje), kartica Dokumenti i potvrda promjene.
// PRAVI server.js s lažnim pg-om (port 3102); izmišljeni podaci.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_DOK || 3102);
const TOKEN = "test-token-mosta-0123456789-abcdef";
const bcrypt = require("bcryptjs");
const { opisDogadaja, primateljiDogadaja, uskladiZadatkeDokumenata, ocistiDogadaj } = require("../dokumenti-projekta");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId, extra = {}) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15", ...extra });
const seed = {
  zaposlenici: [zap("d1", "Direktor", "poz-direktor"), zap("v1", "Voditelj", "poz-projekti"), zap("vp1", "Proizvodnja", "poz-vp"), zap("l1", "Laser", "poz-radnik"), zap("r1", "Radnik", "poz-radnik"), zap("x1", "Bivsi", "poz-vp", { status: "Neaktivan" })],
  pozicijeZaposlenika: [
    { id: "poz-direktor", naziv: "Direktor", moduli: ["dashboard", "direktor", "projekti"] },
    { id: "poz-projekti", naziv: "Voditelj projekta", moduli: ["dashboard", "projekti"], karticeDozvole: { projekti: { projekti: { pristup: true, izmjene: false } } } },
    { id: "poz-vp", naziv: "Voditelj proizvodnje", moduli: ["dashboard", "projekti"], karticeDozvole: { projekti: { projekti: { pristup: true, izmjene: false } } } },
    { id: "poz-radnik", naziv: "Zaposlenik", moduli: ["dashboard"] },
  ],
  kupci: [{ id: "k1", naziv: "STEELMONT d.o.o." }],
  projekti: [
    { id: "p-stari", sifra: "RN 170-900", naziv: "Stari projekt", status: "U izradi", mapa: "Z:\\P\\RN 170-900_Stari", voditeljId: "v1" },
    { id: "p-novi", sifra: "RN 170-901", naziv: "Novi projekt", status: "Odobren", mapa: "", voditeljId: "v1", kupacId: "k1" },
    { id: "p-usluga", sifra: "RN 40-04-53", naziv: "Usluga rezanja", status: "Odobren", mapa: "", kupacId: "k1" },
    { id: "p-arh", sifra: "RN 170-902", naziv: "Arhivirani novi", status: "Arhiviran", mapa: "" },
  ],
  slobodniZadaci: [],
  // Početni popis postojećih projekata (kao da je funkcija uvedena kad je postojao samo stari projekt).
  __mostStanje: { strukturaPocetak: { vrijednost: { vrijeme: "2026-11-27T05:00:00.000Z", postojeci: ["p-stari"] }, azurirano: "2026-11-27T05:00:00.000Z" } },
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-dok-"));
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
const provjeri = (naziv, uvjet, detalj) => { (uvjet ? ok++ : lose++); console.log(`${uvjet ? "  ✔" : "  ✘"} ${naziv}${detalj !== undefined && !uvjet ? "  → " + (typeof detalj === "string" ? detalj : JSON.stringify(detalj)) : ""}`); };
const M = { "X-Most-Token": TOKEN };

(async () => {
  console.log("\n— Čista logika");
  const dl = ocistiDogadaj({ projektId: "p", vrsta: "laser", podrucje: "02 Nacrti/Laser za limove", faza: "D", dodano: ["8 mm/a.dxf", "b.dxf", "c.dxf", "d.dxf"], izmijenjeno: ["e.dxf"], obrisano: [] });
  provjeri("opis za laser", opisDogadaja(dl, "RN 170-1") === "Laser za limove · RN 170-1: 4 nove datoteke (a.dxf, b.dxf, c.dxf, …); 1 izmijenjena (e.dxf)", opisDogadaja(dl, "RN 170-1"));
  provjeri("množina: 5 novih, 12 izmijenjenih, 22 obrisane", /5 novih datoteka \([^)]*\); 12 izmijenjenih \([^)]*\); 22 obrisane$/.test(opisDogadaja(ocistiDogadaj({ projektId: "p", vrsta: "laser", podrucje: "L", dodano: ["a", "b", "c", "d", "e"], izmijenjeno: Array(12).fill("x"), obrisano: Array(22).fill("y") }))), opisDogadaja(ocistiDogadaj({ projektId: "p", vrsta: "laser", podrucje: "L", dodano: ["a", "b", "c", "d", "e"], izmijenjeno: Array(12).fill("x"), obrisano: Array(22).fill("y") })));
  const dn = ocistiDogadaj({ projektId: "p", vrsta: "nacrti", gdje: "proizvodnja", podrucje: "02 Nacrti/Za proizvodnju", revizije: [{ naziv: "Poz-12_revB.pdf", prije: "Poz-12_revA.pdf" }], dodano: ["Poz-12_revB.pdf"], izmijenjeno: [], obrisano: [] });
  provjeri("opis za reviziju", opisDogadaja(dn, "RN 170-1") === "Nacrti za proizvodnju · RN 170-1: nova revizija Poz-12_revB.pdf (prije Poz-12_revA.pdf)", opisDogadaja(dn, "RN 170-1"));
  provjeri("nepoznata vrsta događaja se odbacuje", ocistiDogadaj({ projektId: "p", vrsta: "nesto" }) === null);
  const zap2 = seed.zaposlenici, poz2 = seed.pozicijeZaposlenika;
  provjeri("nacrti: voditelj projekta + aktivni voditelji proizvodnje", primateljiDogadaja(dn, { voditeljId: "v1" }, zap2, poz2, {}).join() === "v1,vp1");
  provjeri("nacrti bez voditelja: primatelj upozorenja servera", primateljiDogadaja(dn, {}, zap2.filter((z) => z.id !== "vp1"), poz2, { primateljId: "d1" }).join() === "d1");
  provjeri("laser: samo odabrane osobe, neaktivna preskočena (bez odabira nitko)", primateljiDogadaja(dl, {}, zap2, poz2, { laserPrimatelji: ["l1", "x1", "r1"] }).join() === "l1,r1" && primateljiDogadaja(dl, {}, zap2, poz2, {}).length === 0);
  const u1 = uskladiZadatkeDokumenata([], [{ dogadajId: "e1-xxxxxxxxxxxx", kljuc: "p|laser|L", projektId: "p", primatelji: ["l1"], naziv: "prvi" }], "2026-11-27T08:00:00.000Z");
  const u2 = uskladiZadatkeDokumenata(u1.zadaci, [{ dogadajId: "e2-xxxxxxxxxxxx", kljuc: "p|laser|L", projektId: "p", primatelji: ["l1"], naziv: "drugi" }], "2026-11-27T08:05:00.000Z");
  provjeri("otvoreni zadatak za isto područje se ažurira, ne gomila", u2.zadaci.length === 1 && u2.zadaci[0].naziv === "drugi" && u2.zadaci[0].dokumentiDogadajId === "e2-xxxxxxxxxxxx" && u2.zadaci[0].dodjelaVidjena === false);
  const stari = [{ ...u2.zadaci[0], izvrseno: true, datumIzvrsenja: "2026-09-01T00:00:00.000Z" }];
  provjeri("zatvoreni sustavski zadaci stariji od 30 dana se brišu", uskladiZadatkeDokumenata(stari, [], "2026-11-27T08:00:00.000Z").zadaci.length === 0);

  await new Promise((r) => setTimeout(r, 1500));
  const prijava = async (id, ip) => ({ Authorization: `Bearer ${(await h("POST", "/api/auth/login", { zaposlenikId: id, lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": ip })).j?.token}` });
  const D = await prijava("d1", "198.51.100.121");
  const V = await prijava("v1", "198.51.100.122");
  const VP = await prijava("vp1", "198.51.100.123");
  const L = await prijava("l1", "198.51.100.124");

  console.log("\n— Struktura mapa novih projekata");
  let r = await h("GET", "/api/most/projekti-za-strukturu");
  provjeri("bez tokena mosta → 401", r.s === 401, `HTTP ${r.s}`);
  r = await h("GET", "/api/most/projekti-za-strukturu", undefined, M);
  provjeri("samo novi, nearhivirani projekti (s kupcem za naziv mape)", r.s === 200 && (r.j?.projekti || []).map((x) => x.id).sort().join() === "p-novi,p-usluga" && r.j.projekti.find((x) => x.id === "p-usluga")?.kupac === "STEELMONT d.o.o.", r.j);
  r = await h("POST", "/api/most/projekti/struktura", { rezultati: [{ projektId: "p-novi", mapa: "Z:\\ECON_2026\\P\\RN 170-901_Novi projekt", novaMapa: true, stvoreno: ["01 Narudžba", "02 Nacrti"] }, { projektId: "p-usluga", greska: "Z: nije spojen" }] }, M);
  provjeri("rezultat strukture: mapa upisana u novi projekt", r.s === 200 && r.j?.upisano?.[0]?.projektId === "p-novi", r.j);
  const projekti = (await h("GET", "/api/data/projekti", undefined, D)).j || [];
  provjeri("  \"Mapa projekta\" sada pokazuje na novu mapu", projekti.find((x) => x.id === "p-novi")?.mapa === "Z:\\ECON_2026\\P\\RN 170-901_Novi projekt");
  r = await h("GET", "/api/most/projekti-za-strukturu", undefined, M);
  provjeri("gotov projekt se više ne nudi, projekt s greškom se ponovno nudi", (r.j?.projekti || []).map((x) => x.id).join() === "p-usluga", r.j);
  r = await h("GET", "/api/server/stanje", undefined, D);
  provjeri("Stanje servera: struktura (od kada, napravljeno, greške)", r.j?.struktura?.od === "2026-11-27T05:00:00.000Z" && r.j?.struktura?.brojGotovih === 1 && r.j?.struktura?.greske?.[0]?.greska === "Z: nije spojen", r.j?.struktura);

  console.log("\n— Postavke: tko prima obavijesti za laser (najviše dvije osobe)");
  r = await h("PUT", "/api/server/postavke", { primateljId: "d1" }, D);
  r = await h("PUT", "/api/server/postavke", { laserPrimatelji: ["l1", "r1", "l1"] }, D);
  provjeri("dvije osobe za laser spremljene (bez ponavljanja), primatelj upozorenja ostao", r.s === 200 && r.j?.postavke?.laserPrimatelji?.join() === "l1,r1" && r.j?.postavke?.primateljId === "d1", r.j);
  r = await h("PUT", "/api/server/postavke", { laserPrimatelji: ["l1", "r1", "v1"] }, D);
  provjeri("tri osobe → 400", r.s === 400, `HTTP ${r.s}`);
  r = await h("PUT", "/api/server/postavke", { laserPrimatelji: ["nepostoji"] }, D);
  provjeri("nepostojeći zaposlenik → 400", r.s === 400, `HTTP ${r.s}`);
  r = await h("PUT", "/api/server/postavke", { primateljId: "d1" }, D);
  provjeri("promjena primatelja upozorenja ne dira osobe za laser", r.j?.postavke?.laserPrimatelji?.join() === "l1,r1", r.j);

  console.log("\n— Praćenje mapa");
  r = await h("GET", "/api/most/projekti-za-pracenje", undefined, M);
  provjeri("prate se aktivni projekti sa šifrom", (r.j?.projekti || []).map((x) => x.id).sort().join() === "p-novi,p-stari,p-usluga", r.j);
  r = await h("POST", "/api/most/dokumenti", {
    projekti: [{ projektId: "p-novi", mapa: "Z:\\ECON_2026\\P\\RN 170-901_Novi projekt", ukupno: 5, zadnja: "2026-11-27T07:00:00.000Z", podmape: [{ naziv: "01 Narudžba", datoteka: 0, zadnja: null }, { naziv: "02 Nacrti/Za proizvodnju", datoteka: 3, zadnja: "2026-11-27T07:00:00.000Z" }] }, { projektId: "p-usluga", greska: "Nema mape" }],
    dogadaji: [
      { projektId: "p-novi", vrsta: "laser", podrucje: "02 Nacrti/Laser za limove", faza: "D", dodano: ["poz1.dxf"], izmijenjeno: [], obrisano: [] },
      { projektId: "p-novi", vrsta: "nacrti", gdje: "proizvodnja", podrucje: "02 Nacrti/Za proizvodnju", revizije: [{ naziv: "Poz-12_revB.pdf", prije: "Poz-12_revA.pdf" }], dodano: ["Poz-12_revB.pdf"], izmijenjeno: [], obrisano: [] },
      { projektId: "p-novi", vrsta: "odobrenje", mape: ["02 Nacrti/Za odobrenje/Poslano 27.11.2026"] },
      { projektId: "nepostoji", vrsta: "laser", podrucje: "x", dodano: ["a"] },
    ],
    ispravljeneMape: [{ projektId: "p-stari", stara: "Z:\\P\\RN 170-900_Stari", nova: "Z:\\P\\RN 170-900_Preimenovan" }, { projektId: "p-novi", stara: "Z:\\krivo", nova: "Z:\\P\\nesto" }],
  }, M);
  provjeri("most javlja sažetke i promjene → 200", r.s === 200 && r.j?.ispravljeno?.length === 1, r.j);
  let zadaci = (await h("GET", "/api/data/slobodniZadaci", undefined, D)).j || [];
  const zadaciL = zadaci.filter((z) => z.dodijeljenoId === "l1"), zadaciV = zadaci.filter((z) => z.dodijeljenoId === "v1"), zadaciVP = zadaci.filter((z) => z.dodijeljenoId === "vp1");
  provjeri("laser: zadatak u zvoncu objema odabranim osobama", zadaciL.length === 1 && zadaci.filter((z) => z.dodijeljenoId === "r1").length === 1 && /Laser za limove · RN 170-901: 1 nova datoteka \(poz1\.dxf\)/.test(zadaciL[0].naziv) && zadaciL[0].zadaoId === "sustav", zadaci.map((z) => `${z.dodijeljenoId}: ${z.naziv}`));
  provjeri("revizija: zadatak voditelju projekta i voditelju proizvodnje (ne neaktivnom)", zadaciV.length === 1 && zadaciVP.length === 1 && /nova revizija Poz-12_revB\.pdf/.test(zadaciV[0].naziv) && !zadaci.some((z) => z.dodijeljenoId === "x1"), zadaci.map((z) => `${z.dodijeljenoId}: ${z.naziv}`));
  provjeri("odobrenje i nepoznat projekt: bez zadatka", zadaci.length === 4, zadaci.length);
  const proj = (await h("GET", "/api/data/projekti", undefined, D)).j || [];
  provjeri("preimenovana mapa upisana samo gdje je u projektu stara putanja", proj.find((x) => x.id === "p-stari")?.mapa === "Z:\\P\\RN 170-900_Preimenovan" && proj.find((x) => x.id === "p-novi")?.mapa === "Z:\\ECON_2026\\P\\RN 170-901_Novi projekt");
  await h("POST", "/api/most/dokumenti", { projekti: [], dogadaji: [{ projektId: "p-novi", vrsta: "laser", podrucje: "02 Nacrti/Laser za limove", faza: "D", dodano: ["poz2.dxf"] }] }, M);
  zadaci = (await h("GET", "/api/data/slobodniZadaci", undefined, D)).j || [];
  provjeri("nova promjena u istoj mapi ažurira otvoreni zadatak", zadaci.filter((z) => z.dodijeljenoId === "l1").length === 1 && /poz2\.dxf/.test(zadaci.find((z) => z.dodijeljenoId === "l1").naziv));

  console.log("\n— Kartica Dokumenti i potvrda");
  r = await h("GET", "/api/dokumenti/projekt/p-novi", undefined, await prijava("r1", "198.51.100.125"));
  provjeri("pozicija bez projekata → 403", r.s === 403, `HTTP ${r.s}`);
  r = await h("GET", "/api/dokumenti/projekt/p-novi", undefined, V);
  const dg = r.j?.dogadaji || [];
  provjeri("sažetak, struktura i promjene projekta", r.s === 200 && r.j?.sazetak?.podmape?.length === 2 && r.j?.struktura?.gotovo?.novaMapa === true && r.j?.struktura?.novi === true && dg.length === 4, r.j);
  const rev = dg.find((x) => x.vrsta === "nacrti"), las = dg.find((x) => x.vrsta === "laser"), odo = dg.find((x) => x.vrsta === "odobrenje");
  provjeri("voditelj projekta smije potvrditi reviziju, odobrenje se ne potvrđuje", rev?.mozePotvrditi === true && odo?.mozePotvrditi === false && las?.mozePotvrditi === false, dg.map((x) => [x.vrsta, x.mozePotvrditi]));
  r = await h("POST", `/api/dokumenti/dogadaj/${las.id}/potvrdi`, { napomena: "x" }, V);
  provjeri("tuđa obavijest za laser (bez izmjena projekata) → 403", r.s === 403, `HTTP ${r.s}`);
  r = await h("POST", `/api/dokumenti/dogadaj/${las.id}/potvrdi`, { napomena: "Programi ažurirani" }, L);
  provjeri("osoba za laser potvrđuje svoju obavijest", r.s === 200, `HTTP ${r.s} ${JSON.stringify(r.j)}`);
  r = await h("POST", `/api/dokumenti/dogadaj/${rev.id}/potvrdi`, { napomena: "Promijenjena duljina poz. 12; nalog RN 170-901/3" }, VP);
  provjeri("voditelj proizvodnje potvrđuje reviziju", r.s === 200, `HTTP ${r.s}`);
  r = await h("POST", `/api/dokumenti/dogadaj/${rev.id}/potvrdi`, { napomena: "opet" }, V);
  provjeri("drugi put → 409", r.s === 409, `HTTP ${r.s}`);
  zadaci = (await h("GET", "/api/data/slobodniZadaci", undefined, D)).j || [];
  provjeri("potvrda zatvara zadatke te promjene u zvoncu (oba primatelja)", zadaci.filter((z) => /revizija/.test(z.naziv)).every((z) => z.izvrseno && z.izvrsioId === "vp1"), zadaci.map((z) => [z.dodijeljenoId, z.izvrseno]));
  r = await h("GET", "/api/dokumenti/projekt/p-novi", undefined, D);
  const potvrdjena = (r.j?.dogadaji || []).find((x) => x.id === rev.id);
  provjeri("potvrda zapisana s napomenom i osobom", potvrdjena?.potvrdio === "vp1" && /duljina poz\. 12/.test(potvrdjena?.napomena) && potvrdjena?.mozePotvrditi === false, potvrdjena);
  r = await h("GET", "/api/dokumenti/projekt/p-stari", undefined, D);
  provjeri("stari projekt: nije novi, bez sažetka dok ga most ne javi", r.s === 200 && r.j?.struktura?.novi === false && r.j?.sazetak === null, r.j);

  console.log(`\nUkupno: ${ok} prošlo, ${lose} palo`);
  if (lose) console.log(dnevnik.join("").slice(-3000));
  pocisti(lose ? 1 : 0);
})();

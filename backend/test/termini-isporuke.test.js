// API test: termini isporuke — termini su polje projekta (sprema se ciljanim patchem projekta), radni nalog nosi terminId, a kartica Kalendar isporuka
// čita projekte, narudžbe, otpremnice, kupce i zaposlenike samo uz modul Projekti. Pokretanje: `npm test` u mapi backend; PRAVI server.js s lažnim pg-om (port 3097).
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_TERMINI || 3097);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const zap = (id, prezime, pozicijaId) => ({ id, ime: "Test", prezime, status: "Aktivan", pozicijaId, lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" });
const seed = {
  zaposlenici: [zap("v1", "Voditelj", "poz-projekti"), zap("u1", "Ured", "poz-ured"), zap("k1", "Kalendar", "poz-kalendar")],
  pozicijeZaposlenika: [
    { id: "poz-projekti", naziv: "Projekti", moduli: ["dashboard", "projekti", "proizvodnja"] },
    { id: "poz-ured", naziv: "Ured", moduli: ["dashboard"] },
    // samo kartica Kalendar isporuka (ostale kartice modula Projekti isključene)
    { id: "poz-kalendar", naziv: "Samo kalendar", moduli: ["dashboard", "projekti"], karticeDozvole: { projekti: { projekti: { pristup: false }, potvrde: { pristup: false }, zavrseni: { pristup: false } } } },
  ],
  projekti: [{ id: "p1", sifra: "RN 99-01", naziv: "Test", status: "U izradi", kupacId: "k1", rokZavrsetka: "2026-12-21" }],
  narudzbe: [{ id: "n1", broj: "NAR 1", projektId: "p1", stavke: [{ id: "s1", naziv: "Cijev", kolicina: 44, masaJed: 400, cijena: 100 }] }],
  otpremnice: [], radniNalozi: [{ id: "rn1", broj: "RN 99-01/1", projektId: "p1", faza: "Laser za profile", status: "Planiran", planiranoSati: 70, utrosenoSati: 0 }], kupci: [{ id: "k1", naziv: "Kupac" }],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-termini-"));
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
  const V = await prijava("v1", "198.51.100.151"), U = await prijava("u1", "198.51.100.152"), K = await prijava("k1", "198.51.100.153");

  console.log("\n— Spremanje termina na projekt");
  const termini = [{ id: "t1", datum: "2026-11-30", naziv: "Prvi dio", napomena: "", stavke: [{ narudzbaStavkaId: "s1", komada: 22 }] }, { id: "t2", datum: "2026-12-08", naziv: "Ostatak", napomena: "", stavke: [{ narudzbaStavkaId: "s1", komada: 22 }] }];
  let r = await h("PUT", "/api/projekti/p1/patch", { patch: { termini, rokZavrsetka: "2026-12-08", promjeneRoka: [{ id: "rok-1", datum: "2026-11-21", stariRok: "2026-12-21", noviRok: "2026-12-08", razlog: "Termini isporuke" }] } }, V);
  provjeri("  voditelj sprema termine i rok projekta", r.s === 200, JSON.stringify(r.j));
  r = await h("GET", "/api/data/projekti", undefined, V);
  const pr = (r.j || []).find((x) => x.id === "p1");
  provjeri("  termini, rok i povijest roka su u bazi, ostala polja ostaju", pr?.termini?.length === 2 && pr.termini[0].stavke[0].komada === 22 && pr.rokZavrsetka === "2026-12-08" && pr.promjeneRoka?.[0]?.razlog === "Termini isporuke" && pr.naziv === "Test", JSON.stringify(pr));
  r = await h("PUT", "/api/projekti/p1/patch", { patch: { termini: [] } }, U);
  provjeri("  ured (bez modula Projekti) ne smije mijenjati projekt → 403", r.s === 403, r.s);

  console.log("\n— Radni nalog dodijeljen terminu");
  r = await h("PUT", "/api/radniNalozi/patch", { upsert: [{ id: "rn1", broj: "RN 99-01/1", projektId: "p1", faza: "Laser za profile", status: "Planiran", planiranoSati: 70, utrosenoSati: 0, terminId: "t2" }], remove: [] }, V);
  provjeri("  spremanje naloga s terminId", r.s === 200, JSON.stringify(r.j)?.slice(0, 200));
  r = await h("GET", "/api/data/radniNalozi", undefined, V);
  provjeri("  terminId je sačuvan na nalogu", (r.j || []).find((x) => x.id === "rn1")?.terminId === "t2", JSON.stringify(r.j));

  console.log("\n— Kartica Kalendar isporuka (samo pregled)");
  for (const k of ["projekti", "narudzbe", "otpremnice", "kupci", "zaposlenici"]) {
    r = await h("GET", `/api/data/${k}`, undefined, K);
    provjeri(`  pozicija samo s karticom Kalendar čita ${k}`, r.s === 200, r.s);
  }
  r = await h("PUT", "/api/projekti/p1/patch", { patch: { naziv: "Promijenjeno" } }, K);
  provjeri("  ali ne smije mijenjati projekte", r.s === 403, r.s);
  r = await h("GET", "/api/data/narudzbe", undefined, U);
  provjeri("  ured bez modula Projekti ne vidi narudžbe → 403", r.s === 403, r.s);

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-1500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

// API test: izdatnice se spremaju ciljano (PUT /api/izdatnice/patch) — zauzet broj dobiva sljedeći slobodan, a cijeli popis iz starog
// preglednika ne briše izdatnice koje nije vidio (npr. automatske izdatnice namjenskog materijala pri zaprimanju). Ovlasti: kartica
// Narudžbenice (zaprimanje) smije pisati izdatnice. Pokretanje: `npm test` u mapi backend. PRAVI server.js s lažnim pg-om (port 3089).
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_IZD || 3089);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const izd = (id, broj, projektId = "p1") => ({ id, broj, datum: "2026-11-25", projektId, status: "Izdano", stavke: [{ id: `s-${id}`, materijalId: "m1", kolicinaIzdano: 1, kolicinaVraceno: null, cijena: 10, matBrojevi: [] }] });
const seed = {
  zaposlenici: [
    { id: "w1", ime: "Ana", prezime: "Nabava", status: "Aktivan", pozicijaId: "poz-nabava", lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" },
    { id: "w2", ime: "Ivo", prezime: "Kontrola", status: "Aktivan", pozicijaId: "poz-kontrola", lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" },
  ],
  pozicijeZaposlenika: [
    { id: "poz-nabava", naziv: "Nabava", moduli: ["nabava"] },
    { id: "poz-kontrola", naziv: "Kontrola", moduli: ["kontrola"] },
  ],
  izdatnice: [izd("i1", "IZD-2026-041"), izd("i2", "IZD-2026-042")],
};
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-izd-"));
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
  const prijava = async (id, ip) => ({ Authorization: `Bearer ${(await h("POST", "/api/auth/login", { zaposlenikId: id, lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": ip })).j?.token}` });
  const A = await prijava("w1", "198.51.100.81");
  const K = await prijava("w2", "198.51.100.82");
  const brojevi = async () => ((await h("GET", "/api/data/izdatnice", undefined, A)).j || []).map((i) => `${i.id}:${i.broj}`).sort();

  console.log("\n— Nabava (zaprimanje) piše izdatnice ciljano");
  let r = await h("PUT", "/api/izdatnice/patch", { upsert: [izd("i3", "IZD-2026-043", "p2")] }, A);
  provjeri("nova izdatnica se sprema", r.s === 200, `HTTP ${r.s}`);
  provjeri("  odgovor vraća cijeli popis", (r.j?.izdatnice || []).length === 3, JSON.stringify(r.j)?.slice(0, 120));
  r = await h("PUT", "/api/izdatnice/patch", { upsert: [izd("i4", "IZD-2026-043")] }, A);
  provjeri("zauzet broj → sljedeći slobodan (044)", (r.j?.izdatnice || []).some((i) => i.id === "i4" && i.broj === "IZD-2026-044"), JSON.stringify(r.j?.promijenjeniBrojevi));
  provjeri("  javlja promijenjeni broj", (r.j?.promijenjeniBrojevi || []).some((x) => x.id === "i4" && x.novo === "IZD-2026-044"));

  console.log("\n— Stari preglednik šalje cijeli popis bez novih izdatnica");
  r = await h("PUT", "/api/data/izdatnice", [izd("i1", "IZD-2026-041"), { ...izd("i2", "IZD-2026-042"), napomena: "povrat" }, izd("i9", "IZD-2026-043")], A);
  provjeri("spremanje prolazi", r.s === 200, `HTTP ${r.s}`);
  const b = await brojevi();
  provjeri("  izdatnice koje stari preglednik nije vidio ostaju (i3, i4)", b.includes("i3:IZD-2026-043") && b.includes("i4:IZD-2026-044"), b.join(" "));
  provjeri("  nova izdatnica starog preglednika sa zauzetim brojem dobiva 045", b.includes("i9:IZD-2026-045"), b.join(" "));
  const i2 = ((await h("GET", "/api/data/izdatnice", undefined, A)).j || []).find((i) => i.id === "i2");
  provjeri("  izmjena postojeće izdatnice se primjenjuje", i2?.napomena === "povrat");
  provjeri("  ukupno 5 izdatnica, bez dvostrukih brojeva", b.length === 5 && new Set(b.map((x) => x.split(":")[1])).size === 5, b.join(" "));

  console.log("\n— Brisanje samo ciljano");
  r = await h("PUT", "/api/izdatnice/patch", { remove: ["i9"] }, A);
  provjeri("remove briše", r.s === 200 && !(r.j?.izdatnice || []).some((i) => i.id === "i9"));

  console.log("\n— Ovlasti");
  r = await h("PUT", "/api/izdatnice/patch", { upsert: [izd("i5", "IZD-2026-050")] }, K);
  provjeri("pozicija bez prava pisanja izdatnica dobiva 403", r.s === 403, `HTTP ${r.s}`);
  r = await h("GET", "/api/data/upitiNabave", undefined, A);
  provjeri("nabava čita upite (cijene za izdatnicu pri zaprimanju)", r.s === 200, `HTTP ${r.s}`);

  console.log(`\nUkupno: ${ok} prošlo, ${lose} palo`);
  if (lose) console.log(dnevnik.join("").slice(-3000));
  pocisti(lose ? 1 : 0);
})();

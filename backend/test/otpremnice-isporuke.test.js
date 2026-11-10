// API test: otpremnice tipskih projekata — poslužitelj odbija komad koji je već na drugoj otpremnici, količinu različitu od broja komada
// i premašenje naručenog, a sam postavlja/skida oznaku uOtpremniciId na isporukama. Pokretanje: `npm test` u mapi backend.
// PRAVI server.js s lažnim pg-om u memoriji (port 3088); svi podaci su izmišljeni.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const PORT = Number(process.env.TEST_PORT_OTP || 3088);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("Test-lozinka-1!", 4);
const isp = (id, grupa, stavkaId, extra = {}) => ({ id, grupa, stavkaId, komada: 1, datum: "2026-11-02", isporuceno: true, uOtpremniciId: null, ...extra });
const seed = {
  zaposlenici: [{ id: "w1", ime: "Ivo", prezime: "Otpremnik", status: "Aktivan", pozicijaId: "poz-otp", lozinkaHash: hash, prijavaUAplikaciju: true, datumZaposlenja: "2020-03-15" }],
  pozicijeZaposlenika: [{ id: "poz-otp", naziv: "Otpremnik", moduli: ["otpremnice"] }],
  projekti: [
    {
      id: "p1", sifra: "RN 99-01", koristiNormativ: true,
      stavkePod: [{ id: "s1", oznaka: "Typ A", masaJed: 100, komada: 3 }],
      stavkeKomplet: [{ id: "k1", oznaka: "Typ B", masaJed: 50, komada: 2 }],
      isporuke: [
        isp("i1", "stavkePod", "s1"), isp("i2", "stavkePod", "s1"), isp("i3", "stavkePod", "s1"), isp("i4", "stavkePod", "s1"), // 4 isporuke za tip naručen 3 puta
        isp("i5", "stavkeKomplet", "k1"), isp("i6", "stavkeKomplet", "k1", { isporuceno: false }),
        isp("i7", "stavkeKomplet", "k1"),
      ],
    },
    { id: "p2", sifra: "RN 99-02", koristiNormativ: false },
  ],
  otpremnice: [
    // stari dvostruki upis: komad i7 je na dvije otpremnice; oznaka pokazuje na drugu (kao u RN 180-73)
    { id: "o-star1", broj: "OTP-02-11-1/26", datum: "2026-11-02", projektId: "p1", stavke: [{ id: "x1", naziv: "Stranica — Typ B", kolicina: 1, isporukaIds: ["i7"] }] },
    { id: "o-star2", broj: "OTP-03-11-2/26", datum: "2026-11-03", projektId: "p1", stavke: [{ id: "x2", naziv: "Stranica — Typ B", kolicina: 1, isporukaIds: ["i7"] }] },
  ],
};
seed.projekti[0].isporuke[6].uOtpremniciId = "o-star2";
const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "erp-test-otp-"));
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
  const prijava = await h("POST", "/api/auth/login", { zaposlenikId: "w1", lozinka: "Test-lozinka-1!" }, { "CF-Connecting-IP": "198.51.100.78" });
  const A = { Authorization: `Bearer ${prijava.j?.token}` };
  provjeri("prijava prolazi", !!prijava.j?.token);
  const oznake = async () => Object.fromEntries(((await h("GET", "/api/data/projekti", undefined, A)).j || []).find((x) => x.id === "p1").isporuke.map((i) => [i.id, i.uOtpremniciId]));
  const otp = (id, datum, stavke, extra = {}) => ({ id, broj: `OTP-${datum.slice(8, 10)}-11-${id.slice(1)}/26`, datum, projektId: "p1", stavke: stavke.map((s, n) => ({ id: `${id}-${n}`, naziv: s.naziv || "Pod — Typ A", ...s })), ...extra });

  console.log("\n— Nova otpremnica s ispravnim komadima");
  let r = await h("PUT", "/api/otpremnice/patch", { upsert: [otp("o1", "2026-11-05", [{ kolicina: 2, isporukaIds: ["i1", "i2"] }])], remove: [] }, A);
  provjeri("spremanje prolazi", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);
  let ozn = await oznake();
  provjeri("  oznaka uOtpremniciId postavljena na poslužitelju (i1, i2)", ozn.i1 === "o1" && ozn.i2 === "o1" && ozn.i3 === null, JSON.stringify(ozn));
  provjeri("  odgovor sadrži projekte s oznakama", r.j?.projekti?.find((x) => x.id === "p1")?.isporuke.find((i) => i.id === "i1")?.uOtpremniciId === "o1");

  console.log("\n— Isti komad na drugoj otpremnici (zastarjeli preglednik)");
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [otp("o2", "2026-11-06", [{ kolicina: 2, isporukaIds: ["i2", "i3"] }])], remove: [] }, A);
  provjeri("  odbijeno (409) s razumljivom porukom", r.s === 409 && /već je na otpremnici OTP-05-11-1\/26/.test(r.j?.error || ""), `HTTP ${r.s} ${r.j?.error}`);
  provjeri("  otpremnica nije spremljena", !((await h("GET", "/api/data/otpremnice", undefined, A)).j || []).some((o) => o.id === "o2"));
  ozn = await oznake();
  provjeri("  oznake netaknute (i3 slobodan)", ozn.i3 === null && ozn.i2 === "o1", JSON.stringify(ozn));

  console.log("\n— Količina različita od broja odabranih komada");
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [otp("o3", "2026-11-06", [{ kolicina: 5, isporukaIds: ["i3"] }])], remove: [] }, A);
  provjeri("  veća količina odbijena", r.s === 409 && /mora biti jednaka/.test(r.j?.error || ""), `HTTP ${r.s} ${r.j?.error}`);
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [otp("o3", "2026-11-06", [{ kolicina: 0.5, isporukaIds: ["i3"] }])], remove: [] }, A);
  provjeri("  manja količina odbijena", r.s === 409, `HTTP ${r.s}`);

  console.log("\n— Komad koji nije označen kao spreman za otpremu");
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [otp("o4", "2026-11-06", [{ kolicina: 1, isporukaIds: ["i6"], naziv: "Stranica — Typ B" }])], remove: [] }, A);
  provjeri("  odbijeno", r.s === 409 && /nije označen kao spreman/.test(r.j?.error || ""), `HTTP ${r.s} ${r.j?.error}`);

  console.log("\n— Ukupno otpremljeno ne smije premašiti naručeno (tip naručen 3, raspoređene 4 isporuke)");
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [otp("o5", "2026-11-07", [{ kolicina: 2, isporukaIds: ["i3", "i4"] }])], remove: [] }, A);
  provjeri("  4. komad tipa odbijen (zbroj 4 od naručena 3)", r.s === 409 && /naručeno 3, na otpremnicama već 2/.test(r.j?.error || ""), `HTTP ${r.s} ${r.j?.error}`);
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [otp("o5", "2026-11-07", [{ kolicina: 1, isporukaIds: ["i3"] }])], remove: [] }, A);
  provjeri("  3. komad tipa prolazi", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);

  console.log("\n— Brisanje otpremnice oslobađa komade na poslužitelju");
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [], remove: ["o1"] }, A);
  provjeri("  brisanje prolazi", r.s === 200, `HTTP ${r.s}`);
  ozn = await oznake();
  provjeri("  i1 i i2 slobodni, i3 ostaje na o5", ozn.i1 === null && ozn.i2 === null && ozn.i3 === "o5", JSON.stringify(ozn));
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [otp("o6", "2026-11-08", [{ kolicina: 1, isporukaIds: ["i1"] }])], remove: [] }, A);
  provjeri("  oslobođeni komad može na novu otpremnicu", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);

  console.log("\n— Stari dvostruki upis: brisanje jedne otpremnice prebacuje oznaku na drugu");
  ozn = await oznake();
  provjeri("  početno: oznaka i7 na o-star2", ozn.i7 === "o-star2", ozn.i7);
  // zbroj otpremnica tipa B već je jednak naručenom (2) jer je i7 upisan dvaput — kupac bi dobio više komada nego je naručio
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [otp("o9", "2026-11-08", [{ kolicina: 1, isporukaIds: ["i5"], naziv: "Stranica — Typ B" }])], remove: [] }, A);
  provjeri("  stari dvostruki upis troši naručeno: nova otpremnica tipa odbijena", r.s === 409 && /naručeno 2, na otpremnicama već 2/.test(r.j?.error || "") && /Od toga na dvije otpremnice: 1 komad/.test(r.j?.error || ""), `HTTP ${r.s} ${r.j?.error}`);
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [], remove: ["o-star2"] }, A);
  ozn = await oznake();
  provjeri("  nakon brisanja oznaka i7 ide na o-star1 (ne oslobađa se)", ozn.i7 === "o-star1", ozn.i7);

  console.log("\n— Ostale otpremnice rade kao prije");
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [{ id: "o7", broj: "OTP-09-11-7/26", datum: "2026-11-09", projektId: "p2", stavke: [{ id: "y1", naziv: "Rešetka", kolicina: 99 }] }], remove: [] }, A);
  provjeri("  otpremnica bez isporukaIds (obični projekt) prolazi", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [{ id: "o8", broj: "OTP-09-11-8/26", datum: "2026-11-09", projektId: "p1", vrsta: "kooperant", stavke: [{ id: "y2", naziv: "Dorada", kolicina: 4, isporukaIds: ["i3"] }] }], remove: [] }, A);
  provjeri("  otpremnica kooperantu se ne provjerava", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);
  const postojeca = ((await h("GET", "/api/data/otpremnice", undefined, A)).j || []).find((o) => o.id === "o5");
  r = await h("PUT", "/api/otpremnice/patch", { upsert: [{ ...postojeca, smjer: "inozemstvo" }], remove: [] }, A);
  provjeri("  izmjena postojeće otpremnice (npr. smjer) prolazi", r.s === 200, `HTTP ${r.s} ${r.j?.error || ""}`);

  console.log(`\nRezultat: ${ok} prošlo, ${lose} palo.`);
  if (lose) console.log("\nZapisnik poslužitelja:\n" + dnevnik.join("").slice(-1500));
  pocisti(lose ? 1 : 0);
})().catch((e) => { console.error(e); pocisti(1); });

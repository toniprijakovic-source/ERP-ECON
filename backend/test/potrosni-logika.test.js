// Potrošni materijal: čista logika (potrosni.js), bez baze. Pokretanje: `node test/potrosni-logika.test.js` (ulazi i u `npm test`).
const assert = require("assert");
const P = require("../potrosni");

const art = (id, naziv, stanje, min, extra = {}) => ({ id, naziv, jm: "kom", skupina: "", stanje, minZaliha: min, aktivan: true, naruciti: false, upozorenjeDatum: null, narucenoDatum: null, napomena: "", ...extra });
const A = [art("a1", "Rukavice", 30, 20), art("a2", "Brusna ploča 125", 5, 0), art("a3", "Žica 1,0", 12, 10, { jm: "kg" }), art("a4", "Stari artikl", 4, 2, { aktivan: false })];
const DAN = "2026-11-20";

// upozorenje: ispod/na minimumu (min > 0) postavlja oznaku jednom; iznad ju gasi; minimum 0 = bez upozorenja
let r = P.osvjeziUpozorenje(art("x", "X", 20, 20), DAN);
assert.strictEqual(r.artikl.naruciti, true); assert.strictEqual(r.novoUpozorenje, true); assert.strictEqual(r.artikl.upozorenjeDatum, DAN);
r = P.osvjeziUpozorenje(r.artikl, "2026-11-25");
assert.strictEqual(r.novoUpozorenje, false, "već upozoreno — ne ponavlja se"); assert.strictEqual(r.artikl.upozorenjeDatum, DAN);
r = P.osvjeziUpozorenje({ ...r.artikl, stanje: 50, narucenoDatum: "2026-11-21" }, DAN);
assert.strictEqual(r.artikl.naruciti, false); assert.strictEqual(r.ugaseno, true); assert.strictEqual(r.artikl.narucenoDatum, null);
assert.strictEqual(P.osvjeziUpozorenje(art("y", "Y", 0, 0), DAN).artikl.naruciti, false, "minimum 0 nikad ne upozorava");

// provjera stavki
assert.match(P.provjeriStavke(A, []).greska, /nijedan artikl/);
assert.match(P.provjeriStavke(A, [{ artiklId: "a1", kolicina: 0 }]).greska, /veća od 0/);
assert.match(P.provjeriStavke(A, [{ artiklId: "a1", kolicina: 1000 }]).greska, /najviše 999/);
assert.match(P.provjeriStavke(A, [{ artiklId: "a1", kolicina: "abc" }]).greska, /veća od 0/);
assert.match(P.provjeriStavke(A, [{ artiklId: "nema", kolicina: 1 }]).greska, /nije dostupan/);
assert.match(P.provjeriStavke(A, [{ artiklId: "a4", kolicina: 1 }]).greska, /nije dostupan/, "neaktivan artikl se ne može uzeti");
assert.match(P.provjeriStavke(A, Array.from({ length: 31 }, () => ({ artiklId: "a1", kolicina: 1 }))).greska, /Previše/);
assert.deepStrictEqual(P.provjeriStavke(A, [{ artiklId: "a1", kolicina: 2 }, { artiklId: "a1", kolicina: "3" }, { artiklId: "a2", kolicina: 1.5 }]).stavke, [{ artiklId: "a1", kolicina: 5 }, { artiklId: "a2", kolicina: 1.5 }], "iste stavke se zbrajaju");

// uzimanje: umanjuje stanje, javlja novo upozorenje samo kad se prijeđe minimum
let u = P.primijeniUzimanje(A, [{ artiklId: "a1", kolicina: 5 }, { artiklId: "a2", kolicina: 1 }], DAN);
assert.strictEqual(u.artikli.find((x) => x.id === "a1").stanje, 25);
assert.strictEqual(u.novaUpozorenja.length, 0);
u = P.primijeniUzimanje(u.artikli, [{ artiklId: "a1", kolicina: 6 }], DAN);
assert.deepStrictEqual(u.novaUpozorenja.map((x) => x.id), ["a1"], "25 → 19 prelazi minimum 20");
assert.strictEqual(u.promjene[0].stanjeNakon, 19);
u = P.primijeniUzimanje(u.artikli, [{ artiklId: "a1", kolicina: 4 }], DAN);
assert.strictEqual(u.novaUpozorenja.length, 0, "već ispod minimuma — upozorenje se ne ponavlja");
const minus = P.primijeniUzimanje(A, [{ artiklId: "a2", kolicina: 8 }], DAN);
assert.strictEqual(minus.artikli.find((x) => x.id === "a2").stanje, -3, "radniku se ne uskraćuje, stanje može u minus");
assert.strictEqual(A[0].stanje, 30, "ulaz se ne mijenja");

// zaprimanje gasi upozorenje i oznaku naručeno
let z = P.primijeniUzimanje(A, [{ artiklId: "a3", kolicina: 5 }], DAN); // 12 → 7 ≤ 10
const ispod = z.artikli.find((x) => x.id === "a3");
assert.strictEqual(ispod.naruciti, true);
const primka = P.primijeniZaprimanje(z.artikli, "a3", 20, DAN);
assert.strictEqual(primka.artikl.stanje, 27); assert.strictEqual(primka.ugaseno, true); assert.strictEqual(primka.artikl.naruciti, false);
assert.match(P.primijeniZaprimanje(A, "a1", -2, DAN).greska, /veća od 0/);
assert.match(P.primijeniZaprimanje(A, "nema", 2, DAN).greska, /ne postoji/);

// korekcija (brojanje)
const k = P.primijeniKorekciju(A, "a1", 18, DAN);
assert.strictEqual(k.delta, -12); assert.strictEqual(k.novoUpozorenje, true);
assert.match(P.primijeniKorekciju(A, "a1", -1, DAN).greska, /0 ili veći/);

// storno vraća stanje; ugasi upozorenje ako stanje opet iznad minimuma
const st = P.primijeniStorno(u.artikli, "a1", 20, DAN);
assert.strictEqual(st.artikl.stanje, 35); assert.strictEqual(st.artikl.naruciti, false);
assert.strictEqual(P.primijeniStorno(A, "obrisan", 2, DAN).artikl, null);

// upis artikla: obavezan naziv, jedinstven naziv, početno stanje samo kod novog; izmjena ne dira stanje
assert.match(P.upisiArtikl(A, { naziv: "  " }, DAN).greska, /Naziv je obavezan/);
assert.match(P.upisiArtikl(A, { naziv: "rukavice" }, DAN).greska, /već postoji/);
assert.match(P.upisiArtikl(A, { naziv: "Novi", minZaliha: -1 }, DAN).greska, /Minimum/);
const novi = P.upisiArtikl(A, { naziv: "Rezni disk", jm: "kom", skupina: "Brušenje", stanje: 40, minZaliha: 50 }, DAN);
assert.strictEqual(novi.novi, true); assert.strictEqual(novi.artikl.stanje, 40); assert.strictEqual(novi.artikl.naruciti, true, "novi artikl ispod minimuma odmah traži naručivanje");
assert.ok(novi.artikl.id.startsWith("pm-"));
const izm = P.upisiArtikl(A, { id: "a1", naziv: "Rukavice kožne", jm: "par", minZaliha: 40, stanje: 9999 }, DAN);
assert.strictEqual(izm.artikl.stanje, 30, "izmjena artikla ne mijenja stanje"); assert.strictEqual(izm.artikl.naruciti, true); assert.strictEqual(izm.artikl.jm, "par");

// uvoz: preskače duplikate i neispravne retke, bilježi razlog
const uv = P.uvezi(A, [{ naziv: "Naočale", jm: "kom", stanje: 12, minZaliha: 5 }, { naziv: "rukavice" }, { naziv: "" }, { naziv: "Naočale" }, { naziv: "Čepići", stanje: "x" }], DAN);
assert.deepStrictEqual(uv.dodano.map((x) => x.naziv), ["Naočale"]);
assert.deepStrictEqual(uv.preskoceno.map((x) => x.red), [2, 3, 4, 5]);
assert.strictEqual(uv.artikli.length, A.length + 1);
assert.match(P.uvezi(A, [], DAN).greska, /Nema redaka/);

// agregacija po radniku i mjesecu (zona Europe/Zagreb), bez storniranih i bez zaprimanja
const redovi = [
  { vrijeme: "2026-10-31T23:30:00Z", zaposlenik_id: "z1", zaposlenik: "Ana Anić", artikl_id: "a1", artikl: "Rukavice", jm: "kom", kolicina: "2", vrsta: "uzimanje", storno: false }, // 1.11. 00:30 po Zagrebu
  { vrijeme: "2026-11-05T08:00:00Z", zaposlenik_id: "z1", zaposlenik: "Ana Anić", artikl_id: "a1", artikl: "Rukavice", jm: "kom", kolicina: "1", vrsta: "uzimanje", storno: false },
  { vrijeme: "2026-11-06T08:00:00Z", zaposlenik_id: "z1", zaposlenik: "Ana Anić", artikl_id: "a1", artikl: "Rukavice", jm: "kom", kolicina: "9", vrsta: "uzimanje", storno: true },
  { vrijeme: "2026-11-06T09:00:00Z", zaposlenik_id: "z1", zaposlenik: "Ana Anić", artikl_id: "a1", artikl: "Rukavice", jm: "kom", kolicina: "50", vrsta: "zaprimanje", storno: false },
  { vrijeme: "2026-12-02T08:00:00Z", zaposlenik_id: "z2", zaposlenik: "Ivo Ivić", artikl_id: "a2", artikl: "Brusna ploča", jm: "kom", kolicina: "4", vrsta: "uzimanje", storno: false },
];
const ag = P.agregirajPotrosnju(redovi);
assert.deepStrictEqual(ag.map((x) => [x.zaposlenikId, x.mjesec, x.artiklId, x.kolicina, x.broj]), [["z1", "2026-11", "a1", 3, 2], ["z2", "2026-12", "a2", 4, 1]]);
assert.strictEqual(P.mjesecZagreb("2026-10-31T23:30:00Z"), "2026-11", "ponoć po Zagrebu pripada novom mjesecu");

// zadatak za naručivanje
const zad = P.zadatakZaNarucivanje({ id: "a1", naziv: "Rukavice", stanje: 19, jm: "kom", minZaliha: 20 }, "zap-1", "2026-11-20T08:00:00.000Z");
assert.strictEqual(zad.dodijeljenoId, "zap-1"); assert.strictEqual(zad.zadaoId, "sustav"); assert.strictEqual(zad.izvrseno, false); assert.strictEqual(zad.potrosniArtiklId, "a1");
assert.match(zad.naziv, /Rukavice.*stanje 19 kom.*minimum 20/);
console.log("potrosni-logika: svi testovi prolaze");

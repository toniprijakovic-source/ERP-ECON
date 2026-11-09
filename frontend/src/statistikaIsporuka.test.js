// Provjere statistike isporuka (kg inozemstvo / tuzemstvo po mjesecu). Pokretanje: `npm test` u mapi frontend. Svi podaci su izmišljeni.
import test from "node:test";
import assert from "node:assert/strict";
import { statistikaIsporuka, statistikaGodine, tezinaOtpremnice } from "./statistikaIsporuka.js";

const tezina = (o) => ({ ukupno: (o.stavke || []).reduce((s, x) => s + (Number(x.masaKg) || 0), 0), nedostaje: (o.stavke || []).filter((x) => !(Number(x.masaKg) > 0)).length });
const otp = (id, datum, kg, extra = {}) => ({ id, broj: `OTP-${id}`, datum, vrsta: "kupac", stavke: [{ masaKg: kg }], ...extra });

test("otpremnice u CMR-u su inozemstvo, ostale tuzemstvo; mjesec po datumu otpremnice", () => {
  const otpremnice = [otp("1", "2026-10-02", 1000), otp("2", "2026-10-15", 500), otp("3", "2026-10-31", 250), otp("4", "2026-09-30", 999), otp("5", "2026-11-01", 999)];
  const cmr = [{ id: "c1", broj: "CMR-1", otpremniceIds: ["1", "3"], brutoTezina: "1300,5" }];
  const r = statistikaIsporuka({ otpremnice, cmr }, "2026-10", tezina);
  assert.equal(r.inozemstvo.broj, 2);
  assert.equal(r.inozemstvo.kg, 1250);
  assert.equal(r.tuzemstvo.broj, 1);
  assert.equal(r.tuzemstvo.kg, 500);
  assert.equal(r.ukupno.kg, 1750);
  assert.equal(r.cmrBroj, 1);
  assert.equal(r.cmrBruto, 1300.5);
  assert.deepEqual(r.redovi.map((x) => x.otpremnica.id), ["1", "2", "3"]);
});

test("kooperantske otpremnice (dorade) se ne ubrajaju, ni kad su u CMR-u", () => {
  const otpremnice = [otp("1", "2026-10-02", 1000), otp("2", "2026-10-03", 800, { vrsta: "kooperant" }), otp("3", "2026-10-04", 300, { vrsta: "kooperant" })];
  const cmr = [{ id: "c1", otpremniceIds: ["2"] }];
  const r = statistikaIsporuka({ otpremnice, cmr }, "2026-10", tezina);
  assert.equal(r.ukupno.broj, 1);
  assert.equal(r.ukupno.kg, 1000);
  assert.equal(r.inozemstvo.kg, 0);
  assert.equal(r.kooperantske, 2);
});

test("stavke bez težine se prijavljuju, prazan mjesec daje nule", () => {
  const otpremnice = [{ id: "1", broj: "OTP-1", datum: "2026-10-05", vrsta: "kupac", stavke: [{ masaKg: 100 }, {}] }];
  const r = statistikaIsporuka({ otpremnice, cmr: [] }, "2026-10", tezina);
  assert.equal(r.tuzemstvo.bezTezine, 1);
  const prazno = statistikaIsporuka({ otpremnice, cmr: [] }, "2026-12", tezina);
  assert.equal(prazno.ukupno.broj, 0);
  assert.equal(prazno.ukupno.kg, 0);
  assert.equal(prazno.cmrBruto, 0);
});

test("CMR s više otpremnica broji se jednom u bruto težini; stariji zapisi bez otpremniceIds ne ruše", () => {
  const otpremnice = [otp("1", "2026-10-02", 100), otp("2", "2026-10-02", 200)];
  const cmr = [{ id: "c1", otpremniceIds: ["1", "2"], brutoTezina: "310" }, { id: "c0" }];
  const r = statistikaIsporuka({ otpremnice, cmr }, "2026-10", tezina);
  assert.equal(r.cmrBroj, 1);
  assert.equal(r.cmrBruto, 310);
  assert.equal(r.inozemstvo.kg, 300);
});

test("težina otpremnice: upisana masa, pa narudžba, pa projekt kupaonica (masa jedinice × količina na otpremnici)", () => {
  const projekti = [{ id: "p1", stavkePod: [{ id: "sp1", masaJed: 200 }], stavkeKomplet: [{ id: "sk1", masaJed: 100 }, { id: "sk2" }], isporuke: [
    { id: "i1", grupa: "stavkePod", stavkaId: "sp1", komada: 1 }, { id: "i2", grupa: "stavkePod", stavkaId: "sp1", komada: 1 },
    { id: "i3", grupa: "stavkeKomplet", stavkaId: "sk1", komada: 1 }, { id: "i4", grupa: "stavkeKomplet", stavkaId: "sk2", komada: 1 }] }];
  const narudzbe = [{ id: "n1", stavke: [{ id: "ns1", masaJed: 5 }] }];
  const otpremnica = { id: "o", projektId: "p1", narudzbaId: "n1", stavke: [
    { kolicina: 2, isporukaIds: ["i1", "i2"] },
    { kolicina: 3, isporukaIds: ["i3"] },
    { kolicina: 1, isporukaIds: ["i4"] },
    { kolicina: 4, narudzbaStavkaId: "ns1" },
    { kolicina: 9, masaKg: 50, isporukaIds: ["i1"] },
  ] };
  assert.deepEqual(tezinaOtpremnice(otpremnica, { narudzbe, projekti }), { ukupno: 400 + 300 + 20 + 50, nedostaje: 1 });
  assert.deepEqual(tezinaOtpremnice({ id: "x", stavke: [{ kolicina: 1 }] }, {}), { ukupno: 0, nedostaje: 1 });
});

test("smjer: ručno određen > CMR > država kupca > tuzemstvo", () => {
  const kupci = [{ id: "k1", drzava: "Njemačka" }, { id: "k2", drzava: "Hrvatska" }, { id: "k3" }];
  const otpremnice = [
    otp("1", "2026-10-02", 100, { kupacId: "k1" }),                         // strani kupac bez CMR-a → inozemstvo (država kupca)
    otp("2", "2026-10-03", 200, { kupacId: "k1", smjer: "tuzemstvo" }),     // ručno: preuzeto u Prelogu → tuzemstvo
    otp("3", "2026-10-04", 300, { kupacId: "k2", smjer: "inozemstvo" }),    // ručno inozemstvo i uz hrvatskog kupca
    otp("4", "2026-10-05", 400, { kupacId: "k3" }),                         // bez države i bez CMR-a → tuzemstvo
    otp("5", "2026-10-06", 500, { kupacId: "k2" }),                         // u CMR-u → inozemstvo
    otp("6", "2026-10-07", 600, { kupacId: "k1", smjer: "tuzemstvo" }),     // ručno tuzemstvo ima prednost i pred CMR-om
  ];
  const cmr = [{ id: "c1", otpremniceIds: ["5", "6"] }];
  const r = statistikaIsporuka({ otpremnice, cmr, kupci }, "2026-10", tezina);
  const smjer = Object.fromEntries(r.redovi.map((x) => [x.otpremnica.id, `${x.inozemstvo ? "INO" : "TUZ"}:${x.izvorSmjera}`]));
  assert.deepEqual(smjer, { 1: "INO:država kupca", 2: "TUZ:ručno", 3: "INO:ručno", 4: "TUZ:", 5: "INO:CMR", 6: "TUZ:ručno" });
  assert.equal(r.inozemstvo.kg, 100 + 300 + 500);
  assert.equal(r.tuzemstvo.kg, 200 + 400 + 600);
  assert.equal(r.cmrBroj, 1); // CMR se broji samo za otpremnice koje su stvarno inozemstvo
});

test("godišnji pregled: izračun iz otpremnica, zaključani i ručno uneseni mjesec imaju prednost, razlika zaključanog mjeseca", () => {
  const otpremnice = [otp("1", "2026-10-02", 1000), otp("2", "2026-10-15", 500), otp("3", "2026-11-03", 70)];
  const cmr = [{ id: "c1", otpremniceIds: ["1"] }];
  const spremljeno = {
    "2026-03": { izvor: "rucno", ino: { kg: 12000, broj: 5 }, tuz: { kg: 30000, broj: 20 } },
    "2026-10": { izvor: "zakljucano", ino: { kg: 900, broj: 1 }, tuz: { kg: 500, broj: 1 } }, // poslano 900 kg INO; od tada je upisana težina 1000
  };
  const g = statistikaGodine({ otpremnice, cmr }, 2026, tezina, spremljeno);
  assert.equal(g.redovi.length, 12);
  const m = (n) => g.redovi[n - 1];
  assert.equal(m(3).izvor, "rucno");
  assert.equal(m(3).ino.kg, 12000);
  assert.equal(m(10).izvor, "zakljucano");
  assert.equal(m(10).ino.kg, 900);
  assert.deepEqual(m(10).razlika, { ino: 100, tuz: 0 });
  assert.equal(m(11).izvor, "izracun");
  assert.equal(m(11).tuz.kg, 70);
  assert.equal(m(1).izvor, "prazno");
  assert.equal(g.ino.kg, 12000 + 900);
  assert.equal(g.tuz.kg, 30000 + 500 + 70);
  assert.equal(g.ukupno.kg, 12000 + 900 + 30000 + 500 + 70);
});

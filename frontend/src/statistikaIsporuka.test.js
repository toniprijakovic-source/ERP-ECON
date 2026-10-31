// Provjere statistike isporuka (kg inozemstvo / tuzemstvo po mjesecu). Pokretanje: `npm test` u mapi frontend. Svi podaci su izmišljeni.
import test from "node:test";
import assert from "node:assert/strict";
import { statistikaIsporuka } from "./statistikaIsporuka.js";

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

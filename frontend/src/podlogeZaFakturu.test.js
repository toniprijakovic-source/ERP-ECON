import test from "node:test";
import assert from "node:assert/strict";
import { podlogaPokrivaStavku, fakturiranjeOtpremnice, otpremniceZaObracun, redoviPodloge, obuhvatPodloge } from "./podlogeZaFakturu.js";

// RN 140-934 u malom: dvije otpremnice, reaktori EMS 120 i EMS 80 iz iste narudžbe.
const narudzba = { id: "n1", stavke: [{ id: "s120", naziv: "Reaktor EMS 120", cijena: 3700 }, { id: "s80", naziv: "Reaktor EMS 80", cijena: 1800 }] };
const o23 = { id: "o23", broj: "OTP-23-11-2/26", projektId: "p", stavke: [{ narudzbaStavkaId: "s120", naziv: "Reaktor EMS 120", jm: "Stk", kolicina: 2 }, { narudzbaStavkaId: "s80", naziv: "Reaktor EMS 80", jm: "Stk", kolicina: 1 }] };
const o24 = { id: "o24", broj: "OTP-24-11-2/26", projektId: "p", stavke: [{ narudzbaStavkaId: "s120", naziv: "Reaktor EMS 120", jm: "Stk", kolicina: 1 }, { narudzbaStavkaId: "s80", naziv: "Reaktor EMS 80", jm: "Stk", kolicina: 1 }] };
const sve = (o) => ({ otpremnica: o, indeksi: o.stavke.map((_, i) => i) });

test("stara podloga bez stavkeOtpremnica pokriva sve stavke svojih otpremnica", () => {
  const p = { otpremniceIds: ["o23"] };
  assert.equal(podlogaPokrivaStavku(p, "o23", 0), true);
  assert.equal(podlogaPokrivaStavku(p, "o23", 1), true);
  assert.equal(podlogaPokrivaStavku(p, "o24", 0), false);
  const st = fakturiranjeOtpremnice(o23, [p]);
  assert.deepEqual([st.gotovo, st.djelomicno, st.otvorene], [true, false, []]);
});

test("redovi pregleda zbrajaju istu stavku narudžbe kroz otpremnice i pamte izvore", () => {
  const r = redoviPodloge([sve(o23), sve(o24)], narudzba, null);
  assert.deepEqual(r.map((x) => [x.kljuc, x.kolicina, x.ukupno]), [["s120", 3, 11100], ["s80", 2, 3600]]);
  assert.deepEqual(r[1].izvori, [{ otpremnicaId: "o23", indeks: 1 }, { otpremnicaId: "o24", indeks: 1 }]);
});

test("sve označeno: podloga kao i dosad, bez stavkeOtpremnica", () => {
  const r = redoviPodloge([sve(o23), sve(o24)], narudzba, null);
  const ob = obuhvatPodloge(r, [], [o23, o24]);
  assert.deepEqual(ob.otpremniceIds, ["o23", "o24"]);
  assert.deepEqual(ob.stavkeOtpremnica, {});
  assert.equal(ob.stavke.length, 2);
  assert.equal("kljuc" in ob.stavke[0] || "izvori" in ob.stavke[0], false);
});

test("odznačena stavka ne ulazi u podlogu i ostaje otvorena za sljedeću", () => {
  const r = redoviPodloge([sve(o23), sve(o24)], narudzba, null);
  const ob = obuhvatPodloge(r, ["s80"], [o23, o24]);
  assert.deepEqual(ob.stavke.map((s) => s.naziv), ["Reaktor EMS 120"]);
  assert.deepEqual(ob.stavkeOtpremnica, { o23: [0], o24: [0] });
  const prva = { broj: "PDR-1", otpremniceIds: ob.otpremniceIds, stavkeOtpremnica: ob.stavkeOtpremnica };
  const st = fakturiranjeOtpremnice(o23, [prva]);
  assert.deepEqual([st.gotovo, st.djelomicno, st.otvorene, st.ukupno], [false, true, [1], 2]);
  assert.deepEqual(otpremniceZaObracun([o23, o24], [prva]).map((o) => o.id), ["o23", "o24"]);

  // Sljedeća podloga vidi samo preostale stavke i zatvara otpremnice.
  const r2 = redoviPodloge([o23, o24].map((o) => ({ otpremnica: o, indeksi: fakturiranjeOtpremnice(o, [prva]).otvorene })), narudzba, null);
  assert.deepEqual(r2.map((x) => [x.kljuc, x.kolicina]), [["s80", 2]]);
  const ob2 = obuhvatPodloge(r2, [], [o23, o24]);
  assert.deepEqual(ob2.stavkeOtpremnica, { o23: [1], o24: [1] });
  const druga = { broj: "PDR-2", otpremniceIds: ob2.otpremniceIds, stavkeOtpremnica: ob2.stavkeOtpremnica };
  assert.equal(fakturiranjeOtpremnice(o23, [prva, druga]).gotovo, true);
  assert.deepEqual(otpremniceZaObracun([o23, o24], [prva, druga]), []);
});

test("otpremnica čije su sve stavke odznačene ne ulazi u podlogu", () => {
  const o = { id: "o9", stavke: [{ narudzbaStavkaId: "s80", naziv: "Reaktor EMS 80", kolicina: 1 }] };
  const r = redoviPodloge([sve(o23), sve(o)], narudzba, null);
  const ob = obuhvatPodloge(r, ["s80"], [o23, o]);
  assert.deepEqual(ob.otpremniceIds, ["o23"]);
  assert.deepEqual(ob.stavkeOtpremnica, { o23: [0] });
});

test("ručna oznaka Već fakturirano zatvara i djelomično obračunatu otpremnicu; kooperant se ne prati", () => {
  const prva = { otpremniceIds: ["o23"], stavkeOtpremnica: { o23: [0] } };
  const st = fakturiranjeOtpremnice({ ...o23, fakturiranoRucno: true }, [prva]);
  assert.deepEqual([st.gotovo, st.djelomicno, st.otvorene], [true, true, []]);
  assert.deepEqual(otpremniceZaObracun([{ ...o23, fakturiranoRucno: true }, { ...o24, vrsta: "kooperant" }, { id: "x", stavke: [] }], [prva]).map((o) => o.id), ["x"]);
});

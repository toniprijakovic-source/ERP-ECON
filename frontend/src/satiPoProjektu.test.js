// Provjere pregleda sati po projektu (radnici × operacije). Svi podaci su izmišljeni. Pokretanje: `npm test` u mapi frontend.
import test from "node:test";
import assert from "node:assert/strict";
import { satiPoRadnicimaIOperacijama, projektiSaSatima } from "./satiPoProjektu.js";

const faze = ["Pila", "Zavarivanje", "Sklapanje - kupaonice"];
const stalni = [{ id: "stalni-P", projekt: true }, { id: "stalni-S" }];
const zaposlenici = [{ id: "z1", ime: "Ana", prezime: "Horvat" }, { id: "z2", ime: "Ivo", prezime: "Kovač" }];
const nalozi = [
  { id: "n1", projektId: "p1", faza: "Pila", dodatakId: "" },
  { id: "n2", projektId: "p1", faza: "Sklapanje - kupaonice", dodatakId: "" },
  { id: "n3", projektId: "p1", faza: "Zavarivanje", dodatakId: "d1" },
  { id: "n4", projektId: "p2", faza: "Pila", dodatakId: "" },
];
const s = (id, datum, zaposlenikId, radniNalogId, sati, extra = {}) => ({ id, datum, zaposlenikId, radniNalogId, sati, ...extra });
const sati = [
  s("1", "2026-10-05", "z1", "n1", 3), s("2", "2026-10-06", "z1", "n2", 5), s("3", "2026-10-06", "z2", "n2", 8), s("4", "2026-11-02", "z2", "n3", 4),
  s("5", "2026-10-07", "z2", "n4", 99), // drugi projekt
  s("6", "2026-10-08", "z1", "stalni-P", 2, { projektId: "p1" }), s("7", "2026-10-08", "z1", "stalni-P", 7, { projektId: "p2" }), s("8", "2026-10-09", "z1", "stalni-S", 1, { projektId: "p1" }),
  s("9", "2026-10-10", "", "n1", 6), s("10", "2026-10-10", "z1", "n1", 0),
];
const ulaz = { sati, nalozi, zaposlenici, projektId: "p1", faze, stalniPoslovi: stalni };

test("radnici × operacije: zbrojevi po radniku i operaciji, redoslijed faza pa stalni poslovi, radnici po ukupnim satima", () => {
  const r = satiPoRadnicimaIOperacijama(ulaz);
  assert.deepEqual(r.stupci, ["Pila", "Zavarivanje", "Sklapanje - kupaonice", "stalni:stalni-P"]);
  assert.deepEqual(r.redovi.map((x) => x.ime), ["Kovač Ivo", "Horvat Ana"]); // Ivo 12, Ana 10
  assert.deepEqual(r.redovi[0].poStupcu, { "Sklapanje - kupaonice": 8, Zavarivanje: 4 });
  assert.deepEqual(r.redovi[1].poStupcu, { Pila: 3, "Sklapanje - kupaonice": 5, "stalni:stalni-P": 2 });
  assert.equal(r.ukupno, 22);
  assert.deepEqual(r.ukupnoPoStupcu, { Pila: 3, Zavarivanje: 4, "Sklapanje - kupaonice": 13, "stalni:stalni-P": 2 });
});

test("sati drugog projekta, stalni posao bez oznake projekta i nula sati se ne ubrajaju; sati bez radnika se prijavljuju zasebno", () => {
  const r = satiPoRadnicimaIOperacijama(ulaz);
  assert.equal(r.bezRadnika, 6);
  assert.ok(!r.stupci.includes("stalni:stalni-S"));
  assert.ok(!r.redovi.some((x) => x.poStupcu.Pila === 99));
});

test("razdoblje od–do i dio projekta (osnovna narudžba / dodatak)", () => {
  assert.equal(satiPoRadnicimaIOperacijama({ ...ulaz, od: "2026-11-01" }).ukupno, 4);
  assert.equal(satiPoRadnicimaIOperacijama({ ...ulaz, do: "2026-10-06" }).ukupno, 16);
  const osnovna = satiPoRadnicimaIOperacijama({ ...ulaz, dio: "osnovna" });
  assert.equal(osnovna.ukupno, 16); // bez dodatka d1 (4 h) i bez stalnih poslova
  assert.equal(satiPoRadnicimaIOperacijama({ ...ulaz, dio: "d1" }).ukupno, 4);
});

test("projekt bez sati daje prazan pregled", () => {
  const r = satiPoRadnicimaIOperacijama({ ...ulaz, projektId: "nepostoji" });
  assert.deepEqual([r.stupci.length, r.redovi.length, r.ukupno], [0, 0, 0]);
});

test("projekti sa satima: zadnji datum unosa, uključujući stalni posao vezan uz projekt", () => {
  const m = projektiSaSatima({ sati, nalozi, stalniPoslovi: stalni });
  assert.equal(m.get("p1"), "2026-11-02");
  assert.equal(m.get("p2"), "2026-10-08");
  assert.equal(m.size, 2);
});

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

// Plan: prvotno planirani sati naloga po fazi (planiranoSatiPrvo, inace planiranoSati), samo za cijeli projekt
const nalozPlan = [
  { id: "n1", projektId: "p1", faza: "Pila", dodatakId: "", planiranoSati: 4 },
  { id: "n2", projektId: "p1", faza: "Sklapanje - kupaonice", dodatakId: "", planiranoSati: 20, planiranoSatiPrvo: 10 }, // plan preracunat u Planu proizvodnje: vrijedi prvotni
  { id: "n3", projektId: "p1", faza: "Zavarivanje", dodatakId: "d1", planiranoSati: 6 },
  { id: "n5", projektId: "p1", faza: "Kontrola", dodatakId: "", planiranoSati: 2.5 }, // plan bez ijednog sata
  { id: "n4", projektId: "p2", faza: "Pila", dodatakId: "", planiranoSati: 99 }, // drugi projekt
];
const ulazPlan = { ...ulaz, nalozi: nalozPlan };

test("plan po fazama: prvotni plan naloga, faza s planom a bez sati dobiva stupac, ostvareno u fazama bez stalnih poslova", () => {
  const r = satiPoRadnicimaIOperacijama(ulazPlan);
  assert.equal(r.plan.vrijedi, true);
  assert.deepEqual(r.plan.poFazi, { Pila: 4, "Sklapanje - kupaonice": 10, Zavarivanje: 6, Kontrola: 2.5 });
  assert.equal(r.plan.ukupno, 22.5);
  assert.equal(r.plan.ostvarenoUFazama, 20); // 22 ukupno − 2 h stalnog posla; plan nema stalnih poslova
  assert.ok(r.stupci.includes("Kontrola")); // plan bez sati: stupac postoji
  assert.deepEqual(r.stupci.slice(0, 3), ["Pila", "Zavarivanje", "Sklapanje - kupaonice"]); // redoslijed faza ostaje, nepoznata faza (Kontrola) na kraj faza
  assert.equal(r.ukupno, 22); // sati se zbog plana ne mijenjaju
});

test("plan prati dio projekta (osnovna narudzba / dodatak) i ne ovisi o satima drugog projekta", () => {
  assert.equal(satiPoRadnicimaIOperacijama({ ...ulazPlan, dio: "osnovna" }).plan.ukupno, 16.5); // bez dodatka d1 (6 h)
  assert.deepEqual(satiPoRadnicimaIOperacijama({ ...ulazPlan, dio: "d1" }).plan.poFazi, { Zavarivanje: 6 });
  assert.equal(satiPoRadnicimaIOperacijama({ ...ulazPlan, projektId: "p2" }).plan.ukupno, 99);
});

test("sa suzenim razdobljem plan se ne racuna i ne dodaje stupce", () => {
  const r = satiPoRadnicimaIOperacijama({ ...ulazPlan, od: "2026-11-01" });
  assert.equal(r.plan.vrijedi, false);
  assert.deepEqual(r.plan.poFazi, {});
  assert.equal(r.plan.ukupno, 0);
  assert.deepEqual(r.stupci, ["Zavarivanje"]);
});

test("projekt bez naloga s planom: plan je 0, stupci kao prije", () => {
  const r = satiPoRadnicimaIOperacijama(ulaz); // nalozi iz prvog bloka nemaju planiranoSati
  assert.equal(r.plan.ukupno, 0);
  assert.deepEqual(r.stupci, ["Pila", "Zavarivanje", "Sklapanje - kupaonice", "stalni:stalni-P"]);
});

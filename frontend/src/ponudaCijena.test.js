// Provjere satnica po ponudi i popusta. Pokretanje: `npm test` u mapi frontend. Svi podaci su izmišljeni.
import test from "node:test";
import assert from "node:assert/strict";
import { cjenikZaPonudu, prilagodjeneSatnice, postotakPopustaPonude, primijeniPopust, tekstPostotka } from "./ponudaCijena.js";

const cjenik = { pila: 30, zavarivanje: 40, akz: 25 };

test("ponuda bez vlastitih satnica koristi zadani cjenik", () => {
  assert.deepEqual(cjenikZaPonudu({}, cjenik), cjenik);
  assert.deepEqual(cjenikZaPonudu({ satniceRada: {} }, cjenik), cjenik);
  assert.deepEqual(cjenikZaPonudu(null, cjenik), cjenik);
});

test("satnica upisana na ponudi ima prednost samo za tu operaciju, cjenik se ne mijenja", () => {
  const r = cjenikZaPonudu({ satniceRada: { zavarivanje: 52.5 } }, cjenik);
  assert.equal(r.zavarivanje, 52.5);
  assert.equal(r.pila, 30);
  assert.equal(r.akz, 25);
  assert.equal(cjenik.zavarivanje, 40);
});

test("satnica 0 na ponudi vrijedi (besplatna operacija), prazan unos se ignorira", () => {
  const r = cjenikZaPonudu({ satniceRada: { pila: 0, zavarivanje: "", akz: null, x: "abc" } }, cjenik);
  assert.equal(r.pila, 0);
  assert.equal(r.zavarivanje, 40);
  assert.equal(r.akz, 25);
  assert.ok(!("x" in r));
  assert.deepEqual(prilagodjeneSatnice({ satniceRada: { pila: 0, zavarivanje: "", akz: null, x: "abc" } }), ["pila"]);
});

test("satnica kao tekst iz polja za unos se pretvara u broj; negativna se ignorira", () => {
  const r = cjenikZaPonudu({ satniceRada: { pila: "35", zavarivanje: -5 } }, cjenik);
  assert.equal(r.pila, 35);
  assert.equal(r.zavarivanje, 40);
});

test("popust: postotak od cijene prije popusta, ograničen na 0-100", () => {
  const a = primijeniPopust(10000, { postotakPopusta: 5 });
  assert.equal(a.postotak, 5);
  assert.equal(a.iznos, 500);
  assert.equal(a.nakon, 9500);
  assert.equal(primijeniPopust(10000, {}).nakon, 10000);
  assert.equal(primijeniPopust(10000, { postotakPopusta: "" }).iznos, 0);
  assert.equal(postotakPopustaPonude({ postotakPopusta: -3 }), 0);
  assert.equal(postotakPopustaPonude({ postotakPopusta: 140 }), 100);
  assert.equal(postotakPopustaPonude({ postotakPopusta: "7.5" }), 7.5);
  assert.equal(postotakPopustaPonude({ postotakPopusta: "abc" }), 0);
});

test("tekst postotka ima zarez i najviše dvije decimale", () => {
  assert.equal(tekstPostotka(5), "5");
  assert.equal(tekstPostotka(7.5), "7,5");
  assert.equal(tekstPostotka(2.333), "2,33");
});

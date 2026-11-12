// Provjere razlike popisa programa rezanja (što se šalje poslužitelju). Svi podaci su izmišljeni. Pokretanje: `npm test` u mapi frontend.
import test from "node:test";
import assert from "node:assert/strict";
import { razlikaProgramaRezanja } from "./programiRezanjaPatch.js";

const pr = (id, extra = {}) => ({ id, brojPrograma: id.toUpperCase(), status: "Na čekanju", odradjenoMin: 0, ...extra });
const A = pr("a"), B = pr("b", { status: "Početak", odradjenoMin: 45 }), C = pr("c");

test("nova izmjena jednog programa šalje samo taj program, bez redoslijeda", () => {
  const r = razlikaProgramaRezanja([A, B, C], [A, { ...B, status: "Pauzirano", odradjenoMin: 80 }, C]);
  assert.deepEqual(r.upsert.map((p) => p.id), ["b"]);
  assert.deepEqual(r.remove, []);
  assert.equal(r.redoslijed, undefined);
});

test("dodavanje programa na kraj šalje samo novi program (ostali se ne diraju, pa ih zastarjela kopija ne može vratiti na staro)", () => {
  const novi = pr("d");
  const r = razlikaProgramaRezanja([A, B, C], [A, B, C, novi]);
  assert.deepEqual(r.upsert.map((p) => p.id), ["d"]);
  assert.equal(r.redoslijed, undefined);
});

test("brisanje programa šalje samo njegov id", () => {
  const r = razlikaProgramaRezanja([A, B, C], [A, C]);
  assert.deepEqual(r.upsert, []);
  assert.deepEqual(r.remove, ["b"]);
  assert.equal(r.redoslijed, undefined);
});

test("pomak programa mijenja samo redoslijed (zapisi su isti)", () => {
  const r = razlikaProgramaRezanja([A, B, C], [A, C, B]);
  assert.deepEqual(r.upsert, []);
  assert.deepEqual(r.remove, []);
  assert.deepEqual(r.redoslijed, ["a", "c", "b"]);
});

test("nastavak umetnut iza podijeljenog programa šalje zatvoreni program, nastavak i redoslijed", () => {
  const zatvoren = { ...B, status: "Završeno", odradjenoMin: 100 };
  const nastavak = pr("b-01", { trajanjeMin: 60 });
  const r = razlikaProgramaRezanja([A, B, C], [A, zatvoren, nastavak, C]);
  assert.deepEqual(r.upsert.map((p) => p.id).sort(), ["b", "b-01"]);
  assert.deepEqual(r.redoslijed, ["a", "b", "b-01", "c"]);
});

test("bez promjene nema ni izmjena ni redoslijeda", () => {
  const r = razlikaProgramaRezanja([A, B, C], [A, B, C]);
  assert.deepEqual(r, { upsert: [], remove: [], redoslijed: undefined });
});

test("prazni popisi", () => {
  assert.deepEqual(razlikaProgramaRezanja([], []), { upsert: [], remove: [], redoslijed: undefined });
  assert.deepEqual(razlikaProgramaRezanja(undefined, [A]).upsert.map((p) => p.id), ["a"]);
});

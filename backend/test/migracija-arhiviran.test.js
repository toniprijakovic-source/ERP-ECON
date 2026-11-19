// Jednokratna migracija "Završen" → "Arhiviran": samo čista funkcija, bez baze.
// Pokretanje: `node test/migracija-arhiviran.test.js` (ulazi i u `npm test`).
const assert = require("assert");
const { arhiviraj } = require("../migracija-arhiviran-2026-11");

const projekti = [
  { id: "a", sifra: "RN 1-1", naziv: "Stari", status: "Završen", zavrsenDatum: "2026-05-01", autoZavrsenoNalozi: [{ id: "n1", staviStatus: "Planiran" }], statusPrijeZavrsetka: "U izradi" },
  { id: "b", sifra: "RN 1-2", naziv: "Čeka obračun", status: "Završen", zavrsenDatum: "2026-11-06" },
  { id: "c", sifra: "RN 1-3", naziv: "Bez datuma", status: "Završen" },
  { id: "d", sifra: "RN 1-4", naziv: "Aktivni", status: "U izradi" },
  { id: "e", sifra: "RN 1-5", naziv: "Otkazani", status: "Otkazan" },
];
const r = arhiviraj(projekti, new Set(["RN 1-2"]));
assert.strictEqual(r.novi.length, projekti.length, "broj projekata se ne mijenja");
assert.deepStrictEqual(r.novi.map((p) => p.status), ["Arhiviran", "Završen", "Arhiviran", "U izradi", "Otkazan"]);
assert.strictEqual(r.novi[0].arhiviranDatum, "2026-05-01", "datum arhiviranja = datum završetka");
assert.strictEqual(r.novi[2].arhiviranDatum, null, "bez datuma završetka ostaje prazno");
assert.strictEqual(r.novi[0].zavrsenDatum, "2026-05-01");
assert.deepStrictEqual(r.novi[0].autoZavrsenoNalozi, [{ id: "n1", staviStatus: "Planiran" }], "oznake za Vrati u aktivne ostaju");
assert.strictEqual(r.novi[1], projekti[1], "izuzet projekt je netaknut");
assert.deepStrictEqual(r.promjene.map((p) => p.sifra), ["RN 1-1", "RN 1-3"]);
assert.strictEqual(projekti[0].status, "Završen", "ulazni popis se ne mijenja");
assert.strictEqual(arhiviraj(r.novi, new Set(["RN 1-2"])).promjene.length, 0, "drugo pokretanje s istim izuzecima ne mijenja ništa (idempotentno)");
console.log("migracija-arhiviran: svi testovi prolaze");

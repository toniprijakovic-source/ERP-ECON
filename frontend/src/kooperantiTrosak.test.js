// Provjere troška kooperanata po projektima (sati × satnica, ostatak nerasporedeno). Svi podaci su izmišljeni. Pokretanje: `npm test` u mapi frontend.
import test from "node:test";
import assert from "node:assert/strict";
import { trosakKooperanataPoProjektima } from "./kooperantiTrosak.js";

const projekti = [{ id: "p1", sifra: "RN 1", naziv: "Prvi" }, { id: "p2", sifra: "RN 2", naziv: "Drugi" }];
const kooperanti = [{ id: "k1", ime: "Ana", satnica: 10, evSati: 20 }, { id: "k2", ime: "Ivo", satnica: 14.5, evSati: 10 }];
const r = (zaposlenikId, kljuc, sati) => ({ zaposlenikId, kljuc, sati });
const ulaz = { projekti, kooperanti, redovi: [r("k1", "p:p1", 8), r("k1", "p:p2", 3), r("k2", "p:p1", 4), r("k1", "s:stalni-S", 2), r("k1", "bez-projekta", 1), r("k2", "p:p2", 6)], nazivStalnog: (id) => (id === "stalni-S" ? "S – Čišćenje" : id) };

test("trošak po projektu = sati × satnica svakog kooperanta; projekti po trošku silazno, zatim bez projekta, zatim stalni poslovi", () => {
  const x = trosakKooperanataPoProjektima(ulaz);
  assert.deepEqual(x.stavke.map((s) => s.naziv), ["RN 1 — Prvi", "RN 2 — Drugi", "Nalozi bez projekta", "Stalni posao: S – Čišćenje"]);
  assert.equal(x.stavke[0].trosak, 8 * 10 + 4 * 14.5); // 138
  assert.equal(x.stavke[1].trosak, 3 * 10 + 6 * 14.5); // 117
  assert.deepEqual(x.stavke[0].poOsobi, { k1: 8, k2: 4 });
  assert.equal(x.stavke[0].brojKooperanata, 2);
  assert.equal(x.brojProjekata, 2);
  assert.equal(x.trosakProjekti, 255);
});

test("ostatak sati iz evidencije koji nije raspoređen vidi se zasebno i ukupno se slaže s isplatom", () => {
  const x = trosakKooperanataPoProjektima(ulaz);
  // k1: evidencija 20, raspoređeno 14 → 6 h × 10; k2: evidencija 10, raspoređeno 10 → 0
  assert.deepEqual(x.nerasporedeno.poOsobi, { k1: 6 });
  assert.equal(x.nerasporedeno.sati, 6);
  assert.equal(x.nerasporedeno.trosak, 60);
  assert.equal(x.ukupnoSati, 30);
  assert.equal(x.ukupnoTrosak, 20 * 10 + 10 * 14.5); // isplata: 345
});

test("sati kooperanta izvan obračuna se ne ubrajaju u trošak; višak raspoređenih sati iznad evidencije se prijavljuje", () => {
  const x = trosakKooperanataPoProjektima({ ...ulaz, redovi: [...ulaz.redovi, r("k9", "p:p1", 5), r("k2", "p:p1", 3)] });
  assert.equal(x.izvanObracuna, 5);
  assert.equal(x.visakRasporedenih, 3); // k2: raspoređeno 13 od 10 evidentiranih
  assert.ok(!x.stavke.some((s) => s.poOsobi.k9));
});

test("prazan unos i nule", () => {
  const x = trosakKooperanataPoProjektima({ projekti, kooperanti, redovi: [r("k1", "p:p1", 0)] });
  assert.equal(x.stavke.length, 0);
  assert.equal(x.nerasporedeno.sati, 30);
  assert.equal(x.nerasporedeno.trosak, 345);
});

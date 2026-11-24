// Testovi čistih funkcija za nesukladnosti (kartica Kontrola kvalitete → Nesukladnosti, prijava s mobitela).
import test from "node:test";
import assert from "node:assert/strict";
import { prazniPodaciNs, kasneAktivnosti, sljedeciRok, nedostajeZaOcjenu, filtrirajNs, sazetakNs, zadaniNositelj, datumHr, IZVORI_NS, MJERE_NS } from "./nesukladnosti.js";

test("prazni podaci: evidentirao = ja, izvor radni proces", () => {
  const p = prazniPodaciNs({ mojId: "z1", projektId: "p1", nositeljId: "v1", danas: "2026-11-24" });
  assert.equal(p.evidentiraoId, "z1"); assert.equal(p.izvor, "radni proces"); assert.equal(p.projektId, "p1"); assert.equal(p.nositeljId, "v1"); assert.equal(p.datum, "2026-11-24");
  assert.deepEqual(p.aktivnosti, []); assert.equal(IZVORI_NS.length, 7); assert.equal(MJERE_NS.length, 3);
});

test("kasne aktivnosti i sljedeći rok", () => {
  const p = { aktivnosti: [{ rok: "2026-11-01", provedeno: "" }, { rok: "2026-11-01", provedeno: "2026-11-02" }, { rok: "2026-12-10", provedeno: "" }, { rok: "", provedeno: "" }, { rok: "2026-11-30", provedeno: "" }] };
  assert.equal(kasneAktivnosti(p, "2026-11-24").length, 1);
  assert.equal(kasneAktivnosti(p, "2026-11-01").length, 0, "na dan roka još ne kasni");
  assert.equal(sljedeciRok(p), "2026-11-01");
  assert.equal(sljedeciRok({ aktivnosti: [] }), "");
  assert.deepEqual(kasneAktivnosti(null, "2026-11-24"), []);
});

test("što nedostaje za slanje na ocjenu", () => {
  assert.deepEqual(nedostajeZaOcjenu({}), ["uzrok", "vrsta mjere", "barem jedna aktivnost"]);
  assert.deepEqual(nedostajeZaOcjenu({ uzrok: "x", mjere: ["ispravak"], aktivnosti: [{ opis: "  " }] }), ["barem jedna aktivnost"]);
  assert.deepEqual(nedostajeZaOcjenu({ uzrok: "x", mjere: ["ispravak"], aktivnosti: [{ opis: "Popraviti" }] }), []);
});

test("filtar popisa po statusu i tekstu", () => {
  const z = [
    { oznaka: "46/26", status: "Otvorena", podaci: { projektSifra: "RN 170-313", opis: "Pukotina cijevi", nositelj: "Ana" } },
    { oznaka: "45/26", status: "Zatvorena", podaci: { projektSifra: "RN 150-40", opis: "Montaža", izvor: "reklamacija kupca" } },
    { oznaka: "44/26", status: "Poništena", podaci: { opis: "Dvaput" } },
    { oznaka: "43/26", status: "Čeka ocjenu", podaci: { opis: "Cinčanje", uzrok: "Kotlar" } },
  ];
  assert.deepEqual(filtrirajNs(z, { status: "otvorene" }).map((x) => x.oznaka), ["46/26", "43/26"]);
  assert.deepEqual(filtrirajNs(z, { status: "zatvorene" }).map((x) => x.oznaka), ["45/26"]);
  assert.deepEqual(filtrirajNs(z, { status: "Čeka ocjenu" }).map((x) => x.oznaka), ["43/26"]);
  assert.deepEqual(filtrirajNs(z, { tekst: "kotlar" }).map((x) => x.oznaka), ["43/26"], "pretraga i po uzroku");
  assert.deepEqual(filtrirajNs(z, { tekst: "170-313" }).map((x) => x.oznaka), ["46/26"]);
  assert.deepEqual(filtrirajNs(z, { tekst: "46/26" }).map((x) => x.oznaka), ["46/26"]);
  assert.deepEqual(filtrirajNs(z, { tekst: "KUPCA" }).map((x) => x.oznaka), ["45/26"], "pretraga po izvoru, bez razlike velikih slova");
  assert.equal(filtrirajNs(null).length, 0);
});

test("sažetak: otvorene, čeka ocjenu, kasne, zatvorene", () => {
  const z = [
    { status: "Mjere u tijeku", podaci: { aktivnosti: [{ rok: "2026-11-01", provedeno: "" }] } },
    { status: "Čeka ocjenu", podaci: {} }, { status: "Zatvorena", podaci: { aktivnosti: [{ rok: "2026-01-01", provedeno: "" }] } }, { status: "Poništena", podaci: {} },
  ];
  assert.deepEqual(sazetakNs(z, "2026-11-24"), { ukupno: 4, otvorene: 2, cekaOcjenu: 1, kasne: 1, zatvorene: 1 });
});

test("zadani nositelj i datum", () => {
  assert.equal(zadaniNositelj({ voditeljId: "v1" }, "z1"), "v1");
  assert.equal(zadaniNositelj({}, "z1"), "z1");
  assert.equal(zadaniNositelj(null, ""), "");
  assert.equal(datumHr("2026-11-24"), "24.11.2026.");
  assert.equal(datumHr(""), "");
});

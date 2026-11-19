import test from "node:test";
import assert from "node:assert/strict";
import { matricaPotrosnje, zaNarucivanje, parsirajUvoz } from "./potrosniMaterijal.js";

const red = (zaposlenikId, zaposlenik, mjesec, artiklId, kolicina, broj = 1, jm = "kom") => ({ zaposlenikId, zaposlenik, mjesec, artiklId, artikl: artiklId, jm, kolicina, broj });
const REDOVI = [
  red("z1", "Ana Anić", "2026-10", "a1", 4, 2, "par"), red("z1", "Ana Anić", "2026-11", "a1", 3, 1, "par"), red("z1", "Ana Anić", "2026-11", "a2", 10, 1, "kom"),
  red("z2", "Ivo Ivić", "2026-11", "a1", 1, 1, "par"), red("z3", "Stara Godina", "2025-12", "a1", 9, 3, "par"),
];

test("matrica po radniku i mjesecu: svi artikli = broj uzimanja", () => {
  const m = matricaPotrosnje(REDOVI, 2026);
  assert.equal(m.mjeseci.length, 12);
  assert.deepEqual(m.radnici.map((r) => r.zaposlenik), ["Ana Anić", "Ivo Ivić"], "druga godina se ne ulijeva; poredak po imenu");
  const ana = m.radnici[0];
  assert.equal(ana.poMjesecu["2026-10"], 2);
  assert.equal(ana.poMjesecu["2026-11"], 2);
  assert.equal(ana.ukupno, 4);
  assert.equal(m.zbrojPoMjesecu["2026-11"], 3);
  assert.equal(m.ukupno, 5);
});

test("matrica za jedan artikl: količine i jedinica", () => {
  const m = matricaPotrosnje(REDOVI, 2026, "a1");
  assert.equal(m.jm, "par");
  assert.equal(m.radnici[0].poMjesecu["2026-10"], 4);
  assert.equal(m.radnici[0].ukupno, 7);
  assert.equal(m.radnici[1].ukupno, 1);
  assert.equal(m.ukupno, 8);
  assert.equal(matricaPotrosnje(REDOVI, 2026, "a2").radnici.length, 1);
});

test("matrica bez podataka: prazni popis radnika", () => {
  const m = matricaPotrosnje([], 2026);
  assert.deepEqual(m.radnici, []);
  assert.equal(m.ukupno, 0);
  assert.equal(matricaPotrosnje(undefined, 2026).mjeseci[0], "2026-01");
});

test("za naručivanje: samo označeni i aktivni, nenaručeni prvi", () => {
  const a = (naziv, extra) => ({ id: naziv, naziv, aktivan: true, naruciti: true, ...extra });
  const popis = zaNarucivanje([
    a("Žica", { narucenoDatum: "2026-11-18", upozorenjeDatum: "2026-11-10" }), a("Rukavice", { upozorenjeDatum: "2026-11-15" }), a("Diskovi", { upozorenjeDatum: "2026-11-12" }),
    a("Stari", { aktivan: false }), { id: "x", naziv: "Uredno", aktivan: true, naruciti: false },
  ]);
  assert.deepEqual(popis.map((x) => x.naziv), ["Diskovi", "Rukavice", "Žica"]);
});

test("uvoz iz Excela: tabulator, zaglavlje se preskače, decimalni zarez", () => {
  const r = parsirajUvoz("Naziv\tJedinica\tStanje\tMinimum\tSkupina\nRukavice\tpar\t120\t40\tZaštita\nŽica 1,0\tkg\t12,5\t10\tVarenje\nČepići\t\t\t\t");
  assert.equal(r.greske.length, 0);
  assert.deepEqual(r.redovi, [
    { naziv: "Rukavice", jm: "par", stanje: 120, minZaliha: 40, skupina: "Zaštita" },
    { naziv: "Žica 1,0", jm: "kg", stanje: 12.5, minZaliha: 10, skupina: "Varenje" },
    { naziv: "Čepići", jm: "kom", stanje: 0, minZaliha: 0, skupina: "" },
  ]);
});

test("uvoz: točka-zarez i zarez kao razdjelnik; nevaljani brojevi se prijavljuju s brojem retka", () => {
  const a = parsirajUvoz("Naočale;kom;12;5;Zaštita\nMaska;kom;abc;2");
  assert.equal(a.redovi.length, 1);
  assert.deepEqual(a.greske.map((g) => g.red), [2]);
  const b = parsirajUvoz("Disk,kom,50,20");
  assert.deepEqual(b.redovi[0], { naziv: "Disk", jm: "kom", stanje: 50, minZaliha: 20, skupina: "" });
  assert.deepEqual(parsirajUvoz("").redovi, []);
});

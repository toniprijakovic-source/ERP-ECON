// Testovi čistih funkcija za fotografije montaže: čišćenje oznaka (isti primjeri kao backend/test/montaza.test.js), uvoz zalijepljenog teksta,
// sažetak pozicija za karticu projekta, raspored naljepnica i adresa QR veze.
import test from "node:test";
import assert from "node:assert/strict";
import { ocistiOznaku, mapaOznake, usporediOznake, parsirajOznake, sazetakPozicija, rasporediNaljepnice, adresaMontaze, tokenMontazeIzUpita } from "./montazaOznake.js";

test("mapaOznake: isti rezultati kao na poslužitelju", () => {
  assert.equal(mapaOznake("J-3.OG"), "J-3.OG");
  assert.equal(mapaOznake("  A 1  "), "A-1");
  assert.equal(mapaOznake("B/2 (lijevo)"), "B-2-lijevo");
  assert.equal(mapaOznake("Čaplja 5"), "Čaplja-5");
  assert.equal(mapaOznake("..\\..\\x"), "x");
  assert.equal(mapaOznake("a/../b"), "a-..-b");
  assert.equal(mapaOznake("C-7."), "C-7");
  assert.equal(mapaOznake("CON"), "CON_");
  assert.equal(mapaOznake("lpt1"), "lpt1_");
  assert.equal(mapaOznake("???"), "");
  assert.equal(ocistiOznaku("  J-3.OG \t"), "J-3.OG");
  assert.equal(ocistiOznaku("x".repeat(80)).length, 40);
});

test("usporediOznake: prirodni poredak (A-2 prije A-10)", () => {
  const poredano = ["B-3.OG", "A-10.OG", "A-2.OG", "A-1.OG"].sort(usporediOznake);
  assert.deepEqual(poredano, ["A-1.OG", "A-2.OG", "A-10.OG", "B-3.OG"]);
  assert.deepEqual([{ oznaka: "b" }, { oznaka: "A" }].sort(usporediOznake).map((x) => x.oznaka), ["A", "b"]);
});

test("parsirajOznake: stupac iz Worda, retci iz Excela s rednim brojem, zarezi, duplikati", () => {
  let r = parsirajOznake("J-3.OG\nI-3.OG\r\nH-3.OG\n\n  \nJ-3.OG\nj-3.og\n???");
  assert.deepEqual(r.nove.map((x) => x.oznaka), ["J-3.OG", "I-3.OG", "H-3.OG"]);
  assert.deepEqual(r.preskoceno, [{ oznaka: "J-3.OG", razlog: "već postoji" }, { oznaka: "j-3.og", razlog: "već postoji" }, { oznaka: "???", razlog: "nedopuštena oznaka" }]);
  r = parsirajOznake("1.\tC-7.OG\tDominik\n2.\tJ-3.OG\tDominik\tkrivi\n\t\tNeki tekst\n10\tA-1.OG");
  assert.deepEqual(r.nove.map((x) => x.oznaka), ["C-7.OG", "J-3.OG", "Neki tekst", "A-1.OG"], "redni broj se preskače, prva sadržajna ćelija je oznaka");
  r = parsirajOznake("A-1.OG, A-2.OG; A-3.OG ,");
  assert.deepEqual(r.nove.map((x) => x.oznaka), ["A-1.OG", "A-2.OG", "A-3.OG"]);
  r = parsirajOznake("A-1.OG\nB-3.OG", [{ mapa: "a-1.og" }]);
  assert.deepEqual(r.nove.map((x) => x.mapa), ["B-3.OG"], "već učitane pozicije se preskaču (bez razlike velikih i malih slova)");
  assert.equal(r.preskoceno.length, 1);
  assert.deepEqual(parsirajOznake("", []), { nove: [], preskoceno: [] });
  assert.deepEqual(parsirajOznake(null), { nove: [], preskoceno: [] });
  r = parsirajOznake("A 1\nA-1");
  assert.deepEqual(r.nove.map((x) => x.mapa), ["A-1"], "različito upisane oznake koje daju isti naziv mape su duplikat");
});

test("sazetakPozicija: stanja, brojevi slika i zbrojevi", () => {
  const poz = [
    { mapa: "B-3.OG", oznaka: "B-3.OG", montirano: null }, { mapa: "A-1.OG", oznaka: "A-1.OG", montirano: "2026-11-24T10:00:00Z" },
    { mapa: "A-2.OG", oznaka: "A-2.OG", montirano: null }, { mapa: "A-10.OG", oznaka: "A-10.OG", montirano: "2026-11-20T10:00:00Z" },
  ];
  const slike = [
    { mapa: "A-1.OG", kreirano: "2026-11-24T09:00:00Z" }, { mapa: "A-1.OG", kreirano: "2026-11-24T09:30:00Z" },
    { mapa: "A-2.OG", kreirano: "2026-11-23T09:00:00Z" },
  ];
  const s = sazetakPozicija(poz, slike);
  assert.deepEqual(s.redovi.map((r) => r.oznaka), ["A-1.OG", "A-2.OG", "A-10.OG", "B-3.OG"]);
  assert.deepEqual(s.redovi.map((r) => r.stanje), ["montirano", "slike", "montirano", "prazno"]);
  assert.deepEqual(s.redovi.map((r) => r.brojSlika), [2, 1, 0, 0]);
  assert.equal(s.redovi[0].zadnjaSlika, "2026-11-24T09:30:00Z");
  assert.equal(s.ukupno, 4); assert.equal(s.montirano, 2); assert.equal(s.sSlikama, 2);
  assert.deepEqual(s.bezSlika.map((r) => r.oznaka), ["A-10.OG", "B-3.OG"]);
  assert.deepEqual(s.montiranoBezSlika.map((r) => r.oznaka), ["A-10.OG"], "montirano bez slike (npr. prije uvođenja QR-a)");
  assert.deepEqual(sazetakPozicija(null, null), { redovi: [], ukupno: 0, montirano: 0, sSlikama: 0, bezSlika: [], montiranoBezSlika: [] });
});

test("rasporediNaljepnice: stranice po 20, poredano po oznaci", () => {
  const veze = Array.from({ length: 52 }, (_, i) => ({ oznaka: `X-${52 - i}`, token: `t${i}` }));
  const st = rasporediNaljepnice(veze, 20);
  assert.deepEqual(st.map((s) => s.length), [20, 20, 12]);
  assert.equal(st[0][0].oznaka, "X-1"); assert.equal(st[2][11].oznaka, "X-52");
  assert.deepEqual(rasporediNaljepnice([], 20), []);
  assert.deepEqual(rasporediNaljepnice(null), []);
});

test("adresa QR veze i čitanje tokena iz adrese", () => {
  const a = adresaMontaze("https://erp-econ.vercel.app", "/", "proj-x~J-3.OG~Ab_c-9");
  assert.equal(a, "https://erp-econ.vercel.app/?montaza=proj-x~J-3.OG~Ab_c-9");
  assert.equal(tokenMontazeIzUpita(new URL(a).search), "proj-x~J-3.OG~Ab_c-9");
  assert.equal(tokenMontazeIzUpita("?utovar=x"), "");
  assert.equal(tokenMontazeIzUpita(""), "");
  assert.equal(tokenMontazeIzUpita(new URL(adresaMontaze("http://localhost:4173", "", "p~Čaplja-5~sig")).search), "p~Čaplja-5~sig", "i oznaka s dijakritikom");
});

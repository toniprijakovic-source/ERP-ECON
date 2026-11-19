// Hrvatski praznici po godini (Uskrs algoritmom, Tijelovo = Uskrs + 60). Pokretanje: `npm test` u mapi frontend.
import test from "node:test";
import assert from "node:assert/strict";
import { uskrs, hrvatskiPraznici, praznikaZaDodati, praznikaIzvanZakona, imaPraznikeGodine } from "./praznici.js";

const datumUskrsa = (g) => { const u = uskrs(g); return `${g}-${String(u.mjesec).padStart(2, "0")}-${String(u.dan).padStart(2, "0")}`; };

test("Uskrs: poznati datumi", () => {
  assert.equal(datumUskrsa(2024), "2024-03-31");
  assert.equal(datumUskrsa(2025), "2025-04-20");
  assert.equal(datumUskrsa(2026), "2026-04-05"); // isto kao u produkcijskom popisu
  assert.equal(datumUskrsa(2027), "2027-03-28");
  assert.equal(datumUskrsa(2028), "2028-04-16");
  assert.equal(datumUskrsa(2030), "2030-04-21");
});

test("2026.: poklapa se s popisom u bazi osim Dana državnosti", () => {
  const p = Object.fromEntries(hrvatskiPraznici(2026).map((x) => [x.datum, x.naziv]));
  assert.equal(p["2026-04-05"], "Uskrs");
  assert.equal(p["2026-04-06"], "Uskrsni ponedjeljak");
  assert.equal(p["2026-06-04"], "Tijelovo");
  assert.equal(p["2026-05-30"], "Dan državnosti");
  assert.equal(p["2026-06-25"], undefined, "25.6. je spomendan, nije neradni dan");
});

test("2027.: 14 praznika, redom po datumu, s pomičnima", () => {
  const popis = hrvatskiPraznici(2027);
  assert.equal(popis.length, 14);
  assert.deepEqual(popis.map((x) => x.datum), [...popis.map((x) => x.datum)].sort());
  assert.deepEqual(popis.map((x) => x.datum), [
    "2027-01-01", "2027-01-06", "2027-03-28", "2027-03-29", "2027-05-01", "2027-05-27", "2027-05-30", "2027-06-22",
    "2027-08-05", "2027-08-15", "2027-11-01", "2027-11-18", "2027-12-25", "2027-12-26",
  ]);
  const naziv = (d) => popis.find((x) => x.datum === d)?.naziv;
  assert.equal(naziv("2027-05-27"), "Tijelovo");
  assert.equal(naziv("2027-05-30"), "Dan državnosti");
  assert.equal(naziv("2027-03-29"), "Uskrsni ponedjeljak");
});

test("dodavanje: samo oni kojih nema, id-evi nastavljaju niz godine", () => {
  const postojeci = [{ id: "prz-2026-1", datum: "2026-01-01", naziv: "Nova godina" }, { id: "prz-2027-3", datum: "2027-01-06", naziv: "Bogojavljenje" }];
  const novi = praznikaZaDodati(postojeci, 2027);
  assert.equal(novi.length, 13, "Bogojavljenje 2027. već postoji");
  assert.ok(!novi.some((x) => x.datum === "2027-01-06"));
  assert.equal(novi[0].id, "prz-2027-4");
  assert.equal(novi[12].id, "prz-2027-16");
  assert.equal(new Set(novi.map((x) => x.id)).size, 13, "id-evi su jedinstveni");
  assert.equal(praznikaZaDodati(undefined, 2027).length, 14);
  assert.equal(praznikaZaDodati([...postojeci, ...novi], 2027).length, 0, "drugi klik ne duplicira");
  assert.equal(praznikaZaDodati([], 2027)[0].id, "prz-2027-1");
});

test("upozorenje na zapise izvan zakona i provjera je li godina postavljena", () => {
  const popis = [{ id: "prz-2026-8", datum: "2026-06-25", naziv: "Dan državnosti" }, { id: "prz-2026-9", datum: "2026-08-05", naziv: "Dan pobjede" }];
  assert.deepEqual(praznikaIzvanZakona(popis, 2026).map((x) => x.datum), ["2026-06-25"]);
  assert.deepEqual(praznikaIzvanZakona(popis, 2027), []);
  assert.equal(imaPraznikeGodine(popis, 2026), true);
  assert.equal(imaPraznikeGodine(popis, 2027), false);
  assert.equal(imaPraznikeGodine(undefined, 2027), false);
});

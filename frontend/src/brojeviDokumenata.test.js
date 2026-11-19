// Prijelaz na novu godinu: brojevi ponuda, laser ponuda, narudžbenica, izdatnica, faktura i upita ne smiju ostati na 2026.
// Pokretanje: `npm test` u mapi frontend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { godinaBroja, prefiksGodine, sljedeciBroj, sljedeciBrojUpita } from "./brojeviDokumenata.js";

test("prefiks uzima godinu iz datuma", () => {
  assert.equal(prefiksGodine("PON", new Date(2027, 0, 1)), "PON-2027-");
  assert.equal(prefiksGodine("LAS", new Date(2026, 11, 31, 23, 59)), "LAS-2026-");
  assert.equal(prefiksGodine("NAR", "2027-03-15"), "NAR-2027-");
  assert.equal(prefiksGodine("PON"), `PON-${new Date().getFullYear()}-`);
  assert.equal(godinaBroja("nije datum"), new Date().getFullYear(), "neispravan datum ne smije dati NaN");
});

test("nova godina počinje od 001, stara se nastavlja", () => {
  const ponude = [{ broj: "PON-2026-001" }, { broj: "PON-2026-041" }, { broj: "PON-2026-041_rev1" }];
  assert.equal(sljedeciBroj(ponude, "broj", prefiksGodine("PON", new Date(2026, 10, 19))), "PON-2026-042");
  assert.equal(sljedeciBroj(ponude, "broj", prefiksGodine("PON", new Date(2027, 0, 4))), "PON-2027-001");
  const s2027 = [...ponude, { broj: "PON-2027-001" }, { broj: "PON-2027-002" }];
  assert.equal(sljedeciBroj(s2027, "broj", prefiksGodine("PON", new Date(2027, 1, 1))), "PON-2027-003");
  assert.equal(sljedeciBroj(s2027, "broj", prefiksGodine("PON", new Date(2026, 5, 1))), "PON-2026-042", "stara godina se ne dira");
});

test("faktura ima 4 znamenke, a prazan popis radi", () => {
  assert.equal(sljedeciBroj([], "broj", prefiksGodine("FAK", new Date(2027, 0, 5)), 4), "FAK-2027-0001");
  assert.equal(sljedeciBroj(undefined, "broj", "IZD-2027-"), "IZD-2027-001");
});

test("upit nabave: 2026. nastavlja od 58, 2027. kreće od 001", () => {
  assert.equal(sljedeciBrojUpita([], new Date(2026, 0, 10)), "26-059");
  assert.equal(sljedeciBrojUpita([{ broj: "26-059" }, { broj: "26-071" }], new Date(2026, 10, 19)), "26-072");
  assert.equal(sljedeciBrojUpita([{ broj: "26-059" }, { broj: "26-071" }], new Date(2027, 0, 4)), "27-001");
  assert.equal(sljedeciBrojUpita([{ broj: "27-001" }, { broj: "26-071" }], new Date(2027, 0, 20)), "27-002");
  assert.equal(sljedeciBrojUpita([{ broj: "" }, {}, null], new Date(2027, 5, 1)), "27-001", "neispravni zapisi ne ruše generator");
});

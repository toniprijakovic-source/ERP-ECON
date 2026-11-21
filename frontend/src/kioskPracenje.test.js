import test from "node:test";
import assert from "node:assert/strict";
import { jeRadnoVrijeme, minuteOd, opisProteklog, stanjeKioska, kioskoviBezSignala } from "./kioskPracenje.js";

// Zima: Zagreb = UTC+1. Petak 20.11.2026. 09:00 po Zagrebu = 08:00Z.
const PETAK_09 = "2026-11-20T08:00:00Z";
const prije = (sadaISO, min) => new Date(new Date(sadaISO).getTime() - min * 60000).toISOString();
const bezPraznika = () => false;

test("radno vrijeme: radni dan 06:00–16:30 po zagrebačkom vremenu", () => {
  assert.equal(jeRadnoVrijeme(PETAK_09).radno, true);
  assert.equal(jeRadnoVrijeme("2026-11-20T04:59:00Z").radno, false, "05:59 po Zagrebu");
  assert.equal(jeRadnoVrijeme("2026-11-20T05:00:00Z").radno, true, "06:00");
  assert.equal(jeRadnoVrijeme("2026-11-20T15:29:00Z").radno, true, "16:29");
  assert.equal(jeRadnoVrijeme("2026-11-20T15:30:00Z").radno, false, "16:30");
  assert.equal(jeRadnoVrijeme("2026-11-21T09:00:00Z").radno, false, "subota");
  assert.equal(jeRadnoVrijeme("2026-11-22T09:00:00Z").radno, false, "nedjelja");
});

test("radno vrijeme: ljeti je Zagreb UTC+2, praznik nije radni dan", () => {
  const ljeto = jeRadnoVrijeme("2026-07-15T05:00:00Z");
  assert.equal(ljeto.minutaDana, 7 * 60);
  assert.equal(ljeto.radno, true);
  assert.equal(jeRadnoVrijeme("2026-11-18T09:00:00Z", (d) => d === "2026-11-18").radno, false, "18.11. je praznik");
  assert.equal(jeRadnoVrijeme("2026-11-18T09:00:00Z", bezPraznika).radno, true);
});

test("minute od signala i opis proteklog vremena", () => {
  assert.equal(minuteOd(prije(PETAK_09, 7), PETAK_09), 7);
  assert.equal(minuteOd("2026-11-20T09:00:00Z", PETAK_09), 0, "signal 'iz budućnosti' (razlika satova) ne daje minus");
  assert.equal(opisProteklog(0), "upravo");
  assert.equal(opisProteklog(3), "prije 3 min");
  assert.equal(opisProteklog(60), "prije 1 h");
  assert.equal(opisProteklog(135), "prije 2 h 15 min");
  assert.equal(opisProteklog(3 * 24 * 60 + 100), "prije 3 d");
});

test("stanje kioska: radi / nema signala / izvan radnog vremena", () => {
  assert.equal(stanjeKioska({ zadnji: prije(PETAK_09, 2) }, PETAK_09, bezPraznika).status, "radi");
  assert.equal(stanjeKioska({ zadnji: prije(PETAK_09, 15) }, PETAK_09, bezPraznika).status, "radi", "točno 15 min još je u redu");
  const nema = stanjeKioska({ zadnji: prije(PETAK_09, 16) }, PETAK_09, bezPraznika);
  assert.equal(nema.status, "nema");
  assert.equal(nema.opis, "prije 16 min");
  // noćna tišina: u 06:10 (prvih pola sata radnog vremena) još ne upozorava, u 06:45 upozorava
  assert.equal(stanjeKioska({ zadnji: prije("2026-11-20T05:10:00Z", 600) }, "2026-11-20T05:10:00Z", bezPraznika).status, "izvan");
  assert.equal(stanjeKioska({ zadnji: prije("2026-11-20T05:45:00Z", 700) }, "2026-11-20T05:45:00Z", bezPraznika).status, "nema");
  // vikend i praznik šutnja ne upozorava
  assert.equal(stanjeKioska({ zadnji: prije("2026-11-21T09:00:00Z", 300) }, "2026-11-21T09:00:00Z", bezPraznika).status, "izvan");
  assert.equal(stanjeKioska({ zadnji: prije("2026-11-18T09:00:00Z", 300) }, "2026-11-18T09:00:00Z", (d) => d === "2026-11-18").status, "izvan");
  // nakon radnog vremena
  assert.equal(stanjeKioska({ zadnji: prije("2026-11-20T17:00:00Z", 120) }, "2026-11-20T17:00:00Z", bezPraznika).status, "izvan");
});

test("kiosci bez signala: samo oni koji šute u radno vrijeme", () => {
  const u = [{ id: "a", zadnji: prije(PETAK_09, 3) }, { id: "b", zadnji: prije(PETAK_09, 90) }, { id: "c", zadnji: prije(PETAK_09, 40) }];
  assert.deepEqual(kioskoviBezSignala(u, PETAK_09, bezPraznika).map((x) => x.id), ["b", "c"]);
  assert.deepEqual(kioskoviBezSignala([], PETAK_09, bezPraznika), []);
  assert.deepEqual(kioskoviBezSignala(undefined, PETAK_09, bezPraznika), []);
});

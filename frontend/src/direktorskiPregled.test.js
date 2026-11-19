// Direktorski pregled: redovi aktivnih projekata sa semaforom, iznimke i zbirni pokazatelji. Izmišljeni podaci.
// Pokretanje: `npm test` u mapi frontend.
import test from "node:test";
import assert from "node:assert/strict";
import { direktorskiPregled, PRAGOVI } from "./direktorskiPregled.js";

const DANAS = "2026-11-19";
const proj = (id, o = {}) => ({ id, sifra: `RN ${id}`, naziv: `Projekt ${id}`, status: "U izradi", kupacId: "k1", voditeljId: "v1", rokZavrsetka: "2026-12-31", vrijednost: 1000, ...o });
const nalog = (id, projektId, o = {}) => ({ id, projektId, status: "Planiran", planiranoSati: 10, utrosenoSati: 0, ...o });
const pregled = (o = {}) => direktorskiPregled({
  projekti: [], radniNalozi: [], otpremnice: [], cmr: [], narudzbenice: [], izdatnice: [], podlogeZaFakturu: [], ponude: [],
  kupci: [{ id: "k1", naziv: "Kupac d.o.o." }], zaposlenici: [{ id: "v1", ime: "Ivo", prezime: "Ivić" }], danas: DANAS, ...o,
});
const red = (r, id) => r.redovi.find((x) => x.projekt.id === id);
const iznimka = (r, vrsta) => r.iznimke.filter((i) => i.vrsta === vrsta);

test("U pregledu su samo aktivni projekti (Odobren, U izradi, Montaža), po vrijednosti silazno", () => {
  const r = pregled({ projekti: [proj("a", { vrijednost: 500 }), proj("b", { vrijednost: 9000, status: "Montaža" }), proj("c", { status: "Završen" }), proj("d", { status: "Arhiviran" }), proj("e", { status: "Ponuda" }), proj("f", { status: "Otkazan" }), proj("g", { vrijednost: 700, status: "Odobren" })] });
  assert.deepEqual(r.redovi.map((x) => x.projekt.id), ["b", "g", "a"]);
  assert.equal(r.redovi[0].kupac, "Kupac d.o.o.");
  assert.equal(r.redovi[0].voditelj, "Ivić Ivo");
});

test("Vrijednost: iz narudžbe kupca (preko funkcije isporuka), a ako nje nema, upisana na projektu", () => {
  const r = pregled({ projekti: [proj("a", { vrijednost: 100 }), proj("b", { vrijednost: 100 })], isporuceno: (p) => (p.id === "a" ? { posto: 40, vrijednostNarudzbe: 2500, izvor: "po vrijednosti" } : { posto: 0 }) });
  assert.equal(red(r, "a").vrijednost, 2500);
  assert.equal(red(r, "a").isporuceno.posto, 40);
  assert.equal(red(r, "b").vrijednost, 100);
});

test("Nalozi i sati: napredak naloga i sati naspram prvotnog plana", () => {
  const r = pregled({
    projekti: [proj("a")],
    radniNalozi: [nalog("n1", "a", { status: "Završen", planiranoSati: 30, planiranoSatiPrvo: 20, utrosenoSati: 25 }), nalog("n2", "a", { planiranoSati: 20, utrosenoSati: 5 }), nalog("n3", "b", { utrosenoSati: 999 })],
  });
  const x = red(r, "a");
  assert.deepEqual(x.nalozi, { ukupno: 2, zavrseno: 1, posto: 50 });
  assert.equal(x.sati.plan, 40); // 20 (prvotni plan) + 20
  assert.equal(x.sati.ostvareno, 30);
  assert.equal(Math.round(x.sati.posto), 75);
  assert.equal(x.semafor, "zeleno");
});

test("Semafor: kasni s rokom = crveno, razlog 'kasni N d'", () => {
  const r = pregled({ projekti: [proj("a", { rokZavrsetka: "2026-11-09" })] });
  assert.equal(red(r, "a").semafor, "crveno");
  assert.deepEqual(red(r, "a").razlozi, ["kasni 10 d"]);
  assert.equal(red(r, "a").danaDoRoka, -10);
});

test("Semafor: sati ≥ 130 % plana = crveno, ≥ 110 % = žuto, a mali plan (ispod praga) se ne uspoređuje", () => {
  const n = (utroseno, plan) => [nalog("n1", "a", { planiranoSati: plan, utrosenoSati: utroseno }), nalog("n2", "a", { planiranoSati: 0 })];
  assert.equal(red(pregled({ projekti: [proj("a")], radniNalozi: n(135, 100) }), "a").semafor, "crveno");
  assert.equal(red(pregled({ projekti: [proj("a")], radniNalozi: n(115, 100) }), "a").semafor, "zuto");
  assert.equal(red(pregled({ projekti: [proj("a")], radniNalozi: n(105, 100) }), "a").semafor, "zeleno");
  assert.ok(PRAGOVI.minPlanSati > 5);
  assert.equal(red(pregled({ projekti: [proj("a")], radniNalozi: n(50, 5) }), "a").semafor, "zeleno");
});

test("Semafor: svi nalozi završeni, a sati prekoračeni = samo žuto (posao je gotov), kasnjenje ostaje crveno", () => {
  const gotov = [nalog("n1", "a", { status: "Završen", planiranoSati: 100, utrosenoSati: 250 })];
  assert.equal(red(pregled({ projekti: [proj("a")], radniNalozi: gotov }), "a").semafor, "zuto");
  assert.equal(red(pregled({ projekti: [proj("a", { rokZavrsetka: "2026-11-01" })], radniNalozi: gotov }), "a").semafor, "crveno");
});

test("Semafor: rok za ≤ 7 dana uz manje od 80 % završenih naloga = žuto; nema roka / nema voditelja = žuto", () => {
  const sNalozima = [nalog("n1", "a"), nalog("n2", "a"), nalog("n3", "a", { status: "Završen" })];
  assert.equal(red(pregled({ projekti: [proj("a", { rokZavrsetka: "2026-11-25" })], radniNalozi: sNalozima }), "a").semafor, "zuto");
  assert.equal(red(pregled({ projekti: [proj("a", { rokZavrsetka: "2026-11-25" })], radniNalozi: [nalog("n3", "a", { status: "Završen" })] }), "a").semafor, "zeleno");
  assert.equal(red(pregled({ projekti: [proj("a", { rokZavrsetka: "" })] }), "a").semafor, "zuto");
  assert.deepEqual(red(pregled({ projekti: [proj("a", { voditeljId: "" })] }), "a").razlozi, ["nema voditelja"]);
});

test("Iznimka 'kasni': po projektu, crvena, s prijedlogom Završen kad su nalozi gotovi i postoji isporuka", () => {
  const r = pregled({
    projekti: [proj("a", { rokZavrsetka: "2026-10-30" }), proj("b", { rokZavrsetka: "2026-11-10" })],
    radniNalozi: [nalog("n1", "a", { status: "Završen" }), nalog("n2", "b")],
    cmr: [{ id: "c1", projektId: "a", kupacId: "k1", datum: "2026-11-06" }],
  });
  const k = iznimka(r, "kasni");
  assert.equal(k.length, 2);
  assert.equal(k[0].razina, "crveno");
  assert.match(k.find((i) => i.projektId === "a").tekst, /ako je posao gotov/);
  assert.match(k.find((i) => i.projektId === "b").tekst, /Završeno 0 od 1/);
  assert.equal(red(r, "a").prijedlogZavrsen !== null, true);
});

test("Iznimka 'sati': crvena kad sati ≥ 130 % i nalozi nisu gotovi, žuta kad je posao gotov", () => {
  const r = pregled({ projekti: [proj("a"), proj("b")], radniNalozi: [nalog("n1", "a", { planiranoSati: 100, utrosenoSati: 200 }), nalog("n2", "a"), nalog("n3", "b", { status: "Završen", planiranoSati: 100, utrosenoSati: 200 })] });
  const s = iznimka(r, "sati");
  assert.equal(s.find((i) => i.projektId === "a").razina, "crveno");
  assert.equal(s.find((i) => i.projektId === "b").razina, "zuto");
});

test("Iznimke: bez voditelja, bez roka — zbirno, sa stavkama", () => {
  const r = pregled({ projekti: [proj("a", { voditeljId: "" }), proj("b", { voditeljId: "" }), proj("c", { rokZavrsetka: "" }), proj("d")] });
  assert.equal(iznimka(r, "bezVoditelja")[0].stavke.length, 2);
  assert.equal(iznimka(r, "bezRoka")[0].stavke.length, 1);
});

test("Iznimka 'bez materijala': sati iznad praga, a nijedna izdatnica; izdatnica uklanja projekt s popisa", () => {
  const nalozi = [nalog("n1", "a", { utrosenoSati: 50 }), nalog("n2", "b", { utrosenoSati: 50 }), nalog("n3", "c", { utrosenoSati: 2 })];
  const r = pregled({ projekti: [proj("a"), proj("b"), proj("c")], radniNalozi: nalozi, izdatnice: [{ id: "i1", projektId: "b" }] });
  const m = iznimka(r, "bezMaterijala")[0];
  assert.deepEqual(m.stavke.map((s) => s.projektId), ["a"]);
  assert.equal(red(r, "b").materijal.izdatnica, 1);
});

test("Materijal: narudžbenice se broje po projektu, a nacrt ne", () => {
  const r = pregled({
    projekti: [proj("a")],
    narudzbenice: [{ id: "n1", status: "Poslano", stavke: [{ projektId: "a" }, { projektId: "a" }] }, { id: "n2", status: "Nacrt", stavke: [{ projektId: "a" }] }, { id: "n3", status: "Primljeno", stavke: [{ projektId: "a" }] }],
  });
  assert.equal(red(r, "a").materijal.narudzbenica, 2);
});

test("Iznimka 'bez podloge': otpremnice kupcu starije od 7 dana koje nisu ni u jednoj podlozi (kooperanti, nove i obračunane se ne broje)", () => {
  const r = pregled({
    projekti: [proj("a"), proj("b", { status: "Arhiviran" }), proj("c", { status: "Otkazan" })],
    otpremnice: [
      { id: "o1", projektId: "a", datum: "2026-11-01" }, // bez podloge, staro
      { id: "o2", projektId: "a", datum: "2026-11-15" }, // novo (4 d)
      { id: "o3", projektId: "a", datum: "2026-10-20", vrsta: "kooperant" },
      { id: "o4", projektId: "a", datum: "2026-10-20" }, // obračunano
      { id: "o5", projektId: "b", datum: "2026-10-01" }, // arhiviran projekt se i dalje prati
      { id: "o6", projektId: "c", datum: "2026-10-01" }, // otkazan
    ],
    podlogeZaFakturu: [{ id: "p1", projektId: "a", zbroj: 300, otpremniceIds: ["o4"] }],
  });
  const b = iznimka(r, "bezPodloge")[0];
  assert.equal(b.stavke.length, 2);
  assert.equal(b.naslov, "2 otpremnice kupcima (2 projekta) bez podloge za fakturu");
  assert.equal(red(r, "a").podloge.iznos, 300);
  assert.equal(red(r, "a").podloge.posto, 30);
});

test("Iznimka 'čeka obračun': samo Završen duže od 30 dana", () => {
  const r = pregled({ projekti: [proj("a", { status: "Završen", zavrsenDatum: "2026-10-01" }), proj("b", { status: "Završen", zavrsenDatum: "2026-11-10" }), proj("c", { status: "Arhiviran", zavrsenDatum: "2026-01-01" })] });
  assert.deepEqual(iznimka(r, "cekaObracun").map((i) => i.projektId), ["a"]);
  assert.equal(r.kpi.cekaObracun.broj, 2);
});

test("Iznimka 'ponude': poslane ponude starije od 21 dan; druge ne", () => {
  const r = pregled({ ponude: [
    { id: "p1", broj: "PON-1", naziv: "Stara", status: "Poslana", datum: "2026-10-20", kupacId: "k1" },
    { id: "p2", broj: "PON-2", status: "Poslana", datum: "2026-11-15" },
    { id: "p3", broj: "PON-3", status: "Prihvaćena", datum: "2026-09-01" },
  ] });
  const p = iznimka(r, "ponude")[0];
  assert.equal(p.razina, "info");
  assert.equal(p.stavke.length, 1);
  assert.match(p.stavke[0].tekst, /PON-1/);
  assert.equal(r.kpi.ponude.poslane, 2);
});

test("Iznimke su poredane: crvene, pa žute, pa informativne; unutar razine veća vrijednost prije", () => {
  const r = pregled({ projekti: [proj("a", { rokZavrsetka: "2026-11-01", vrijednost: 100 }), proj("b", { rokZavrsetka: "2026-11-01", vrijednost: 900 }), proj("c", { voditeljId: "" })], ponude: [{ id: "p1", broj: "P", status: "Poslana", datum: "2026-01-01" }] });
  assert.deepEqual(r.iznimke.map((i) => i.razina), ["crveno", "crveno", "zuto", "info"]);
  assert.deepEqual(iznimka(r, "kasni").map((i) => i.projektId), ["b", "a"]);
});

test("Zbirni pokazatelji: broj i vrijednost aktivnih, kasne, za isporuku, semafor", () => {
  const r = pregled({
    projekti: [proj("a", { rokZavrsetka: "2026-11-01", vrijednost: 1000 }), proj("b", { vrijednost: 3000 })],
    isporuceno: (p) => (p.id === "b" ? { posto: 50, vrijednostNarudzbe: 3000 } : { posto: 0 }),
  });
  assert.deepEqual(r.kpi.aktivni, { broj: 2, vrijednost: 4000 });
  assert.equal(r.kpi.kasne.broj, 1);
  assert.equal(r.kpi.zaIsporuku.vrijednost, 2500); // 1000 neisporučeno + 1500 (50 % od 3000)
  assert.deepEqual(r.kpi.semafor, { crveno: 1, zuto: 0, zeleno: 1 });
});

test("Prazni podaci ne ruše pregled", () => {
  const r = direktorskiPregled({ danas: DANAS });
  assert.deepEqual(r.redovi, []);
  assert.deepEqual(r.iznimke, []);
  assert.equal(r.kpi.aktivni.broj, 0);
});

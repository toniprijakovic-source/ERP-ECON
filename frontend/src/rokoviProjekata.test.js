// Statusi projekta (Montaža → Završen → Arhiviran) i rokovi (tko kasni, prijedlog statusa, čeka obračun).
// Pokretanje: `npm test` u mapi frontend. Izmišljeni podaci.
import test from "node:test";
import assert from "node:assert/strict";
import { projektDovrsen, projektAktivan, projektPrimaDokumente, prijelazStatusa, STATUSI_PROJEKTA } from "./statusProjekta.js";
import { analizaRokova, kasneProjekti, danaIzmedu, zapisPromjeneRoka, dodajPromjenuRoka } from "./rokoviProjekata.js";

const DANAS = "2026-11-19";
const nalog = (id, projektId, status, datumZavrsetka) => ({ id, projektId, status, datumZavrsetka });

test("Statusi: Završen i Arhiviran su dovršeni, Otkazan nije ni aktivan ni dovršen", () => {
  assert.deepEqual(STATUSI_PROJEKTA, ["Ponuda", "Odobren", "U izradi", "Montaža", "Završen", "Arhiviran", "Otkazan"]);
  for (const s of ["Završen", "Arhiviran"]) { assert.equal(projektDovrsen({ status: s }), true); assert.equal(projektAktivan({ status: s }), false); }
  for (const s of ["Ponuda", "Odobren", "U izradi", "Montaža"]) { assert.equal(projektDovrsen({ status: s }), false); assert.equal(projektAktivan({ status: s }), true); }
  assert.equal(projektAktivan({ status: "Otkazan" }), false);
  assert.equal(projektDovrsen({ status: "Otkazan" }), false);
});

test("Dokumenti: Završen (čeka obračun) još prima otpremnice/izdatnice, Arhiviran i Otkazan ne", () => {
  assert.equal(projektPrimaDokumente({ status: "U izradi" }), true);
  assert.equal(projektPrimaDokumente({ status: "Završen" }), true);
  assert.equal(projektPrimaDokumente({ status: "Arhiviran" }), false);
  assert.equal(projektPrimaDokumente({ status: "Otkazan" }), false);
});

test("Prijelaz aktivan → Završen: otvoreni nalozi se završavaju i pamte, datum završetka, bez datuma arhiviranja", () => {
  const nalozi = [nalog("n1", "p1", "Završen"), nalog("n2", "p1", "U tijeku"), nalog("n3", "p1", "Planiran"), nalog("n4", "p2", "Planiran")];
  const r = prijelazStatusa({ id: "p1", status: "Montaža" }, "Završen", nalozi, DANAS);
  assert.deepEqual(r.zavrsiNaloge, ["n2", "n3"]);
  assert.deepEqual(r.patch.autoZavrsenoNalozi, [{ id: "n2", staviStatus: "U tijeku" }, { id: "n3", staviStatus: "Planiran" }]);
  assert.equal(r.patch.status, "Završen");
  assert.equal(r.patch.statusPrijeZavrsetka, "Montaža");
  assert.equal(r.patch.zavrsenDatum, DANAS);
  assert.equal(r.patch.arhiviranDatum, null);
});

test("Prijelaz aktivan → Arhiviran izravno: isto kao završetak, uz datum arhiviranja", () => {
  const r = prijelazStatusa({ id: "p1", status: "U izradi" }, "Arhiviran", [nalog("n1", "p1", "Planiran")], DANAS);
  assert.deepEqual(r.zavrsiNaloge, ["n1"]);
  assert.equal(r.patch.zavrsenDatum, DANAS);
  assert.equal(r.patch.arhiviranDatum, DANAS);
});

test("Završen → Arhiviran i natrag: nalozi se ne diraju, mijenja se samo datum arhiviranja", () => {
  const zavrsen = { id: "p1", status: "Završen", zavrsenDatum: "2026-11-06", statusPrijeZavrsetka: "Montaža", autoZavrsenoNalozi: [{ id: "n1", staviStatus: "Planiran" }] };
  const a = prijelazStatusa(zavrsen, "Arhiviran", [nalog("n1", "p1", "Završen")], DANAS);
  assert.deepEqual(a.zavrsiNaloge, []); assert.deepEqual(a.vratiNaloge, []);
  assert.deepEqual(a.patch, { status: "Arhiviran", arhiviranDatum: DANAS });
  const b = prijelazStatusa({ ...zavrsen, status: "Arhiviran", arhiviranDatum: DANAS }, "Završen", [], DANAS);
  assert.deepEqual(b.patch, { status: "Završen", arhiviranDatum: null });
});

test("Završen/Arhiviran → aktivan: vraćaju se SAMO nalozi koje je prijelaz završio, oznake se brišu", () => {
  const stari = { id: "p1", status: "Završen", zavrsenDatum: "2026-11-06", statusPrijeZavrsetka: "Montaža", autoZavrsenoNalozi: [{ id: "n2", staviStatus: "U tijeku" }, { id: "n3", staviStatus: "Planiran" }] };
  const r = prijelazStatusa(stari, "Montaža", [], DANAS);
  assert.deepEqual(r.vratiNaloge, [{ id: "n2", status: "U tijeku" }, { id: "n3", status: "Planiran" }]);
  assert.deepEqual(r.patch, { status: "Montaža", statusPrijeZavrsetka: null, autoZavrsenoNalozi: [], zavrsenDatum: null, arhiviranDatum: null });
  const iArhive = prijelazStatusa({ ...stari, status: "Arhiviran", arhiviranDatum: "2026-11-10" }, "U izradi", [], DANAS);
  assert.equal(iArhive.vratiNaloge.length, 2);
  assert.equal(iArhive.patch.arhiviranDatum, null);
});

test("Završen → Otkazan: samo status (nalozi ostaju završeni, kao i prije)", () => {
  const r = prijelazStatusa({ id: "p1", status: "Završen", autoZavrsenoNalozi: [{ id: "n1", staviStatus: "Planiran" }] }, "Otkazan", [], DANAS);
  assert.deepEqual(r.patch, { status: "Otkazan" });
  assert.deepEqual(r.vratiNaloge, []);
});

test("Dani između datuma", () => {
  assert.equal(danaIzmedu("2026-10-30", "2026-11-19"), 20);
  assert.equal(danaIzmedu("2026-11-19", "2026-11-19"), 0);
  assert.equal(danaIzmedu("2026-12-31", "2027-01-02"), 2);
  assert.equal(danaIzmedu("", "2026-11-19"), null);
});

const projekti = [
  { id: "a", sifra: "RN 170-288", naziv: "Balkon", status: "Montaža", rokZavrsetka: "2026-10-30", kupacId: "k1", vrijednost: 100 },
  { id: "b", sifra: "RN 170-307", naziv: "Ograde", status: "U izradi", rokZavrsetka: "2026-10-23", kupacId: "k1", vrijednost: 50 },
  { id: "c", sifra: "RN 60-108", naziv: "Bez roka", status: "U izradi", rokZavrsetka: "", kupacId: "k2", vrijednost: 0 },
  { id: "d", sifra: "RN 170-298", naziv: "U roku", status: "U izradi", rokZavrsetka: "2026-12-31", kupacId: "k1", vrijednost: 200 },
  { id: "e", sifra: "RN 1-1", naziv: "Čeka obračun A", status: "Završen", rokZavrsetka: "2026-09-01", zavrsenDatum: "2026-11-06", kupacId: "k1", vrijednost: 1000 },
  { id: "f", sifra: "RN 1-2", naziv: "Čeka obračun B", status: "Završen", rokZavrsetka: "2026-09-01", zavrsenDatum: "2026-10-20", kupacId: "k1", vrijednost: 500 },
  { id: "g", sifra: "RN 1-3", naziv: "Stari", status: "Arhiviran", rokZavrsetka: "2025-01-01", kupacId: "k1", vrijednost: 999 },
  { id: "h", sifra: "RN 1-4", naziv: "Ponuda", status: "Ponuda", rokZavrsetka: "2026-01-01", kupacId: "k1", vrijednost: 1 },
];
const radniNalozi = [
  nalog("n1", "a", "Završen"), nalog("n2", "a", "Završen"),
  nalog("n3", "b", "Završen"), nalog("n4", "b", "U tijeku", "2026-12-10"), nalog("n5", "b", "Planiran", "2026-12-20"), nalog("n6", "b", "Planiran", "2026-10-01"),
];
// RN 170-288: otpremnice su u tablici "kooperant" (i prema vlastitoj tvrtki), a stvarnu isporuku kupcu dokazuje CMR s kupcem projekta.
const otpremnice = [
  { id: "o1", projektId: "a", vrsta: "kooperant", datum: "2026-10-14" },
  { id: "o2", projektId: "b", datum: "2026-10-25" },
];
const cmr = [
  { id: "c1", projektId: "a", kupacId: "k1", datum: "2026-10-14" },
  { id: "c2", projektId: "a", kupacId: "k1", datum: "2026-11-06" },
  { id: "c3", projektId: "b", kupacId: "kooperant-xyz", datum: "2026-11-01" }, // CMR prema kooperantu: ne broji se kao isporuka
];

test("Kasne: samo aktivni projekti s prošlim rokom, najviše dana prvi; Ponuda/Završen/Arhiviran ne", () => {
  const k = kasneProjekti(projekti, DANAS);
  assert.deepEqual(k.map((x) => x.projekt.id), ["b", "a"]);
  assert.deepEqual(k.map((x) => x.danaKasni), [27, 20]);
});

test("Analiza: prijedlog Završen kad su svi nalozi završeni i isporuka kupcu postoji (CMR), kooperantske otpremnice ne broje", () => {
  const { kasne } = analizaRokova({ projekti, radniNalozi, otpremnice, cmr, danas: DANAS });
  const a = kasne.find((r) => r.projekt.id === "a");
  assert.equal(a.danaKasni, 20);
  assert.deepEqual(a.nalozi, { ukupno: 2, zavrseno: 2 });
  assert.equal(a.isporuka.broj, 2);
  assert.equal(a.isporuka.zadnja, "2026-11-06");
  assert.equal(a.prijedlog.status, "Završen");
  assert.match(a.prijedlog.tekst, /06\.11\./);
});

test("Analiza: djelomično gotov projekt nema prijedlog, ima napomenu i predloženi rok iz otvorenih naloga u budućnosti", () => {
  const { kasne } = analizaRokova({ projekti, radniNalozi, otpremnice, cmr, danas: DANAS });
  const b = kasne.find((r) => r.projekt.id === "b");
  assert.equal(b.prijedlog, null);
  assert.equal(b.napomena, "Završeno 1 od 4 radnih naloga.");
  assert.equal(b.predlozeniRok, "2026-12-20", "najkasniji otvoreni nalog u budućnosti (10.10. u prošlosti se ne računa)");
  assert.equal(b.isporuka.broj, 1, "CMR prema kooperantu se ne broji, otpremnica kupcu da");
});

test("Analiza: svi nalozi gotovi a nema isporuke → bez prijedloga, s napomenom; bez naloga → napomena", () => {
  const r1 = analizaRokova({ projekti: [projekti[0]], radniNalozi, otpremnice: [], cmr: [], danas: DANAS }).kasne[0];
  assert.equal(r1.prijedlog, null);
  assert.match(r1.napomena, /isporuka nije zabilježena/);
  const r2 = analizaRokova({ projekti: [{ ...projekti[1], id: "x" }], radniNalozi: [], otpremnice: [], cmr: [], danas: DANAS }).kasne[0];
  assert.equal(r2.napomena, "Nema radnih naloga.");
});

test("Analiza: bez roka i čeka obračun (Završen) — najdulje čekanje prvo, zbroj vrijednosti", () => {
  const r = analizaRokova({ projekti, radniNalozi, otpremnice, cmr, danas: DANAS });
  assert.deepEqual(r.bezRoka.map((x) => x.projekt.id), ["c"]);
  assert.equal(r.bezRoka[0].danaKasni, null);
  assert.deepEqual(r.cekaObracun.map((x) => [x.projekt.id, x.danaOdZavrsetka]), [["f", 30], ["e", 13]]);
  assert.equal(r.ukupnoCekaObracun, 1500);
  assert.ok(!r.cekaObracun.some((x) => x.projekt.id === "g"), "arhivirani ne čekaju obračun");
});

test("Povijest roka: zapis i dodavanje bez diranja starih", () => {
  const z = zapisPromjeneRoka({ id: "r1", stariRok: "2026-10-30", noviRok: "2026-12-01", razlog: "Čekamo materijal", napomena: " B&O čeka crteže ", izmijenioId: "z1", danas: DANAS });
  assert.deepEqual(z, { id: "r1", datum: DANAS, stariRok: "2026-10-30", noviRok: "2026-12-01", razlog: "Čekamo materijal", napomena: "B&O čeka crteže", izmijenioId: "z1" });
  const prije = [{ id: "r0" }];
  const poslije = dodajPromjenuRoka({ promjeneRoka: prije }, z);
  assert.equal(poslije.length, 2);
  assert.equal(prije.length, 1, "izvorni popis se ne mijenja");
  assert.equal(dodajPromjenuRoka({}, z).length, 1);
});

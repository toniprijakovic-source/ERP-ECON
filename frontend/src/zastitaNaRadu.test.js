// Provjere logike uputnice RA-1 (kriteriji prihvaćanja iz specifikacije). Pokretanje: `npm test` u mapi frontend (node:test, bez dodatnih paketa).
// Sve osobe i OIB-ovi su izmišljeni — repozitorij je javan, stvarni podaci radnika ne smiju ovamo.
import test from "node:test";
import assert from "node:assert/strict";
import {
  provjeriOib, ocistiOib, datumHr, mjeseciIzmedu, dodajMjesece, stazTekst, izracunajStaz, godineUGodineMjesece, parsirajTocke, spojiTocke, formatirajTocke,
  predlosciIzProcjene, zadnjiPregled, sljedeciPregled, statusRoka, sljedeciRedniBroj, trebaPocetniBroj, nazivDatotekeUputnice, izradiPoljaUputnice,
  provjeriUputnicu, nedostajuciPodaci, prazniTereti,
} from "./zastitaNaRadu.js";

// Valjan izmišljen OIB: 10 znamenki + izračunata kontrolna znamenka (ISO 7064, MOD 11,10).
const oibIz = (deset) => { let a = 10; for (const z of deset) { a = (a + Number(z)) % 10; if (a === 0) a = 10; a = (a * 2) % 11; } let k = 11 - a; if (k === 10) k = 0; return `${deset}${k}`; };
const OIB = oibIz("1234567890");
const TVRTKA = { naziv: "Probna tvrtka d.o.o.", adresa: "Ulica 1, 10000 Grad", oib: oibIz("9876543210") };
const ZAP = { id: "z1", ime: "Ivo", prezime: "Testić", datumZaposlenja: "2020-03-15" };
const RADNIK = { id: "z1", oib: OIB, datumRodjenja: "1990-05-20", mjestoRodjenja: "Probno", imeRoditelja: "Marko", zanimanje: "bravar", skolskaSprema: "SSS", radnoMjestoId: "rm-0305", stazPrijeGodine: 5, stazPrijeMjeseci: 6, datumPocetkaNaRadnomMjestu: "2022-01-10" };
const predlosci = Object.fromEntries(predlosciIzProcjene().map((p) => [p.sifra, p]));

test("OIB: ispravna kontrolna znamenka, duljina i nebrojčani znakovi", () => {
  assert.equal(provjeriOib(OIB), true);
  assert.equal(provjeriOib(`${OIB.slice(0, 10)}${(Number(OIB[10]) + 1) % 10}`), false);
  assert.equal(provjeriOib(OIB.slice(0, 10)), false);
  assert.equal(provjeriOib(""), false);
  assert.equal(ocistiOib(` ${OIB.slice(0, 5)} ${OIB.slice(5)} `), OIB);
  assert.equal(provjeriOib(`${OIB.slice(0, 5)}-${OIB.slice(5)}`), true);
});

test("Datumi su uvijek DD.MM.GGGG. s točkom na kraju", () => {
  assert.equal(datumHr("2026-03-18"), "18.03.2026.");
  assert.equal(datumHr("2025-11-13T10:00:00.000Z"), "13.11.2025.");
  assert.equal(datumHr(""), "");
  assert.equal(datumHr(null), "");
});

test("Staž: pune godine, ispod godine u mjesecima, prije dolaska + kod nas", () => {
  assert.equal(stazTekst(0), "0 mj");
  assert.equal(stazTekst(7), "7 mj");
  assert.equal(stazTekst(12), "1 g");
  assert.equal(stazTekst(145), "12 g");
  assert.equal(mjeseciIzmedu("2020-03-15", "2026-10-29"), 79);
  assert.equal(mjeseciIzmedu("2020-03-15", "2026-10-14"), 78);
  assert.equal(mjeseciIzmedu("2026-10-29", "2020-03-15"), 0);
  const staz = izracunajStaz({ datumZaposlenja: ZAP.datumZaposlenja, ...RADNIK }, "2026-10-29", "periodicki");
  assert.equal(staz.ukupno, "12 g"); // 66 mj prije + 79 mj kod nas = 145 mj
  assert.equal(staz.naPoslovima, "4 g"); // od 10.01.2022.
  assert.equal(izracunajStaz({ datumZaposlenja: "2026-03-01" }, "2026-10-29", "periodicki").ukupno, "7 mj");
});

test("Prethodni pregled: staž na poslovima ostaje prazan", () => {
  assert.equal(izracunajStaz({ datumZaposlenja: ZAP.datumZaposlenja, ...RADNIK }, "2026-10-29", "prethodni").naPoslovima, "");
});

test("Staž izvan Econa iz Godišnjeg odmora (decimalne godine) → godine i mjeseci", () => {
  assert.deepEqual(godineUGodineMjesece(6.5), { godine: 6, mjeseci: 6 });
  assert.deepEqual(godineUGodineMjesece("12,25"), { godine: 12, mjeseci: 3 });
  assert.deepEqual(godineUGodineMjesece(""), { godine: 0, mjeseci: 0 });
});

test("Datum + mjeseci ne prelazi u idući mjesec", () => {
  assert.equal(dodajMjesece("2026-01-31", 1), "2026-02-28");
  assert.equal(dodajMjesece("2025-11-13", 12), "2026-11-13");
  assert.equal(dodajMjesece("2026-11-30", 3), "2027-02-28");
});

test("Točke Pravilnika: čitanje oba zapisa i spajanje poslova bez ponavljanja", () => {
  assert.deepEqual(parsirajTocke("16., 17., 18. (pp 18., 19.)"), { tocke: [16, 17, 18], podtocke: [18, 19] });
  assert.deepEqual(parsirajTocke("1.,2.,5.,16.,17.,18.(pp 19,23,24,41)"), { tocke: [1, 2, 5, 16, 17, 18], podtocke: [19, 23, 24, 41] });
  assert.deepEqual(parsirajTocke("1., 16., 17., 18. (pp. 18., 19., 23., 24., 41.) + bojanje temeljnom bojom (pp 50.)"), { tocke: [1, 16, 17, 18], podtocke: [18, 19, 23, 24, 41, 50] });
  assert.deepEqual(parsirajTocke(""), { tocke: [], podtocke: [] });
  // primjer iz specifikacije: Bravar (0305) + Rukovatelj platformom (0402)
  const spojeno = spojiTocke([predlosci["0305"], predlosci["0402"]]);
  assert.equal(formatirajTocke(spojeno), "1.,2.,5.,16.,17.,18.(pp 18,19,23,24,41,50)");
  assert.equal(formatirajTocke({ tocke: [], podtocke: [] }), "");
});

test("Predlošci iz Procjene rizika: 22 radna mjesta, 14 s posebnim uvjetima, nijedan odobren", () => {
  const sve = predlosciIzProcjene();
  assert.equal(sve.length, 22);
  assert.equal(sve.filter((p) => p.posebniUvjeti).length, 14);
  assert.equal(new Set(sve.map((p) => p.id)).size, 22);
  assert.ok(sve.every((p) => p.odobreno === null));
  assert.deepEqual([predlosci["0401"].tocke, predlosci["0401"].podtocke], [[16, 17, 18], [18, 19]]);
  assert.equal(predlosci["0101"].posebniUvjeti, false);
  assert.equal(predlosci["0101"].clanak, "");
});

test("Prethodna uputnica nema blok o posljednjem pregledu ni staž na poslovima", () => {
  const prosli = { datumPregleda: "2025-11-13", clanak: "3.", tocke: "1.,2.", ocjena: "Sposoban" };
  const polja = izradiPoljaUputnice({ zaposlenik: ZAP, radnik: RADNIK, radnoMjesto: predlosci["0305"], vrsta: "prethodni", datum: "2026-10-29", posljednjiPregled: prosli, tvrtka: TVRTKA });
  assert.equal(polja.posljednjiPregled, null);
  assert.equal(polja.stazNaPoslovima, "");
  assert.equal(polja.ukupniStaz, "12 g");
});

test("Periodička uputnica preuzima datum, članak, točke i ocjenu zadnjeg pregleda", () => {
  const prosli = { datumPregleda: "2025-11-13", clanak: "3.", tocke: "1.,2.,5.,16.,17.,18.(pp 19)", drugiPropis: "", ocjena: "Sposoban za rad" };
  const polja = izradiPoljaUputnice({ zaposlenik: ZAP, radnik: RADNIK, radnoMjesto: predlosci["0305"], vrsta: "periodicki", datum: "2026-10-29", posljednjiPregled: prosli, tvrtka: TVRTKA });
  assert.deepEqual(polja.posljednjiPregled, { datum: "2025-11-13", clanak: "3.", tocke: "1.,2.,5.,16.,17.,18.(pp 19)", drugiPropis: "", ocjena: "Sposoban za rad" });
  assert.equal(polja.stazNaPoslovima, "4 g");
  assert.equal(polja.poslodavac.naziv, "Probna tvrtka d.o.o.");
  assert.equal(polja.poslodavac.adresa1, "Ulica 1");
  assert.equal(polja.poslodavac.adresa2, "10000 Grad");
  assert.equal(polja.poslodavac.oib, ocistiOib(TVRTKA.oib));
});

test("Radnik s dodatnim poslom dobiva spojene točke; posao izvan F.6 ostavlja točke praznima", () => {
  const polja = izradiPoljaUputnice({ zaposlenik: ZAP, radnik: RADNIK, radnoMjesto: predlosci["0305"], dodatnaRadnaMjesta: [predlosci["0402"]], vrsta: "izvanredni", datum: "2026-10-29", tvrtka: TVRTKA });
  assert.equal(polja.tocke, "1.,2.,5.,16.,17.,18.(pp 18,19,23,24,41,50)");
  const ured = izradiPoljaUputnice({ zaposlenik: ZAP, radnik: RADNIK, radnoMjesto: predlosci["0201"], vrsta: "izvanredni", datum: "2026-10-29", tvrtka: TVRTKA });
  assert.equal(ured.tocke, "");
  assert.equal(ured.clanak, "");
});

test("Izmjena predloška poslije izrade ne dira već izrađenu uputnicu (snimka je kopija)", () => {
  const rm = { ...predlosci["0401"], mjestoRada: ["zatvoreno"], tereti: { ...prazniTereti(), dizanje: { oznaceno: true, kg: 25 } } };
  const polja = izradiPoljaUputnice({ zaposlenik: ZAP, radnik: RADNIK, radnoMjesto: rm, vrsta: "periodicki", datum: "2026-10-29", tvrtka: TVRTKA });
  rm.mjestoRada.push("otvoreno");
  rm.tereti.dizanje.kg = 99;
  assert.deepEqual(polja.mjestoRada, ["zatvoreno"]);
  assert.equal(polja.tereti.dizanje.kg, 25);
});

test("Zadnji pregled: najnoviji s upisanom ocjenom; rok iz liječnikovog datuma, roka mjesta ili zadanog roka", () => {
  const pregledi = [
    { id: "a", zaposlenikId: "z1", datumPregleda: "2024-11-10", ocjena: "Sposoban" },
    { id: "b", zaposlenikId: "z1", datumPregleda: "2025-11-13", ocjena: "Sposoban" },
    { id: "c", zaposlenikId: "z1", datumPregleda: "2026-06-01", ocjena: "" },
    { id: "d", zaposlenikId: "z2", datumPregleda: "2026-01-01", ocjena: "Sposoban" },
  ];
  assert.equal(zadnjiPregled(pregledi, "z1").id, "b");
  assert.equal(zadnjiPregled(pregledi, "nema"), null);
  assert.equal(sljedeciPregled({ datumPregleda: "2025-11-13", datumSljedeceg: "2026-05-01" }, { rokPeriodickogMjeseci: 12 }, 24), "2026-05-01");
  assert.equal(sljedeciPregled({ datumPregleda: "2025-11-13" }, { rokPeriodickogMjeseci: 12 }, 24), "2026-11-13");
  assert.equal(sljedeciPregled({ datumPregleda: "2025-11-13" }, { rokPeriodickogMjeseci: "" }, 24), "2027-11-13");
  assert.equal(sljedeciPregled({ datumPregleda: "2025-11-13" }, {}, ""), "");
  assert.equal(sljedeciPregled(null, {}, 12), "");
});

test("Rokovi: istekao, uskoro (30 dana), u redu, nema podataka", () => {
  assert.equal(statusRoka("2026-10-28", "2026-10-31"), "isteklo");
  assert.equal(statusRoka("2026-10-31", "2026-10-31"), "uskoro");
  assert.equal(statusRoka("2026-11-30", "2026-10-31"), "uskoro");
  assert.equal(statusRoka("2026-12-01", "2026-10-31"), "uredu");
  assert.equal(statusRoka("", "2026-10-31"), "nema");
});

test("Brojevi uputnica: od početnog broja, bez rupa, ispočetka svake godine, poništene se broje", () => {
  const postavke = { pocetniBrojevi: { 2026: 65 } };
  assert.equal(sljedeciRedniBroj([], postavke, 2026), 66);
  const u = [{ godina: 2026, redniBroj: 66 }, { godina: 2026, redniBroj: 67, status: "Poništena" }];
  assert.equal(sljedeciRedniBroj(u, postavke, 2026), 68);
  assert.equal(sljedeciRedniBroj(u, postavke, 2027), 1);
  assert.equal(sljedeciRedniBroj([], { pocetniBrojevi: { 2026: 0 } }, 2026), 1);
  assert.equal(trebaPocetniBroj([], {}), true);
  assert.equal(trebaPocetniBroj([], { pocetniBrojevi: { 2026: 0 } }), false);
  assert.equal(trebaPocetniBroj(u, {}), false);
});

test("Naziv datoteke: RA-1_<broj>_<prezime>_<vrsta>.pdf bez dijakritika i posebnih znakova", () => {
  assert.equal(nazivDatotekeUputnice({ broj: "65/2026", vrsta: "prethodni", polja: { prezime: "Čulić" } }), "RA-1_65-2026_Culic_prethodni.pdf");
  assert.equal(nazivDatotekeUputnice({ broj: "7/2027", vrsta: "periodicki", polja: { prezime: "Đurđević-Šarić" } }), "RA-1_7-2027_DurdevicSaric_periodicki.pdf");
});

test("Spremanje je moguće tek uz ime, ispravan OIB, datum rođenja, radno mjesto, vrstu i datum", () => {
  const dobro = { polja: { ime: "Ivo", prezime: "Testić", oib: OIB, datumRodjenja: "1990-05-20", posloviNaziv: "Bravar" }, vrsta: "periodicki", datum: "2026-10-29" };
  assert.deepEqual(provjeriUputnicu(dobro), []);
  assert.equal(provjeriUputnicu({ ...dobro, vrsta: "" }).length, 1);
  assert.equal(provjeriUputnicu({ ...dobro, polja: { ...dobro.polja, oib: "12345678900" } }).length, 1);
  assert.equal(provjeriUputnicu({ ...dobro, polja: { ime: "", prezime: "", oib: "", datumRodjenja: "", posloviNaziv: "" } }).length, 4);
});

test("Popis podataka radnika koji još nedostaju", () => {
  assert.deepEqual(nedostajuciPodaci(RADNIK), []);
  assert.deepEqual(nedostajuciPodaci({ oib: OIB }), ["datum rođenja", "mjesto rođenja", "ime oca/majke", "zanimanje", "školska sprema", "radno mjesto"]);
});

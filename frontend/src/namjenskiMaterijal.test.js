// Namjenski materijal: odredište stavke, prepoznavanje projekta iz teksta, izdatnice pri zaprimanju, ručne stavke kao trošak, programi rezanja.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ODREDISTE_SKLADISTE, odredisteStavke, postaviOdrediste, projektiIzTeksta, prepoznajProjekt, odredisteIzUpita, stavkeBezOdredista,
  jedinicnaCijena, izdatniceZaprimanja, troskoviRucnihStavki, namjenskoRaspolozivo, planProgramaMaterijala, finalizacijaPrograma, zapisKorekcije,
  narucenoStavke, primljenoStavke, preostaloStavke, imaZaprimanja, udioNaProjektu, raspodjelaIsporuke, statusNakonZaprimanja, uzmiIzLotova,
} from "./namjenskiMaterijal.js";

const projekti = [
  { id: "p1", sifra: "RN 150-43", status: "U izradi" },
  { id: "p2", sifra: "RN 170-307", status: "U izradi" },
  { id: "p3", sifra: "RN 180-71", status: "U izradi" },
  { id: "p4", sifra: "RN 180-72", status: "Arhiviran" },
  { id: "p5", sifra: "Rn 40-04-51", status: "Odobren" },
];

test("odredište: projekt, skladište, nije odabrano", () => {
  assert.equal(odredisteStavke({ projektId: "p1" }), "p1");
  assert.equal(odredisteStavke({ zaSkladiste: true }), ODREDISTE_SKLADISTE);
  assert.equal(odredisteStavke({}), "");
  assert.deepEqual(postaviOdrediste({ a: 1 }, ODREDISTE_SKLADISTE), { a: 1, projektId: null, zaSkladiste: true });
  assert.deepEqual(postaviOdrediste({}, "p2"), { projektId: "p2", zaSkladiste: false });
  assert.deepEqual(postaviOdrediste({ projektId: "p2" }, ""), { projektId: null, zaSkladiste: false });
  assert.deepEqual(stavkeBezOdredista([{ projektId: "p1" }, {}, { zaSkladiste: true }, { projektId: null }]), [1, 3]);
});

test("projekt iz teksta: bez razmaka, s tekstom, tri dijela šifre, raspon, više projekata", () => {
  assert.equal(prepoznajProjekt("RN150-43", projekti)?.id, "p1");
  assert.equal(prepoznajProjekt("Za projekt RN 170-307 — Ograde", projekti)?.id, "p2");
  assert.equal(prepoznajProjekt("40-04-51", projekti)?.id, "p5");
  assert.deepEqual(projektiIzTeksta("RN 180-71-72", projekti).map((p) => p.id), ["p3", "p4"]);
  assert.equal(prepoznajProjekt("RN 180-71-72", projekti), null, "više projekata → nema automatskog odabira");
  assert.equal(prepoznajProjekt("ateste 3.1, EN 10025", projekti), null);
});

test("odredište iz upita: izričito > projekt upita > tekst; inače null", () => {
  assert.deepEqual(odredisteIzUpita({ zaSkladiste: true, dodatniZahtjevi: "RN150-43" }, {}, projekti), { projektId: null, zaSkladiste: true });
  assert.deepEqual(odredisteIzUpita({ projektId: "p2" }, { izvorProjektaId: "p1" }, projekti), { projektId: "p2", zaSkladiste: false });
  assert.deepEqual(odredisteIzUpita({}, { izvorProjektaId: "p1" }, projekti), { projektId: "p1", zaSkladiste: false });
  assert.deepEqual(odredisteIzUpita({ dodatniZahtjevi: "RN 170-307" }, {}, projekti), { projektId: "p2", zaSkladiste: false });
  assert.equal(odredisteIzUpita({ dodatniZahtjevi: "RN 180-71-72" }, {}, projekti), null);
  assert.equal(odredisteIzUpita({}, {}, projekti), null);
});

test("jedinična cijena: naručeni iznos / količina, pa cijena retka, pa skladište", () => {
  assert.equal(jedinicnaCijena({ narucenoIznos: 1000, kolicina: 8, cijenaRetka: 1, cijenaSkladista: 2 }), 125);
  assert.equal(jedinicnaCijena({ narucenoIznos: null, kolicina: 8, cijenaRetka: 33.5, cijenaSkladista: 2 }), 33.5);
  assert.equal(jedinicnaCijena({ narucenoIznos: null, kolicina: 8, cijenaRetka: null, cijenaSkladista: 2 }), 2);
});

test("izdatnice pri zaprimanju: po jedna po projektu, matični brojevi, napomena s narudžbenicom", () => {
  let n = 0;
  const uid = (p) => `${p}-${++n}`;
  const mat = { id: "m1", sifra: "20001001", naziv: "Lim 10 mm", jm: "kom" };
  const r = izdatniceZaprimanja({
    narudzbenica: { id: "nab1", broj: "NAR-2026-080", otpremnicaDobavljaca: "OT-5" }, datum: "2026-11-26", uid,
    brojevi: (i) => `IZD-2026-${String(43 + i).padStart(3, "0")}`,
    stavke: [
      { projektId: "p1", materijal: mat, kolicina: 14, cijena: 293.2, dimenzije: "3000×1500 mm", lotovi: [{ maticniId: "mb1", broj: 3850, kolicina: 10 }, { maticniId: "mb2", broj: 3851, kolicina: 4 }] },
      { projektId: "p2", materijal: { ...mat, id: "m2", naziv: "Plosnato 40×8" }, kolicina: 60, cijena: 12.06, lotovi: [] },
      { projektId: "p1", materijal: { ...mat, id: "m3", naziv: "HEA 100" }, kolicina: 7, cijena: 92.18, lotovi: [{ maticniId: "mb3", broj: 3852, kolicina: 7 }] },
      { projektId: "p1", materijal: mat, kolicina: 0, cijena: 1 },
    ],
  });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((i) => [i.broj, i.projektId, i.stavke.length, i.izvor, i.status]), [["IZD-2026-043", "p1", 2, "zaprimanje", "Izdano"], ["IZD-2026-044", "p2", 1, "zaprimanje", "Izdano"]]);
  assert.deepEqual(r[0].stavke[0].matBrojevi, [{ maticniId: "mb1", broj: 3850, kolicina: 10 }, { maticniId: "mb2", broj: 3851, kolicina: 4 }]);
  assert.equal(r[0].stavke[0].cijena, 293.2);
  assert.equal(r[0].stavke[0].kolicinaIzdano, 14);
  assert.match(r[0].napomena, /NAR-2026-080.*OT-5/);
  assert.equal(r[0].narudzbenicaId, "nab1");
});

test("ručne stavke narudžbenice s projektom = trošak projekta od dana zaprimanja", () => {
  const narudzbenice = [
    { id: "n1", broj: "NAR-1", status: "Primljeno", zaprimljeno: "2026-11-20", dobavljacId: "d1", stavke: [
      { rucniNaziv: "Vijak M8", kolicina: 100, cijenaPoJed: 0.2, projektId: "p1" },
      { materijalId: "m1", kolicina: 5, projektId: "p1" }, // skladišni materijal — ide izdatnicom, ne ovdje
      { rucniNaziv: "Drvo", kolicina: 2, cijenaPoJed: 10, projektId: "p2" },
    ] },
    { id: "n2", broj: "NAR-2", status: "Poslano", stavke: [{ rucniNaziv: "Usluga", kolicina: 1, cijenaPoJed: 500, projektId: "p1" }] },
  ];
  const t = troskoviRucnihStavki(narudzbenice, "p1", () => []);
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].iznos, t[0].datum, t[0].izNarudzbenice], [20, "2026-11-20", true]);
  assert.match(t[0].opis, /Vijak M8 \(NAR-1\)/);
  // naručeni iznos iz upita ima prednost
  assert.equal(troskoviRucnihStavki(narudzbenice, "p1", () => [{ iznos: 25 }])[0].iznos, 25);
});

test("programi rezanja: namjenski materijal projekta troši se prvi, ostatak sa stanja", () => {
  const nalogProjekt = new Map([["rn1", "p1"], ["rn2", "p2"]]);
  const izdatnice = [
    { projektId: "p1", izvor: "zaprimanje", stavke: [{ materijalId: "m1", kolicinaIzdano: 14, kolicinaVraceno: 2 }] }, // 12 namjenski
    { projektId: "p1", izvor: "program", stavke: [{ materijalId: "m1", kolicinaIzdano: 5 }] }, // nastalo iz programa — ne broji se
    { projektId: "p2", stavke: [{ materijalId: "m1", kolicinaIzdano: 50 }] },
  ];
  const programi = [
    { radniNalogId: "rn1", stavkeMaterijala: [{ id: "a", materijalId: "m1", izNamjenskog: 4, finalizirano: false }, { id: "b", materijalId: "m1", izNamjenskog: 5, finalizirano: true, stvarnoKolicina: 3 }] },
    { radniNalogId: "rn2", stavkeMaterijala: [{ id: "c", materijalId: "m1", izNamjenskog: 40, finalizirano: false }] },
  ];
  // 12 − (4 + min(5, 3)) = 5
  assert.equal(namjenskoRaspolozivo({ izdatnice, programi, nalogProjekt, projektId: "p1", materijalId: "m1" }), 5);
  assert.equal(namjenskoRaspolozivo({ izdatnice, programi, nalogProjekt, projektId: "p1", materijalId: "m1", izuzmiStavkuId: "a" }), 9);
  assert.equal(namjenskoRaspolozivo({ izdatnice, programi, nalogProjekt, projektId: null, materijalId: "m1" }), 0);
  assert.deepEqual(planProgramaMaterijala(8, 5), { izNamjenskog: 5, saStanja: 3 });
  assert.deepEqual(planProgramaMaterijala(3, 5), { izNamjenskog: 3, saStanja: 0 });
  // plan 8 (5 namjenski, 3 sa stanja), stvarno 10 → 5 namjenski, 5 sa stanja (izdatnica), dodatno skinuti 2
  assert.deepEqual(finalizacijaPrograma({ planirano: 8, izNamjenskog: 5, stvarno: 10 }), { uzetoNamjensko: 5, saStanja: 5, promjenaStanja: -2 });
  // stvarno 4 → sve iz namjenskog, 3 sa stanja vraća se
  assert.deepEqual(finalizacijaPrograma({ planirano: 8, izNamjenskog: 5, stvarno: 4 }), { uzetoNamjensko: 4, saStanja: 0, promjenaStanja: 3 });
  // bez namjenskog (stari programi): kao prije — razlika plan−stvarno
  assert.deepEqual(finalizacijaPrograma({ planirano: 6, stvarno: 5 }), { uzetoNamjensko: 0, saStanja: 5, promjenaStanja: 1 });
});

test("zapis ručnog smanjenja stanja", () => {
  assert.deepEqual(zapisKorekcije({ staro: 37, novo: 2, razlog: "projekt", projektId: "p2", zaposlenikId: "z1", datum: "2026-11-26" }), { datum: "2026-11-26", staro: 37, novo: 2, razlika: -35, razlog: "projekt", projektId: "p2", zaposlenikId: "z1" });
  assert.deepEqual(zapisKorekcije({ staro: 5, novo: 4, razlog: "inventura", napomena: "brojanje", datum: "2026-11-26" }), { datum: "2026-11-26", staro: 5, novo: 4, razlika: -1, razlog: "inventura", napomena: "brojanje", zaposlenikId: null });
});

test("zaprimanje: naručeno / primljeno / preostalo po stavci (komadi ili količina)", () => {
  const komadna = { nacinUnosa: "duzina", komada: "84", kolicina: 2705.976 };
  assert.equal(narucenoStavke(komadna), 84);
  assert.equal(narucenoStavke({ kolicina: "40" }), 40);
  // stara zaprimljena narudžbenica bez polja primljeno = sve primljeno; ručno postavljeno "Djelomično primljeno" bez zapisa = ništa
  assert.equal(primljenoStavke(komadna, "Primljeno"), 84);
  assert.equal(primljenoStavke(komadna, "Djelomično primljeno"), 0);
  assert.equal(preostaloStavke({ ...komadna, primljeno: 50 }, "Djelomično primljeno"), 34);
  assert.equal(preostaloStavke({ ...komadna, primljeno: 108 }, "Primljeno"), 0);
  assert.equal(imaZaprimanja({ status: "Djelomično primljeno", stavke: [{ primljeno: 0 }, { primljeno: 5 }] }), true);
  assert.equal(imaZaprimanja({ status: "Djelomično primljeno", stavke: [{ kolicina: 5 }] }), false);
  assert.equal(imaZaprimanja({ status: "Primljeno", stavke: [] }), true);
});

test("zaprimanje: raspodjela isporuke — manjak, višak na projekt ili skladište, stavka za skladište", () => {
  assert.deepEqual(raspodjelaIsporuke({ isporuceno: 30, preostalo: 84, zaProjekt: true }), { naProjekt: 30, naSkladiste: 0 });
  assert.equal(raspodjelaIsporuke({ isporuceno: 108, preostalo: 84, zaProjekt: true }), null); // višak — treba pitati
  assert.deepEqual(raspodjelaIsporuke({ isporuceno: 108, preostalo: 84, zaProjekt: true, visak: "projekt" }), { naProjekt: 108, naSkladiste: 0 });
  assert.deepEqual(raspodjelaIsporuke({ isporuceno: 108, preostalo: 84, zaProjekt: true, visak: "skladiste" }), { naProjekt: 84, naSkladiste: 24 });
  assert.deepEqual(raspodjelaIsporuke({ isporuceno: 108, preostalo: 84, zaProjekt: false }), { naProjekt: 0, naSkladiste: 108 });
  assert.deepEqual(raspodjelaIsporuke({ isporuceno: 0, preostalo: 84, zaProjekt: true }), { naProjekt: 0, naSkladiste: 0 });
});

test("zaprimanje: status nakon zaprimanja i matični brojevi za projekt", () => {
  assert.equal(statusNakonZaprimanja([{ kolicina: 40, primljeno: 40 }, { nacinUnosa: "duzina", komada: 84, primljeno: 108 }]), "Primljeno");
  assert.equal(statusNakonZaprimanja([{ kolicina: 40, primljeno: 40 }, { nacinUnosa: "duzina", komada: 84, primljeno: 60 }]), "Djelomično primljeno");
  assert.deepEqual(uzmiIzLotova([{ id: "a", kolicina: 50 }, { id: "b", kolicina: 58 }], 84), [{ id: "a", kolicina: 50 }, { id: "b", kolicina: 34 }]);
  assert.deepEqual(uzmiIzLotova([{ id: "a", kolicina: 50 }], 0), []);
});

test("ručne stavke: trošak projekta razmjerno zaprimljenom na projekt", () => {
  const narudzbenice = [
    { id: "n1", broj: "NAR-1", status: "Djelomično primljeno", zaprimljeno: "2026-11-27", stavke: [{ rucniNaziv: "Vijak M8", kolicina: 100, cijenaPoJed: 0.2, projektId: "p1", primljeno: 50, naProjektu: 50 }] },
    { id: "n2", broj: "NAR-2", status: "Primljeno", zaprimljeno: "2026-11-27", stavke: [{ rucniNaziv: "Matica", kolicina: 100, cijenaPoJed: 0.1, projektId: "p1", primljeno: 120, naProjektu: 100 }] },
    { id: "n3", broj: "NAR-3", status: "Djelomično primljeno", stavke: [{ rucniNaziv: "Usluga", kolicina: 1, cijenaPoJed: 500, projektId: "p1" }] },
  ];
  assert.deepEqual(troskoviRucnihStavki(narudzbenice, "p1", () => []).map((t) => t.iznos), [10, 10]);
  assert.equal(udioNaProjektu({ kolicina: 10 }, "Primljeno"), 1);
});

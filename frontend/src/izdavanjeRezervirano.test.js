import test from "node:test";
import assert from "node:assert/strict";
import { rezerviranoPoProjektu, stavkeIzRezervacija, pregledZaIzdavanje, ukloniRezervacije } from "./izdavanjeRezervirano.js";

const rez = (id, projektId, materijalId, kolicina, extra = {}) => ({ id, projektId, materijalId, kolicina, ...extra });
// materijal s više dužina: redovi dolaze iz aplikacije (redoviZa), ovdje ih zadajemo izravno
const REDOVI = { "m-vise": [{ duzinaMM: "6000", sirinaMM: "", komada: "4" }, { duzinaMM: "3115", sirinaMM: "", komada: "2" }] };
const redoviZa = (m) => REDOVI[m.id] || null;
const MAT = [
  { id: "m-1", sifra: "10-0001-01", naziv: "HEA 100", jm: "kom", kolicina: 10 },
  { id: "m-kg", sifra: "90-9001-00", naziv: "Žica", jm: "kg", kolicina: 5 },
  { id: "m-vise", sifra: "11-0004-01", naziv: "Cijev 60x40", jm: "kom", kolicina: 6 },
  { id: "m-nula", sifra: "20-0001-01", naziv: "Lim 8", jm: "kom", kolicina: 0 },
];

test("rezerviranoPoProjektu: zbraja rezervacije istog materijala i spaja dužine", () => {
  const r = rezerviranoPoProjektu([
    rez("r1", "p1", "m-vise", 2, { po: [{ duzinaMM: 6000, sirinaMM: null, komada: 2 }] }),
    rez("r2", "p1", "m-vise", 3, { po: [{ duzinaMM: 6000, sirinaMM: null, komada: 1 }, { duzinaMM: 3115, sirinaMM: null, komada: 2 }] }),
    rez("r3", "p1", "m-1", 4),
    rez("r4", "p2", "m-1", 9),
    rez("r5", "p1", "m-kg", 0),
  ], "p1");
  assert.equal(r.length, 2);
  const vise = r.find((x) => x.materijalId === "m-vise");
  assert.equal(vise.kolicina, 5);
  assert.deepEqual(vise.po, [{ duzinaMM: 6000, sirinaMM: null, komada: 3 }, { duzinaMM: 3115, sirinaMM: null, komada: 2 }]);
  assert.deepEqual(vise.rezervacijaIds, ["r1", "r2"]);
  assert.equal(r.find((x) => x.materijalId === "m-1").kolicina, 4);
});

test("stavkeIzRezervacija: obični materijal — količina iz rezervacije", () => {
  const { stavke, napomene } = stavkeIzRezervacija({ projektId: "p1", rezervacije: [rez("r1", "p1", "m-1", 4)], materijali: MAT, redoviZa });
  assert.deepEqual(stavke, [{ materijalId: "m-1", kolicina: "4", po: {} }]);
  assert.deepEqual(napomene, []);
});

test("stavkeIzRezervacija: količina se ograničava na stanje, uz napomenu", () => {
  const { stavke, napomene } = stavkeIzRezervacija({ projektId: "p1", rezervacije: [rez("r1", "p1", "m-kg", 8)], materijali: MAT, redoviZa });
  assert.equal(stavke[0].kolicina, "5");
  assert.equal(napomene.length, 1);
  assert.match(napomene[0], /Žica/);
  assert.match(napomene[0], /na stanju samo 5/);
});

test("stavkeIzRezervacija: materijal bez stanja ili obrisan se preskače, uz napomenu", () => {
  const { stavke, napomene } = stavkeIzRezervacija({ projektId: "p1", rezervacije: [rez("r1", "p1", "m-nula", 2), rez("r2", "p1", "m-nema", 1)], materijali: MAT, redoviZa });
  assert.deepEqual(stavke, []);
  assert.equal(napomene.length, 2);
});

test("stavkeIzRezervacija: materijal s više dužina — po indeksu retka dužine, s ograničenjem na stanje", () => {
  const { stavke, napomene } = stavkeIzRezervacija({
    projektId: "p1", materijali: MAT, redoviZa,
    rezervacije: [rez("r1", "p1", "m-vise", 7, { po: [{ duzinaMM: 6000, sirinaMM: null, komada: 5 }, { duzinaMM: 3115, sirinaMM: null, komada: 2 }] })],
  });
  assert.deepEqual(stavke, [{ materijalId: "m-vise", kolicina: "", po: { 0: "4", 1: "2" } }]);
  assert.equal(napomene.length, 1);
  assert.match(napomene[0], /6000 mm — rezervirano 5 kom, na stanju samo 4/);
});

test("stavkeIzRezervacija: dužina kojoj nema traga javlja se u napomeni; ako nijedna ne postoji, stavka se preskače", () => {
  const { stavke, napomene } = stavkeIzRezervacija({
    projektId: "p1", materijali: MAT, redoviZa,
    rezervacije: [rez("r1", "p1", "m-vise", 2, { po: [{ duzinaMM: 1000, sirinaMM: null, komada: 2 }] })],
  });
  assert.deepEqual(stavke, []);
  assert.match(napomene[0], /1000 mm.*više nije na stanju/);
});

test("stavkeIzRezervacija: višedužinski materijal bez razrade dužina u rezervaciji — prazna stavka i napomena", () => {
  const { stavke, napomene } = stavkeIzRezervacija({ projektId: "p1", rezervacije: [rez("r1", "p1", "m-vise", 3)], materijali: MAT, redoviZa });
  assert.deepEqual(stavke, [{ materijalId: "m-vise", kolicina: "", po: {} }]);
  assert.match(napomene[0], /ne određuje dužine/);
});

test("stavkeIzRezervacija: tuđe rezervacije se ne dotiču", () => {
  const { stavke } = stavkeIzRezervacija({ projektId: "p1", rezervacije: [rez("r1", "p2", "m-1", 4)], materijali: MAT, redoviZa });
  assert.deepEqual(stavke, []);
});

test("pregledZaIzdavanje: razvrstava projekte u zaIzdati / zatvoreni / bezMaterijala", () => {
  const projekti = [
    { id: "a", sifra: "RN 170-307", naziv: "A", status: "U izradi" },
    { id: "b", sifra: "RN 01-33", naziv: "B", status: "Odobren" },
    { id: "c", sifra: "RN 170-329", naziv: "C", status: "Arhiviran" },
    { id: "d", sifra: "RN 60-107", naziv: "D", status: "Ponuda" },
    { id: "e", sifra: "RN 170-298", naziv: "E", status: "U izradi" },
    { id: "f", sifra: "RN 150-43", naziv: "F", status: "U izradi" },
    { id: "g", sifra: "RN 170-208", naziv: "G", status: "Montaža" },
    { id: "h", sifra: "RN 40-04-35", naziv: "H", status: "Otkazan" },
  ];
  const rezervacije = [
    rez("r1", "a", "m-1", 4), rez("r2", "a", "m-kg", 9), rez("r3", "b", "m-1", 1),
    rez("r4", "c", "m-1", 2), rez("r5", "d", "m-1", 2), rez("r6", "h", "m-1", 1), rez("r7", "x", "m-1", 1),
  ];
  const izdatnice = [{ id: "i1", projektId: "e" }];
  const p = pregledZaIzdavanje({ projekti, rezervacije, izdatnice, materijali: MAT });
  assert.deepEqual(p.zaIzdati.map((x) => x.projekt.id), ["a", "b"]); // a ima više stavki
  assert.equal(p.zaIzdati[0].manjak, true); // Žica: rezervirano 9, na stanju 5
  assert.equal(p.zaIzdati[1].manjak, false);
  assert.deepEqual(p.zatvoreni.map((x) => x.projekt.id).sort(), ["c", "h", "x"]);
  assert.equal(p.zatvoreni.find((x) => x.projekt.id === "x").projekt.naziv, "projekt više ne postoji");
  // projekt U IZRADI bez izdatnice i bez rezervacije: samo f; e ima izdatnicu, a ima rezervaciju, g je u Montaži, d (Ponuda) se ignorira
  assert.deepEqual(p.bezMaterijala.map((x) => x.projekt.id), ["f"]);
});

test("pregledZaIzdavanje: stavka nosi stanje i oznaku manjka; materijal koji ne postoji je manjak", () => {
  const p = pregledZaIzdavanje({
    projekti: [{ id: "a", sifra: "RN 1", naziv: "A", status: "U izradi" }],
    rezervacije: [rez("r1", "a", "m-1", 4), rez("r2", "a", "m-nema", 1)], izdatnice: [], materijali: MAT,
  });
  const s = p.zaIzdati[0].stavke;
  assert.equal(s.find((x) => x.materijalId === "m-1").naStanju, 10);
  assert.equal(s.find((x) => x.materijalId === "m-1").manjak, false);
  assert.equal(s.find((x) => x.materijalId === "m-nema").manjak, true);
});

test("ukloniRezervacije: miče samo zadane", () => {
  assert.deepEqual(ukloniRezervacije([{ id: "r1" }, { id: "r2" }, { id: "r3" }], ["r1", "r3"]), [{ id: "r2" }]);
});

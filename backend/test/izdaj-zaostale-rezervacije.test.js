// Jednokratno izdavanje rezerviranog materijala arhiviranih projekata: samo čista funkcija, bez baze.
// Pokretanje: `node test/izdaj-zaostale-rezervacije.test.js` (ulazi i u `npm test`).
const assert = require("assert");
const { izdajZaostale } = require("../izdaj-zaostale-rezervacije-2026-11");

const projekti = [
  { id: "pa", sifra: "RN 1-1", naziv: "Arhiviran A", status: "Arhiviran" },
  { id: "pb", sifra: "RN 1-2", naziv: "Arhiviran B", status: "Arhiviran" },
  { id: "pu", sifra: "RN 1-3", naziv: "U izradi", status: "U izradi" },
];
const materijali = [
  { id: "m-profil", sifra: "10007701", naziv: "IPE 160", jm: "kom", kolicina: 2, dimenzije: "6000 mm", cijena: 100 },
  { id: "m-lim", sifra: "20000924", naziv: "Lim 8 mm", jm: "kom", kolicina: 5, dimenzije: "3000×1500 mm × 3; 2000×1000 mm × 2", cijena: 50 },
  { id: "m-dup", sifra: "11003407", naziv: "Kvadratna cijev 40×40×5", jm: "kom", kolicina: 14, dimenzije: "12000 mm", cijena: 70 },
  { id: "m-krivo", sifra: "11007801", naziv: "Kvadratna cijev 80×80×4", jm: "kom", kolicina: 20, dimenzije: "6000 mm × 6; 6000 mm × 139", cijena: 60 },
];
const maticnaKnjiga = [
  { id: "mb1", broj: 3723, materijalId: "m-profil", narudzbenicaId: "n1", kolicinaPrimljeno: 2, dimenzije: "6000 mm" },
  { id: "mb2", broj: 3764, materijalId: "m-lim", narudzbenicaId: "n2", kolicinaPrimljeno: 3, dimenzije: "3000 × 1500 mm" },
  { id: "mb3", broj: 3765, materijalId: "m-lim", narudzbenicaId: "n2", kolicinaPrimljeno: 2, dimenzije: "2000 × 1000 mm" },
  { id: "mb4", broj: 3784, materijalId: "m-dup", narudzbenicaId: "n3", kolicinaPrimljeno: 7, dimenzije: "12000 mm" },
  { id: "mb5", broj: 3727, materijalId: "m-krivo", narudzbenicaId: "n4", kolicinaPrimljeno: 6, dimenzije: "6000 mm" },
];
const rezervacije = [
  { id: "r1", projektId: "pa", materijalId: "m-profil", kolicina: 2, narudzbenicaId: "n1" },
  { id: "r2", projektId: "pa", materijalId: "m-lim", kolicina: 3, narudzbenicaId: "n2" },
  { id: "r3", projektId: "pa", materijalId: "m-lim", kolicina: 2, narudzbenicaId: "n2" },
  { id: "r4", projektId: "pb", materijalId: "m-dup", kolicina: 7, narudzbenicaId: "n3" },
  { id: "r5", projektId: "pb", materijalId: "m-dup", kolicina: 7, narudzbenicaId: "n3" }, // udvostručena rezervacija
  { id: "r6", projektId: "pb", materijalId: "m-krivo", kolicina: 6, narudzbenicaId: "n4" },
  { id: "r7", projektId: "pu", materijalId: "m-profil", kolicina: 1 }, // projekt u izradi — ne dira se
];
const izdatnice = [{ id: "i0", broj: "IZD-2026-007", datum: "2026-10-21", projektId: "pu", status: "Zatvoreno", stavke: [] }];
const ulaz = JSON.stringify({ projekti, materijali, maticnaKnjiga, rezervacije, izdatnice });
const stanje = () => JSON.parse(ulaz);

const r = izdajZaostale(stanje(), { sifre: new Set(["RN 1-2", "RN 1-1"]), danas: "2026-11-19" });

// izdatnice: po jedna po projektu, brojevi nastavljaju postojeće, redom po šifri projekta
assert.deepStrictEqual(r.izdatnice.slice(1).map((i) => [i.broj, i.projektId, i.status]), [["IZD-2026-008", "pa", "Izdano"], ["IZD-2026-009", "pb", "Izdano"]]);
const ia = r.izdatnice[1];
assert.strictEqual(ia.stavke.length, 2);
const profil = ia.stavke.find((s) => s.materijalId === "m-profil");
assert.deepStrictEqual(profil.matBrojevi, [{ maticniId: "mb1", broj: 3723, kolicina: 2 }]);
assert.strictEqual(profil.kolicinaIzdano, 2);
assert.strictEqual(profil.cijena, 100, "cijena u trenutku izdavanja");

// materijal s više formata: izdano 3+2 iz dva lota, svaki oduzet od svojeg formata, popis dimenzija prazan
const lim = ia.stavke.find((s) => s.materijalId === "m-lim");
assert.deepStrictEqual(lim.matBrojevi.map((a) => [a.broj, a.kolicina]), [[3764, 3], [3765, 2]]);
assert.deepStrictEqual(lim.izdanoRedovi, [{ duzinaMM: 3000, sirinaMM: 1500, komada: 3 }, { duzinaMM: 2000, sirinaMM: 1000, komada: 2 }]);
assert.strictEqual(lim.dimenzije, "3000×1500 mm × 3; 2000×1000 mm × 2");
assert.strictEqual(r.materijali.find((m) => m.id === "m-lim").kolicina, 0);
assert.strictEqual(r.materijali.find((m) => m.id === "m-lim").dimenzije, "");
assert.strictEqual(r.materijali.find((m) => m.id === "m-profil").kolicina, 0);
assert.strictEqual(r.materijali.find((m) => m.id === "m-profil").dimenzije, "6000 mm", "materijal s jednom dužinom: dimenzije ostaju");

// udvostručena rezervacija: izdaje se samo ono što pokrivaju matični brojevi (7 od 14), ostatak rezervacije ostaje, uz upozorenje
const ib = r.izdatnice[2];
const dup = ib.stavke.find((s) => s.materijalId === "m-dup");
assert.strictEqual(dup.kolicinaIzdano, 7);
assert.deepStrictEqual(dup.matBrojevi, [{ maticniId: "mb4", broj: 3784, kolicina: 7 }]);
assert.strictEqual(r.materijali.find((m) => m.id === "m-dup").kolicina, 7);
assert.deepStrictEqual(r.rezervacije.filter((x) => x.materijalId === "m-dup").map((x) => [x.id, x.kolicina]), [["r5", 7]], "prva rezervacija potrošena, udvostručena ostaje");
assert.ok(r.izvjestaj[1].upozorenja.some((u) => /nije pokriveno matičnim brojem/.test(u)));

// popis dimenzija s dva retka iste dužine (nedosljedan unos): izdani komadi skidaju se s prvog retka, ostaje čist zapis
const krivo = ib.stavke.find((s) => s.materijalId === "m-krivo");
assert.strictEqual(krivo.kolicinaIzdano, 6);
assert.strictEqual(r.materijali.find((m) => m.id === "m-krivo").kolicina, 14);
assert.strictEqual(r.materijali.find((m) => m.id === "m-krivo").dimenzije, "6000 mm");

// rezervacije: potrošene za arhivirane, projekt u izradi netaknut
assert.deepStrictEqual(r.rezervacije.map((x) => x.id).sort(), ["r5", "r7"]);
// ulaz se ne mijenja
const orig = stanje();
assert.strictEqual(JSON.stringify(orig.rezervacije), JSON.stringify(rezervacije));
assert.strictEqual(orig.materijali.find((m) => m.id === "m-lim").kolicina, 5);

// drugo pokretanje nad rezultatom ne izdaje isto još jednom (idempotentno za izdano; ostaje samo udvostručeno)
const opet = izdajZaostale({ projekti, materijali: r.materijali, maticnaKnjiga, rezervacije: r.rezervacije, izdatnice: r.izdatnice }, { sifre: new Set(["RN 1-1", "RN 1-2"]), danas: "2026-11-19" });
assert.strictEqual(opet.izdatnice.length, r.izdatnice.length, "nema novih izdatnica");
assert.strictEqual(opet.izvjestaj[0].broj, null);

// zaštite: projekt koji nije arhiviran ili ne postoji, prazan popis
assert.throws(() => izdajZaostale(stanje(), { sifre: new Set(["RN 1-3"]), danas: "2026-11-19" }), /nije Arhiviran/);
assert.throws(() => izdajZaostale(stanje(), { sifre: new Set(["RN 9-9"]), danas: "2026-11-19" }), /Nepoznat projekt/);
assert.throws(() => izdajZaostale(stanje(), { sifre: new Set(), danas: "2026-11-19" }), /Navedi projekte/);
console.log("izdaj-zaostale-rezervacije: svi testovi prolaze");

// Jednokratno izdavanje materijala naručenog za projekt (projekt na stavci ili u tekstu upita): samo čista funkcija, bez baze.
// Pokretanje: `node test/izdaj-naruceno-za-projekt.test.js` (ulazi i u `npm test`).
const assert = require("assert");
const { izdajNarucenoZaProjekt, projektiIzTeksta } = require("../izdaj-naruceno-za-projekt-2026-11");

const projekti = [
  { id: "pA", sifra: "RN 150-43", naziv: "Aktivni A", status: "U izradi" },
  { id: "pB", sifra: "RN 170-307", naziv: "Aktivni B", status: "U izradi" },
  { id: "pC", sifra: "RN 170-321", naziv: "Arh C", status: "Arhiviran" },
  { id: "pD", sifra: "RN 170-322", naziv: "Arh D", status: "Arhiviran" },
  { id: "pE", sifra: "RN 180-71", naziv: "Akt E", status: "U izradi" },
  { id: "pF", sifra: "RN 180-72", naziv: "Arh F", status: "Arhiviran" },
];
const poSifri = new Map(projekti.map((p) => [p.sifra.toLowerCase().replace(/^rn\s*/, "").replace(/\s+/g, ""), p]));
assert.deepStrictEqual(projektiIzTeksta("RN150-43", poSifri).map((p) => p.id), ["pA"]);
assert.deepStrictEqual(projektiIzTeksta("Za projekt RN 170-307", poSifri).map((p) => p.id), ["pB"]);
assert.deepStrictEqual(projektiIzTeksta("RN 170-321 i RN 170-322", poSifri).map((p) => p.id), ["pC", "pD"]);
assert.deepStrictEqual(projektiIzTeksta("RN 180-71-72", poSifri).map((p) => p.id), ["pE", "pF"], "raspon");

const materijali = [
  { id: "m10", sifra: "20001001", naziv: "Lim 10 mm", jm: "kom", kolicina: 5, dimenzije: "3000×1500 mm × 5", cijena: 300 },
  { id: "mc", sifra: "11006001", naziv: "Kvadratna cijev 60×60×4", jm: "kom", kolicina: 4, dimenzije: "6000 mm", cijena: 40 },
  { id: "ml", sifra: "20000211", naziv: "Lim 1.5 mm", jm: "kom", kolicina: 10, dimenzije: "2500×1250 mm", cijena: 30 },
];
const upitiNabave = [{ id: "u1", broj: "26-1", stavke: [] }];
const narudzbenice = [
  // stara narudžbenica za RN 170-307 (projekt na stavci): 3 lima — stanje je ručno već smanjeno, pa je to samo trošak
  { id: "n1", broj: "NAR-1", status: "Primljeno", zaprimljeno: "2026-10-13", stavke: [{ materijalId: "m10", kolicina: 3, komada: 3, nacinUnosa: "lim", projektId: "pB" }] },
  // nova narudžbenica iz upita, projekt samo u tekstu: 5 limova za RN 150-43 (na stanju)
  { id: "n2", broj: "NAR-2", status: "Primljeno", zaprimljeno: "2026-11-17", izvorUpitaId: "u1", stavke: [{ materijalId: "m10", kolicina: 5 }], stavkeUpita: [{ dodatniZahtjevi: "RN150-43" }] },
  // za dva arhivirana projekta → prvom; cijev
  { id: "n3", broj: "NAR-3", status: "Primljeno", zaprimljeno: "2026-10-15", izvorUpitaId: "u1", stavke: [{ materijalId: "mc", kolicina: 4 }], stavkeUpita: [{ dodatniZahtjevi: "RN 170-321 i RN 170-322" }] },
  // raspon s aktivnim projektom → preskače se
  { id: "n4", broj: "NAR-4", status: "Primljeno", zaprimljeno: "2026-10-30", izvorUpitaId: "u1", stavke: [{ materijalId: "ml", kolicina: 10 }], stavkeUpita: [{ dodatniZahtjevi: "RN 180-71-72" }] },
  // nije zaprimljeno kroz "Primi robu" (nema matičnog broja) → preskače se tiho
  { id: "n5", broj: "NAR-5", status: "Primljeno", stavke: [{ materijalId: "mc", kolicina: 9, projektId: "pA" }] },
];
const maticnaKnjiga = [
  { id: "l1", broj: 3700, materijalId: "m10", narudzbenicaId: "n1", kolicinaPrimljeno: 3, dimenzije: "3000 × 1500 mm" },
  { id: "l2", broj: 3800, materijalId: "m10", narudzbenicaId: "n2", kolicinaPrimljeno: 5, dimenzije: "3000 × 1500 mm" },
  { id: "l3", broj: 3750, materijalId: "mc", narudzbenicaId: "n3", kolicinaPrimljeno: 4, dimenzije: "6000 mm" },
  { id: "l4", broj: 3790, materijalId: "ml", narudzbenicaId: "n4", kolicinaPrimljeno: 10, dimenzije: "2500 × 1250 mm" },
];
const izdatnice = [{ id: "i0", broj: "IZD-2026-020", projektId: "pB", status: "Izdano", stavke: [] }];
const ulaz = JSON.stringify({ projekti, materijali, maticnaKnjiga, narudzbenice, upitiNabave, izdatnice, rezervacije: [], programiRezanja: [], radniNalozi: [] });
const stanje = () => JSON.parse(ulaz);

const r = izdajNarucenoZaProjekt(stanje(), { danas: "2026-11-25", preskoci: [] });
const nove = r.izdatnice.slice(1);
// aktivni prvi (po šifri), zatim zatvoreni; brojevi nastavljaju
assert.deepStrictEqual(nove.map((i) => [i.broj, i.projektId]), [["IZD-2026-021", "pA"], ["IZD-2026-022", "pB"], ["IZD-2026-023", "pC"]]);
// RN 150-43: 5 limova sa stanja, vlastiti lot
const a = nove[0].stavke[0];
assert.strictEqual(a.kolicinaIzdano, 5);
assert.deepStrictEqual(a.matBrojevi, [{ maticniId: "l2", broj: 3800, kolicina: 5 }]);
assert.strictEqual(a.bezSkidanjaStanja, undefined);
// RN 170-307: 3 lima samo trošak (stanje 5 pokriva samo najnoviji zahtjev), vlastiti lot l1 (ne tuđi l2)
const b = nove[1].stavke[0];
assert.strictEqual(b.kolicinaIzdano, 3);
assert.strictEqual(b.bezSkidanjaStanja, 3);
assert.deepStrictEqual(b.matBrojevi.map((x) => x.maticniId), ["l1"]);
assert.ok(/Samo trošak/.test(nove[1].napomena));
// stanje lima: 5 − 5 (samo dio na stanju); jedan format s brojem komada → ostaje samo format
const m10 = r.materijali.find((m) => m.id === "m10");
assert.strictEqual(m10.kolicina, 0);
assert.strictEqual(m10.dimenzije, "3000×1500 mm");
// dva arhivirana projekta → prvi, napomena navodi oba i "utrošeno"
assert.strictEqual(nove[2].stavke[0].kolicinaIzdano, 4);
assert.ok(/RN 170-321 i RN 170-322/.test(nove[2].napomena) && /utrošeno/.test(nove[2].napomena));
assert.strictEqual(r.materijali.find((m) => m.id === "mc").kolicina, 0);
// raspon s aktivnim projektom: preskočeno, stanje netaknuto
assert.ok(r.preskoceno.some((z) => z.nar === "NAR-4" && /treba odluka/.test(z.razlog)));
assert.strictEqual(r.materijali.find((m) => m.id === "ml").kolicina, 10);
// ulaz se ne mijenja
assert.strictEqual(stanje().materijali.find((m) => m.id === "m10").kolicina, 5);
// drugo pokretanje nad rezultatom ništa ne izdaje (idempotentno)
const opet = izdajNarucenoZaProjekt({ ...stanje(), materijali: r.materijali, izdatnice: r.izdatnice }, { danas: "2026-11-25", preskoci: [] });
assert.strictEqual(opet.izdatnice.length, r.izdatnice.length, "nema novih izdatnica");
console.log("izdaj-naruceno-za-projekt: svi testovi prolaze");

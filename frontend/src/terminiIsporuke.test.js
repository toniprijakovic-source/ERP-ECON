import test from "node:test";
import assert from "node:assert/strict";
import { imaTermine, rokIzTermina, stavkeNarudzbi, isporucenoPoStavciNarudzbe, stanjaTermina, sljedeciTermin, projektSEfektivnimRokom, rokoviDijelova, posloviPoTerminima, redoviKalendara, grupirajPoTjednima, pocetakTjedna } from "./terminiIsporuke.js";

// RN 170-332 u malom: jedna narudžba, tri stavke (44 + 22 + 22 komada), dva termina; stavka A se dijeli 22 + 22.
const narudzbe = [{ id: "n1", broj: "NAROČILO 26/668", projektId: "p1", stavke: [
  { id: "sA", naziv: "Cijev A", sifra: "TP138", jm: "Stk", kolicina: 44, masaJed: 400, cijena: 100 },
  { id: "sB", naziv: "Cijev B", sifra: "TP144", jm: "Stk", kolicina: 22, masaJed: 300, cijena: 90 },
  { id: "sC", naziv: "Cijev C", sifra: "TP151", jm: "Stk", kolicina: 22, masaJed: 300, cijena: 90 },
] }, { id: "n2", broj: "druga", projektId: "drugi", stavke: [{ id: "tuđa", naziv: "X", kolicina: 5 }] }];
const projekt = () => ({ id: "p1", sifra: "RN 170-332", naziv: "Laser", status: "U izradi", rokZavrsetka: "2026-12-21", termini: [
  { id: "t2", datum: "2026-12-08", naziv: "Ostatak", stavke: [{ narudzbaStavkaId: "sA", komada: 22 }, { narudzbaStavkaId: "sC", komada: 22 }] },
  { id: "t1", datum: "2026-11-30", naziv: "Prvi dio", stavke: [{ narudzbaStavkaId: "sA", komada: 22 }, { narudzbaStavkaId: "sB", komada: 22 }] },
] });
const otp = (stavke, extra = {}) => ({ id: "o" + Math.random(), projektId: "p1", datum: "2026-11-28", stavke, ...extra });

test("imaTermine i rok iz termina", () => {
  assert.equal(imaTermine({}), false);
  assert.equal(imaTermine({ termini: [] }), false);
  assert.equal(imaTermine(projekt()), true);
  assert.equal(rokIzTermina(projekt().termini), "2026-12-08");
  assert.equal(rokIzTermina([]), null);
  assert.equal(rokIzTermina([{ datum: "" }]), null);
});

test("stavke narudžbi: samo narudžbe projekta", () => {
  assert.deepEqual(stavkeNarudzbi("p1", narudzbe).map((s) => s.id), ["sA", "sB", "sC"]);
  assert.equal(stavkeNarudzbi("p1", narudzbe)[0].narudzbaBroj, "NAROČILO 26/668");
});

test("isporučeno po stavci: po id-u, inače po nazivu; kooperant i tuđe otpremnice se ne broje", () => {
  const m = isporucenoPoStavciNarudzbe("p1", narudzbe, [
    otp([{ narudzbaStavkaId: "sA", kolicina: 10 }]),
    otp([{ naziv: "Cijev A", kolicina: 5 }]),
    otp([{ narudzbaStavkaId: "sB", kolicina: 3 }], { vrsta: "kooperant" }),
    { id: "x", projektId: "drugi", stavke: [{ narudzbaStavkaId: "tuđa", kolicina: 4 }] },
    otp([{ narudzbaStavkaId: "sC", kolicina: 0 }]),
  ]);
  assert.equal(m.get("sA"), 15);
  assert.equal(m.has("sB"), false);
  assert.equal(m.has("sC"), false);
});

test("stanja termina: sortirano po datumu, isporuka se raspoređuje kronološki, status i posto", () => {
  const s = stanjaTermina({ projekt: projekt(), narudzbe, otpremnice: [otp([{ narudzbaStavkaId: "sA", kolicina: 30 }])], danas: "2026-11-25" });
  assert.deepEqual(s.termini.map((t) => t.termin.id), ["t1", "t2"]);
  const t1 = s.termini[0], t2 = s.termini[1];
  assert.equal(t1.redovi.find((r) => r.stavkaId === "sA").isporuceno, 22, "prvi termin je prvi popunjen");
  assert.equal(t2.redovi.find((r) => r.stavkaId === "sA").isporuceno, 8, "ostatak 8 ide u drugi termin");
  assert.equal(t1.status, "djelomicno");
  assert.equal(t2.status, "djelomicno");
  assert.equal(t1.planirano, 44);
  assert.equal(t1.isporuceno, 22);
  assert.equal(t1.posto, 50);
  assert.equal(t1.dana, 5);
  assert.equal(t1.masa, 22 * 400 + 22 * 300);
});

test("status termina: isporučeno / kasni / čeka; prošao datum i nije gotov = kasni", () => {
  const potpuno = otp([{ narudzbaStavkaId: "sA", kolicina: 22 }, { narudzbaStavkaId: "sB", kolicina: 22 }]);
  let s = stanjaTermina({ projekt: projekt(), narudzbe, otpremnice: [potpuno], danas: "2026-12-01" });
  assert.equal(s.termini[0].status, "isporuceno", "gotov termin se ne označava kao kasni ni kad je datum prošao");
  assert.equal(s.termini[1].status, "ceka");
  s = stanjaTermina({ projekt: projekt(), narudzbe, otpremnice: [], danas: "2026-12-01" });
  assert.equal(s.termini[0].status, "kasni");
  assert.equal(s.termini[0].dana, -1);
  assert.equal(sljedeciTermin(s).termin.id, "t1");
  s = stanjaTermina({ projekt: projekt(), narudzbe, otpremnice: [potpuno, otp([{ narudzbaStavkaId: "sA", kolicina: 22 }, { narudzbaStavkaId: "sC", kolicina: 22 }])], danas: "2026-12-01" });
  assert.deepEqual(s.termini.map((t) => t.status), ["isporuceno", "isporuceno"]);
  assert.equal(sljedeciTermin(s).termin.id, "t2", "kad je sve isporučeno, zadnji termin");
});

test("stavke bez termina i prekoračenje", () => {
  const p = projekt();
  p.termini[1].stavke = [{ narudzbaStavkaId: "sA", komada: 30 }]; // t1: A×30 (uz A×22 u t2 ukupno 52 > 44), B izostavljen
  const s = stanjaTermina({ projekt: p, narudzbe, otpremnice: [], danas: "2026-11-21" });
  assert.deepEqual(s.bezTermina.map((x) => [x.stavka.id, x.kolicina]), [["sB", 22]]);
  assert.deepEqual(s.prekoraceno.map((x) => [x.stavka.id, x.visak]), [["sA", 8]]);
  // isporučeno a bez termina se ne prikazuje kao "bez termina"
  const s2 = stanjaTermina({ projekt: p, narudzbe, otpremnice: [otp([{ narudzbaStavkaId: "sB", kolicina: 22 }])], danas: "2026-11-21" });
  assert.equal(s2.bezTermina.length, 0);
});

test("termin bez stavki: ručna oznaka isporučeno", () => {
  const p = { id: "p9", termini: [{ id: "a", datum: "2026-12-01", naziv: "Komplet" }, { id: "b", datum: "2026-12-10", naziv: "Ostalo", rucnoIsporuceno: true }] };
  const s = stanjaTermina({ projekt: p, narudzbe: [], otpremnice: [], danas: "2026-11-21" });
  assert.deepEqual(s.termini.map((t) => t.status), ["ceka", "isporuceno"]);
  assert.equal(s.termini[1].posto, 100);
});

test("efektivni rok projekta za preglede: rok sljedećeg neisporučenog termina, stvarni rok ostaje", () => {
  const p = projekt();
  const e = projektSEfektivnimRokom(p, narudzbe, [], "2026-11-21");
  assert.equal(e.rokZavrsetka, "2026-11-30");
  assert.equal(e.rokProjekta, "2026-12-21");
  assert.deepEqual([e.sljedeciTermin.redni, e.sljedeciTermin.ukupno, e.sljedeciTermin.status], [1, 2, "ceka"]);
  const kad = projektSEfektivnimRokom(p, narudzbe, [otp([{ narudzbaStavkaId: "sA", kolicina: 22 }, { narudzbaStavkaId: "sB", kolicina: 22 }])], "2026-12-01");
  assert.equal(kad.rokZavrsetka, "2026-12-08", "prvi termin isporučen → sljedeći je drugi");
  const bez = { id: "p2", rokZavrsetka: "2026-12-01" };
  assert.equal(projektSEfektivnimRokom(bez, narudzbe, [], "2026-11-21"), bez, "projekt bez termina ostaje isti objekt");
  assert.equal(p.rokZavrsetka, "2026-12-21", "ulaz se ne mijenja");
});

test("efektivni rok bez podataka o isporuci: prvi termin od danas nadalje, prošli ne kasne", () => {
  const p = projekt();
  assert.equal(projektSEfektivnimRokom(p, [], [], "2026-12-01", { bezPodatakaOIsporuci: true }).rokZavrsetka, "2026-12-08", "30.11. je prošao → sljedeći je 8.12.");
  assert.equal(projektSEfektivnimRokom(p, [], [], "2026-11-21", { bezPodatakaOIsporuci: true }).rokZavrsetka, "2026-11-30");
  assert.equal(projektSEfektivnimRokom(p, [], [], "2026-12-20", { bezPodatakaOIsporuci: true }).rokZavrsetka, "2026-12-08", "svi prošli → zadnji");
});

test("rokovi dijelova povezani s dodacima", () => {
  const m = rokoviDijelova({ termini: [{ id: "1", datum: "2026-11-16", dio: "dod-1" }, { id: "2", datum: "2026-11-25", dio: "osnovna" }, { id: "3", datum: "2026-12-01" }, { id: "4", datum: "2026-11-20", dio: "dod-1" }] });
  assert.equal(m.get("dod-1"), "2026-11-20", "više termina istog dijela: najkasniji");
  assert.equal(m.get("osnovna"), "2026-11-25");
  assert.equal(m.size, 2);
});

test("plan: nalozi se dijele na otvorene termine razmjerno masi neisporučenog dijela", () => {
  const stanja = stanjaTermina({ projekt: projekt(), narudzbe, otpremnice: [], danas: "2026-11-21" });
  // t1: 22×400 + 22×300 = 15400, t2: 22×400 + 22×300 = 15400 → pola-pola
  const poslovi = posloviPoTerminima({ stanja, nalozi: [{ id: "n1", broj: "RN 170-332/1", faza: "Laser za profile", planiranoSati: 70, utrosenoSati: 10, status: "Planiran" }] });
  assert.deepEqual(poslovi.map((p) => p.terminId), ["t1", "t2"]);
  assert.deepEqual(poslovi.map((p) => p.nalozi[0].plan), [35, 35]);
  assert.deepEqual(poslovi.map((p) => p.nalozi[0].utroseno), [5, 5]);
  assert.deepEqual(poslovi.map((p) => p.nalozi[0].id), ["n1|t1", "n1|t2"]);
  assert.equal(poslovi[0].datum, "2026-11-30");
});

test("plan: nejednaka težina, isporučeni termin ispada, dodijeljen nalog ide cijeli u svoj termin", () => {
  const p = projekt();
  p.termini[0].stavke = [{ narudzbaStavkaId: "sA", komada: 44 }]; // t2 (kasniji datum) = 44×... mijenjamo: t1 → t2 po datumu
  const stanja = stanjaTermina({ projekt: p, narudzbe, otpremnice: [], danas: "2026-11-21" });
  const tez = stanja.termini.map((t) => t.tezinaOtvorena);
  const poslovi = posloviPoTerminima({ stanja, nalozi: [{ id: "n1", broj: "1", faza: "Pila", planiranoSati: 100, utrosenoSati: 0, status: "Planiran" }, { id: "n2", broj: "2", faza: "Zavarivanje", planiranoSati: 40, utrosenoSati: 0, status: "Planiran", terminId: "t2" }] });
  const sati = (terminId) => poslovi.find((x) => x.terminId === terminId).nalozi.filter((n) => n.id.startsWith("n1")).reduce((a, n) => a + n.plan, 0);
  assert.ok(Math.abs(sati("t1") + sati("t2") - 100) < 0.01, "ukupno se ne gubi");
  assert.ok(Math.abs(sati("t1") / 100 - tez[0] / (tez[0] + tez[1])) < 0.01, "udio prema težini");
  assert.ok(poslovi.find((x) => x.terminId === "t2").nalozi.some((n) => n.id === "n2" && n.plan === 40), "dodijeljen nalog cijeli u t2");
  assert.ok(!poslovi.find((x) => x.terminId === "t1").nalozi.some((n) => n.id === "n2"));
  // prvi termin isporučen → sve ostaje u drugom
  const isp = stanjaTermina({ projekt: projekt(), narudzbe, otpremnice: [otp([{ narudzbaStavkaId: "sA", kolicina: 22 }, { narudzbaStavkaId: "sB", kolicina: 22 }])], danas: "2026-12-01" });
  const ostalo = posloviPoTerminima({ stanja: isp, nalozi: [{ id: "n1", broj: "1", faza: "Pila", planiranoSati: 20, utrosenoSati: 0, status: "Planiran" }] });
  assert.deepEqual(ostalo.map((x) => [x.terminId, x.nalozi[0].id, x.nalozi[0].plan]), [["t2", "n1", 20]]);
  assert.deepEqual(posloviPoTerminima({ stanja: { termini: [] }, nalozi: [] }), []);
});

test("plan: termini bez stavki dijele nalog jednako", () => {
  const p = { id: "p9", termini: [{ id: "a", datum: "2026-12-01" }, { id: "b", datum: "2026-12-10" }] };
  const poslovi = posloviPoTerminima({ stanja: stanjaTermina({ projekt: p, narudzbe: [], otpremnice: [], danas: "2026-11-21" }), nalozi: [{ id: "n", broj: "1", faza: "Pila", planiranoSati: 10, utrosenoSati: 0, status: "Planiran" }] });
  assert.deepEqual(poslovi.map((x) => x.nalozi[0].plan), [5, 5]);
});

test("tjedan počinje ponedjeljkom", () => {
  assert.equal(pocetakTjedna("2026-11-30"), "2026-11-30");
  assert.equal(pocetakTjedna("2026-12-06"), "2026-11-30");
  assert.equal(pocetakTjedna("2026-12-08"), "2026-12-07");
});

test("kalendar isporuka: termini, kupaonice, rok projekta; samo aktivni projekti; poredak po datumu", () => {
  const projekti = [
    projekt(),
    { id: "p3", sifra: "RN 180-1", naziv: "Kupaonice", status: "U izradi", koristiNormativ: true, isporuke: [{ komada: 3, datum: "2026-12-02", isporuceno: false }, { komada: 2, datum: "2026-12-02", isporuceno: true }, { komada: 4, datum: "2026-11-10", isporuceno: true }] },
    { id: "p4", sifra: "RN 150-1", naziv: "Bez termina", status: "Odobren", rokZavrsetka: "2026-11-20" },
    { id: "p5", sifra: "RN 1-1", naziv: "Arhiviran", status: "Arhiviran", rokZavrsetka: "2026-11-25" },
    { id: "p6", sifra: "RN 2-2", naziv: "Ponuda", status: "Ponuda", rokZavrsetka: "2026-11-25" },
  ];
  const r = redoviKalendara({ projekti, narudzbe, otpremnice: [], danas: "2026-11-21" });
  assert.deepEqual(r.map((x) => [x.sifra, x.datum, x.izvor, x.status]), [
    ["RN 180-1", "2026-11-10", "kupaonice", "isporuceno"],
    ["RN 150-1", "2026-11-20", "rok", "kasni"],
    ["RN 170-332", "2026-11-30", "termin", "ceka"],
    ["RN 180-1", "2026-12-02", "kupaonice", "djelomicno"],
    ["RN 170-332", "2026-12-08", "termin", "ceka"],
  ]);
  const t = r.find((x) => x.izvor === "termin");
  assert.equal(t.opis, "TP138 × 22, TP144 × 22");
  assert.deepEqual([t.redni, t.ukupno, t.planirano, t.nazivTermina], [1, 2, 44, "Prvi dio"]);
  const tjedni = grupirajPoTjednima(r);
  assert.deepEqual(tjedni.map((x) => x.pocetak), ["2026-11-09", "2026-11-16", "2026-11-30", "2026-12-07"].filter((d) => d !== "2026-12-07").concat(["2026-12-07"]).sort());
  assert.equal(tjedni.find((x) => x.pocetak === "2026-11-30").redovi.length, 2, "30.11. i 2.12. u istom tjednu");
  assert.equal(tjedni[0].kraj, "2026-11-15");
});

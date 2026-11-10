// Provjere kontrole otpremnica tipskih projekata (komad ne smije na dvije otpremnice, količina ne smije biti veća od spremnog ni od naručenog). Svi podaci su izmišljeni.
import test from "node:test";
import assert from "node:assert/strict";
import { isporukeNaOtpremnicama, slobodneIsporuke, dvostrukeIsporuke, isporukeZaKolicinu, pripremiStavkeNormativa, prekoNarucenogPoNarudzbi, zbrojPoTipu, ogranicenjeTipa, pocetnaKolicina, zatvoriIsporuke, vratiZatvoreneIsporuke, visakStavke } from "./otpremniceKontrola.js";

const isp = (id, extra = {}) => ({ id, grupa: "stavkePod", stavkaId: "s1", komada: 1, datum: "2026-11-02", isporuceno: true, uOtpremniciId: null, redniBroj: Number(id.slice(1)), ...extra });
const projekt = {
  id: "p1",
  stavkePod: [{ id: "s1", oznaka: "Typ A", komada: 4 }],
  stavkeKomplet: [{ id: "k1", oznaka: "Typ B", komada: 2 }],
  isporuke: [isp("i1"), isp("i2"), isp("i3"), isp("i4"), isp("i5"), isp("i6", { isporuceno: false }), isp("k1", { grupa: "stavkeKomplet", stavkaId: "k1" })],
};
const otp = (id, ids, extra = {}) => ({ id, broj: `OTP-${id}`, datum: "2026-11-03", projektId: "p1", stavke: [{ id: `st-${id}`, naziv: "Pod — Typ A", kolicina: ids.length, isporukaIds: ids }], ...extra });
const stavka = (ids, kolicina, extra = {}) => ({ id: "f1", naziv: "Pod — Typ A", kolicina: String(kolicina), isporukaIds: ids, ...extra });

test("slobodni su samo komadi spremni za otpremu koji nisu ni na jednoj otpremnici (oznaka uOtpremniciId se ne mora podudarati)", () => {
  const otpremnice = [otp("o1", ["i1"])];
  const p = { ...projekt, isporuke: projekt.isporuke.map((i) => (i.id === "i2" ? { ...i, uOtpremniciId: "o1" } : i)) }; // i2: oznaka postoji, a nije u stavkama
  const slobodni = slobodneIsporuke(p, otpremnice).map((i) => i.id);
  assert.deepEqual(slobodni, ["i3", "i4", "i5", "k1"]); // i1 na otpremnici, i2 označen prema postojećoj otpremnici, i6 nije spreman
  // oznaka koja pokazuje na obrisanu otpremnicu ne zaključava komad
  const p2 = { ...projekt, isporuke: projekt.isporuke.map((i) => (i.id === "i2" ? { ...i, uOtpremniciId: "obrisana" } : i)) };
  assert.ok(slobodneIsporuke(p2, []).some((i) => i.id === "i2"));
});

test("komad bez oznake, ali na otpremnici (izgubljena oznaka) ne nudi se ponovno", () => {
  assert.ok(!slobodneIsporuke(projekt, [otp("o1", ["i3", "i4"])]).some((i) => ["i3", "i4"].includes(i.id)));
});

test("dvostruki komadi: nađeni s tipom i obje otpremnice, kooperantske se ne broje", () => {
  const otpremnice = [otp("o1", ["i1", "i2"]), otp("o2", ["i2", "i3"]), otp("o3", ["i1"], { vrsta: "kooperant" })];
  const d = dvostrukeIsporuke(projekt, otpremnice);
  assert.equal(d.length, 1);
  assert.equal(d[0].isporuka.id, "i2");
  assert.equal(d[0].tip, "Pod — Typ A");
  assert.deepEqual(d[0].otpremnice.map((o) => o.broj), ["OTP-o1", "OTP-o2"]);
  assert.equal(dvostrukeIsporuke(projekt, [otp("o1", ["i1"])]).length, 0);
});

test("isporukeNaOtpremnicama: komad se ne ponavlja ako je dvaput na istoj otpremnici", () => {
  const o = { id: "o1", broj: "A", stavke: [{ isporukaIds: ["i1"] }, { isporukaIds: ["i1", "i2"] }] };
  assert.equal(isporukeNaOtpremnicama([o]).get("i1").length, 1);
});

test("isporukeZaKolicinu: najranije isporuke, točan zbroj, inače null", () => {
  const isporuke = [isp("i1", { datum: "2026-11-05" }), isp("i2", { datum: "2026-11-01" }), isp("i3", { datum: "2026-11-03", komada: 2 })];
  assert.deepEqual(isporukeZaKolicinu(["i1", "i2", "i3"], isporuke, 1), ["i2"]);
  assert.deepEqual(isporukeZaKolicinu(["i1", "i2", "i3"], isporuke, 3), ["i2", "i3"]);
  assert.equal(isporukeZaKolicinu(["i1", "i2", "i3"], isporuke, 2), null); // 1 pa 2 = 3, ne može točno 2 bez razdvajanja isporuke
  assert.deepEqual(isporukeZaKolicinu(["i1", "i2", "i3"], isporuke, 4), ["i2", "i3", "i1"]);
});

test("količina veća od spremnih komada je greška, jednaka prolazi, manja skraćuje isporukaIds", () => {
  let r = pripremiStavkeNormativa([stavka(["i1", "i2"], 3)], projekt, []);
  assert.match(r.greske.f1, /Najviše 2/);
  r = pripremiStavkeNormativa([stavka(["i1", "i2"], 2)], projekt, []);
  assert.deepEqual(r.greske, {});
  assert.deepEqual(r.stavke[0].isporukaIds, ["i1", "i2"]);
  r = pripremiStavkeNormativa([stavka(["i1", "i2", "i3"], 2)], projekt, []);
  assert.deepEqual(r.greske, {});
  assert.deepEqual(r.stavke[0].isporukaIds, ["i1", "i2"]); // i3 ostaje slobodan
  r = pripremiStavkeNormativa([stavka(["i1", "i2"], 1.5)], projekt, []);
  assert.match(r.greske.f1, /cijeli broj/);
});

test("komad koji je u međuvremenu dospio na drugu otpremnicu blokira spremanje", () => {
  const r = pripremiStavkeNormativa([stavka(["i1", "i2"], 2)], projekt, [otp("o1", ["i2"])]);
  assert.match(r.greske.f1, /Komad je već na otpremnici OTP-o1/);
});

test("zbroj količina na otpremnicama po tipu ne smije premašiti naručeno — komad na dvije otpremnice troši naručeno dvaput", () => {
  // tip naručen 4; i2 je na obje otpremnice → zbroj dokumenata 4 iako su različita samo 3 komada
  const otpremnice = [otp("o1", ["i1", "i2"]), otp("o2", ["i2", "i3"])];
  let r = pripremiStavkeNormativa([stavka(["i4"], 1)], projekt, otpremnice);
  assert.match(r.greske.f1, /Naručeno 4, na otpremnicama već 4 — još najviše 0/);
  assert.match(r.greske.f1, /Od toga na dvije otpremnice: 1 komad/);
  // bez dupliciranja ista količina prolazi
  r = pripremiStavkeNormativa([stavka(["i4"], 1)], projekt, [otp("o1", ["i1", "i2"]), otp("o2", ["i3"])]);
  assert.deepEqual(r.greske, {});
  r = pripremiStavkeNormativa([stavka(["i4", "i5"], 2)], projekt, [otp("o1", ["i1", "i2"]), otp("o2", ["i3"])]);
  assert.match(r.greske.f1, /još najviše 1/);
});

test("zbrojPoTipu i ogranicenjeTipa", () => {
  const otpremnice = [otp("o1", ["i1", "i2"]), otp("o2", ["i2", "i3"])];
  const z = zbrojPoTipu(projekt, otpremnice);
  assert.deepEqual(z.get("stavkePod|s1"), { komada: 4, dupli: 1 });
  assert.equal(ogranicenjeTipa(projekt, otpremnice, "stavkePod", "s1").preostalo, 0);
  assert.equal(ogranicenjeTipa(projekt, [], "stavkePod", "s1").preostalo, 4);
  assert.equal(ogranicenjeTipa({ ...projekt, stavkePod: [{ id: "s1", oznaka: "A", komada: 0 }] }, [], "stavkePod", "s1"), null); // bez naručene količine nema ograničenja
});

test("početna količina u obrascu: spremno, ali najviše do naručenog (i složivo od cijelih isporuka)", () => {
  const otpremnice = [otp("o1", ["i1", "i2"]), otp("o2", ["i2"])]; // zbroj 3 od naručenih 4, preostaje 1
  const s = { id: "f1", isporukaIds: ["i3", "i4", "i5"], dostupno: 3 };
  assert.equal(pocetnaKolicina(s, projekt, otpremnice), 1);
  assert.equal(pocetnaKolicina(s, projekt, []), 3);
  assert.equal(pocetnaKolicina(s, projekt, [otp("o3", ["i1", "i2", "i6"])]), 1); // zbroj 3, preostaje 1
});

test("stavke bez isporukaIds (obični projekti) i prazne količine se ne diraju", () => {
  const s = { id: "f2", naziv: "Rešetka", kolicina: "99" };
  const r = pripremiStavkeNormativa([s, stavka(["i1"], 0)], projekt, []);
  assert.deepEqual(r.greske, {});
  assert.equal(r.stavke[0], s);
});

test("obični projekti: upozorenje kad količina premašuje naručeno minus već otpremljeno", () => {
  const otpremnice = [{ id: "o1", projektId: "p1", stavke: [{ narudzbaStavkaId: "n1", kolicina: 8 }] }, { id: "o2", projektId: "p2", stavke: [{ narudzbaStavkaId: "n1", kolicina: 9 }] }];
  const stavke = [{ id: "a", naziv: "Okvir", narudzbaStavkaId: "n1", narucena: 10, kolicina: "3" }, { id: "b", naziv: "Ploča", narudzbaStavkaId: "n2", narucena: 5, kolicina: "5" }];
  const u = prekoNarucenogPoNarudzbi(stavke, "p1", otpremnice);
  assert.equal(u.length, 1);
  assert.equal(u[0].stavkaId, "a");
  assert.match(u[0].poruka, /naručeno 10, već otpremljeno 8, na ovoj otpremnici 3 — ukupno 11/);
  assert.equal(prekoNarucenogPoNarudzbi([{ id: "c", narudzbaStavkaId: "n1", narucena: 10, kolicina: "2" }], "p1", otpremnice).length, 0);
});

test("zatvoreno bez otpremnice: komad se ne nudi, vraćanje ga ponovno nudi, komad na otpremnici se ne zatvara", () => {
  const zatvoreno = zatvoriIsporuke(projekt.isporuke, ["i1", "i2"], "2026-11-10");
  assert.equal(zatvoreno.find((i) => i.id === "i1").zatvorenoBezOtpremnice, true);
  assert.equal(zatvoreno.find((i) => i.id === "i1").zatvorenoDatum, "2026-11-10");
  assert.equal(projekt.isporuke.find((i) => i.id === "i1").zatvorenoBezOtpremnice, undefined); // ulaz se ne mijenja
  const p = { ...projekt, isporuke: zatvoreno };
  assert.ok(!slobodneIsporuke(p, []).some((i) => ["i1", "i2"].includes(i.id)));
  const vraceno = vratiZatvoreneIsporuke(zatvoreno, ["i1"]);
  assert.equal("zatvorenoBezOtpremnice" in vraceno.find((i) => i.id === "i1"), false);
  assert.ok(slobodneIsporuke({ ...projekt, isporuke: vraceno }, []).some((i) => i.id === "i1"));
  const naOtpremnici = zatvoriIsporuke([isp("x1", { uOtpremniciId: "o1" })], ["x1"], "2026-11-10");
  assert.equal(naOtpremnici[0].zatvorenoBezOtpremnice, undefined);
});

test("višak stavke: komadi koji ne stanu do naručenog, spremni za zatvaranje bez otpremnice", () => {
  const otpremnice = [otp("o1", ["i1", "i2"]), otp("o2", ["i2"])]; // zbroj 3 od naručenih 4 → preostaje 1
  const s = { id: "f1", isporukaIds: ["i3", "i4", "i5"], dostupno: 3 };
  const v = visakStavke(s, projekt, otpremnice);
  assert.deepEqual(v.ids, ["i4", "i5"]);
  assert.equal(v.komada, 2);
  assert.deepEqual(visakStavke(s, projekt, []), { ids: [], komada: 0 }); // sve stane
  assert.deepEqual(visakStavke(s, projekt, [otp("o1", ["i1", "i2", "i6", "i7"])]).ids, ["i3", "i4", "i5"]); // preostaje 0 → svi spremni su višak
});

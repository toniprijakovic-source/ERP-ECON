// Stanje servera: pravila upozorenja i zadaci u zvoncu (stanje-servera.js), bez baze. Pokretanje: `node test/stanje-servera.test.js` (ulazi i u `npm test`).
const assert = require("assert");
const S = require("../stanje-servera");

const SADA = Date.parse("2026-11-26T12:00:00.000Z");
const prije = (min) => new Date(SADA - min * 60000).toISOString();
const izvj = (o = {}) => ({
  pogoni: [{ slovo: "Z:", ok: true, opis: "Pogon Z: spojen" }],
  diskovi: [{ oznaka: "Z:", slobodnoGB: 500, ukupnoGB: 1000 }],
  kopije: { podeseno: true, mapa: "Z:/ECON_ERP/Kopije", dostupna: true, zadnja: { vrijeme: prije(30) }, greska: null, obnova: { ok: true, vrijeme: prije(60 * 24 * 10) } },
  ...o,
});
const kljucevi = (u) => u.map((x) => x.kljuc).sort().join(",");

// most: šuti 15 min ili kraće → nema upozorenja; dulje → samo upozorenje o mostu (stari izvještaj se ne gleda)
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(14), izvjestaj: izvj(), sada: SADA })), "");
let u = S.izracunajUpozorenja({ kontakt: prije(16), izvjestaj: izvj({ diskovi: [{ oznaka: "Z:", slobodnoGB: 1, ukupnoGB: 1000 }] }), sada: SADA });
assert.strictEqual(kljucevi(u), "most");
assert.match(u[0].tekst, /ne javlja se od/);
// most se još nikad nije javio (novi poslužitelj) → nema upozorenja; nema izvještaja → nema ostalih upozorenja
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: null, izvjestaj: null, sada: SADA })), "");

// kopija: stara više od 2 h, nema zapisa, mapa nedostupna; greška novija od zadnje kopije ulazi u tekst
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ kopije: { ...izvj().kopije, zadnja: { vrijeme: prije(119) } } }), sada: SADA })), "");
u = S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ kopije: { ...izvj().kopije, zadnja: { vrijeme: prije(181) }, greska: { vrijeme: prije(10), poruka: "Connection terminated" } } }), sada: SADA });
assert.strictEqual(kljucevi(u), "kopija");
assert.match(u[0].tekst, /prije 3 h.*Connection terminated/);
u = S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ kopije: { ...izvj().kopije, zadnja: { vrijeme: prije(181) }, greska: { vrijeme: prije(300), poruka: "stara greška" } } }), sada: SADA });
assert.doesNotMatch(u[0].tekst, /stara greška/, "greška starija od zadnje uspjele kopije se ne spominje");
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ kopije: { ...izvj().kopije, zadnja: null } }), sada: SADA })), "kopija");
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ kopije: { ...izvj().kopije, dostupna: false } }), sada: SADA })), "kopija");
// kopije nisu podešene u mostu → o kopijama se ništa ne javlja
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ kopije: { podeseno: false } }), sada: SADA })), "");

// probna obnova: neuspjela → odmah; uspjela prije više od 35 dana → upozorenje; još nije napravljena → nema upozorenja
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ kopije: { ...izvj().kopije, obnova: { ok: false, vrijeme: prije(5), greska: "x" } } }), sada: SADA })), "obnova");
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ kopije: { ...izvj().kopije, obnova: { ok: true, vrijeme: prije(60 * 24 * 36) } } }), sada: SADA })), "obnova");
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ kopije: { ...izvj().kopije, obnova: null } }), sada: SADA })), "");

// pogon i prostor (manje od 10 GB ili manje od 5 %)
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ pogoni: [{ slovo: "Z:", ok: false, opis: "subst nije uspio" }] }), sada: SADA })), "pogon");
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ diskovi: [{ oznaka: "D:", slobodnoGB: 40, ukupnoGB: 1000 }] }), sada: SADA })), "prostor");
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ diskovi: [{ oznaka: "C:", slobodnoGB: 9, ukupnoGB: 100 }] }), sada: SADA })), "prostor");
assert.strictEqual(kljucevi(S.izracunajUpozorenja({ kontakt: prije(1), izvjestaj: izvj({ diskovi: [{ oznaka: "C:", slobodnoGB: 11, ukupnoGB: 100 }] }), sada: SADA })), "");

// zadaci: novo upozorenje → zadatak (samo ako je primatelj određen); ponovna provjera ne duplicira; nestalo → zatvoreno (sustav)
const SADA_ISO = new Date(SADA).toISOString();
const most = [{ kljuc: "most", tekst: "Most šuti." }];
let r = S.uskladiZadatke([], most, null, SADA_ISO);
assert.strictEqual(r.promijenjeno, false, "bez primatelja nema novog zadatka");
r = S.uskladiZadatke([{ id: "drugi", naziv: "Tuđi zadatak" }], most, "zap-1", SADA_ISO);
assert.strictEqual(r.promijenjeno, true);
assert.strictEqual(r.zadaci.length, 2);
const z = r.zadaci[1];
assert.deepStrictEqual([z.serverUpozorenje, z.dodijeljenoId, z.zadaoId, z.kreiraoId, z.izvrseno, z.dodjelaVidjena], ["most", "zap-1", "sustav", "sustav", false, false]);
assert.match(z.naziv, /^Server: Most šuti\.$/);
assert.strictEqual(S.uskladiZadatke(r.zadaci, most, "zap-1", SADA_ISO).promijenjeno, false, "isti otvoreni zadatak se ne ponavlja");
const zatvoreno = S.uskladiZadatke(r.zadaci, [], "zap-1", SADA_ISO);
assert.strictEqual(zatvoreno.promijenjeno, true);
assert.deepStrictEqual([zatvoreno.zadaci[1].izvrseno, zatvoreno.zadaci[1].izvrsioId, zatvoreno.zadaci[1].dodjelaVidjena], [true, "sustav", true]);
assert.strictEqual(zatvoreno.zadaci[0].naziv, "Tuđi zadatak", "ostali zadaci ostaju netaknuti");
// bez primatelja se otvoreni zadatak ipak zatvara kad uzrok nestane
assert.strictEqual(S.uskladiZadatke(r.zadaci, [], null, SADA_ISO).zadaci[1].izvrseno, true);
// upozorenje se vrati nakon što ga je sustav zatvorio → novi zadatak
assert.strictEqual(S.uskladiZadatke(zatvoreno.zadaci, most, "zap-1", SADA_ISO).zadaci.filter((x) => x.serverUpozorenje === "most" && !x.izvrseno).length, 1);
// osoba je sama zatvorila zadatak, a uzrok je i dalje tu → novi zadatak tek nakon 24 h
const rucno = [{ ...z, izvrseno: true, izvrsioId: "zap-1", datumIzvrsenja: prije(60) }];
assert.strictEqual(S.uskladiZadatke(rucno, most, "zap-1", SADA_ISO).promijenjeno, false);
assert.strictEqual(S.uskladiZadatke([{ ...rucno[0], datumIzvrsenja: prije(60 * 25) }], most, "zap-1", SADA_ISO).zadaci.filter((x) => !x.izvrseno).length, 1);
// zatvoreni zadaci upozorenja stariji od 30 dana brišu se; otvoreni i obični zadaci ostaju
const stari = [{ ...z, id: "s1", izvrseno: true, izvrsioId: "sustav", datumIzvrsenja: prije(60 * 24 * 31) }, { id: "obican", naziv: "Obični", izvrseno: true, datumIzvrsenja: prije(60 * 24 * 400) }];
r = S.uskladiZadatke(stari, [], "zap-1", SADA_ISO);
assert.deepStrictEqual(r.zadaci.map((x) => x.id), ["obican"]);
console.log("stanje-servera: svi testovi prolaze");

// Pregled sati jednog projekta: radnici × operacije (Evidencija sati → Sati po nalozima → Pregled po projektu). Bez satnica i cijena, samo sati.
// Operacija = faza radnog naloga projekta; stalni poslovi vezani uz projekt (utovar, prijevozi…) dolaze kao dodatni stupci.
// Ulaz: sati = zapisi satiPoNalogu, nalozi = radni nalozi, zaposlenici, faze = redoslijed faza (FAZE), stalniPoslovi = STALNI_POSLOVI ({ id, projekt }).
// Opcije: od / do (ISO datumi, neobavezno), dio = "sve" | "osnovna" | id dodatne narudžbe projekta.
// Vraća { stupci: [kljuc…] (redoslijed: faze, pa stalni poslovi), redovi: [{ zaposlenikId, ime, poStupcu: {kljuc: sati}, ukupno }] (po ukupnim satima silazno),
// ukupnoPoStupcu: {kljuc: sati}, ukupno, bezRadnika (sati upisani ukupno, bez radnika — nisu u tablici) }.
const zaokr = (n) => Math.round(n * 100) / 100;

export function satiPoRadnicimaIOperacijama({ sati = [], nalozi = [], zaposlenici = [], projektId, od = "", do: doDatuma = "", dio = "sve", faze = [], stalniPoslovi = [] }) {
  const nalogPoId = new Map(nalozi.map((n) => [n.id, n]));
  const stalniPoId = new Map(stalniPoslovi.map((p) => [p.id, p]));
  const ime = new Map(zaposlenici.map((z) => [z.id, `${z.prezime} ${z.ime}`]));
  const radnici = new Map();
  const ukupnoPoStupcu = {};
  let ukupno = 0, bezRadnika = 0;
  sati.forEach((s) => {
    const datum = String(s.datum || "");
    if ((od && datum < od) || (doDatuma && datum > doDatuma)) return;
    const n = nalogPoId.get(s.radniNalogId);
    let kljuc;
    if (n) {
      if (n.projektId !== projektId) return;
      if (dio !== "sve" && (n.dodatakId || "") !== (dio === "osnovna" ? "" : dio)) return;
      kljuc = n.faza;
    } else {
      const sp = stalniPoId.get(s.radniNalogId);
      // stalni posao se veže uz projekt samo ako ga je radnik ručno upisao; dodatne narudžbe se ne razlikuju pa se pokazuje samo uz "sve"
      if (!sp?.projekt || s.projektId !== projektId || dio !== "sve") return;
      kljuc = `stalni:${sp.id}`;
    }
    const h = Number(s.sati) || 0;
    if (!(h > 0)) return;
    if (!s.zaposlenikId) { bezRadnika += h; return; }
    const r = radnici.get(s.zaposlenikId) || { zaposlenikId: s.zaposlenikId, ime: ime.get(s.zaposlenikId) || "(nepoznat radnik)", poStupcu: {}, ukupno: 0 };
    r.poStupcu[kljuc] = (r.poStupcu[kljuc] || 0) + h;
    r.ukupno += h;
    radnici.set(s.zaposlenikId, r);
    ukupnoPoStupcu[kljuc] = (ukupnoPoStupcu[kljuc] || 0) + h;
    ukupno += h;
  });
  const redoslijed = [...faze, ...stalniPoslovi.map((p) => `stalni:${p.id}`)];
  const kljucevi = Object.keys(ukupnoPoStupcu);
  const stupci = [...redoslijed.filter((k) => kljucevi.includes(k)), ...kljucevi.filter((k) => !redoslijed.includes(k))]; // faza izvan popisa (npr. stara) ide na kraj
  const redovi = [...radnici.values()]
    .map((r) => ({ ...r, ukupno: zaokr(r.ukupno), poStupcu: Object.fromEntries(Object.entries(r.poStupcu).map(([k, v]) => [k, zaokr(v)])) }))
    .sort((a, b) => b.ukupno - a.ukupno || a.ime.localeCompare(b.ime, "hr"));
  return { stupci, redovi, ukupnoPoStupcu: Object.fromEntries(Object.entries(ukupnoPoStupcu).map(([k, v]) => [k, zaokr(v)])), ukupno: zaokr(ukupno), bezRadnika: zaokr(bezRadnika) };
}

// Projekti koji imaju ikakve sate (preko naloga ili stalnog posla vezanog uz projekt) i datum zadnjeg unosa: Map projektId → datum.
export function projektiSaSatima({ sati = [], nalozi = [], stalniPoslovi = [] }) {
  const nalogPoId = new Map(nalozi.map((n) => [n.id, n]));
  const stalniPoId = new Map(stalniPoslovi.map((p) => [p.id, p]));
  const zadnji = new Map();
  sati.forEach((s) => {
    const n = nalogPoId.get(s.radniNalogId);
    const projektId = n ? n.projektId : (stalniPoId.get(s.radniNalogId)?.projekt ? s.projektId : null);
    if (!projektId || !(Number(s.sati) > 0)) return;
    const datum = String(s.datum || "");
    if (!zadnji.has(projektId) || datum > zadnji.get(projektId)) zadnji.set(projektId, datum);
  });
  return zadnji;
}

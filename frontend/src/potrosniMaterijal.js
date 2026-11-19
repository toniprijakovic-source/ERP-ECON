// Potrošni materijal — pomoćne funkcije za sučelje (tablica potrošnje po radniku, popis "Za naručiti", uvoz iz Excela). Brojke i pravila stanja
// računa poslužitelj (backend/potrosni.js); ovdje se samo slaže prikaz iz podataka koje on vrati.

const zaokruzi = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

export const MJESECI_KRATKO = ["sij", "velj", "ožu", "tra", "svi", "lip", "srp", "kol", "ruj", "lis", "stu", "pro"];

// redovi: [{ zaposlenikId, zaposlenik, mjesec: "GGGG-MM", artiklId, artikl, jm, kolicina, broj }] (poslužitelj ih već zbraja po radniku, mjesecu i artiklu).
// artiklId prazan = svi artikli: u ćeliji je broj uzimanja (količine različitih jedinica se ne zbrajaju); inače je količina tog artikla.
// Vraća { mjeseci: ["GGGG-01"…"GGGG-12"], radnici: [{ zaposlenikId, zaposlenik, poMjesecu: { mjesec: broj }, ukupno }], zbrojPoMjesecu, ukupno, jm }.
export function matricaPotrosnje(redovi, godina, artiklId = "") {
  const mjeseci = Array.from({ length: 12 }, (_, i) => `${godina}-${String(i + 1).padStart(2, "0")}`);
  const radnici = new Map();
  let jm = "";
  for (const r of redovi || []) {
    if (!r.mjesec || !r.mjesec.startsWith(`${godina}-`)) continue;
    if (artiklId && r.artiklId !== artiklId) continue;
    if (artiklId) jm = r.jm || jm;
    const vrijednost = artiklId ? Number(r.kolicina) || 0 : Number(r.broj) || 0;
    const x = radnici.get(r.zaposlenikId) || { zaposlenikId: r.zaposlenikId, zaposlenik: r.zaposlenik, poMjesecu: {}, ukupno: 0 };
    x.poMjesecu[r.mjesec] = zaokruzi((x.poMjesecu[r.mjesec] || 0) + vrijednost);
    x.ukupno = zaokruzi(x.ukupno + vrijednost);
    radnici.set(r.zaposlenikId, x);
  }
  const popis = [...radnici.values()].sort((a, b) => String(a.zaposlenik).localeCompare(String(b.zaposlenik), "hr"));
  const zbrojPoMjesecu = Object.fromEntries(mjeseci.map((m) => [m, zaokruzi(popis.reduce((s, r) => s + (r.poMjesecu[m] || 0), 0))]));
  return { mjeseci, radnici: popis, zbrojPoMjesecu, ukupno: zaokruzi(popis.reduce((s, r) => s + r.ukupno, 0)), jm };
}

// Artikli koje treba naručiti: poslužitelj ih je označio (naruciti), neodređeni (još nenaručeni) prvi, pa po datumu upozorenja.
export function zaNarucivanje(artikli) {
  return (artikli || [])
    .filter((a) => a.aktivan !== false && a.naruciti)
    .sort((a, b) => (a.narucenoDatum ? 1 : 0) - (b.narucenoDatum ? 1 : 0) || String(a.upozorenjeDatum || "").localeCompare(String(b.upozorenjeDatum || "")) || a.naziv.localeCompare(b.naziv, "hr"));
}

const broj = (v) => { const t = String(v ?? "").trim().replace(/\s/g, "").replace(",", "."); if (t === "") return ""; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
const ZAGLAVLJE = /^(naziv|artikl|name)$/i;

// Zalijepljeno iz Excela (stupci odvojeni tabulatorom, točkom-zarezom ili — ako toga nema — zarezom): naziv, jedinica, početno stanje, minimum, skupina.
// Prvi redak se preskače ako izgleda kao zaglavlje. Vraća { redovi, greske } — redak s nevaljanim brojem ne ulazi, nego se javlja s brojem retka.
export function parsirajUvoz(tekst) {
  const linije = String(tekst || "").split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const razdjelnik = linije.some((l) => l.includes("\t")) ? "\t" : linije.some((l) => l.includes(";")) ? ";" : ",";
  const redovi = [];
  const greske = [];
  linije.forEach((linija, i) => {
    const c = linija.split(razdjelnik).map((x) => x.trim());
    if (i === 0 && ZAGLAVLJE.test(c[0])) return;
    if (!c[0]) { greske.push({ red: i + 1, razlog: "Nema naziva." }); return; }
    const stanje = broj(c[2]), min = broj(c[3]);
    if (Number.isNaN(stanje) || Number.isNaN(min)) { greske.push({ red: i + 1, razlog: "Stanje i minimum moraju biti brojevi." }); return; }
    redovi.push({ naziv: c[0], jm: c[1] || "kom", stanje: stanje === "" ? 0 : stanje, minZaliha: min === "" ? 0 : min, skupina: c[4] || "" });
  });
  return { redovi, greske };
}

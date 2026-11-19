// Potrošni materijal (rukavice, brusne ploče, žica…): čista logika bez baze — testira se u test/potrosni-logika.test.js.
// Artikl: { id, naziv, jm, skupina, stanje, minZaliha, aktivan, naruciti, upozorenjeDatum, narucenoDatum, napomena }.
// Stanje se mijenja ISKLJUČIVO preko poslužiteljskih ruta (kiosk uzimanje, zaprimanje, korekcija, storno) koje ovdje zovu funkcije u
// transakciji nad zaključanim popisom — zato zastarjeli preglednik ili tablet ne mogu prepisati stanje (vidi SAMO_CILJANO u server.js).
// Upozorenje za naručivanje: čim stanje padne na ili ispod minimuma (minZaliha > 0) artikl dobije naruciti = true (jednom, dok se ne zaprimi).

const zaokruzi = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const MAX_KOLICINA = 999;
const MAX_STAVKI = 30;
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const tekst = (v, max) => String(v ?? "").trim().slice(0, max);
const jePozitivan = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

// Postavlja/briše upozorenje za naručivanje prema stanju. Vraća { artikl, novoUpozorenje, ugaseno }.
function osvjeziUpozorenje(a, danas) {
  const min = Number(a.minZaliha) || 0;
  const ispod = min > 0 && Number(a.stanje) <= min;
  if (ispod) {
    const novo = !a.naruciti;
    return { artikl: { ...a, naruciti: true, upozorenjeDatum: novo ? danas : a.upozorenjeDatum || danas }, novoUpozorenje: novo, ugaseno: false };
  }
  const ugaseno = !!a.naruciti;
  return { artikl: { ...a, naruciti: false, upozorenjeDatum: null, narucenoDatum: null }, novoUpozorenje: false, ugaseno };
}

// Ulaz kioska: stavke [{ artiklId, kolicina }]. Zbraja iste artikle, odbija nepoznate/neaktivne i nevaljane količine.
function provjeriStavke(artikli, stavke) {
  if (!Array.isArray(stavke) || stavke.length === 0) return { greska: "Nije odabran nijedan artikl." };
  if (stavke.length > MAX_STAVKI) return { greska: "Previše stavki odjednom." };
  const zbroj = new Map();
  for (const s of stavke) {
    if (!s || typeof s.artiklId !== "string") return { greska: "Neispravna stavka." };
    if (!jePozitivan(s.kolicina) || Number(s.kolicina) > MAX_KOLICINA) return { greska: "Količina mora biti veća od 0 i najviše " + MAX_KOLICINA + "." };
    const a = artikli.find((x) => x.id === s.artiklId);
    if (!a || a.aktivan === false) return { greska: "Artikl više nije dostupan — osvježi popis." };
    zbroj.set(a.id, zaokruzi((zbroj.get(a.id) || 0) + Number(s.kolicina)));
  }
  return { stavke: [...zbroj].map(([artiklId, kolicina]) => ({ artiklId, kolicina })) };
}

// Radnik je uzeo stavke: stanje se umanjuje (može ići i ispod 0 — radniku se nikad ne uskraćuje, minus u popisu znači "provjeri stanje").
function primijeniUzimanje(artikli, stavke, danas) {
  const promjene = [];
  const novaUpozorenja = [];
  const rezultat = artikli.map((a) => {
    const s = stavke.find((x) => x.artiklId === a.id);
    if (!s) return a;
    const { artikl, novoUpozorenje } = osvjeziUpozorenje({ ...a, stanje: zaokruzi(a.stanje - s.kolicina) }, danas);
    promjene.push({ artikl: a, kolicina: s.kolicina, stanjeNakon: artikl.stanje });
    if (novoUpozorenje) novaUpozorenja.push(artikl);
    return artikl;
  });
  return { artikli: rezultat, promjene, novaUpozorenja };
}

function primijeniZaprimanje(artikli, artiklId, kolicina, danas) {
  const a = artikli.find((x) => x.id === artiklId);
  if (!a) return { greska: "Artikl ne postoji." };
  if (!jePozitivan(kolicina) || Number(kolicina) > 100000) return { greska: "Količina mora biti veća od 0." };
  const { artikl, novoUpozorenje, ugaseno } = osvjeziUpozorenje({ ...a, stanje: zaokruzi(a.stanje + Number(kolicina)) }, danas);
  return { artikli: artikli.map((x) => (x.id === a.id ? artikl : x)), artikl, novoUpozorenje, ugaseno };
}

// Korekcija nakon brojanja: novo stanje postaje stvarno; razlika ide u dnevnik.
function primijeniKorekciju(artikli, artiklId, novoStanje, danas) {
  const a = artikli.find((x) => x.id === artiklId);
  if (!a) return { greska: "Artikl ne postoji." };
  if (!Number.isFinite(Number(novoStanje)) || Number(novoStanje) < 0 || Number(novoStanje) > 1000000) return { greska: "Stanje mora biti broj, 0 ili veći." };
  const delta = zaokruzi(Number(novoStanje) - a.stanje);
  const { artikl, novoUpozorenje, ugaseno } = osvjeziUpozorenje({ ...a, stanje: zaokruzi(novoStanje) }, danas);
  return { artikli: artikli.map((x) => (x.id === a.id ? artikl : x)), artikl, delta, novoUpozorenje, ugaseno };
}

// Storno uzimanja: stanje se vraća. Ako artikl više ne postoji, storno se ipak bilježi u dnevniku (stanje nema što primiti).
function primijeniStorno(artikli, artiklId, kolicina, danas) {
  const a = artikli.find((x) => x.id === artiklId);
  if (!a) return { artikli, artikl: null };
  const { artikl, ugaseno } = osvjeziUpozorenje({ ...a, stanje: zaokruzi(a.stanje + Number(kolicina)) }, danas);
  return { artikli: artikli.map((x) => (x.id === a.id ? artikl : x)), artikl, ugaseno };
}

// Novi ili izmijenjeni artikl (bez stanja za postojeći — stanje se mijenja samo zaprimanjem/korekcijom). Naziv je jedinstven (bez obzira na velika/mala slova).
function upisiArtikl(artikli, ulaz, danas) {
  const naziv = tekst(ulaz?.naziv, 80);
  if (!naziv) return { greska: "Naziv je obavezan." };
  const min = ulaz.minZaliha === "" || ulaz.minZaliha == null ? 0 : Number(ulaz.minZaliha);
  if (!Number.isFinite(min) || min < 0 || min > 1000000) return { greska: "Minimum mora biti broj, 0 ili veći." };
  const duplikat = artikli.find((x) => x.naziv.toLowerCase() === naziv.toLowerCase() && x.id !== ulaz.id);
  if (duplikat) return { greska: `Artikl „${duplikat.naziv}” već postoji.` };
  const polja = { naziv, jm: tekst(ulaz.jm, 12) || "kom", skupina: tekst(ulaz.skupina, 40), minZaliha: zaokruzi(min), aktivan: ulaz.aktivan !== false, napomena: tekst(ulaz.napomena, 200) };
  if (ulaz.id) {
    const a = artikli.find((x) => x.id === ulaz.id);
    if (!a) return { greska: "Artikl ne postoji." };
    const { artikl } = osvjeziUpozorenje({ ...a, ...polja }, danas);
    return { artikli: artikli.map((x) => (x.id === a.id ? artikl : x)), artikl, novi: false };
  }
  const pocetno = ulaz.stanje === "" || ulaz.stanje == null ? 0 : Number(ulaz.stanje);
  if (!Number.isFinite(pocetno) || pocetno < 0 || pocetno > 1000000) return { greska: "Početno stanje mora biti broj, 0 ili veći." };
  const { artikl } = osvjeziUpozorenje({ id: uid("pm"), ...polja, stanje: zaokruzi(pocetno), naruciti: false, upozorenjeDatum: null, narucenoDatum: null }, danas);
  return { artikli: [...artikli, artikl], artikl, novi: true };
}

// Skupni uvoz (npr. zalijepljeno iz Excela): redovi { naziv, jm, stanje, minZaliha, skupina }. Postojeći nazivi se preskaču.
function uvezi(artikli, redovi, danas) {
  if (!Array.isArray(redovi) || redovi.length === 0) return { greska: "Nema redaka za uvoz." };
  if (redovi.length > 500) return { greska: "Najviše 500 redaka odjednom." };
  let rezultat = artikli;
  const dodano = [];
  const preskoceno = [];
  redovi.forEach((r, i) => {
    const o = upisiArtikl(rezultat, { naziv: r?.naziv, jm: r?.jm, skupina: r?.skupina, stanje: r?.stanje, minZaliha: r?.minZaliha }, danas);
    if (o.greska) { preskoceno.push({ red: i + 1, naziv: tekst(r?.naziv, 80), razlog: o.greska }); return; }
    rezultat = o.artikli;
    dodano.push(o.artikl);
  });
  return { artikli: rezultat, dodano, preskoceno };
}

const MJESECI_TZ = "Europe/Zagreb";
const mjesecZagreb = (vrijeme) => {
  const d = vrijeme instanceof Date ? vrijeme : new Date(vrijeme);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: MJESECI_TZ, year: "numeric", month: "2-digit" }).formatToParts(d);
  return `${p.find((x) => x.type === "year").value}-${p.find((x) => x.type === "month").value}`;
};

// Zbroj potrošnje po radniku, mjesecu i artiklu iz redaka dnevnika (samo "uzimanje", bez storniranih).
function agregirajPotrosnju(redovi) {
  const m = new Map();
  for (const r of redovi) {
    if (r.vrsta !== "uzimanje" || r.storno) continue;
    const mjesec = mjesecZagreb(r.vrijeme);
    const kljuc = `${r.zaposlenik_id}|${mjesec}|${r.artikl_id}`;
    const x = m.get(kljuc) || { zaposlenikId: r.zaposlenik_id, zaposlenik: r.zaposlenik, mjesec, artiklId: r.artikl_id, artikl: r.artikl, jm: r.jm, kolicina: 0, broj: 0 };
    x.kolicina = zaokruzi(x.kolicina + Number(r.kolicina));
    x.broj += 1;
    m.set(kljuc, x);
  }
  return [...m.values()].sort((a, b) => a.mjesec.localeCompare(b.mjesec) || String(a.zaposlenik).localeCompare(String(b.zaposlenik), "hr"));
}

// Zadatak koji se pojavi odgovornoj osobi (zvonce + zadaci na nadzornoj ploči): "Naručiti: <artikl>".
function zadatakZaNarucivanje(artikl, osobaId, sada) {
  return {
    id: uid("sz"), naziv: `Naručiti potrošni materijal: ${artikl.naziv} (stanje ${artikl.stanje} ${artikl.jm}, minimum ${artikl.minZaliha})`,
    dodijeljenoId: osobaId, planiraniDatum: null, izvrseno: false, izvrsioId: null, datumIzvrsenja: null,
    kreiraoId: "sustav", zadaoId: "sustav", zadanoDatum: sada, dodjelaVidjena: false, potrosniArtiklId: artikl.id,
  };
}

module.exports = { osvjeziUpozorenje, provjeriStavke, primijeniUzimanje, primijeniZaprimanje, primijeniKorekciju, primijeniStorno, upisiArtikl, uvezi, agregirajPotrosnju, zadatakZaNarucivanje, mjesecZagreb, zaokruzi, MAX_KOLICINA };

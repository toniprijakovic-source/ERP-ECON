// Mape projekata na Z: (od 2026-11):
//
// 1. STRUKTURA: za NOVI projekt (otvoren u ERP-u nakon uvođenja ove funkcije; popis daje ERP) most napravi mapu projekta, ako je još
//    nema, i standardne podmape (PREDLOSCI). Postojeća mapa (npr. ručno otvorena) se ne preimenuje — dodaju se samo podmape koje fale.
//    Ništa se ne briše ni ne premješta. U korijen mape ide i prečac "Otvori u ERP-u.url". ERP putanju upiše kao "Mapu projekta".
//      obični projekti:      <korijen>\<šifra>_<naziv>\01 Narudžba … 09 Slike
//      RN 180 (kupaonice):   isto, s nacrtima po dijelovima kupaonice
//      RN 40-04-NN (usluge): <korijen>\RN 40-04_Usluge radione\NN-<kupac>-<opis>\ (nekoliko podmapa)
//
// 2. PRAĆENJE: most svakih nekoliko minuta pregleda mape aktivnih projekata i ERP-u javlja
//    - sažetak podmapa (broj datoteka, zadnja izmjena) za karticu Dokumenti u projektu,
//    - promjene u mapama "Laser za limove" / "Laser za profile" (obavijest odgovornoj osobi za laser),
//    - promjene nacrta "Od kupca" i "Za proizvodnju" (u "Za proizvodnju" je samo važeća revizija, stara ide u "Stare revizije"),
//    - nove mape odobravanja nacrta s datumom ("Poslano 14.01.2025", "Odgovor …", "Freigabe …") — i u starim projektima.
//    Datoteka se smatra gotovom tek kad se 2 minute ne mijenja (da obavijest ne dođe usred kopiranja). Prvi pregled projekta samo
//    zapamti stanje (bez obavijesti). Stanje između pregleda most čuva u dokumenti-stanje.json pokraj most.js; sadržaj datoteka se nikad
//    ne čita ni ne šalje — samo nazivi, veličine i vremena izmjene.
import fs from "node:fs";
import path from "node:path";
import { Greska } from "./pretvori.js";
import { nadjiMapuProjekta, SIFRA_USLUGE, ZBIRNA_USLUGE, NAZIV_ZBIRNE_USLUGE } from "./mapa.js";

// ---------------- 1. Struktura ----------------
const NACRTI_STANDARD = ["Od kupca", "Za odobrenje", "Za proizvodnju", "Za proizvodnju/Stare revizije", "Za montažu", "Laser za limove", "Laser za profile"];
const NACRTI_KUPAONICE = ["Od kupca", "Za proizvodnju", ...["Podovi", "Stranice", "Krovovi", "Profili", "Spojni profili", "Stare revizije"].map((n) => `Za proizvodnju/${n}`), "Laser za limove", "Laser za profile", "Šablone"];
export const PREDLOSCI = {
  standard: ["01 Narudžba", "02 Nacrti", ...NACRTI_STANDARD.map((n) => `02 Nacrti/${n}`), "03 Nabava", "04 Kontrola kvalitete", "05 Isporuka", "06 Montaža", "07 Fakture", "08 Problemi i reklamacije", "09 Slike"],
  kupaonice: ["01 Narudžba", "02 Nacrti", ...NACRTI_KUPAONICE.map((n) => `02 Nacrti/${n}`), "03 Nabava", "04 Kontrola kvalitete", "05 Isporuka", "07 Fakture", "08 Problemi i reklamacije", "09 Slike"],
  usluge: ["Narudžba", "Laser za limove", "Laser za profile", "Fotografije - Utovar"],
};
export const vrstaPredloska = (sifra) => (SIFRA_USLUGE.test(String(sifra || "").trim()) ? "usluge" : /^rn\s*180-/i.test(String(sifra || "").trim()) ? "kupaonice" : "standard");

// Naziv mape za Windows: bez znakova < > : " / \ | ? * i kontrolnih znakova, bez točke/razmaka na kraju, najviše 90 znakova.
export const sigurnoIme = (s, max = 90) => String(s || "").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-").replace(/\s+/g, " ").trim().slice(0, max).replace(/[. ]+$/, "");
// Kratko ime kupca za mape usluga ("STEELMONT d.o.o." → "Steelmont").
export const kupacKratko = (naziv) => {
  const bez = String(naziv || "").replace(/\b(d\.?\s?o\.?\s?o|j\.?\s?d\.?\s?o\.?\s?o|d\.?\s?d|gmbh|ag|kg|co|s\.?\s?p|obrt)\b\.?/gi, " ").trim();
  const prva = bez.split(/[\s,]+/)[0] || "";
  return prva.length > 3 && prva === prva.toUpperCase() ? prva[0] + prva.slice(1).toLowerCase() : prva;
};
export function nazivNoveMape(p) {
  const sifra = String(p.sifra || "").trim();
  const naziv = String(p.naziv || "").trim();
  const usluga = sifra.match(SIFRA_USLUGE);
  if (usluga) {
    const k = kupacKratko(p.kupac);
    return sigurnoIme([String(Number(usluga[1])).padStart(2, "0"), ...(k && !naziv.toLowerCase().includes(k.toLowerCase()) ? [k] : []), ...(naziv ? [naziv] : [])].join("-"));
  }
  return sigurnoIme(naziv ? `${sifra}_${naziv}` : sifra);
}

const unutar = (roditelj, dijete) => { const r = path.relative(roditelj, dijete); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };

// p = { id, sifra, naziv, kupac, mapa } iz ERP-a. Vraća { mapa, novaMapa, stvoreno: [relativne putanje] }. U probnom načinu ništa ne stvara.
export function stvoriStrukturu(p, korijeni, { probno = false, erpUrl = "" } = {}) {
  const sifra = String(p?.sifra || "").trim();
  if (!sifra) throw new Greska("Projekt nema šifru.");
  const popis = Array.isArray(korijeni) ? korijeni : [korijeni];
  if (!popis.some((k) => fs.existsSync(k))) throw new Greska(`Korijenska mapa projekata nije dostupna: ${popis.join(" ; ")} (je li Z: spojen?)`);
  let mapa = null;
  try { mapa = nadjiMapuProjekta(popis, sifra, p.mapa || ""); } catch (e) { if (e?.kod !== "nema" || p.mapa) throw e; }
  let novaMapa = false;
  if (!mapa) {
    // Nova mapa ide uvijek u korijen tekuće godine (prvi na popisu); ako on još ne postoji (npr. 1.1.), most pričeka.
    const korijen = popis[0];
    if (!fs.existsSync(korijen)) throw new Greska(`Mapa projekata tekuće godine ne postoji: ${korijen}`);
    let roditelj = korijen;
    if (vrstaPredloska(sifra) === "usluge") {
      const zbirna = fs.readdirSync(korijen, { withFileTypes: true }).find((d) => d.isDirectory() && ZBIRNA_USLUGE.test(d.name));
      roditelj = path.join(korijen, zbirna ? zbirna.name : NAZIV_ZBIRNE_USLUGE);
    }
    const ime = nazivNoveMape(p);
    if (!ime) throw new Greska("Projekt nema naziv za mapu.");
    mapa = path.join(roditelj, ime);
    if (!unutar(korijen, mapa)) throw new Greska("Mapa projekta nije unutar korijena projekata.");
    novaMapa = true;
    if (!probno) fs.mkdirSync(mapa, { recursive: true });
  }
  const stvoreno = [];
  for (const rel of PREDLOSCI[vrstaPredloska(sifra)]) {
    const puna = path.join(mapa, ...rel.split("/"));
    if (!unutar(mapa, puna) || fs.existsSync(puna)) continue;
    if (!probno) fs.mkdirSync(puna, { recursive: true });
    stvoreno.push(rel);
  }
  if (erpUrl && p.id) {
    const precac = path.join(mapa, "Otvori u ERP-u.url");
    if (!fs.existsSync(precac)) {
      if (!probno) fs.writeFileSync(precac, `[InternetShortcut]\r\nURL=${erpUrl.replace(/\/$/, "")}/?projekt=${encodeURIComponent(p.id)}\r\n`, { flag: "wx" });
      stvoreno.push("Otvori u ERP-u.url");
    }
  }
  return { mapa, novaMapa, stvoreno };
}

// Jedan krug: ERP daje nove projekte bez strukture, most je napravi i javi rezultat (i grešku po projektu, pokušava se ponovno).
export async function uskladiStrukturu(api, okolina, log, erpUrl) {
  const { projekti } = await api("GET", "/api/most/projekti-za-strukturu");
  if (!projekti?.length) return { rezultati: [] };
  const rezultati = [];
  for (const p of projekti) {
    try {
      const r = stvoriStrukturu(p, okolina.korijen, { probno: okolina.probno, erpUrl });
      rezultati.push({ projektId: p.id, mapa: r.mapa, novaMapa: r.novaMapa, stvoreno: r.stvoreno });
      log(`${okolina.probno ? "[PROBNO] " : ""}Struktura mapa ${p.sifra}: ${r.novaMapa ? "nova mapa" : "postojeća mapa"} ${r.mapa}${r.stvoreno.length ? ` (+${r.stvoreno.length})` : ""}`);
    } catch (e) {
      const poruka = e instanceof Greska ? e.message : `Neočekivana greška: ${e.message}`;
      rezultati.push({ projektId: p.id, greska: poruka });
      log(`Struktura mapa ${p.sifra}: ${poruka}`);
    }
  }
  if (!okolina.probno) await api("POST", "/api/most/projekti/struktura", { rezultati });
  return { rezultati };
}

// ---------------- 2. Praćenje ----------------
const PRESKOCI = /^(thumbs\.db|desktop\.ini|~\$.*|\.~lock.*|.*\.(tmp|bak|dwl|dwl2|sv\$|lck|crdownload|part))$/i;
export const normIme = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^\d{1,2}[ ._-]+/, "").trim();
// Područja koja se prate (naziv mape bez rednog broja i dijakritika). Najbliža takva mapa iznad datoteke određuje područje.
export const PODRUCJA = {
  "laser za limove": { vrsta: "laser", faza: "D" },
  "laser za profile": { vrsta: "laser", faza: "C" },
  "od kupca": { vrsta: "kupac" },
  "za proizvodnju": { vrsta: "proizvodnja" },
  "stare revizije": { vrsta: "stare" },
};
// Mapa odobravanja nacrta s datumom (npr. "Poslano 14.01.2025", "Odgovor_03.02.2026", "FREIGABE 31.05.2024").
export const MAPA_ODOBRENJA = /(poslano|odgovor|freigabe|poslati|uploadano)[^\\/]*\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}/i;
const MIRNO_MS = 2 * 60_000;
const MAX_STAVKI = 40_000;

// Oznaka revizije u nazivu (rev1, rev.C, REV 01, Index A, idx B, _v2, _A na kraju): vraća osnovu naziva (bez oznake) i oznaku.
const REV = /(?:[ _.-]*(?:rev(?:izija)?|index|indeks|idx)[ ._-]*([0-9]{1,2}|[a-z])\b)|(?:[ _-]v([0-9]{1,2})\b)|(?:[_ -]([A-H])$)/i;
export const osnovaNaziva = (ime) => {
  const bez = path.basename(String(ime)).replace(/\.[a-z0-9]{1,5}$/i, "");
  const ekst = (path.extname(String(ime)) || "").toLowerCase();
  const m = bez.match(REV);
  if (!m) return { baza: `${bez.toLowerCase().trim()}${ekst}`, rev: null };
  const baza = (bez.slice(0, m.index) + bez.slice(m.index + m[0].length)).replace(/[ _.-]+$/, "").toLowerCase().trim();
  return { baza: `${baza}${ekst}`, rev: (m[1] || m[2] || m[3] || "").toUpperCase() };
};

// Pregled jedne mape projekta: sažetak (prva razina i podmape nacrta) + popis praćenih datoteka i mapa odobravanja.
export function pregledajMapu(mapa, { readdir = (p) => fs.readdirSync(p, { withFileTypes: true }), stat = (p) => fs.statSync(p) } = {}) {
  const podmape = new Map(); // relativni naziv → { datoteka, zadnja }
  const pracene = {}; // rel → [velicina, mtimeMs, podrucje, korijenPodrucja]
  const odobrenja = [];
  let ukupno = 0, zadnja = 0, stavki = 0;
  const dodajSazetak = (kljuc, mtime) => { const e = podmape.get(kljuc) || { datoteka: 0, zadnja: 0 }; e.datoteka++; e.zadnja = Math.max(e.zadnja, mtime); podmape.set(kljuc, e); };
  const obidi = (dir, rel, dubina, podrucje) => {
    let unosi;
    try { unosi = readdir(dir); } catch { return; }
    for (const d of unosi) {
      if (++stavki > MAX_STAVKI) return;
      if (PRESKOCI.test(d.name)) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      const puna = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (dubina === 0 && !podmape.has(d.name)) podmape.set(d.name, { datoteka: 0, zadnja: 0 });
        if (dubina === 1 && /^nacrt/i.test(normIme(rel)) && !podmape.has(r)) podmape.set(r, { datoteka: 0, zadnja: 0 });
        if (MAPA_ODOBRENJA.test(d.name)) odobrenja.push(r);
        const p = PODRUCJA[normIme(d.name)];
        const novo = p ? { ...p, korijen: r } : podrucje;
        if (dubina < 10) obidi(puna, r, dubina + 1, novo);
        continue;
      }
      if (!d.isFile()) continue;
      let s;
      try { s = stat(puna); } catch { continue; }
      ukupno++;
      zadnja = Math.max(zadnja, s.mtimeMs);
      const dijelovi = r.split("/");
      if (dijelovi.length > 1) dodajSazetak(dijelovi[0], s.mtimeMs);
      if (dijelovi.length > 2 && /^nacrt/i.test(normIme(dijelovi[0]))) dodajSazetak(`${dijelovi[0]}/${dijelovi[1]}`, s.mtimeMs);
      if (podrucje) pracene[r] = [s.size, Math.round(s.mtimeMs), podrucje.vrsta, podrucje.korijen, podrucje.faza || ""];
    }
  };
  obidi(mapa, "", 0, null);
  return {
    podmape: [...podmape.entries()].sort((a, b) => a[0].localeCompare(b[0], "hr")).map(([naziv, e]) => ({ naziv, datoteka: e.datoteka, zadnja: e.zadnja ? new Date(e.zadnja).toISOString() : null })),
    ukupno, zadnja: zadnja ? new Date(zadnja).toISOString() : null, pracene, odobrenja, prekinuto: stavki > MAX_STAVKI,
  };
}

// Usporedba s prošlim pregledom. Datoteka mlađa od 2 min još nije "gotova": u novo stanje ide njezin stari zapis (ili ništa), pa se
// promjena javi kad se smiri. Vraća { dogadaji, stanje } — stanje se sprema tek kad ERP primi događaje.
export function usporedi(staro, novo, sada = Date.now()) {
  const stanje = { datoteke: {}, odobrenja: [...novo.odobrenja] };
  const stareDat = staro.datoteke || {};
  const promjene = new Map(); // korijen područja → { vrsta, faza, dodano, izmijenjeno, obrisano }
  const grupa = (zapis) => {
    const k = zapis[3];
    if (!promjene.has(k)) promjene.set(k, { vrsta: zapis[2], faza: zapis[4] || "", podrucje: k, dodano: [], izmijenjeno: [], obrisano: [] });
    return promjene.get(k);
  };
  const unutarPodrucja = (rel, korijen) => rel.slice(korijen.length + 1);
  for (const [rel, z] of Object.entries(novo.pracene)) {
    if (sada - z[1] < MIRNO_MS) { if (stareDat[rel]) stanje.datoteke[rel] = stareDat[rel]; continue; }
    stanje.datoteke[rel] = z;
    const s = stareDat[rel];
    if (!s) grupa(z).dodano.push(unutarPodrucja(rel, z[3]));
    else if (s[0] !== z[0] || s[1] !== z[1]) grupa(z).izmijenjeno.push(unutarPodrucja(rel, z[3]));
  }
  for (const [rel, s] of Object.entries(stareDat)) if (!novo.pracene[rel]) grupa(s).obrisano.push(unutarPodrucja(rel, s[3]));

  const dogadaji = [];
  const stare = [...promjene.values()].filter((g) => g.vrsta === "stare");
  for (const g of promjene.values()) {
    if (g.vrsta === "stare") continue;
    if (g.vrsta === "laser") { dogadaji.push({ vrsta: "laser", podrucje: g.podrucje, faza: g.faza, dodano: g.dodano, izmijenjeno: g.izmijenjeno, obrisano: g.obrisano }); continue; }
    // Revizije: nova datoteka iste osnove naziva kao ona koja je nestala (ili premještena u "Stare revizije", ili još postoji uz drugu oznaku).
    const kandidati = [...g.obrisano, ...stare.flatMap((x) => x.dodano.map((n) => path.basename(n)))];
    const postojece = Object.entries(staro.datoteke || {}).filter(([, s]) => s[3] === g.podrucje).map(([rel]) => unutarPodrucja(rel, g.podrucje));
    const revizije = [];
    for (const n of g.dodano) {
      const o = osnovaNaziva(n);
      const prije = kandidati.find((x) => x !== n && osnovaNaziva(x).baza === o.baza) || (o.rev ? postojece.find((x) => x !== n && osnovaNaziva(x).baza === o.baza && !g.obrisano.includes(x)) : null);
      if (prije) revizije.push({ naziv: n, prije });
    }
    // Stara revizija koja je nestala jer je zamijenjena (ili premještena u Stare revizije) ne javlja se još jednom kao "obrisano".
    const zamijenjene = new Set(revizije.map((x) => x.prije));
    dogadaji.push({ vrsta: "nacrti", gdje: g.vrsta, podrucje: g.podrucje, revizije, dodano: g.dodano, izmijenjeno: g.izmijenjeno, obrisano: g.obrisano.filter((x) => !zamijenjene.has(x)) });
  }
  const bila = new Set(staro.odobrenja || []);
  const nove = novo.odobrenja.filter((m) => !bila.has(m));
  if (nove.length) dogadaji.push({ vrsta: "odobrenje", mape: nove });
  // Ograniči duljinu popisa (ERP prikazuje prvih nekoliko i broj).
  for (const d of dogadaji) for (const k of ["dodano", "izmijenjeno", "obrisano", "mape"]) if (Array.isArray(d[k]) && d[k].length > 200) { d[`${k}Ukupno`] = d[k].length; d[k] = d[k].slice(0, 200); }
  return { dogadaji, stanje };
}

const procitajStanje = (datoteka) => { try { const s = JSON.parse(fs.readFileSync(datoteka, "utf8")); return s && typeof s.projekti === "object" ? s : { projekti: {} }; } catch { return { projekti: {} }; } };
const spremiStanje = (datoteka, stanje) => { const tmp = `${datoteka}.tmp`; fs.writeFileSync(tmp, JSON.stringify(stanje)); fs.renameSync(tmp, datoteka); };

// Jedan krug praćenja. ERP daje aktivne projekte; most ih pregleda i javi sažetke, događaje i ispravljene mape (preimenovana mapa).
export async function pratiDokumente(api, okolina, log, { datotekaStanja, sada = Date.now() } = {}) {
  const { projekti } = await api("GET", "/api/most/projekti-za-pracenje");
  if (!Array.isArray(projekti)) return { projekti: 0 };
  const korijeni = okolina.korijen;
  if (!korijeni.some((k) => fs.existsSync(k))) return { nedostupno: true };
  const staroStanje = procitajStanje(datotekaStanja);
  const novoStanje = { verzija: 1, projekti: {} };
  const izvjestaji = [], dogadaji = [], ispravljeneMape = [];
  for (const p of projekti) {
    if (!p?.id || !String(p.sifra || "").trim()) continue;
    let mapa;
    try { mapa = nadjiMapuProjekta(korijeni, String(p.sifra).trim(), p.mapa || ""); } catch (e) {
      izvjestaji.push({ projektId: p.id, greska: e instanceof Greska ? e.message : e.message });
      continue;
    }
    if (p.mapa && path.normalize(p.mapa) !== path.normalize(mapa)) ispravljeneMape.push({ projektId: p.id, stara: p.mapa, nova: mapa });
    const pregled = pregledajMapu(mapa);
    const staro = staroStanje.projekti[p.id];
    if (staro && staro.mapa === mapa) {
      const r = usporedi(staro, pregled, sada);
      dogadaji.push(...r.dogadaji.map((d) => ({ ...d, projektId: p.id })));
      novoStanje.projekti[p.id] = { mapa, ...r.stanje };
    } else {
      // Prvi pregled (ili promijenjena mapa): samo zapamti stanje, bez obavijesti.
      novoStanje.projekti[p.id] = { mapa, ...usporedi({ datoteke: {}, odobrenja: pregled.odobrenja }, pregled, sada).stanje };
    }
    izvjestaji.push({ projektId: p.id, mapa, podmape: pregled.podmape, ukupno: pregled.ukupno, zadnja: pregled.zadnja, prekinuto: pregled.prekinuto });
  }
  if (okolina.probno) {
    if (dogadaji.length) log(`[PROBNO] Mape projekata: ${dogadaji.length} promjena (ne javljaju se ERP-u).`);
    return { projekti: izvjestaji.length, dogadaji };
  }
  const odg = await api("POST", "/api/most/dokumenti", { projekti: izvjestaji, dogadaji, ispravljeneMape });
  spremiStanje(datotekaStanja, novoStanje);
  for (const d of dogadaji) log(`Promjena u mapi projekta (${d.vrsta}${d.podrucje ? `, ${d.podrucje}` : ""}): ${odg?.sifre?.[d.projektId] || d.projektId}`);
  return { projekti: izvjestaji.length, dogadaji };
}

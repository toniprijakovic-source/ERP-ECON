import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard, Package, Truck, Factory, Building2, Receipt, Users,
  Plus, Pencil, Trash2, X, Search, AlertTriangle, CheckCircle2, ArrowRight,
  Clock, ChevronRight, Save, PackageCheck, PackageMinus, Settings, Layers,
  ChevronDown, ChevronUp, FolderInput, Eye, UserCog, CalendarRange,
  Database, Download, Upload, AlertCircle, Copy, GripVertical, FileText, Scissors, Printer
} from "lucide-react";
import logoEcon from "./assets/logo-econ.jpg";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Čita zaposlenikId iz JWT-a bez provjere potpisa (potpis provjerava backend na svakom pozivu) — koristi se samo da frontend zna tko je prijavljen.
function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64).split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ============================== PROIZVODNE OPERACIJE ============================== */
const OPERACIJE = [
  { key: "pila", label: "Pila" },
  { key: "laserProfili", label: "Laser za profile" },
  { key: "laserLimovi", label: "Laser za limove" },
  { key: "kutnoSavijanje", label: "Kutno savijanje" },
  { key: "strojnaObrada", label: "Strojna obrada" },
  { key: "pripremaPozicija", label: "Priprema pozicija za sklapanje" },
  { key: "sklapanjeKonstrukcije", label: "Sklapanje - konstrukcije" },
  { key: "sklapanjeKupaonice", label: "Sklapanje - kupaonice" },
  { key: "zavarivanje", label: "Zavarivanje" },
  { key: "brusenje", label: "Brušenje" },
  { key: "ravnanje", label: "Ravnanje" },
  { key: "akz", label: "Bojanje" },
];
const praznaOperacijaSati = () => Object.fromEntries(OPERACIJE.map((o) => [o.key, 0]));

// Stvarna količina (kg) stavke materijala: iz dužine×komada×kg/m ako je taj način unosa odabran, inače upisana količina izravno.
// Korišteno posvuda (kalkulacija ponude, iznos narudžbenice, primanje/izdavanje sa skladišta) da izračuni ostanu točni bez obzira kad/kako je stavka nastala.
// Izračun fakture: osnovica (bez PDV-a), iznos PDV-a i ukupno za platiti
const izracunFakture = (faktura, pdvStopa) => {
  const osnovica = (faktura.stavke || []).reduce((s, st) => s + (Number(st.kolicina) || 0) * (Number(st.cijenaJed) || 0), 0);
  const stopa = Number(pdvStopa ?? 25);
  const pdvIznos = osnovica * (stopa / 100);
  return { osnovica, pdvIznos, stopa, ukupno: osnovica + pdvIznos };
};

const efektivnaKolicinaMaterijala = (st, mat) => {
  if (st?.nacinUnosa === "duzina" && mat?.kgPoM > 0) return (Number(st.duzinaM) || 0) * (Number(st.komada) || 0) * Number(mat.kgPoM);
  if (st?.nacinUnosa === "lim" && mat?.kgPoM2 > 0) return (Number(st.duzinaM) || 0) * (Number(st.sirinaM) || 0) * (Number(st.komada) || 0) * Number(mat.kgPoM2);
  return Number(st?.kolicina) || 0;
};

// Prirodna usporedba brojčanih oznaka (npr. "RN 140-933/2" vs "RN 170-317/10") — niz se rastavi
// na naizmjenične tekst/broj dijelove i brojevi se uspoređuju kao brojevi (ne slovima), pa "9"
// ide prije "10"; kod jednakog prvog broja odlučuje sljedeći (ono "nakon -"), pa dalje redom.
const usporediPrirodno = (a, b) => {
  const ax = String(a || "").match(/\d+|\D+/g) || [];
  const bx = String(b || "").match(/\d+|\D+/g) || [];
  const duljina = Math.max(ax.length, bx.length);
  for (let i = 0; i < duljina; i++) {
    const av = ax[i] ?? "", bv = bx[i] ?? "";
    const abroj = /^\d+$/.test(av), bbroj = /^\d+$/.test(bv);
    if (abroj && bbroj) { const razlika = Number(av) - Number(bv); if (razlika !== 0) return razlika; }
    else { const cmp = av.localeCompare(bv, "hr"); if (cmp !== 0) return cmp; }
  }
  return 0;
};

// Generator sljedećeg broja dokumenta (npr. "NAR-2026-101") koji gleda postojeće brojeve umjesto nasumičnog broja — sprječava duplikate
const sljedeciBroj = (lista, polje, prefiks, sirina = 3) => {
  const brojevi = (lista || []).map((x) => x?.[polje]).filter((b) => b && b.startsWith(prefiks)).map((b) => parseInt(b.slice(prefiks.length), 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 0) + 1;
  return `${prefiks}${String(sljedeci).padStart(sirina, "0")}`;
};

// Sljedeći broj otpremnice, format OTP-DD-MM-N/YY — N raste ako je isti dan već izdana otpremnica
const sljedeciBrojOtpremnice = (otpremnice, datumISO) => {
  const d = new Date(datumISO);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const prefiks = `OTP-${dd}-${mm}-`;
  const sufiks = `/${yy}`;
  const brojevi = (otpremnice || [])
    .map((o) => o?.broj)
    .filter((b) => b && b.startsWith(prefiks) && b.endsWith(sufiks))
    .map((b) => parseInt(b.slice(prefiks.length, b.length - sufiks.length), 10))
    .filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 0) + 1;
  return `${prefiks}${sljedeci}${sufiks}`;
};

// Sljedeći broj podloge za fakturu, format PDR-<šifra projekta>/N (N = redni broj obračuna za taj projekt)
const sljedeciBrojPodloge = (podloge, projektSifra) => {
  const prefiks = `PDR-${projektSifra}/`;
  const brojevi = (podloge || []).map((p) => p?.broj).filter((b) => b && b.startsWith(prefiks)).map((b) => parseInt(b.slice(prefiks.length), 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 0) + 1;
  return `${prefiks}${sljedeci}`;
};

// Sljedeći broj radnog naloga, format <šifra projekta>/N (N = redni broj naloga unutar tog projekta)
const sljedeciBrojRadnogNaloga = (radniNalozi, projektSifra) => {
  const prefiks = `${projektSifra}/`;
  const brojevi = (radniNalozi || []).map((r) => r?.broj).filter((b) => b && b.startsWith(prefiks)).map((b) => parseInt(b.slice(prefiks.length), 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 0) + 1;
  return `${prefiks}${sljedeci}`;
};

// Standardne dužine šipki (m) za optimizaciju rezanja profila i zadani postotak otpada za limove
const DULJINE_SIPKI_M = [6, 12];
const OTPAD_LIM_ZADANO = 10;

// Raspoređuje potrebne komade profila (po dužini) u standardne šipke: komadi se slažu od
// najdužeg prema najkraćem, svaki ide u prvu već otvorenu šipku u koju stane. Kad se mora
// otvoriti nova šipka, bira se ona standardna dužina (6/12 m) koja unaprijed najbolje pokrije
// i preostale komade (najviše ih upakira / ostavlja najmanje otpada) — ne uvijek najkraća
// koja stane trenutni komad, jer bi to npr. za pet komada od 4 m otvorilo pet šipki od 6 m
// (10 m otpada) umjesto dvije šipke od 12 m (4 m otpada, jer u 12 m stanu tri komada od 4 m).
const optimizirajProfile = (duljineKomada) => {
  const preostali = [...duljineKomada].sort((a, b) => b - a);
  const sipke = [];
  while (preostali.length) {
    const trenutni = preostali[0];
    const otvorena = sipke.find((s) => s.preostalo + 1e-9 >= trenutni);
    if (otvorena) { otvorena.preostalo -= trenutni; preostali.shift(); continue; }
    let najboljaDuljina = null, najboljiBrojKomada = -1, najboljiOtpad = Infinity;
    DULJINE_SIPKI_M.filter((d) => d + 1e-9 >= trenutni).forEach((kandidat) => {
      let preostaloProba = kandidat, brojKomada = 0;
      preostali.forEach((d) => { if (preostaloProba + 1e-9 >= d) { preostaloProba -= d; brojKomada++; } });
      if (brojKomada > najboljiBrojKomada || (brojKomada === najboljiBrojKomada && preostaloProba < najboljiOtpad)) {
        najboljaDuljina = kandidat; najboljiBrojKomada = brojKomada; najboljiOtpad = preostaloProba;
      }
    });
    sipke.push({ duljinaSipke: najboljaDuljina, preostalo: najboljaDuljina });
  }
  const brojPo6 = sipke.filter((s) => s.duljinaSipke === 6).length;
  const brojPo12 = sipke.filter((s) => s.duljinaSipke === 12).length;
  const ukupnoNabavljeno = sipke.reduce((s, x) => s + x.duljinaSipke, 0);
  const ukupnoPotrebno = duljineKomada.reduce((s, d) => s + d, 0);
  return { brojPo6, brojPo12, ukupnoNabavljeno, ukupnoPotrebno, otpadM: ukupnoNabavljeno - ukupnoPotrebno };
};

// Potreban sirovi materijal iz pozicija ponude: profili se optimiziraju u standardne šipke (6/12 m);
// limovi se ne slažu (2D nesting), nego se procjenjuje ukupna masa iz zbroja površina po debljini + otpad %
// — otpad se zadaje po tipu lima (katalogId), jer različite debljine/dimenzije limova imaju različit
// realan gubitak pri rezanju; ako korisnik nije sam upisao postotak za taj tip, koristi se zadani (10%).
const izracunPotrebnogMaterijala = (pozicije, katalog, otpadLimPoTipu = {}) => {
  const profiliPoTipu = new Map();
  const limoviPoTipu = new Map();

  (pozicije || []).forEach((p) => {
    const kolicina = Number(p.kolicina) || 0;
    (p.stavke || []).forEach((s) => {
      if (s.nacinMase !== "katalog" || !s.katalogId) return;
      const entry = katalog.find((k) => k.id === s.katalogId);
      if (!entry) return;
      const ukupnoKomada = (Number(s.komada) || 1) * kolicina;
      if (entry.jedinica === "kg/m2") {
        const povrsinaJed = ((Number(s.sirinaMM) || 0) * (Number(s.duzinaMM) || 0)) / 1e6;
        if (!limoviPoTipu.has(entry.id)) limoviPoTipu.set(entry.id, { oznaka: entry.oznaka, povrsinaM2: 0, kgPoM2: Number(entry.vrijednost) || 0 });
        limoviPoTipu.get(entry.id).povrsinaM2 += povrsinaJed * ukupnoKomada;
      } else {
        const duljinaM = Number(s.dimenzija) || 0;
        if (duljinaM <= 0) return;
        if (!profiliPoTipu.has(entry.id)) profiliPoTipu.set(entry.id, { oznaka: entry.oznaka, komadi: [] });
        for (let i = 0; i < ukupnoKomada; i++) profiliPoTipu.get(entry.id).komadi.push(duljinaM);
      }
    });
  });

  const profili = [...profiliPoTipu.entries()].map(([id, v]) => ({ katalogId: id, oznaka: v.oznaka, brojKomada: v.komadi.length, ...optimizirajProfile(v.komadi) }));
  const limovi = [...limoviPoTipu.entries()].map(([id, v]) => {
    const otpadPostotak = otpadLimPoTipu?.[id] ?? OTPAD_LIM_ZADANO;
    const povrsinaSOtpadom = v.povrsinaM2 * (1 + (Number(otpadPostotak) || 0) / 100);
    return { katalogId: id, oznaka: v.oznaka, povrsinaM2: v.povrsinaM2, kgPoM2: v.kgPoM2, otpadPostotak, masaKg: povrsinaSOtpadom * v.kgPoM2 };
  });
  return { profili, limovi };
};

// Izračun ponude: sati po operaciji (zbroj svih pozicija), trošak rada/materijala/ostalog,
// montaža po poziciji (broj montera × planirani sati × količina × satnica montaže — satnica je
// fiksna za cijelu ponudu), AKZ po poziciji (više stavki moguće, svaka = ukupna masa pozicije ×
// vlastita cijena €/kg), te konačna cijena s maržom.
const izracunPonude = (ponuda, materijali, cjenikRada, katalog = [], kvalitete = []) => {
  const satiPoOperaciji = praznaOperacijaSati();
  (ponuda.pozicije || []).forEach((p) => {
    OPERACIJE.forEach((o) => { satiPoOperaciji[o.key] += Number(p.operacije?.[o.key] || 0); });
  });
  const trosakRada = OPERACIJE.reduce((s, o) => s + satiPoOperaciji[o.key] * (Number(cjenikRada?.[o.key]) || 0), 0);
  // Trošak materijala se zbraja iz TRI izvora, sve po poziciji: stavke iz kataloga (profili/limovi,
  // cijena upisana izravno na stavci), materijal iz skladišta (svoj popis po poziciji), i eventualni
  // ručni "Materijal iz kalkulacije" (zajednički, za ono što ne pripada nijednoj stavci).
  const trosakMaterijala = (ponuda.pozicije || []).reduce((s, p) => s
    + trosakMaterijalaIzKatalogaPozicije(p, katalog, kvalitete)
    + (p.materijalStavke || []).reduce((s2, st) => {
      const m = materijali.find((x) => x.id === st.materijalId);
      const cijena = st.cijenaPoJed != null ? Number(st.cijenaPoJed) : (m ? m.cijena : 0);
      return s2 + cijena * efektivnaKolicinaMaterijala(st, m);
    }, 0), 0) + (ponuda.sirovineStavke || []).reduce((s, st) => s + (Number(st.kolicina) || 0) * (Number(st.cijenaJed) || 0), 0);
  // Ostalo (transport, projektiranje…) vodi se po poziciji, isto kao materijal.
  const trosakOstalo = (ponuda.pozicije || []).reduce((s, p) => s + (p.ostaleStavke || []).reduce((s2, st) => s2 + (Number(st.kolicina) || 0) * (Number(st.cijenaJed) || 0), 0), 0);
  const ukupnoSati = OPERACIJE.reduce((s, o) => s + satiPoOperaciji[o.key], 0);

  const satnicaMontaza = Number(ponuda.satnicaMontaza) || 0;
  const satiMontaze = (ponuda.pozicije || []).reduce((s, p) => s + (Number(p.brojMontera) || 0) * (Number(p.planiraniSatiMontaza) || 0) * (Number(p.kolicina) || 0), 0);
  const trosakMontaze = satiMontaze * satnicaMontaza;

  const ukupnaMasaKonstrukcije = (ponuda.pozicije || []).reduce((s, p) => s + masaPozicije(p, katalog, kvalitete) * (Number(p.kolicina) || 0), 0);

  const akzPoTipu = AKZ_TIPOVI.map((t) => ({ ...t, masa: 0, iznos: 0 }));
  (ponuda.pozicije || []).forEach((p) => {
    const masaUkupnaPoz = masaPozicije(p, katalog, kvalitete) * (Number(p.kolicina) || 0);
    (p.stavkeAKZ || []).forEach((a) => {
      const red = akzPoTipu.find((t) => t.key === a.tip);
      if (!red) return;
      red.masa += masaUkupnaPoz;
      red.iznos += masaUkupnaPoz * (Number(a.cijenaKg) || 0);
    });
  });
  const iznosAKZ = akzPoTipu.reduce((s, t) => s + t.iznos, 0);

  const ukupno = trosakRada + trosakMaterijala + trosakOstalo + trosakMontaze + iznosAKZ;
  const postotakMarze = Number(ponuda.postotakMarze) || 0;
  const iznosMarze = ukupno * (postotakMarze / 100);
  const cijenaKonacna = ukupno + iznosMarze;

  const potrebanMaterijal = izracunPotrebnogMaterijala(ponuda.pozicije || [], katalog, ponuda.otpadLimPoTipu);

  return {
    satiPoOperaciji, trosakRada, trosakMaterijala, trosakOstalo, ukupnoSati,
    satiMontaze, trosakMontaze, ukupnaMasaKonstrukcije, iznosAKZ, akzPoTipu,
    ukupno, postotakMarze, iznosMarze, cijenaKonacna, potrebanMaterijal,
  };
};

/* ============================== PONUDA ZA LASERSKO REZANJE ==============================
   Ponuda za uslugu laserskog rezanja (rezanje tuđeg materijala po nacrtu, ne izrada
   konstrukcije) — masa se za pločasti laser računa iz dimenzija × gustoća odabrane kvalitete
   materijala (isti princip kao pozicije u ponudi), a za cijevni laser iz dužine × mase po m'
   (isti princip kao profili na skladištu). Jedna stavka može imati VIŠE formata (različite
   dimenzije lima ili profila) — masa/trošak materijala se zbraja preko svih formata, dok su
   vrijeme rezanja/pripreme i opis zajednički za cijelu stavku (ne ovise o pojedinom formatu).
   Vrijeme rezanja/pripreme unosi se ručno jer ovisi o složenosti reza koju sustav ne može
   izvesti iz same geometrije. Dodatak (%) se računa na zbroj stavki; savijanje i ostale stavke
   dodaju se nakon toga bez dodatka (isto kao u predlošku iz kojeg je ovo preuzeto — Excel
   kalkulacija laserskog rezanja). */
const prazniCjenikLasera = () => ({ plocastiEurH: 150, pripremaPlocastiEurH: 40, cijevniEurH: 250, pripremaCijevniEurH: 150, savijanjeEurH: 40, dodatakPct: 10 });

const masaFormataLasera = (f, tipLasera, kvalitete) => {
  if (tipLasera === "cijevni") return ((Number(f.duzinaMM) || 0) / 1000) * (Number(f.komada) || 0) * (Number(f.kgPoM) || 0);
  const gustocaKgM3 = faktorGustoce(kvalitete, f.kvaliteta) * GUSTOCA_CELIKA * 1000;
  return ((Number(f.duzinaMM) || 0) / 1000) * ((Number(f.sirinaMM) || 0) / 1000) * ((Number(f.debljinaMM) || 0) / 1000) * gustocaKgM3 * (Number(f.komada) || 0);
};

const izracunStavkeLasera = (s, cjenik, kvalitete) => {
  const formati = (s.formati || []).map((f) => ({ ...f, masaKg: masaFormataLasera(f, s.tipLasera, kvalitete) }));
  const masaKg = formati.reduce((sum, f) => sum + f.masaKg, 0);
  const trosakMaterijala = formati.reduce((sum, f) => sum + f.masaKg * (Number(f.cijenaMaterijalaEurKg) || 0), 0);
  const satRezanja = s.tipLasera === "cijevni" ? Number(cjenik.cijevniEurH) || 0 : Number(cjenik.plocastiEurH) || 0;
  const satPripreme = s.tipLasera === "cijevni" ? Number(cjenik.pripremaCijevniEurH) || 0 : Number(cjenik.pripremaPlocastiEurH) || 0;
  const trosakRezanja = ((Number(s.rezanjeMin) || 0) / 60) * satRezanja;
  const trosakPripreme = ((Number(s.pripremaMin) || 0) / 60) * satPripreme;
  return { formati, masaKg, trosakRezanja, trosakPripreme, trosakMaterijala, ukupno: trosakRezanja + trosakPripreme + trosakMaterijala };
};

const izracunPonudeLasera = (ponuda, kvalitete = []) => {
  const cjenik = { ...prazniCjenikLasera(), ...(ponuda.cjenik || {}) };
  const stavke = (ponuda.stavke || []).map((s) => ({ ...s, ...izracunStavkeLasera(s, cjenik, kvalitete) }));
  const zbrojStavki = stavke.reduce((s, st) => s + st.ukupno, 0);
  const dodatakPct = Number(cjenik.dodatakPct) || 0;
  const iznosDodatka = zbrojStavki * (dodatakPct / 100);
  const brojPregiba = Number(ponuda.savijanje?.brojPregiba) || 0;
  const minPoKom = Number(ponuda.savijanje?.minPoKom) || 0;
  const trosakSavijanja = ((brojPregiba * minPoKom) / 60) * (Number(cjenik.savijanjeEurH) || 0);
  const trosakOstalo = (ponuda.ostaleStavke || []).reduce((s, st) => s + (Number(st.kolicina) || 0) * (Number(st.cijenaJed) || 0), 0);
  const cijenaKonacna = zbrojStavki + iznosDodatka + trosakSavijanja + trosakOstalo;
  return { cjenik, stavke, zbrojStavki, dodatakPct, iznosDodatka, trosakSavijanja, trosakOstalo, cijenaKonacna };
};

/* ============================== NORMATIV TIPSKIH PROJEKATA ==============================
   Za dugoročno ugovorene poslove (npr. kupaonice) cijena i vrijeme ne unose se ručno po poziciji,
   nego se izvode iz mase: cijena = masa × €/kg, sati = masa ÷ (kg/h), a ti sati se zatim
   raspoređuju po operacijama prema postotku. Dvije grupe jer postoje dvije ugovorene cijene:
   "pod" (podna konstrukcija) i "komplet" (stranice + krov + spojni profili). */
const zbrojRaspodjele = (raspodjela) => OPERACIJE.reduce((s, o) => s + (Number(raspodjela?.[o.key]) || 0), 0);

// Pod i komplet naručuju se kao potpuno nezavisne stavke (različite oznake tipova i
// različite količine u narudžbenici — npr. "Pod Typ A1 EG" nema par u stranicama jer
// dijeli isti dizajn stranica kao "Pod Typ A1"), zato se svaka grupa unosi zasebno.
const izracunStavke = (stavka, grupa) => {
  const kom = Number(stavka.komada) || 0;
  const masaUk = (Number(stavka.masaJed) || 0) * kom;
  const vrijednost = masaUk * (Number(grupa?.cijenaKg) || 0);
  const sati = Number(grupa?.ucinakKgH) > 0 ? masaUk / Number(grupa.ucinakKgH) : 0;
  const satiPoOperaciji = praznaOperacijaSati();
  OPERACIJE.forEach((o) => { satiPoOperaciji[o.key] = sati * ((Number(grupa?.raspodjela?.[o.key]) || 0) / 100); });
  return { masaUk, vrijednost, sati, satiPoOperaciji };
};

const izracunSkupine = (stavke, grupa) => {
  const poStavci = (stavke || []).map((s) => ({ stavka: s, ...izracunStavke(s, grupa) }));
  const ukupno = { komada: 0, masaUk: 0, vrijednost: 0, sati: 0, satiPoOperaciji: praznaOperacijaSati() };
  poStavci.forEach((r) => {
    ukupno.komada += Number(r.stavka.komada) || 0;
    ukupno.masaUk += r.masaUk;
    ukupno.vrijednost += r.vrijednost;
    ukupno.sati += r.sati;
    OPERACIJE.forEach((o) => { ukupno.satiPoOperaciji[o.key] += r.satiPoOperaciji[o.key]; });
  });
  return { poStavci, ukupno };
};

const izracunTipskogProjekta = (projekt, normativi) => {
  const grupa = (kljuc) => (normativi?.grupe || []).find((g) => g.kljuc === kljuc);
  const pod = izracunSkupine(projekt.stavkePod, grupa("pod"));
  const komplet = izracunSkupine(projekt.stavkeKomplet, grupa("komplet"));
  const ukupno = {
    masaUk: pod.ukupno.masaUk + komplet.ukupno.masaUk,
    vrijednost: pod.ukupno.vrijednost + komplet.ukupno.vrijednost,
    sati: pod.ukupno.sati + komplet.ukupno.sati,
    satiPoOperaciji: praznaOperacijaSati(),
  };
  OPERACIJE.forEach((o) => { ukupno.satiPoOperaciji[o.key] = pod.ukupno.satiPoOperaciji[o.key] + komplet.ukupno.satiPoOperaciji[o.key]; });
  return { pod, komplet, ukupno };
};

/* ============================== OBRAČUN PLAĆA ==============================
   Satnica se izvodi iz bodova i staža, a plaća se gradi iz STVARNO odrađenih sati.
   Osnovica (bodovi × vrijednost boda + dodatak na staž) služi samo za izračun satnice. */

const VRSTE_DANA = [
  { key: "rad", label: "Rad" },
  { key: "godisnji", label: "Godišnji odmor" },
  { key: "bolovanje", label: "Bolovanje" },
  { key: "ocinski", label: "Očinski" },
  { key: "roditeljski", label: "Roditeljski" },
  { key: "detasman", label: "Detašman" },
  { key: "placeniDopust", label: "Plaćeni dopust" },
  { key: "sluzbeniPut", label: "Službeni put" },
];
// Kratke oznake za ćelije evidencije i legendu — boja + slovna kratica po vrsti dana (osim "rad").
const OZNAKA_VRSTE_DANA = {
  godisnji: { kratica: "GO", boja: "#215C77", bg: "#EAF3F7", naziv: "Godišnji odmor" },
  bolovanje: { kratica: "BO", boja: "#8A6100", bg: "#FDF6E3", naziv: "Bolovanje" },
  ocinski: { kratica: "OČ", boja: "#9A4A1B", bg: "#FBEEE4", naziv: "Očinski" },
  roditeljski: { kratica: "RD", boja: "#8A2E63", bg: "#F8E8F1", naziv: "Roditeljski" },
  detasman: { kratica: "DE", boja: "#4A6A21", bg: "#EEF3E6", naziv: "Detašman" },
  placeniDopust: { kratica: "PD", boja: "#6B3FA0", bg: "#F1EAF7", naziv: "Plaćeni dopust" },
  sluzbeniPut: { kratica: "SP", boja: "#1B6B78", bg: "#E5F2F3", naziv: "Službeni put" },
};

// Pune godine staža na zadani datum, uvećane za ručno uneseni staž iz prijašnjeg zaposlenja u
// tvrtki (za zaposlenike koji su otišli pa se vratili — datumZaposlenja odražava samo zadnji
// povratak, pa se raniji period ne može automatski izračunati iz njega).
const godineStaza = (datumZaposlenja, naDatum, dodatniStaz = 0) => {
  if (!datumZaposlenja) return Math.max(0, Number(dodatniStaz) || 0);
  const od = new Date(datumZaposlenja);
  const do_ = new Date(naDatum);
  let g = do_.getFullYear() - od.getFullYear();
  const prijeGodisnjice = do_.getMonth() < od.getMonth() || (do_.getMonth() === od.getMonth() && do_.getDate() < od.getDate());
  if (prijeGodisnjice) g--;
  return Math.max(0, g) + (Number(dodatniStaz) || 0);
};

// Satnica = (bodovi × vrijednost boda) / godišnji (prosječni mjesečni) fond sati. Dodatak na staž
// NE ulazi u satnicu — računa se zasebno po danu (vidi obracunMjeseca), pa se ovdje vraća samo
// iznos staža po jednom danu (godine staža × dodatak po godini).
const satnicaZaposlenika = (zaposlenik, postavke, naDatum = todayISO()) => {
  const bodovi = Number(zaposlenik?.bodovi) || 0;
  const osnovica = bodovi * (Number(postavke?.vrijednostBoda) || 0);
  // Zaposlenici na pola radnog vremena — samo se staž izračunat od datuma zaposlenja priznaje
  // na pola; ručno dodani staž iz prijašnjeg zaposlenja ide u punom iznosu.
  const stazOdDatuma = godineStaza(zaposlenik?.datumZaposlenja, naDatum);
  const dodatniStaz = Number(zaposlenik?.dodatniStazGodine) || 0;
  const staz = (zaposlenik?.radnoVrijeme === "pola" ? stazOdDatuma / 2 : stazOdDatuma) + dodatniStaz;
  const stazPoDanu = staz * (Number(postavke?.dodatakStazPoGodini) || 0);
  const fond = Number(postavke?.fondSatiMjesec) || 0;
  return { bodovi, osnovica, staz, stazPoDanu, satnica: fond > 0 ? osnovica / fond : 0 };
};

// Broj radnih dana (pon-pet) u mjesecu "YYYY-MM" — koristi se za dodatak na staž.
const radniDaniUMjesecu = (mjesec) => {
  const [g, m] = mjesec.split("-").map(Number);
  const brojDana = new Date(g, m, 0).getDate();
  let broj = 0;
  for (let dan = 1; dan <= brojDana; dan++) {
    const dow = new Date(g, m - 1, dan).getDay();
    if (dow >= 1 && dow <= 5) broj++;
  }
  return broj;
};

const jePraznik = (datumISO, praznici) => (praznici || []).some((p) => p.datum === datumISO);

/* --- Smjene i obračunsko zaokruživanje ---
   Obračunska jedinica je 30 min. Raniji dolazak od početka smjene se NE priznaje
   (računa se od početka smjene); kasniji dolazak zaokružuje se na sljedeću jedinicu.
   Odjava se uvijek zaokružuje na prethodnu jedinicu.
   Primjer: 5:25–14:15 → 06:00–14:00 = 8 h; 6:05–14:28 → 06:30–14:00 = 7,5 h. */

const minOdPonoci = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const minPocetkaSmjene = (smjena) => { const [h, m] = String(smjena?.pocetak || "06:00").split(":").map(Number); return h * 60 + (m || 0); };

const odrediSmjenu = (dolazakISO, postavke) => {
  const smjene = postavke?.smjene || [];
  if (!smjene.length) return { kljuc: "jutarnja", naziv: "Jutarnja", pocetak: "06:00", dodatakPostotak: 0 };
  const m = minOdPonoci(dolazakISO);
  return smjene.reduce((naj, s) => (Math.abs(m - minPocetkaSmjene(s)) < Math.abs(m - minPocetkaSmjene(naj)) ? s : naj), smjene[0]);
};

const obracunskiSati = (dolazakISO, odlazakISO, smjena, postavke) => {
  if (!odlazakISO) return 0;
  const J = Number(postavke?.obracunskaJedinicaMin) || 30;
  const ps = minPocetkaSmjene(smjena);
  let start = minOdPonoci(dolazakISO);
  start = start < ps ? ps : Math.ceil(start / J) * J;
  let end = Math.floor(minOdPonoci(odlazakISO) / J) * J;
  // smjena koja prelazi ponoć
  if (odlazakISO.slice(0, 10) > dolazakISO.slice(0, 10)) end += 24 * 60;
  return Math.max(0, (end - start) / 60);
};

// Obračun jednog dana evidencije. dan: 0=ned, 6=sub
const obracunDana = (zapis, zaposlenik, postavke, praznici, satnica = 0) => {
  const datum = zapis.vrijemeDolaska.slice(0, 10);
  const vrsta = zapis.vrsta || "rad";
  const danUTjednu = new Date(datum).getDay();
  const norma = Number(postavke?.normaSatiDan) || 8;
  const praznik = jePraznik(datum, praznici);

  const smjena = odrediSmjenu(zapis.vrijemeDolaska, postavke);
  const dodatakSmjene = 1 + (Number(smjena?.dodatakPostotak) || 0) / 100;
  // Sati se obračunavaju zaokruženo na obračunsku jedinicu (raniji dolazak se ne priznaje)
  const odradjeniSati = vrsta === "rad" ? obracunskiSati(zapis.vrijemeDolaska, zapis.vrijemeOdlaska, smjena, postavke) : 0;

  // Kategorije plaćenih neradnih sati vode se odvojeno (praznik/godišnji/dopust/bolovanje) —
  // isti ukupni "placeniNerad" ostaje zbroj svih plaćenih (bolovanje se evidentira, ali NE
  // plaća, pa se ne zbraja u placeniNerad — pravilo obračuna bolovanja još nije definirano).
  let redovni = 0, prekovremeni = 0, placeniNerad = 0;
  let praznikSati = 0, godisnjiSati = 0, dopustSati = 0, detasmanSati = 0, bolovanjeSati = 0, ocinskiSati = 0, roditeljskiSati = 0;
  if (praznik) {
    placeniNerad = norma;
    praznikSati = norma;
  } else if (vrsta === "godisnji") {
    placeniNerad = norma;
    godisnjiSati = norma;
  } else if (vrsta === "detasman") {
    placeniNerad = norma; // detašman se plaća kao puna norma, ali se vodi odvojeno od plaćenog dopusta
    detasmanSati = norma;
  } else if (vrsta === "placeniDopust" || vrsta === "sluzbeniPut") {
    placeniNerad = norma; // plaćeni dopust i službeni put plaćaju se kao puna norma
    dopustSati = norma;
  } else if (vrsta === "bolovanje") {
    placeniNerad = 0; // PRAVILO JOŠ NIJE DEFINIRANO — evidentira se, ne ulazi u obračun
    bolovanjeSati = norma;
  } else if (vrsta === "ocinski") {
    placeniNerad = 0; // kao bolovanje: evidentira se, ne ulazi u obračun
    ocinskiSati = norma;
  } else if (vrsta === "roditeljski") {
    placeniNerad = 0; // kao bolovanje: evidentira se, ne ulazi u obračun
    roditeljskiSati = norma;
  } else if (danUTjednu === 6 || danUTjednu === 0) {
    prekovremeni = odradjeniSati; // subota je cijela prekovremena; nedjelja se ne radi
  } else {
    redovni = Math.min(odradjeniSati, norma);
    prekovremeni = Math.max(odradjeniSati - norma, 0);
  }
  const jeSluzbeniPut = vrsta === "sluzbeniPut";
  // Dodatak na staž ide za svaki dan stvarnog rada od 4+ sata i za plaćene izostanke (praznik,
  // godišnji, detašman, plaćeni dopust, službeni put) — NE za bolovanje, očinski i roditeljski,
  // i samo od ponedjeljka do petka (radne subote se ne računaju).
  // Odluka se donosi po DATUMU (ne po zapisu) u obracunMjeseca, jer dan može imati više zapisa.
  const placenIzostanak = praznik || (vrsta !== "rad" && !["bolovanje", "ocinski", "roditeljski"].includes(vrsta));
  const satiZaStaz = vrsta === "rad" && !praznik ? odradjeniSati : 0;

  // Zaposlenici na pola radnog vremena dobivaju putni trošak i topli obrok prepolovljene.
  const faktorRadnogVremena = zaposlenik?.radnoVrijeme === "pola" ? 0.5 : 1;
  const jeRadniDan = vrsta === "rad" && odradjeniSati > 0 && !praznik;
  const putni = jeRadniDan ? (Number(zaposlenik?.udaljenostKm) || 0) * (Number(postavke?.cijenaKm) || 0) * faktorRadnogVremena : 0;
  const topliObrok = jeRadniDan && !zaposlenik?.koristiPrehranuUTvrtki && odradjeniSati >= (Number(postavke?.topliObrokMinSati) || 6)
    ? (Number(postavke?.topliObrokIznos) || 0) * faktorRadnogVremena : 0;

  // Dodatak za smjenu i prekovremeni ZBRAJAJU se, ne množe:
  // popodnevna do 8h = ×1,2; iznad 8h = ×(1,2 + 0,5) = ×1,7
  const faktorPrek = Number(postavke?.prekovremeniFaktor) || 1.5;
  const faktorPrekSaSmjenom = dodatakSmjene + faktorPrek - 1;
  const iznosRedovni = redovni * satnica * dodatakSmjene;
  const iznosPrekovremeni = prekovremeni * satnica * faktorPrekSaSmjenom;
  const iznosNerad = placeniNerad * satnica;

  return {
    datum, vrsta, danUTjednu, praznik, smjena, dodatakSmjene, faktorPrekSaSmjenom,
    odradjeniSati, redovni, prekovremeni, placeniNerad, putni, topliObrok,
    praznikSati, godisnjiSati, dopustSati, detasmanSati, bolovanjeSati, ocinskiSati, roditeljskiSati, jeSluzbeniPut, placenIzostanak, satiZaStaz,
    iznosRedovni, iznosPrekovremeni, iznosNerad,
    ukupnoDan: iznosRedovni + iznosPrekovremeni + iznosNerad + putni + topliObrok,
  };
};

// Mjesečni obračun za jednog zaposlenika. mjesec u formatu "2026-09"
const obracunMjeseca = (zaposlenik, mjesec, db) => {
  const postavke = db.postavkePlaca;
  const radniDaniMjeseca = radniDaniUMjesecu(mjesec);
  const { satnica, ...osnova } = satnicaZaposlenika(zaposlenik, postavke, `${mjesec}-01`);
  const sviZapisi = (db.evidencijaRada || []).filter((e) => e.zaposlenikId === zaposlenik.id && e.vrijemeDolaska.slice(0, 7) === mjesec);
  // Cjelodnevna vrsta (godišnji, bolovanje, detašman...) vrijedi JEDNOM po datumu — ako je
  // greškom unesena dvaput, drugi zapis se ignorira da se dan ne plati/ne računa dvostruko.
  const vidjenoPosebno = new Set();
  const zapisi = sviZapisi.filter((e) => {
    if ((e.vrsta || "rad") === "rad") return true;
    const k = e.vrijemeDolaska.slice(0, 10);
    if (vidjenoPosebno.has(k)) return false;
    vidjenoPosebno.add(k);
    return true;
  });
  const dani = zapisi.map((z) => obracunDana(z, zaposlenik, postavke, db.praznici, satnica));

  // Praznici u mjesecu za koje zaposlenik nema NIKAKAV zapis (npr. cijela tvrtka ne radi tog
  // dana) svejedno se plaćaju kao puna norma — ali samo ako padaju na radni dan (pon-pet).
  const datumiSaZapisom = new Set(dani.map((d) => d.datum));
  const [g, m] = mjesec.split("-").map(Number);
  const brojDanaMjeseca = new Date(g, m, 0).getDate();
  for (let dan = 1; dan <= brojDanaMjeseca; dan++) {
    const datum = `${mjesec}-${String(dan).padStart(2, "0")}`;
    const dow = new Date(g, m - 1, dan).getDay();
    if (jePraznik(datum, db.praznici) && dow >= 1 && dow <= 5 && !datumiSaZapisom.has(datum)) {
      dani.push(obracunDana({ vrijemeDolaska: `${datum}T00:00:00`, vrijemeOdlaska: null, vrsta: "rad" }, zaposlenik, postavke, db.praznici, satnica));
    }
  }

  const zbroj = dani.reduce((s, d) => ({
    redovni: s.redovni + d.redovni,
    prekovremeni: s.prekovremeni + d.prekovremeni,
    placeniNerad: s.placeniNerad + d.placeniNerad,
    putni: s.putni + d.putni,
    topliObrok: s.topliObrok + d.topliObrok,
    odradjeni: s.odradjeni + d.odradjeniSati,
    // sati odrađeni u smjeni s dodatkom (za prikaz)
    satiSDodatkom: s.satiSDodatkom + (d.dodatakSmjene > 1 ? d.redovni + d.prekovremeni : 0),
    iznosRedovni: s.iznosRedovni + d.iznosRedovni,
    iznosPrekovremeni: s.iznosPrekovremeni + d.iznosPrekovremeni,
    iznosNerad: s.iznosNerad + d.iznosNerad,
    praznikSati: s.praznikSati + d.praznikSati,
    godisnjiSati: s.godisnjiSati + d.godisnjiSati,
    dopustSati: s.dopustSati + d.dopustSati,
    detasmanSati: s.detasmanSati + d.detasmanSati,
    bolovanjeSati: s.bolovanjeSati + d.bolovanjeSati,
    ocinskiSati: s.ocinskiSati + d.ocinskiSati,
    roditeljskiSati: s.roditeljskiSati + d.roditeljskiSati,
    danaSluzbenogPuta: s.danaSluzbenogPuta + (d.jeSluzbeniPut ? 1 : 0),
  }), { redovni: 0, prekovremeni: 0, placeniNerad: 0, putni: 0, topliObrok: 0, odradjeni: 0, satiSDodatkom: 0, iznosRedovni: 0, iznosPrekovremeni: 0, iznosNerad: 0, praznikSati: 0, godisnjiSati: 0, dopustSati: 0, detasmanSati: 0, bolovanjeSati: 0, ocinskiSati: 0, roditeljskiSati: 0, danaSluzbenogPuta: 0 });

  // Dani za dodatak na staž (po jedinstvenom datumu, samo pon-pet): dan stvarnog rada 4+ h
  // (zbroj svih segmenata tog dana) ili plaćeni izostanak.
  const poDatumuStaz = new Map();
  dani.forEach((d) => {
    const e = poDatumuStaz.get(d.datum) || { sati: 0, izostanak: false, dow: d.danUTjednu };
    e.sati += d.satiZaStaz;
    e.izostanak = e.izostanak || d.placenIzostanak;
    poDatumuStaz.set(d.datum, e);
  });
  zbroj.daniStaza = [...poDatumuStaz.values()].filter((e) => e.dow >= 1 && e.dow <= 5 && (e.izostanak || e.sati >= 4)).length;

  // Dnevnica za službeni put + ručni mjesečni dodaci/odbici (stimulacija, kredit, usteg
  // prehrane) — potonji se upisuju ručno po zaposleniku/mjesecu jer ne proizlaze iz sati.
  // Dodatak na staž: staž po danu × broj dana koji se računaju (vidi danStaza u obracunDana).
  const dodatakStaz = osnova.stazPoDanu * zbroj.daniStaza;
  // Mjesečni fond = radni dani (pon-pet) × norma. Plaća se samo ostvareno (sati × satnica), a
  // "satnica za taj mjesec" se korigira na ostvareno / fond — samo za prikaz.
  const mjesecniFond = radniDaniMjeseca * (Number(postavke?.normaSatiDan) || 8);
  const ostvareniSati = zbroj.redovni + zbroj.placeniNerad;
  const satnicaKorigirana = mjesecniFond > 0 ? (ostvareniSati * satnica) / mjesecniFond : satnica; // za ured se ne koristi (fiksna plaća)
  // TEHNIČKI URED I ADMINISTRACIJA: neto plaća (bodovi × bod) je FIKSNI iznos za mjesečni fond
  // sati — ne množi se satima. Razmjerno se umanjuje za dane bolovanja/očinskog/roditeljskog te za
  // radne dane prije datuma zaposlenja. Godišnji, praznici i sl. su unutar fiksnog iznosa.
  // Prekovremeni se računaju kao i svima: sati × satnica × 1,5.
  const jeUred = grupaEvidencije(zaposlenik, db.pozicijeZaposlenika) === "ostalo";
  const norma = Number(postavke?.normaSatiDan) || 8;
  let neplaceniDaniUred = 0;
  let fiksnaPlacaPuna = 0, fiksnaPlaca = 0, faktorFiksne = 1;
  if (jeUred) {
    const radniDanVrijednost = (d) => d.danUTjednu >= 1 && d.danUTjednu <= 5;
    const daniBolovanja = dani.filter((d) => radniDanVrijednost(d) && !(zaposlenik.datumZaposlenja && d.datum < zaposlenik.datumZaposlenja) && (d.bolovanjeSati > 0 || d.ocinskiSati > 0 || d.roditeljskiSati > 0)).length;
    let daniPrijeZaposlenja = 0;
    if (zaposlenik.datumZaposlenja && zaposlenik.datumZaposlenja > `${mjesec}-01`) {
      for (let dan = 1; dan <= brojDanaMjeseca; dan++) {
        const datum = `${mjesec}-${String(dan).padStart(2, "0")}`;
        const dow = new Date(g, m - 1, dan).getDay();
        if (dow >= 1 && dow <= 5 && datum < zaposlenik.datumZaposlenja) daniPrijeZaposlenja++;
      }
    }
    neplaceniDaniUred = daniBolovanja + daniPrijeZaposlenja;
    // Pola radnog vremena: fiksna plaća se dijeli na pola (kao i putni, topli obrok i staž).
    fiksnaPlacaPuna = osnova.osnovica * (zaposlenik.radnoVrijeme === "pola" ? 0.5 : 1);
    faktorFiksne = mjesecniFond > 0 ? Math.max(0, 1 - (neplaceniDaniUred * norma) / mjesecniFond) : 1;
    fiksnaPlaca = fiksnaPlacaPuna * faktorFiksne;
  }
  const iznosRedovni = jeUred ? fiksnaPlaca : zbroj.iznosRedovni;
  const iznosNerad = jeUred ? 0 : zbroj.iznosNerad;
  const dnevnicaTeren = zbroj.danaSluzbenogPuta * (Number(postavke?.dnevnicaTerenEurDan) || 0);
  const doplatak = (db.doplaciPlaca || []).find((d) => d.zaposlenikId === zaposlenik.id && d.mjesec === mjesec) || {};

  // "Prikaz prekovremenih (h)" — koliko od stvarno ostvarenih prekovremenih sati se PRIKAZUJE u
  // obračunu/PDF-u; prazno polje ili 0 znači da se ništa ne prikazuje kao prekovremeni, nego se
  // CIJELA novčana vrijednost prebacuje u stimulaciju. Razlika se uvijek prebacuje po prosječnoj
  // cijeni sata prekovremenog za taj mjesec (zbroj.iznosPrekovremeni / zbroj.prekovremeni), pa je
  // isplata zaposleniku ista bez obzira na ovu postavku — mijenja se samo raspodjela prikaza.
  // Dnevni detalj (dani) ostaje netaknut i uvijek prikazuje stvarne, pune brojke.
  const stopaPrekovremenog = zbroj.prekovremeni > 0 ? zbroj.iznosPrekovremeni / zbroj.prekovremeni : 0;
  const prekovremeniPrikaz = Math.max(0, Math.min(Number(doplatak.prikazPrekovremenihSati) || 0, zbroj.prekovremeni));
  const iznosPrekovremeniPrikaz = prekovremeniPrikaz * stopaPrekovremenog;
  const visakPrekovremenihSati = zbroj.prekovremeni - prekovremeniPrikaz;
  const visakPrekovremenihIznos = zbroj.iznosPrekovremeni - iznosPrekovremeniPrikaz;

  // Višak prekovremenih (koji se ne prikazuje) uzima se prvo iz SUBOTNJIH sati — za te subote
  // naknada za prijevoz i topli obrok također idu u stimulaciju (razmjerno udjelu subotnjih
  // sati koji se ne prikazuju), da se subotnji rad ne vidi u prikazanim stavkama.
  const suboteRad = dani.filter((d) => d.danUTjednu === 6 && d.prekovremeni > 0);
  const suboteSati = suboteRad.reduce((s, d) => s + d.prekovremeni, 0);
  const udioSubotaUStimulaciji = suboteSati > 0 ? Math.min(visakPrekovremenihSati, suboteSati) / suboteSati : 0;
  const prebacenoPutni = suboteRad.reduce((s, d) => s + d.putni, 0) * udioSubotaUStimulaciji;
  const prebacenoObrok = suboteRad.reduce((s, d) => s + d.topliObrok, 0) * udioSubotaUStimulaciji;
  const prebacenoSubota = prebacenoPutni + prebacenoObrok;
  const putni = zbroj.putni - prebacenoPutni;
  const topliObrok = zbroj.topliObrok - prebacenoObrok;
  const daniObroka = dani.filter((d) => d.topliObrok > 0).length - Math.round(suboteRad.filter((d) => d.topliObrok > 0).length * udioSubotaUStimulaciji);

  const ukupno = iznosRedovni + iznosPrekovremeniPrikaz + iznosNerad + dodatakStaz + putni + topliObrok;

  // stimulacija = ono što se STVARNO isplaćuje (ručno upisano + automatski prebačeni višak
  // prekovremenih) — stimulacijaRucno je SAMO ručno upisani dio, za uređivanje u obrascu (da se
  // izbjegne da se prikazana zbrojena vrijednost spremi natrag kao da je sva ručno upisana).
  const stimulacijaRucno = Number(doplatak.stimulacija) || 0;
  const stimulacija = stimulacijaRucno + visakPrekovremenihIznos + prebacenoSubota;
  const kredit = Number(doplatak.kredit) || 0;
  const ustegPrehrane = Number(doplatak.ustegPrehrane) || 0;
  const dodaciUkupno = topliObrok + dnevnicaTeren + putni;
  const isplata = iznosRedovni + iznosPrekovremeniPrikaz + iznosNerad + dodatakStaz + stimulacija + dodaciUkupno - kredit - ustegPrehrane;

  return {
    zaposlenik, satnica, satnicaKorigirana, mjesecniFond, ostvareniSati, dodatakStaz, radniDaniMjeseca, ...osnova, ...zbroj,
    prekovremeniStvarno: zbroj.prekovremeni, iznosPrekovremeniStvarno: zbroj.iznosPrekovremeni,
    prekovremeni: prekovremeniPrikaz, iznosPrekovremeni: iznosPrekovremeniPrikaz,
    prikazPrekovremenihSati: doplatak.prikazPrekovremenihSati ?? "", visakPrekovremenihSati, visakPrekovremenihIznos,
    putni, topliObrok, daniObroka, prebacenoPutni, prebacenoObrok, prebacenoSubota,
    jeUred, polaRadnoVrijeme: zaposlenik.radnoVrijeme === "pola", iznosRedovni, iznosNerad, fiksnaPlacaPuna, fiksnaPlaca, faktorFiksne, neplaceniDaniUred,
    ukupno, brojDana: dani.length, dani, dnevnicaTeren, stimulacija, stimulacijaRucno, kredit, ustegPrehrane, dodaciUkupno, isplata,
  };
};

// Kooperanti se ne obračunavaju po formuli plaće (bodovi/staž/topli obrok/putni) nego
// jednostavno: odrađeni sati (isto obračunsko zaokruživanje kao za zaposlenike) × njihova
// ugovorena satnica — zato se posebno prepoznaju po nazivu pozicije i drže odvojeno od
// redovnog obračuna plaća.
const jeKooperant = (zaposlenik, pozicije) => (pozicije || []).find((p) => p.id === zaposlenik?.pozicijaId)?.naziv?.trim().toLowerCase() === "kooperant";
// Vanjski suradnik — zasebna pozicija od Kooperanta: evidencija dolazaka/odlazaka mu se vodi
// normalno, ali se NE plaća po satu nego fiksnim dogovorenim mjesečnim iznosom + fiksnom
// naknadom za prijevoz (oba sa zapisa zaposlenika), bez obzira na broj odrađenih sati tog mjeseca.
const jeVanjskiSuradnik = (zaposlenik, pozicije) => (pozicije || []).find((p) => p.id === zaposlenik?.pozicijaId)?.naziv?.trim().toLowerCase() === "vanjski suradnik";
// Operater na laseru ima svedeni prikaz (samo Plan rezanja) i ne vidi administrativne alate poput Backupa.
const jeOperaterLasera = (pozicija) => (pozicija?.naziv || "").trim().toLowerCase() === "operater na laseru";

// Dodatna podjela za pregled u Evidenciji rada i Obračunu plaća — po nazivu pozicije, istim
// principom kao jeKooperant. Sve pozicije koje nisu ni radiona, ni praktikant, ni kooperant,
// spadaju u "ostalo" (tehnički ured i administracija).
const RADIONA_POZICIJE = ["voditelj proizvodnje", "skladištar", "zaposlenik", "operater na laseru"];
const grupaEvidencije = (zaposlenik, pozicije) => {
  const naziv = (pozicije || []).find((p) => p.id === zaposlenik?.pozicijaId)?.naziv?.trim().toLowerCase() || "";
  if (naziv === "kooperant") return "kooperant";
  if (naziv === "praktikant") return "praktikant";
  if (RADIONA_POZICIJE.includes(naziv)) return "radiona";
  return "ostalo";
};

const obracunMjesecaKooperant = (zaposlenik, mjesec, db) => {
  const postavke = db.postavkePlaca;
  const zapisi = (db.evidencijaRada || []).filter((e) => e.zaposlenikId === zaposlenik.id && e.vrijemeDolaska.slice(0, 7) === mjesec && (e.vrsta || "rad") === "rad" && e.vrijemeOdlaska);
  const dani = zapisi.map((z) => {
    const smjena = odrediSmjenu(z.vrijemeDolaska, postavke);
    return { datum: z.vrijemeDolaska.slice(0, 10), odradjeniSati: obracunskiSati(z.vrijemeDolaska, z.vrijemeOdlaska, smjena, postavke) };
  });
  const sati = dani.reduce((s, d) => s + d.odradjeniSati, 0);
  const satnica = Number(zaposlenik.satnicaKooperant) || 0;
  return { zaposlenik, satnica, sati, ukupno: sati * satnica, brojDana: dani.length, dani };
};

// Vanjski suradnik — sati se prikazuju informativno (iz evidencije, isto obračunsko
// zaokruživanje), ali isplata NIJE sati × satnica nego fiksni dogovoreni mjesečni iznos s
// njegovog zapisa zaposlenika — isplaćuje se svaki mjesec bez obzira na odrađene sate.
const obracunMjesecaVanjskiSuradnik = (zaposlenik, mjesec, db) => {
  const postavke = db.postavkePlaca;
  const zapisi = (db.evidencijaRada || []).filter((e) => e.zaposlenikId === zaposlenik.id && e.vrijemeDolaska.slice(0, 7) === mjesec && (e.vrsta || "rad") === "rad" && e.vrijemeOdlaska);
  const dani = zapisi.map((z) => {
    const smjena = odrediSmjenu(z.vrijemeDolaska, postavke);
    return { datum: z.vrijemeDolaska.slice(0, 10), odradjeniSati: obracunskiSati(z.vrijemeDolaska, z.vrijemeOdlaska, smjena, postavke) };
  });
  const sati = dani.reduce((s, d) => s + d.odradjeniSati, 0);
  const iznos = Number(zaposlenik.fiksniMjesecniIznos) || 0;
  const naknadaPrijevoz = Number(zaposlenik.naknadaPrijevoz) || 0;
  const ukupno = iznos + naknadaPrijevoz;
  return { zaposlenik, sati, iznos, naknadaPrijevoz, ukupno, brojDana: dani.length, dani };
};

/* ============================== UPOZORENJA EVIDENCIJE ==============================
   Radnik se treba prijaviti do zadanog sata; ako se ne odjavi, sustav ga automatski
   odjavljuje nakon N sati (na backendu — vidi provjeriAutoOdjavu u server.js), ali to
   ostaje označeno da računovodstvo provjeri. */

const upozorenjaEvidencije = (db) => {
  const danas = todayISO();
  const postavke = db.postavkePlaca;
  const sada = new Date();
  const [granH, granM] = String(postavke?.granicaPrijaveSat || "08:00").split(":").map(Number);
  const proslaGranica = sada.getHours() > granH || (sada.getHours() === granH && sada.getMinutes() >= (granM || 0));
  const danUTjednu = sada.getDay();
  const radniDanDanas = danUTjednu >= 1 && danUTjednu <= 5 && !jePraznik(danas, db.praznici);

  const neprijavljeni = (radniDanDanas && proslaGranica)
    ? db.zaposlenici.filter((z) => z.status === "Aktivan" && !db.evidencijaRada.some((e) => e.zaposlenikId === z.id && e.vrijemeDolaska.slice(0, 10) === danas))
    : [];

  const neodjavljeni = db.evidencijaRada.filter((e) => e.autoOdjava && !e.potvrdenoRacunovodstvo && e.vrijemeDolaska.slice(0, 10) < danas);

  return { neprijavljeni, neodjavljeni };
};

/* ============================== STYLE TOKENS ============================== */
const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    :root{
      --bg:#E9ECEE; --surface:#FFFFFF; --surface-alt:#F3F4F6;
      --ink:#1A1D21; --ink-soft:#5B6470; --ink-faint:#8A9198;
      --line:#D7DBDF; --line-strong:#B7BEC4;
      --accent:#F5B700; --accent-ink:#1A1D21;
      --steel:#2E5E7A; --rust:#B8442C; --green:#256B45;
      --sidebar:#14181C; --sidebar-ink:#AEB6BD; --sidebar-ink-active:#FFFFFF;
      --font-display:'Oswald',sans-serif; --font-body:'Inter',sans-serif; --font-mono:'IBM Plex Mono',monospace;
    }
    .erp-root *{ box-sizing:border-box; }
    .erp-root{ font-family:var(--font-body); color:var(--ink); background:var(--bg); }
    .f-display{ font-family:var(--font-display); letter-spacing:0.01em; }
    .f-mono{ font-family:var(--font-mono); }

    .beam-tick{ position:relative; }
    .beam-tick::before{ content:''; position:absolute; left:0; top:0; width:3px; height:100%; background:var(--accent); }

    .sidebar-item{ display:flex; align-items:center; gap:10px; padding:10px 14px; color:var(--sidebar-ink); font-size:13px; font-weight:500; border-left:3px solid transparent; cursor:pointer; transition:background .15s,color .15s; }
    .sidebar-item:hover{ background:rgba(255,255,255,0.05); color:var(--sidebar-ink-active); }
    .sidebar-item.active{ background:rgba(245,183,0,0.09); color:var(--sidebar-ink-active); border-left-color:var(--accent); }

    .btn{ display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; padding:8px 14px; border-radius:2px; cursor:pointer; border:1px solid transparent; transition:filter .15s,background .15s; white-space:nowrap; }
    .btn:active{ filter:brightness(0.95); }
    .btn-primary{ background:var(--accent); color:var(--accent-ink); }
    .btn-primary:hover{ filter:brightness(1.05); }
    .btn-ghost{ background:transparent; color:var(--ink-soft); border-color:var(--line); }
    .btn-ghost:hover{ background:var(--surface-alt); }
    .btn-danger{ background:transparent; color:var(--rust); border-color:#EAC3BA; }
    .btn-danger:hover{ background:#FBEAE6; }
    .btn-sm{ padding:5px 9px; font-size:12px; }
    .btn-icon{ padding:6px; }

    .card{ background:var(--surface); border:1px solid var(--line); border-radius:3px; }
    .input, .select, .textarea{ width:100%; font-size:13px; padding:8px 10px; border:1px solid var(--line-strong); border-radius:2px; background:var(--surface); color:var(--ink); font-family:var(--font-body); }
    .input:focus, .select:focus, .textarea:focus{ outline:2px solid var(--steel); outline-offset:0; border-color:var(--steel); }
    .label{ font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-soft); margin-bottom:5px; display:block; }

    table.erp-table{ width:100%; border-collapse:collapse; font-size:13px; }
    table.erp-table thead th{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-soft); font-weight:600; padding:9px 12px; border-bottom:2px solid var(--line-strong); background:var(--surface-alt); white-space:nowrap; }
    table.erp-table tbody td{ padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:middle; }
    table.erp-table tbody tr:hover{ background:var(--surface-alt); }
    table.erp-table tbody tr.row-warn{ background:#FDF6E9; }
    table.erp-table tbody tr.row-warn:hover{ background:#FBEFD4; }

    .badge{ display:inline-flex; align-items:center; gap:4px; padding:3px 8px; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.045em; border:1px solid; border-radius:2px; font-family:var(--font-mono); white-space:nowrap; }
    .badge-muted{ background:#F0F1F2; color:#5B6470; border-color:#D7DBDF; }
    .badge-info{ background:#EAF3F7; color:#215C77; border-color:#BFE0EC; }
    .badge-warning{ background:#FFF6DE; color:#8A6100; border-color:#F5D98A; }
    .badge-success{ background:#EAF6EF; color:#1F6B41; border-color:#B9E3C9; }
    .badge-danger{ background:#FBEAE6; color:#9A2E1B; border-color:#F0C2B5; }

    .kpi-card{ background:var(--surface); border:1px solid var(--line); border-radius:3px; padding:16px 18px; position:relative; overflow:hidden; }
    .kpi-num{ font-family:var(--font-display); font-size:28px; font-weight:600; line-height:1; }
    .kpi-label{ font-size:11.5px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:0.04em; margin-top:6px; font-weight:600; }

    .modal-overlay{ position:fixed; inset:0; background:rgba(20,24,28,0.55); display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; z-index:50; overflow-y:auto; }
    .modal-panel{ background:var(--surface); width:100%; max-width:640px; border-radius:3px; box-shadow:0 20px 50px rgba(0,0,0,0.25); margin-bottom:40px; }
    .modal-header{ display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--line); }
    .modal-body{ padding:20px; }
    .modal-footer{ padding:14px 20px; border-top:1px solid var(--line); display:flex; justify-content:flex-end; gap:8px; }

    .nav-tab{ padding:9px 4px; font-size:13px; font-weight:600; color:var(--ink-soft); border-bottom:2px solid transparent; cursor:pointer; }
    .nav-tab.active{ color:var(--ink); border-bottom-color:var(--accent); }

    ::-webkit-scrollbar{ width:9px; height:9px; }
    ::-webkit-scrollbar-thumb{ background:#C6CBCF; border-radius:5px; }
    ::-webkit-scrollbar-track{ background:transparent; }

    @media print{
      body *{ visibility:hidden; }
      .print-doc, .print-doc *{ visibility:visible; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .print-doc{ position:fixed; inset:0; background:#fff; padding:28px 34px; z-index:99999; overflow:visible; }
      .no-print{ display:none !important; }
    }
    .doc-table{ width:100%; border-collapse:collapse; font-size:11.5px; }
    .doc-table th, .doc-table td{ border:1px solid #333; padding:5px 7px; text-align:left; vertical-align:top; }
    .doc-table th{ background:#f0f0f0; font-weight:700; }
  `}</style>
);

/* ============================== HELPERS ============================== */
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const fmtCur = (n) => new Intl.NumberFormat("hr-HR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n) || 0);
const fmtCurDec = (n) => new Intl.NumberFormat("hr-HR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(Number(n) || 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("hr-HR") : "—");

// Otvara dijalog za ispis/spremanje PDF-a s nazivom dokumenta kao predloženim imenom datoteke
// (preglednik za naslov datoteke uzima naslov dokumenta u trenutku otvaranja dijaloga).
// Ispisuje SAMO dokument (.print-doc), u skrivenom iframeu sa stilovima aplikacije. Prije se
// ispisivala cijela stranica, a dokument je bio "position: fixed" preko skrivene aplikacije —
// preglednik je takav element ponavljao na svakoj stranici koliko je aplikacija iza modala duga,
// pa je PDF imao više istih listova (kopije).
const ispisPdf = (naziv) => {
  const dokumenti = document.querySelectorAll(".print-doc");
  const el = dokumenti[dokumenti.length - 1];
  const stariNaslov = document.title;
  if (!el) { document.title = naziv; window.print(); document.title = stariNaslov; return; }
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const klon = el.cloneNode(true);
  klon.querySelectorAll("img").forEach((img) => img.setAttribute("src", img.src));
  const stilovi = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join("\n");
  const naslovHtml = String(naziv).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const d = iframe.contentDocument;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${naslovHtml}</title>${stilovi}<style>html,body{margin:0;background:#fff}body *{visibility:visible !important}.print-doc{position:static !important;inset:auto !important;padding:0 !important;z-index:auto !important}@page{margin:12mm}</style></head><body class="erp-root">${klon.outerHTML}</body></html>`);
  d.close();
  const prozor = iframe.contentWindow;
  const ukloni = () => setTimeout(() => iframe.remove(), 500);
  prozor.onafterprint = ukloni;
  const slike = [...d.images].map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })));
  Promise.race([Promise.all([...slike, d.fonts ? d.fonts.ready : Promise.resolve()]), new Promise((r) => setTimeout(r, 2500))]).then(() => {
    document.title = naziv;
    prozor.focus();
    prozor.print();
    document.title = stariNaslov;
    setTimeout(() => { if (iframe.isConnected) iframe.remove(); }, 60000);
  });
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysUntil = (d) => Math.ceil((new Date(d) - new Date(todayISO())) / 86400000);
const addDays = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };
// Sat poslužitelja: uređaji (npr. računalo na laseru) znaju imati krivo podešen sat ili vremensku
// zonu, a stvarno vrijeme rezanja računa se iz vremena zapisanih na različitim uređajima (jedan
// pokrene program, drugi ga gleda ili završi). Zato se mjeri pomak sata ovog uređaja prema
// poslužitelju i takva se vremena bilježe i računaju prema poslužitelju (sadaMs / sadaISO).
let pomakSataMs = 0;
const sadaMs = () => Date.now() + pomakSataMs;
const sadaISO = () => new Date(sadaMs()).toISOString();
const uskladiSatSPosluziteljem = async () => {
  try {
    const t0 = Date.now();
    const res = await fetch(`${API_URL}/api/vrijeme`);
    const t1 = Date.now();
    if (!res.ok) return;
    const { sada } = await res.json();
    const posluzitelj = new Date(sada).getTime();
    if (!isNaN(posluzitelj)) pomakSataMs = posluzitelj + (t1 - t0) / 2 - t1;
  } catch { /* bez veze s poslužiteljem — ostaje sat uređaja */ }
};

const STATUS_TONE = {
  "Nacrt": "muted", "Ponuda": "muted", "Planiran": "muted",
  "Poslano": "info", "Poslana": "info", "Odobren": "info",
  "Djelomično primljeno": "warning", "U izradi": "warning", "Montaža": "warning",
  "U tijeku": "warning", "Pauziran": "warning", "Djelomično plaćeno": "warning",
  "Primljeno": "success", "Završen": "success", "Prihvaćena": "success", "Plaćeno": "success",
  "Otkazan": "danger", "Odbijena": "danger", "Kasni": "danger",
  "Aktivan": "success", "Neaktivan": "muted",
};
const Badge = ({ status }) => <span className={`badge badge-${STATUS_TONE[status] || "muted"}`}>{status}</span>;

/* ============================== SEED DATA ============================== */

// Kvaliteta materijala — korisnički uređivana lista (Skladište → Kvaliteta materijala), spremljena
// pod db.kvaliteteMaterijala kao [{ id, naziv, gustoca (kg/dm3) }]. Faktor gustoće relativno na
// konstrukcijski čelik (7.85 kg/dm3, gustoća na kojoj se temelje sve mase u katalogu profila/limova)
// računa se iz gustoća pri korištenju — vidi faktorGustoce(). Ovo je samo zadana/početna lista za
// prvi seed i za slučaj da db.kvaliteteMaterijala još nije učitan.
const GUSTOCA_CELIKA = 7.85;
const ZADANE_KVALITETE_MATERIJALA = [
  { id: "celik", naziv: "Konstrukcijski čelik (S235 / S275 / S355)", gustoca: 7.85 },
  { id: "inox304", naziv: "Nehrđajući čelik – Inox 304", gustoca: 7.9 },
  { id: "inox316", naziv: "Nehrđajući čelik – Inox 316", gustoca: 8.0 },
  { id: "alu", naziv: "Aluminij (EN AW-6082)", gustoca: 2.7 },
];
const faktorGustoce = (kvaliteta, kljuc) => {
  const entry = (kvaliteta && kvaliteta.length ? kvaliteta : ZADANE_KVALITETE_MATERIJALA).find((k) => k.id === (kljuc || "celik"));
  return entry ? Number(entry.gustoca) / GUSTOCA_CELIKA : 1;
};

// Antikorozivna zaštita (AKZ) — po poziciji se može dodati više stavki (npr. sačmarenje pa
// vruće cinčanje), svaka sa svojom cijenom €/kg koja se množi s UKUPNOM masom te pozicije.
const AKZ_TIPOVI = [
  { key: "vrucecincano", label: "Vruće cinčano" },
  { key: "bojano", label: "Bojano" },
  { key: "plastificirano", label: "Plastificirano" },
  { key: "sacmarenje", label: "Sačmarenje" },
];

const skiniDijakritiku = (s) => (s || "")
  .replace(/[čć]/gi, (m) => (m === m.toUpperCase() ? "C" : "c"))
  .replace(/š/gi, (m) => (m === m.toUpperCase() ? "S" : "s"))
  .replace(/ž/gi, (m) => (m === m.toUpperCase() ? "Z" : "z"))
  .replace(/đ/gi, (m) => (m === m.toUpperCase() ? "D" : "d"));

// Generira kratki jedinstveni kod za NFC/kiosk prijavu (npr. "MKOV03")
const generirajRfidKod = (ime, prezime, postojeciKodovi) => {
  const baza = skiniDijakritiku(`${ime[0] || "X"}${(prezime || "XXX").slice(0, 3)}`).toUpperCase().replace(/[^A-Z]/g, "") || "ZAP";
  let broj = 1;
  let kod = `${baza}${String(broj).padStart(2, "0")}`;
  while (postojeciKodovi.includes(kod)) { broj++; kod = `${baza}${String(broj).padStart(2, "0")}`; }
  return kod;
};

const STORAGE_KEYS = ["kupci", "dobavljaci", "materijali", "projekti", "narudzbenice", "ponude", "radniNalozi", "fakture", "cjenikRada", "katalogProfila", "pozicijeZaposlenika", "zaposlenici", "standardniZadaci", "programiRezanja", "kapacitetiDana", "postavkeTvrtke", "upitiNabave", "radniCentri", "evidencijaRada", "narudzbe", "otpremnice", "podlogeZaFakturu", "normativi", "postavkePlaca", "praznici", "kvaliteteMaterijala", "ponudeLasera", "doplaciPlaca", "satiPoNalogu", "izdatnice", "cmr", "slobodniZadaci", "planProizvodnje"];

/* ============================== SMALL UI PRIMITIVES ============================== */
const Btn = ({ variant = "ghost", size, icon: Icon, children, className = "", ...rest }) => (
  <button className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""} ${className}`} {...rest}>
    {Icon && <Icon size={14} />}
    {children}
  </button>
);

const Modal = ({ title, onClose, children, footer, wide, xwide }) => (
  <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-panel" style={xwide ? { maxWidth: 1140 } : wide ? { maxWidth: 820 } : undefined}>
      <div className="modal-header">
        <h3 className="f-display" style={{ fontSize: 17, fontWeight: 600 }}>{title}</h3>
        <button className="btn btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>
);

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label className="label">{label}</label>
    {children}
  </div>
);

const ConfirmDelete = ({ label, onConfirm, onCancel }) => (
  <Modal title="Potvrda brisanja" onClose={onCancel} footer={
    <>
      <Btn variant="ghost" onClick={onCancel}>Odustani</Btn>
      <Btn variant="danger" icon={Trash2} onClick={onConfirm}>Obriši</Btn>
    </>
  }>
    <p style={{ fontSize: 14, color: "var(--ink-soft)" }}>Jeste li sigurni da želite obrisati <strong style={{ color: "var(--ink)" }}>{label}</strong>? Ova radnja se ne može poništiti.</p>
  </Modal>
);

const EmptyState = ({ text }) => (
  <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>{text}</div>
);

/* ============================== LINE ITEMS EDITOR ============================== */
// Šifra izvedena iz oznake kataloške stavke — deterministična, koristi se i za predlaganje šifre
// kod ručnog unosa materijala i za prepoznavanje "istog materijala" kod zaprimanja narudžbenice.
const sifraIzKataloga = (entry) => entry.oznaka.replace(/[^A-Za-z0-9]+/g, "-");

// Zadnja poznata nabavna cijena za materijal iz bilo koje narudžbenice (najnovija po datumu) —
// pouzdanija je od (mogla bi biti zastarjele) cijene upisane na samom skladišnom artiklu.
const zadnjaCijenaIzNarudzbenice = (materijalId, narudzbenice) => {
  const sve = (narudzbenice || [])
    .flatMap((n) => (n.stavke || []).filter((s) => s.materijalId === materijalId && s.cijenaPoJed != null).map((s) => ({ cijenaPoJed: s.cijenaPoJed, datum: n.datum })))
    .sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  return sve[0]?.cijenaPoJed ?? null;
};

function LineItemsEditor({ mode, rows = [], setRows, materijali = [], katalog = [], narudzbenice = [], dozvoliKatalog = false }) {
  const addRow = () => setRows([...rows, mode === "materijal" ? { materijalId: "", nacinUnosa: "kolicina", kolicina: 1, duzinaM: 6, sirinaM: 1.25, komada: 1, cijenaPoJed: 0, kvaliteta: "" } : { opis: "", kolicina: 1, jm: "kom", cijenaJed: 0 }]);
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i));
  const update = (i, patch) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // Dok materijal još nije stvaran zapis na skladištu (redak referencira samo katalošku stavku —
  // vidi dozvoliKatalog niže), mase/cijena se za prikaz i izračun uživo izvode iz kataloga umjesto
  // iz db.materijali. Zapis na skladištu se stvara (ili se poveća postojeći) tek pri "Primi robu".
  const resolvMat = (r) => {
    if (r.materijalId) return materijali.find((x) => x.id === r.materijalId);
    if (r.katalogId) {
      const k = katalog.find((x) => x.id === r.katalogId);
      if (!k) return null;
      return {
        sifra: sifraIzKataloga(k), naziv: katalogOznakaPuna(k), jm: "kg",
        cijena: k.jedinica === "kg/m2" ? 1.25 : 1.15,
        kgPoM: k.jedinica === "kg/m" ? Number(k.vrijednost) : 0,
        kgPoM2: k.jedinica === "kg/m2" ? Number(k.vrijednost) : 0,
      };
    }
    return null;
  };

  const efektivnaKolicina = (r, mat) => efektivnaKolicinaMaterijala(r, mat);
  const efektivnaCijena = (r, mat) => (r.cijenaPoJed != null ? Number(r.cijenaPoJed) : (mat ? mat.cijena : 0));

  const lineTotal = (r) => {
    if (mode === "materijal") {
      const m = resolvMat(r);
      return efektivnaCijena(r, m) * efektivnaKolicina(r, m);
    }
    return (Number(r.cijenaJed) || 0) * (Number(r.kolicina) || 0);
  };
  const total = rows.reduce((s, r) => s + lineTotal(r), 0);

  // Sprema patch na redak i, ako je način unosa "duzina × komada", odmah preračuna i zapiše stvarnu kolicina (kg) —
  // tako svi izračuni (ukupno, trošak ponude, iznos narudžbenice, zaprimanje/izdavanje sa skladišta) rade s točnom vrijednošću.
  const azurirajRedak = (i, patch) => {
    setRows(rows.map((r, idx) => {
      if (idx !== i) return r;
      const merged = { ...r, ...patch };
      if (merged.nacinUnosa === "duzina") {
        const mat = resolvMat(merged);
        const kgPoM = mat?.kgPoM > 0 ? Number(mat.kgPoM) : 0;
        if (kgPoM > 0) merged.kolicina = (Number(merged.duzinaM) || 0) * (Number(merged.komada) || 0) * kgPoM;
      } else if (merged.nacinUnosa === "lim") {
        const mat = resolvMat(merged);
        const kgPoM2 = mat?.kgPoM2 > 0 ? Number(mat.kgPoM2) : 0;
        if (kgPoM2 > 0) merged.kolicina = (Number(merged.duzinaM) || 0) * (Number(merged.sirinaM) || 0) * (Number(merged.komada) || 0) * kgPoM2;
      }
      return merged;
    }));
  };

  // Odabir "iz kataloga" ovdje NE stvara zapis na skladištu (za razliku od starog ponašanja) —
  // redak samo pamti na koju se katalošku stavku odnosi (katalogId), a materijalId ostaje prazan
  // dok se stvarno ne zaprimi (vidi primi() u NabavaPage). Prikazuje se samo tamo gdje dozvoliKatalog
  // dopušta (narudžbenica) — u projektima/radnim nalozima bira se isključivo postojeća zaliha.
  const odaberiMaterijal = (i, val) => {
    const r = rows[i] || {};
    const duzinaDef = r.duzinaM ?? 6;
    const sirinaDef = r.sirinaM ?? 1.25;
    const komadaDef = r.komada ?? 1;
    if (val.startsWith("kat::")) {
      const katId = val.slice(5);
      const entry = (katalog || []).find((k) => k.id === katId);
      if (entry) {
        const jeDuzina = entry.jedinica === "kg/m";
        const jeLim = entry.jedinica === "kg/m2";
        const nacin = jeDuzina ? "duzina" : jeLim ? "lim" : "kolicina";
        azurirajRedak(i, { materijalId: "", katalogId: katId, nacinUnosa: nacin, duzinaM: duzinaDef, sirinaM: sirinaDef, komada: komadaDef, cijenaPoJed: jeLim ? 1.25 : 1.15 });
      }
    } else {
      const mat = materijali.find((m) => m.id === val);
      const jeDuzina = mat?.kgPoM > 0;
      const jeLim = mat?.kgPoM2 > 0;
      const nacin = jeDuzina ? "duzina" : jeLim ? "lim" : "kolicina";
      const cijenaPoJed = zadnjaCijenaIzNarudzbenice(val, narudzbenice) ?? (mat ? mat.cijena : 0);
      azurirajRedak(i, { materijalId: val, katalogId: "", nacinUnosa: nacin, duzinaM: duzinaDef, sirinaM: sirinaDef, komada: komadaDef, cijenaPoJed });
    }
  };

  if (mode === "materijal") {
    return (
      <div>
        {rows.length === 0 && <div style={{ textAlign: "center", color: "var(--ink-faint)", padding: "14px 0", fontSize: 13 }}>Nema stavki. Dodaj materijal.</div>}
        {rows.map((r, i) => {
          const mat = resolvMat(r);
          const nacin = r.nacinUnosa || "kolicina";
          const kol = efektivnaKolicina(r, mat);
          return (
            <div key={i} className="card" style={{ padding: 10, marginBottom: 8, background: "var(--surface-alt)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label className="label">Materijal</label>
                  <select className="select" value={r.materijalId || (r.katalogId ? `kat::${r.katalogId}` : "")} onChange={(e) => odaberiMaterijal(i, e.target.value)}>
                    <option value="">Odaberi materijal…</option>
                    <optgroup label="Zalihe (skladište)">
                      {materijali.map((m) => <option key={m.id} value={m.id}>{m.sifra} — {m.naziv}</option>)}
                    </optgroup>
                    {dozvoliKatalog && katalog && katalog.length > 0 && (
                      <optgroup label="Naruči iz kataloga profila (stvara se na skladištu tek kad se roba zaprimi)">
                        {katalog.map((k) => <option key={k.id} value={`kat::${k.id}`}>{katalogOznakaPuna(k)} ({k.vrijednost} {k.jedinica})</option>)}
                      </optgroup>
                    )}
                  </select>
                </div>
                <button className="btn btn-icon btn-ghost" onClick={() => removeRow(i)}><X size={14} /></button>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
                <div style={{ width: 165 }}>
                  <label className="label">Način unosa</label>
                  <select className="select" value={nacin} onChange={(e) => azurirajRedak(i, { nacinUnosa: e.target.value })}>
                    <option value="duzina">Dužina profila × komada</option>
                    <option value="lim">Dimenzije lima (dužina × širina) × komada</option>
                    <option value="kolicina">Ručni unos količine</option>
                  </select>
                </div>
                {nacin === "duzina" ? (
                  <>
                    <div style={{ width: 110 }}><label className="label">Dužina (mm)</label><input className="input f-mono" type="number" min="0" step="1" value={Math.round((Number(r.duzinaM ?? 6)) * 1000)} onChange={(e) => azurirajRedak(i, { duzinaM: (Number(e.target.value) || 0) / 1000 })} /></div>
                    <div style={{ width: 90 }}><label className="label">Komada</label><input className="input f-mono" type="number" min="0" value={r.komada ?? 1} onChange={(e) => azurirajRedak(i, { komada: e.target.value })} /></div>
                    <div style={{ width: 120 }}>
                      <label className="label">Masa (izračunato)</label>
                      <div className="input f-mono" style={{ background: "var(--surface)", color: mat?.kgPoM > 0 ? "var(--ink-soft)" : "var(--rust)" }}>{mat?.kgPoM > 0 ? `${kol.toFixed(1)} kg` : "nema kg/m"}</div>
                    </div>
                  </>
                ) : nacin === "lim" ? (
                  <>
                    <div style={{ width: 110 }}><label className="label">Dužina (mm)</label><input className="input f-mono" type="number" min="0" step="1" value={Math.round((Number(r.duzinaM ?? 2)) * 1000)} onChange={(e) => azurirajRedak(i, { duzinaM: (Number(e.target.value) || 0) / 1000 })} /></div>
                    <div style={{ width: 110 }}><label className="label">Širina (mm)</label><input className="input f-mono" type="number" min="0" step="1" value={Math.round((Number(r.sirinaM ?? 1.25)) * 1000)} onChange={(e) => azurirajRedak(i, { sirinaM: (Number(e.target.value) || 0) / 1000 })} /></div>
                    <div style={{ width: 90 }}><label className="label">Komada</label><input className="input f-mono" type="number" min="0" value={r.komada ?? 1} onChange={(e) => azurirajRedak(i, { komada: e.target.value })} /></div>
                    <div style={{ width: 120 }}>
                      <label className="label">Masa (izračunato)</label>
                      <div className="input f-mono" style={{ background: "var(--surface)", color: mat?.kgPoM2 > 0 ? "var(--ink-soft)" : "var(--rust)" }}>{mat?.kgPoM2 > 0 ? `${kol.toFixed(1)} kg` : "nema kg/m²"}</div>
                    </div>
                  </>
                ) : (
                  <div style={{ width: 120 }}><label className="label">Količina ({mat?.jm || "kg"})</label><input className="input f-mono" type="number" min="0" value={r.kolicina} onChange={(e) => update(i, { kolicina: e.target.value })} /></div>
                )}
                <div style={{ width: 130 }}>
                  <label className="label">Kvaliteta</label>
                  <input className="input" placeholder="S235JR…" value={r.kvaliteta || ""} onChange={(e) => update(i, { kvaliteta: e.target.value })} />
                </div>
                <div style={{ width: 120 }}>
                  <label className="label">Cijena/{mat?.jm || "kg"} (€)</label>
                  <input className="input f-mono" type="number" min="0" step="0.01" value={r.cijenaPoJed ?? (mat ? mat.cijena : 0)} onChange={(e) => update(i, { cijenaPoJed: e.target.value })} />
                </div>
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <label className="label">Ukupno</label>
                  <div className="f-mono" style={{ fontWeight: 700, fontSize: 14 }}>{fmtCurDec(lineTotal(r))}</div>
                </div>
              </div>
              {nacin === "duzina" && !(mat?.kgPoM > 0) && mat && (
                <div style={{ fontSize: 11, color: "var(--rust)", marginTop: 6 }}>Ovaj materijal nema definiranu masu po m' — unesi je u Skladištu ili prebaci na ručni unos količine.</div>
              )}
              {nacin === "lim" && !(mat?.kgPoM2 > 0) && mat && (
                <div style={{ fontSize: 11, color: "var(--rust)", marginTop: 6 }}>Ovaj materijal nema definiranu masu po m² — unesi je u Skladištu ili prebaci na ručni unos količine.</div>
              )}
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <Btn variant="ghost" size="sm" icon={Plus} onClick={addRow}>Dodaj stavku</Btn>
          <div className="f-mono" style={{ fontSize: 15, fontWeight: 700 }}>Ukupno: {fmtCurDec(total)}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <table className="erp-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Stavka</th>
            <th style={{ width: 100 }}>Količina</th>
            <th style={{ width: 80 }}>JM</th>
            <th style={{ width: 120 }}>Cijena/jed.</th>
            <th style={{ width: 110 }}>Ukupno</th>
            <th style={{ width: 36 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-faint)", padding: 16 }}>Nema stavki. Dodajte prvu stavku.</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ minWidth: 180 }}><input className="input" value={r.opis} placeholder="Opis stavke / usluge" onChange={(e) => update(i, { opis: e.target.value })} /></td>
              <td><input className="input f-mono" type="number" min="0" value={r.kolicina} onChange={(e) => update(i, { kolicina: e.target.value })} /></td>
              <td><input className="input" value={r.jm} onChange={(e) => update(i, { jm: e.target.value })} /></td>
              <td><input className="input f-mono" type="number" min="0" step="0.01" value={r.cijenaJed} onChange={(e) => update(i, { cijenaJed: e.target.value })} /></td>
              <td className="f-mono">{fmtCurDec(lineTotal(r))}</td>
              <td><button className="btn btn-icon btn-ghost" onClick={() => removeRow(i)}><X size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Btn variant="ghost" size="sm" icon={Plus} onClick={addRow}>Dodaj stavku</Btn>
        <div className="f-mono" style={{ fontSize: 15, fontWeight: 700 }}>Ukupno: {fmtCurDec(total)}</div>
      </div>
    </div>
  );
}

/* ============================== GENERIC ENTITY TABLE PAGE ============================== */
// onReorder (opcionalno): kad je zadan, redovi postaju povlačivi (drag & drop) — nakon ispuštanja
// poziva se onReorder(novaLista) s prikazanim redcima u novom poretku, a pozivatelj odlučuje kako
// tu novu listu trajno spremiti (npr. upisati redni broj na svaki zapis). Povlačenje radi na
// TRENUTNO PRIKAZANOJ (filtriranoj) listi — ima smisla dok pretraga nije aktivna.
// grupiraj/redoslijedGrupa/nazivGrupe su opcionalni — kad nisu zadani, ponašanje je identično
// kao prije (jedna tablica). Kad JESU zadani (npr. popis Zaposlenika po Radiona/Praktikanti/
// Tehnički ured/Kooperanti, isto kao Evidencija rada), popis se dijeli u zasebne tablice s
// naslovom grupe iznad svake — pretraga i "Dodaj" ostaju zajednički za cijelu stranicu.
function EntityPage({ title, icon: Icon, subtitle, data, onAdd, onEdit, onDelete, columns, searchKeys, addLabel, rowClass, readOnly = false, onReorder, grupiraj, redoslijedGrupa, nazivGrupe }) {
  const [q, setQ] = useState("");
  const [dragOd, setDragOd] = useState(null);
  const filtered = useMemo(() => {
    if (!q.trim()) return data;
    const s = q.toLowerCase();
    return data.filter((row) => searchKeys.some((k) => String(row[k] ?? "").toLowerCase().includes(s)));
  }, [q, data, searchKeys]);

  const ispusti = (naIndeks) => {
    if (dragOd == null || dragOd === naIndeks) { setDragOd(null); return; }
    const nova = [...filtered];
    const [maknuto] = nova.splice(dragOd, 1);
    nova.splice(naIndeks, 0, maknuto);
    setDragOd(null);
    onReorder(nova);
  };

  const Tablica = ({ lista }) => (
    lista.length === 0 ? <EmptyState text="Nema podataka." /> : (
      <table className="erp-table">
        <thead><tr>{onReorder && <th style={{ width: 24 }}></th>}{columns.map((c) => <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}{!readOnly && <th style={{ width: 90 }}></th>}</tr></thead>
        <tbody>
          {lista.map((row, idx) => (
            <tr
              key={row.id} className={rowClass ? rowClass(row) : ""}
              draggable={!!onReorder} style={onReorder ? { cursor: "grab" } : undefined}
              onDragStart={onReorder ? () => setDragOd(idx) : undefined}
              onDragOver={onReorder ? (e) => e.preventDefault() : undefined}
              onDrop={onReorder ? () => ispusti(idx) : undefined}
            >
              {onReorder && <td style={{ textAlign: "center", color: "var(--ink-faint)" }}><GripVertical size={14} /></td>}
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}
              {!readOnly && (
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-icon btn-ghost" onClick={() => onEdit(row)}><Pencil size={14} /></button>
                    <button className="btn btn-icon btn-ghost" onClick={() => onDelete(row)}><Trash2 size={14} color="var(--rust)" /></button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    )
  );

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} icon={Icon} action={readOnly ? null : <Btn variant="primary" icon={Plus} onClick={onAdd}>{addLabel}</Btn>} />
      <div className="card" style={{ marginBottom: 14, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, maxWidth: 320 }}>
        <Search size={15} color="var(--ink-faint)" />
        <input className="input" style={{ border: "none", padding: "4px 0" }} placeholder="Pretraži…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {grupiraj ? (
        redoslijedGrupa.map((kljucGrupe) => {
          const lista = filtered.filter((row) => grupiraj(row) === kljucGrupe);
          return (
            <div key={kljucGrupe} style={{ marginBottom: 20 }}>
              <div className="label" style={{ marginBottom: 6 }}>{(nazivGrupe ? nazivGrupe(kljucGrupe) : kljucGrupe)} ({lista.length})</div>
              <div className="card" style={{ overflowX: "auto" }}><Tablica lista={lista} /></div>
            </div>
          );
        })
      ) : (
        <div className="card" style={{ overflowX: "auto" }}><Tablica lista={filtered} /></div>
      )}
    </div>
  );
}

const PageHeader = ({ title, subtitle, icon: Icon, action }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {Icon && <Icon size={19} color="var(--steel)" />}
        <h2 className="f-display" style={{ fontSize: 22, fontWeight: 600 }}>{title}</h2>
      </div>
      {subtitle && <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 3 }}>{subtitle}</p>}
    </div>
    {action}
  </div>
);

/* ============================== APP ============================== */
const MODULI_APLIKACIJE = [
  { key: "dashboard", label: "Nadzorna ploča", icon: LayoutDashboard },
  { key: "skladiste", label: "Skladište", icon: Package },
  { key: "nabava", label: "Nabava", icon: Truck },
  { key: "proizvodnja", label: "Proizvodnja", icon: Factory },
  { key: "projekti", label: "Projekti i ponude", icon: Building2 },
  { key: "fakturiranje", label: "Otpremnice i fakturiranje", icon: Receipt },
  { key: "partneri", label: "Kupci i dobavljači", icon: Users },
  { key: "zaposlenici", label: "Zaposlenici", icon: UserCog },
];

// Kartice (tabovi) unutar svakog modula — isti popis kao stvarni nav-tabovi svake stranice.
// Koristi se za "Pozicije" ekran (dodjela pristupa/izmjena po kartici, ne samo po cijelom
// modulu) i za skrivanje tabova u samim stranicama kad pozicija nema pristup. Stvarna provjera
// (koji ključevi se smiju čitati/mijenjati) živi na backendu — vidi KARTICE_MODULA u server.js.
const KARTICE_MODULA = {
  dashboard: { kartice: [{ key: "pregled", naziv: "Pregled" }] },
  skladiste: { kartice: [{ key: "zalihe", naziv: "Zalihe" }, { key: "katalog", naziv: "Katalog profila i limova" }, { key: "kvaliteta", naziv: "Kvaliteta materijala" }, { key: "izdatnice", naziv: "Izdatnice" }] },
  nabava: { kartice: [{ key: "narudzbenice", naziv: "Narudžbenice" }, { key: "upiti", naziv: "Upiti materijala" }, { key: "postavke", naziv: "Postavke tvrtke" }] },
  proizvodnja: { kartice: [{ key: "tablica", naziv: "Tablica" }, { key: "gantogram", naziv: "Plan proizvodnje" }, { key: "rezanje", naziv: "Plan rezanja" }, { key: "isporuke", naziv: "Isporuke kupaonica" }] },
  projekti: { kartice: [{ key: "projekti", naziv: "Projekti" }, { key: "ponude", naziv: "Ponude" }, { key: "laser", naziv: "Ponude - Laser" }, { key: "zavrseni", naziv: "Završeni projekti" }] },
  fakturiranje: { kartice: [{ key: "fakture", naziv: "Fakture" }, { key: "otpremnice", naziv: "Otpremnice" }, { key: "cmr", naziv: "CMR" }, { key: "podloge", naziv: "Podloge za fakturu" }] },
  partneri: { kartice: [{ key: "kupci", naziv: "Kupci" }, { key: "dobavljaci", naziv: "Dobavljači" }] },
  zaposlenici: { kartice: [{ key: "zaposlenici", naziv: "Zaposlenici" }, { key: "pozicije", naziv: "Pozicije" }, { key: "evidencija", naziv: "Evidencija rada" }, { key: "obracun", naziv: "Obračun plaća" }, { key: "satinalozi", naziv: "Sati po nalozima" }] },
};

// Dozvola za jednu karticu — po zadanom TRUE (naslijeđeno od dodjele modula), osim ako je
// admin za tu poziciju eksplicitno postavio false. Ista logika kao dozvolaZaKarticu u server.js.
const dozvolaZaKarticu = (pozicija, modulKey, karticaKey) => {
  const eksplicitno = pozicija?.karticeDozvole?.[modulKey]?.[karticaKey];
  return { pristup: eksplicitno?.pristup !== false, izmjene: eksplicitno?.izmjene !== false };
};

// Popis kartica modula na koje pozicija ima pristup (za skrivanje tabova u stranicama).
const dozvoljeneKarticeModula = (pozicija, modulKey) => (KARTICE_MODULA[modulKey]?.kartice || []).filter((k) => dozvolaZaKarticu(pozicija, modulKey, k.key).pristup);

// RFID čitač na kiosku "tipka" kod pa šalje Enter — ali ako Enter ikad izostane (kod nekih
// čitača/kartica, ili ako se dvoje ljudi prisloni gotovo istovremeno), ostatak koda ostaje u
// polju i spoji se s IDUĆIM skeniranjem u jedan besmislen niz (npr. dva stvarna 10-znamenkasta
// koda zalijepljena u jedan 20-znamenkasti) — obje osobe tad dobiju "kartica nije prepoznata".
// KIOSK_TISINA_MS: ako nema novog upisa ovoliko dugo, ono što je upisano do sad šalje se samo
// od sebe (ne čeka se Enter) — kratka prirodna stanka između dva različita skeniranja tako
// prirodno razdvaja kodove umjesto da se lijepe. KIOSK_MAX_DULJINA_KODA: ako se unos ipak
// razraste preko razumne duljine za jednu karticu, odbacuje se kao pokvaren umjesto da se šalje.
const KIOSK_TISINA_MS = 300;
const KIOSK_MAX_DULJINA_KODA = 15;
// Koliko dugo poruka o prijavi/odjavi ostaje na zaslonu kiosa (ms).
const KIOSK_PRIKAZ_PORUKE_MS = 1000;
// Svakih koliko kiosk provjerava je li izašla nova verzija aplikacije (pa se sam osvježi).
const KIOSK_PROVJERA_VERZIJE_MS = 33 * 60 * 1000;

function KioskView({ onPrijava }) {
  const [unos, setUnos] = useState("");
  const [poruka, setPoruka] = useState(null);
  const [sat, setSat] = useState(new Date());
  const inputRef = useRef(null);
  const obradjenIzUrla = useRef(false);
  const tisinaTimeoutRef = useRef(null);
  const sakrijTimeoutRef = useRef(null);
  // Red čekanja za skeniranja + zastavica "worker trenutno radi" — zamjenjuje stari pristup s
  // jednostavnom "uTijeku" zabranom, koji je imao ozbiljnu manu: dok je zahtjev za JEDNO
  // skeniranje bio na čekanju (npr. poslužitelj načas sporiji), SLJEDEĆE skeniranje se u
  // međuvremenu tiho odbacivalo I NJEGOVI ZNAKOVI SU OSTAJALI U POLJU — pa bi se zalijepili s
  // idućim skeniranjem u jedan pokvaren kod (upravo simptom "čuje se bip, ali se ne registrira",
  // sporadično, kod bilo koga tko se zatekne u gužvi). Sad se svako dovršeno skeniranje odmah
  // makne iz polja i doda u red; red se prazni redom, jedno po jedno, pa se ni jedno skeniranje
  // više ne gubi niti miješa s drugim, bez obzira koliko brzo ljudi dolaze jedno za drugim.
  const redSkeniranjaRef = useRef([]);
  const obradaURaduRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setSat(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);

  // Redovan "ping" dok je kiosk zaslon otvoren — drži besplatni Render poslužitelj budnim
  // preko dana, umjesto da nakon 15 min mirovanja prva prava prijava čeka 30-50 s (što u
  // gužvi na početku smjene izgleda kao da sustav "ne registrira" prijavu).
  useEffect(() => {
    const ping = () => fetch(`${API_URL}/api/kiosk/ping`).catch(() => {});
    ping();
    const t = setInterval(ping, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Automatsko osvježavanje na novu verziju: tablet na kiosku se nikad ne zatvara, pa bi inače
  // zauvijek ostao na staroj verziji. Aplikacija se gradi s imenom skripte koje se mijenja sa
  // svakom novom verzijom — kiosk periodično dohvati početnu stranicu i usporedi ime skripte s
  // onom koju trenutno izvodi. Ako se razlikuje, ponovno se učita, ali samo kad je mirno (nema
  // skeniranja u tijeku, u redu ni upisanog koda), da nikad ne prekine nečiju prijavu.
  useEffect(() => {
    const trenutna = Array.from(document.scripts).map((sk) => sk.src).find((src) => /\/assets\/index-[^/]+\.js/.test(src));
    if (!trenutna) return undefined; // razvojni način rada — nema hashiranih skripti
    const provjeri = async () => {
      try {
        const res = await fetch(`${window.location.origin}/`, { cache: "no-store" });
        const novaSkripta = (await res.text()).match(/\/assets\/index-[^"']+\.js/)?.[0];
        if (!novaSkripta || trenutna.endsWith(novaSkripta)) return;
        const mirno = !obradaURaduRef.current && redSkeniranjaRef.current.length === 0 && !tisinaTimeoutRef.current;
        if (mirno) window.location.reload();
      } catch { /* bez mreže — pokušat će se ponovno kod sljedeće provjere */ }
    };
    const t = setInterval(provjeri, KIOSK_PROVJERA_VERZIJE_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, [poruka]);

  useEffect(() => () => {
    if (tisinaTimeoutRef.current) clearTimeout(tisinaTimeoutRef.current);
    if (sakrijTimeoutRef.current) clearTimeout(sakrijTimeoutRef.current);
  }, []);

  const kratkaPoruka = (poruka) => {
    if (sakrijTimeoutRef.current) clearTimeout(sakrijTimeoutRef.current);
    setPoruka(poruka);
    sakrijTimeoutRef.current = setTimeout(() => setPoruka(null), KIOSK_PRIKAZ_PORUKE_MS);
  };

  const promjenaUnosa = (vrijednost) => {
    if (tisinaTimeoutRef.current) clearTimeout(tisinaTimeoutRef.current);
    if (vrijednost.length > KIOSK_MAX_DULJINA_KODA) {
      // Spojeno/pokvareno očitanje — vidljiva poruka umjesto tihog brisanja, da se zna da se
      // nešto dogodilo (a ne da izgleda kao da kiosk uopće nije reagirao na prislonjenu karticu).
      setUnos("");
      kratkaPoruka({ tip: "greska", tekst: "Očitanje nije prepoznato", detalj: "Prisloni karticu ponovno." });
      return;
    }
    setUnos(vrijednost);
    if (vrijednost) tisinaTimeoutRef.current = setTimeout(() => zavrsiSkeniranje(vrijednost), KIOSK_TISINA_MS);
  };

  // Dovršeno skeniranje (bilo preko stanke ili preko Entera) odmah se makne iz polja i ubaci u
  // red — nikad se ne oslanja na to je li poslužitelj trenutno slobodan.
  const zavrsiSkeniranje = (kodSirovi) => {
    if (tisinaTimeoutRef.current) { clearTimeout(tisinaTimeoutRef.current); tisinaTimeoutRef.current = null; }
    setUnos("");
    const kod = (kodSirovi || "").trim().toUpperCase();
    if (!kod) return;
    redSkeniranjaRef.current.push(kod);
    obradiRed();
  };

  // Prazni red jedno po jedno — ako je worker već pokrenut (obrađuje prethodni kod), ovaj poziv
  // samo doda kod na red i vrati se; taj isti worker će ga pokupiti čim dođe na red.
  const obradiRed = async () => {
    if (obradaURaduRef.current) return;
    obradaURaduRef.current = true;
    while (redSkeniranjaRef.current.length > 0) {
      const kod = redSkeniranjaRef.current.shift();
      await obradiKod(kod);
    }
    obradaURaduRef.current = false;
  };

  const obradiKod = async (kod) => {
    setPoruka(null); // bez međuporuke "Obrađujem…" — ekran ostaje miran do stvarnog rezultata
    try {
      const res = await fetch(`${API_URL}/api/kiosk/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfidKod: kod }),
      });
      if (res.status >= 500) {
        kratkaPoruka({ tip: "greska", tekst: "Prijava nije uspjela", detalj: "Ponovi prijavu." });
      } else {
        const data = await res.json();
        if (!res.ok) {
          if (data.cooldown) {
            // Kartica je već netom prije uspješno očitana — javi joj TO umjesto nejasnog
            // "pričekaj", da se zna da prethodno skeniranje nije propalo.
            const vrijeme = data.zadnjaAkcija?.vrijeme ? new Date(data.zadnjaAkcija.vrijeme).toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" }) : "";
            const jeOdlazak = data.zadnjaAkcija?.tip === "odlazak";
            kratkaPoruka({ tip: jeOdlazak ? "odlazak" : "dolazak", tekst: jeOdlazak ? "VEĆ ODJAVLJENO" : "VEĆ PRIJAVLJENO", detalj: vrijeme ? `u ${vrijeme}` : "" });
          } else {
            kratkaPoruka({ tip: "greska", tekst: data.error || "Kartica nije prepoznata", detalj: `Kod: ${kod} — javi se administratoru.` });
          }
        } else if (data.tip === "odlazak") {
          kratkaPoruka({ tip: "odlazak", tekst: "ODJAVA 🙂", detalj: `${data.ime} ${data.prezime}` });
        } else {
          kratkaPoruka({ tip: "dolazak", tekst: "PRIJAVA 🙂", detalj: `${data.ime} ${data.prezime}` });
        }
      }
    } catch {
      kratkaPoruka({ tip: "greska", tekst: "Prijava nije uspjela", detalj: "Ponovi prijavu." });
    }
  };

  useEffect(() => {
    if (obradjenIzUrla.current) return;
    const params = new URLSearchParams(window.location.search);
    const rfid = params.get("rfid");
    if (rfid) { obradjenIzUrla.current = true; zavrsiSkeniranje(rfid); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zatvoriKiosk = () => { window.location.href = window.location.pathname; };
  const bojePoruke = { dolazak: { bg: "#EAF6EF", border: "#B9E3C9", naslov: "#1F6B41" }, odlazak: { bg: "#EAF3F7", border: "#BFE0EC", naslov: "#215C77" }, greska: { bg: "#FBEAE6", border: "#F0C2B5", naslov: "#9A2E1B" } };

  return (
    <div className="erp-root f-display" style={{ position: "relative", minHeight: 640, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--sidebar)", padding: 20 }}>
      <GlobalStyle />
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontSize: 56, fontWeight: 700, color: "var(--sidebar-ink)", lineHeight: 1.1 }}>ECON</div>
        <div style={{ fontSize: 26, fontWeight: 600, color: "var(--sidebar-ink)" }}>Evidencija radnog vremena</div>
      </div>
      <div className="card" style={{ width: 840, maxWidth: "100%", padding: 56, background: "var(--surface)", textAlign: "center" }}>
        <div style={{ fontSize: 26, color: "var(--ink-faint)", marginBottom: 10, textTransform: "capitalize" }}>{sat.toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "long" })}</div>
        <div style={{ fontSize: 72, fontWeight: 700, marginBottom: 30 }}>{sat.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })}</div>

        {poruka ? (
          <div style={{ padding: "34px 28px", borderRadius: 6, marginBottom: 10, background: bojePoruke[poruka.tip].bg, border: `1px solid ${bojePoruke[poruka.tip].border}` }}>
            <div style={{ fontSize: poruka.tip === "dolazak" || poruka.tip === "odlazak" ? (poruka.tekst.length > 10 ? 32 : 48) : 36, fontWeight: 700, marginBottom: poruka.detalj ? 8 : 0, letterSpacing: poruka.tip === "dolazak" || poruka.tip === "odlazak" ? "0.05em" : 0, color: poruka.tip === "greska" ? bojePoruke.greska.naslov : poruka.tip === "dolazak" || poruka.tip === "odlazak" ? bojePoruke[poruka.tip].naslov : "var(--ink)" }}>{poruka.tekst}</div>
            {poruka.detalj && <div style={{ fontSize: 24, color: "var(--ink-soft)" }}>{poruka.detalj}</div>}
          </div>
        ) : (
          <div style={{ fontSize: 26, color: "var(--ink-soft)" }}>Prisloni karticu čitaču</div>
        )}
        {/* Skriveni input i dalje hvata upis RFID čitača (koji radi kao tipkovnica) — samo
            više nema vidljivu kućicu za ručno upisivanje koda. */}
        <input
          ref={inputRef} autoFocus value={unos}
          onChange={(e) => promjenaUnosa(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") zavrsiSkeniranje(e.target.value); }}
          aria-hidden="true"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, border: "none", padding: 0 }}
        />
      </div>
      {onPrijava ? (
        <button onClick={onPrijava} className="btn btn-primary" style={{ position: "fixed", bottom: 20, right: 20 }}>Prijava</button>
      ) : (
        <button onClick={zatvoriKiosk} style={{ marginTop: 22, background: "none", border: "none", color: "var(--sidebar-ink)", fontSize: 11, cursor: "pointer", opacity: 0.5 }}>Zatvori kiosk način</button>
      )}
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [zaposlenici, setZaposlenici] = useState([]);
  const [zapId, setZapId] = useState("");
  const [lozinka, setLozinka] = useState("");
  const [greska, setGreska] = useState("");
  const [ucitavanje, setUcitavanje] = useState(true);
  const [saljem, setSaljem] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/zaposlenici`);
        if (!res.ok) throw new Error();
        const lista = await res.json();
        setZaposlenici(lista);
        setZapId(lista[0]?.id || "");
      } catch {
        setGreska("Ne mogu učitati popis zaposlenika — provjeri je li backend pokrenut.");
      } finally {
        setUcitavanje(false);
      }
    })();
  }, []);

  const prijavi = async () => {
    if (!zapId) { setGreska("Odaberite zaposlenika."); return; }
    if (!lozinka) { setGreska("Unesite lozinku."); return; }
    setSaljem(true);
    setGreska("");
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zaposlenikId: zapId, lozinka }),
      });
      const data = await res.json();
      if (!res.ok) { setGreska(data.error || "Prijava nije uspjela."); return; }
      onLogin(data.token, data.zaposlenik);
    } catch {
      setGreska("Greška pri povezivanju s poslužiteljem.");
    } finally {
      setSaljem(false);
    }
  };

  return (
    <div className="erp-root" style={{ minHeight: 640, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--sidebar)" }}>
      <GlobalStyle />
      <div className="card" style={{ width: 380, padding: 28, background: "var(--surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 34, height: 34, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 3, flexShrink: 0 }}>
            <Building2 size={18} color="var(--accent-ink)" />
          </div>
          <div>
            <div className="f-mono" style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--ink-faint)", textTransform: "uppercase" }}>ERP prijava</div>
            <div className="f-display" style={{ fontSize: 18, fontWeight: 600 }}>ECON D.O.O.</div>
          </div>
        </div>
        {ucitavanje ? (
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Učitavanje popisa zaposlenika…</div>
        ) : (
          <>
            <Field label="Zaposlenik">
              <select className="select" value={zapId} onChange={(e) => { setZapId(e.target.value); setGreska(""); }}>
                {zaposlenici.map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
              </select>
            </Field>
            <Field label="Lozinka">
              <input
                className="input f-mono" type="password" placeholder="Lozinka" value={lozinka}
                onChange={(e) => { setLozinka(e.target.value); setGreska(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") prijavi(); }}
              />
            </Field>
            {greska && <div style={{ color: "var(--rust)", fontSize: 12.5, marginBottom: 10 }}>{greska}</div>}
            <Btn variant="primary" onClick={prijavi} disabled={saljem} className="f-display" style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>{saljem ? "Prijava…" : "Prijava"}</Btn>
          </>
        )}
      </div>
    </div>
  );
}

function BackupModal({ db, update, showToast, onClose }) {
  const [uvozPodaci, setUvozPodaci] = useState(null);
  const [greska, setGreska] = useState("");

  const izvezi = () => {
    const paket = { __erp_backup: true, verzija: 1, datum: new Date().toISOString(), podaci: Object.fromEntries(STORAGE_KEYS.map((k) => [k, db[k]])) };
    const blob = new Blob([JSON.stringify(paket, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-erp-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Backup preuzet.");
  };

  const ucitajDatoteku = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGreska("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const podaci = parsed?.podaci && typeof parsed.podaci === "object" ? parsed.podaci : parsed;
        const nadenoKljuceva = STORAGE_KEYS.filter((k) => podaci[k] !== undefined);
        if (nadenoKljuceva.length === 0) { setGreska("Datoteka ne sadrži prepoznatljive ERP podatke."); return; }
        setUvozPodaci(podaci);
      } catch {
        setGreska("Datoteka nije valjan JSON backup.");
      }
    };
    reader.readAsText(file);
  };

  const potvrdiUvoz = () => {
    STORAGE_KEYS.forEach((k) => { if (uvozPodaci[k] !== undefined) update(k, uvozPodaci[k]); });
    showToast("Podaci vraćeni iz backupa.");
    setUvozPodaci(null);
    onClose();
  };

  return (
    <Modal title="Backup — izvoz i uvoz baze" onClose={onClose} footer={<Btn onClick={onClose}>Zatvori</Btn>}>
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Download size={16} color="var(--steel)" />
          <strong className="f-display" style={{ fontSize: 14.5 }}>Izvoz (preuzmi backup)</strong>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 10 }}>Preuzima cijelu bazu (svi moduli) kao jednu JSON datoteku na tvoj uređaj. Preporuka: napravi ovo redovito (npr. svaki tjedan) dok koristiš prototip.</p>
        <Btn variant="primary" icon={Download} onClick={izvezi}>Preuzmi backup (.json)</Btn>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Upload size={16} color="var(--steel)" />
          <strong className="f-display" style={{ fontSize: 14.5 }}>Uvoz (vrati iz backupa)</strong>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--rust)", marginBottom: 10 }}><AlertCircle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Ovo će <strong>prepisati sve trenutne podatke</strong> podacima iz odabrane datoteke. Ne može se poništiti.</p>
        <input type="file" accept="application/json" onChange={ucitajDatoteku} style={{ fontSize: 13 }} />
        {greska && <div style={{ color: "var(--rust)", fontSize: 12.5, marginTop: 8 }}>{greska}</div>}
        {uvozPodaci && (
          <div style={{ marginTop: 12, padding: 10, background: "var(--surface-alt)", borderRadius: 3 }}>
            <div style={{ fontSize: 12.5, marginBottom: 8 }}>Datoteka sadrži:</div>
            <ul style={{ margin: "0 0 10px 18px", padding: 0, fontSize: 12 }}>
              {STORAGE_KEYS.filter((k) => uvozPodaci[k] !== undefined).map((k) => (
                <li key={k}>{k}: <strong className="f-mono">{Array.isArray(uvozPodaci[k]) ? uvozPodaci[k].length : "1"}</strong> {Array.isArray(uvozPodaci[k]) ? "zapisa" : "objekt"}</li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" size="sm" onClick={() => setUvozPodaci(null)}>Odustani</Btn>
              <Btn variant="danger" size="sm" icon={Upload} onClick={potvrdiUvoz}>Potvrdi i prepiši sve podatke</Btn>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function App() {
  const [db, setDb] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [otvoriProjektId, setOtvoriProjektId] = useState(null); // id projekta čije detalje treba otvoriti pri dolasku na Projekte
  const [toast, setToast] = useState(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [potrebnaPrijava, setPotrebnaPrijava] = useState(false);
  const [prijavljenId, setPrijavljenIdInternal] = useState(() => {
    const token = localStorage.getItem("erp_token");
    const payload = token ? decodeJwtPayload(token) : null;
    return payload?.zaposlenikId || null;
  });

  const ucitajPodatke = async () => {
    const token = localStorage.getItem("erp_token");
    if (!token) { setDb(null); setPotrebnaPrijava(true); return; }
    try {
      const res = await fetch(`${API_URL}/api/data`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        localStorage.removeItem("erp_token");
        setPotrebnaPrijava(true);
        setPrijavljenIdInternal(null);
        return;
      }
      setDb(await res.json());
      setPotrebnaPrijava(false);
    } catch {
      showToast("Greška pri učitavanju podataka — provjeri internetsku vezu.");
    }
  };

  useEffect(() => { ucitajPodatke(); }, []);
  useEffect(() => { uskladiSatSPosluziteljem(); const t = setInterval(uskladiSatSPosluziteljem, 10 * 60 * 1000); return () => clearInterval(t); }, []);

  // Otpremnice se NE šalju kao cijeli popis (zastarjela kopija je znala obrisati otpremnicu koju je
  // netko drugi upravo izdao, a nova bi dobila isti broj) — šalje se samo razlika po id-u, a
  // server zaključava popis i dodjeljuje sljedeći slobodan broj ako je broj već zauzet.
  const patchOtpremnice = (newArr, kljuc = "otpremnice") => {
    const stare = new Map((db[kljuc] || []).map((o) => [o.id, JSON.stringify(o)]));
    const noveIds = new Set(newArr.map((o) => o.id));
    const upsert = newArr.filter((o) => stare.get(o.id) !== JSON.stringify(o));
    const remove = (db[kljuc] || []).filter((o) => !noveIds.has(o.id)).map((o) => o.id);
    setDb((prev) => ({ ...prev, [kljuc]: newArr }));
    if (upsert.length === 0 && remove.length === 0) return;
    fetch(`${API_URL}/api/${kljuc}/patch`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
      body: JSON.stringify({ upsert, remove }),
    }).then(async (res) => {
      if (!res.ok) { showToast(kljuc === "cmr" ? "Greška pri spremanju CMR-a." : kljuc === "slobodniZadaci" ? "Greška pri spremanju zadatka." : "Greška pri spremanju otpremnice."); return; }
      const data = await res.json();
      setDb((prev) => ({ ...prev, [kljuc]: data[kljuc] }));
      (data.promijenjeniBrojevi || []).forEach((p) => showToast(`Broj ${p.staro} je već bio zauzet — spremljeno kao ${p.novo}.`));
    }).catch(() => showToast("Greška pri spremanju — provjeri internetsku vezu."));
  };

  const update = (key, newArr) => {
    if (key === "otpremnice" || key === "cmr" || key === "slobodniZadaci") { patchOtpremnice(newArr, key); return; }
    setDb((prev) => ({ ...prev, [key]: newArr }));
    fetch(`${API_URL}/api/data/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
      body: JSON.stringify(newArr),
    }).catch(() => showToast("Greška pri spremanju — provjeri internetsku vezu."));
  };

  // Ciljana izmjena evidencijaRada — za razliku od update(), ne šalje CIJELI (potencijalno
  // zastarjeli) popis natrag, nego samo koje zapise dodati/izmijeniti (upsert, po id-u) i koje
  // ukloniti (remove, popis id-eva). Backend to primjenjuje na TRENUTNI (zaključani) popis u
  // bazi, ne na popis koji je ovaj preglednik učitao — inače bi npr. istovremena prijava na
  // kiosku, nastala nakon što je ova stranica zadnji put dohvatila podatke, nestala kad admin
  // spremi bilo kakvu, i nepovezanu, izmjenu evidencije.
  const patchEvidencija = async (upsert = [], remove = []) => {
    const token = localStorage.getItem("erp_token");
    try {
      const res = await fetch(`${API_URL}/api/evidencija/patch`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ upsert, remove }),
      });
      if (!res.ok) { showToast("Greška pri spremanju evidencije."); return false; }
      const data = await res.json();
      setDb((prev) => ({ ...prev, evidencijaRada: data.evidencijaRada }));
      return true;
    } catch {
      showToast("Greška pri spremanju — provjeri internetsku vezu.");
      return false;
    }
  };

  // Ciljana izmjena JEDNOG projekta (po id-u) — isti razlog kao patchEvidencija: obični update()
  // šalje cijeli popis projekata iz ovog preglednika, koji može biti zastario ako je stranica
  // dulje otvorena, pa bi tuđu (ili vlastitu stariju) izmjenu tiho prepisao natrag na staro.
  // OPTIMISTIČNO: lokalni prikaz se ažurira ODMAH (bez čekanja mreže) — ovo je bitno jer se
  // ista funkcija koristi i za polja koja se uređuju znak po znak (npr. upisivanje dimenzija
  // materijala); da se čekao odgovor poslužitelja prije prikaza, svaki bi upisani znak kasnio
  // sekundu-dvije (točno taj bug je i prijavljen). Zahtjev prema poslužitelju i dalje šalje SAMO
  // patch (ne cijeli popis), pa zaštita od prepisivanja ostaje — poslužiteljev odgovor naknadno
  // uskladi lokalno stanje ako se u međuvremenu nešto drugo promijenilo.
  const patchProjekt = (projektId, patch) => {
    setDb((prev) => ({ ...prev, projekti: prev.projekti.map((p) => (p.id === projektId ? { ...p, ...patch } : p)) }));
    const token = localStorage.getItem("erp_token");
    fetch(`${API_URL}/api/projekti/${projektId}/patch`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ patch }),
    }).then(async (res) => {
      if (!res.ok) { showToast("Greška pri spremanju projekta."); return; }
      const data = await res.json();
      setDb((prev) => ({ ...prev, projekti: data.projekti }));
    }).catch(() => showToast("Greška pri spremanju — provjeri internetsku vezu."));
  };

  // Samostalno označavanje zadatka projekta izvršenim (npr. s nadzorne ploče) — cilja SAMO taj
  // zadatak na serveru (isti razlog kao patchProjekt), a dopušteno je i zaposleniku bez pristupa
  // modulu Projekti dok god je zadatak dodijeljen baš njemu (provjerava backend).
  const patchZadatakIzvrseno = (projektId, zadId, izvrseno) => {
    setDb((prev) => ({
      ...prev,
      projekti: prev.projekti.map((p) => (p.id !== projektId ? p : {
        ...p,
        zadaci: (p.zadaci || []).map((z) => (z.id !== zadId ? z : { ...z, izvrseno, datumIzvrsenja: izvrseno ? (z.datumIzvrsenja || todayISO()) : null })),
      })),
    }));
    const token = localStorage.getItem("erp_token");
    fetch(`${API_URL}/api/projekti/${projektId}/zadatak/${zadId}/izvrseno`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ izvrseno }),
    }).then(async (res) => {
      if (!res.ok) { showToast("Greška pri spremanju zadatka."); return; }
      const data = await res.json();
      setDb((prev) => ({ ...prev, projekti: data.projekti }));
    }).catch(() => showToast("Greška pri spremanju — provjeri internetsku vezu."));
  };

  // Napomena uz zadatak projekta — kao patchZadatakIzvrseno: cilja samo taj zadatak, a dopuštena je i
  // osobi kojoj je zadatak dodijeljen bez pristupa modulu Projekti (provjerava backend).
  const patchZadatakNapomena = (projektId, zadId, napomena) => {
    const tekst = (napomena || "").trim() || null;
    setDb((prev) => ({
      ...prev,
      projekti: prev.projekti.map((p) => (p.id !== projektId ? p : {
        ...p,
        zadaci: (p.zadaci || []).map((z) => (z.id !== zadId ? z : { ...z, napomena: tekst, napomenaAutorId: tekst ? prijavljenId : null, napomenaDatum: tekst ? todayISO() : null })),
      })),
    }));
    fetch(`${API_URL}/api/projekti/${projektId}/zadatak/${zadId}/napomena`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
      body: JSON.stringify({ napomena: tekst }),
    }).then(async (res) => {
      if (!res.ok) { showToast("Greška pri spremanju napomene."); return; }
      const data = await res.json();
      setDb((prev) => ({ ...prev, projekti: data.projekti }));
    }).catch(() => showToast("Greška pri spremanju — provjeri internetsku vezu."));
  };

  // Ciljana izmjena upitiNabave — isti razlog i isti oblik (upsert/remove po id-u) kao
  // patchEvidencija, uz OPTIMISTIČNO lokalno ažuriranje kao patchProjekt (ponuda dobavljača se
  // uređuje polje po polje, pa se ne smije čekati mreža za svaki unos). upsert prima CIJELI
  // upit-objekt (zamjenjuje postojeći po id-u, ili ga dodaje ako je nov) — ne parcijalni patch.
  const patchUpiti = (upsert = [], remove = []) => {
    setDb((prev) => {
      const removeSet = new Set(remove);
      const upsertMap = new Map(upsert.map((u) => [u.id, u]));
      const postojeciIds = new Set(prev.upitiNabave.map((u) => u.id));
      const rezultat = prev.upitiNabave.filter((u) => !removeSet.has(u.id)).map((u) => (upsertMap.has(u.id) ? upsertMap.get(u.id) : u));
      upsert.forEach((u) => { if (!postojeciIds.has(u.id)) rezultat.push(u); });
      return { ...prev, upitiNabave: rezultat };
    });
    const token = localStorage.getItem("erp_token");
    fetch(`${API_URL}/api/upiti/patch`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ upsert, remove }),
    }).then(async (res) => {
      if (!res.ok) { showToast("Greška pri spremanju upita."); return; }
      const data = await res.json();
      setDb((prev) => ({ ...prev, upitiNabave: data.upitiNabave }));
    }).catch(() => showToast("Greška pri spremanju — provjeri internetsku vezu."));
  };

  // Ciljana izmjena CIJELIH projekata (upsert/remove po id-u) — isti oblik i razlog kao patchUpiti,
  // za operacije koje kreiraju/uređuju/brišu cijele zapise ili više projekata odjednom (kreiranje
  // projekta, ručno sortiranje, izmjene isporuka na tipskom projektu). Nadopunjuje patchProjekt
  // (koji mijenja samo navedena polja JEDNOG projekta) — bez ovoga su te operacije slale cijeli
  // db.projekti niz prema zastarjeloj lokalnoj kopiji, što je uzrokovalo nestanak projekta
  // RN 170-314.
  const patchProjekti = (upsert = [], remove = []) => {
    setDb((prev) => {
      const removeSet = new Set(remove);
      const upsertMap = new Map(upsert.map((p) => [p.id, p]));
      const postojeciIds = new Set(prev.projekti.map((p) => p.id));
      const rezultat = prev.projekti.filter((p) => !removeSet.has(p.id)).map((p) => (upsertMap.has(p.id) ? upsertMap.get(p.id) : p));
      upsert.forEach((p) => { if (!postojeciIds.has(p.id)) rezultat.push(p); });
      return { ...prev, projekti: rezultat };
    });
    const token = localStorage.getItem("erp_token");
    fetch(`${API_URL}/api/projekti/patch`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ upsert, remove }),
    }).then(async (res) => {
      if (!res.ok) { showToast("Greška pri spremanju projekata."); return; }
      const data = await res.json();
      setDb((prev) => ({ ...prev, projekti: data.projekti }));
    }).catch(() => showToast("Greška pri spremanju — provjeri internetsku vezu."));
  };

  // Ponovno učitava jedan ključ s backenda i osvježava lokalni state BEZ ponovnog PUT-a —
  // koristi se nakon promjena koje backend napravi izravno (npr. hashiranje lozinke), gdje
  // bi obični update() prepisao stvarni hash lokalnom (nepotpunom) kopijom podataka.
  const refetchKljuc = async (key) => {
    const token = localStorage.getItem("erp_token");
    const res = await fetch(`${API_URL}/api/data/${key}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const vrijednost = await res.json();
    setDb((prev) => ({ ...prev, [key]: vrijednost }));
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const urlParametri = new URLSearchParams(window.location.search);
  const jeKioskNacin = urlParametri.get("kiosk") === "1" || !!urlParametri.get("rfid");
  if (jeKioskNacin) return <KioskView />;

  // Početna stranica (bez prijave) je kiosk zaslon za evidenciju radnog vremena — gumb "Prijava"
  // u kutu prebacuje na stvarni login (?prijava=1), da uređaj na ulazu ne mora biti posebno adresiran.
  const zeliPrijavu = urlParametri.get("prijava") === "1";
  if ((potrebnaPrijava || !prijavljenId) && !zeliPrijavu) {
    return <KioskView onPrijava={() => { window.location.href = `${window.location.pathname}?prijava=1`; }} />;
  }

  if (potrebnaPrijava || !prijavljenId) {
    return (
      <LoginScreen
        onLogin={(token, zaposlenikOdgovor) => {
          localStorage.setItem("erp_token", token);
          setPrijavljenIdInternal(zaposlenikOdgovor.id);
          setPotrebnaPrijava(false);
          ucitajPodatke();
        }}
      />
    );
  }

  if (!db) {
    return (
      <div className="erp-root" style={{ minHeight: 420, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle />
        <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>Učitavanje podataka…</div>
      </div>
    );
  }

  const zaposlenik = db.zaposlenici.find((z) => z.id === prijavljenId);
  const mojaPozicija = db.pozicijeZaposlenika.find((p) => p.id === zaposlenik?.pozicijaId);
  const dopusteniKljucevi = mojaPozicija?.moduli?.length ? mojaPozicija.moduli : ["dashboard"];
  const NAV = MODULI_APLIKACIJE.filter((m) => dopusteniKljucevi.includes(m.key));
  const aktivnaStranica = dopusteniKljucevi.includes(page) ? page : (dopusteniKljucevi[0] || "dashboard");
  const odjava = () => {
    localStorage.removeItem("erp_token");
    setDb(null);
    setPrijavljenIdInternal(null);
    setPage("dashboard");
  };

  return (
    <div className="erp-root" style={{ display: "flex", minHeight: 640, background: "var(--bg)" }}>
      <GlobalStyle />

      {/* SIDEBAR */}
      <div style={{ width: 60, background: "var(--sidebar)", flexShrink: 0, display: "flex", flexDirection: "column" }} className="sidebar-wrap">
        <div style={{ padding: "18px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ width: 26, height: 26, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 2 }}>
            <Building2 size={15} color="var(--accent-ink)" />
          </div>
        </div>
        <nav style={{ paddingTop: 8, flex: 1 }}>
          {NAV.map((item) => (
            <div key={item.key} className={`sidebar-item ${aktivnaStranica === item.key ? "active" : ""}`} onClick={() => setPage(item.key)} title={item.label}>
              <item.icon size={17} style={{ flexShrink: 0 }} />
              <span className="nav-label" style={{ display: "none" }}>{item.label}</span>
            </div>
          ))}
        </nav>
      </div>

      {/* WIDE SIDEBAR FOR LARGER SCREENS */}
      <style>{`
        @media (min-width:820px){
          .sidebar-wrap{ width:230px !important; }
          .sidebar-wrap .nav-label{ display:inline !important; }
        }
      `}</style>

      {/* MAIN */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--line)", background: "var(--surface)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="f-mono" style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "var(--ink-faint)", textTransform: "uppercase" }}>ERP · Proizvodnja čeličnih konstrukcija</div>
            <div className="f-display" style={{ fontSize: 15, fontWeight: 600 }}>{db.postavkeTvrtke?.naziv || "ECON D.O.O."}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{new Date().toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
            <div style={{ width: 1, height: 26, background: "var(--line)" }} />
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{zaposlenik?.ime} {zaposlenik?.prezime}</div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{mojaPozicija?.naziv || "—"}</div>
            </div>
            {mojaPozicija?.id === "poz-administrator" && <Btn variant="ghost" size="sm" icon={Database} onClick={() => setBackupOpen(true)}>Backup</Btn>}
            <Btn variant="ghost" size="sm" onClick={odjava}>Odjava</Btn>
          </div>
        </div>

        <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
          {aktivnaStranica === "dashboard" && <Dashboard db={db} update={update} setPage={setPage} otvoriProjekt={(id) => { if (dopusteniKljucevi.includes("projekti")) setOtvoriProjektId(id); setPage("projekti"); }} mojId={zaposlenik?.id} mojaPozicija={mojaPozicija} patchZadatakIzvrseno={patchZadatakIzvrseno} patchZadatakNapomena={patchZadatakNapomena} />}
          {aktivnaStranica === "skladiste" && <SkladistePage db={db} update={update} showToast={showToast} mojaPozicija={mojaPozicija} />}
          {aktivnaStranica === "nabava" && <NabavaPage db={db} update={update} patchUpiti={patchUpiti} showToast={showToast} mojaPozicija={mojaPozicija} />}
          {aktivnaStranica === "proizvodnja" && <ProizvodnjaPage db={db} update={update} patchProjekt={patchProjekt} showToast={showToast} mojaPozicija={mojaPozicija} otvoriProjekt={dopusteniKljucevi.includes("projekti") ? (id) => { setOtvoriProjektId(id); setPage("projekti"); } : undefined} />}
          {aktivnaStranica === "projekti" && <ProjektiPage db={db} update={update} patchProjekt={patchProjekt} patchProjekti={patchProjekti} patchUpiti={patchUpiti} showToast={showToast} setPage={setPage} mojaPozicija={mojaPozicija} mojId={zaposlenik?.id} otvoriProjektId={otvoriProjektId} ocistiOtvoriProjekt={() => setOtvoriProjektId(null)} />}
          {aktivnaStranica === "fakturiranje" && <FakturiranjePage db={db} update={update} patchProjekt={patchProjekt} showToast={showToast} mojaPozicija={mojaPozicija} mojId={zaposlenik?.id} />}
          {aktivnaStranica === "partneri" && <PartneriPage db={db} update={update} showToast={showToast} mojaPozicija={mojaPozicija} />}
          {aktivnaStranica === "zaposlenici" && <ZaposleniciPage db={db} update={update} showToast={showToast} refetchKljuc={refetchKljuc} patchEvidencija={patchEvidencija} mojaPozicija={mojaPozicija} />}
        </div>

      </div>

      {backupOpen && <BackupModal db={db} update={update} showToast={showToast} onClose={() => setBackupOpen(false)} />}

      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, background: "var(--ink)", color: "#fff", padding: "10px 16px", borderRadius: 3, fontSize: 13, display: "flex", alignItems: "center", gap: 8, zIndex: 100 }}>
          <CheckCircle2 size={15} color="var(--accent)" /> {toast}
        </div>
      )}
    </div>
  );
}

/* ============================== NAPOMENA UZ ZADATAK ============================== */
// Napomena uz zadatak (projektni ili slobodni): prikaz teksta s autorom i datumom te uređivanje u
// retku. Prazna napomena briše postojeću. Klikovi ne idu dalje (redak na nadzornoj ploči otvara projekt).
const STIL_LINK_GUMBA = { background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 600, color: "var(--steel)" };
function NapomenaZadatka({ zadatak, imeZaposlenika, mozeUredjivati, onSpremi, uvlaka = 0 }) {
  const [uredjujem, setUredjujem] = useState(false);
  const [tekst, setTekst] = useState("");
  const otvori = () => { setTekst(zadatak.napomena || ""); setUredjujem(true); };
  const spremi = () => { onSpremi(tekst.trim()); setUredjujem(false); };
  const stani = (e) => e.stopPropagation();
  if (uredjujem) return (
    <div onClick={stani} style={{ marginLeft: uvlaka, marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea className="textarea" rows={2} autoFocus aria-label={`Napomena uz zadatak ${zadatak.naziv}`} placeholder="Napomena uz zadatak…" value={tekst} onChange={(e) => setTekst(e.target.value)} style={{ fontSize: 12.5 }} />
      <div style={{ display: "flex", gap: 6 }}>
        <Btn size="sm" variant="primary" onClick={spremi}>Spremi napomenu</Btn>
        <Btn size="sm" onClick={() => setUredjujem(false)}>Odustani</Btn>
      </div>
    </div>
  );
  if (zadatak.napomena) return (
    <div onClick={stani} style={{ marginLeft: uvlaka, marginTop: 6, padding: "6px 10px", background: "var(--surface-alt)", borderRadius: 3, fontSize: 12.5 }}>
      <div style={{ whiteSpace: "pre-wrap", color: "var(--ink)" }}>{zadatak.napomena}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 3, fontSize: 11, color: "var(--ink-soft)", flexWrap: "wrap" }}>
        {zadatak.napomenaAutorId && <span>{imeZaposlenika(zadatak.napomenaAutorId)}</span>}
        {zadatak.napomenaDatum && <span>{fmtDate(zadatak.napomenaDatum)}</span>}
        {mozeUredjivati && <button type="button" onClick={otvori} style={STIL_LINK_GUMBA}>Uredi napomenu</button>}
      </div>
    </div>
  );
  return mozeUredjivati ? <div onClick={stani} style={{ marginLeft: uvlaka, marginTop: 4 }}><button type="button" onClick={otvori} style={STIL_LINK_GUMBA}>+ Napomena</button></div> : null;
}

/* ============================== DASHBOARD ============================== */
function Dashboard({ db, update, setPage, otvoriProjekt, mojId, mojaPozicija, patchZadatakIzvrseno, patchZadatakNapomena }) {
  const [zadaciZa, setZadaciZa] = useState("moji"); // "moji" | "svi" | id zaposlenika
  const [dodajZadatakOtvoreno, setDodajZadatakOtvoreno] = useState(false);
  const [noviSlobodni, setNoviSlobodni] = useState({ naziv: "", datum: "", kome: "" });
  const aktivniProjekti = db.projekti.filter((p) => ["U izradi", "Montaža"].includes(p.status));
  const otvorenePonude = db.ponude.filter((p) => p.status === "Poslana" || p.status === "U izradi");
  const vrijednostPonuda = otvorenePonude.reduce((s, p) => s + izracunPonude(p, db.materijali, db.cjenikRada, db.katalogProfila, db.kvaliteteMaterijala).cijenaKonacna, 0);
  const radniNaloziUTijeku = db.radniNalozi.filter((r) => r.status === "U tijeku");
  const niskaZaliha = db.materijali.filter((m) => m.kolicina < m.minZaliha);
  const neplaceneFakture = db.fakture.filter((f) => f.status !== "Plaćeno");
  const dugovanje = neplaceneFakture.reduce((s, f) => s + izracunFakture(f, db.postavkeTvrtke?.pdvStopa).ukupno, 0);
  const kasneFakture = db.fakture.filter((f) => f.status === "Kasni" || (f.status !== "Plaćeno" && daysUntil(f.rokPlacanja) < 0));
  const uskoroRokovi = db.projekti.filter((p) => !["Završen", "Otkazan"].includes(p.status) && daysUntil(p.rokZavrsetka) <= 30 && daysUntil(p.rokZavrsetka) >= 0).sort((a, b) => daysUntil(a.rokZavrsetka) - daysUntil(b.rokZavrsetka));

  // Zadaci dodijeljeni MENI, na bilo kojem projektu, koji još nisu izvršeni — čim ih netko
  // označi izvršenima, nestaju odavde (nema arhive na nadzornoj ploči).
  // Tko ima pristup projektima može izabrati i zadatke bilo koje druge osobe (samo pregled).
  // Zadatke svih zaposlenika vide samo direktor i glavni administrator; ostali vide samo svoje.
  const mozeVidjetiTudje = ["poz-direktor", "poz-administrator"].includes(mojaPozicija?.id);
  // Zadavati zadatke drugoj osobi (i brisati tuđe) smiju još i korisnici s pristupom projektima.
  const mozeZadavatiDrugima = mozeVidjetiTudje || ((mojaPozicija?.moduli || []).includes("projekti") && dozvolaZaKarticu(mojaPozicija, "projekti", "projekti").pristup);
  const imeZaposlenika = (id) => { const z = db.zaposlenici.find((x) => x.id === id); return z ? `${z.prezime} ${z.ime}` : "—"; };
  const sviOtvoreniZadaci = [];
  db.projekti.forEach((p) => {
    (p.zadaci || []).forEach((z) => {
      if (z.dodijeljenoId && !z.izvrseno) sviOtvoreniZadaci.push({ ...z, projektId: p.id, projektNaziv: p.naziv, projektSifra: p.sifra });
    });
  });
  // Zadaci koji nisu vezani uz projekt (dodaju se izravno s nadzorne ploče).
  const slobodniZadaci = db.slobodniZadaci || [];
  slobodniZadaci.forEach((z) => {
    if (z.dodijeljenoId && !z.izvrseno) sviOtvoreniZadaci.push({ ...z, projektId: null, projektNaziv: "", projektSifra: "", slobodan: true });
  });
  const dodajSlobodniZadatak = () => {
    const naziv = noviSlobodni.naziv.trim();
    if (!naziv) return;
    const kome = mozeZadavatiDrugima && noviSlobodni.kome ? noviSlobodni.kome : mojId;
    update("slobodniZadaci", [...slobodniZadaci, { id: uid("sz"), naziv, dodijeljenoId: kome, planiraniDatum: noviSlobodni.datum || null, izvrseno: false, izvrsioId: null, datumIzvrsenja: null, kreiraoId: mojId }]);
    setNoviSlobodni({ naziv: "", datum: "", kome: "" });
  };
  const mozeMijenjatiProjekte = (mojaPozicija?.moduli || []).includes("projekti") && dozvolaZaKarticu(mojaPozicija, "projekti", "projekti").izmjene;
  const spremiNapomenuSlobodnog = (id, tekst) => update("slobodniZadaci", slobodniZadaci.map((z) => (z.id === id ? { ...z, napomena: tekst || null, napomenaAutorId: tekst ? mojId : null, napomenaDatum: tekst ? todayISO() : null } : z)));
  const oznaciSlobodniIzvrsenim = (id) => update("slobodniZadaci", slobodniZadaci.map((z) => (z.id === id ? { ...z, izvrseno: true, izvrsioId: mojId, datumIzvrsenja: todayISO() } : z)));
  const obrisiSlobodni = (id) => { if (window.confirm("Obrisati ovaj zadatak?")) update("slobodniZadaci", slobodniZadaci.filter((z) => z.id !== id)); };
  const brojPoOsobi = new Map();
  sviOtvoreniZadaci.forEach((z) => brojPoOsobi.set(z.dodijeljenoId, (brojPoOsobi.get(z.dodijeljenoId) || 0) + 1));
  const osobeSaZadacima = [...brojPoOsobi.keys()].filter((id) => id !== mojId).sort((a, b) => imeZaposlenika(a).localeCompare(imeZaposlenika(b), "hr"));
  const odabrano = mozeVidjetiTudje ? zadaciZa : "moji";
  const mojiZadaci = sviOtvoreniZadaci
    .filter((z) => (odabrano === "svi" ? true : z.dodijeljenoId === (odabrano === "moji" ? mojId : odabrano)))
    .sort((a, b) => (a.planiraniDatum || "9999-99-99").localeCompare(b.planiraniDatum || "9999-99-99"));
  const gledamTudje = odabrano !== "moji";

  return (
    <div>
      <PageHeader title="Nadzorna ploča" subtitle="Pregled stanja proizvodnje, skladišta i financija" icon={LayoutDashboard} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div className="kpi-card beam-tick" onClick={() => setPage("projekti")} style={{ cursor: "pointer" }}>
          <div className="kpi-num">{aktivniProjekti.length}</div>
          <div className="kpi-label">Aktivni projekti</div>
        </div>
        <div className="kpi-card beam-tick" onClick={() => setPage("projekti")} style={{ cursor: "pointer" }}>
          <div className="kpi-num">{fmtCur(vrijednostPonuda)}</div>
          <div className="kpi-label">Otvorene ponude ({otvorenePonude.length})</div>
        </div>
        <div className="kpi-card beam-tick" onClick={() => setPage("proizvodnja")} style={{ cursor: "pointer" }}>
          <div className="kpi-num">{radniNaloziUTijeku.length}</div>
          <div className="kpi-label">Radni nalozi u tijeku</div>
        </div>
        <div className="kpi-card beam-tick" onClick={() => setPage("skladiste")} style={{ cursor: "pointer", borderColor: niskaZaliha.length ? "#F0C2B5" : undefined }}>
          <div className="kpi-num" style={{ color: niskaZaliha.length ? "var(--rust)" : undefined }}>{niskaZaliha.length}</div>
          <div className="kpi-label">Materijali ispod min. zalihe</div>
        </div>
        <div className="kpi-card beam-tick" onClick={() => setPage("fakturiranje")} style={{ cursor: "pointer", borderColor: kasneFakture.length ? "#F0C2B5" : undefined }}>
          <div className="kpi-num">{fmtCur(dugovanje)}</div>
          <div className="kpi-label">Nenaplaćeno ({neplaceneFakture.length} faktura)</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="dash-grid">
        <style>{`@media (max-width:760px){ .dash-grid{ grid-template-columns:1fr !important; } }`}</style>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <CheckCircle2 size={15} color="var(--steel)" />
            <h3 className="f-display" style={{ fontSize: 14.5, fontWeight: 600 }}>{odabrano === "moji" ? "Moji zadaci" : odabrano === "svi" ? "Zadaci svih zaposlenika" : `Zadaci: ${imeZaposlenika(odabrano)}`}</h3>
            <Btn variant="ghost" size="sm" icon={Plus} onClick={() => setDodajZadatakOtvoreno((o) => !o)} style={{ marginLeft: "auto" }}>Novi zadatak</Btn>
            {mozeVidjetiTudje && (
              <select className="select" style={{ width: 210, fontSize: 12, padding: "4px 8px" }} value={zadaciZa} onChange={(e) => setZadaciZa(e.target.value)}>
                <option value="moji">Moji zadaci</option>
                <option value="svi">Svi zaposlenici ({sviOtvoreniZadaci.length})</option>
                {osobeSaZadacima.map((id) => <option key={id} value={id}>{imeZaposlenika(id)} ({brojPoOsobi.get(id)})</option>)}
              </select>
            )}
          </div>
          {dodajZadatakOtvoreno && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, padding: 8, background: "var(--surface-alt)", borderRadius: 3 }}>
              <input className="input" style={{ flex: "1 1 200px" }} autoFocus placeholder="Zadatak (nije vezan uz projekt)…" value={noviSlobodni.naziv} onChange={(e) => setNoviSlobodni({ ...noviSlobodni, naziv: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") dodajSlobodniZadatak(); }} />
              {mozeZadavatiDrugima && (
                <select className="select" style={{ width: 170 }} value={noviSlobodni.kome} onChange={(e) => setNoviSlobodni({ ...noviSlobodni, kome: e.target.value })}>
                  <option value="">Meni</option>
                  {[...db.zaposlenici].filter((z) => z.id !== mojId).sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
                </select>
              )}
              <input type="date" className="input" style={{ width: 150 }} value={noviSlobodni.datum} onChange={(e) => setNoviSlobodni({ ...noviSlobodni, datum: e.target.value })} title="Rok izvršenja (nije obavezan)" />
              <Btn variant="primary" size="sm" icon={Plus} onClick={dodajSlobodniZadatak}>Dodaj</Btn>
            </div>
          )}
          {mojiZadaci.length === 0 ? <EmptyState text={gledamTudje ? "Nema otvorenih zadataka." : "Nemaš dodijeljenih zadataka."} /> : (
            <div>
              {mojiZadaci.map((z) => {
                const kasni = z.planiraniDatum && daysUntil(z.planiraniDatum) < 0;
                return (
                  <div key={z.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
                    {z.dodijeljenoId === mojId
                      ? <input type="checkbox" checked={false} onChange={() => (z.slobodan ? oznaciSlobodniIzvrsenim(z.id) : patchZadatakIzvrseno(z.projektId, z.id, true))} style={{ width: 15, height: 15, flexShrink: 0, marginTop: 2 }} />
                      : <span style={{ width: 15, flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0, cursor: z.slobodan ? "default" : "pointer" }} title={z.slobodan ? undefined : "Otvori projekt"} onClick={() => { if (!z.slobodan) otvoriProjekt(z.projektId); }}>
                      <div style={{ fontSize: 13 }}>{z.naziv}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{z.slobodan ? "Bez projekta" : `${z.projektSifra} — ${z.projektNaziv}`}{z.slobodan && z.kreiraoId && z.kreiraoId !== z.dodijeljenoId && <> · zadano od: {imeZaposlenika(z.kreiraoId)}</>}{odabrano === "svi" && z.dodijeljenoId !== mojId && <> · <strong style={{ color: "var(--steel)" }}>{imeZaposlenika(z.dodijeljenoId)}</strong></>}</div>
                      <NapomenaZadatka
                        zadatak={z}
                        imeZaposlenika={imeZaposlenika}
                        mozeUredjivati={z.slobodan ? (z.dodijeljenoId === mojId || z.kreiraoId === mojId || mozeZadavatiDrugima) : (z.dodijeljenoId === mojId || mozeMijenjatiProjekte)}
                        onSpremi={(tekst) => (z.slobodan ? spremiNapomenuSlobodnog(z.id, tekst) : patchZadatakNapomena(z.projektId, z.id, tekst))}
                      />
                    </div>
                    {z.planiraniDatum && <span className="f-mono" style={{ fontSize: 11.5, color: kasni ? "var(--rust)" : "var(--ink-soft)", flexShrink: 0, whiteSpace: "nowrap" }}>{fmtDate(z.planiraniDatum)}</span>}
                    {z.slobodan && (mozeZadavatiDrugima || z.kreiraoId === mojId) && <button type="button" onClick={() => obrisiSlobodni(z.id)} title="Obriši zadatak" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-faint)", padding: 0, flexShrink: 0 }}><Trash2 size={13} /></button>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <Clock size={15} color="var(--steel)" />
            <h3 className="f-display" style={{ fontSize: 14.5, fontWeight: 600 }}>Rokovi projekata (30 dana)</h3>
          </div>
          {uskoroRokovi.length === 0 ? <EmptyState text="Nema nadolazećih rokova." /> : (
            <table className="erp-table">
              <thead><tr><th>Projekt</th><th>Rok</th><th>Preostalo</th></tr></thead>
              <tbody>
                {uskoroRokovi.map((p) => (
                  <tr key={p.id}><td>{p.naziv}</td><td className="f-mono">{fmtDate(p.rokZavrsetka)}</td><td className="f-mono">{daysUntil(p.rokZavrsetka)} d.</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== SKLADIŠTE ============================== */
const TIPOVI_MATERIJALA = ["HEA", "HEB", "HEM", "IPE", "IPN", "UPN", "SHS", "RHS", "CHS", "Okrugla šipka", "Kvadratna šipka", "Plosnat", "Kutni jednakokraki", "Kutni raznokraki", "Lim", "Vijčana roba", "Boja i premazi", "Ostalo"];
const JEDINICE = ["kg", "kom", "m", "m2", "l"];

const TIPOVI_KATALOGA = ["HEA", "HEB", "HEM", "IPE", "IPN", "UPN", "SHS", "RHS", "CHS", "Okrugla šipka", "Kvadratna šipka", "Plosnat", "Kutni jednakokraki", "Kutni raznokraki", "Lim", "Ostalo"];
const katalogPoTipu = (katalog) => TIPOVI_KATALOGA.map((tip) => ({ tip, stavke: katalog.filter((k) => k.tip === tip) })).filter((g) => g.stavke.length);
// Puni naziv kataloške stavke za prikaz — oznaka obično već sadrži tip (npr. "HEA 100", "Lim 1
// mm"), pa se tip ne dodaje ispred ako bi se time udvostručio (npr. "HEA HEA 100").
const katalogOznakaPuna = (k) => (k.oznaka?.toUpperCase().startsWith((k.tip || "").toUpperCase()) ? k.oznaka : `${k.tip} ${k.oznaka}`.trim());
const masaIzKataloga = (entry, dimenzija) => (entry ? (Number(entry.vrijednost) || 0) * (Number(dimenzija) || 0) : 0);

// Pozicija se sastoji od više stavki (profila i/ili limova) — masa/kom jedne stavke, pa masa cijele pozicije
// (zbroj svih stavki × njihovi komadi, pomnoženo s količinom pozicije).
const masaStavkePozicije = (s, katalog, kvalitete) => {
  const faktor = faktorGustoce(kvalitete, s.kvaliteta);
  if (s.nacinMase === "katalog") {
    const entry = katalog.find((k) => k.id === s.katalogId);
    if (entry?.jedinica === "kg/m2") {
      const povrsinaM2 = ((Number(s.sirinaMM) || 0) * (Number(s.duzinaMM) || 0)) / 1e6;
      return (Number(entry.vrijednost) || 0) * povrsinaM2 * faktor;
    }
    return masaIzKataloga(entry, s.dimenzija) * faktor;
  }
  return Number(s.masaJed) || 0;
};
const masaPozicije = (p, katalog, kvalitete) => (p.stavke || []).reduce((sum, s) => sum + masaStavkePozicije(s, katalog, kvalitete) * (Number(s.komada) || 1), 0);

// Trošak materijala jedne stavke (profil/lim) — masa (po komadu) × broj komada × cijena po kg
// koju korisnik upiše izravno na stavci, umjesto da cijenu naknadno traži u zasebnom popisu.
const trosakStavkeMaterijala = (s, katalog, kvalitete) => masaStavkePozicije(s, katalog, kvalitete) * (Number(s.komada) || 1) * (Number(s.cijenaKg) || 0);
// Trošak materijala iz kataloga (profili/limovi) za CIJELU poziciju (sve stavke × količina pozicije).
const trosakMaterijalaIzKatalogaPozicije = (p, katalog, kvalitete) => (p.stavke || []).reduce((s, st) => s + trosakStavkeMaterijala(st, katalog, kvalitete), 0) * (Number(p.kolicina) || 1);

// Raščlamba troška jedne stavke (pozicije) ponude — dijeljeno između PozicijeEditor (uređivanje) i
// PonudaPrintModal (PDF), da obje strane uvijek računaju po ISTOJ formuli.
const satiPozicije = (p) => OPERACIJE.reduce((s, o) => s + (Number(p.operacije?.[o.key]) || 0), 0);
const trosakRadaPozicije = (p, cjenikRada) => OPERACIJE.reduce((s, o) => s + (Number(p.operacije?.[o.key]) || 0) * (Number(cjenikRada?.[o.key]) || 0), 0);
const akzPozicije = (p, katalog, kvalitete) => {
  const masaUkupnaPoz = masaPozicije(p, katalog, kvalitete) * (Number(p.kolicina) || 0);
  return (p.stavkeAKZ || []).reduce((s, a) => s + masaUkupnaPoz * (Number(a.cijenaKg) || 0), 0);
};
const montazaPozicije = (p, satnicaMontaza) => (Number(p.brojMontera) || 0) * (Number(p.planiraniSatiMontaza) || 0) * (Number(p.kolicina) || 0) * (Number(satnicaMontaza) || 0);
// Trošak materijala stavke (pozicije) = iz kataloga (profili/limovi, cijena upisana na svakoj
// stavci) + materijal iz skladišta (zaseban popis, npr. gotovi kupljeni artikli).
const materijalPozicije = (p, katalog, kvalitete, materijaliSkladiste) => trosakMaterijalaIzKatalogaPozicije(p, katalog, kvalitete) + (p.materijalStavke || []).reduce((s, st) => {
  const m = (materijaliSkladiste || []).find((x) => x.id === st.materijalId);
  const cijena = st.cijenaPoJed != null ? Number(st.cijenaPoJed) : (m ? m.cijena : 0);
  return s + cijena * efektivnaKolicinaMaterijala(st, m);
}, 0);
const ostaloPozicije = (p) => (p.ostaleStavke || []).reduce((s, st) => s + (Number(st.kolicina) || 0) * (Number(st.cijenaJed) || 0), 0);
// Ukupna cijena stavke SA maržom (za cijelu količinu stavke) — isti izračun kao u Rekapitulaciji.
const cijenaPozicijeSaMarzom = (p, { cjenikRada, katalog, kvalitete, satnicaMontaza, materijaliSkladiste, postotakMarze }) => {
  const bezMarze = trosakRadaPozicije(p, cjenikRada) + materijalPozicije(p, katalog, kvalitete, materijaliSkladiste) + akzPozicije(p, katalog, kvalitete) + montazaPozicije(p, satnicaMontaza) + ostaloPozicije(p);
  return bezMarze * (1 + (Number(postotakMarze) || 0) / 100);
};

function SkladistePage({ db, update, showToast, mojaPozicija }) {
  const dozvKartice = dozvoljeneKarticeModula(mojaPozicija, "skladiste");
  const [tab, setTab] = useState(dozvKartice[0]?.key || "zalihe");
  useEffect(() => { if (!dozvKartice.some((k) => k.key === tab)) setTab(dozvKartice[0]?.key || "zalihe"); }, [dozvKartice, tab]);
  const mozeZalihe = dozvolaZaKarticu(mojaPozicija, "skladiste", "zalihe").izmjene;
  const mozeKatalog = dozvolaZaKarticu(mojaPozicija, "skladiste", "katalog").izmjene;
  const mozeKvaliteta = dozvolaZaKarticu(mojaPozicija, "skladiste", "kvaliteta").izmjene;
  const mozeIzdatnice = dozvolaZaKarticu(mojaPozicija, "skladiste", "izdatnice").izmjene;
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', item}
  const [del, setDel] = useState(null);
  const [izdajZa, setIzdajZa] = useState(null); // materijalId za predpunjenje IzdatnicaModal, ili true za praznu
  const [printIzdatnica, setPrintIzdatnica] = useState(null);
  const [povratZa, setPovratZa] = useState(null);
  const [delIzdatnica, setDelIzdatnica] = useState(null);
  const projSifraZaMaterijal = (id) => db.projekti.find((p) => p.id === id)?.sifra || null;
  const empty = { sifra: "", naziv: "", tip: TIPOVI_MATERIJALA[0], dimenzije: "", jm: "kg", cijena: 0, kolicina: 0, minZaliha: 0, lokacija: "", kgPoM: 0, kgPoM2: 0, projektId: null, kvaliteta: "" };
  const [form, setForm] = useState(empty);
  // Opcionalni pomoćni unos "iz kataloga" — bira se profil/lim, upiše dužina (i za lim širina) +
  // komada + kvaliteta materijala, a masa (Trenutno stanje) se sama izračuna umjesto ručnog unosa.
  const emptyKatalogUnos = { katalogId: "", duzinaMM: "", sirinaMM: "", komada: 1, kvaliteta: "celik" };
  const [katalogUnos, setKatalogUnos] = useState(emptyKatalogUnos);
  const katalogEntry = db.katalogProfila.find((k) => k.id === katalogUnos.katalogId);
  const jeLimUnos = katalogEntry?.jedinica === "kg/m2";
  const faktorKvaliteteUnos = faktorGustoce(db.kvaliteteMaterijala, katalogUnos.kvaliteta);
  const izracunataMasaUnos = !katalogEntry ? 0 : jeLimUnos
    ? ((Number(katalogUnos.duzinaMM) || 0) / 1000) * ((Number(katalogUnos.sirinaMM) || 0) / 1000) * Number(katalogEntry.vrijednost) * faktorKvaliteteUnos * (Number(katalogUnos.komada) || 1)
    : ((Number(katalogUnos.duzinaMM) || 0) / 1000) * Number(katalogEntry.vrijednost) * faktorKvaliteteUnos * (Number(katalogUnos.komada) || 1);

  const odaberiKatalogUnos = (katalogId) => {
    setKatalogUnos({ ...emptyKatalogUnos, katalogId });
    const entry = db.katalogProfila.find((k) => k.id === katalogId);
    if (entry) {
      // Šifra se predlaže iz oznake (isti obrazac kao sifraIzKataloga) ali ostaje uredljiva —
      // predlaže se samo ako korisnik već nije nešto upisao, da ne prepiše ručni unos.
      const predlozenaSifra = sifraIzKataloga(entry);
      setForm((f) => ({ ...f, sifra: f.sifra.trim() ? f.sifra : predlozenaSifra, tip: entry.tip, naziv: `${entry.tip} ${entry.oznaka}`, jm: "kg" }));
    }
  };

  const openAdd = () => { setForm(empty); setKatalogUnos(emptyKatalogUnos); setModal({ mode: "add" }); };
  const openEdit = (item) => { setForm(item); setKatalogUnos(emptyKatalogUnos); setModal({ mode: "edit" }); };
  const save = () => {
    if (!form.sifra.trim() || !form.naziv.trim()) { showToast("Šifra i naziv su obavezni."); return; }
    const duplikat = db.materijali.some((m) => m.sifra.trim().toLowerCase() === form.sifra.trim().toLowerCase() && m.id !== form.id);
    if (duplikat) { showToast(`Šifra "${form.sifra}" već postoji na drugom materijalu — koristi drugu šifru.`); return; }
    const dimenzijeIzKataloga = !katalogEntry ? form.dimenzije : jeLimUnos ? `${katalogUnos.duzinaMM || 0}×${katalogUnos.sirinaMM || 0} mm` : `${katalogUnos.duzinaMM || 0} mm`;
    const payload = {
      ...form, cijena: Number(form.cijena), minZaliha: Number(form.minZaliha),
      dimenzije: dimenzijeIzKataloga,
      kolicina: katalogEntry ? Number(izracunataMasaUnos.toFixed(2)) : Number(form.kolicina),
      kgPoM: katalogEntry ? (jeLimUnos ? 0 : Number(katalogEntry.vrijednost)) : Number(form.kgPoM) || 0,
      kgPoM2: katalogEntry ? (jeLimUnos ? Number(katalogEntry.vrijednost) : 0) : Number(form.kgPoM2) || 0,
    };
    if (modal.mode === "add") update("materijali", [...db.materijali, { ...payload, id: uid("mat") }]);
    else update("materijali", db.materijali.map((m) => (m.id === form.id ? payload : m)));
    showToast("Materijal spremljen.");
    setModal(null);
  };

  // katalog CRUD
  const [katModal, setKatModal] = useState(null);
  const [katDel, setKatDel] = useState(null);
  const emptyKat = { tip: TIPOVI_KATALOGA[0], oznaka: "", jedinica: "kg/m", vrijednost: 0 };
  const [katForm, setKatForm] = useState(emptyKat);
  const openKatAdd = () => { setKatForm(emptyKat); setKatModal("add"); };
  const openKatEdit = (item) => { setKatForm(item); setKatModal("edit"); };
  const saveKat = () => {
    if (!katForm.oznaka.trim()) return;
    const payload = { ...katForm, vrijednost: Number(katForm.vrijednost) };
    if (katModal === "add") update("katalogProfila", [...db.katalogProfila, { ...payload, id: uid("kat") }]);
    else update("katalogProfila", db.katalogProfila.map((k) => (k.id === katForm.id ? payload : k)));
    setKatModal(null);
    showToast("Stavka kataloga spremljena.");
  };

  // kvaliteta materijala CRUD — korisnički definirane vrste (naziv + gustoća kg/dm3), koriste se
  // u padajućim izbornicima kod unosa materijala i pozicija ponude (vidi faktorGustoce()).
  const kvaliteteMaterijala = db.kvaliteteMaterijala && db.kvaliteteMaterijala.length ? db.kvaliteteMaterijala : ZADANE_KVALITETE_MATERIJALA;
  const [kvalModal, setKvalModal] = useState(null);
  const [kvalDel, setKvalDel] = useState(null);
  const emptyKval = { naziv: "", gustoca: GUSTOCA_CELIKA };
  const [kvalForm, setKvalForm] = useState(emptyKval);
  const openKvalAdd = () => { setKvalForm(emptyKval); setKvalModal("add"); };
  const openKvalEdit = (item) => { setKvalForm(item); setKvalModal("edit"); };
  const saveKval = () => {
    if (!kvalForm.naziv.trim()) return;
    const payload = { ...kvalForm, gustoca: Number(kvalForm.gustoca) || 0 };
    if (kvalModal === "add") update("kvaliteteMaterijala", [...kvaliteteMaterijala, { ...payload, id: uid("kvl") }]);
    else update("kvaliteteMaterijala", kvaliteteMaterijala.map((k) => (k.id === kvalForm.id ? payload : k)));
    setKvalModal(null);
    showToast("Kvaliteta materijala spremljena.");
  };

  return (
    <div>
      <PageHeader title="Skladište" icon={Package} subtitle="Zalihe materijala i katalog standardnih profila/limova za izračun mase" />
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        {dozvKartice.some((k) => k.key === "zalihe") && <div className={`nav-tab ${tab === "zalihe" ? "active" : ""}`} onClick={() => setTab("zalihe")}>Zalihe</div>}
        {dozvKartice.some((k) => k.key === "katalog") && <div className={`nav-tab ${tab === "katalog" ? "active" : ""}`} onClick={() => setTab("katalog")}>Katalog profila i limova</div>}
        {dozvKartice.some((k) => k.key === "kvaliteta") && <div className={`nav-tab ${tab === "kvaliteta" ? "active" : ""}`} onClick={() => setTab("kvaliteta")}>Kvaliteta materijala</div>}
        {dozvKartice.some((k) => k.key === "izdatnice") && <div className={`nav-tab ${tab === "izdatnice" ? "active" : ""}`} onClick={() => setTab("izdatnice")}>Izdatnice</div>}
      </div>

      {tab === "zalihe" && (
        <EntityPage
          title="" data={db.materijali} onAdd={openAdd} onEdit={openEdit} onDelete={(row) => setDel(row)}
          addLabel="Novi materijal" searchKeys={["sifra", "naziv", "tip"]} readOnly={!mozeZalihe}
          rowClass={(row) => (row.kolicina < row.minZaliha ? "row-warn" : "")}
          columns={[
            { key: "sifra", label: "Šifra", render: (r) => <span className="f-mono">{r.sifra}</span> },
            { key: "naziv", label: "Naziv" },
            { key: "tip", label: "Tip" },
            { key: "kvaliteta", label: "Kvaliteta", render: (r) => r.kvaliteta || <span style={{ color: "var(--ink-faint)" }}>—</span> },
            { key: "dimenzije", label: "Dimenzije" },
            { key: "zaProjekt", label: "ZA PROJEKT", render: (r) => projSifraZaMaterijal(r.projektId) || <span style={{ color: "var(--ink-faint)" }}>—</span> },
            { key: "kolicina", label: "Stanje", render: (r) => <span className="f-mono" style={{ color: r.kolicina < r.minZaliha ? "var(--rust)" : "inherit", fontWeight: r.kolicina < r.minZaliha ? 700 : 400 }}>{r.kolicina} {r.jm}{r.kolicina < r.minZaliha && <AlertTriangle size={12} style={{ marginLeft: 4, verticalAlign: -2 }} />}</span> },
            { key: "minZaliha", label: "Min. zaliha", render: (r) => <span className="f-mono">{r.minZaliha} {r.jm}</span> },
            { key: "cijena", label: "Cijena/jed.", render: (r) => <span className="f-mono">{fmtCurDec(r.cijena)}</span> },
            { key: "lokacija", label: "Lokacija" },
            { key: "izdaj", label: "", render: (r) => mozeIzdatnice && r.kolicina > 0 && <Btn size="sm" variant="ghost" icon={PackageMinus} onClick={() => setIzdajZa(r.id)}>Izdaj na projekt</Btn> },
          ]}
        />
      )}

      {tab === "katalog" && (
        <>
          <div style={{ marginBottom: 12, fontSize: 13, color: "var(--ink-soft)" }}>
            Puni standardni raspon profila (HEA, HEB, HEM, IPE, IPN, UPN sve dimenzije) te formulom generirani SHS/RHS/CHS cijevni profili, okrugle i kvadratne šipke, plosnati i kutni profili te limovi. HEA/HEB/HEM/IPE/IPN/UPN mase su standardne tablične vrijednosti; ostali profili računati su po standardnoj formuli za gustoću čelika 7,85 kg/dm³ (točnost ±1–2%, preporuka: provjeriti s dobavljačem za velike narudžbe).
          </div>
          <div style={{ marginBottom: 12, fontSize: 12, color: "var(--ink-faint)" }}>Ukupno stavki u katalogu: <strong className="f-mono">{db.katalogProfila.length}</strong></div>
          <EntityPage
            title="" data={db.katalogProfila} onAdd={openKatAdd} onEdit={openKatEdit} onDelete={(row) => setKatDel(row)}
            addLabel="Nova stavka kataloga" searchKeys={["oznaka", "tip"]} readOnly={!mozeKatalog}
            columns={[
              { key: "tip", label: "Tip", render: (r) => <span className="badge badge-muted">{r.tip}</span> },
              { key: "oznaka", label: "Oznaka", render: (r) => <span className="f-mono">{r.oznaka}</span> },
              { key: "vrijednost", label: "Masa", render: (r) => <span className="f-mono">{r.vrijednost} {r.jedinica}</span> },
            ]}
          />
        </>
      )}

      {tab === "kvaliteta" && (
        <>
          <div style={{ marginBottom: 12, fontSize: 13, color: "var(--ink-soft)" }}>
            Gustoća (kg/dm³) određuje koliko je ta vrsta materijala teža/lakša od konstrukcijskog čelika (7,85 kg/dm³, na kojem se temelje sve mase u katalogu profila/limova) — koristi se za automatski izračun mase kod unosa materijala i pozicija ponude.
          </div>
          <EntityPage
            title="" data={kvaliteteMaterijala} onAdd={openKvalAdd} onEdit={openKvalEdit} onDelete={(row) => setKvalDel(row)}
            addLabel="Nova kvaliteta materijala" searchKeys={["naziv"]} readOnly={!mozeKvaliteta}
            columns={[
              { key: "naziv", label: "Naziv" },
              { key: "gustoca", label: "Gustoća (kg/dm³)", render: (r) => <span className="f-mono">{r.gustoca}</span> },
              { key: "faktor", label: "Faktor prema čeliku", render: (r) => <span className="f-mono">{(Number(r.gustoca) / GUSTOCA_CELIKA).toFixed(3)}</span> },
            ]}
          />
        </>
      )}

      {tab === "izdatnice" && (
        <EntityPage
          title="" data={[...db.izdatnice].sort((a, b) => b.datum.localeCompare(a.datum))} onAdd={() => setIzdajZa(true)} onEdit={(row) => setPrintIzdatnica(row)} onDelete={(row) => setDelIzdatnica(row)}
          addLabel="Nova izdatnica" searchKeys={["broj"]} readOnly={!mozeIzdatnice}
          columns={[
            { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
            { key: "datum", label: "Datum", render: (r) => fmtDate(r.datum) },
            { key: "projekt", label: "Projekt", render: (r) => { const p = db.projekti.find((pp) => pp.id === r.projektId); return p ? `${p.sifra} — ${p.naziv}` : "—"; } },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            { key: "print", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => setPrintIzdatnica(r)}>Ispis</Btn> },
            { key: "povrat", label: "", render: (r) => r.status === "Izdano" && mozeIzdatnice ? <Btn size="sm" variant="ghost" onClick={() => setPovratZa(r)}>Zaprimi povrat</Btn> : (r.status === "Zatvoreno" ? <span style={{ fontSize: 11, color: "var(--green)" }}>✓ Povrat zaprimljen</span> : null) },
          ]}
        />
      )}

      {izdajZa && <IzdatnicaModal db={db} update={update} showToast={showToast} initialMaterijalId={izdajZa === true ? null : izdajZa} onClose={() => setIzdajZa(null)} onCreated={(nova) => { setIzdajZa(null); setPrintIzdatnica(nova); }} />}
      {printIzdatnica && <IzdatnicaPrintModal izdatnica={printIzdatnica} projekt={db.projekti.find((p) => p.id === printIzdatnica.projektId)} izdao={db.zaposlenici.find((z) => z.id === printIzdatnica.izdaoId)} postavkeTvrtke={db.postavkeTvrtke} onClose={() => setPrintIzdatnica(null)} />}
      {povratZa && <ZaprimiPovratModal izdatnica={povratZa} db={db} update={update} showToast={showToast} onClose={() => setPovratZa(null)} />}
      {delIzdatnica && (
        <ConfirmDelete label={delIzdatnica.broj} onCancel={() => setDelIzdatnica(null)} onConfirm={() => {
          // Brisanje izdatnice mora vratiti na skladište sve što je još "vani" (izdano minus već
          // zaprimljeni povrat) — inače bi brisanje pogrešno kreirane izdatnice trajno umanjilo
          // stanje bez traga zašto.
          const noviMaterijali = db.materijali.map((m) => {
            const josVani = delIzdatnica.stavke.filter((s) => s.materijalId === m.id).reduce((s, st) => s + (Number(st.kolicinaIzdano) || 0) - (Number(st.kolicinaVraceno) || 0), 0);
            return josVani > 0 ? { ...m, kolicina: m.kolicina + josVani } : m;
          });
          update("materijali", noviMaterijali);
          update("izdatnice", db.izdatnice.filter((i) => i.id !== delIzdatnica.id));
          setDelIzdatnica(null);
          showToast("Izdatnica obrisana, stanje skladišta vraćeno.");
        }} />
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Novi materijal" : "Uredi materijal"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={save}>Spremi</Btn></>}>
          <Field label="Profil / lim iz kataloga (opcionalno — sam izračuna masu)">
            <select className="select" value={katalogUnos.katalogId} onChange={(e) => odaberiKatalogUnos(e.target.value)}>
              <option value="">— Ručni unos mase —</option>
              {katalogPoTipu(db.katalogProfila).map((g) => (
                <optgroup key={g.tip} label={g.tip}>
                  {g.stavke.map((k) => <option key={k.id} value={k.id}>{k.oznaka} ({k.vrijednost} {k.jedinica})</option>)}
                </optgroup>
              ))}
            </select>
          </Field>

          {katalogEntry && (
            <div className="card" style={{ padding: 10, marginBottom: 14, background: "var(--surface-alt)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ width: 130 }}>
                  <label className="label">Dužina (mm)</label>
                  <input className="input f-mono" type="number" min="0" value={katalogUnos.duzinaMM} onChange={(e) => setKatalogUnos({ ...katalogUnos, duzinaMM: e.target.value })} />
                </div>
                {jeLimUnos && (
                  <div style={{ width: 130 }}>
                    <label className="label">Širina (mm)</label>
                    <input className="input f-mono" type="number" min="0" value={katalogUnos.sirinaMM} onChange={(e) => setKatalogUnos({ ...katalogUnos, sirinaMM: e.target.value })} />
                  </div>
                )}
                <div style={{ width: 100 }}>
                  <label className="label">Komada</label>
                  <input className="input f-mono" type="number" min="0" step="1" value={katalogUnos.komada} onChange={(e) => setKatalogUnos({ ...katalogUnos, komada: e.target.value })} />
                </div>
                <div style={{ width: 170 }}>
                  <label className="label">Kvaliteta materijala</label>
                  <select className="select" value={katalogUnos.kvaliteta} onChange={(e) => setKatalogUnos({ ...katalogUnos, kvaliteta: e.target.value })}>
                    {(db.kvaliteteMaterijala && db.kvaliteteMaterijala.length ? db.kvaliteteMaterijala : ZADANE_KVALITETE_MATERIJALA).map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}
                  </select>
                </div>
                <div style={{ width: 130 }}>
                  <label className="label">Masa (izračunato)</label>
                  <div className="input f-mono" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{izracunataMasaUnos.toFixed(2)} kg</div>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Šifra"><input className="input" value={form.sifra} onChange={(e) => setForm({ ...form, sifra: e.target.value })} /></Field>
            <Field label="Naziv"><input className="input" value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} /></Field>
            <Field label="Tip"><select className="select" value={form.tip} onChange={(e) => setForm({ ...form, tip: e.target.value })}>{TIPOVI_MATERIJALA.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Kvaliteta (npr. S235JR) — za prepoznavanje istog materijala kod zaprimanja"><input className="input" value={form.kvaliteta || ""} onChange={(e) => setForm({ ...form, kvaliteta: e.target.value })} /></Field>
            <Field label="Dimenzije">{katalogEntry ? <div className="input" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{jeLimUnos ? `${katalogUnos.duzinaMM || 0}×${katalogUnos.sirinaMM || 0} mm` : `${katalogUnos.duzinaMM || 0} mm`}</div> : <input className="input" value={form.dimenzije} onChange={(e) => setForm({ ...form, dimenzije: e.target.value })} />}</Field>
            <Field label="Jedinica mjere">{katalogEntry ? <div className="input" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>kg</div> : <select className="select" value={form.jm} onChange={(e) => setForm({ ...form, jm: e.target.value })}>{JEDINICE.map((j) => <option key={j}>{j}</option>)}</select>}</Field>
            <Field label={katalogEntry ? "Cijena (€/kg)" : "Cijena po jedinici (€)"}><input className="input f-mono" type="number" step="0.01" value={form.cijena} onChange={(e) => setForm({ ...form, cijena: e.target.value })} /></Field>
            <Field label="Masa po m' (kg/m) — za auto-izračun po dužini">{katalogEntry && !jeLimUnos ? <div className="input f-mono" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{katalogEntry.vrijednost}</div> : <input className="input f-mono" type="number" step="0.01" value={form.kgPoM || 0} onChange={(e) => setForm({ ...form, kgPoM: e.target.value })} />}</Field>
            <Field label="Masa po m² (kg/m²) — za auto-izračun lima">{katalogEntry && jeLimUnos ? <div className="input f-mono" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{katalogEntry.vrijednost}</div> : <input className="input f-mono" type="number" step="0.01" value={form.kgPoM2 || 0} onChange={(e) => setForm({ ...form, kgPoM2: e.target.value })} />}</Field>
            <Field label="Trenutno stanje">{katalogEntry ? <div className="input f-mono" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{izracunataMasaUnos.toFixed(2)}</div> : <input className="input f-mono" type="number" value={form.kolicina} onChange={(e) => setForm({ ...form, kolicina: e.target.value })} />}</Field>
            <Field label="Minimalna zaliha"><input className="input f-mono" type="number" value={form.minZaliha} onChange={(e) => setForm({ ...form, minZaliha: e.target.value })} /></Field>
            <Field label="Lokacija na skladištu"><input className="input" value={form.lokacija} onChange={(e) => setForm({ ...form, lokacija: e.target.value })} /></Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Za projekt (za koji je naručeno — opcionalno)">
                <select className="select" value={form.projektId || ""} onChange={(e) => setForm({ ...form, projektId: e.target.value || null })}>
                  <option value="">— Nije rezervirano za projekt —</option>
                  {db.projekti.map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}
                </select>
              </Field>
            </div>
          </div>
        </Modal>
      )}
      {del && <ConfirmDelete label={del.naziv} onCancel={() => setDel(null)} onConfirm={() => { update("materijali", db.materijali.filter((m) => m.id !== del.id)); setDel(null); showToast("Materijal obrisan."); }} />}

      {katModal && (
        <Modal title={katModal === "add" ? "Nova stavka kataloga" : "Uredi stavku kataloga"} onClose={() => setKatModal(null)} footer={<><Btn onClick={() => setKatModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={saveKat}>Spremi</Btn></>}>
          <Field label="Tip profila"><select className="select" value={katForm.tip} onChange={(e) => setKatForm({ ...katForm, tip: e.target.value })}>{TIPOVI_KATALOGA.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Oznaka (npr. HEB 200, Lim 10 mm, 60×60×4)"><input className="input" value={katForm.oznaka} onChange={(e) => setKatForm({ ...katForm, oznaka: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Jedinica"><select className="select" value={katForm.jedinica} onChange={(e) => setKatForm({ ...katForm, jedinica: e.target.value })}><option value="kg/m">kg/m (linearni profil)</option><option value="kg/m2">kg/m² (lim)</option></select></Field>
            <Field label={katForm.jedinica === "kg/m2" ? "Masa (kg po m²)" : "Masa (kg po m dužni)"}><input className="input f-mono" type="number" step="0.001" value={katForm.vrijednost} onChange={(e) => setKatForm({ ...katForm, vrijednost: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {katDel && <ConfirmDelete label={katDel.oznaka} onCancel={() => setKatDel(null)} onConfirm={() => { update("katalogProfila", db.katalogProfila.filter((k) => k.id !== katDel.id)); setKatDel(null); showToast("Stavka kataloga obrisana."); }} />}

      {kvalModal && (
        <Modal title={kvalModal === "add" ? "Nova kvaliteta materijala" : "Uredi kvalitetu materijala"} onClose={() => setKvalModal(null)} footer={<><Btn onClick={() => setKvalModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={saveKval}>Spremi</Btn></>}>
          <Field label="Naziv (npr. Nehrđajući čelik – Inox 304)"><input className="input" value={kvalForm.naziv} onChange={(e) => setKvalForm({ ...kvalForm, naziv: e.target.value })} /></Field>
          <Field label="Gustoća (kg/dm³)"><input className="input f-mono" type="number" step="0.01" min="0" value={kvalForm.gustoca} onChange={(e) => setKvalForm({ ...kvalForm, gustoca: e.target.value })} /></Field>
          <p style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Konstrukcijski čelik ima gustoću {GUSTOCA_CELIKA} kg/dm³ (faktor 1,00) — sve ostale gustoće se prema njemu razmjerno preračunavaju.</p>
        </Modal>
      )}
      {kvalDel && <ConfirmDelete label={kvalDel.naziv} onCancel={() => setKvalDel(null)} onConfirm={() => { update("kvaliteteMaterijala", kvaliteteMaterijala.filter((k) => k.id !== kvalDel.id)); setKvalDel(null); showToast("Kvaliteta materijala obrisana."); }} />}
    </div>
  );
}

// Izdaje materijal sa skladišta na projekt — bira se projekt, jedan ili više materijala i
// količine (ograničene na trenutno stanje), stvara se Izdatnica koja se poslije može ispisati i
// dati u proizvodnju; povrat ostatka rješava se posebno kroz ZaprimiPovratModal.
function IzdatnicaModal({ db, update, showToast, initialMaterijalId, onClose, onCreated }) {
  const [projektId, setProjektId] = useState(db.projekti[0]?.id || "");
  const [izdaoId, setIzdaoId] = useState("");
  const [napomena, setNapomena] = useState("");
  const [stavke, setStavke] = useState([{ materijalId: initialMaterijalId || "", kolicina: "" }]);
  const [saljem, setSaljem] = useState(false);

  const azurirajStavku = (i, patch) => setStavke(stavke.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const dodajStavku = () => setStavke([...stavke, { materijalId: "", kolicina: "" }]);
  const obrisiStavku = (i) => setStavke(stavke.filter((_, idx) => idx !== i));

  const spremi = () => {
    if (saljem) return; // spriječi dvostruki klik — dvostruko slanje bi dvaput skinulo isto sa skladišta
    if (!projektId) { showToast("Odaberi projekt."); return; }
    const validne = stavke.filter((s) => s.materijalId && Number(s.kolicina) > 0);
    if (validne.length === 0) { showToast("Dodaj barem jednu stavku s materijalom i količinom."); return; }
    // Zbraja po materijalu — ako je isti materijal odabran u više redaka, provjerava se i skida
    // ZBROJ svih redaka odjednom, ne svaki redak zasebno (inače bi dva retka od po pola stanja
    // oba "prošla" provjeru pojedinačno, a zajedno tražila više nego što skladište ima).
    const zbrojPoMaterijalu = new Map();
    validne.forEach((s) => zbrojPoMaterijalu.set(s.materijalId, (zbrojPoMaterijalu.get(s.materijalId) || 0) + Number(s.kolicina)));
    for (const [materijalId, ukupno] of zbrojPoMaterijalu) {
      const mat = db.materijali.find((m) => m.id === materijalId);
      if (!mat || ukupno > mat.kolicina) { showToast(`Ukupna količina za "${mat?.naziv || "materijal"}" prelazi trenutno stanje (${mat?.kolicina ?? 0} ${mat?.jm || ""}).`); return; }
    }
    setSaljem(true);
    const noviMaterijali = db.materijali.map((m) => (zbrojPoMaterijalu.has(m.id) ? { ...m, kolicina: m.kolicina - zbrojPoMaterijalu.get(m.id) } : m));
    const novaIzdatnica = {
      id: uid("izd"), broj: sljedeciBroj(db.izdatnice, "broj", "IZD-2026-"), datum: todayISO(),
      projektId, izdaoId: izdaoId || null, napomena, status: "Izdano",
      stavke: validne.map((s) => {
        const mat = db.materijali.find((m) => m.id === s.materijalId);
        return { id: uid("izds"), materijalId: s.materijalId, sifra: mat.sifra, naziv: mat.naziv, jm: mat.jm, kolicinaIzdano: Number(s.kolicina), kolicinaVraceno: null };
      }),
    };
    update("materijali", noviMaterijali);
    update("izdatnice", [...db.izdatnice, novaIzdatnica]);
    showToast(`Izdatnica ${novaIzdatnica.broj} kreirana.`);
    onCreated(novaIzdatnica);
  };

  return (
    <Modal wide title="Nova izdatnica — izdaj materijal na projekt" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi} disabled={saljem}>{saljem ? "Spremanje…" : "Kreiraj izdatnicu"}</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Field label="Projekt">
          <select className="select" value={projektId} onChange={(e) => setProjektId(e.target.value)}>
            {db.projekti.map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}
          </select>
        </Field>
        <Field label="Izdao (zaposlenik)">
          <select className="select" value={izdaoId} onChange={(e) => setIzdaoId(e.target.value)}>
            <option value="">—</option>
            {[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
          </select>
        </Field>
      </div>
      <div className="label" style={{ marginTop: 6, marginBottom: 6 }}>Stavke za izdavanje</div>
      <table className="erp-table" style={{ marginBottom: 8 }}>
        <thead><tr><th>Materijal</th><th style={{ width: 140 }}>Količina</th><th style={{ width: 32 }}></th></tr></thead>
        <tbody>
          {stavke.map((s, i) => {
            const mat = db.materijali.find((m) => m.id === s.materijalId);
            return (
              <tr key={i}>
                <td>
                  <select className="select" value={s.materijalId} onChange={(e) => azurirajStavku(i, { materijalId: e.target.value })}>
                    <option value="">Odaberi materijal…</option>
                    {db.materijali.filter((m) => m.kolicina > 0).map((m) => <option key={m.id} value={m.id}>{m.sifra} — {m.naziv} (na stanju: {m.kolicina} {m.jm})</option>)}
                  </select>
                </td>
                <td>
                  <input className="input f-mono" type="number" min="0" max={mat?.kolicina ?? undefined} step="0.01" value={s.kolicina} onChange={(e) => azurirajStavku(i, { kolicina: e.target.value })} />
                  {mat && <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 2 }}>Na stanju: {mat.kolicina} {mat.jm}</div>}
                </td>
                <td>{stavke.length > 1 && <button className="btn btn-icon btn-ghost" onClick={() => obrisiStavku(i)}><X size={14} /></button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Btn variant="ghost" size="sm" icon={Plus} onClick={dodajStavku}>Dodaj stavku</Btn>
      <Field label="Napomena (opcionalno)"><textarea className="textarea" rows={2} value={napomena} onChange={(e) => setNapomena(e.target.value)} /></Field>
    </Modal>
  );
}

function IzdatnicaPrintModal({ izdatnica, projekt, izdao, postavkeTvrtke, onClose }) {
  const t = postavkeTvrtke || {};
  const PRAZNI_REDOVI = Math.max(0, 10 - izdatnica.stavke.length);
  return (
    <Modal wide title={`Pregled za ispis — Izdatnica ${izdatnica.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => ispisPdf(izdatnica.broj)}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div style={{ maxWidth: 250 }}>
            <img src={logoEcon} alt="Econ" style={{ width: 190, display: "block", marginBottom: 4 }} />
            <div style={{ fontSize: 9, color: "#555", lineHeight: 1.3 }}>Projektiranje, izrada i montaža metalnih<br />konstrukcija i ventiliranih fasada</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 20 }}>IZDATNICA</div>
            <table style={{ fontSize: 11.5, marginTop: 10, marginLeft: "auto", borderCollapse: "collapse" }}>
              <tbody>
                <tr><td style={{ paddingRight: 10, color: "#555", textAlign: "right" }}>Broj :</td><td style={{ fontWeight: 600, textAlign: "left" }} className="f-mono">{izdatnica.broj}</td></tr>
                <tr><td style={{ paddingRight: 10, color: "#555", textAlign: "right" }}>Datum :</td><td style={{ fontWeight: 600, textAlign: "left" }}>{fmtDate(izdatnica.datum)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <table style={{ fontSize: 11.5, marginBottom: 18, borderCollapse: "collapse" }}>
          <tbody>
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Projekt:</td><td style={{ fontWeight: 600 }}>{projekt?.sifra}{projekt?.naziv ? ` — ${projekt.naziv}` : ""}</td></tr>
            {izdatnica.napomena && <tr><td style={{ paddingRight: 10, color: "#555" }}>Napomena:</td><td>{izdatnica.napomena}</td></tr>}
          </tbody>
        </table>

        <table className="doc-table" style={{ marginBottom: 20 }}>
          <thead>
            <tr>
              <th style={{ width: 34 }}>R.br.</th><th style={{ width: 90 }}>Šifra</th><th>Naziv</th><th style={{ width: 60 }}>JM</th>
              <th style={{ width: 80 }}>Izdano</th><th style={{ width: 110 }}>Vraćeno na skladište</th>
            </tr>
          </thead>
          <tbody>
            {izdatnica.stavke.map((s, i) => (
              <tr key={s.id || i}>
                <td>{i + 1}.</td><td className="f-mono">{s.sifra}</td><td>{s.naziv}</td><td>{s.jm}</td>
                <td className="f-mono">{s.kolicinaIzdano}</td>
                <td className="f-mono">{s.kolicinaVraceno != null ? s.kolicinaVraceno : ""}</td>
              </tr>
            ))}
            {Array.from({ length: PRAZNI_REDOVI }).map((_, i) => (
              <tr key={`prazno-${i}`}><td>{izdatnica.stavke.length + i + 1}.</td><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 30, marginBottom: 16, fontSize: 10.5 }}>
          <div style={{ textAlign: "center", width: "45%" }}><div style={{ borderTop: "1px solid #333", paddingTop: 4 }}>Izdao (skladište){izdao ? ` — ${izdao.prezime} ${izdao.ime}` : ""}</div></div>
          <div style={{ textAlign: "center", width: "45%" }}><div style={{ borderTop: "1px solid #333", paddingTop: 4 }}>Zaprimio (proizvodnja)</div></div>
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

// Zaprima ostatak vraćen sa proizvodnje natrag na skladište (po izdatnici) — upisana količina po
// stavci vraća se u materijali.kolicina, a izdatnica se zatvara.
function ZaprimiPovratModal({ izdatnica, db, update, showToast, onClose }) {
  const [vraceno, setVraceno] = useState(izdatnica.stavke.map((s) => ({ id: s.id, kolicina: "" })));
  const [saljem, setSaljem] = useState(false);
  const azuriraj = (id, val) => setVraceno(vraceno.map((v) => (v.id === id ? { ...v, kolicina: val } : v)));

  const potvrdi = () => {
    if (saljem) return; // spriječi dvostruki klik — dvostruko slanje bi dvaput vratilo istu količinu na skladište
    for (const s of izdatnica.stavke) {
      const kol = Number(vraceno.find((v) => v.id === s.id)?.kolicina) || 0;
      if (kol < 0 || kol > s.kolicinaIzdano) { showToast(`Vraćena količina za "${s.naziv}" mora biti između 0 i ${s.kolicinaIzdano}.`); return; }
    }
    setSaljem(true);
    let noviMaterijali = [...db.materijali];
    const noveStavke = izdatnica.stavke.map((s) => {
      const kol = Number(vraceno.find((v) => v.id === s.id)?.kolicina) || 0;
      if (kol > 0) noviMaterijali = noviMaterijali.map((m) => (m.id === s.materijalId ? { ...m, kolicina: m.kolicina + kol } : m));
      return { ...s, kolicinaVraceno: kol };
    });
    update("materijali", noviMaterijali);
    update("izdatnice", db.izdatnice.map((i) => (i.id === izdatnica.id ? { ...i, stavke: noveStavke, status: "Zatvoreno", datumPovrata: todayISO() } : i)));
    showToast("Povrat zaprimljen, stanje skladišta ažurirano.");
    onClose();
  };

  return (
    <Modal title={`Zaprimi povrat — Izdatnica ${izdatnica.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={potvrdi} disabled={saljem}>{saljem ? "Spremanje…" : "Zaprimi povrat"}</Btn></>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>Upiši koliko se od izdane količine vraća natrag na skladište (ostavi 0 ako je sve utrošeno).</p>
      <table className="erp-table">
        <thead><tr><th>Materijal</th><th style={{ width: 100 }}>Izdano</th><th style={{ width: 140 }}>Vraćeno</th></tr></thead>
        <tbody>
          {izdatnica.stavke.map((s) => (
            <tr key={s.id}>
              <td>{s.sifra} — {s.naziv}</td>
              <td className="f-mono">{s.kolicinaIzdano} {s.jm}</td>
              <td><input className="input f-mono" type="number" min="0" max={s.kolicinaIzdano} step="0.01" value={vraceno.find((v) => v.id === s.id)?.kolicina ?? ""} onChange={(e) => azuriraj(s.id, e.target.value)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

/* ============================== NABAVA ============================== */
/* ============================== ISPIS DOKUMENTA (UPIT / NARUDŽBA) ============================== */
function DokumentNabavePrintModal({ tip, brojDokumenta, datum, izradioIme, dobavljacIme, stavke, postavkeTvrtke, onClose }) {
  const t = postavkeTvrtke || {};
  return (
    <Modal wide title={`Pregled za ispis — ${tip} ${brojDokumenta}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => window.print()}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ maxWidth: 260 }}>
            <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>NARUDŽBA / UPIT<br />ZA NABAVU OSNOVNOG<br />MATERIJALA</div>
            {dobavljacIme && <div style={{ fontSize: 12.5, marginTop: 8 }}>Dobavljač: <strong>{dobavljacIme}</strong></div>}
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.naziv}</div>
            <div style={{ fontSize: 9.5, color: "#555", marginBottom: 4, maxWidth: 260 }}>{t.djelatnost}</div>
            <div>{t.adresa}</div>
            <div>{t.telefon}</div>
            <div>{t.email}</div>
            <div>{t.web}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 30, marginBottom: 14, fontSize: 11.5 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 13, height: 13, border: "1px solid #333", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{tip === "Upit" ? "✓" : ""}</span> Upit</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 13, height: 13, border: "1px solid #333", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{tip === "Narudžba" ? "✓" : ""}</span> Narudžba</span>
        </div>

        <table style={{ fontSize: 11.5, marginBottom: 16, borderCollapse: "collapse" }}>
          <tbody>
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Datum:</td><td style={{ fontWeight: 600 }}>{fmtDate(datum)}</td></tr>
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Izradio:</td><td style={{ fontWeight: 600 }}>{izradioIme}</td></tr>
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Upit/Narudžba broj:</td><td style={{ fontWeight: 600 }}>{brojDokumenta}</td></tr>
          </tbody>
        </table>

        <table className="doc-table" style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={{ width: 34 }}>R. br.</th><th style={{ width: 45 }}>Kom:</th><th style={{ width: 65 }}>Dimenzije: [mm]</th>
              <th>Vrsta materijala/ Norma kvalitete:</th><th style={{ width: 85 }}>Kvaliteta materijala:</th>
              <th style={{ width: 90 }}>Zahtijevane norme isporuke:</th><th>Dodatni zahtjevi:</th>
            </tr>
          </thead>
          <tbody>
            {stavke.map((s, i) => (
              <tr key={s.id || i}>
                <td>{i + 1}.</td><td>{s.kolicina}</td><td>{formatDimenzijaStavke(s)}</td>
                <td>{s.vrstaMaterijala}</td><td>{s.kvaliteta}</td><td>{s.normaIsporuke}</td><td>{s.dodatniZahtjevi}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ fontSize: 11, marginBottom: 14 }}>
          <strong>Opći zahtjevi:</strong>
          <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li>Svaki nabavljeni materijal ili dio mora biti popraćen sa primjerkom uvjerenja o kvaliteti ili certifikatom usklađenosti po tehničkim specifikacijama ili općim normama.</li>
            <li>Na svim uvjerenjima o kvaliteti ili certifikatima usklađenosti moraju biti navedene zahtijevane norme, te sve šarže materijala moraju biti usklađene s uvjerenjima.</li>
            <li>Kontrola se vrši prilikom preuzimanja robe.</li>
          </ol>
        </div>

        <div style={{ fontSize: 11, marginBottom: 16 }}>
          <strong>Certifikati i izvještaji:</strong>
          <div style={{ marginTop: 6, fontWeight: 600 }}>Za materijale kvalitete S235/S275 JR /J0 dostaviti ateste materijala 2.2</div>
          <div style={{ fontWeight: 600 }}>Za materijale kvalitete S235/S275 J2 i više razrede kvalitete dostaviti ateste materijala 3.1.</div>
          <div>Za vijke je potrebno isporučiti izjavu o svojstvima.</div>
          <div style={{ fontWeight: 600 }}>Sve materijale za konstrukcije isporučiti sa vidljivom oznakom šarže.</div>
        </div>

        <div style={{ fontSize: 11, marginBottom: 20 }}>
          <div>Molimo Vas da nas po primitku narudžbe izvijestite.</div>
          <div>Za eventualne potrebne informacije stojimo Vam na raspolaganju!</div>
          <div style={{ marginTop: 10 }}>S poštovanjem,</div>
          <div style={{ fontWeight: 700, marginTop: 8 }}>{t.naziv}</div>
          <div>{izradioIme}</div>
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>Žiro račun:</strong> {t.ziroRacun}<br />
          <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Temeljni kapital:</strong> {t.temeljniKapital} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

function PostavkeTvrtkeModal({ postavke, onSave, onClose }) {
  const [form, setForm] = useState(postavke);
  const polja = [
    ["naziv", "Naziv tvrtke"], ["djelatnost", "Djelatnost"], ["adresa", "Adresa"], ["telefon", "Telefon"], ["faks", "Faks"], ["email", "E-mail"], ["web", "Web"],
    ["oib", "OIB"], ["mb", "MB"], ["vatId", "VAT-ID"], ["ziroRacun", "Žiro račun"], ["iban", "IBAN"], ["swift", "SWIFT"], ["sud", "Trgovački sud"], ["mbs", "MBS"], ["temeljniKapital", "Temeljni kapital"], ["uprava", "Uprava"], ["pdvStopa", "Stopa PDV-a (%)"],
    ["cmrStatistickiBroj", "CMR: zadana carinska tarifna oznaka (npr. 73089098)"], ["cmrUvjetIsporuke", "CMR: zadani uvjet isporuke (npr. DAP)"],
    ["abZadnjiBroj", "Potvrda narudžbe: zadnji broj izdan izvan aplikacije (npr. 026-04-AB)"],
  ];
  return (
    <Modal wide title="Postavke tvrtke (podaci za dokumente)" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={() => onSave(form)}>Spremi</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {polja.map(([key, label]) => (
          <Field key={key} label={label}><input className="input" value={form[key] || ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></Field>
        ))}
      </div>
      <Field label="Podružnica (ispisuje se na potvrdi narudžbe, više redaka)"><textarea className="textarea" rows={6} value={form.podruznica || ""} onChange={(e) => setForm({ ...form, podruznica: e.target.value })} /></Field>
    </Modal>
  );
}

function UpitStavkeEditor({ stavke, setStavke, katalogProfila, upitiNabave }) {
  const addRow = () => setStavke([...stavke, { id: uid("us"), kolicina: 1, vrstaStavke: "profil", dimenzijaMM: 6000, sirinaMM: "", vrstaMaterijala: "", kvaliteta: "", normaIsporuke: "", dodatniZahtjevi: "", ponude: [], odabranaPonudaId: null, narudzbenicaId: null }]);
  const update = (i, patch) => setStavke(stavke.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeRow = (i) => setStavke(stavke.filter((_, idx) => idx !== i));
  // Prijedlozi za "Vrsta materijala" — iz kataloga profila/limova i iz svih dosad upisanih
  // upita, da se ne mora uvijek iznova ručno tipkati isti naziv profila.
  const prijedloziVrsteMaterijala = useMemo(() => {
    const izKataloga = (katalogProfila || []).map(katalogOznakaPuna);
    const izUpita = (upitiNabave || []).flatMap((u) => (u.stavke || []).map((s) => s.vrstaMaterijala)).filter(Boolean);
    return Array.from(new Set([...izKataloga, ...izUpita]));
  }, [katalogProfila, upitiNabave]);
  return (
    <div>
      <table className="erp-table" style={{ marginBottom: 8 }}>
        <thead><tr><th style={{ width: 110 }}>Kom</th><th style={{ width: 80 }}>Profil/Lim</th><th style={{ width: 224 }}>Dimenzije [mm]</th><th>Vrsta materijala</th><th style={{ width: 110 }}>Kvaliteta</th><th style={{ width: 110 }}>Norma isporuke</th><th>Dodatni zahtjevi</th><th style={{ width: 32 }}></th></tr></thead>
        <tbody>
          {stavke.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-faint)", padding: 14 }}>Nema stavki. Dodaj potreban materijal.</td></tr>}
          {stavke.map((s, i) => {
            const jeLim = s.vrstaStavke === "lim";
            return (
            <tr key={s.id}>
              <td><input className="input f-mono" type="number" min="0" value={s.kolicina} onChange={(e) => update(i, { kolicina: e.target.value })} /></td>
              <td>
                <select className="select" value={s.vrstaStavke || "profil"} onChange={(e) => update(i, { vrstaStavke: e.target.value })}>
                  <option value="profil">Profil</option>
                  <option value="lim">Lim</option>
                </select>
              </td>
              <td>
                {jeLim ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input className="input f-mono" style={{ width: 110, flex: "none" }} type="number" min="0" placeholder="dužina" value={s.dimenzijaMM} onChange={(e) => update(i, { dimenzijaMM: e.target.value })} />
                    <input className="input f-mono" style={{ width: 110, flex: "none" }} type="number" min="0" placeholder="širina" value={s.sirinaMM} onChange={(e) => update(i, { sirinaMM: e.target.value })} />
                  </div>
                ) : (
                  <input className="input f-mono" style={{ width: 110 }} type="number" min="0" placeholder="dužina" value={s.dimenzijaMM} onChange={(e) => update(i, { dimenzijaMM: e.target.value })} />
                )}
              </td>
              <td>
                <div style={{ position: "relative" }}>
                  <input className="input" style={{ paddingRight: 24 }} list={`vrste-materijala-${s.id}`} placeholder="npr. Cijev 40x20x2 / HEA 100" value={s.vrstaMaterijala} onChange={(e) => update(i, { vrstaMaterijala: e.target.value })} />
                  <ChevronDown size={13} style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--ink-faint)" }} />
                </div>
                <datalist id={`vrste-materijala-${s.id}`}>{prijedloziVrsteMaterijala.map((v) => <option key={v} value={v} />)}</datalist>
              </td>
              <td><input className="input" placeholder="S235JR…" value={s.kvaliteta} onChange={(e) => update(i, { kvaliteta: e.target.value })} /></td>
              <td><input className="input" value={s.normaIsporuke} onChange={(e) => update(i, { normaIsporuke: e.target.value })} /></td>
              <td><input className="input" value={s.dodatniZahtjevi} onChange={(e) => update(i, { dodatniZahtjevi: e.target.value })} /></td>
              <td><button className="btn btn-icon btn-ghost" onClick={() => removeRow(i)}><X size={14} /></button></td>
            </tr>
            );
          })}
        </tbody>
      </table>
      <Btn variant="ghost" size="sm" icon={Plus} onClick={addRow}>Dodaj stavku</Btn>
    </div>
  );
}

// Profil ima samo dužinu; lim ima dužinu i širinu — koristi se svugdje gdje se dimenzije stavke upita prikazuju kao tekst.
const formatDimenzijaStavke = (s) => (s.vrstaStavke === "lim" ? `${s.dimenzijaMM || 0}×${s.sirinaMM || 0}` : `${s.dimenzijaMM || ""}`);

// Ukupna dužina (m) svih komada stavke — koristi se i za težinu i za ponude naplaćene po metru.
const duzinaUkupnaMStavke = (s) => ((Number(s.dimenzijaMM) || 0) / 1000) * (Number(s.kolicina) || 0);

// Ukupna težina (kg) cijele stavke — traži kataloški unos čija se oznaka točno podudara s upisanom
// "Vrstom materijala" (upit ne čuva izravnu vezu na katalog, samo slobodan tekst — vidi
// prijedloziVrsteMaterijala u UpitStavkeEditor, koji te oznake i nudi za odabir). Bez podudaranja
// težinu nije moguće izračunati (vraća null).
const tezinaStavkeUpita = (s, katalogProfila) => {
  const kat = (katalogProfila || []).find((k) => katalogOznakaPuna(k) === s.vrstaMaterijala);
  if (!kat) return null;
  const jeLim = kat.jedinica === "kg/m2";
  const duzinaM = (Number(s.dimenzijaMM) || 0) / 1000;
  const masaJed = jeLim ? duzinaM * ((Number(s.sirinaMM) || 0) / 1000) * Number(kat.vrijednost) : duzinaM * Number(kat.vrijednost);
  return masaJed * (Number(s.kolicina) || 0);
};

// Ukupna cijena jedne ponude dobavljača za stavku — količina (kg ili m, prema odabranoj jedinici
// cijene) × cijena, plus dodatak (transport/pakiranje i sl.) unesen na TOJ konkretnoj ponudi —
// dodatak se namjerno unosi po stavci, ne kao jedan fiksni iznos za cijelog dobavljača, jer se
// razlikuje od narudžbe do narudžbe. Vraća null ako se ne može izračunati (npr. cijena po kg bez
// poznate težine).
const ukupnaCijenaPonude = (s, p, katalogProfila) => {
  const kolicinaZaCijenu = p.jedinicaCijene === "m" ? duzinaUkupnaMStavke(s) : tezinaStavkeUpita(s, katalogProfila);
  if (kolicinaZaCijenu == null) return null;
  return kolicinaZaCijenu * (Number(p.cijena) || 0) + (Number(p.dodatak) || 0);
};

const generirajBrojUpita = (upiti) => {
  const god = new Date().getFullYear().toString().slice(-2);
  const brojevi = upiti.filter((u) => u.broj && u.broj.startsWith(`${god}-`)).map((u) => parseInt(u.broj.split("-")[1], 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 58) + 1;
  return `${god}-${String(sljedeci).padStart(3, "0")}`;
};

// Kreira novi Upit (RFQ) u Nabavi na temelju popisa potrebnog materijala definiranog na projektu
const kreirajUpitIzMaterijala = (projekt, db, patchUpiti, showToast) => {
  // Stavka može referencirati postojeći skladišni artikl (materijalId) ILI, ako je odabrana iz
  // kataloga a još nije zaprimljena, samo katalošku stavku (katalogId) — naziv se u tom slučaju
  // izvodi iz kataloga umjesto iz db.materijali.
  const stavke = (projekt.materijalStavke || []).filter((s) => s.materijalId || s.katalogId).map((s) => {
    const m = s.materijalId ? db.materijali.find((x) => x.id === s.materijalId) : null;
    const katEntry = !s.materijalId && s.katalogId ? db.katalogProfila.find((k) => k.id === s.katalogId) : null;
    const nazivMaterijala = m?.naziv || (katEntry ? katalogOznakaPuna(katEntry) : "");
    const jeDuzina = s.nacinUnosa === "duzina";
    const jeLim = s.nacinUnosa === "lim";
    return {
      id: uid("us"),
      // Kod "duzina" i "lim" načina unosa polje s.kolicina drži IZRAČUNATU masu (kg), ne broj
      // komada — stvarni broj komada je u s.komada. Za obični "kolicina" način unosa, s.kolicina
      // je stvarno upisana količina, pa se ona koristi izravno.
      kolicina: (jeDuzina || jeLim) ? (Number(s.komada) || 0) : (Number(s.kolicina) || 0),
      vrstaStavke: jeLim ? "lim" : "profil",
      dimenzijaMM: jeDuzina ? Math.round((Number(s.duzinaM) || 0) * 1000) : jeLim ? Math.round((Number(s.duzinaM) || 0) * 1000) : "",
      sirinaMM: jeLim ? Math.round((Number(s.sirinaM) || 0) * 1000) : "",
      vrstaMaterijala: nazivMaterijala,
      kvaliteta: s.kvaliteta || "",
      normaIsporuke: "",
      dodatniZahtjevi: `Za projekt ${projekt.sifra} — ${projekt.naziv}`,
      ponude: [], odabranaPonudaId: null, narudzbenicaId: null,
    };
  });
  if (stavke.length === 0) { showToast("Nema definiranog materijala na projektu — dodaj stavke prije kreiranja upita."); return null; }
  const noviUpit = { id: uid("upit"), broj: generirajBrojUpita(db.upitiNabave), datum: todayISO(), izradioId: projekt.voditeljId || "", status: "Priprema", napomena: `Kreirano iz projekta ${projekt.sifra} — ${projekt.naziv}`, izvorProjektaId: projekt.id, stavke };
  patchUpiti([noviUpit], []);
  showToast(`Upit ${noviUpit.broj} kreiran u Nabavi (Upiti materijala).`);
  return noviUpit;
};

// Grupira odabrane (a još nenaručene) stavke upita po dobavljaču i stvara narudžbenice + skladišne artikle
const generirajNarudzbeIzUpita = (upit, db, update, patchUpiti, showToast) => {
  const zaObradu = upit.stavke.filter((s) => s.odabranaPonudaId && !s.narudzbenicaId);
  if (zaObradu.length === 0) { showToast("Nema odabranih pozicija spremnih za narudžbu."); return; }
  const poDobavljacu = {};
  zaObradu.forEach((s) => {
    const ponuda = s.ponude.find((p) => p.id === s.odabranaPonudaId);
    if (!ponuda) return;
    if (!poDobavljacu[ponuda.dobavljacId]) poDobavljacu[ponuda.dobavljacId] = [];
    poDobavljacu[ponuda.dobavljacId].push({ stavka: s, ponuda });
  });

  let noviMaterijali = [...db.materijali];
  let noveNarudzbenice = [...db.narudzbenice];
  const azuriranjeStavkiId = {};
  const nabPrefiks = "NAR-2026-";
  let nabBrojac = parseInt(sljedeciBroj(noveNarudzbenice, "broj", nabPrefiks).slice(nabPrefiks.length), 10);

  Object.entries(poDobavljacu).forEach(([dobavljacId, stavke]) => {
    const materijalIdZaStavku = [];
    stavke.forEach(({ stavka, ponuda }) => {
      // Ponuda je unesena po kg ili po m (jedinicaCijene), a skladišni materijal se uvijek vodi po
      // komadu (jm: "kom") — cijenu treba pretvoriti prema stvarnoj masi/dužini stavke, ne prepisati
      // sirovu vrijednost iz ponude izravno kao cijenu po komadu.
      const kolicinaZaCijenu = ponuda.jedinicaCijene === "m" ? duzinaUkupnaMStavke(stavka) : tezinaStavkeUpita(stavka, db.katalogProfila);
      const cijenaPoKomadu = kolicinaZaCijenu != null
        ? (kolicinaZaCijenu / (Number(stavka.kolicina) || 1)) * (Number(ponuda.cijena) || 0)
        : Number(ponuda.cijena) || 0;
      // Ne otvara se nova šifra ako na skladištu već postoji isti materijal (ista šifra izvedena iz
      // naziva + ista kvaliteta) — u tom slučaju se samo koristi postojeći zapis (količina se
      // povećava kasnije, pri "Primi robu", istom logikom kao i za ostale narudžbenice).
      const sifra = stavka.vrstaMaterijala.replace(/[^A-Za-z0-9]+/g, "-") || uid("sif");
      const trazenaKvaliteta = (stavka.kvaliteta || "").trim().toLowerCase();
      const postojeci = noviMaterijali.find((m) => m.sifra === sifra && (m.kvaliteta || "").trim().toLowerCase() === trazenaKvaliteta);
      let materijalId;
      if (postojeci) {
        materijalId = postojeci.id;
      } else {
        materijalId = uid("mat");
        noviMaterijali.push({
          id: materijalId, sifra,
          naziv: stavka.vrstaMaterijala, tip: "Ostalo", dimenzije: `${formatDimenzijaStavke(stavka)} mm${stavka.kvaliteta ? ", " + stavka.kvaliteta : ""}`,
          jm: "kom", cijena: cijenaPoKomadu, kolicina: 0, minZaliha: 0, lokacija: "", kvaliteta: stavka.kvaliteta || "",
          // Naruceno je stiglo iz Upita koji je (ako je kreiran iz projekta) nosio izvorProjektaId —
          // materijal odmah dobiva "ZA PROJEKT" oznaku bez ručnog upisivanja; uvijek se može promijeniti.
          projektId: upit.izvorProjektaId || null,
        });
      }
      materijalIdZaStavku.push({ stavkaId: stavka.id, materijalId, kolicina: stavka.kolicina });
    });
    const novaNarudzbenica = {
      id: uid("nab"), broj: `${nabPrefiks}${String(nabBrojac++).padStart(3, "0")}`, dobavljacId, datum: todayISO(), rokIsporuke: addDays(todayISO(), 14),
      status: "Nacrt", napomena: `Generirano iz upita ${upit.broj}`, izradioId: upit.izradioId, izvorUpitaId: upit.id,
      stavke: materijalIdZaStavku.map((m) => ({ materijalId: m.materijalId, kolicina: m.kolicina })),
      stavkeUpita: stavke.map(({ stavka, ponuda }) => ({ kolicina: stavka.kolicina, vrstaStavke: stavka.vrstaStavke, dimenzijaMM: stavka.dimenzijaMM, sirinaMM: stavka.sirinaMM, vrstaMaterijala: stavka.vrstaMaterijala, kvaliteta: stavka.kvaliteta, normaIsporuke: stavka.normaIsporuke, dodatniZahtjevi: stavka.dodatniZahtjevi, cijena: ponuda.cijena })),
    };
    noveNarudzbenice.push(novaNarudzbenica);
    stavke.forEach(({ stavka }) => { azuriranjeStavkiId[stavka.id] = novaNarudzbenica.id; });
  });

  update("materijali", noviMaterijali);
  update("narudzbenice", noveNarudzbenice);
  patchUpiti([{ ...upit, stavke: upit.stavke.map((s) => (azuriranjeStavkiId[s.id] ? { ...s, narudzbenicaId: azuriranjeStavkiId[s.id] } : s)), status: "Zatvoreno" }], []);
  showToast(`Generirano ${Object.keys(poDobavljacu).length} narudžbenica prema dobavljačima.`);
};

function UpitDetaljModal({ upit, db, update, patchUpiti, showToast, onClose, onOtvoriPrint }) {
  const azuriraj = (noveStavke) => patchUpiti([{ ...upit, stavke: noveStavke }], []);
  const dodajPonudu = (stavkaId) => azuriraj(upit.stavke.map((s) => (s.id === stavkaId ? { ...s, ponude: [...s.ponude, { id: uid("usp"), dobavljacId: db.dobavljaci[0]?.id || "", cijena: 0, jedinicaCijene: "kg", dodatak: Number(db.dobavljaci[0]?.dodatakIznos) || 0, napomena: "" }] } : s)));
  const azurirajPonudu = (stavkaId, ponudaId, patch) => azuriraj(upit.stavke.map((s) => (s.id === stavkaId ? { ...s, ponude: s.ponude.map((p) => (p.id === ponudaId ? { ...p, ...patch } : p)) } : s)));
  // Kad se promijeni dobavljač na ponudi, dodatak se predpuni njegovim zadanim iznosom (Partneri
  // → Dobavljači) — samo kao pogodan predložak, ostaje slobodno uredljiv po stavci.
  const promijeniDobavljaca = (stavkaId, ponudaId, dobavljacId) => azurirajPonudu(stavkaId, ponudaId, { dobavljacId, dodatak: Number(db.dobavljaci.find((d) => d.id === dobavljacId)?.dodatakIznos) || 0 });
  const obrisiPonudu = (stavkaId, ponudaId) => azuriraj(upit.stavke.map((s) => (s.id === stavkaId ? { ...s, ponude: s.ponude.filter((p) => p.id !== ponudaId), odabranaPonudaId: s.odabranaPonudaId === ponudaId ? null : s.odabranaPonudaId } : s)));
  const odaberiPonudu = (stavkaId, ponudaId) => azuriraj(upit.stavke.map((s) => (s.id === stavkaId ? { ...s, odabranaPonudaId: ponudaId || null } : s)));
  const dobNaziv = (id) => db.dobavljaci.find((d) => d.id === id)?.naziv || "—";

  return (
    <Modal xwide title={`Ponude dobavljača — Upit ${upit.broj}`} onClose={onClose} footer={
      <>
        <Btn onClick={onClose}>Zatvori</Btn>
        <Btn variant="primary" icon={FolderInput} onClick={() => generirajNarudzbeIzUpita(upit, db, update, patchUpiti, showToast)}>Generiraj narudžbe za odabrane pozicije</Btn>
      </>
    }>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>Za svaku stavku unesi ponude pristiglih dobavljača (cijena po kg ili po m, prema tome kako je dobavljač naveo), zatim označi koju ponudu odabireš. Zelenom je označena trenutno najjeftinija ponuda za tu stavku (uključuje i eventualni dodatak dobavljača za transport/pakiranje). Nakon toga generiraj narudžbe — automatski grupirane po dobavljaču.</p>
      {upit.stavke.map((s) => {
        const tezina = tezinaStavkeUpita(s, db.katalogProfila);
        const ponudeSaCijenom = s.ponude.map((p) => ({ p, ukupno: ukupnaCijenaPonude(s, p, db.katalogProfila) }));
        const najnizaCijena = ponudeSaCijenom.reduce((min, { ukupno }) => (ukupno != null && (min == null || ukupno < min) ? ukupno : min), null);
        return (
        <div key={s.id} className="card" style={{ padding: 12, marginBottom: 10, background: "var(--surface-alt)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.vrstaMaterijala} <span className="f-mono" style={{ fontWeight: 400, color: "var(--ink-soft)" }}>· {s.kolicina} kom × {formatDimenzijaStavke(s)}mm{s.kvaliteta ? ` · ${s.kvaliteta}` : ""}{tezina != null && ` · ${tezina.toFixed(1)} kg ukupno`}</span></div>
            {s.narudzbenicaId ? <Badge status="Primljeno" /> : (s.odabranaPonudaId ? <Badge status="Odobren" /> : <Badge status="Nacrt" />)}
          </div>
          {s.ponude.length === 0 ? <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 8 }}>Još nema unesenih ponuda.</div> : (
            <table className="erp-table" style={{ marginBottom: 8 }}>
              <thead><tr><th style={{ width: 30 }}></th><th>Dobavljač</th><th style={{ width: 90 }}>Cijena</th><th style={{ width: 75 }}>Jedinica</th><th style={{ width: 90 }}>Dodatak</th><th style={{ width: 100 }}>Ukupno</th><th>Napomena</th><th style={{ width: 32 }}></th></tr></thead>
              <tbody>
                {ponudeSaCijenom.map(({ p, ukupno }) => {
                  const najjeftinija = ukupno != null && ukupno === najnizaCijena;
                  return (
                  <tr key={p.id} style={s.odabranaPonudaId === p.id ? { background: "#EAF6EF" } : undefined}>
                    <td><input type="radio" name={`odabir-${s.id}`} checked={s.odabranaPonudaId === p.id} onChange={() => odaberiPonudu(s.id, p.id)} disabled={!!s.narudzbenicaId} /></td>
                    <td><select className="select" style={{ fontSize: 12.5 }} value={p.dobavljacId} disabled={!!s.narudzbenicaId} onChange={(e) => promijeniDobavljaca(s.id, p.id, e.target.value)}>{db.dobavljaci.map((d) => <option key={d.id} value={d.id}>{d.naziv}</option>)}</select></td>
                    <td><input className="input f-mono" type="number" min="0" step="0.01" disabled={!!s.narudzbenicaId} value={p.cijena} onChange={(e) => azurirajPonudu(s.id, p.id, { cijena: e.target.value })} /></td>
                    <td>
                      <select className="select" style={{ fontSize: 12.5 }} value={p.jedinicaCijene || "kg"} disabled={!!s.narudzbenicaId} onChange={(e) => azurirajPonudu(s.id, p.id, { jedinicaCijene: e.target.value })}>
                        <option value="kg">€/kg</option>
                        <option value="m">€/m</option>
                      </select>
                    </td>
                    <td><input className="input f-mono" type="number" min="0" step="0.01" title="Dodatak za ovu stavku (npr. transport, pakiranje)" disabled={!!s.narudzbenicaId} value={p.dodatak ?? 0} onChange={(e) => azurirajPonudu(s.id, p.id, { dodatak: e.target.value })} /></td>
                    <td className="f-mono" style={{ fontWeight: najjeftinija ? 700 : 400, color: najjeftinija ? "var(--green)" : undefined }}>{ukupno != null ? fmtCurDec(ukupno) : "—"}</td>
                    <td><input className="input" disabled={!!s.narudzbenicaId} value={p.napomena} onChange={(e) => azurirajPonudu(s.id, p.id, { napomena: e.target.value })} /></td>
                    <td>{!s.narudzbenicaId && <button className="btn btn-icon btn-ghost" onClick={() => obrisiPonudu(s.id, p.id)}><X size={13} /></button>}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {s.ponude.some((p) => p.jedinicaCijene !== "m") && tezina == null && (
            <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 6 }}>Težina se ne može izračunati — "Vrsta materijala" ne odgovara točno nijednoj stavci u katalogu profila/limova.</div>
          )}
          {!s.narudzbenicaId && <Btn variant="ghost" size="sm" icon={Plus} onClick={() => dodajPonudu(s.id)}>Dodaj ponudu</Btn>}
          {s.narudzbenicaId && <div style={{ fontSize: 11.5, color: "var(--green)" }}>✓ Naručeno od {dobNaziv(s.ponude.find((p) => p.id === s.odabranaPonudaId)?.dobavljacId)}</div>}
        </div>
        );
      })}
    </Modal>
  );
}

function NabavaPage({ db, update, patchUpiti, showToast, mojaPozicija }) {
  const dozvKartice = dozvoljeneKarticeModula(mojaPozicija, "nabava");
  const [tab, setTab] = useState(dozvKartice[0]?.key || "narudzbenice");
  useEffect(() => { if (!dozvKartice.some((k) => k.key === tab)) setTab(dozvKartice[0]?.key || "narudzbenice"); }, [dozvKartice, tab]);
  const mozeNarudzbenice = dozvolaZaKarticu(mojaPozicija, "nabava", "narudzbenice").izmjene;
  const mozeUpiti = dozvolaZaKarticu(mojaPozicija, "nabava", "upiti").izmjene;
  const imaPostavke = dozvolaZaKarticu(mojaPozicija, "nabava", "postavke").pristup;
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [postavkeOpen, setPostavkeOpen] = useState(false);
  const [printDoc, setPrintDoc] = useState(null); // { tip, brojDokumenta, datum, izradioIme, stavke }
  const [upitDetalj, setUpitDetalj] = useState(null);

  // "Izradio" na upitu smije biti samo netko tko uopće ima dodijeljen modul Nabave na svojoj
  // poziciji — bilo tko drugi tu ionako ne bi trebao ni raditi upite.
  const zaposleniciNabava = useMemo(() => [...db.zaposlenici]
    .filter((z) => {
      if (z.status !== "Aktivan") return false;
      const pozicija = db.pozicijeZaposlenika.find((p) => p.id === z.pozicijaId);
      const moduli = pozicija?.moduli?.length ? pozicija.moduli : ["dashboard"];
      return moduli.includes("nabava");
    })
    .sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")), [db.zaposlenici, db.pozicijeZaposlenika]);

  const emptyForm = () => ({ id: null, broj: sljedeciBroj(db.narudzbenice, "broj", "NAR-2026-"), dobavljacId: db.dobavljaci[0]?.id || "", datum: todayISO(), rokIsporuke: todayISO(), status: "Nacrt", napomena: "", stavke: [] });
  const [form, setForm] = useState(emptyForm());

  const emptyUpit = () => ({ id: null, broj: generirajBrojUpita(db.upitiNabave), datum: todayISO(), izradioId: zaposleniciNabava[0]?.id || "", status: "Priprema", napomena: "", stavke: [] });
  const [upitForm, setUpitForm] = useState(emptyUpit());

  const openAdd = () => { setForm(emptyForm()); setModal("edit"); };
  const openEdit = (row) => { setForm(JSON.parse(JSON.stringify(row))); setModal("edit"); };
  const save = () => {
    if (form.id) update("narudzbenice", db.narudzbenice.map((n) => (n.id === form.id ? form : n)));
    else update("narudzbenice", [...db.narudzbenice, { ...form, id: uid("nab") }]);
    setModal(null);
    showToast("Narudžbenica spremljena.");
  };
  // Zaprimanje robe je JEDINO mjesto gdje materijal koji još nije bio na skladištu (stavka je
  // birana iz kataloga bez postojećeg materijalId — vidi LineItemsEditor/dozvoliKatalog) stvarno
  // nastaje na skladištu, i to odmah sa stvarno primljenom količinom (ne s 0). Prije stvaranja
  // provjerava se postoji li već isti materijal (ista šifra izvedena iz kataloške oznake + ista
  // kvaliteta) — ako da, samo mu se poveća količina umjesto da se otvori nova šifra.
  const primi = (row) => {
    let materijali = [...db.materijali];
    let stavkePromijenjene = false;
    const noveStavke = row.stavke.map((s) => {
      if (s.materijalId) {
        const mat = materijali.find((m) => m.id === s.materijalId);
        const kolicina = efektivnaKolicinaMaterijala(s, mat);
        materijali = materijali.map((m) => (m.id === s.materijalId ? { ...m, kolicina: m.kolicina + kolicina } : m));
        return s;
      }
      if (!s.katalogId) return s;
      const entry = db.katalogProfila.find((k) => k.id === s.katalogId);
      if (!entry) return s;
      const virtualniMat = { kgPoM: entry.jedinica === "kg/m" ? Number(entry.vrijednost) : 0, kgPoM2: entry.jedinica === "kg/m2" ? Number(entry.vrijednost) : 0 };
      const kolicinaPrimljeno = efektivnaKolicinaMaterijala(s, virtualniMat);
      const sifra = sifraIzKataloga(entry);
      const trazenaKvaliteta = (s.kvaliteta || "").trim().toLowerCase();
      const postojeci = materijali.find((m) => m.sifra === sifra && (m.kvaliteta || "").trim().toLowerCase() === trazenaKvaliteta);
      stavkePromijenjene = true;
      if (postojeci) {
        materijali = materijali.map((m) => (m.id === postojeci.id ? { ...m, kolicina: m.kolicina + kolicinaPrimljeno } : m));
        return { ...s, materijalId: postojeci.id, katalogId: "" };
      }
      const noviId = uid("mat");
      materijali = [...materijali, {
        id: noviId, sifra, naziv: katalogOznakaPuna(entry), tip: entry.tip,
        dimenzije: `${entry.vrijednost} ${entry.jedinica}`, jm: "kg",
        cijena: s.cijenaPoJed != null ? Number(s.cijenaPoJed) : (entry.jedinica === "kg/m2" ? 1.25 : 1.15),
        kolicina: kolicinaPrimljeno, minZaliha: 0, lokacija: "", kvaliteta: s.kvaliteta || "",
        kgPoM: entry.jedinica === "kg/m" ? Number(entry.vrijednost) : 0,
        kgPoM2: entry.jedinica === "kg/m2" ? Number(entry.vrijednost) : 0,
      }];
      return { ...s, materijalId: noviId, katalogId: "" };
    });
    update("materijali", materijali);
    update("narudzbenice", db.narudzbenice.map((n) => (n.id === row.id ? { ...n, stavke: stavkePromijenjene ? noveStavke : n.stavke, status: "Primljeno" } : n)));
    showToast("Roba zaprimljena, stanje skladišta ažurirano.");
  };
  const dobNaziv = (id) => db.dobavljaci.find((d) => d.id === id)?.naziv || "—";
  const zaposlenikIme = (id) => { const z = db.zaposlenici.find((zz) => zz.id === id); return z ? `${z.ime} ${z.prezime}` : "—"; };
  const iznos = (row) => row.stavke.reduce((s, st) => { const m = db.materijali.find((x) => x.id === st.materijalId); const cijena = st.cijenaPoJed != null ? Number(st.cijenaPoJed) : (m ? m.cijena : 0); return s + cijena * efektivnaKolicinaMaterijala(st, m); }, 0);

  const openUpitAdd = () => { setUpitForm(emptyUpit()); setModal("upit"); };
  const openUpitEdit = (row) => { setUpitForm(JSON.parse(JSON.stringify(row))); setModal("upit"); };
  const saveUpit = () => {
    patchUpiti([upitForm.id ? upitForm : { ...upitForm, id: uid("upit") }], []);
    setModal(null);
    showToast("Upit spremljen.");
  };
  const savePostavke = (novo) => { update("postavkeTvrtke", novo); setPostavkeOpen(false); showToast("Postavke tvrtke spremljene."); };

  const otvoriPrintUpit = (upit) => setPrintDoc({ tip: "Upit", brojDokumenta: upit.broj, datum: upit.datum, izradioIme: zaposlenikIme(upit.izradioId), stavke: upit.stavke });
  const otvoriPrintNarudzba = (row) => {
    const stavke = row.stavkeUpita && row.stavkeUpita.length
      ? row.stavkeUpita
      : row.stavke.map((s) => { const m = db.materijali.find((x) => x.id === s.materijalId); return { kolicina: s.kolicina, dimenzijaMM: "", vrstaMaterijala: m?.naziv || "—", kvaliteta: "", normaIsporuke: "", dodatniZahtjevi: "" }; });
    setPrintDoc({ tip: "Narudžba", brojDokumenta: row.broj, datum: row.datum, izradioIme: zaposlenikIme(row.izradioId), dobavljacIme: db.dobavljaci.find((d) => d.id === row.dobavljacId)?.naziv || "", stavke });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <PageHeader title="Nabava" icon={Truck} subtitle="Upiti, ponude dobavljača i narudžbenice materijala" />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 20 }}>
          {dozvKartice.some((k) => k.key === "narudzbenice") && <div className={`nav-tab ${tab === "narudzbenice" ? "active" : ""}`} onClick={() => setTab("narudzbenice")}>Narudžbenice</div>}
          {dozvKartice.some((k) => k.key === "upiti") && <div className={`nav-tab ${tab === "upiti" ? "active" : ""}`} onClick={() => setTab("upiti")}>Upiti materijala</div>}
        </div>
        {imaPostavke && <Btn variant="ghost" size="sm" icon={Settings} onClick={() => setPostavkeOpen(true)}>Postavke tvrtke</Btn>}
      </div>

      {tab === "narudzbenice" && (
        <EntityPage
          title="" data={db.narudzbenice} onAdd={openAdd} onEdit={openEdit} onDelete={(r) => setDel(r)}
          addLabel="Nova narudžbenica" searchKeys={["broj"]} readOnly={!mozeNarudzbenice}
          columns={[
            { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
            { key: "dobavljac", label: "Dobavljač", render: (r) => dobNaziv(r.dobavljacId) },
            { key: "datum", label: "Datum", render: (r) => fmtDate(r.datum) },
            { key: "rokIsporuke", label: "Rok isporuke", render: (r) => fmtDate(r.rokIsporuke) },
            { key: "iznos", label: "Iznos", render: (r) => <span className="f-mono">{fmtCurDec(iznos(r))}</span> },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            { key: "print", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => otvoriPrintNarudzba(r)}>PDF</Btn> },
            { key: "primi", label: "", render: (r) => r.status !== "Primljeno" && r.stavke.length > 0 ? <Btn size="sm" icon={PackageCheck} onClick={() => primi(r)}>Primi robu</Btn> : null },
          ]}
        />
      )}

      {tab === "upiti" && (
        <EntityPage
          title="" data={db.upitiNabave} onAdd={openUpitAdd} onEdit={openUpitEdit} onDelete={(r) => setDel({ type: "upit", row: r })}
          addLabel="Novi upit" searchKeys={["broj"]} readOnly={!mozeUpiti}
          columns={[
            { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
            { key: "datum", label: "Datum", render: (r) => fmtDate(r.datum) },
            { key: "izradio", label: "Izradio", render: (r) => zaposlenikIme(r.izradioId) },
            { key: "stavke", label: "Stavki", render: (r) => <span className="f-mono">{r.stavke.length}</span> },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            { key: "pdf", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => otvoriPrintUpit(r)}>PDF upita</Btn> },
            { key: "ponude", label: "", render: (r) => <Btn size="sm" variant="primary" icon={FolderInput} onClick={() => setUpitDetalj(r)}>Ponude i odabir</Btn> },
          ]}
        />
      )}

      {modal === "edit" && (
        <Modal wide title={form.id ? `Narudžbenica ${form.broj}` : "Nova narudžbenica"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={save}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Dobavljač"><select className="select" value={form.dobavljacId} onChange={(e) => setForm({ ...form, dobavljacId: e.target.value })}>{db.dobavljaci.map((d) => <option key={d.id} value={d.id}>{d.naziv}</option>)}</select></Field>
            <Field label="Datum narudžbe"><input className="input" type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} /></Field>
            <Field label="Rok isporuke"><input className="input" type="date" value={form.rokIsporuke} onChange={(e) => setForm({ ...form, rokIsporuke: e.target.value })} /></Field>
          </div>
          <Field label="Status"><select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["Nacrt", "Poslano", "Djelomično primljeno", "Primljeno"].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Stavke narudžbe">
            <LineItemsEditor mode="materijal" rows={form.stavke} setRows={(rows) => setForm({ ...form, stavke: rows })} materijali={db.materijali} katalog={db.katalogProfila} narudzbenice={db.narudzbenice} dozvoliKatalog />
          </Field>
          <Field label="Napomena"><textarea className="textarea" rows={2} value={form.napomena} onChange={(e) => setForm({ ...form, napomena: e.target.value })} /></Field>
        </Modal>
      )}

      {modal === "upit" && (
        <Modal xwide title={upitForm.id ? `Upit ${upitForm.broj}` : "Novi upit za nabavu materijala"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={saveUpit}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Broj"><input className="input f-mono" value={upitForm.broj} onChange={(e) => setUpitForm({ ...upitForm, broj: e.target.value })} /></Field>
            <Field label="Datum"><input className="input" type="date" value={upitForm.datum} onChange={(e) => setUpitForm({ ...upitForm, datum: e.target.value })} /></Field>
            <Field label="Izradio"><select className="select" value={upitForm.izradioId} onChange={(e) => setUpitForm({ ...upitForm, izradioId: e.target.value })}>{zaposleniciNabava.map((z) => <option key={z.id} value={z.id}>{z.ime} {z.prezime}</option>)}</select></Field>
          </div>
          <Field label="Status"><select className="select" style={{ maxWidth: 220 }} value={upitForm.status} onChange={(e) => setUpitForm({ ...upitForm, status: e.target.value })}>{["Priprema", "Poslan", "Zaprimanje ponuda", "Zatvoreno"].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Potreban materijal"><UpitStavkeEditor stavke={upitForm.stavke} setStavke={(rows) => setUpitForm({ ...upitForm, stavke: rows })} katalogProfila={db.katalogProfila} upitiNabave={db.upitiNabave} /></Field>
          <Field label="Napomena"><textarea className="textarea" rows={2} value={upitForm.napomena} onChange={(e) => setUpitForm({ ...upitForm, napomena: e.target.value })} /></Field>
        </Modal>
      )}

      {del && (
        <ConfirmDelete
          label={del.type === "upit" ? del.row.broj : del.broj}
          onCancel={() => setDel(null)}
          onConfirm={() => {
            if (del?.type === "upit") {
              patchUpiti([], [del.row.id]);
            } else {
              // Oslobodi stavke upita zaključane ovom narudžbenicom, da se dobavljač/ponuda mogu
              // ponovno odabrati i narudžbenica ponovno generirati.
              const pogodjeniUpiti = db.upitiNabave
                .filter((u) => u.stavke.some((s) => s.narudzbenicaId === del.id))
                .map((u) => ({ ...u, stavke: u.stavke.map((s) => (s.narudzbenicaId === del.id ? { ...s, narudzbenicaId: null } : s)) }));
              if (pogodjeniUpiti.length) patchUpiti(pogodjeniUpiti, []);

              // Ako je roba već zaprimljena, poništi povećanje zaliha prije brisanja narudžbenice.
              const materijali = del.status === "Primljeno"
                ? db.materijali.map((m) => {
                    const stavka = del.stavke.find((s) => s.materijalId === m.id);
                    return stavka ? { ...m, kolicina: m.kolicina - efektivnaKolicinaMaterijala(stavka, m) } : m;
                  })
                : db.materijali;
              if (materijali !== db.materijali) update("materijali", materijali);
              update("narudzbenice", db.narudzbenice.filter((n) => n.id !== del.id));
            }
            setDel(null);
            showToast("Stavka obrisana.");
          }}
        />
      )}

      {postavkeOpen && <PostavkeTvrtkeModal postavke={db.postavkeTvrtke} onSave={savePostavke} onClose={() => setPostavkeOpen(false)} />}
      {upitDetalj && <UpitDetaljModal upit={db.upitiNabave.find((u) => u.id === upitDetalj.id) || upitDetalj} db={db} update={update} patchUpiti={patchUpiti} showToast={showToast} onClose={() => setUpitDetalj(null)} />}
      {printDoc && <DokumentNabavePrintModal {...printDoc} postavkeTvrtke={db.postavkeTvrtke} onClose={() => setPrintDoc(null)} />}
    </div>
  );
}

/* ============================== PROIZVODNJA ============================== */
const FAZE = [...OPERACIJE.map((o) => o.label), "Montaža (teren)", "Kontrola kvalitete", "Ostalo"];
const praznaFazaSati = () => Object.fromEntries(FAZE.map((f) => [f, 0]));

// Koliko je sati od planiranih na projektu za danu fazu već raspoređeno po (ostalim) radnim nalozima —
// vraća null ako faza uopće nije definirana na projektu (nema smisla nuditi "preostalo" za nju).
function preostaloSatiFaze(projekt, faza, radniNalozi, iskljuciNalogId) {
  const planirano = Number(projekt?.faze?.[faza]) || 0;
  if (planirano <= 0) return null;
  const rasporedeno = radniNalozi.filter((r) => r.projektId === projekt.id && r.faza === faza && r.id !== iskljuciNalogId).reduce((s, r) => s + (Number(r.planiranoSati) || 0), 0);
  return Math.max(0, planirano - rasporedeno);
}

// Utrošeno sati na radnom nalogu je izvedeno (zbroj dnevnih unosa u "Sati po nalozima"), ne
// ručno upisano — vidi SatiPoNalozimaTab.
const zbrojSatiZaNalog = (radniNalogId, satiPoNalogu) =>
  (satiPoNalogu || []).filter((s) => s.radniNalogId === radniNalogId).reduce((s, r) => s + (Number(r.sati) || 0), 0);

/* ============================== PLAN PROIZVODNJE ============================== */
// Plan se računa sam iz podataka koji već postoje — radni nalozi (sati po fazi), rokovi projekata,
// raspored isporuka kupaonica (sati iz normativa), kompetencije zaposlenika, odsutnosti, praznici i
// smjene strojeva — i preračunava se pri svakoj promjeni (upisani sati, gotova faza, kvačica
// "spremno za otpremu", hitno / na čekanju). Pravila:
//  - redoslijed faza (PLAN_RAZINE): faze iste razine idu zajedno; sljedeća razina smije krenuti
//    najranije 1 radni dan nakon početka prethodne i ne može prestići njezin napredak (ne može se
//    zavariti više nego je sklopljeno)
//  - kapacitet = ljudi s kompetencijom (8 h po radnom danu, bez odsutnih) i strojevi (8 h po smjeni)
//  - prioritet = rezerva do roka (najmanja prva); "hitno" ide prije svih
//  - projekt mora biti gotov N radnih dana prije roka (isporuka kupcu); bojanje/cinčanje su fiksni
//    blokovi nakon proizvodnje; kupaonica smije biti spremna na sam dan otpreme
const PLAN_RAZINE = [
  ["Pila", "Laser za profile", "Laser za limove"],
  ["Kutno savijanje", "Strojna obrada"],
  ["Priprema pozicija za sklapanje"],
  ["Sklapanje - konstrukcije", "Sklapanje - kupaonice"],
  ["Zavarivanje"],
  ["Brušenje"],
  ["Ravnanje"],
  ["Kontrola kvalitete"],
  ["Bojanje"], // samo kupaonice — kod projekata je bojanje fiksni blok nakon proizvodnje
];
const razinaFazePlana = (faza) => PLAN_RAZINE.findIndex((r) => r.includes(faza));
// Faze projekata koje se ne raspoređuju po kapacitetu: montaža ide nakon isporuke, a bojanje je
// fiksni blok (PLAN_POSTAVKE.bojanjeDana) koji se uključuje preko završne obrade projekta.
const PLAN_IZVAN_KAPACITETA = new Set(["Montaža (teren)", "Bojanje"]);
const PLAN_STROJEVI = ["Pila", "Laser za profile", "Laser za limove", "Kutno savijanje", "Strojna obrada"];
const PLAN_POSTAVKE_ZADANO = {
  maxLjudi: { "Priprema pozicija za sklapanje": 3, "Sklapanje - konstrukcije": 4, "Sklapanje - kupaonice": 4, "Zavarivanje": 4, "Brušenje": 3, "Ravnanje": 2, "Kontrola kvalitete": 1, "Bojanje": 1, "Ostalo": 2 },
  drugaSmjena: { "Pila": false, "Laser za profile": true, "Laser za limove": true, "Kutno savijanje": true, "Strojna obrada": false },
  bojanjeDana: 3, cincanjeDana: 5, rezervaProjektDana: 3, rezervaKupaoniceDana: 0,
};
const postavkePlana = (planProizvodnje) => {
  const p = planProizvodnje?.postavke || {};
  return {
    ...PLAN_POSTAVKE_ZADANO, ...p,
    maxLjudi: { ...PLAN_POSTAVKE_ZADANO.maxLjudi, ...(p.maxLjudi || {}) },
    drugaSmjena: { ...PLAN_POSTAVKE_ZADANO.drugaSmjena, ...(p.drugaSmjena || {}) },
  };
};
const ZAVRSNE_OBRADE = [
  { key: "bez", naziv: "Bez završne obrade" },
  { key: "bojanje", naziv: "Bojanje" },
  { key: "cincanje", naziv: "Cinčanje" },
  { key: "cincanjeBojanje", naziv: "Cinčanje + bojanje" },
];
// Završna obrada projekta: ručno odabrana na projektu, a za starije projekte (bez tog polja)
// "bojanje" ako projekt ima nezavršen nalog za bojanje s planiranim satima (iz ponude).
const zavrsnaObradaProjekta = (projekt, radniNalozi) => projekt?.zavrsnaObrada
  || ((radniNalozi || []).some((n) => n.projektId === projekt?.id && n.faza === "Bojanje" && n.status !== "Završen" && (Number(n.planiranoSati) || 0) > 0) ? "bojanje" : "bez");
const PLAN_KUP_KOMPETENCIJA = "Sklapanje - kupaonice";
const PLAN_BOJA = {
  "Pila": "#2E5E7A", "Laser za profile": "#2E5E7A", "Laser za limove": "#2E5E7A",
  "Kutno savijanje": "#4F7F9C", "Strojna obrada": "#4F7F9C",
  "Priprema pozicija za sklapanje": "#7A6A4C", "Ostalo": "#6B737B",
  "Sklapanje - konstrukcije": "#A86F0E", "Sklapanje - kupaonice": "#A86F0E",
  "Zavarivanje": "#B8442C", "Brušenje": "#7E4A3C", "Ravnanje": "#4B5560", "Kontrola kvalitete": "#256B45",
  "Bojanje": "#F5B700", "Cinčanje": "#A3ABB2",
};
const PLAN_LEGENDA = [
  ["Rezanje (pila, laseri)", "#2E5E7A"], ["Savijanje, strojna obrada", "#4F7F9C"], ["Priprema / ostalo", "#7A6A4C"],
  ["Sklapanje", "#A86F0E"], ["Zavarivanje", "#B8442C"], ["Brušenje", "#7E4A3C"], ["Ravnanje", "#4B5560"],
  ["Kontrola", "#256B45"], ["Bojanje", "#F5B700"], ["Cinčanje", "#A3ABB2"],
];
const bojaTekstaNa = (boja) => (boja === "#F5B700" || boja === "#A3ABB2" ? "#1A1D21" : "#FFFFFF");

// Kalendarski pomoćnici (radni dani bez vikenda i praznika) — datumi kao "YYYY-MM-DD", računa se u
// podne UTC da prijelaz na ljetno/zimsko vrijeme ne pomakne dan.
const danUTjednuPlana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const plusDanaPlana = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const razlikaDanaPlana = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const kalendarPlana = (praznici) => {
  const praznik = new Set((praznici || []).map((p) => p.datum));
  const radni = (iso) => { const d = danUTjednuPlana(iso); return d !== 0 && d !== 6 && !praznik.has(iso); };
  const sljedeciRadni = (iso) => { let d = iso, g = 0; while (!radni(d) && g++ < 40) d = plusDanaPlana(d, 1); return d; };
  const plusRadnih = (iso, n) => { let d = iso, k = 0, g = 0; while (k < n && g++ < 4000) { d = plusDanaPlana(d, 1); if (radni(d)) k++; } return d; };
  const minusRadnih = (iso, n) => { let d = iso, k = 0, g = 0; while (k < n && g++ < 4000) { d = plusDanaPlana(d, -1); if (radni(d)) k++; } return d; };
  // radni dani od a (isključeno) do b (uključeno); negativno ako je b prije a
  const radnihIzmedu = (a, b) => { if (!a || !b || a === b) return 0; let n = 0, d = a, g = 0; const smjer = b > a ? 1 : -1; while (d !== b && g++ < 4000) { d = plusDanaPlana(d, smjer); if (radni(d)) n += smjer; } return n; };
  return { radni, sljedeciRadni, plusRadnih, minusRadnih, radnihIzmedu };
};
const danaRijec = (n) => { const a = Math.abs(n); return a % 10 === 1 && a % 100 !== 11 ? "dan" : "dana"; };
const radnihDanaRijec = (n) => { const a = Math.abs(n); if (a % 10 === 1 && a % 100 !== 11) return "radni dan"; if ([2, 3, 4].includes(a % 10) && ![12, 13, 14].includes(a % 100)) return "radna dana"; return "radnih dana"; };
const fmtSati = (n) => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString("hr-HR");
const fmtSati0 = (n) => Math.round(Number(n) || 0).toLocaleString("hr-HR");
const kratkiDatum = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : "—");
const PLAN_DANI = ["nedjelja", "ponedjeljak", "utorak", "srijeda", "četvrtak", "petak", "subota"];
const PLAN_MJESECI = ["siječanj", "veljača", "ožujak", "travanj", "svibanj", "lipanj", "srpanj", "kolovoz", "rujan", "listopad", "studeni", "prosinac"];

// Glavni izračun. drugaSmjenaSvuda = varijanta u kojoj svaki stroj kojemu je 2. smjena dopuštena
// radi 16 h svaki dan — iz nje se vidi kojih dana bi 2. smjena pomogla (prijedlog u "Opterećenju").
function izracunajPlanProizvodnje({ db, normativ, odsutnosti, danas, drugaSmjenaSvuda = false }) {
  const post = postavkePlana(db.planProizvodnje);
  const kal = kalendarPlana(db.praznici);
  const POCETAK = kal.sljedeciRadni(danas);
  const odsutni = new Set((odsutnosti || []).map((o) => `${o.zaposlenikId}|${o.datum}`));
  const iznimkeStroja = new Map((db.kapacitetiDana || []).filter((k) => PLAN_STROJEVI.includes(k.stroj)).map((k) => [`${k.stroj}|${k.datum}`, Number(k.sati) || 0]));
  const satiStroja = (stroj, dan) => {
    if (drugaSmjenaSvuda && post.drugaSmjena[stroj]) return 16;
    const iz = iznimkeStroja.get(`${stroj}|${dan}`);
    return iz != null ? iz : 8;
  };

  const radnici = (db.zaposlenici || []).filter((z) => z.status === "Aktivan" && (z.kompetencije || []).length)
    .map((z) => ({ id: z.id, komp: new Set(z.kompetencije), tim: z.kompetencije.includes(PLAN_KUP_KOMPETENCIJA) }));
  // "Vrijednost" radnika = koliko su rijetke njegove kompetencije: na faze koje mogu raditi mnogi
  // prvo idu oni koje je lakše zamijeniti, a jedini za neku fazu (npr. strojnu obradu) čuva se za nju.
  const brojPoKomp = {};
  radnici.forEach((r) => r.komp.forEach((k) => { brojPoKomp[k] = (brojPoKomp[k] || 0) + 1; }));
  radnici.forEach((r) => { r.vrijednost = [...r.komp].reduce((a, k) => a + 1 / brojPoKomp[k], 0); });

  const aktivni = (db.projekti || []).filter((p) => !["Završen", "Otkazan"].includes(p.status));
  const naCekanju = aktivni.filter((p) => p.planStatus === "cekanje");
  const uPlanu = aktivni.filter((p) => p.planStatus !== "cekanje");
  const poslovi = [];
  uPlanu.filter((p) => !p.koristiNormativ).forEach((p) => {
    const nn = (db.radniNalozi || []).filter((n) => n.projektId === p.id && n.status !== "Završen" && !PLAN_IZVAN_KAPACITETA.has(n.faza) && (Number(n.planiranoSati) || 0) > 0);
    if (!nn.length) return;
    const rok = p.rokZavrsetka || plusDanaPlana(danas, 365);
    poslovi.push({
      id: p.id, tip: "projekt", projekt: p, rok, bezRoka: !p.rokZavrsetka, cilj: kal.minusRadnih(rok, post.rezervaProjektDana),
      hitno: p.planStatus === "hitno", zavrsna: zavrsnaObradaProjekta(p, db.radniNalozi),
      nalozi: nn.map((n) => ({ id: n.id, broj: n.broj, faza: n.faza, plan: Number(n.planiranoSati) || 0, utroseno: Number(n.utrosenoSati) || 0, status: n.status })),
    });
  });

  // Kupaonice (tipski projekti po normativu): svaki datum iz rasporeda isporuka je jedna serija.
  const grupaNorm = (k) => (normativ?.grupe || []).find((g) => g.kljuc === k);
  const kupaonice = [];
  uPlanu.filter((p) => p.koristiNormativ).forEach((p) => {
    const sve = [...(p.stavkePod || []).map((s) => ({ ...s, grupa: "stavkePod" })), ...(p.stavkeKomplet || []).map((s) => ({ ...s, grupa: "stavkeKomplet" }))];
    const isp = p.isporuke || [];
    const satiKomada = (s, kom) => { const g = grupaNorm(s.grupa === "stavkePod" ? "pod" : "komplet"); return Number(g?.ucinakKgH) > 0 ? ((Number(s.masaJed) || 0) * kom) / Number(g.ucinakKgH) : 0; };
    let bezDatumaKom = 0, bezDatumaSati = 0;
    sve.forEach((s) => {
      const zakazano = isp.filter((i) => i.stavkaId === s.id && i.grupa === s.grupa && i.datum).reduce((a, i) => a + (Number(i.komada) || 0), 0);
      const ostalo = Math.max(0, (Number(s.komada) || 0) - zakazano);
      bezDatumaKom += ostalo; bezDatumaSati += satiKomada(s, ostalo);
    });
    const poDatumu = new Map();
    isp.filter((i) => !i.isporuceno && i.datum).forEach((i) => {
      const s = sve.find((x) => x.id === i.stavkaId && x.grupa === i.grupa);
      if (!s) return;
      const g = grupaNorm(i.grupa === "stavkePod" ? "pod" : "komplet");
      const sati = satiKomada(s, Number(i.komada) || 0);
      const serija = poDatumu.get(i.datum) || { pod: 0, stranica: 0, faze: {} };
      if (i.grupa === "stavkePod") serija.pod += Number(i.komada) || 0; else serija.stranica += Number(i.komada) || 0;
      OPERACIJE.forEach((o) => {
        const h = sati * ((Number(g?.raspodjela?.[o.key]) || 0) / 100);
        if (h > 0) serija.faze[o.label] = (serija.faze[o.label] || 0) + h;
      });
      poDatumu.set(i.datum, serija);
    });
    const serije = [...poDatumu.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    kupaonice.push({
      projekt: p, bezDatumaKom, bezDatumaSati, brojSerija: serije.length,
      ukupnoKom: sve.reduce((a, s) => a + (Number(s.komada) || 0), 0),
      spremno: isp.filter((i) => i.isporuceno).reduce((a, i) => a + (Number(i.komada) || 0), 0),
    });
    serije.forEach(([datum, s]) => {
      const id = `${p.id}|${datum}`;
      poslovi.push({
        id, tip: "kupaonice", projekt: p, rok: datum, cilj: kal.minusRadnih(datum, post.rezervaKupaoniceDana), hitno: p.planStatus === "hitno",
        zavrsna: "bez", pod: s.pod, stranica: s.stranica,
        nalozi: Object.entries(s.faze).map(([faza, h]) => ({ id: `${id}|${faza}`, broj: `isporuka ${kratkiDatum(datum)}`, faza, plan: h, utroseno: 0, status: "Planiran" })),
      });
    });
  });

  // ---- simulacija dan po dan ----
  const stanje = new Map();
  poslovi.forEach((po) => po.nalozi.forEach((n) => {
    stanje.set(n.id, { n, posao: po, plan: n.plan, gotovo: Math.min(n.plan, n.utroseno), pocetak: (n.status === "U tijeku" || n.utroseno > 0) ? "prije" : null, kraj: null, dani: {}, neispunjeno: {} });
  }));
  const poPoslu = new Map();
  stanje.forEach((s) => { const a = poPoslu.get(s.posao.id) || []; a.push(s); poPoslu.set(s.posao.id, a); });
  poPoslu.forEach((lista) => lista.sort((a, b) => razinaFazePlana(a.n.faza) - razinaFazePlana(b.n.faza)));
  const dodatniDani = (po) => (po.zavrsna === "bojanje" ? post.bojanjeDana : po.zavrsna === "cincanje" ? post.cincanjeDana : po.zavrsna === "cincanjeBojanje" ? post.cincanjeDana + post.bojanjeDana : 0);
  const redoslijed = poslovi.map((po) => {
    const lista = poPoslu.get(po.id) || [];
    let lanac = 0;
    PLAN_RAZINE.forEach((r) => {
      const max = Math.max(0, ...lista.filter((s) => r.includes(s.n.faza)).map((s) => (s.plan - s.gotovo) / (8 * (PLAN_STROJEVI.includes(s.n.faza) ? 1 : (post.maxLjudi[s.n.faza] || 2)))));
      if (max > 0) lanac += Math.ceil(max);
    });
    return { po, rezerva: kal.radnihIzmedu(POCETAK, po.cilj) - lanac - dodatniDani(po) };
  }).sort((a, b) => (b.po.hitno - a.po.hitno) || (a.rezerva - b.rezerva) || a.po.cilj.localeCompare(b.po.cilj));

  const udioRazine = (lista, r) => {
    const u = lista.filter((s) => r.includes(s.n.faza));
    const plan = u.reduce((x, s) => x + s.plan, 0);
    return plan > 0 ? u.reduce((x, s) => x + s.gotovo, 0) / plan : null;
  };
  const iskoristenostPoDanu = {};
  const strojPoDanu = {};
  let dan = POCETAK;
  for (let iter = 0; iter < 260; iter++) {
    if ([...stanje.values()].every((s) => s.gotovo >= s.plan - 1e-9)) break;
    const prisutni = radnici.filter((r) => !odsutni.has(`${r.id}|${dan}`));
    const satiRadnika = new Map(prisutni.map((r) => [r.id, 8]));
    const strojSlobodno = Object.fromEntries(PLAN_STROJEVI.map((s) => [s, satiStroja(s, dan)]));
    // ograničenja toka gledaju stanje na kraju prethodnog dana
    const jucer = new Map();
    poPoslu.forEach((lista, pid) => jucer.set(pid, PLAN_RAZINE.map((r) => ({ udio: udioRazine(lista, r), krenulo: lista.some((s) => r.includes(s.n.faza) && s.pocetak && (s.pocetak === "prije" || s.pocetak < dan)) }))));
    for (const { po } of redoslijed) {
      const lista = poPoslu.get(po.id) || [];
      const j = jucer.get(po.id);
      for (const s of lista) {
        const preostalo = s.plan - s.gotovo;
        if (preostalo <= 1e-9) continue;
        const ri = razinaFazePlana(s.n.faza);
        let granica = preostalo;
        if (ri > 0) {
          let pi = ri - 1;
          while (pi >= 0 && j[pi].udio == null) pi--;
          if (pi >= 0) {
            if (!j[pi].krenulo && !s.pocetak) continue;
            const dozvoljeno = j[pi].udio >= 1 - 1e-9 ? 1 : j[pi].udio;
            granica = Math.min(granica, Math.max(0, dozvoljeno * s.plan - s.gotovo));
          }
        }
        if (granica <= 1e-9) continue;
        const jeStroj = PLAN_STROJEVI.includes(s.n.faza);
        const maxLjudi = jeStroj ? Math.max(1, Math.round(satiStroja(s.n.faza, dan) / 8)) : (post.maxLjudi[s.n.faza] || 2);
        let dozvoljeno = Math.min(granica, maxLjudi * 8, jeStroj ? strojSlobodno[s.n.faza] : Infinity);
        const zeljeno = dozvoljeno;
        const jeKup = po.tip === "kupaonice";
        const kandidati = prisutni
          .filter((r) => (s.n.faza === "Ostalo" || r.komp.has(s.n.faza)) && satiRadnika.get(r.id) > 0)
          .sort((a, b) => (jeKup ? (b.tim - a.tim) : (a.tim - b.tim)) || a.vrijednost - b.vrijednost || satiRadnika.get(b.id) - satiRadnika.get(a.id));
        let dano = 0, ljudi = 0;
        for (const r of kandidati) {
          if (dozvoljeno <= 1e-9 || ljudi >= maxLjudi) break;
          const h = Math.min(satiRadnika.get(r.id), dozvoljeno);
          satiRadnika.set(r.id, satiRadnika.get(r.id) - h);
          dozvoljeno -= h; dano += h; ljudi++;
        }
        if (jeStroj) {
          strojSlobodno[s.n.faza] -= dano;
          strojPoDanu[s.n.faza] = strojPoDanu[s.n.faza] || {};
          strojPoDanu[s.n.faza][dan] = (strojPoDanu[s.n.faza][dan] || 0) + dano;
        }
        if (zeljeno - dano > 0.01) s.neispunjeno[dan] = (s.neispunjeno[dan] || 0) + (zeljeno - dano);
        if (dano > 0) {
          s.gotovo += dano;
          s.dani[dan] = { sati: dano, ljudi };
          if (!s.pocetak) s.pocetak = dan;
          if (s.gotovo >= s.plan - 1e-9) s.kraj = dan;
        }
      }
    }
    iskoristenostPoDanu[dan] = { raspolozivo: prisutni.length * 8, iskoristeno: prisutni.length * 8 - [...satiRadnika.values()].reduce((a, b) => a + b, 0) };
    dan = kal.plusRadnih(dan, 1);
  }

  const rezultat = redoslijed.map(({ po, rezerva }) => {
    const lista = poPoslu.get(po.id) || [];
    const faze = lista.map((s) => {
      const daniRada = Object.keys(s.dani).sort();
      return { nalogId: s.n.id, broj: s.n.broj, faza: s.n.faza, plan: s.plan, utroseno: s.n.utroseno, status: s.n.status, od: daniRada[0] || null, do: s.kraj || daniRada[daniRada.length - 1] || null, dani: s.dani, neispunjeno: s.neispunjeno, nedovrseno: s.gotovo < s.plan - 0.01 };
    });
    const nedovrseno = faze.some((f) => f.nedovrseno);
    const krajProizvodnje = faze.reduce((m, f) => (f.do && f.do > m ? f.do : m), "") || POCETAK;
    const zavrsne = [];
    let gotovo = krajProizvodnje;
    const dodajBlok = (vrsta, dana) => { if (dana <= 0) return; const od = kal.plusRadnih(gotovo, 1); gotovo = kal.plusRadnih(gotovo, dana); zavrsne.push({ vrsta, od, do: gotovo, dana }); };
    if (po.zavrsna === "cincanje" || po.zavrsna === "cincanjeBojanje") dodajBlok("Cinčanje", post.cincanjeDana);
    if (po.zavrsna === "bojanje" || po.zavrsna === "cincanjeBojanje") dodajBlok("Bojanje", post.bojanjeDana);
    return { ...po, nalozi: undefined, prioritetRezerva: rezerva, plan: faze.reduce((a, f) => a + Math.max(0, f.plan - f.utroseno), 0), faze, zavrsne, gotovo, nedovrseno, rezervaDana: kal.radnihIzmedu(gotovo, po.cilj) };
  });

  const imaNaloge = new Set((db.radniNalozi || []).map((n) => n.projektId));
  const bezFaza = aktivni.filter((p) => !p.koristiNormativ && !imaNaloge.has(p.id));
  const kompetentnih = Object.fromEntries([...new Set(PLAN_RAZINE.flat())].map((f) => [f, radnici.filter((r) => r.komp.has(f)).length]));
  const fazeBezLjudi = [...new Set(rezultat.flatMap((p) => p.faze.filter((f) => f.faza !== "Ostalo" && !kompetentnih[f.faza]).map((f) => f.faza)))];
  return { post, kal, danas, pocetak: POCETAK, poslovi: rezultat, kupaonice, naCekanju, bezFaza, iskoristenostPoDanu, strojPoDanu, satiStroja, radnika: radnici.length, timKupaonica: radnici.filter((r) => r.tim).length, kompetentnih, fazeBezLjudi };
}

const statusPosla = (r) => (r < 0 ? "kasni" : r <= 2 ? "rizik" : "ok");
const tekstRezerve = (r) => (r < 0 ? `kasni ${-r} ${danaRijec(r)}` : `rezerva ${r} ${danaRijec(r)}`);
const PLAN_CHIP = {
  kasni: { background: "#FBEAE6", color: "#9A2E1B", borderColor: "#F0C2B5" },
  rizik: { background: "#FFF6DE", color: "#7A5600", borderColor: "#F5D98A" },
  ok: { background: "#EAF6EF", color: "#1F6B41", borderColor: "#B9E3C9" },
  kup: { background: "#EAF3F7", color: "#215C77", borderColor: "#BFE0EC" },
  muted: { background: "#F0F1F2", color: "#5B6470", borderColor: "#D7DBDF" },
};
const PlanChip = ({ ton = "muted", children }) => (
  <span className="f-mono" style={{ display: "inline-flex", padding: "2px 7px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", borderRadius: 2, border: "1px solid", whiteSpace: "nowrap", ...PLAN_CHIP[ton] }}>{children}</span>
);

function PlanProizvodnjeView({ db, update, patchProjekt, showToast, mozeMijenjati, otvoriProjekt }) {
  const [podTab, setPodTab] = useState("projekt");
  const [podaci, setPodaci] = useState(null);
  useEffect(() => {
    let aktivan = true;
    fetch(`${API_URL}/api/plan/podaci`, { headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (aktivan) setPodaci(d); })
      .catch(() => { if (aktivan) setPodaci({ normativ: null, odsutnosti: [], greska: true }); });
    return () => { aktivan = false; };
  }, []);
  const danas = todayISO();
  const plan = useMemo(
    () => (podaci ? izracunajPlanProizvodnje({ db, normativ: podaci.normativ, odsutnosti: podaci.odsutnosti, danas }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.radniNalozi, db.projekti, db.zaposlenici, db.praznici, db.kapacitetiDana, db.planProizvodnje, podaci, danas]
  );
  if (!plan) return <EmptyState text="Računam plan proizvodnje…" />;
  const tabovi = [
    { key: "projekt", naziv: "Po projektu" },
    { key: "opterecenje", naziv: "Opterećenje i smjene" },
    { key: "danas", naziv: "Danas – unos" },
    { key: "bezFaza", naziv: `Projekti bez faza (${plan.bezFaza.length})` },
    { key: "postavke", naziv: "Postavke plana" },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {tabovi.map((t) => <Btn key={t.key} variant={podTab === t.key ? "primary" : "ghost"} size="sm" onClick={() => setPodTab(t.key)}>{t.naziv}</Btn>)}
      </div>
      {podaci?.greska && <div style={{ fontSize: 12.5, color: "var(--rust)", marginBottom: 10 }}>Normativ i odsutnosti nisu učitani — kupaonice i godišnji odmori nisu u planu. Osvježi stranicu.</div>}
      {podTab === "projekt" && <PlanPoProjektu plan={plan} patchProjekt={patchProjekt} mozeMijenjati={mozeMijenjati} otvoriProjekt={otvoriProjekt} />}
      {podTab === "opterecenje" && <PlanOpterecenje plan={plan} db={db} podaci={podaci} update={update} showToast={showToast} mozeMijenjati={mozeMijenjati} />}
      {podTab === "danas" && <PlanDanasUnos plan={plan} db={db} update={update} patchProjekt={patchProjekt} showToast={showToast} mozeMijenjati={mozeMijenjati} />}
      {podTab === "bezFaza" && <PlanBezFaza plan={plan} db={db} update={update} patchProjekt={patchProjekt} showToast={showToast} mozeMijenjati={mozeMijenjati} />}
      {podTab === "postavke" && <PlanPostavke plan={plan} db={db} update={update} showToast={showToast} mozeMijenjati={mozeMijenjati} />}
    </div>
  );
}

/* ---------- Po projektu: pokazatelji, upozorenja, gantogram ---------- */
function PlanPoProjektu({ plan, patchProjekt, mozeMijenjati, otvoriProjekt }) {
  const [otvoreni, setOtvoreni] = useState(() => new Set());
  const { kal, danas } = plan;
  const projekti = plan.poslovi.filter((p) => p.tip === "projekt");
  const serije = plan.poslovi.filter((p) => p.tip === "kupaonice");
  const kasneP = projekti.filter((p) => p.rezervaDana < 0);
  const kasneS = serije.filter((p) => p.rezervaDana < 0);
  const bezDatumaKom = plan.kupaonice.reduce((s, k) => s + k.bezDatumaKom, 0);
  const bezDatumaSati = plan.kupaonice.reduce((s, k) => s + k.bezDatumaSati, 0);
  const ponTjedna = plusDanaPlana(danas, -((danUTjednuPlana(danas) + 6) % 7));
  const daniOvogTjedna = [0, 1, 2, 3, 4].map((i) => plusDanaPlana(ponTjedna, i));
  const tjIsk = daniOvogTjedna.reduce((s, d) => s + (plan.iskoristenostPoDanu[d]?.iskoristeno || 0), 0);
  const tjRas = daniOvogTjedna.reduce((s, d) => s + (plan.iskoristenostPoDanu[d]?.raspolozivo || 0), 0);
  const puniDani = (stroj) => Object.entries(plan.strojPoDanu[stroj] || {}).filter(([d, h]) => h >= plan.satiStroja(stroj, d) - 0.01).map(([d]) => d).sort();
  const puniStrojevi = PLAN_STROJEVI.filter((s) => puniDani(s).length >= 5);
  const nazivStroja = (s) => (s === "Kutno savijanje" ? "preša" : s.toLowerCase());

  const kpi = [
    { broj: projekti.length, oznaka: "Projekata u planu", pod: `${fmtSati0(projekti.reduce((s, p) => s + p.plan, 0))} h · kasni ${kasneP.length}`, boja: "var(--ink)" },
    { broj: serije.length, oznaka: "Isporuka kupaonica u planu", pod: `${fmtSati0(serije.reduce((s, p) => s + p.plan, 0))} h · kasni ${kasneS.length}`, boja: "var(--ink)" },
    { broj: kasneP.length + kasneS.length, oznaka: "Kasni ukupno", pod: "projekti i isporuke izvan roka", boja: kasneP.length + kasneS.length ? "var(--rust)" : "var(--green)" },
    { broj: bezDatumaKom, oznaka: "Kupaonica bez datuma", pod: bezDatumaKom ? `${fmtSati0(bezDatumaSati)} h — plan ih ne vidi` : "sve imaju datum isporuke", boja: bezDatumaKom ? "var(--rust)" : "var(--ink)" },
    { broj: plan.bezFaza.length, oznaka: "Projekata bez faza", pod: plan.bezFaza.length ? "plan ih ne vidi — dopuniti" : "svi imaju naloge", boja: plan.bezFaza.length ? "var(--rust)" : "var(--ink)" },
    { broj: `${tjRas ? Math.round((tjIsk / tjRas) * 100) : 0} %`, oznaka: "Zauzetost ljudi ovaj tjedan", pod: puniStrojevi.length ? `puni strojevi: ${puniStrojevi.map(nazivStroja).join(", ")}` : `${plan.radnika} ljudi · 8 h/dan`, boja: "var(--ink)" },
  ];

  const upozorenja = [];
  projekti.filter((p) => !p.bezRoka && p.rok < danas).forEach((p) => upozorenja.push(<><strong>{p.projekt.sifra}</strong> — rok isporuke {kratkiDatum(p.rok)} je već prošao, a prema planu roba je gotova {kratkiDatum(p.gotovo)}. Upiši novi dogovoreni rok.</>));
  [...new Set(serije.map((s) => s.projekt.id))].forEach((pid) => {
    const ss = serije.filter((s) => s.projekt.id === pid).sort((a, b) => a.rok.localeCompare(b.rok));
    const kas = ss.filter((s) => s.rezervaDana < 0);
    if (!kas.length) return;
    const r = kas.map((s) => -s.rezervaDana);
    upozorenja.push(<><strong>{ss[0].projekt.sifra}</strong> (kupaonice): {kas.length} od {ss.length} isporuka neće biti spremno na vrijeme — kasne {Math.min(...r)}–{Math.max(...r)} radnih dana. Ako su neke kupaonice već napravljene, označi ih „spremno za otpremu“ (Danas – unos).</>);
  });
  if (kasneP.filter((p) => p.bezRoka || p.rok >= danas).length) {
    const top = [...kasneP].filter((p) => p.bezRoka || p.rok >= danas).sort((a, b) => a.rezervaDana - b.rezervaDana).slice(0, 3);
    upozorenja.push(<><strong>{kasneP.length} od {projekti.length} projekata kasni</strong> — najviše {top.map((p) => `${p.projekt.sifra} (${-p.rezervaDana} ${danaRijec(p.rezervaDana)})`).join(", ")}.</>);
  }
  if (puniStrojevi.length) upozorenja.push(<><strong>{puniStrojevi.map((s) => (s === "Kutno savijanje" ? "Preša" : s)).join(", ")}</strong> rade punim kapacitetom — vidi prijedloge u „Opterećenje i smjene“.</>);
  plan.fazeBezLjudi.forEach((f) => upozorenja.push(<>Fazu <strong>{f}</strong> nitko nema u kompetencijama — nalozi te faze se ne mogu isplanirati. Dodaj kompetenciju zaposleniku.</>));
  plan.poslovi.filter((p) => p.nedovrseno && !p.faze.some((f) => plan.fazeBezLjudi.includes(f.faza))).slice(0, 3).forEach((p) => upozorenja.push(<><strong>{p.projekt.sifra}</strong>: plan ne može završiti sve faze u sljedećih godinu dana.</>));
  if (bezDatumaKom) upozorenja.push(<><strong>{bezDatumaKom} kupaonica nema datum isporuke</strong> ({plan.kupaonice.filter((k) => k.bezDatumaKom).map((k) => `${k.projekt.sifra}: ${k.bezDatumaKom} kom.`).join(", ")}; {fmtSati0(bezDatumaSati)} h) — plan ih ne vidi dok se ne upiše raspored isporuka.</>);
  if (plan.bezFaza.length) upozorenja.push(<><strong>{plan.bezFaza.length} aktivnih projekata nema faza</strong> — dok se ne upišu sati (kartica „Projekti bez faza“), plan za taj posao ne zna.</>);
  projekti.filter((p) => p.bezRoka).forEach((p) => upozorenja.push(<><strong>{p.projekt.sifra}</strong> nema upisan rok završetka — planira se kao da nije hitan.</>));

  // vremenska os: od ponedjeljka prije 2 tjedna do zadnjeg roka/završetka (+1 tjedan), 10–30 tjedana
  const start = plusDanaPlana(ponTjedna, -14);
  const krajevi = plan.poslovi.flatMap((p) => [p.gotovo, p.bezRoka ? null : p.rok]).filter(Boolean);
  const zadnji = krajevi.length ? krajevi.reduce((m, d) => (d > m ? d : m)) : danas;
  const tjedana = Math.min(30, Math.max(10, Math.ceil((razlikaDanaPlana(start, zadnji) + 8) / 7)));
  const DANA = tjedana * 7;
  const pct = (iso) => (razlikaDanaPlana(start, iso) / DANA) * 100;
  const unutar = (iso) => iso && iso >= start && razlikaDanaPlana(start, iso) < DANA;
  const traka = (od, doD) => ({ left: `${Math.max(0, pct(od))}%`, width: `${Math.max(0.35, ((razlikaDanaPlana(od < start ? start : od, doD) + 1) / DANA) * 100)}%` });
  const LIJEVO = 340;
  const ponedjeljci = Array.from({ length: tjedana }, (_, i) => plusDanaPlana(start, i * 7));
  const mjeseci = Array.from({ length: DANA }, (_, i) => plusDanaPlana(start, i)).filter((d, i) => i === 0 || d.slice(8, 10) === "01");

  const prebaci = (k) => setOtvoreni((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const MarkerCilj = ({ iso, gore = 3, dolje = 3 }) => (unutar(iso) ? <div title={`Gotovo najkasnije ${kratkiDatum(iso)}`} style={{ position: "absolute", top: gore, bottom: dolje, left: `${pct(iso) + 100 / DANA}%`, borderLeft: "2px dashed var(--ink)" }} /> : null);
  const MarkerRok = ({ iso, opis, gore = 3, dolje = 3 }) => (unutar(iso) ? <>
    <div title={`${opis} ${kratkiDatum(iso)}`} style={{ position: "absolute", top: gore, bottom: dolje, left: `${pct(iso) + 50 / DANA}%`, borderLeft: "2px solid var(--ink)" }} />
    <div style={{ position: "absolute", top: gore - 3, left: `${pct(iso) + 50 / DANA}%`, width: 8, height: 8, marginLeft: -3, background: "var(--ink)", transform: "rotate(45deg)" }} />
  </> : null);
  const MiniFaze = ({ p, vrh, korak, debljina }) => <>
    {p.faze.filter((f) => f.od).map((f) => <div key={f.nalogId} title={`${f.faza} · ${kratkiDatum(f.od)}–${kratkiDatum(f.do)} · ${fmtSati(Math.max(0, f.plan - f.utroseno))} h`} style={{ position: "absolute", top: vrh + Math.max(0, razinaFazePlana(f.faza) === -1 ? 2 : razinaFazePlana(f.faza)) * korak, height: debljina, ...traka(f.od, f.do), background: PLAN_BOJA[f.faza] || "#6B737B", borderRadius: 1 }} />)}
    {p.zavrsne.map((z) => <div key={z.vrsta} title={`${z.vrsta} · ${kratkiDatum(z.od)}–${kratkiDatum(z.do)}`} style={{ position: "absolute", top: vrh + 8 * korak, height: debljina, ...traka(z.od, z.do), background: PLAN_BOJA[z.vrsta], borderRadius: 1 }} />)}
  </>;
  const RedakFaze = ({ boja, naslov, podnaslov, od, doD, tekst }) => (
    <div style={{ display: "flex", height: 30 }}>
      <div style={{ width: LIJEVO, flexShrink: 0, padding: "0 10px 0 38px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, minWidth: 0 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: boja, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{naslov}</span>
        <span style={{ color: "var(--ink-soft)", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{podnaslov}</span>
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        {od && <div title={`${naslov} · ${kratkiDatum(od)}–${kratkiDatum(doD)}`} className="f-mono" style={{ position: "absolute", top: 7, height: 16, ...traka(od, doD), minWidth: 6, background: boja, borderRadius: 2, color: bojaTekstaNa(boja), fontSize: 10, lineHeight: "16px", padding: "0 4px", overflow: "hidden", whiteSpace: "nowrap" }}>{tekst}</div>}
      </div>
    </div>
  );
  const GumbRetka = ({ k, children }) => (
    <button type="button" onClick={() => prebaci(k)} aria-expanded={otvoreni.has(k)} style={{ width: LIJEVO, flexShrink: 0, display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", background: "transparent", border: "none", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
      <span style={{ width: 18, flexShrink: 0, marginTop: 1, color: "var(--ink-soft)" }}>{otvoreni.has(k) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>{children}</span>
    </button>
  );
  const AkcijeProjekta = ({ projekt }) => (mozeMijenjati || otvoriProjekt) ? (
    <div style={{ display: "flex", gap: 8, padding: "8px 12px 12px 38px", flexWrap: "wrap" }}>
      {mozeMijenjati && <Btn size="sm" onClick={() => patchProjekt(projekt.id, { planStatus: projekt.planStatus === "hitno" ? null : "hitno" })}>{projekt.planStatus === "hitno" ? "Makni oznaku hitno" : "Označi kao hitno"}</Btn>}
      {mozeMijenjati && <Btn size="sm" onClick={() => patchProjekt(projekt.id, { planStatus: "cekanje" })}>Stavi na čekanje</Btn>}
      {otvoriProjekt && <Btn size="sm" onClick={() => otvoriProjekt(projekt.id)}>Otvori projekt</Btn>}
    </div>
  ) : null;

  // retci: projekti i (na mjestu najhitnije serije) jedna grupa po projektu kupaonica
  const retci = [];
  const dodaneGrupe = new Set();
  plan.poslovi.forEach((p) => {
    if (p.tip === "projekt") { retci.push({ tip: "projekt", k: p.id, p }); return; }
    if (dodaneGrupe.has(p.projekt.id)) return;
    dodaneGrupe.add(p.projekt.id);
    retci.push({ tip: "kupaonice", k: `kup-${p.projekt.id}`, projekt: p.projekt, serije: serije.filter((s) => s.projekt.id === p.projekt.id).sort((a, b) => a.rok.localeCompare(b.rok)) });
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        {kpi.map((k) => (
          <div key={k.oznaka} className="kpi-card" style={{ padding: "14px 16px" }}>
            <div className="kpi-num" style={{ color: k.boja }}>{k.broj}</div>
            <div className="kpi-label">{k.oznaka}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 3 }}>{k.pod}</div>
          </div>
        ))}
      </div>

      {upozorenja.length > 0 && (
        <div className="card" style={{ padding: 14, borderColor: "#F0C2B5" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}><AlertTriangle size={15} color="var(--rust)" /><strong className="f-display" style={{ fontWeight: 600, color: "var(--rust)" }}>Upozorenja plana</strong></div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5, fontSize: 13, lineHeight: 1.45 }}>
            {upozorenja.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Plan po projektu</h3>
          <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>Redoslijed je prioritet: hitni, pa najmanja rezerva do roka. Kupaonice su jedan redak po projektu, a svaka isporuka je zasebna serija. Klik na redak otvara detalje.</p>
        </div>
        {retci.length === 0 ? <EmptyState text="Nema nezavršenih radnih naloga ni isporuka kupaonica za planiranje." /> : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 1180 }}>
            <div style={{ display: "flex", borderBottom: "2px solid var(--line-strong)", background: "var(--surface-alt)" }}>
              <div style={{ width: LIJEVO, flexShrink: 0, padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "flex-end" }}>Projekt (po prioritetu)</div>
              <div style={{ flex: 1, position: "relative", height: 46 }}>
                {mjeseci.map((d) => <span key={d} style={{ position: "absolute", top: 5, left: `${pct(d)}%`, paddingLeft: 4, fontSize: 11, fontWeight: 600, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{PLAN_MJESECI[Number(d.slice(5, 7)) - 1]} {d.slice(0, 4)}</span>)}
                {ponedjeljci.map((d) => <span key={d} className="f-mono" style={{ position: "absolute", top: 24, bottom: 0, left: `${pct(d)}%`, paddingLeft: 3, borderLeft: "1px solid var(--line)", fontSize: 10, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{kratkiDatum(d)}</span>)}
              </div>
            </div>
            <div style={{ position: "relative" }}>
              <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: LIJEVO, right: 0, pointerEvents: "none" }}>
                <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${pct(danas)}%`, background: "rgba(26,29,33,0.035)" }} />
                {Array.from({ length: DANA }, (_, i) => plusDanaPlana(start, i)).filter((d) => !kal.radni(d)).map((d) => <div key={d} style={{ position: "absolute", top: 0, bottom: 0, left: `${pct(d)}%`, width: `${100 / DANA}%`, background: danUTjednuPlana(d) === 0 || danUTjednuPlana(d) === 6 ? "rgba(184,68,44,0.05)" : "rgba(184,68,44,0.12)" }} />)}
                {ponedjeljci.map((d) => <div key={d} style={{ position: "absolute", top: 0, bottom: 0, left: `${pct(d)}%`, borderLeft: "1px solid #E3E6E9" }} />)}
                <div title={`Danas ${kratkiDatum(danas)}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${pct(danas)}%`, width: 2, background: "var(--rust)" }} />
              </div>
              {retci.map((r) => {
                if (r.tip === "projekt") {
                  const p = r.p;
                  return (
                    <div key={r.k} style={{ position: "relative", borderBottom: "1px solid var(--line)" }}>
                      <div style={{ display: "flex", minHeight: 58 }}>
                        <GumbRetka k={r.k}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span className="f-mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{p.projekt.sifra}</span>
                            {p.hitno && <PlanChip ton="kasni">hitno</PlanChip>}
                            <PlanChip ton={statusPosla(p.rezervaDana)}>{tekstRezerve(p.rezervaDana)}</PlanChip>
                          </span>
                          <span style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.projekt.naziv}</span>
                          <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{p.bezRoka ? "bez roka" : `isporuka ${kratkiDatum(p.rok)}`} · gotovo {kratkiDatum(p.gotovo)} · {fmtSati0(p.plan)} h</span>
                        </GumbRetka>
                        <div style={{ flex: 1, position: "relative" }}>
                          <MiniFaze p={p} vrh={6} korak={5} debljina={4} />
                          {!p.bezRoka && <MarkerCilj iso={p.cilj} />}
                          {!p.bezRoka && <MarkerRok iso={p.rok} opis="Isporuka kupcu" />}
                          {!p.bezRoka && p.rok < start && <span style={{ position: "absolute", left: 4, top: 20, fontSize: 10.5, fontWeight: 600, color: "var(--rust)" }}>isporuka {kratkiDatum(p.rok)} ←</span>}
                        </div>
                      </div>
                      {otvoreni.has(r.k) && (
                        <div style={{ background: "#F7F8F9", borderTop: "1px dashed var(--line)" }}>
                          {p.faze.map((f) => <RedakFaze key={f.nalogId} boja={PLAN_BOJA[f.faza] || "#6B737B"} naslov={f.faza} podnaslov={`${f.broj}${f.utroseno > 0 ? ` · utrošeno ${fmtSati(f.utroseno)} od ${fmtSati(f.plan)} h` : ` · ${fmtSati(f.plan)} h`}`} od={f.od} doD={f.do} tekst={`${fmtSati(Math.max(0, f.plan - f.utroseno))} h${f.status === "U tijeku" ? " · u tijeku" : ""}`} />)}
                          {p.zavrsne.map((z) => <RedakFaze key={z.vrsta} boja={PLAN_BOJA[z.vrsta]} naslov={z.vrsta} podnaslov={`${z.dana} ${radnihDanaRijec(z.dana)} nakon proizvodnje`} od={z.od} doD={z.do} tekst={`${z.dana} d`} />)}
                          <AkcijeProjekta projekt={p.projekt} />
                        </div>
                      )}
                    </div>
                  );
                }
                const ss = r.serije;
                const kas = ss.filter((s) => s.rezervaDana < 0);
                const najgora = Math.min(...ss.map((s) => s.rezervaDana));
                const info = plan.kupaonice.find((x) => x.projekt.id === r.projekt.id);
                const korak = Math.max(1, Math.min(3, Math.floor(44 / ss.length)));
                return (
                  <div key={r.k} style={{ position: "relative", borderBottom: "1px solid var(--line)", background: "rgba(46,94,122,0.04)" }}>
                    <div style={{ display: "flex", minHeight: 58 }}>
                      <GumbRetka k={r.k}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span className="f-mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.projekt.sifra}</span>
                          <PlanChip ton="kup">kupaonice</PlanChip>
                          {r.projekt.planStatus === "hitno" && <PlanChip ton="kasni">hitno</PlanChip>}
                          <PlanChip ton={statusPosla(najgora)}>{kas.length ? `kasni ${kas.length}/${ss.length}` : "na vrijeme"}</PlanChip>
                        </span>
                        <span style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.projekt.naziv}</span>
                        <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{ss.length} isporuka {kratkiDatum(ss[0].rok)}–{kratkiDatum(ss[ss.length - 1].rok)} · {ss.reduce((a, s) => a + s.pod, 0)} poda + {ss.reduce((a, s) => a + s.stranica, 0)} stranica · {fmtSati0(ss.reduce((a, s) => a + s.plan, 0))} h{info?.bezDatumaKom ? ` · još ${info.bezDatumaKom} kom. bez datuma` : ""}</span>
                      </GumbRetka>
                      <div style={{ flex: 1, position: "relative" }}>
                        {ss.map((s, i) => {
                          const od = s.faze.filter((f) => f.od).map((f) => f.od).sort()[0];
                          const boja = s.rezervaDana < 0 ? "#B8442C" : s.rezervaDana <= 2 ? "#C68A1A" : "#256B45";
                          return (
                            <React.Fragment key={s.id}>
                              {od && <div title={`Isporuka ${kratkiDatum(s.rok)} · izrada ${kratkiDatum(od)}–${kratkiDatum(s.gotovo)}`} style={{ position: "absolute", top: 7 + i * korak, height: 2, ...traka(od, s.gotovo), background: boja }} />}
                              {unutar(s.rok) && <div title={`Isporuka ${kratkiDatum(s.rok)}`} style={{ position: "absolute", top: 5 + i * korak, height: 6, width: 2, left: `${pct(s.rok) + 50 / DANA}%`, background: "var(--ink)" }} />}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                    {otvoreni.has(r.k) && (
                      <div style={{ background: "#F7F8F9", borderTop: "1px dashed var(--line)" }}>
                        {ss.map((s) => (
                          <div key={s.id} style={{ display: "flex", minHeight: 40, borderBottom: "1px dashed #E3E6E9" }}>
                            <div style={{ width: LIJEVO, flexShrink: 0, padding: "5px 10px 5px 38px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, fontSize: 12, minWidth: 0 }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span style={{ fontWeight: 600 }}>Isporuka {kratkiDatum(s.rok)}</span><PlanChip ton={statusPosla(s.rezervaDana)}>{tekstRezerve(s.rezervaDana)}</PlanChip></span>
                              <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>{s.pod} {s.pod === 1 ? "pod" : "poda"} + {s.stranica} {s.stranica === 1 ? "stranica" : "stranice"} · {fmtSati0(s.plan)} h · spremno {kratkiDatum(s.gotovo)}</span>
                            </div>
                            <div style={{ flex: 1, position: "relative" }}>
                              <MiniFaze p={s} vrh={4} korak={3} debljina={3} />
                              {s.cilj !== s.rok && <MarkerCilj iso={s.cilj} gore={2} dolje={2} />}
                              <MarkerRok iso={s.rok} opis="Otprema" gore={3} dolje={2} />
                            </div>
                          </div>
                        ))}
                        <AkcijeProjekta projekt={r.projekt} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", padding: "10px 16px", borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--ink-soft)" }}>
          {PLAN_LEGENDA.map(([n, b]) => <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 8, borderRadius: 1, background: b }} />{n}</span>)}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 2, height: 12, background: "var(--rust)" }} />Danas</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ height: 12, borderLeft: "2px dashed var(--ink)" }} />Gotovo najkasnije</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ height: 12, borderLeft: "2px solid var(--ink)" }} />Isporuka / otprema</span>
        </div>
      </div>

      {plan.naCekanju.length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <div className="label" style={{ marginBottom: 8 }}>Na čekanju — nisu u planu ({plan.naCekanju.length})</div>
          {plan.naCekanju.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
              <span><span className="f-mono" style={{ fontWeight: 600 }}>{p.sifra}</span> — {p.naziv}{p.rokZavrsetka ? <span style={{ color: "var(--ink-soft)" }}> · isporuka {fmtDate(p.rokZavrsetka)}</span> : null}</span>
              {mozeMijenjati && <Btn size="sm" onClick={() => patchProjekt(p.id, { planStatus: null })}>Vrati u plan</Btn>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Opterećenje i smjene ---------- */
function PlanOpterecenje({ plan, db, podaci, update, showToast, mozeMijenjati }) {
  const { kal, danas, post } = plan;
  // varijanta s 2. smjenom svugdje gdje je dopuštena — iz nje se vide dani kad bi pomogla
  const planS2 = useMemo(
    () => izracunajPlanProizvodnje({ db, normativ: podaci?.normativ, odsutnosti: podaci?.odsutnosti, danas, drugaSmjenaSvuda: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.radniNalozi, db.projekti, db.zaposlenici, db.praznici, db.kapacitetiDana, db.planProizvodnje, podaci, danas]
  );
  const ponTjedna = plusDanaPlana(danas, -((danUTjednuPlana(danas) + 6) % 7));
  const TJEDNI = Array.from({ length: 6 }, (_, i) => plusDanaPlana(ponTjedna, i * 7));
  const daniTjedna = (pon) => [0, 1, 2, 3, 4].map((i) => plusDanaPlana(pon, i)).filter((d) => kal.radni(d) && d >= plan.pocetak);
  const sveFaze = [...PLAN_RAZINE.flat(), "Ostalo"];
  const fazaTjedan = (faza, pon) => {
    const dani = new Set(daniTjedna(pon));
    let h = 0, kup = 0, ceka = 0;
    plan.poslovi.forEach((p) => p.faze.forEach((f) => {
      if (f.faza !== faza) return;
      Object.entries(f.dani).forEach(([d, v]) => { if (dani.has(d)) { h += v.sati; if (p.tip === "kupaonice") kup += v.sati; } });
      Object.entries(f.neispunjeno).forEach(([d, v]) => { if (dani.has(d)) ceka += v; });
    }));
    const ljudi = faza === "Ostalo" ? plan.radnika : plan.kompetentnih[faza] || 0;
    const kap = [...dani].reduce((s, d) => s + (PLAN_STROJEVI.includes(faza) ? (ljudi > 0 ? plan.satiStroja(faza, d) : 0) : ljudi * 8), 0);
    return { h, kup, ceka, kap, posto: kap ? Math.round((h / kap) * 100) : (h > 0 ? 999 : 0) };
  };
  const puniDani = (stroj) => Object.entries(plan.strojPoDanu[stroj] || {}).filter(([d, h]) => h >= plan.satiStroja(stroj, d) - 0.01).map(([d]) => d).sort();
  const raspon = (lista) => (lista.length ? (lista.length === 1 ? kratkiDatum(lista[0]) : `${kratkiDatum(lista[0])}–${kratkiDatum(lista[lista.length - 1])}`) : "");
  // predloženi dani 2. smjene: u varijanti s 2 smjene stroj radi preko 8 h, a 2. smjena još nije uključena
  const prijedlogS2 = PLAN_STROJEVI.filter((s) => post.drugaSmjena[s]).map((s) => ({
    stroj: s,
    dani: Object.entries(planS2.strojPoDanu[s] || {}).filter(([d, h]) => h > 8.01 && plan.satiStroja(s, d) <= 8).map(([d]) => d).sort(),
  })).filter((x) => x.dani.length);
  const ukljucene = (db.kapacitetiDana || []).filter((k) => PLAN_STROJEVI.includes(k.stroj) && Number(k.sati) > 8 && k.datum >= danas).sort((a, b) => a.datum.localeCompare(b.datum));
  const ranije = (p) => { const p2 = planS2.poslovi.find((x) => x.id === p.id); return p2 ? kal.radnihIzmedu(p2.gotovo, p.gotovo) : 0; };
  const serije = plan.poslovi.filter((p) => p.tip === "kupaonice");
  const uSerijama = serije.map(ranije).filter((x) => x > 0);
  const uProjektima = plan.poslovi.filter((p) => p.tip === "projekt").map((p) => ({ p, r: ranije(p) })).filter((x) => x.r > 0).sort((a, b) => b.r - a.r);

  const ukljuciS2 = () => {
    const novi = prijedlogS2.flatMap((x) => x.dani.map((d) => ({ id: uid("kap"), stroj: x.stroj, datum: d, sati: 16 })));
    const kljucevi = new Set(novi.map((n) => `${n.stroj}|${n.datum}`));
    update("kapacitetiDana", [...(db.kapacitetiDana || []).filter((k) => !kljucevi.has(`${k.stroj}|${k.datum}`)), ...novi]);
    showToast(`2. smjena uključena za ${novi.length} ${novi.length === 1 ? "dan stroja" : "dana strojeva"}.`);
  };
  const iskljuciS2 = () => {
    const ids = new Set(ukljucene.map((k) => k.id));
    update("kapacitetiDana", (db.kapacitetiDana || []).filter((k) => !ids.has(k.id)));
    showToast("2. smjena isključena.");
  };

  const sumaFazeKup = (faza) => serije.reduce((s, p) => s + p.faze.filter((f) => f.faza === faza).reduce((a, f) => a + f.plan, 0), 0);
  const kompleta = Math.min(serije.reduce((s, p) => s + p.pod, 0), serije.reduce((s, p) => s + p.stranica, 0));
  const cekanje = sveFaze.map((f) => ({ faza: f, ceka: TJEDNI.reduce((s, t) => s + fazaTjedan(f, t).ceka, 0) })).filter((x) => x.ceka >= 5).sort((a, b) => b.ceka - a.ceka);

  const prijedlozi = [];
  if (prijedlogS2.length) prijedlozi.push({
    tekst: <><strong>Uključi 2. smjenu</strong> — {prijedlogS2.map((x) => `${x.stroj === "Kutno savijanje" ? "preša" : x.stroj.toLowerCase()} ${raspon(x.dani)} (${x.dani.length} ${danaRijec(x.dani.length)})`).join(", ")}.{uSerijama.length ? ` Isporuke kupaonica bile bi spremne ${Math.min(...uSerijama)}–${Math.max(...uSerijama)} radnih dana ranije.` : ""}{uProjektima.length ? ` Projekti do ${uProjektima[0].r} ${danaRijec(uProjektima[0].r)} ranije (${uProjektima.slice(0, 3).map((x) => x.p.projekt.sifra).join(", ")}).` : ""}</>,
    akcija: mozeMijenjati ? <Btn size="sm" variant="primary" onClick={ukljuciS2}>Uključi za te dane</Btn> : null,
  });
  PLAN_STROJEVI.filter((s) => !post.drugaSmjena[s] && puniDani(s).length >= 5).forEach((s) => prijedlozi.push({
    tekst: <><strong>{s}</strong> radi punim kapacitetom ({raspon(puniDani(s))}), a 2. smjena za nju nije predviđena. {plan.kompetentnih[s] <= 1 ? `Samo ${plan.kompetentnih[s]} osoba zna raditi tu fazu — dodaj kompetenciju još nekome ili dio posla daj u kooperaciju.` : "Prekovremeni rad ili 2. smjena skratili bi red čekanja (2. smjena se dopušta u postavkama plana)."}</>,
  }));
  cekanje.forEach((c) => prijedlozi.push({ tekst: <><strong>{c.faza}</strong>: nalozi čekaju na slobodne ljude ukupno ~{fmtSati0(c.ceka)} h u sljedećih 6 tjedana. Prekovremeni ili još jedna osoba s tom kompetencijom skratili bi čekanje.</> }));
  if (kompleta > 0) prijedlozi.push({ tekst: <><strong>Normativ kupaonica</strong>: po raspodjeli iz normativa jedan komplet (pod + stranice) treba oko {fmtSati(sumaFazeKup("Laser za profile") / kompleta)} h lasera za profile, {fmtSati(sumaFazeKup("Laser za limove") / kompleta)} h lasera za limove, {fmtSati(sumaFazeKup("Pila") / kompleta)} h pile i {fmtSati(sumaFazeKup("Kutno savijanje") / kompleta)} h preše. Ako je stvarno vrijeme na strojevima drukčije, ispravi postotke u normativu (detalji projekta kupaonica → Uredi normativ).</> });

  const TH = { textAlign: "center", whiteSpace: "nowrap" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ padding: 14 }}>
        <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Prijedlozi plana</h3>
        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2, marginBottom: 10 }}>Plan ih računa sam; ništa se ne mijenja dok se ne potvrdi.</p>
        {prijedlozi.length === 0 ? <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Nema prijedloga — strojevi i ljudi nisu preopterećeni.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {prijedlozi.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "10px 12px", background: "var(--surface-alt)", border: "1px solid var(--line)", borderRadius: 3 }}>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, flex: "999 1 520px" }}>{p.tekst}</p>
                {p.akcija}
              </div>
            ))}
          </div>
        )}
        {ukljucene.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12, fontSize: 12.5, color: "var(--ink-soft)" }}>
            <span>Uključena 2. smjena: {[...new Set(ukljucene.map((k) => k.stroj))].map((s) => `${s === "Kutno savijanje" ? "preša" : s.toLowerCase()} ${raspon(ukljucene.filter((k) => k.stroj === s).map((k) => k.datum))}`).join(", ")}</span>
            {mozeMijenjati && <Btn size="sm" onClick={iskljuciS2}>Isključi 2. smjenu</Btn>}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "12px 16px 4px" }}>
          <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Opterećenje po fazama (tjedno)</h3>
          <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>Sati iz plana i zauzetost: za strojeve zauzetost stroja, za ostale faze zauzetost ljudi koji znaju raditi tu fazu. Drugi redak: koliko od toga su kupaonice i koliko je posla čekalo na slobodne ljude.</p>
        </div>
        <div style={{ overflowX: "auto", padding: "8px 16px 16px" }}>
          <table className="erp-table" style={{ minWidth: 1000 }}>
            <thead><tr><th>Faza</th><th style={TH}>Ljudi</th>{TJEDNI.map((t) => <th key={t} style={TH}>{kratkiDatum(t)}–{kratkiDatum(plusDanaPlana(t, 4))}</th>)}</tr></thead>
            <tbody>
              {sveFaze.filter((f) => TJEDNI.some((t) => fazaTjedan(f, t).h > 0.05)).map((f) => (
                <tr key={f}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: PLAN_BOJA[f] || "#6B737B", marginRight: 8 }} />{f}{PLAN_STROJEVI.includes(f) && <span style={{ fontWeight: 400, fontSize: 11, color: "var(--ink-soft)" }}> · stroj</span>}</td>
                  <td className="f-mono" style={{ textAlign: "center" }}>{f === "Ostalo" ? "svi" : plan.kompetentnih[f] || 0}</td>
                  {TJEDNI.map((t) => {
                    const c = fazaTjedan(f, t);
                    if (c.h < 0.05) return <td key={t} style={{ textAlign: "center", color: "var(--ink-faint)" }}>—</td>;
                    const ton = c.posto >= 90 ? { bg: "#FBEAE6", fg: "#9A2E1B" } : c.posto >= 70 ? { bg: "#FFF6DE", fg: "#7A5600" } : { bg: "#EAF3F7", fg: "#215C77" };
                    return (
                      <td key={t} style={{ padding: 6, textAlign: "center" }}>
                        <div style={{ background: ton.bg, color: ton.fg, borderRadius: 2, padding: "5px 4px" }}>
                          <div className="f-mono" style={{ fontSize: 12, fontWeight: 600 }}>{fmtSati0(c.h)} h · {c.posto > 100 ? "> 100" : c.posto} %</div>
                          <div style={{ fontSize: 10.5 }}>{c.kup > 0.5 ? `kupaonice ${fmtSati0(c.kup)} h` : " "}{c.ceka > 0.5 ? ` · čeka ${fmtSati0(c.ceka)} h` : ""}</div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Strojevi i smjene</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="erp-table" style={{ minWidth: 760 }}>
            <thead><tr><th>Stroj</th><th>Ljudi koji ga znaju</th><th>Pun (trenutne smjene)</th><th>2. smjena bi radila</th><th>2. smjena</th></tr></thead>
            <tbody>
              {PLAN_STROJEVI.map((s) => {
                const puni = puniDani(s);
                const pr = prijedlogS2.find((x) => x.stroj === s);
                const uk = ukljucene.filter((k) => k.stroj === s).map((k) => k.datum);
                return (
                  <tr key={s}>
                    <td style={{ fontWeight: 600 }}>{s === "Kutno savijanje" ? "Kutno savijanje (preša)" : s}</td>
                    <td className="f-mono">{plan.kompetentnih[s] || 0}</td>
                    <td className="f-mono">{puni.length ? `${raspon(puni)} (${puni.length} ${danaRijec(puni.length)})` : "—"}</td>
                    <td className="f-mono">{post.drugaSmjena[s] ? (pr ? `${raspon(pr.dani)} (${pr.dani.length} ${danaRijec(pr.dani.length)})` : "nije potrebna") : "—"}</td>
                    <td>{post.drugaSmjena[s] ? (uk.length ? `uključena: ${raspon(uk)}` : "po potrebi") : "nije predviđena"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Ljudi ukupno</h3>
        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2, marginBottom: 12 }}>{plan.radnika} ljudi s kompetencijama (uključeni kooperanti) · 8 h po radnom danu · upisani godišnji, bolovanja i službeni putovi se oduzimaju</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {TJEDNI.map((t) => {
            const dani = daniTjedna(t);
            const ras = dani.reduce((s, d) => s + (plan.iskoristenostPoDanu[d]?.raspolozivo ?? plan.radnika * 8), 0);
            const isk = dani.reduce((s, d) => s + (plan.iskoristenostPoDanu[d]?.iskoristeno || 0), 0);
            const posto = ras ? Math.round((isk / ras) * 100) : 0;
            return (
              <div key={t} style={{ display: "grid", gridTemplateColumns: "130px minmax(0, 1fr) 200px", gap: 12, alignItems: "center", fontSize: 12.5 }}>
                <span className="f-mono" style={{ color: "var(--ink-soft)" }}>{kratkiDatum(t)}–{kratkiDatum(plusDanaPlana(t, 4))}</span>
                <div style={{ height: 14, background: "var(--line)", borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, posto)}%`, background: posto >= 90 ? "var(--rust)" : posto >= 70 ? "#C68A1A" : "var(--steel)" }} /></div>
                <span className="f-mono">{fmtSati0(isk)} / {fmtSati0(ras)} h ({posto} %)</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- Danas – unos sati po fazi i kupaonice spremne za otpremu ---------- */
// Voditelj proizvodnje upisuje ukupne utrošene sate po fazi za dan (redak u satiPoNalogu bez
// zaposlenika, izvor "plan"); utrošeno na nalogu i dalje je zbroj svih redaka (zbrojSatiZaNalog),
// pa se slaže s unosom po radnicima u "Sati po nalozima" ako ga netko koristi.
function PlanDanasUnos({ plan, db, update, patchProjekt, showToast, mozeMijenjati }) {
  const [datum, setDatum] = useState(plan.danas);
  const [dodani, setDodani] = useState([]);
  const [unos, setUnos] = useState({});
  const [gotovo, setGotovo] = useState({});
  const [jos, setJos] = useState({});
  const [odabir, setOdabir] = useState("");
  useEffect(() => { setUnos({}); setGotovo({}); setJos({}); setDodani([]); }, [datum]);

  const nalogPoId = new Map(db.radniNalozi.map((n) => [n.id, n]));
  const projektPoId = new Map(db.projekti.map((p) => [p.id, p]));
  const unosVoditelja = (nalogId) => (db.satiPoNalogu || []).filter((s) => s.radniNalogId === nalogId && s.datum === datum && !s.zaposlenikId && s.izvor === "plan").reduce((a, s) => a + (Number(s.sati) || 0), 0);
  const unosRadnika = (nalogId) => (db.satiPoNalogu || []).filter((s) => s.radniNalogId === nalogId && s.datum === datum && s.zaposlenikId).reduce((a, s) => a + (Number(s.sati) || 0), 0);
  const poPlanuDanas = new Map();
  plan.poslovi.filter((p) => p.tip === "projekt").forEach((p) => p.faze.forEach((f) => { if (f.dani[datum]) poPlanuDanas.set(f.nalogId, f.dani[datum]); }));
  const idsRedova = [...new Set([
    ...poPlanuDanas.keys(),
    ...db.radniNalozi.filter((n) => n.status === "U tijeku" && !projektPoId.get(n.projektId)?.koristiNormativ).map((n) => n.id),
    ...(db.satiPoNalogu || []).filter((s) => s.datum === datum && !s.zaposlenikId && s.izvor === "plan").map((s) => s.radniNalogId),
    ...dodani,
  ])].filter((id) => nalogPoId.has(id) && nalogPoId.get(id).status !== "Završen");
  const redovi = idsRedova.map((id) => {
    const n = nalogPoId.get(id);
    const vec = unosVoditelja(id);
    const u = unos[id] != null ? unos[id] : (vec ? String(vec) : "");
    const uBroj = Number(String(u).replace(",", ".")) || 0;
    const plan_ = Number(n.planiranoSati) || 0;
    const dosad = (Number(n.utrosenoSati) || 0) - vec + uBroj;
    const jeGotovo = !!gotovo[id];
    const trebaJos = !jeGotovo && plan_ > 0 && dosad >= plan_ - 0.001;
    const josBroj = jos[id] != null && jos[id] !== "" ? Number(String(jos[id]).replace(",", ".")) : null;
    const preostalo = jeGotovo ? 0 : trebaJos ? josBroj : Math.max(0, plan_ - dosad);
    const ukupno = preostalo == null ? dosad : dosad + preostalo;
    const posto = jeGotovo ? 100 : ukupno > 0 ? Math.min(99, Math.round((dosad / ukupno) * 100)) : 0;
    return { n, projekt: projektPoId.get(n.projektId), u, uBroj, vec, radnika: unosRadnika(id), plan: plan_, dosad, jeGotovo, trebaJos, josBroj, preostalo, posto, poPlanu: poPlanuDanas.get(id) };
  }).sort((a, b) => (razinaFazePlana(a.n.faza) - razinaFazePlana(b.n.faza)) || usporediPrirodno(a.n.broj, b.n.broj));
  const promijenjeni = redovi.filter((r) => unos[r.n.id] != null || gotovo[r.n.id] || (r.trebaJos && r.josBroj != null));
  const upisano = redovi.reduce((s, r) => s + r.uBroj, 0);
  const poPlanuUkupno = [...poPlanuDanas.values()].reduce((s, v) => s + v.sati, 0);
  const kupDanas = plan.poslovi.filter((p) => p.tip === "kupaonice").reduce((s, p) => s + p.faze.reduce((a, f) => a + (f.dani[datum]?.sati || 0), 0), 0);
  const ponudaZaDodati = db.radniNalozi.filter((n) => n.status !== "Završen" && !idsRedova.includes(n.id) && !PLAN_IZVAN_KAPACITETA.has(n.faza) && projektPoId.get(n.projektId) && !projektPoId.get(n.projektId).koristiNormativ && !["Završen", "Otkazan"].includes(projektPoId.get(n.projektId).status)).sort((a, b) => usporediPrirodno(a.broj, b.broj));

  const spremi = () => {
    if (promijenjeni.length === 0) { showToast("Nema promjena za spremiti."); return; }
    const neispunjen = promijenjeni.find((r) => r.trebaJos && r.josBroj == null && !r.jeGotovo);
    if (neispunjen) { showToast(`Za ${neispunjen.n.broj} upiši koliko još sati treba ili označi da je gotovo.`); return; }
    const dotaknuti = new Set(promijenjeni.map((r) => r.n.id));
    const bezStarih = (db.satiPoNalogu || []).filter((s) => !(dotaknuti.has(s.radniNalogId) && s.datum === datum && !s.zaposlenikId && s.izvor === "plan"));
    const noviRedovi = promijenjeni.filter((r) => r.uBroj > 0).map((r) => ({ id: uid("spn"), datum, zaposlenikId: null, radniNalogId: r.n.id, sati: r.uBroj, izvor: "plan", napomena: "Unos u Planu proizvodnje" }));
    const noviSati = [...bezStarih, ...noviRedovi];
    const poRetku = new Map(promijenjeni.map((r) => [r.n.id, r]));
    const noviNalozi = db.radniNalozi.map((n) => {
      const r = poRetku.get(n.id);
      if (!r) return n;
      const utroseno = zbrojSatiZaNalog(n.id, noviSati);
      const izmjena = { ...n, utrosenoSati: utroseno };
      if (r.jeGotovo) izmjena.status = "Završen";
      else if (utroseno > 0 && n.status === "Planiran") izmjena.status = "U tijeku";
      if (!r.jeGotovo && r.trebaJos && r.josBroj != null) {
        izmjena.planiranoSatiPrvo = n.planiranoSatiPrvo ?? n.planiranoSati;
        izmjena.planiranoSati = Math.round((utroseno + r.josBroj) * 10) / 10;
      }
      return izmjena;
    });
    update("satiPoNalogu", noviSati);
    update("radniNalozi", noviNalozi);
    setUnos({}); setGotovo({}); setJos({}); setDodani([]);
    showToast("Spremljeno — plan je preračunat.");
  };

  const kupSekcije = plan.kupaonice.map((k) => {
    const otvorene = (k.projekt.isporuke || []).filter((i) => !i.isporuceno && i.datum).map((i) => i.datum).sort();
    const datumi = [...new Set(otvorene)].slice(0, 2);
    if (!datumi.length) return null;
    const sve = [...(k.projekt.stavkePod || []).map((s) => ({ ...s, grupa: "stavkePod" })), ...(k.projekt.stavkeKomplet || []).map((s) => ({ ...s, grupa: "stavkeKomplet" }))];
    const oznaci = (isporukaId, vrijednost) => patchProjekt(k.projekt.id, { isporuke: (k.projekt.isporuke || []).map((i) => (i.id === isporukaId ? { ...i, isporuceno: vrijednost } : i)) });
    return (
      <div key={k.projekt.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}><span className="f-mono">{k.projekt.sifra}</span> {k.projekt.naziv} <span style={{ fontWeight: 400, color: "var(--ink-soft)" }}>· spremno {k.spremno} od {k.ukupnoKom} komada</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          {datumi.map((d) => (
            <div key={d} style={{ border: "1px solid var(--line)", borderRadius: 3 }}>
              <div style={{ padding: "8px 12px", background: "var(--surface-alt)", borderBottom: "1px solid var(--line)", fontSize: 12.5, fontWeight: 700 }}>Otprema {PLAN_DANI[danUTjednuPlana(d)]} {kratkiDatum(d)}{d === plusDanaPlana(plan.danas, 1) ? " (sutra)" : d === plan.danas ? " (danas)" : d < plan.danas ? " (prošla)" : ""}</div>
              {(k.projekt.isporuke || []).filter((i) => i.datum === d && !i.isporuceno).map((i) => {
                const st = sve.find((s) => s.id === i.stavkaId && s.grupa === i.grupa);
                return (
                  <label key={i.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 40, padding: "4px 12px", borderBottom: "1px solid var(--line)", fontSize: 13, cursor: mozeMijenjati && !i.uOtpremniciId ? "pointer" : "default" }}>
                    <span><span style={{ display: "inline-block", minWidth: 64, color: "var(--ink-soft)" }}>{i.grupa === "stavkePod" ? "Pod" : "Stranica"}</span><strong>{(st?.oznaka || "").trim() || "(bez oznake)"}</strong>{Number(i.komada) > 1 ? ` × ${i.komada}` : ""}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-soft)" }}>spremno za otpremu<input type="checkbox" disabled={!mozeMijenjati || !!i.uOtpremniciId} checked={!!i.isporuceno} onChange={(e) => oznaci(i.id, e.target.checked)} style={{ width: 18, height: 18 }} /></span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }).filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <div>
            <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Utrošeni sati po fazi</h3>
            <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>Upisuje voditelj proizvodnje na kraju dana. Prikazane su faze koje su po planu tog dana u radu, one „u tijeku“ i one dodane ručno.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>Dan <input className="input f-mono" type="date" max={plan.danas} style={{ width: 160 }} value={datum} onChange={(e) => setDatum(e.target.value || plan.danas)} /></label>
            {mozeMijenjati && <Btn variant="primary" icon={Save} onClick={spremi}>Spremi i preračunaj plan</Btn>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--line)", background: "var(--surface-alt)" }}>
          <div><div className="label" style={{ marginBottom: 2 }}>Projekti po planu</div><div className="f-mono" style={{ fontSize: 17, fontWeight: 600 }}>{fmtSati(poPlanuUkupno)} h · {poPlanuDanas.size} faza</div></div>
          <div><div className="label" style={{ marginBottom: 2 }}>Kupaonice po planu</div><div className="f-mono" style={{ fontSize: 17, fontWeight: 600 }}>{fmtSati(kupDanas)} h</div></div>
          <div><div className="label" style={{ marginBottom: 2 }}>Upisano</div><div className="f-mono" style={{ fontSize: 17, fontWeight: 600 }}>{fmtSati(upisano)} h</div></div>
        </div>
        {redovi.length === 0 ? <EmptyState text="Za ovaj dan nema faza u radu po planu. Fazu možeš dodati ispod." /> : (
          <div style={{ overflowX: "auto", padding: "0 16px" }}>
            <table className="erp-table" style={{ minWidth: 1000 }}>
              <thead><tr><th>Radni nalog</th><th>Projekt</th><th style={{ textAlign: "right" }}>Plan</th><th style={{ textAlign: "right" }}>Dosad</th><th style={{ textAlign: "right" }}>Po planu danas</th><th>Utrošeno taj dan</th><th style={{ textAlign: "center" }}>Gotovo</th><th style={{ textAlign: "right" }}>Preostalo</th><th style={{ minWidth: 130 }}>Napredak</th></tr></thead>
              <tbody>
                {redovi.map((r) => (
                  <tr key={r.n.id}>
                    <td className="f-mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: PLAN_BOJA[r.n.faza] || "#6B737B", marginRight: 6 }} />{r.n.broj}
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--ink-soft)" }}>{r.n.faza}{r.n.status === "U tijeku" ? " · u tijeku" : ""}</div>
                    </td>
                    <td><span className="f-mono" style={{ fontSize: 12, fontWeight: 600 }}>{r.projekt?.sifra}</span><div style={{ fontSize: 11.5, color: "var(--ink-soft)", maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.projekt?.naziv}</div></td>
                    <td className="f-mono" style={{ textAlign: "right" }}>{fmtSati(r.plan)} h</td>
                    <td className="f-mono" style={{ textAlign: "right" }}>{fmtSati(r.dosad)} h{r.radnika > 0 && <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5, color: "var(--ink-soft)" }}>od toga po radnicima {fmtSati(r.radnika)} h</div>}</td>
                    <td className="f-mono" style={{ textAlign: "right", color: "var(--ink-soft)" }}>{r.poPlanu ? `${fmtSati(r.poPlanu.sati)} h` : "—"}{r.poPlanu && <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5 }}>{r.poPlanu.ljudi} {r.poPlanu.ljudi === 1 ? "osoba" : "osobe"}</div>}</td>
                    <td><input className="input f-mono" inputMode="decimal" aria-label={`Utrošeno ${datum} za ${r.n.broj}`} placeholder="0" disabled={!mozeMijenjati} style={{ width: 84, textAlign: "right" }} value={r.u} onChange={(e) => setUnos({ ...unos, [r.n.id]: e.target.value })} /></td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" aria-label={`Faza ${r.n.broj} gotova`} disabled={!mozeMijenjati} checked={r.jeGotovo} onChange={(e) => setGotovo({ ...gotovo, [r.n.id]: e.target.checked })} style={{ width: 18, height: 18 }} /></td>
                    <td className="f-mono" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {r.trebaJos ? (
                        <label style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2, fontFamily: "var(--font-body)", fontSize: 10.5, fontWeight: 600, color: "var(--rust)" }}>
                          Još treba (h)?
                          <input className="input f-mono" inputMode="decimal" placeholder="?" disabled={!mozeMijenjati} style={{ width: 72, textAlign: "right", background: "#FBEAE6", borderColor: "#F0C2B5" }} value={jos[r.n.id] ?? ""} onChange={(e) => setJos({ ...jos, [r.n.id]: e.target.value })} />
                        </label>
                      ) : r.jeGotovo ? "gotovo" : `${fmtSati(r.preostalo || 0)} h`}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 8, background: "var(--line)", borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${r.posto}%`, background: r.jeGotovo ? "var(--green)" : r.trebaJos ? "var(--rust)" : "var(--steel)" }} /></div>
                        <span className="f-mono" style={{ fontSize: 11.5, width: 38, textAlign: "right" }}>{r.posto} %</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mozeMijenjati && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
            <select className="select" style={{ maxWidth: 420 }} value={odabir} onChange={(e) => setOdabir(e.target.value)}>
              <option value="">Dodaj drugu fazu…</option>
              {ponudaZaDodati.map((n) => <option key={n.id} value={n.id}>{n.broj} — {projektPoId.get(n.projektId)?.sifra} · {n.faza}</option>)}
            </select>
            <Btn size="sm" icon={Plus} onClick={() => { if (odabir) { setDodani([...dodani, odabir]); setOdabir(""); } }}>Dodaj</Btn>
          </div>
        )}
        <div style={{ padding: "0 16px 14px", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          Napredak = utrošeno ÷ planirano. „Gotovo“ zatvara fazu bez obzira na sate (ako je gotova prije plana, sljedeće faze i projekti kreću ranije). Ako utrošeno dosegne plan, a faza nije gotova, upiši koliko još sati treba — plan se pomakne.
        </div>
      </div>

      {kupSekcije.length > 0 && (
        <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Kupaonice — označi spremne za otpremu</h3>
            <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>Za kupaonice se sati ne upisuju: kvačica (ista kao u „Isporuke kupaonica“) skida komad iz plana, a ostale serije se pomiču. Prikazane su prve dvije otvorene otpreme po projektu.</p>
          </div>
          {kupSekcije}
        </div>
      )}
    </div>
  );
}

/* ---------- Projekti bez faza — brzi unos sati ---------- */
const PLAN_FAZE_UNOSA = ["Pila", "Laser za profile", "Laser za limove", "Kutno savijanje", "Strojna obrada", "Priprema pozicija za sklapanje", "Sklapanje - konstrukcije", "Zavarivanje", "Brušenje", "Ravnanje", "Kontrola kvalitete"];
const KRATKI_NAZIV_FAZE = { "Laser za profile": "Laser profili", "Laser za limove": "Laser limovi", "Kutno savijanje": "Kutno sav.", "Strojna obrada": "Strojna", "Priprema pozicija za sklapanje": "Priprema", "Sklapanje - konstrukcije": "Sklapanje", "Kontrola kvalitete": "Kontrola" };
function PlanBezFaza({ plan, db, update, patchProjekt, showToast, mozeMijenjati }) {
  const [unos, setUnos] = useState({}); // { projektId: { faza: "sati", zavrsna: "bez" } }
  const red = (id) => unos[id] || {};
  const postavi = (id, polje, v) => setUnos({ ...unos, [id]: { ...red(id), [polje]: v } });
  const satiReda = (id) => PLAN_FAZE_UNOSA.map((f) => [f, Number(String(red(id)[f] || "").replace(",", ".")) || 0]).filter(([, h]) => h > 0);
  const kreiraj = (projekti) => {
    let nalozi = [...db.radniNalozi];
    let kreirano = 0, projekata = 0;
    projekti.forEach((p) => {
      const sati = satiReda(p.id);
      if (!sati.length) return;
      let brojac = parseInt(sljedeciBrojRadnogNaloga(nalozi, p.sifra).split("/").pop(), 10);
      const novi = sati.map(([faza, h]) => ({
        id: uid("rn"), broj: `${p.sifra}/${brojac++}`, projektId: p.id, naziv: p.naziv, faza, zaduzenTim: "", status: "Planiran",
        planiranoSati: h, utrosenoSati: 0, datumPocetka: todayISO(), datumZavrsetka: p.rokZavrsetka || todayISO(),
        stavke: [], materijalIzdan: false, ovisiONalogId: null, ovisnostTip: "zavrsetak", ovisnostSati: 8,
      }));
      nalozi = [...nalozi, ...novi];
      kreirano += novi.length; projekata++;
      patchProjekt(p.id, { faze: { ...praznaFazaSati(), ...(p.faze || {}), ...Object.fromEntries(sati) }, zavrsnaObrada: red(p.id).zavrsna || p.zavrsnaObrada || "bez" });
    });
    if (!kreirano) { showToast("Upiši sate barem za jednu fazu."); return; }
    update("radniNalozi", nalozi);
    setUnos({});
    showToast(`Kreirano ${kreirano} radnih naloga za ${projekata} ${projekata === 1 ? "projekt" : "projekta"} — projekti su ušli u plan.`);
  };
  const kupaonice = db.projekti.filter((p) => p.koristiNormativ && !["Završen", "Otkazan"].includes(p.status));
  const sortirani = [...plan.bezFaza].sort((a, b) => (a.rokZavrsetka || "9999").localeCompare(b.rokZavrsetka || "9999"));
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 900 }}>
          <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Projekti bez faza — brzi unos ({plan.bezFaza.length})</h3>
          <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>Ovi aktivni projekti nemaju radnih naloga, pa ih plan ne vidi. Upiši procijenjene preostale sate po fazi (prazno = faze nema) i klikni „Kreiraj naloge“ — projekt odmah ulazi u plan po roku isporuke.{kupaonice.length ? ` Kupaonice (${kupaonice.map((p) => p.sifra).join(", ")}) nisu ovdje: plan ih računa sam iz normativa i rasporeda isporuka.` : ""}</p>
        </div>
        {mozeMijenjati && plan.bezFaza.length > 0 && <Btn variant="primary" icon={Plus} onClick={() => kreiraj(plan.bezFaza)}>Kreiraj naloge za sve popunjene</Btn>}
      </div>
      {plan.bezFaza.length === 0 ? <EmptyState text="Svi aktivni projekti imaju radne naloge." /> : (
        <div style={{ overflowX: "auto" }}>
          <table className="erp-table" style={{ minWidth: 1380 }}>
            <thead><tr><th>Projekt</th><th>Isporuka</th>{PLAN_FAZE_UNOSA.map((f) => <th key={f} style={{ padding: "9px 6px" }}>{KRATKI_NAZIV_FAZE[f] || f}</th>)}<th>Završna obrada</th><th /></tr></thead>
            <tbody>
              {sortirani.map((p) => (
                <tr key={p.id}>
                  <td style={{ maxWidth: 220 }}><span className="f-mono" style={{ fontSize: 12, fontWeight: 600 }}>{p.sifra}</span><div style={{ fontSize: 11.5, color: "var(--ink-soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.naziv}</div></td>
                  <td className="f-mono" style={{ fontSize: 12, whiteSpace: "nowrap", color: p.rokZavrsetka && p.rokZavrsetka < plan.danas ? "var(--rust)" : "inherit" }}>{p.rokZavrsetka ? kratkiDatum(p.rokZavrsetka) : "—"}{p.rokZavrsetka && p.rokZavrsetka < plan.danas && <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5 }}>prošao</div>}</td>
                  {PLAN_FAZE_UNOSA.map((f) => <td key={f} style={{ padding: "6px 4px" }}><input className="input f-mono" inputMode="decimal" aria-label={`${f} sati za ${p.sifra}`} placeholder="—" disabled={!mozeMijenjati} style={{ width: 56, padding: "5px 6px", textAlign: "right" }} value={red(p.id)[f] || ""} onChange={(e) => postavi(p.id, f, e.target.value)} /></td>)}
                  <td><select className="select" aria-label={`Završna obrada za ${p.sifra}`} disabled={!mozeMijenjati} style={{ padding: "5px 6px", minWidth: 150 }} value={red(p.id).zavrsna || p.zavrsnaObrada || "bez"} onChange={(e) => postavi(p.id, "zavrsna", e.target.value)}>{ZAVRSNE_OBRADE.map((z) => <option key={z.key} value={z.key}>{z.naziv}</option>)}</select></td>
                  <td>{mozeMijenjati && <Btn size="sm" onClick={() => kreiraj([p])}>Kreiraj naloge</Btn>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- Postavke plana ---------- */
function PlanPostavke({ plan, db, update, showToast, mozeMijenjati }) {
  const [form, setForm] = useState(() => postavkePlana(db.planProizvodnje));
  const broj = (v, min = 0) => Math.max(min, Number(String(v).replace(",", ".")) || 0);
  const spremi = () => {
    update("planProizvodnje", { ...(db.planProizvodnje || {}), postavke: { ...form, bojanjeDana: broj(form.bojanjeDana), cincanjeDana: broj(form.cincanjeDana), rezervaProjektDana: broj(form.rezervaProjektDana), rezervaKupaoniceDana: broj(form.rezervaKupaoniceDana), maxLjudi: Object.fromEntries(Object.entries(form.maxLjudi).map(([k, v]) => [k, broj(v, 1)])) } });
    showToast("Postavke plana spremljene — plan je preračunat.");
  };
  const tok = [
    ["1 · zajedno", ["Pila", "Laser za profile", "Laser za limove"]],
    ["2 · zajedno", ["Kutno savijanje", "Strojna obrada"]],
    ["3", ["Priprema pozicija"]], ["4", ["Sklapanje"]], ["5", ["Zavarivanje"]], ["6", ["Brušenje"]], ["7", ["Ravnanje"]], ["8", ["Kontrola (ako ima sati)"]],
  ];
  const polje = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 3, fontSize: 13 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ padding: 14 }}>
        <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Redoslijed faza (isti za sve projekte i kupaonice)</h3>
        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2, marginBottom: 12 }}>Faza smije krenuti najranije 1 radni dan nakon početka prethodne i ne može je prestići. Faze bez sati se preskaču. „Ostalo“ nema redoslijed i radi ga bilo tko; montaža (teren) se ne planira u radionici.</p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 8 }}>
          {tok.map(([n, faze], i) => (
            <React.Fragment key={n}>
              {i > 0 && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 10.5, color: "var(--ink-soft)" }}><ArrowRight size={16} />+1 dan</div>}
              <div style={{ padding: "8px 10px", border: "1px solid var(--line-strong)", borderTop: `4px solid ${PLAN_BOJA[faze[0]] || PLAN_BOJA[{ "Priprema pozicija": "Priprema pozicija za sklapanje", "Sklapanje": "Sklapanje - konstrukcije", "Kontrola (ako ima sati)": "Kontrola kvalitete" }[faze[0]]] || "#6B737B"}`, borderRadius: 3, background: "var(--surface)", minWidth: 130 }}>
                <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-soft)", fontWeight: 700 }}>{n}</div>
                {faze.map((f) => <div key={f} style={{ fontSize: 13, fontWeight: 600 }}>{f}</div>)}
              </div>
            </React.Fragment>
          ))}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 10.5, color: "var(--ink-soft)" }}><ArrowRight size={16} />nakon svih</div>
          <div style={{ padding: "8px 10px", border: "1px solid var(--line-strong)", borderTop: "4px solid #C99600", borderRadius: 3, background: "var(--surface)" }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-soft)", fontWeight: 700 }}>Završna obrada</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Bojanje / cinčanje</div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>bira se na projektu</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16 }}>
        <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Rokovi i završna obrada</h3>
          {[["rezervaProjektDana", "Projekt gotov prije isporuke kupcu (radnih dana)"], ["rezervaKupaoniceDana", "Kupaonica spremna prije dana otpreme (radnih dana)"], ["bojanjeDana", "Bojanje u ECON-u (radnih dana)"], ["cincanjeDana", "Cinčanje vani (radnih dana)"]].map(([k, n]) => (
            <label key={k} style={polje}>{n}<input className="input f-mono" inputMode="numeric" disabled={!mozeMijenjati} style={{ width: 64, textAlign: "right" }} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
          ))}
        </div>
        <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Strojevi i smjene</h3>
          <p style={{ fontSize: 12, color: "var(--ink-soft)" }}>Svaki stroj radi 8 h dnevno (1 smjena). Gdje je 2. smjena dopuštena, plan predlaže dane kad bi pomogla, a uključuje se u „Opterećenje i smjene“.</p>
          {PLAN_STROJEVI.map((s) => (
            <label key={s} style={polje}>{s === "Kutno savijanje" ? "Kutno savijanje (preša)" : s}<span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-soft)" }}>2. smjena moguća<input type="checkbox" disabled={!mozeMijenjati} checked={!!form.drugaSmjena[s]} onChange={(e) => setForm({ ...form, drugaSmjena: { ...form.drugaSmjena, [s]: e.target.checked } })} style={{ width: 18, height: 18 }} /></span></label>
          ))}
        </div>
        <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Najviše ljudi na jednom nalogu</h3>
          <p style={{ fontSize: 12, color: "var(--ink-soft)" }}>Da plan ne stavi previše ljudi na jednu fazu samo zato što su slobodni. Na stroju radi 1 osoba po smjeni.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
            {Object.keys(PLAN_POSTAVKE_ZADANO.maxLjudi).map((f) => (
              <label key={f} style={polje}><span style={{ fontSize: 12.5 }}>{KRATKI_NAZIV_FAZE[f] || (f === "Sklapanje - kupaonice" ? "Sklapanje kupaonica" : f)}</span><input className="input f-mono" inputMode="numeric" disabled={!mozeMijenjati} style={{ width: 52, textAlign: "right" }} value={form.maxLjudi[f]} onChange={(e) => setForm({ ...form, maxLjudi: { ...form.maxLjudi, [f]: e.target.value } })} /></label>
            ))}
          </div>
        </div>
        <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600 }}>Kapacitet ljudi i kupaonice</h3>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5, fontSize: 13, lineHeight: 1.45 }}>
            <li><strong>{plan.radnika}</strong> zaposlenika s kompetencijama (uključujući kooperante), 8 h po radnom danu; kompetencije se uređuju na zaposleniku.</li>
            <li>Godišnji, bolovanja i službeni putovi upisani u evidenciju rada oduzimaju se sami — planirani godišnji treba upisati unaprijed.</li>
            <li>Rijetke kompetencije se čuvaju: tko je jedini za neku fazu, ne troši se na faze koje mogu i drugi.</li>
            <li>Kupaonice: sati iz normativa, svaki datum otpreme je serija, napredak je kvačica „spremno za otpremu“. Tim kupaonica (kompetencija „Sklapanje - kupaonice“, sada {plan.timKupaonica}) radi prvo na kupaonicama.</li>
            <li>Prioritet: „hitno“, pa najmanja rezerva do roka; „na čekanju“ izbacuje projekt iz plana.</li>
          </ul>
        </div>
      </div>
      {mozeMijenjati && <div><Btn variant="primary" icon={Save} onClick={spremi}>Spremi postavke plana</Btn></div>}
    </div>
  );
}

/* ============================== PLAN REZANJA (LASER) ============================== */
const REZANJE_STATUSI = ["Na čekanju", "Početak", "Pauzirano", "Završeno"];
const REZANJE_BOJA = { "Na čekanju": "#F0883E", "Početak": "#3B6EE0", "Pauzirano": "#9AA1A8", "Završeno": "#22A05E" };
const DAN_KRATICA = ["ned", "pon", "uto", "sri", "čet", "pet", "sub"];
const STANDARD_MIN_PO_DANU = 7.5 * 60; // standard: jedna smjena = 7,5 h

const fmtMin = (min) => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)}h ${m % 60}min`;
};
const datumKratica = (iso) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`; };

// Kapacitet dana u MINUTAMA: standard jedna smjena 7,5 h (450 min) radnim danom, 0 vikendom, ili ručna iznimka (uneseno u satima, npr. 15 h za dvije smjene)
const kapacitetZaDanMin = (kapaciteti, stroj, datum) => {
  const override = kapaciteti.find((k) => k.stroj === stroj && k.datum === datum);
  if (override) return Math.round(Number(override.sati) * 60);
  const dan = new Date(datum).getDay();
  if (dan === 0 || dan === 6) return 0;
  return STANDARD_MIN_PO_DANU;
};

// Preostalo vrijeme programa = planirano − već odrađeno (uključujući segment koji upravo traje).
// Tako se gantogram sam korigira: program koji je već u tijeku zauzima samo ono što mu još ostaje.
const preostaloMinPrograma = (p, sada = sadaMs()) => {
  let odradjeno = Number(p.odradjenoMin) || 0;
  if (p.status === "Početak" && p.segmentPocetak) odradjeno += Math.max(0, Math.round((sada - new Date(p.segmentPocetak).getTime()) / 60000));
  return Math.max(0, (Number(p.trajanjeMin) || 0) - odradjeno);
};

// Raspoređuje NEZAVRŠENE programe (redom) u dane: dan se puni do kapaciteta, a program koji se
// ne stane u ostatak dana nastavlja se sljedeći radni dan (svaki dan dobiva svoj dio programa).
const rasporediProgramRezanja = (programi, kapaciteti, stroj) => {
  const listaZaStroj = programi.filter((p) => p.stroj === stroj && p.status !== "Završeno");
  if (listaZaStroj.length === 0) return [];
  const sljedeciRadniDan = (od) => {
    let datum = od, kap = kapacitetZaDanMin(kapaciteti, stroj, datum), guard = 0;
    while (kap <= 0 && guard < 365) { datum = addDays(datum, 1); kap = kapacitetZaDanMin(kapaciteti, stroj, datum); guard++; }
    return { datum, kapacitetMin: kap, stavke: [], iskoristenoMin: 0 };
  };
  const dani = [];
  let trenutni = sljedeciRadniDan(todayISO());
  listaZaStroj.forEach((p) => {
    let preostalo = preostaloMinPrograma(p);
    const ukupno = preostalo;
    let prviDio = true;
    if (preostalo <= 0) { trenutni.stavke.push({ ...p, segmentMin: 0, nastavak: false, nastavlja: false }); return; }
    while (preostalo > 0) {
      if (trenutni.kapacitetMin - trenutni.iskoristenoMin <= 0) {
        dani.push(trenutni);
        trenutni = sljedeciRadniDan(addDays(trenutni.datum, 1));
        continue;
      }
      const uzmi = Math.min(preostalo, trenutni.kapacitetMin - trenutni.iskoristenoMin);
      preostalo -= uzmi;
      trenutni.stavke.push({ ...p, segmentMin: uzmi, ukupnoMin: ukupno, nastavak: !prviDio, nastavlja: preostalo > 0 });
      trenutni.iskoristenoMin += uzmi;
      prviDio = false;
    }
  });
  dani.push(trenutni);
  return dani;
};

// Baza broja programa bez brojčanog nastavka "/NN" (npr. "LP-2607-04/02" -> "LP-2607-04"),
// da se dijeljenjem već podijeljenog programa nastavak broji od iste baze, a ne gomila "/01/01".
const bazniBrojPrograma = (broj) => {
  const zadnjaKosa = broj.lastIndexOf("/");
  if (zadnjaKosa === -1) return broj;
  const sufiks = broj.slice(zadnjaKosa + 1);
  return /^\d+$/.test(sufiks) ? broj.slice(0, zadnjaKosa) : broj;
};
const sljedeciBrojNastavka = (programi, originalBroj) => {
  const baza = bazniBrojPrograma(originalBroj);
  let max = 0;
  programi.forEach((p) => {
    if (p.brojPrograma !== baza && bazniBrojPrograma(p.brojPrograma) === baza) {
      const n = parseInt(p.brojPrograma.slice(baza.length + 1), 10);
      if (!isNaN(n)) max = Math.max(max, n);
    }
  });
  return `${baza}/${String(max + 1).padStart(2, "0")}`;
};

function PlanRezanjaView({ db, update, showToast, mojaPozicija }) {
  const [stroj, setStroj] = useState("laserProfili");
  const emptyForm = () => ({ brojPrograma: "", trajanjeRezanjaMin: 60, pripremaMin: 0, radniNalogId: "", napomena: "", status: "Na čekanju" });
  const [form, setForm] = useState(emptyForm());
  const prazanRedMaterijala = () => ({ materijalId: "", nacinUnosa: "kolicina", duzinaM: 6, sirinaM: 1.25, komada: 1, kolicina: "" });
  const [noveStavkeMaterijala, setNoveStavkeMaterijala] = useState([]);
  const [kapForm, setKapForm] = useState({ datum: addDays(todayISO(), 1), sati: 15 });
  const [materijalModalId, setMaterijalModalId] = useState(null);
  const [podijeliModalId, setPodijeliModalId] = useState(null);
  // Gantogram računa preostalo vrijeme programa koji je u tijeku, pa se osvježava svake minute.
  const [, setMinutniTik] = useState(0);
  useEffect(() => { const t = setInterval(() => setMinutniTik((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  // Planirani materijal se skida sa skladišta ODMAH (rezervacija) kad se stavka doda programu;
  // ako se stavka ukloni ili program obriše prije nego je stvarno utrošeno evidentirano, planirana
  // količina se vraća natrag. Kad operater unese stvarno utrošeno, ta se količina trajno skida
  // (trošak), a razlika planirano−stvarno vraća na skladište.
  const dodajStavkuMaterijala = (programId, materijalId, planiranoKolicina) => {
    const kolicina = Number(planiranoKolicina) || 0;
    if (!materijalId || kolicina <= 0) return;
    update("materijali", db.materijali.map((m) => (m.id === materijalId ? { ...m, kolicina: m.kolicina - kolicina } : m)));
    update("programiRezanja", db.programiRezanja.map((p) => (p.id === programId ? { ...p, stavkeMaterijala: [...(p.stavkeMaterijala || []), { id: uid("prm"), materijalId, planiranoKolicina: kolicina, stvarnoKolicina: null, finalizirano: false }] } : p)));
  };
  const obrisiStavkuMaterijala = (programId, stavkaId) => {
    const program = db.programiRezanja.find((p) => p.id === programId);
    const stavka = (program?.stavkeMaterijala || []).find((s) => s.id === stavkaId);
    if (stavka && !stavka.finalizirano) {
      update("materijali", db.materijali.map((m) => (m.id === stavka.materijalId ? { ...m, kolicina: m.kolicina + stavka.planiranoKolicina } : m)));
    }
    update("programiRezanja", db.programiRezanja.map((p) => (p.id === programId ? { ...p, stavkeMaterijala: (p.stavkeMaterijala || []).filter((s) => s.id !== stavkaId) } : p)));
  };
  const finalizirajStvarno = (programId, stavkaId, stvarnoUneseno) => {
    const program = db.programiRezanja.find((p) => p.id === programId);
    const stavka = (program?.stavkeMaterijala || []).find((s) => s.id === stavkaId);
    if (!stavka || stavka.finalizirano) return;
    const stvarno = Number(stvarnoUneseno) || 0;
    const razlika = stavka.planiranoKolicina - stvarno; // pozitivno = viška se vraća na skladište, negativno = utrošeno je više od plana
    update("materijali", db.materijali.map((m) => (m.id === stavka.materijalId ? { ...m, kolicina: m.kolicina + razlika } : m)));
    update("programiRezanja", db.programiRezanja.map((p) => (p.id === programId ? { ...p, stavkeMaterijala: (p.stavkeMaterijala || []).map((s) => (s.id === stavkaId ? { ...s, stvarnoKolicina: stvarno, finalizirano: true } : s)) } : p)));
    showToast("Stvarno utrošena količina evidentirana, skladište ažurirano.");
  };
  const azurirajOperatera = (programId, operaterId) => update("programiRezanja", db.programiRezanja.map((p) => (p.id === programId ? { ...p, operaterId } : p)));

  const ogranicen = jeOperaterLasera(mojaPozicija);
  const fazaZaStroj = OPERACIJE.find((o) => o.key === stroj)?.label || "";
  const danas = todayISO();
  const trenutnoPrijavljeniIds = new Set(
    db.evidencijaRada
      .filter((e) => (e.vrsta || "rad") === "rad" && !e.vrijemeOdlaska && e.vrijemeDolaska.slice(0, 10) === danas)
      .map((e) => e.zaposlenikId)
  );
  // Prikazuju se svi s odgovarajućom kompetencijom (ne samo trenutno prijavljeni) — inače je izbornik
  // prazan čim baš nitko s tom kompetencijom trenutno nije evidentiran na poslu, što onemogućuje unaprijed
  // odabrati operatera. Trenutno prijavljeni su označeni zvjezdicom i idu na vrh liste.
  const dostupniOperateri = [...db.zaposlenici]
    .filter((z) => (z.kompetencije || []).includes(fazaZaStroj))
    .sort((a, b) => {
      const prijA = trenutnoPrijavljeniIds.has(a.id) ? 0 : 1;
      const prijB = trenutnoPrijavljeniIds.has(b.id) ? 0 : 1;
      if (prijA !== prijB) return prijA - prijB;
      return (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr");
    });
  // Trenutno odabrani operater ostaje ponuđen i ako više ne zadovoljava kompetenciju/prijavu
  // (npr. već odabran prije odjave), da se izbor ne obriše ispod korisnika.
  const opcijeOperatera = (trenutniId) => {
    const lista = [...dostupniOperateri];
    if (trenutniId && !lista.some((z) => z.id === trenutniId)) {
      const z = db.zaposlenici.find((zz) => zz.id === trenutniId);
      if (z) lista.push(z);
    }
    return lista;
  };
  const materijaliZaStroj = db.materijali.filter((m) => (stroj === "laserLimovi" ? m.kgPoM2 > 0 : m.kgPoM > 0));

  const programiZaStroj = db.programiRezanja.filter((p) => p.stroj === stroj);
  const nezavrseni = programiZaStroj.filter((p) => p.status !== "Završeno");
  const zavrseni = programiZaStroj.filter((p) => p.status === "Završeno");
  const dani = rasporediProgramRezanja(db.programiRezanja, db.kapacitetiDana, stroj);
  const kapacitetiZaStroj = [...db.kapacitetiDana].filter((k) => k.stroj === stroj).sort((a, b) => a.datum.localeCompare(b.datum));

  const ukupnoVrijemeMin = nezavrseni.reduce((s, p) => s + preostaloMinPrograma(p), 0);
  const zavrsenoVrijemeMin = zavrseni.reduce((s, p) => s + (Number(p.trajanjeMin) || 0), 0);
  const potrebnoDana = Math.ceil(ukupnoVrijemeMin / STANDARD_MIN_PO_DANU) || 0;
  const ukupnoKapacitetMin = dani.reduce((s, d) => s + d.kapacitetMin, 0);
  const ukupnoIskoristenoMin = dani.reduce((s, d) => s + d.iskoristenoMin, 0);
  const postotakPopunjenosti = ukupnoKapacitetMin > 0 ? Math.min(100, Math.round((ukupnoIskoristenoMin / ukupnoKapacitetMin) * 100)) : 0;

  // Raspon dana za prikaz gantograma (min. 3 tjedna, produljuje se ako je reda čekanja duži)
  const poDatumu = Object.fromEntries(dani.map((d) => [d.datum, d]));
  let krajPrikaza = addDays(todayISO(), 20);
  if (dani.length) { const zadnji = dani[dani.length - 1].datum; if (zadnji > krajPrikaza) krajPrikaza = addDays(zadnji, 2); }
  const nizDana = [];
  for (let d = todayISO(); d <= krajPrikaza; d = addDays(d, 1)) nizDana.push(d);

  const dodajProgram = () => {
    if (!form.brojPrograma.trim()) return;
    const stavke = noveStavkeMaterijala
      .filter((s) => s.materijalId && efektivnaKolicinaMaterijala(s, db.materijali.find((m) => m.id === s.materijalId)) > 0)
      .map((s) => ({ id: uid("prm"), materijalId: s.materijalId, planiranoKolicina: efektivnaKolicinaMaterijala(s, db.materijali.find((m) => m.id === s.materijalId)), stvarnoKolicina: null, finalizirano: false }));
    const trajanjeRezanjaMin = Number(form.trajanjeRezanjaMin) || 0;
    const pripremaMin = Number(form.pripremaMin) || 0;
    update("programiRezanja", [...db.programiRezanja, { id: uid("pr"), stroj, brojPrograma: form.brojPrograma.trim(), trajanjeRezanjaMin, pripremaMin, trajanjeMin: trajanjeRezanjaMin + pripremaMin, radniNalogId: form.radniNalogId, napomena: form.napomena, status: form.status, stavkeMaterijala: stavke, operaterId: "", pokrenuoId: null, zavrsioId: null, segmentPocetak: null, odradjenoMin: 0 }]);
    if (stavke.length > 0) {
      let materijali = [...db.materijali];
      stavke.forEach((s) => { materijali = materijali.map((m) => (m.id === s.materijalId ? { ...m, kolicina: m.kolicina - s.planiranoKolicina } : m)); });
      update("materijali", materijali);
    }
    setForm(emptyForm());
    setNoveStavkeMaterijala([]);
    showToast("Program rezanja dodan u red čekanja.");
  };
  const obrisiProgram = (id) => {
    const program = db.programiRezanja.find((p) => p.id === id);
    const nedovrsene = (program?.stavkeMaterijala || []).filter((s) => !s.finalizirano);
    if (nedovrsene.length > 0) {
      let materijali = [...db.materijali];
      nedovrsene.forEach((s) => { materijali = materijali.map((m) => (m.id === s.materijalId ? { ...m, kolicina: m.kolicina + s.planiranoKolicina } : m)); });
      update("materijali", materijali);
    }
    update("programiRezanja", db.programiRezanja.filter((p) => p.id !== id));
  };
  // Stvarno trajanje = zbroj svih razdoblja dok je status bio "Početak" (pauza se ne broji).
  // Pri prelasku Početak→bilo što se zatvara otvoreno razdoblje i pribraja u odradjenoMin;
  // pri prelasku u "Početak" otvara se novo razdoblje. Operater se bilježi iz trenutno
  // odabranog p.operaterId u tom retku (pokrenuoId kad krene, zavrsioId kad završi).
  const postaviStatus = (id, noviStatus) => {
    const sada = sadaISO();
    update("programiRezanja", db.programiRezanja.map((p) => {
      if (p.id !== id) return p;
      let odradjenoMin = p.odradjenoMin || 0;
      let segmentPocetak = p.segmentPocetak || null;
      if (p.status === "Početak" && segmentPocetak) {
        odradjenoMin += Math.max(0, Math.round((new Date(sada) - new Date(segmentPocetak)) / 60000));
        segmentPocetak = null;
      }
      let pokrenuoId = p.pokrenuoId, zavrsioId = p.zavrsioId;
      if (noviStatus === "Početak") { segmentPocetak = sada; if (!pokrenuoId) pokrenuoId = p.operaterId || null; }
      if (noviStatus === "Završeno") zavrsioId = p.operaterId || null;
      return { ...p, status: noviStatus, odradjenoMin, segmentPocetak, pokrenuoId, zavrsioId };
    }));
  };
  // Dijeljenje programa: kad jedan operater ne stigne završiti (npr. kraj smjene), program se
  // zatvara kao "Završeno" s onim što je stvarno odrađeno, a preostalo vrijeme i preostali
  // (neutrošeni) materijal prelaze na novi program-nastavak (broj/NN) koji čeka sljedećeg operatera.
  // Stvarno utrošena količina po stavci se upisuje kao i kod redovnog finaliziranja; ako je operater
  // potrošio više od planiranog, višak se trajno skida sa skladišta (ništa ne prelazi na nastavak).
  const podijeliProgram = (programId, unosiPoStavci) => {
    const program = db.programiRezanja.find((p) => p.id === programId);
    if (!program) return;
    const sada = sadaISO();
    let konacnoOdradjenoMin = program.odradjenoMin || 0;
    if (program.status === "Početak" && program.segmentPocetak) {
      konacnoOdradjenoMin += Math.max(0, Math.round((new Date(sada) - new Date(program.segmentPocetak)) / 60000));
    }
    const preostaloMin = Math.max(0, (Number(program.trajanjeMin) || 0) - konacnoOdradjenoMin);

    let materijaliPromijenjeni = false;
    let materijali = [...db.materijali];
    const zatvoreneStavke = [];
    const noveStavke = [];
    (program.stavkeMaterijala || []).forEach((s) => {
      if (s.finalizirano) { zatvoreneStavke.push(s); return; }
      const stvarno = Number(unosiPoStavci[s.id]) || 0;
      const razlika = s.planiranoKolicina - stvarno;
      const netStockPromjena = Math.min(razlika, 0);
      if (netStockPromjena !== 0) {
        materijaliPromijenjeni = true;
        materijali = materijali.map((m) => (m.id === s.materijalId ? { ...m, kolicina: m.kolicina + netStockPromjena } : m));
      }
      zatvoreneStavke.push({ ...s, stvarnoKolicina: stvarno, finalizirano: true });
      const preostaloMaterijala = Math.max(0, razlika);
      if (preostaloMaterijala > 0) {
        noveStavke.push({ id: uid("prm"), materijalId: s.materijalId, planiranoKolicina: preostaloMaterijala, stvarnoKolicina: null, finalizirano: false });
      }
    });

    const noviBroj = sljedeciBrojNastavka(db.programiRezanja, program.brojPrograma);
    const noviProgram = {
      id: uid("pr"), stroj: program.stroj, brojPrograma: noviBroj, trajanjeMin: preostaloMin,
      radniNalogId: program.radniNalogId, napomena: program.napomena, status: "Na čekanju",
      stavkeMaterijala: noveStavke, operaterId: "", pokrenuoId: null, zavrsioId: null,
      segmentPocetak: null, odradjenoMin: 0,
    };
    update("programiRezanja", [
      ...db.programiRezanja.map((p) => (p.id === programId
        ? { ...p, status: "Završeno", odradjenoMin: konacnoOdradjenoMin, segmentPocetak: null, zavrsioId: p.operaterId || p.zavrsioId || null, stavkeMaterijala: zatvoreneStavke }
        : p)),
      noviProgram,
    ]);
    if (materijaliPromijenjeni) update("materijali", materijali);
    showToast(`Program podijeljen — nastavak ${noviBroj} dodan u red čekanja.`);
  };
  const pomakni = (id, smjer) => {
    const svi = [...db.programiRezanja];
    const indeksiStroj = svi.map((p, i) => ({ p, i })).filter((x) => x.p.stroj === stroj).map((x) => x.i);
    const trenutniIdx = indeksiStroj.findIndex((i) => svi[i].id === id);
    const noviIdx = trenutniIdx + smjer;
    if (noviIdx < 0 || noviIdx >= indeksiStroj.length) return;
    const iA = indeksiStroj[trenutniIdx], iB = indeksiStroj[noviIdx];
    [svi[iA], svi[iB]] = [svi[iB], svi[iA]];
    update("programiRezanja", svi);
  };
  const dodajKapacitet = () => {
    if (!kapForm.datum) return;
    const bezPostojeceg = db.kapacitetiDana.filter((k) => !(k.stroj === stroj && k.datum === kapForm.datum));
    update("kapacitetiDana", [...bezPostojeceg, { id: uid("kap"), stroj, datum: kapForm.datum, sati: Number(kapForm.sati) || 0 }]);
    showToast("Kapacitet dana postavljen.");
  };
  const obrisiKapacitet = (id) => update("kapacitetiDana", db.kapacitetiDana.filter((k) => k.id !== id));
  const radniNalogLabel = (id) => {
    const rn = db.radniNalozi.find((r) => r.id === id);
    if (!rn) return "—";
    const proj = db.projekti.find((p) => p.id === rn.projektId);
    return `${rn.broj} — ${proj?.sifra || ""} ${rn.faza}`;
  };

  const KpiCard = ({ label, value, sub }) => (
    <div className="kpi-card">
      <div className="kpi-label" style={{ marginTop: 0, marginBottom: 6, textTransform: "none", fontSize: 12.5 }}>{label}</div>
      <div className="kpi-num" style={{ fontSize: 24 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 3 }}>{sub}</div>}
    </div>
  );

  const odstupanjeSataMin = Math.round(pomakSataMs / 60000);
  return (
    <div>
      {Math.abs(odstupanjeSataMin) >= 5 && (
        <div className="card" style={{ padding: "10px 14px", marginBottom: 12, borderColor: "#F0C2B5", background: "#FBEAE6", fontSize: 12.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <AlertTriangle size={15} color="var(--rust)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Sat na ovom računalu {odstupanjeSataMin > 0 ? "kasni" : "žuri"} {fmtMin(Math.abs(odstupanjeSataMin))} u odnosu na stvarno vrijeme. Aplikacija zato početak i kraj rezanja bilježi prema vremenu poslužitelja, ali u postavkama računala ispravi datum, vrijeme i vremensku zonu (Zagreb, automatsko vrijeme).</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <Btn variant={stroj === "laserProfili" ? "primary" : "ghost"} onClick={() => setStroj("laserProfili")}>Laser za profile</Btn>
        <Btn variant={stroj === "laserLimovi" ? "primary" : "ghost"} onClick={() => setStroj("laserLimovi")}>Laser za limove</Btn>
      </div>

      {!ogranicen && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
        <KpiCard label="Ukupno nezavršenih" value={nezavrseni.length} sub="naloga" />
        <KpiCard label="Ukupno vrijeme" value={fmtMin(ukupnoVrijemeMin)} sub="za rezanje" />
        <KpiCard label="Potrebno dana" value={potrebnoDana} sub={`(${(STANDARD_MIN_PO_DANU / 60).toLocaleString("hr-HR")} h/dan, jedna smjena)`} />
        <KpiCard label="Završeno ukupno" value={zavrseni.length} sub={fmtMin(zavrsenoVrijemeMin)} />
      </div>
      )}

      {!ogranicen && (
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
          <strong className="f-display" style={{ fontWeight: 600 }}>Ukupno opterećenje</strong>
          <span className="f-mono" style={{ color: "var(--ink-soft)" }}>{fmtMin(ukupnoIskoristenoMin)} / {fmtMin(ukupnoKapacitetMin)}</span>
        </div>
        <div style={{ height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${postotakPopunjenosti}%`, background: postotakPopunjenosti >= 100 ? "var(--rust)" : "var(--steel)" }} />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 6 }}>{postotakPopunjenosti}% popunjenosti za {dani.length} radnih dana</div>
      </div>
      )}

      <div className="card" style={{ padding: "10px 16px", marginBottom: 16, display: "flex", gap: 20, flexWrap: "wrap" }}>
        {REZANJE_STATUSI.map((s) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 2, background: REZANJE_BOJA[s], display: "inline-block" }} />{s}
          </span>
        ))}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Gantogram — Redoslijed rezanja</h3>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", minWidth: nizDana.length * 72, borderTop: "1px solid var(--line)", borderLeft: "1px solid var(--line)" }}>
            {nizDana.map((datum) => {
              const dow = new Date(datum).getDay();
              const jeVikend = dow === 0 || dow === 6;
              const jeDanas = datum === todayISO();
              const dan = poDatumu[datum];
              const kapMin = dan ? dan.kapacitetMin : kapacitetZaDanMin(db.kapacitetiDana, stroj, datum);
              return (
                <div key={datum} style={{ width: 72, flexShrink: 0, borderRight: "1px solid var(--line)", background: jeDanas ? "var(--surface-alt)" : (jeVikend ? "#FBEAE6" : "transparent") }}>
                  <div style={{ textAlign: "center", padding: "6px 2px 1px", fontSize: 11, fontWeight: 600, color: jeVikend ? "var(--rust)" : "var(--ink-soft)" }}>{DAN_KRATICA[dow]}</div>
                  <div style={{ textAlign: "center", fontSize: 10.5, color: "var(--ink-faint)", marginBottom: 4 }}>{datumKratica(datum)}</div>
                  <div className="f-mono" style={{ textAlign: "center", fontSize: 11, fontWeight: 600, padding: "4px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", color: kapMin === 0 ? "var(--rust)" : "var(--ink)" }}>
                    {kapMin === 0 ? "✕" : `${(kapMin / 60).toLocaleString("hr-HR", { maximumFractionDigits: 1 })}h`}
                  </div>
                  <div style={{ minHeight: 90, padding: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                    {(dan?.stavke || []).map((p, i) => (
                      <div key={`${p.id}-${i}`} title={`${p.brojPrograma} — ${p.nastavak || p.nastavlja ? `${fmtMin(p.segmentMin)} ovaj dan od preostalih ${fmtMin(p.ukupnoMin)}` : `${fmtMin(p.segmentMin)}${p.ukupnoMin < (Number(p.trajanjeMin) || 0) ? ` preostalo (planirano ${fmtMin(p.trajanjeMin)})` : ""}`} · ${p.status}`} style={{ fontSize: 9.5, padding: "3px 4px", borderRadius: 2, background: REZANJE_BOJA[p.status], color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="f-mono">
                        {p.nastavak ? "↳ " : ""}{p.brojPrograma}{p.nastavlja ? " →" : ""}
                        {(p.nastavak || p.nastavlja) && <div style={{ fontSize: 9, opacity: 0.9 }}>{fmtMin(p.segmentMin)}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: ogranicen ? "1fr" : "340px 1fr", gap: 16, alignItems: "flex-start" }} className="plan-rezanja-grid">
        <style>{`@media (max-width:900px){ .plan-rezanja-grid{ grid-template-columns:1fr !important; } }`}</style>

        {!ogranicen && (
        <div>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 8 }}>Novi program rezanja</div>
            <Field label="Broj programa"><input className="input f-mono" value={form.brojPrograma} onChange={(e) => setForm({ ...form, brojPrograma: e.target.value })} placeholder="npr. LP-2607-04" /></Field>
            <Field label="Trajanje rezanja (minute)"><input className="input f-mono" type="number" min="0" step="5" value={form.trajanjeRezanjaMin} onChange={(e) => setForm({ ...form, trajanjeRezanjaMin: e.target.value })} /></Field>
            <Field label="Pripremno vrijeme (minute)"><input className="input f-mono" type="number" min="0" step="5" value={form.pripremaMin} onChange={(e) => setForm({ ...form, pripremaMin: e.target.value })} /></Field>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: -6, marginBottom: 10 }}>Ukupno trajanje: <strong className="f-mono">{fmtMin((Number(form.trajanjeRezanjaMin) || 0) + (Number(form.pripremaMin) || 0))}</strong></div>
            <Field label="Radni nalog">
              <select className="select" value={form.radniNalogId} onChange={(e) => setForm({ ...form, radniNalogId: e.target.value })}>
                <option value="">Odaberi radni nalog…</option>
                {db.radniNalozi.map((rn) => { const proj = db.projekti.find((p) => p.id === rn.projektId); return <option key={rn.id} value={rn.id}>{rn.broj} — {proj?.sifra} {rn.faza}</option>; })}
              </select>
            </Field>
            <Field label="Status"><select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{REZANJE_STATUSI.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Napomena"><input className="input" value={form.napomena} onChange={(e) => setForm({ ...form, napomena: e.target.value })} /></Field>

            <div className="label" style={{ marginTop: 10, marginBottom: 4 }}>Planirani materijal (skida se sa skladišta odmah)</div>
            {noveStavkeMaterijala.map((s, i) => (
              <PlanMaterijalRedak
                key={i} row={s} materijali={materijaliZaStroj}
                onChange={(patch) => setNoveStavkeMaterijala(noveStavkeMaterijala.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))}
                onRemove={() => setNoveStavkeMaterijala(noveStavkeMaterijala.filter((_, idx) => idx !== i))}
              />
            ))}
            <Btn variant="ghost" size="sm" icon={Plus} onClick={() => setNoveStavkeMaterijala([...noveStavkeMaterijala, prazanRedMaterijala()])} style={{ marginBottom: 10 }}>Dodaj stavku materijala</Btn>

            <Btn variant="primary" icon={Plus} onClick={dodajProgram} style={{ width: "100%", justifyContent: "center" }}>Dodaj u red čekanja</Btn>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="label" style={{ marginBottom: 8 }}>Radno vrijeme po danu</div>
            <p style={{ fontSize: 11.5, color: "var(--ink-faint)", marginBottom: 10 }}>Standard je jedna smjena od 7,5 h radnim danom, 0 h vikendom. Ovdje postavi iznimku za pojedini datum — npr. 15 h za dvije smjene ili produženo radno vrijeme.</p>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input className="input" type="date" value={kapForm.datum} onChange={(e) => setKapForm({ ...kapForm, datum: e.target.value })} />
              <input className="input f-mono" type="number" min="0" style={{ width: 70 }} value={kapForm.sati} onChange={(e) => setKapForm({ ...kapForm, sati: e.target.value })} />
              <Btn variant="ghost" size="sm" onClick={dodajKapacitet}>Postavi</Btn>
            </div>
            {kapacitetiZaStroj.length === 0 ? <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>Nema iznimki — koristi se standard (7,5 h / 0 h vikendom).</div> : (
              kapacitetiZaStroj.map((k) => (
                <div key={k.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
                  <span>{fmtDate(k.datum)} — <strong className="f-mono">{k.sati}h</strong></span>
                  <button className="btn btn-icon btn-ghost" onClick={() => obrisiKapacitet(k.id)}><X size={13} /></button>
                </div>
              ))
            )}
          </div>
        </div>
        )}

        <div>
          <div className="label" style={{ marginBottom: 8 }}>Popis programa (redoslijed rezanja)</div>
          {programiZaStroj.length === 0 ? <EmptyState text="Nema unesenih programa rezanja za ovaj stroj." /> : (
            <div className="card" style={{ overflowX: "auto" }}>
              <table className="erp-table">
                <thead><tr><th>Program</th><th>Radni nalog</th><th style={{ width: 150 }}>Planirani materijal</th><th style={{ width: 80 }}>Trajanje</th><th style={{ width: 90 }}>Stvarno</th><th style={{ width: 130 }}>Operater</th>{!ogranicen && <th>Napomena</th>}<th style={{ width: 130 }}>Status</th><th style={{ width: 110 }}></th>{!ogranicen && <th style={{ width: 100 }}></th>}</tr></thead>
                <tbody>
                  {programiZaStroj.map((p) => {
                    const stavke = p.stavkeMaterijala || [];
                    const uTijeku = p.status === "Početak" && p.segmentPocetak;
                    const odradjenoPrikaz = (p.odradjenoMin || 0) + (uTijeku ? Math.max(0, Math.round((sadaMs() - new Date(p.segmentPocetak).getTime()) / 60000)) : 0);
                    return (
                      <tr key={p.id}>
                        <td className="f-mono">{p.brojPrograma}</td>
                        <td style={{ fontSize: 12.5 }}>{radniNalogLabel(p.radniNalogId)}</td>
                        <td>
                          <Btn size="sm" variant="ghost" onClick={() => setMaterijalModalId(p.id)}>
                            {stavke.length === 0 ? "Dodaj materijal" : `${stavke.length} stavk${stavke.length === 1 ? "a" : "e"}${stavke.every((s) => s.finalizirano) ? " ✓" : ""}`}
                          </Btn>
                        </td>
                        <td className="f-mono" title={p.pripremaMin != null ? `rezanje ${fmtMin(p.trajanjeRezanjaMin)} + priprema ${fmtMin(p.pripremaMin)}` : undefined}>{fmtMin(p.trajanjeMin)}</td>
                        <td className="f-mono" style={{ color: uTijeku ? "var(--steel)" : "inherit" }}>{p.odradjenoMin || uTijeku ? fmtMin(odradjenoPrikaz) : "—"}</td>
                        <td>
                          <select className="select" style={{ fontSize: 12, padding: "4px 6px" }} value={p.operaterId || ""} onChange={(e) => azurirajOperatera(p.id, e.target.value)}>
                            <option value="">—</option>
                            {opcijeOperatera(p.operaterId).map((z) => <option key={z.id} value={z.id}>{trenutnoPrijavljeniIds.has(z.id) ? "★ " : ""}{z.prezime} {z.ime}</option>)}
                          </select>
                        </td>
                        {!ogranicen && <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{p.napomena}</td>}
                        <td>
                          <select className="select" style={{ fontSize: 12, padding: "4px 6px" }} value={p.status} onChange={(e) => postaviStatus(p.id, e.target.value)}>
                            {REZANJE_STATUSI.map((s) => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td>
                          {p.status !== "Završeno" && <Btn size="sm" variant="ghost" icon={Scissors} onClick={() => setPodijeliModalId(p.id)}>Dijeli program</Btn>}
                        </td>
                        {!ogranicen && (
                        <td>
                          <div style={{ display: "flex", gap: 2 }}>
                            <button className="btn btn-icon btn-ghost" onClick={() => pomakni(p.id, -1)}><ChevronUp size={13} /></button>
                            <button className="btn btn-icon btn-ghost" onClick={() => pomakni(p.id, 1)}><ChevronDown size={13} /></button>
                            <button className="btn btn-icon btn-ghost" onClick={() => obrisiProgram(p.id)}><Trash2 size={13} color="var(--rust)" /></button>
                          </div>
                        </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8 }}>Stvarno vrijeme se mjeri od trenutka kad je program označen "Početak" do "Završeno" (vrijeme u statusu "Pauzirano" se ne broji), prema satu poslužitelja — ne prema satu računala na kojem se klikne. Operater odabran u retku bilježi se kao tko je pokrenuo/završio.</p>
        </div>
      </div>

      {materijalModalId && (
        <MaterijalProgramaModal
          program={db.programiRezanja.find((p) => p.id === materijalModalId)}
          materijali={db.materijali}
          materijaliZaOdabir={materijaliZaStroj}
          radniNalogLabel={radniNalogLabel}
          onDodaj={(materijalId, kolicina) => dodajStavkuMaterijala(materijalModalId, materijalId, kolicina)}
          onObrisi={(stavkaId) => obrisiStavkuMaterijala(materijalModalId, stavkaId)}
          onFinaliziraj={(stavkaId, stvarno) => finalizirajStvarno(materijalModalId, stavkaId, stvarno)}
          onClose={() => setMaterijalModalId(null)}
        />
      )}

      {podijeliModalId && (
        <PodijeliProgramModal
          program={db.programiRezanja.find((p) => p.id === podijeliModalId)}
          materijali={db.materijali}
          programi={db.programiRezanja}
          onPodijeli={(unosiPoStavci) => { podijeliProgram(podijeliModalId, unosiPoStavci); setPodijeliModalId(null); }}
          onClose={() => setPodijeliModalId(null)}
        />
      )}
    </div>
  );
}

// Redak za unos planiranog materijala (Plan rezanja) — isti princip kao LineItemsEditor (mode="materijal"):
// dužina profila × komada za profile, dimenzije lima (dužina × širina) × komada za limove, ili ručni unos
// količine kad materijal nema definiranu masu po m'/m². Masa se uvijek prikazuje/vraća u kg preko
// efektivnaKolicinaMaterijala, a dužina/širina se u UI-u unose u mm dok se interno drže u metrima.
function PlanMaterijalRedak({ row, materijali, onChange, onRemove }) {
  const mat = materijali.find((m) => m.id === row.materijalId);
  const nacin = row.nacinUnosa || "kolicina";
  const kol = efektivnaKolicinaMaterijala(row, mat);
  const odaberiMaterijal = (val) => {
    const m = materijali.find((x) => x.id === val);
    const jeDuzina = m?.kgPoM > 0;
    const jeLim = m?.kgPoM2 > 0;
    onChange({ materijalId: val, nacinUnosa: jeDuzina ? "duzina" : jeLim ? "lim" : "kolicina" });
  };
  return (
    <div className="card" style={{ padding: 10, marginBottom: 8, background: "var(--surface-alt)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label className="label">Materijal</label>
          <select className="select" value={row.materijalId} onChange={(e) => odaberiMaterijal(e.target.value)}>
            <option value="">Odaberi materijal…</option>
            {materijali.map((m) => <option key={m.id} value={m.id}>{m.sifra} — {m.naziv} ({m.kolicina} {m.jm})</option>)}
          </select>
        </div>
        {onRemove && <button className="btn btn-icon btn-ghost" onClick={onRemove}><X size={14} /></button>}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
        <div style={{ width: 155 }}>
          <label className="label">Način unosa</label>
          <select className="select" value={nacin} onChange={(e) => onChange({ nacinUnosa: e.target.value })}>
            <option value="duzina">Dužina profila × komada</option>
            <option value="lim">Dimenzije lima (dužina × širina)</option>
            <option value="kolicina">Ručni unos količine</option>
          </select>
        </div>
        {nacin === "duzina" ? (
          <>
            <div style={{ width: 95 }}><label className="label">Dužina (mm)</label><input className="input f-mono" type="number" min="0" step="1" value={Math.round((Number(row.duzinaM ?? 6)) * 1000)} onChange={(e) => onChange({ duzinaM: (Number(e.target.value) || 0) / 1000 })} /></div>
            <div style={{ width: 75 }}><label className="label">Komada</label><input className="input f-mono" type="number" min="0" value={row.komada ?? 1} onChange={(e) => onChange({ komada: e.target.value })} /></div>
            <div style={{ width: 105 }}>
              <label className="label">Masa</label>
              <div className="input f-mono" style={{ background: "var(--surface)", color: mat?.kgPoM > 0 ? "var(--ink-soft)" : "var(--rust)" }}>{mat?.kgPoM > 0 ? `${kol.toFixed(1)} kg` : "nema kg/m"}</div>
            </div>
          </>
        ) : nacin === "lim" ? (
          <>
            <div style={{ width: 95 }}><label className="label">Dužina (mm)</label><input className="input f-mono" type="number" min="0" step="1" value={Math.round((Number(row.duzinaM ?? 2)) * 1000)} onChange={(e) => onChange({ duzinaM: (Number(e.target.value) || 0) / 1000 })} /></div>
            <div style={{ width: 95 }}><label className="label">Širina (mm)</label><input className="input f-mono" type="number" min="0" step="1" value={Math.round((Number(row.sirinaM ?? 1.25)) * 1000)} onChange={(e) => onChange({ sirinaM: (Number(e.target.value) || 0) / 1000 })} /></div>
            <div style={{ width: 65 }}><label className="label">Komada</label><input className="input f-mono" type="number" min="0" value={row.komada ?? 1} onChange={(e) => onChange({ komada: e.target.value })} /></div>
            <div style={{ width: 105 }}>
              <label className="label">Masa</label>
              <div className="input f-mono" style={{ background: "var(--surface)", color: mat?.kgPoM2 > 0 ? "var(--ink-soft)" : "var(--rust)" }}>{mat?.kgPoM2 > 0 ? `${kol.toFixed(1)} kg` : "nema kg/m²"}</div>
            </div>
          </>
        ) : (
          <div style={{ width: 120 }}><label className="label">Količina ({mat?.jm || "kg"})</label><input className="input f-mono" type="number" min="0" value={row.kolicina ?? ""} onChange={(e) => onChange({ kolicina: e.target.value })} /></div>
        )}
      </div>
    </div>
  );
}

// Materijal jednog programa rezanja — planirane stavke se rezerviraju sa skladišta odmah pri
// dodavanju; operater ovdje po stavci upisuje stvarno utrošenu količinu, čime se ta stavka
// zaključava (finalizira), stvarna količina trajno skida sa skladišta (trošak), a razlika prema
// planiranom vraća natrag.
function MaterijalProgramaModal({ program, materijali, materijaliZaOdabir, radniNalogLabel, onDodaj, onObrisi, onFinaliziraj, onClose }) {
  const prazanRed = () => ({ materijalId: "", nacinUnosa: "kolicina", duzinaM: 6, sirinaM: 1.25, komada: 1, kolicina: "" });
  const [noviRed, setNoviRed] = useState(prazanRed());
  const [uneseno, setUneseno] = useState({});

  const stavke = program?.stavkeMaterijala || [];
  const matNaziv = (id) => { const m = materijali.find((x) => x.id === id); return m ? `${m.sifra} — ${m.naziv}` : "—"; };
  const matJm = (id) => materijali.find((x) => x.id === id)?.jm || "";
  const matCijena = (id) => Number(materijali.find((x) => x.id === id)?.cijena) || 0;
  const ukupnoTrosak = stavke.filter((s) => s.finalizirano).reduce((s, st) => s + (Number(st.stvarnoKolicina) || 0) * matCijena(st.materijalId), 0);

  return (
    <Modal title={`Materijal — program ${program?.brojPrograma || ""}`} onClose={onClose} footer={<Btn onClick={onClose}>Zatvori</Btn>}>
      <table className="erp-table" style={{ marginBottom: 10 }}>
        <thead><tr><th>Materijal</th><th style={{ width: 100 }}>Planirano</th><th style={{ width: 130 }}>Stvarno utrošeno</th><th style={{ width: 90 }}>Trošak</th><th style={{ width: 36 }}></th></tr></thead>
        <tbody>
          {stavke.length === 0 && <tr><td colSpan={5}><EmptyState text="Nema dodanog materijala." /></td></tr>}
          {stavke.map((s) => (
            <tr key={s.id}>
              <td style={{ fontSize: 12.5 }}>{matNaziv(s.materijalId)}</td>
              <td className="f-mono">{s.planiranoKolicina} {matJm(s.materijalId)}</td>
              <td>
                {s.finalizirano ? (
                  <span className="f-mono">{s.stvarnoKolicina} {matJm(s.materijalId)}</span>
                ) : (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input className="input f-mono" style={{ width: 80 }} type="number" min="0" step="0.1" placeholder={matJm(s.materijalId)} value={uneseno[s.id] ?? ""} onChange={(e) => setUneseno({ ...uneseno, [s.id]: e.target.value })} />
                    <Btn size="sm" onClick={() => onFinaliziraj(s.id, uneseno[s.id])}>Potvrdi</Btn>
                  </div>
                )}
              </td>
              <td className="f-mono">{s.finalizirano ? fmtCurDec((Number(s.stvarnoKolicina) || 0) * matCijena(s.materijalId)) : "—"}</td>
              <td>{!s.finalizirano && <button className="btn btn-icon btn-ghost" onClick={() => onObrisi(s.id)}><X size={14} /></button>}</td>
            </tr>
          ))}
          {stavke.some((s) => s.finalizirano) && (
            <tr style={{ fontWeight: 700, background: "var(--surface-alt)" }}>
              <td colSpan={3}>Trošak materijala (radni nalog: {radniNalogLabel ? radniNalogLabel(program?.radniNalogId) : "—"})</td>
              <td className="f-mono">{fmtCurDec(ukupnoTrosak)}</td>
              <td></td>
            </tr>
          )}
        </tbody>
      </table>
      <PlanMaterijalRedak row={noviRed} materijali={materijaliZaOdabir || materijali} onChange={(patch) => setNoviRed({ ...noviRed, ...patch })} />
      <Btn variant="ghost" icon={Plus} onClick={() => {
        const mat = materijali.find((m) => m.id === noviRed.materijalId);
        onDodaj(noviRed.materijalId, efektivnaKolicinaMaterijala(noviRed, mat));
        setNoviRed(prazanRed());
      }}>Dodaj</Btn>
    </Modal>
  );
}

// Dijeljenje programa koji jedan operater ne stigne završiti: zatvara trenutni program kao
// "Završeno" s upisanom stvarno utrošenom količinom materijala do sada, a preostalo vrijeme i
// preostali materijal prelaze na novi program-nastavak (broj/NN) za sljedećeg operatera.
function PodijeliProgramModal({ program, materijali, programi, onPodijeli, onClose }) {
  const [unosi, setUnosi] = useState({});
  const stavke = (program?.stavkeMaterijala || []).filter((s) => !s.finalizirano);
  const matNaziv = (id) => { const m = materijali.find((x) => x.id === id); return m ? `${m.sifra} — ${m.naziv}` : "—"; };
  const matJm = (id) => materijali.find((x) => x.id === id)?.jm || "";

  const uTijeku = program?.status === "Početak" && program?.segmentPocetak;
  const odradjenoDoSad = (program?.odradjenoMin || 0) + (uTijeku ? Math.max(0, Math.round((sadaMs() - new Date(program.segmentPocetak).getTime()) / 60000)) : 0);
  const preostaloMin = Math.max(0, (Number(program?.trajanjeMin) || 0) - odradjenoDoSad);

  return (
    <Modal title={`Podijeli program ${program?.brojPrograma || ""}`} onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Scissors} onClick={() => onPodijeli(unosi)}>Podijeli program</Btn></>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>
        Program se zatvara kao "Završeno" (odrađeno {fmtMin(odradjenoDoSad)}), a preostalih <strong className="f-mono">{fmtMin(preostaloMin)}</strong> prelazi na novi program <strong className="f-mono">{sljedeciBrojNastavka(programi || [], program?.brojPrograma || "")}</strong> koji čeka sljedećeg operatera.
      </p>
      {stavke.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>Program nema planiranog materijala za evidentiranje.</p>
      ) : (
        <>
          <div className="label" style={{ marginBottom: 6 }}>Upiši koliko je materijala stvarno potrošeno do sada — ostatak prelazi na novi program</div>
          <table className="erp-table">
            <thead><tr><th>Materijal</th><th style={{ width: 100 }}>Planirano</th><th style={{ width: 140 }}>Stvarno potrošeno</th></tr></thead>
            <tbody>
              {stavke.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontSize: 12.5 }}>{matNaziv(s.materijalId)}</td>
                  <td className="f-mono">{s.planiranoKolicina} {matJm(s.materijalId)}</td>
                  <td><input className="input f-mono" style={{ width: 100 }} type="number" min="0" step="0.1" placeholder={matJm(s.materijalId)} value={unosi[s.id] ?? ""} onChange={(e) => setUnosi({ ...unosi, [s.id]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

/* ============================== NARUDŽBA KUPCA / OTPREMNICE ============================== */
// "Narudžba" ovdje = narudžba KOJU ŠALJE KUPAC Econu (s dogovorenim cijenama po stavci), za
// razliku od postojećih "Narudžbenica" koje su Econova narudžba DOBAVLJAČU.
function NarudzbaModal({ narudzba, projekt, db, update, showToast, onClose }) {
  const emptyForm = () => ({ id: null, projektId: projekt.id, kupacId: projekt?.kupacId || db.kupci[0]?.id || "", broj: "", datum: todayISO(), napomena: "", stavke: [] });
  const [form, setForm] = useState(narudzba ? JSON.parse(JSON.stringify(narudzba)) : emptyForm());

  const dodajStavku = () => setForm({ ...form, stavke: [...form.stavke, { id: uid("nst"), sifra: "", naziv: "", jm: "Stk", kolicina: 0, masaJed: 0, nacinCijene: "rucno", cijenaKg: 0, cijena: 0 }] });
  // Cijena se ili upisuje ručno po komadu, ili se izvodi iz mase × €/kg (isti princip kao normativ) —
  // u drugom slučaju cijena se drži uvijek sinkroniziranom da otpremnica/podloga za fakturu rade nepromijenjeno.
  const azurirajStavku = (i, patch) => setForm({
    ...form,
    stavke: form.stavke.map((s, idx) => {
      if (idx !== i) return s;
      const novo = { ...s, ...patch };
      if ((novo.nacinCijene || "rucno") === "izMase") novo.cijena = (Number(novo.masaJed) || 0) * (Number(novo.cijenaKg) || 0);
      return novo;
    }),
  });
  const obrisiStavku = (i) => setForm({ ...form, stavke: form.stavke.filter((_, idx) => idx !== i) });

  const spremi = () => {
    if (!form.broj.trim()) { showToast("Unesi broj narudžbe kupca."); return; }
    const payload = { ...form, stavke: form.stavke.map((s) => ({ ...s, cijena: Number(s.cijena) || 0, cijenaKg: Number(s.cijenaKg) || 0 })) };
    if (form.id) update("narudzbe", db.narudzbe.map((n) => (n.id === form.id ? payload : n)));
    else update("narudzbe", [...db.narudzbe, { ...payload, id: uid("nar") }]);
    showToast("Narudžba spremljena.");
    onClose();
  };

  return (
    <Modal wide title={narudzba ? `Narudžba ${narudzba.broj}` : "Nova narudžba kupca"} onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi}>Spremi</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="Broj narudžbe kupca"><input className="input f-mono" value={form.broj} onChange={(e) => setForm({ ...form, broj: e.target.value })} placeholder="npr. E-BEST-2026-106" /></Field>
        <Field label="Datum narudžbe"><input className="input" type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} /></Field>
        <Field label="Kupac"><select className="select" value={form.kupacId} onChange={(e) => setForm({ ...form, kupacId: e.target.value })}>{db.kupci.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}</select></Field>
      </div>
      <Field label="Napomena"><input className="input" value={form.napomena} onChange={(e) => setForm({ ...form, napomena: e.target.value })} /></Field>

      <div className="label" style={{ marginTop: 6, marginBottom: 6 }}>Stavke (cijene se koriste kasnije u podlozi za fakturu; količina i masa mogu se iskoristiti za uvoz u normativ)</div>
      <table className="erp-table">
        <thead><tr><th style={{ width: 90 }}>Šifra</th><th>Naziv</th><th style={{ width: 55 }}>JM</th><th style={{ width: 75 }}>Količina</th><th style={{ width: 95 }}>Masa (kg/kom)</th><th style={{ width: 155 }}>Cijena</th><th style={{ width: 36 }}></th></tr></thead>
        <tbody>
          {form.stavke.length === 0 && <tr><td colSpan={7}><EmptyState text="Nema stavki. Dodaj stavku." /></td></tr>}
          {form.stavke.map((s, i) => {
            const izMase = (s.nacinCijene || "rucno") === "izMase";
            return (
              <tr key={s.id}>
                <td><input className="input f-mono" style={{ padding: "5px 8px" }} value={s.sifra} onChange={(e) => azurirajStavku(i, { sifra: e.target.value })} /></td>
                <td><input className="input" style={{ padding: "5px 8px" }} value={s.naziv} onChange={(e) => azurirajStavku(i, { naziv: e.target.value })} /></td>
                <td><input className="input" style={{ padding: "5px 8px" }} value={s.jm} onChange={(e) => azurirajStavku(i, { jm: e.target.value })} /></td>
                <td><input className="input f-mono" type="number" step="1" style={{ padding: "5px 8px" }} value={s.kolicina || 0} onChange={(e) => azurirajStavku(i, { kolicina: e.target.value })} /></td>
                <td><input className="input f-mono" type="number" step="0.1" style={{ padding: "5px 8px" }} value={s.masaJed || 0} onChange={(e) => azurirajStavku(i, { masaJed: e.target.value })} /></td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <select className="select" style={{ padding: "5px 2px", fontSize: 11, width: 58 }} value={s.nacinCijene || "rucno"} onChange={(e) => azurirajStavku(i, { nacinCijene: e.target.value })}>
                      <option value="rucno">€/kom</option>
                      <option value="izMase">€/kg</option>
                    </select>
                    {izMase ? (
                      <input className="input f-mono" type="number" step="0.01" style={{ padding: "5px 8px" }} value={s.cijenaKg || 0} onChange={(e) => azurirajStavku(i, { cijenaKg: e.target.value })} />
                    ) : (
                      <input className="input f-mono" type="number" step="0.01" style={{ padding: "5px 8px" }} value={s.cijena} onChange={(e) => azurirajStavku(i, { cijena: e.target.value })} />
                    )}
                  </div>
                  {izMase && <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 2 }}>= {fmtCurDec(s.cijena)} / kom</div>}
                </td>
                <td><button className="btn btn-icon btn-ghost" onClick={() => obrisiStavku(i)}><Trash2 size={14} color="var(--rust)" /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Btn variant="ghost" size="sm" icon={Plus} onClick={dodajStavku} style={{ marginTop: 8 }}>Dodaj stavku</Btn>
    </Modal>
  );
}

function OtpremnicaFormModal({ narudzba, projekt, db, update, patchProjekt, showToast, onClose }) {
  const koristiNormativ = !!projekt.koristiNormativ;
  // Za tipske projekte (kupaonice po normativu) stavke otpremnice dolaze iz rasporeda isporuka,
  // ne iz narudžbe — smiju se otpremiti samo isporuke koje je proizvodnja označila kao spremne
  // za otpremu (isporuceno) i koje još nisu uključene ni u jednu drugu otpremnicu.
  const nazivIsporuke = (i) => {
    const stavka = (i.grupa === "stavkePod" ? projekt.stavkePod : projekt.stavkeKomplet || []).find((s) => s.id === i.stavkaId);
    return `${i.grupa === "stavkePod" ? "Pod" : "Stranica"} — ${stavka?.oznaka || "(bez oznake)"}`;
  };
  // Naručena količina po stavci — kod normativa je to ukupan broj komada tog tipa (iz Pod/Stranica
  // tablice), kod obične narudžbe kupca je to unesena kolicina na toj stavci narudžbe.
  const narucenoZaIsporuku = (i) => (i.grupa === "stavkePod" ? projekt.stavkePod : projekt.stavkeKomplet || []).find((s) => s.id === i.stavkaId)?.komada;
  const dostupneIsporuke = koristiNormativ ? (projekt.isporuke || []).filter((i) => i.isporuceno && !i.uOtpremniciId) : [];
  // Više odvojenih isporuka istog tipa (npr. "Pod — Typ 4A" spreman u tri navrata) spajaju se u
  // JEDNU stavku otpremnice sa zbrojenom količinom, umjesto da se svaka pojedinačna isporuka
  // ispiše kao zaseban redak — sve pripadajuće isporukaId i dalje se pamte (isporukaIds) da bi se
  // pri spremanju sve mogle označiti kao uključene u ovu otpremnicu.
  const grupirajIsporuke = () => {
    const poKljucu = new Map();
    dostupneIsporuke.forEach((i) => {
      const kljuc = `${i.grupa}:${i.stavkaId}`;
      const postojeci = poKljucu.get(kljuc);
      if (postojeci) {
        postojeci.isporukaIds.push(i.id);
        postojeci.dostupno += Number(i.komada) || 0;
        if (i.datum && (!postojeci.datumPlan || i.datum < postojeci.datumPlan)) postojeci.datumPlan = i.datum;
      } else {
        poKljucu.set(kljuc, { id: uid("ost"), isporukaIds: [i.id], naziv: nazivIsporuke(i), jm: "kom", datumPlan: i.datum, narucena: narucenoZaIsporuku(i), dostupno: Number(i.komada) || 0 });
      }
    });
    return Array.from(poKljucu.values());
  };
  const emptyForm = () => ({
    broj: sljedeciBrojOtpremnice(db.otpremnice, todayISO()), datum: todayISO(), mjesto: "Prelog",
    projektId: projekt.id, kupacId: projekt?.kupacId || "", narudzbaId: narudzba?.id || null, izdaoId: "", napomena: "",
    stavke: koristiNormativ
      ? grupirajIsporuke().map((s) => ({ ...s, kolicina: String(s.dostupno) }))
      : (narudzba?.stavke || []).map((s) => ({ id: uid("ost"), narudzbaStavkaId: s.id, naziv: s.naziv, jm: s.jm, narucena: s.kolicina, kolicina: "" })),
  });
  const [form, setForm] = useState(emptyForm());

  const azurirajKolicinu = (i, val) => setForm({ ...form, stavke: form.stavke.map((s, idx) => (idx === i ? { ...s, kolicina: val } : s)) });
  const azurirajOpis = (i, val) => setForm({ ...form, stavke: form.stavke.map((s, idx) => (idx === i ? { ...s, opis: val } : s)) });
  const [opisOtvoren, setOpisOtvoren] = useState({}); // { [stavkaId]: true } — red s dodatnim opisom stavke je otvoren

  const spremi = () => {
    const stavke = form.stavke.filter((s) => Number(s.kolicina) > 0).map((s) => ({ ...s, kolicina: Number(s.kolicina) }));
    if (stavke.length === 0) { showToast("Unesi količinu za barem jednu stavku."); return; }
    const novaOtpremnica = { ...form, id: uid("otp"), stavke };
    update("otpremnice", [...db.otpremnice, novaOtpremnica]);
    if (koristiNormativ) {
      const ukljucenIds = new Set(stavke.flatMap((s) => s.isporukaIds || []).filter(Boolean));
      if (ukljucenIds.size > 0) {
        patchProjekt(projekt.id, { isporuke: (projekt.isporuke || []).map((i) => (ukljucenIds.has(i.id) ? { ...i, uOtpremniciId: novaOtpremnica.id } : i)) });
      }
    }
    showToast("Otpremnica kreirana.");
    onClose();
  };

  return (
    <Modal wide title="Nova otpremnica" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi}>Kreiraj otpremnicu</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="Broj otpremnice"><input className="input f-mono" value={form.broj} disabled /></Field>
        <Field label="Datum"><input className="input" type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value, broj: sljedeciBrojOtpremnice(db.otpremnice, e.target.value) })} /></Field>
        <Field label="Mjesto"><input className="input" value={form.mjesto} onChange={(e) => setForm({ ...form, mjesto: e.target.value })} /></Field>
      </div>
      <Field label="Izdao (zaposlenik)">
        <select className="select" value={form.izdaoId} onChange={(e) => setForm({ ...form, izdaoId: e.target.value })}>
          <option value="">—</option>
          {[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
        </select>
      </Field>

      {form.stavke.length === 0 && (
        <EmptyState text={koristiNormativ
          ? "Nema kupaonica označenih kao spremne za otpremu. Označi ih u modulu Proizvodnja → Isporuke kupaonica ili u rasporedu isporuka u detaljima projekta."
          : "Narudžba kupca nema stavki — prvo dodaj stavke u narudžbu."} />
      )}
      {form.stavke.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 6, marginBottom: 6 }}>Stavke za isporuku (upiši količinu koja se sada šalje)</div>
          <table className="erp-table">
            <thead><tr><th>Naziv</th>{koristiNormativ && <th style={{ width: 110 }}>Planirano</th>}<th style={{ width: 80 }}>JM</th><th style={{ width: 90 }}>Naručeno</th><th style={{ width: 130 }}>Količina</th><th style={{ width: 110 }} title="Ukupna masa te stavke — koristi se za težinu na CMR-u (po želji)">Masa (kg)</th></tr></thead>
            <tbody>
              {form.stavke.map((s, i) => (
                <React.Fragment key={s.id}>
                  <tr>
                    <td>
                      {s.naziv}
                      <button
                        className="btn btn-icon btn-ghost" style={{ marginLeft: 6, verticalAlign: "middle" }}
                        title={s.opis ? "Uredi dodatni opis stavke" : "Dodaj dodatni opis stavke"}
                        onClick={() => setOpisOtvoren((o) => ({ ...o, [s.id]: !o[s.id] }))}
                      >
                        <FileText size={13} color={s.opis ? "var(--steel)" : "var(--ink-faint)"} />
                      </button>
                    </td>
                    {koristiNormativ && <td className="f-mono">{fmtDate(s.datumPlan) || "—"}</td>}
                    <td className="f-mono">{s.jm}</td>
                    <td className="f-mono">{s.narucena ?? "—"}</td>
                    <td><input className="input f-mono" type="number" min="0" max={koristiNormativ ? s.dostupno : undefined} style={{ padding: "5px 8px" }} value={s.kolicina} onChange={(e) => azurirajKolicinu(i, e.target.value)} /></td>
                    <td><input className="input f-mono" type="number" min="0" step="0.1" style={{ padding: "5px 8px" }} placeholder={(() => { const nst = narudzba?.stavke?.find((x) => x.id === s.narudzbaStavkaId); const auto = (Number(nst?.masaJed) || 0) * (Number(s.kolicina) || 0); return auto > 0 ? String(Math.round(auto * 10) / 10) : "—"; })()} value={s.masaKg ?? ""} onChange={(e) => setForm({ ...form, stavke: form.stavke.map((st, idx) => (idx === i ? { ...st, masaKg: e.target.value } : st)) })} /></td>
                  </tr>
                  {(opisOtvoren[s.id] || (s.opis && opisOtvoren[s.id] === undefined)) && (
                    <tr>
                      <td colSpan={koristiNormativ ? 6 : 5} style={{ background: "var(--surface-alt)", padding: "8px 10px" }}>
                        <label className="label" style={{ marginBottom: 4 }}>Dodatni opis stavke (vidljivo na otpremnici)</label>
                        <textarea
                          className="textarea" rows={2} style={{ width: "100%" }}
                          placeholder="npr. dimenzije, oznaka pozicije, napomena uz ovu stavku…"
                          value={s.opis || ""}
                          onChange={(e) => azurirajOpis(i, e.target.value)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

/* ============================== POTVRDA NARUDŽBE (AUFTRAGSBESTÄTIGUNG) ============================== */
// Potvrda se izrađuje iz narudžbe kupca (stavke, količine, cijene) i projekta (mjesto isporuke,
// kontakt) i sprema na samu narudžbu (narudzba.potvrda) — jedna potvrda po narudžbi, može se
// ponovno otvoriti, urediti i ispisati. Broj: 0GG-NN-AB (npr. 026-05-AB), redom unutar godine;
// nastavlja se i na zadnji broj izdan izvan aplikacije (postavke tvrtke → abZadnjiBroj).
const AB_NAPOMENE_ZADANO = `- Herstellung nach eingereichten Zeichnungen
- Material: Gemäß den mitgelieferten Zeichnungen und Stückliste
- Toleranzen lt. Zeichnungen
- inkl. Feuerverzinkung
- inkl. Transport. Der Auftraggeber muss die Mittel zum Entladen bereitstellen.
- Liefertermin: 4 Wochen nach Freigabe der Werkstattzeichnungen
- Zahlung: 14 Tage nach Lieferung`;
const AB_BROJ_RE = /^0(\d{2})-(\d+)-AB$/;
const sljedeciBrojPotvrde = (narudzbe, postavkeTvrtke, datum) => {
  const gg = (datum || todayISO()).slice(2, 4);
  const brojevi = [...(narudzbe || []).map((n) => n.potvrda?.broj), postavkeTvrtke?.abZadnjiBroj]
    .map((b) => AB_BROJ_RE.exec(String(b || "").trim()))
    .filter((m) => m && m[1] === gg)
    .map((m) => parseInt(m[2], 10));
  return `0${gg}-${String((brojevi.length ? Math.max(...brojevi) : 0) + 1).padStart(2, "0")}-AB`;
};

function PotvrdaNarudzbeModal({ narudzba, projekt, db, update, showToast, mojId, onClose }) {
  const t = db.postavkeTvrtke || {};
  const kupac = db.kupci.find((k) => k.id === (narudzba.kupacId || projekt.kupacId));
  const [form, setForm] = useState(() => ({
    broj: sljedeciBrojPotvrde(db.narudzbe, t, todayISO()),
    datum: todayISO(),
    kontakt: projekt.kontaktOsoba || kupac?.kontaktOsoba || "",
    titula: "herr",
    kontakt2: "",
    bv: String(projekt.mjestoIsporuke || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).join(", "),
    projektNr: narudzba.broj || "",
    napomene: AB_NAPOMENE_ZADANO,
    izradioId: mojId || "",
    ...(narudzba.potvrda || {}),
  }));
  const postavi = (polje, v) => setForm((f) => ({ ...f, [polje]: v }));
  const izradio = db.zaposlenici.find((z) => z.id === form.izradioId);
  const stavke = (narudzba.stavke || []).map((st, i) => {
    const kolicina = Number(String(st.kolicina ?? "").replace(",", ".")) || 0;
    const cijena = Number(st.cijena) || 0;
    return { ...st, rb: i + 1, kolicina, cijena, iznos: kolicina * cijena };
  });
  const ukupno = stavke.reduce((a, st) => a + st.iznos, 0);
  const prezime = String(form.kontakt || "").trim().split(/\s+/).pop();
  const pozdrav = !form.kontakt?.trim() ? "Sehr geehrte Damen und Herren," : form.titula === "frau" ? `Sehr geehrte Frau ${prezime},` : `Sehr geehrter Herr ${prezime},`;
  const adresaKupca = String(kupac?.adresa || "").split(/\s*\|\s*|\n+/).filter(Boolean);
  const zaposleni = [...db.zaposlenici].filter((z) => z.status === "Aktivan").sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr"));

  const spremi = () => {
    const broj = String(form.broj || "").trim();
    if (!broj) { showToast("Upiši broj potvrde."); return false; }
    if (db.narudzbe.some((n) => n.id !== narudzba.id && n.potvrda?.broj === broj)) { showToast(`Broj ${broj} je već iskorišten na drugoj potvrdi.`); return false; }
    update("narudzbe", db.narudzbe.map((n) => (n.id === narudzba.id ? { ...n, potvrda: { ...form, broj } } : n)));
    showToast(`Potvrda narudžbe ${broj} spremljena.`);
    return true;
  };
  const ispisi = () => { if (spremi()) setTimeout(() => ispisPdf(`Auftragsbestätigung_ ${String(form.broj).trim()}`), 50); };

  return (
    <Modal wide title={narudzba.potvrda ? `Potvrda narudžbe ${narudzba.potvrda.broj}` : "Nova potvrda narudžbe (Auftragsbestätigung)"} onClose={onClose}
      footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn icon={Save} onClick={spremi}>Spremi</Btn><Btn variant="primary" icon={Printer} onClick={ispisi}>Spremi i ispiši / PDF</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        <Field label="Broj potvrde"><input className="input f-mono" value={form.broj} onChange={(e) => postavi("broj", e.target.value)} /></Field>
        <Field label="Datum"><input className="input" type="date" value={form.datum} onChange={(e) => postavi("datum", e.target.value)} /></Field>
        <Field label="Potpisuje"><select className="select" value={form.izradioId} onChange={(e) => postavi("izradioId", e.target.value)}><option value="">—</option>{zaposleni.map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}</select></Field>
        <Field label="Kontakt kupca (z.Hd.)"><input className="input" value={form.kontakt} onChange={(e) => postavi("kontakt", e.target.value)} /></Field>
        <Field label="Oslovljavanje"><select className="select" value={form.titula} onChange={(e) => postavi("titula", e.target.value)}><option value="herr">Herr</option><option value="frau">Frau</option></select></Field>
        <Field label="Dodatno „Zu Hd.“ (nije obavezno)"><input className="input" placeholder="npr. Hr. Christian Ludwig" value={form.kontakt2} onChange={(e) => postavi("kontakt2", e.target.value)} /></Field>
        <Field label="BV (gradilište / mjesto isporuke)"><input className="input" value={form.bv} onChange={(e) => postavi("bv", e.target.value)} /></Field>
        <Field label="Projekt Nr. kupca"><input className="input f-mono" value={form.projektNr} onChange={(e) => postavi("projektNr", e.target.value)} /></Field>
        <div />
      </div>
      <Field label="Anmerkungen (napomene na potvrdi)"><textarea className="textarea" rows={7} value={form.napomene} onChange={(e) => postavi("napomene", e.target.value)} /></Field>
      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 12 }}>Stavke, količine i cijene dolaze iz narudžbe {narudzba.broj} — ako ih treba promijeniti, uredi narudžbu.</div>

      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 11 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <img src={logoEcon} alt="Econ" style={{ width: 190, display: "block", marginBottom: 28 }} />
            <div style={{ fontWeight: 700, fontSize: 15 }}>{kupac?.naziv || "—"}</div>
            {adresaKupca.map((r, i) => <div key={i} style={{ fontSize: 14 }}>{r}</div>)}
            {form.kontakt?.trim() && <div style={{ marginTop: 10, fontSize: 11 }}>z.Hd. {form.titula === "frau" ? "Frau" : "Herr"} {form.kontakt}</div>}
          </div>
          <div style={{ width: 210, fontSize: 9.5, lineHeight: 1.45 }}>
            <div style={{ fontSize: 9, color: "#555", marginBottom: 6 }}>{t.djelatnost}</div>
            <div style={{ fontWeight: 700 }}>{t.naziv}</div>
            <div>{t.adresa}</div>
            {t.telefon && <div>Tel. {t.telefon}</div>}
            {t.faks && <div>Fax {t.faks}</div>}
            {t.email && <div>{t.email}</div>}
            {t.podruznica && <div style={{ marginTop: 10, whiteSpace: "pre-line" }}>{t.podruznica}</div>}
            {t.web && <div style={{ marginTop: 6 }}>{t.web}</div>}
          </div>
        </div>

        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 10 }}>AUFTRAGSBESTÄTIGUNG: <span className="f-mono">{form.broj}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 16 }}>
          <div style={{ lineHeight: 1.6 }}>
            {form.kontakt2?.trim() && <div style={{ fontWeight: 600 }}>Zu Hd. {form.kontakt2}</div>}
            {form.bv?.trim() && <div>BV: {form.bv}</div>}
            {form.projektNr?.trim() && <div>Projekt Nr.: {form.projektNr}</div>}
          </div>
          <div style={{ whiteSpace: "nowrap" }}>Datum: {form.datum ? `${form.datum.slice(8, 10)}.${form.datum.slice(5, 7)}.${form.datum.slice(0, 4)}` : "—"}</div>
        </div>

        <div style={{ marginBottom: 6 }}>{pozdrav}</div>
        <div style={{ marginBottom: 14 }}>vielen Dank für Ihre Bestellung. Gemäß unserem Angebot erbringen wir folgende Leistungen:</div>

        <table className="doc-table" style={{ marginBottom: 6 }}>
          <thead><tr><th style={{ width: 38 }}>Pos</th><th>Bezeichnung / Werkstoff / Norm</th><th style={{ width: 80, textAlign: "right" }}>Menge</th><th style={{ width: 100, textAlign: "right" }}>EP</th><th style={{ width: 100, textAlign: "right" }}>GP</th></tr></thead>
          <tbody>
            {stavke.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "#777" }}>Narudžba nema stavki.</td></tr>}
            {stavke.map((st) => (
              <tr key={st.id || st.rb}>
                <td>{st.rb}.</td>
                <td>{st.naziv}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{st.kolicina.toLocaleString("de-DE")} {st.jm}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtCurDec(st.cijena)}{st.jm ? `/${st.jm}` : ""}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtCurDec(st.iznos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 24, fontWeight: 700, fontSize: 12, marginBottom: 2 }}><span>Gesamtsumme:</span><span style={{ minWidth: 100, textAlign: "right" }}>{fmtCurDec(ukupno)}</span></div>
        <div style={{ textAlign: "right", fontSize: 9.5, color: "#555", marginBottom: 18 }}>Preisstellung exkl. MwSt.</div>

        {form.napomene?.trim() && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>ANMERKUNGEN:</div>
            <div style={{ whiteSpace: "pre-line", lineHeight: 1.6, paddingLeft: 24 }}>{form.napomene}</div>
          </div>
        )}

        <div style={{ marginBottom: 24, lineHeight: 1.5 }}>
          <div>Mit freundlichen Grüßen</div>
          <div style={{ marginTop: 10, fontWeight: 700 }}>{t.naziv}</div>
          {izradio && (
            <>
              <div>{izradio.ime} {izradio.prezime}</div>
              {izradio.telefon && <div style={{ fontSize: 10 }}>Mobil: {izradio.telefon}</div>}
              {izradio.email && <div style={{ fontSize: 10 }}>e-Mail: {izradio.email}</div>}
            </>
          )}
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>Žiro račun:</strong> {t.ziroRacun}<br />
          <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Temeljni kapital:</strong> {t.temeljniKapital} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

function OtpremnicaPrintModal({ otpremnica, db, onClose }) {
  const t = db.postavkeTvrtke || {};
  const projekt = db.projekti.find((p) => p.id === otpremnica.projektId);
  const izdao = db.zaposlenici.find((z) => z.id === otpremnica.izdaoId);
  const jeKooperant = otpremnica.vrsta === "kooperant";
  // Kupčeva otpremnica ide uz narudžbu; kooperantska (dorada) uz dobavljača kojem se šalje na
  // doradu (plastifikacija i sl.) — različit kontekst, isti dokument/ispis.
  const kupac = db.kupci.find((k) => k.id === otpremnica.kupacId);
  const narudzba = db.narudzbe.find((n) => n.id === otpremnica.narudzbaId);
  const dobavljac = db.dobavljaci.find((d) => d.id === otpremnica.dobavljacId);
  const PRAZNI_REDOVI = Math.max(0, 20 - otpremnica.stavke.length);
  return (
    <Modal wide title={`Pregled za ispis — Otpremnica ${otpremnica.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => ispisPdf(otpremnica.broj)}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div style={{ maxWidth: 250 }}>
            <img src={logoEcon} alt="Econ" style={{ width: 190, display: "block", marginBottom: 4 }} />
            <div style={{ fontSize: 9, color: "#555", lineHeight: 1.3 }}>Projektiranje, izrada i montaža metalnih<br />konstrukcija i ventiliranih fasada</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 20, whiteSpace: "nowrap" }}>OTPREMNICA / <span style={{ fontStyle: "italic" }}>LIEFERSCHEIN</span> :&nbsp;<span className="f-mono">{otpremnica.broj}</span></div>
            <table style={{ fontSize: 11.5, marginTop: 10, marginLeft: "auto", borderCollapse: "collapse" }}>
              <tbody>
                <tr><td style={{ paddingRight: 10, color: "#555", textAlign: "right" }}>Datum :</td><td style={{ fontWeight: 600, textAlign: "left" }}>{fmtDate(otpremnica.datum)}</td></tr>
                <tr><td style={{ paddingRight: 10, color: "#555", textAlign: "right" }}>Mjesto / Ort :</td><td style={{ fontWeight: 600, textAlign: "left" }}>{otpremnica.mjesto}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ fontSize: 9.5, color: "#333", lineHeight: 1.6, marginBottom: 18, borderTop: "1px solid #ddd", borderBottom: "1px solid #ddd", padding: "8px 0" }}>
          {t.adresa} &nbsp;·&nbsp; {t.telefon} &nbsp;·&nbsp; {t.email}
        </div>

        <table style={{ fontSize: 11.5, marginBottom: 18, borderCollapse: "collapse" }}>
          <tbody>
            {jeKooperant ? (
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Primatelj / Empfänger :</td><td style={{ fontWeight: 600 }}>{dobavljac?.naziv || "—"}</td></tr>
            ) : (
              <>
                <tr><td style={{ paddingRight: 10, color: "#555" }}>Kupac / Kunde :</td><td style={{ fontWeight: 600 }}>{kupac?.naziv || "—"}</td></tr>
                <tr><td style={{ paddingRight: 10, color: "#555" }}>Narudžba / Bestellung :</td><td style={{ fontWeight: 600 }}>{narudzba?.broj || "—"}</td></tr>
              </>
            )}
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Projekt :</td><td style={{ fontWeight: 600 }}>{projekt?.sifra}{projekt?.naziv ? ` — ${projekt.naziv}` : ""}</td></tr>
            {otpremnica.napomena && <tr><td style={{ paddingRight: 10, color: "#555" }}>Napomena :</td><td>{otpremnica.napomena}</td></tr>}
          </tbody>
        </table>

        <table className="doc-table" style={{ marginBottom: 20 }}>
          <thead>
            <tr style={{ background: "var(--steel)" }}>
              <th style={{ width: 50, background: "var(--steel)", color: "#fff" }}>Red.br. / RmNr</th>
              <th style={{ background: "var(--steel)", color: "#fff" }}>Naziv / Name</th>
              <th style={{ width: 90, background: "var(--steel)", color: "#fff" }}>Jed. Mjere / Maße</th>
              <th style={{ width: 80, background: "var(--steel)", color: "#fff" }}>Količina / Menge</th>
            </tr>
          </thead>
          <tbody>
            {otpremnica.stavke.map((s, i) => (
              <tr key={s.id || i}>
                <td>{i + 1}.</td><td>{s.naziv}{s.opis && <div style={{ fontSize: 9.5, color: "#555", marginTop: 2, whiteSpace: "pre-line" }}>{s.opis}</div>}</td><td>{s.jm}</td><td className="f-mono">{s.kolicina}</td>
              </tr>
            ))}
            {Array.from({ length: PRAZNI_REDOVI }).map((_, i) => (
              <tr key={`prazno-${i}`}><td>{otpremnica.stavke.length + i + 1}.</td><td>&nbsp;</td><td></td><td></td></tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 30, marginBottom: 16, fontSize: 10.5 }}>
          <div style={{ textAlign: "center", width: "30%" }}><div style={{ borderTop: "1px solid #333", paddingTop: 4 }}>Izdao / Ausgestellt von {izdao ? `— ${izdao.prezime} ${izdao.ime}` : ""}</div></div>
          <div style={{ textAlign: "center", width: "30%" }}><div style={{ borderTop: "1px solid #333", paddingTop: 4 }}>Otpremio / Versendet von</div></div>
          <div style={{ textAlign: "center", width: "30%" }}><div style={{ borderTop: "1px solid #333", paddingTop: 4 }}>Zaprimio / Empfangen von</div></div>
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>Žiro račun:</strong> {t.ziroRacun}<br />
          <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Temeljni kapital:</strong> {t.temeljniKapital} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

function OtpremniceListModal({ projekt, narudzba, db, update, patchProjekt, showToast, onClose }) {
  const kupac = db.kupci.find((k) => k.id === projekt?.kupacId);
  const otpremnice = db.otpremnice.filter((o) => o.projektId === projekt.id).sort((a, b) => b.datum.localeCompare(a.datum));
  const [otpModal, setOtpModal] = useState(false);
  const [printOtp, setPrintOtp] = useState(null);
  const [delOtp, setDelOtp] = useState(null);
  const koristiNormativ = !!projekt.koristiNormativ;
  const spremneZaOtpremu = koristiNormativ ? (projekt.isporuke || []).filter((i) => i.isporuceno && !i.uOtpremniciId).length : 0;
  const nemaStavki = koristiNormativ ? spremneZaOtpremu === 0 : !narudzba;

  return (
    <>
      <Modal wide title={`Otpremnice — ${projekt.sifra}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Plus} onClick={() => setOtpModal(true)} disabled={nemaStavki}>Nova otpremnica</Btn></>}>
        {!koristiNormativ && !narudzba && <div style={{ fontSize: 12.5, color: "var(--rust)", marginBottom: 12 }}>Ovaj projekt nema unesenu narudžbu kupca — prvo je unesi (gumb "Narudžba" u detaljima projekta).</div>}
        {koristiNormativ && spremneZaOtpremu === 0 && <div style={{ fontSize: 12.5, color: "var(--rust)", marginBottom: 12 }}>Nema kupaonica označenih kao spremne za otpremu u rasporedu isporuka.</div>}
        {otpremnice.length === 0 ? <EmptyState text="Nema izdanih otpremnica." /> : (
          <table className="erp-table">
            <thead><tr><th>Broj</th><th>Datum</th><th>Stavki</th><th></th></tr></thead>
            <tbody>
              {otpremnice.map((o) => (
                <tr key={o.id}>
                  <td className="f-mono">{o.broj}</td>
                  <td>{fmtDate(o.datum)}</td>
                  <td className="f-mono">{o.stavke.length}</td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <Btn size="sm" icon={Eye} onClick={() => setPrintOtp(o)}>PDF</Btn>
                    <button className="btn btn-icon btn-ghost" onClick={() => setDelOtp(o)}><Trash2 size={14} color="var(--rust)" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      {otpModal && <OtpremnicaFormModal narudzba={narudzba} projekt={projekt} db={db} update={update} patchProjekt={patchProjekt} showToast={showToast} onClose={() => setOtpModal(false)} />}
      {printOtp && <OtpremnicaPrintModal otpremnica={printOtp} db={db} onClose={() => setPrintOtp(null)} />}
      {delOtp && <ConfirmDelete label={delOtp.broj} onCancel={() => setDelOtp(null)} onConfirm={() => {
        update("otpremnice", db.otpremnice.filter((o) => o.id !== delOtp.id));
        if (koristiNormativ) patchProjekt(projekt.id, { isporuke: (projekt.isporuke || []).map((i) => (i.uOtpremniciId === delOtp.id ? { ...i, uOtpremniciId: null } : i)) });
        setDelOtp(null);
        showToast("Otpremnica obrisana.");
      }} />}
    </>
  );
}

// Presjek rasporeda isporuka SVIH tipskih projekata (kupaonice po normativu), po datumima —
// čita/piše isti projekt.isporuke niz kao "Raspored isporuka" u detaljima projekta, pa je
// kvačica "Spremno za otpremu" uvijek ista na oba mjesta (nema odvojene kopije podataka).
// Kad je isporuka već uključena u otpremnicu (uOtpremniciId), kvačica se zaključava — status
// se tada mijenja samo brisanjem/izmjenom te otpremnice, ne ovdje.
function IsporukeKupaonicaView({ db, patchProjekt, mozeMijenjati = true }) {
  const redovi = [];
  db.projekti.forEach((p) => {
    if (!p.koristiNormativ) return;
    const stavkePod = p.stavkePod || [];
    const stavkeKomplet = p.stavkeKomplet || [];
    (p.isporuke || []).forEach((i) => {
      const stavka = (i.grupa === "stavkePod" ? stavkePod : stavkeKomplet).find((s) => s.id === i.stavkaId);
      redovi.push({ projekt: p, isporuka: i, stavka });
    });
  });
  redovi.sort((a, b) => (a.isporuka.datum || "9999").localeCompare(b.isporuka.datum || "9999"));

  const azurirajIsporuku = (projektId, isporukaId, patch) => {
    const projekt = db.projekti.find((p) => p.id === projektId);
    if (!projekt) return;
    patchProjekt(projektId, { isporuke: (projekt.isporuke || []).map((i) => (i.id === isporukaId ? { ...i, ...patch } : i)) });
  };

  return (
    <div>
      {redovi.length === 0 ? (
        <EmptyState text="Nema unesenih isporuka na tipskim projektima (kupaonicama). Raspored isporuka uređuje se u detaljima projekta." />
      ) : (
        <table className="erp-table">
          <thead><tr><th>Projekt</th><th>Tip</th><th style={{ width: 90 }}>Grupa</th><th style={{ width: 70 }}>Komada</th><th style={{ width: 130 }}>Datum</th><th style={{ width: 130 }}>Spremno za otpremu</th><th></th></tr></thead>
          <tbody>
            {redovi.map(({ projekt, isporuka: i, stavka }) => {
              const kasni = i.datum && !i.isporuceno && i.datum < todayISO();
              const otpremnica = i.uOtpremniciId ? db.otpremnice.find((o) => o.id === i.uOtpremniciId) : null;
              return (
                <tr key={i.id}>
                  <td>{projekt.sifra} — {projekt.naziv}</td>
                  <td>{stavka?.oznaka || "(bez oznake)"}</td>
                  <td>{i.grupa === "stavkePod" ? "Pod" : "Stranica"}</td>
                  <td className="f-mono">{i.komada}</td>
                  <td>{fmtDate(i.datum) || "—"}</td>
                  <td>
                    <input type="checkbox" checked={!!i.isporuceno} disabled={!!i.uOtpremniciId || !mozeMijenjati} title={otpremnica ? `Uključeno u otpremnicu ${otpremnica.broj} — status se mijenja preko te otpremnice` : ""} onChange={(e) => azurirajIsporuku(projekt.id, i.id, { isporuceno: e.target.checked })} />
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {otpremnica ? <span style={{ color: "var(--ink-soft)" }}>U otpremnici {otpremnica.broj}</span> : kasni ? <span style={{ color: "var(--rust)", fontWeight: 600 }}>Kasni</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProizvodnjaPage({ db, update, patchProjekt, showToast, mojaPozicija, otvoriProjekt }) {
  const dozvKartice = dozvoljeneKarticeModula(mojaPozicija, "proizvodnja");
  const [prikaz, setPrikaz] = useState(dozvKartice[0]?.key || "tablica");
  useEffect(() => { if (!dozvKartice.some((k) => k.key === prikaz)) setPrikaz(dozvKartice[0]?.key || "tablica"); }, [dozvKartice, prikaz]);
  const mozeTablica = dozvolaZaKarticu(mojaPozicija, "proizvodnja", "tablica").izmjene;
  const mozeIzdatnice = dozvolaZaKarticu(mojaPozicija, "skladiste", "izdatnice").izmjene;
  const mozeIsporuke = dozvolaZaKarticu(mojaPozicija, "proizvodnja", "isporuke").izmjene;
  const mozePlan = dozvolaZaKarticu(mojaPozicija, "proizvodnja", "gantogram").izmjene;
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [izdatnicaModal, setIzdatnicaModal] = useState(false);
  const [printIzdatnica, setPrintIzdatnica] = useState(null);
  const emptyForm = () => {
    const projekt = db.projekti[0];
    const preostalo = preostaloSatiFaze(projekt, FAZE[0], db.radniNalozi, null);
    return { id: null, broj: projekt ? sljedeciBrojRadnogNaloga(db.radniNalozi, projekt.sifra) : "", projektId: projekt?.id || "", naziv: projekt?.naziv || "", faza: FAZE[0], zaduzenTim: "", status: "Planiran", planiranoSati: preostalo != null ? preostalo : 0, utrosenoSati: 0, datumPocetka: todayISO(), datumZavrsetka: todayISO(), stavke: [], materijalIzdan: false, ovisiONalogId: null, ovisnostTip: "zavrsetak", ovisnostSati: 8 };
  };
  const [form, setForm] = useState(emptyForm());

  const openAdd = () => { setForm(emptyForm()); setModal("edit"); };
  const openEdit = (row) => { setForm(JSON.parse(JSON.stringify(row))); setModal("edit"); };
  const save = () => {
    // Naziv radnog naloga uvijek prati naziv projekta — ne postoji zaseban slobodan unos.
    const naziv = db.projekti.find((p) => p.id === form.projektId)?.naziv || form.naziv;
    // Utrošeno sati se ne uzima iz forme — uvijek se preračuna iz stvarnog zbroja dnevnih unosa
    // (Sati po nalozima), da polje ne može ostati zastarjelo ili ručno izmijenjeno.
    const payload = { ...form, naziv, planiranoSati: Number(form.planiranoSati), utrosenoSati: zbrojSatiZaNalog(form.id, db.satiPoNalogu), ovisnostSati: Number(form.ovisnostSati) || 0 };
    if (form.id) update("radniNalozi", db.radniNalozi.map((r) => (r.id === form.id ? payload : r)));
    else update("radniNalozi", [...db.radniNalozi, { ...payload, id: uid("rn") }]);
    setModal(null);
    showToast("Radni nalog spremljen.");
  };
  const izdaj = (row) => {
    let materijali = [...db.materijali];
    row.stavke.forEach((s) => {
      const mat = materijali.find((m) => m.id === s.materijalId);
      materijali = materijali.map((m) => (m.id === s.materijalId ? { ...m, kolicina: Math.max(0, m.kolicina - efektivnaKolicinaMaterijala(s, mat)) } : m));
    });
    update("materijali", materijali);
    update("radniNalozi", db.radniNalozi.map((r) => (r.id === row.id ? { ...r, materijalIzdan: true } : r)));
    showToast("Materijal izdan, skladište ažurirano.");
  };
  const projNaziv = (id) => db.projekti.find((p) => p.id === id)?.naziv || "—";
  const promijeniStatus = (row, noviStatus) => update("radniNalozi", db.radniNalozi.map((r) => (r.id === row.id ? { ...r, status: noviStatus } : r)));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <PageHeader title="Proizvodnja" icon={Factory} subtitle="Radni nalozi po fazama izrade i montaže" />
        {mozeIzdatnice && !jeOperaterLasera(mojaPozicija) && <Btn variant="ghost" icon={PackageMinus} onClick={() => setIzdatnicaModal(true)}>Izdaj na projekt</Btn>}
      </div>
      {izdatnicaModal && <IzdatnicaModal db={db} update={update} showToast={showToast} onClose={() => setIzdatnicaModal(false)} onCreated={(nova) => { setIzdatnicaModal(false); setPrintIzdatnica(nova); }} />}
      {printIzdatnica && <IzdatnicaPrintModal izdatnica={printIzdatnica} projekt={db.projekti.find((p) => p.id === printIzdatnica.projektId)} izdao={db.zaposlenici.find((z) => z.id === printIzdatnica.izdaoId)} postavkeTvrtke={db.postavkeTvrtke} onClose={() => setPrintIzdatnica(null)} />}
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        {dozvKartice.some((k) => k.key === "tablica") && <div className={`nav-tab ${prikaz === "tablica" ? "active" : ""}`} onClick={() => setPrikaz("tablica")}>Tablica</div>}
        {dozvKartice.some((k) => k.key === "gantogram") && <div className={`nav-tab ${prikaz === "gantogram" ? "active" : ""}`} onClick={() => setPrikaz("gantogram")}><CalendarRange size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Plan proizvodnje</div>}
        {dozvKartice.some((k) => k.key === "rezanje") && <div className={`nav-tab ${prikaz === "rezanje" ? "active" : ""}`} onClick={() => setPrikaz("rezanje")}>Plan rezanja</div>}
        {dozvKartice.some((k) => k.key === "isporuke") && <div className={`nav-tab ${prikaz === "isporuke" ? "active" : ""}`} onClick={() => setPrikaz("isporuke")}><PackageCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Isporuke kupaonica</div>}
      </div>

      {prikaz === "gantogram" && <PlanProizvodnjeView db={db} update={update} patchProjekt={patchProjekt} showToast={showToast} mozeMijenjati={mozePlan} otvoriProjekt={otvoriProjekt} />}
      {prikaz === "rezanje" && <PlanRezanjaView db={db} update={update} showToast={showToast} mojaPozicija={mojaPozicija} />}
      {prikaz === "isporuke" && <IsporukeKupaonicaView db={db} patchProjekt={patchProjekt} mozeMijenjati={mozeIsporuke} />}

      {prikaz === "tablica" && (
      <EntityPage
        title="" data={db.radniNalozi.filter((r) => r.status !== "Završen").sort((a, b) => usporediPrirodno(a.broj, b.broj))} onAdd={openAdd} onEdit={openEdit} onDelete={(r) => setDel(r)}
        addLabel="Novi radni nalog" searchKeys={["broj", "naziv", "zaduzenTim"]} readOnly={!mozeTablica}
        columns={[
          { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
          { key: "projekt", label: "Projekt", render: (r) => projNaziv(r.projektId) },
          { key: "faza", label: "Faza" },
          { key: "zaduzenTim", label: "Tim" },
          { key: "sati", label: "Sati (utr./plan.)", render: (r) => <span className="f-mono">{r.utrosenoSati} / {r.planiranoSati}</span> },
          {
            key: "status", label: "Status", render: (r) => mozeTablica ? (
              <select className="select" style={{ fontSize: 12, padding: "4px 8px", width: 130 }} value={r.status} onClick={(e) => e.stopPropagation()} onChange={(e) => promijeniStatus(r, e.target.value)}>
                {["Planiran", "U tijeku", "Pauziran", "Završen"].map((s) => <option key={s}>{s}</option>)}
              </select>
            ) : <Badge status={r.status} />
          },
          { key: "materijal", label: "", render: (r) => r.stavke.length > 0 && !r.materijalIzdan ? <Btn size="sm" icon={PackageMinus} onClick={() => izdaj(r)}>Izdaj materijal</Btn> : (r.materijalIzdan ? <span style={{ fontSize: 11, color: "var(--green)" }}>Materijal izdan ✓</span> : null) },
        ]}
      />
      )}

      {modal && (() => {
        const trenutniProjekt = db.projekti.find((p) => p.id === form.projektId);
        const preostaloFaze = preostaloSatiFaze(trenutniProjekt, form.faza, db.radniNalozi, form.id);
        return (
        <Modal wide title={form.id ? `Radni nalog ${form.broj}` : "Novi radni nalog"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={save}>Spremi</Btn></>}>
          <Field label="Projekt">
            <select className="select" value={form.projektId} onChange={(e) => {
              const noviProjekt = db.projekti.find((p) => p.id === e.target.value);
              const preostalo = preostaloSatiFaze(noviProjekt, form.faza, db.radniNalozi, form.id);
              setForm({ ...form, projektId: e.target.value, naziv: noviProjekt?.naziv || form.naziv, broj: !form.id && noviProjekt ? sljedeciBrojRadnogNaloga(db.radniNalozi, noviProjekt.sifra) : form.broj, planiranoSati: preostalo != null ? preostalo : form.planiranoSati });
            }}>{db.projekti.map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}</select>
          </Field>
          <Field label="Naziv radnog naloga (uvijek jednak nazivu projekta)"><input className="input" value={trenutniProjekt?.naziv || form.naziv} disabled /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Faza proizvodnje">
              <select className="select" value={form.faza} onChange={(e) => {
                const novaFaza = e.target.value;
                const preostalo = preostaloSatiFaze(trenutniProjekt, novaFaza, db.radniNalozi, form.id);
                setForm({ ...form, faza: novaFaza, planiranoSati: preostalo != null ? preostalo : form.planiranoSati });
              }}>{FAZE.map((f) => <option key={f}>{f}</option>)}</select>
            </Field>
            <Field label="Zadužen tim"><input className="input" value={form.zaduzenTim} onChange={(e) => setForm({ ...form, zaduzenTim: e.target.value })} /></Field>
            <Field label="Status"><select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["Planiran", "U tijeku", "Pauziran", "Završen"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Planirano sati">
              <input className="input f-mono" type="number" value={form.planiranoSati} onChange={(e) => setForm({ ...form, planiranoSati: e.target.value })} />
              {preostaloFaze != null && <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 4 }}>Planirano na projektu: {trenutniProjekt.faze[form.faza]} h · Preostalo (neraspoređeno): {preostaloFaze} h</div>}
            </Field>
            <Field label="Utrošeno sati">
              <input className="input f-mono" value={`${zbrojSatiZaNalog(form.id, db.satiPoNalogu)} (izvedeno)`} disabled style={{ opacity: 0.7 }} />
              <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 4 }}>Izračunato iz dnevnih unosa u "Sati po nalozima" — nije moguće ručno urediti.</div>
            </Field>
            <Field label="Ovisi o nalogu (opcionalno)">
              {/* Samo nalozi ISTOG projekta, i to za faze koje na projektu uopće imaju planirane
                  sate — ovisnost o tuđem projektu ili o fazi bez planiranih sati nema smisla. */}
              <select className="select" value={form.ovisiONalogId || ""} onChange={(e) => setForm({ ...form, ovisiONalogId: e.target.value || null })}>
                <option value="">— Bez ovisnosti —</option>
                {db.radniNalozi.filter((r) => r.id !== form.id && r.projektId === form.projektId && Number(trenutniProjekt?.faze?.[r.faza]) > 0).map((r) => <option key={r.id} value={r.id}>{r.broj} — {r.faza}</option>)}
              </select>
            </Field>
            {form.ovisiONalogId && (
              <Field label="Kad može početi">
                <select className="select" value={form.ovisnostTip || "zavrsetak"} onChange={(e) => setForm({ ...form, ovisnostTip: e.target.value })}>
                  <option value="paralelno">Paralelno (isti početak kao nalog o kojem ovisi)</option>
                  <option value="zavrsetak">Po završetku (sljedeći radni dan)</option>
                  <option value="odmak">S vremenskim odmakom (sati nakon početka)</option>
                </select>
              </Field>
            )}
            {form.ovisiONalogId && form.ovisnostTip === "odmak" && (
              <Field label="Odmak (sati nakon početka)"><input className="input f-mono" type="number" min="0" step="1" value={form.ovisnostSati ?? 8} onChange={(e) => setForm({ ...form, ovisnostSati: e.target.value })} /></Field>
            )}
            <Field label="Datum početka"><input className="input" type="date" value={form.datumPocetka} onChange={(e) => setForm({ ...form, datumPocetka: e.target.value })} /></Field>
            <Field label="Datum završetka"><input className="input" type="date" value={form.datumZavrsetka} onChange={(e) => setForm({ ...form, datumZavrsetka: e.target.value })} /></Field>
          </div>
          <Field label="Potreban materijal (skladište)">
            <LineItemsEditor mode="materijal" rows={form.stavke} setRows={(rows) => setForm({ ...form, stavke: rows })} materijali={db.materijali} katalog={db.katalogProfila} narudzbenice={db.narudzbenice} />
          </Field>
        </Modal>
        );
      })()}
      {del && <ConfirmDelete label={del.broj} onCancel={() => setDel(null)} onConfirm={() => { update("radniNalozi", db.radniNalozi.filter((r) => r.id !== del.id)); setDel(null); showToast("Radni nalog obrisan."); }} />}
    </div>
  );
}

/* ============================== POZICIJE PONUDE (kalkulacija sati po operaciji) ============================== */
// Pozicija (npr. "P1 — nosač") sastoji se od više stavki materijala (profili i/ili limovi) — svaka
// stavka ima svoj način unosa mase, a limovi (kataloške stavke s jedinicom kg/m²) unose se preko
// širine i dužine (mm) iz kojih se površina i masa računaju automatski.
function StavkaPozicijeRedak({ stavka: s, katalog, grupe, kvalitete, onAzuriraj, onObrisi }) {
  const nacinMase = s.nacinMase || "rucno";
  const katEntry = katalog.find((k) => k.id === s.katalogId);
  const jeLim = katEntry?.jedinica === "kg/m2";
  const masaJedEfektivna = masaStavkePozicije(s, katalog, kvalitete);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: "8px 0", borderBottom: "1px dashed var(--line)" }}>
      <div style={{ width: 130 }}>
        <label className="label">Način unosa mase</label>
        <select className="select" value={nacinMase} onChange={(e) => onAzuriraj({ nacinMase: e.target.value })}>
          <option value="rucno">Ručni unos</option>
          <option value="katalog">Iz kataloga profila</option>
        </select>
      </div>
      {nacinMase === "katalog" ? (
        <>
          <div style={{ flex: "1 1 200px" }}>
            <label className="label">Profil / lim</label>
            <select className="select" value={s.katalogId} onChange={(e) => onAzuriraj({ katalogId: e.target.value })}>
              <option value="">Odaberi iz kataloga…</option>
              {grupe.map((g) => (
                <optgroup key={g.tip} label={g.tip}>
                  {g.stavke.map((k) => <option key={k.id} value={k.id}>{k.oznaka} ({k.vrijednost} {k.jedinica})</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          {jeLim ? (
            <>
              <div style={{ width: 100 }}>
                <label className="label">Širina (mm)</label>
                <input className="input f-mono" type="number" min="0" step="1" value={s.sirinaMM || 0} onChange={(e) => onAzuriraj({ sirinaMM: e.target.value })} />
              </div>
              <div style={{ width: 100 }}>
                <label className="label">Dužina (mm)</label>
                <input className="input f-mono" type="number" min="0" step="1" value={s.duzinaMM || 0} onChange={(e) => onAzuriraj({ duzinaMM: e.target.value })} />
              </div>
            </>
          ) : (
            <div style={{ width: 120 }}>
              <label className="label">Dužina/kom (mm)</label>
              <input className="input f-mono" type="number" min="0" step="1" value={Math.round((Number(s.dimenzija) || 0) * 1000)} onChange={(e) => onAzuriraj({ dimenzija: (Number(e.target.value) || 0) / 1000 })} />
            </div>
          )}
          <div style={{ width: 160 }}>
            <label className="label">Kvaliteta materijala</label>
            <select className="select" value={s.kvaliteta || "celik"} onChange={(e) => onAzuriraj({ kvaliteta: e.target.value })}>
              {(kvalitete && kvalitete.length ? kvalitete : ZADANE_KVALITETE_MATERIJALA).map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}
            </select>
          </div>
        </>
      ) : (
        <div style={{ width: 120 }}>
          <label className="label">Masa/kom (kg)</label>
          <input className="input f-mono" type="number" min="0" value={s.masaJed} onChange={(e) => onAzuriraj({ masaJed: e.target.value })} />
        </div>
      )}
      <div style={{ width: 80 }}>
        <label className="label">Komada</label>
        <input className="input f-mono" type="number" min="0" step="1" value={s.komada ?? 1} onChange={(e) => onAzuriraj({ komada: e.target.value })} />
      </div>
      <div style={{ width: 110 }}>
        <label className="label">Masa/kom</label>
        <div className="input f-mono" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{masaJedEfektivna.toFixed(2)} kg</div>
      </div>
      <div style={{ width: 110 }}>
        <label className="label">Cijena (€/kg)</label>
        <input className="input f-mono" type="number" min="0" step="0.01" value={s.cijenaKg ?? 0} onChange={(e) => onAzuriraj({ cijenaKg: e.target.value })} />
      </div>
      <div style={{ width: 120 }}>
        <label className="label">Trošak</label>
        <div className="input f-mono" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{fmtCurDec(masaJedEfektivna * (Number(s.komada) || 1) * (Number(s.cijenaKg) || 0))}</div>
      </div>
      <button className="btn btn-icon btn-ghost" onClick={onObrisi}><Trash2 size={14} color="var(--rust)" /></button>
    </div>
  );
}

function PozicijeEditor({ pozicije = [], setPozicije, cjenikRada, katalog = [], kvalitete = [], satnicaMontaza = 0, calc, azurirajOtpadLima, materijaliSkladiste, narudzbenice, napomenaNjemacki, setNapomenaNjemacki }) {
  const [otvorene, setOtvorene] = useState(() => Object.fromEntries(pozicije.map((p) => [p.id, true])));
  const toggle = (id) => setOtvorene((o) => ({ ...o, [id]: !o[id] }));
  const grupe = katalogPoTipu(katalog);
  // Kartice — jedna po stavci + fiksne "Materijal" (optimizacija sirovog materijala za cijelu
  // ponudu) i "Rekapitulacija" na kraju — umjesto starog pristupa gdje su SVE stavke bile
  // prikazane odjednom, jedna ispod druge (kod više stavki modal je postajao jako dugačak za
  // skrolanje). Aktivna je uvijek samo jedna kartica.
  const [aktivnaKartica, setAktivnaKartica] = useState(pozicije[0]?.id || "materijal");
  const [opisOtvoren, setOpisOtvoren] = useState({}); // { [pozicijaId]: true } — red s opisom otvoren u Rekapitulaciji

  const praznaStavka = () => ({ id: uid("pst"), nacinMase: "rucno", masaJed: 0, komada: 1, katalogId: "", dimenzija: 0, sirinaMM: 0, duzinaMM: 0, kvaliteta: "celik", cijenaKg: 0 });
  const praznaAkzStavka = () => ({ id: uid("akz"), tip: AKZ_TIPOVI[0].key, cijenaKg: 0 });
  const addPoz = () => {
    const id = uid("poz");
    setPozicije([...pozicije, { id, oznaka: `P${pozicije.length + 1}`, naziv: "", kolicina: 1, stavke: [praznaStavka()], operacije: praznaOperacijaSati(), brojMontera: 0, planiraniSatiMontaza: 0, stavkeAKZ: [], materijalStavke: [], ostaleStavke: [] }]);
    setOtvorene((o) => ({ ...o, [id]: true }));
    setAktivnaKartica(id);
  };
  const updatePoz = (id, patch) => setPozicije(pozicije.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const updateOp = (id, key, val) => setPozicije(pozicije.map((p) => (p.id === id ? { ...p, operacije: { ...p.operacije, [key]: val } } : p)));
  const removePoz = (id) => {
    setPozicije(pozicije.filter((p) => p.id !== id));
    if (aktivnaKartica === id) {
      const preostale = pozicije.filter((p) => p.id !== id);
      setAktivnaKartica(preostale[0]?.id || "materijal");
    }
  };

  const addStavka = (pozId) => updatePoz(pozId, { stavke: [...((pozicije.find((p) => p.id === pozId) || {}).stavke || []), praznaStavka()] });
  const updateStavka = (pozId, stavkaId, patch) => {
    const poz = pozicije.find((p) => p.id === pozId);
    updatePoz(pozId, { stavke: (poz.stavke || []).map((s) => (s.id === stavkaId ? { ...s, ...patch } : s)) });
  };
  const removeStavka = (pozId, stavkaId) => {
    const poz = pozicije.find((p) => p.id === pozId);
    updatePoz(pozId, { stavke: (poz.stavke || []).filter((s) => s.id !== stavkaId) });
  };

  const addAkz = (pozId) => updatePoz(pozId, { stavkeAKZ: [...((pozicije.find((p) => p.id === pozId) || {}).stavkeAKZ || []), praznaAkzStavka()] });
  const updateAkz = (pozId, akzId, patch) => {
    const poz = pozicije.find((p) => p.id === pozId);
    updatePoz(pozId, { stavkeAKZ: (poz.stavkeAKZ || []).map((a) => (a.id === akzId ? { ...a, ...patch } : a)) });
  };
  const removeAkz = (pozId, akzId) => {
    const poz = pozicije.find((p) => p.id === pozId);
    updatePoz(pozId, { stavkeAKZ: (poz.stavkeAKZ || []).filter((a) => a.id !== akzId) });
  };

  // Formule su dijeljene na razini modula (koristi ih i PDF ispis ponude) — ovdje samo lokalni
  // wrapperi koji nadopune trenutni katalog/kvalitete/satnicaMontaza/materijaliSkladiste.
  const satiPoz = satiPozicije;
  const trosakPoz = (p) => trosakRadaPozicije(p, cjenikRada);
  const akzPoz = (p) => akzPozicije(p, katalog, kvalitete);
  const montazaPoz = (p) => montazaPozicije(p, satnicaMontaza);
  const materijalPoz = (p) => materijalPozicije(p, katalog, kvalitete, materijaliSkladiste);
  const ostaloPoz = (p) => ostaloPozicije(p);

  const aktivnaPozicija = pozicije.find((p) => p.id === aktivnaKartica);

  return (
    <div>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {pozicije.map((p) => (
          <div key={p.id} className={`nav-tab ${aktivnaKartica === p.id ? "active" : ""}`} onClick={() => setAktivnaKartica(p.id)} style={{ padding: "6px 12px", fontSize: 12.5 }}>
            {p.oznaka || "Stavka"}
          </div>
        ))}
        <button className="btn btn-icon btn-ghost" onClick={addPoz} title="Dodaj stavku"><Plus size={15} /></button>
        <div className={`nav-tab ${aktivnaKartica === "materijal" ? "active" : ""}`} onClick={() => setAktivnaKartica("materijal")} style={{ padding: "6px 12px", fontSize: 12.5, marginLeft: "auto" }}>
          Materijal
        </div>
        <div className={`nav-tab ${aktivnaKartica === "rekap" ? "active" : ""}`} onClick={() => setAktivnaKartica("rekap")} style={{ padding: "6px 12px", fontSize: 12.5, fontWeight: 600 }}>
          Rekapitulacija
        </div>
      </div>

      {pozicije.length === 0 && aktivnaKartica !== "materijal" && aktivnaKartica !== "rekap" && <div style={{ textAlign: "center", color: "var(--ink-faint)", padding: "16px 0", fontSize: 13 }}>Nema stavki. Dodajte prvu stavku konstrukcije.</div>}

      {aktivnaPozicija && (() => {
        const p = aktivnaPozicija;
        const masaJedEfektivna = masaPozicije(p, katalog, kvalitete);
        return (
          <div key={p.id} className="card" style={{ padding: 12, marginBottom: 10, background: "var(--surface-alt)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ width: 62 }}><label className="label">Oznaka</label><input className="input f-mono" value={p.oznaka} onChange={(e) => updatePoz(p.id, { oznaka: e.target.value })} /></div>
              <div style={{ flex: "2 1 220px" }}><label className="label">Naziv stavke</label><input className="input" placeholder="npr. Glavni nosači rešetke" value={p.naziv} onChange={(e) => updatePoz(p.id, { naziv: e.target.value })} /></div>
              <div style={{ width: 90 }}><label className="label">Količina</label><input className="input f-mono" type="number" min="0" value={p.kolicina} onChange={(e) => updatePoz(p.id, { kolicina: e.target.value })} /></div>
              <button className="btn btn-icon btn-ghost" onClick={() => toggle(p.id)} title="Prikaži/sakrij sate po operaciji">{otvorene[p.id] ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
              <button className="btn btn-icon btn-ghost" onClick={() => removePoz(p.id)}><Trash2 size={14} color="var(--rust)" /></button>
            </div>

            <div style={{ marginTop: 10, paddingTop: 6, borderTop: "1px dashed var(--line-strong)" }}>
              <div className="label" style={{ marginBottom: 2 }}>Stavke materijala (profili / limovi) u jednoj stavci</div>
              {(p.stavke || []).map((s) => (
                <StavkaPozicijeRedak
                  key={s.id} stavka={s} katalog={katalog} grupe={grupe} kvalitete={kvalitete}
                  onAzuriraj={(patch) => updateStavka(p.id, s.id, patch)}
                  onObrisi={() => removeStavka(p.id, s.id)}
                />
              ))}
              <Btn variant="ghost" size="sm" icon={Plus} onClick={() => addStavka(p.id)} style={{ marginTop: 8 }}>Dodaj stavku</Btn>
            </div>

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-strong)" }}>
              <div className="label" style={{ marginBottom: 2 }}>Materijal (iz skladišta) — za ovu stavku</div>
              <LineItemsEditor mode="materijal" rows={p.materijalStavke || []} setRows={(rows) => updatePoz(p.id, { materijalStavke: rows })} materijali={materijaliSkladiste} katalog={katalog} narudzbenice={narudzbenice} />
            </div>

            {otvorene[p.id] && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-strong)" }}>
                <div className="label" style={{ marginBottom: 8 }}>Predviđeni sati po operaciji i trajanje</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 340 }}>
                  {OPERACIJE.map((o) => (
                    <div key={o.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <label style={{ fontSize: 12, color: "var(--ink-soft)", flex: 1 }}>{o.label}</label>
                      <input className="input f-mono" style={{ width: 100 }} type="number" min="0" step="0.5" value={p.operacije?.[o.key] ?? 0} onChange={(e) => updateOp(p.id, o.key, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-strong)" }}>
              <div className="label" style={{ marginBottom: 2 }}>AKZ (antikorozivna zaštita) — cijena po kg × ukupna masa stavke</div>
              {(p.stavkeAKZ || []).map((a) => {
                const masaUkupnaPoz = Number(p.kolicina) * masaJedEfektivna || 0;
                const iznos = masaUkupnaPoz * (Number(a.cijenaKg) || 0);
                return (
                  <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: "8px 0", borderBottom: "1px dashed var(--line)" }}>
                    <div style={{ flex: "1 1 200px" }}>
                      <label className="label">Vrsta zaštite</label>
                      <select className="select" value={a.tip} onChange={(e) => updateAkz(p.id, a.id, { tip: e.target.value })}>
                        {AKZ_TIPOVI.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </div>
                    <div style={{ width: 120 }}>
                      <label className="label">Cijena (€/kg)</label>
                      <input className="input f-mono" type="number" min="0" step="0.01" value={a.cijenaKg} onChange={(e) => updateAkz(p.id, a.id, { cijenaKg: e.target.value })} />
                    </div>
                    <div style={{ width: 130 }}>
                      <label className="label">Iznos</label>
                      <div className="input f-mono" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{fmtCurDec(iznos)}</div>
                    </div>
                    <button className="btn btn-icon btn-ghost" onClick={() => removeAkz(p.id, a.id)}><Trash2 size={14} color="var(--rust)" /></button>
                  </div>
                );
              })}
              <Btn variant="ghost" size="sm" icon={Plus} onClick={() => addAkz(p.id)} style={{ marginTop: 8 }}>Dodaj AKZ stavku</Btn>
            </div>

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-strong)", display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="label" style={{ width: "100%", marginBottom: 0 }}>Montaža</div>
              <div style={{ width: 120 }}>
                <label className="label">Broj montera</label>
                <input className="input f-mono" type="number" min="0" step="1" value={p.brojMontera ?? 0} onChange={(e) => updatePoz(p.id, { brojMontera: e.target.value })} />
              </div>
              <div style={{ width: 150 }}>
                <label className="label">Planirani sati/kom</label>
                <input className="input f-mono" type="number" min="0" step="0.5" value={p.planiraniSatiMontaza ?? 0} onChange={(e) => updatePoz(p.id, { planiraniSatiMontaza: e.target.value })} />
              </div>
              <div style={{ width: 130 }}>
                <label className="label">Sati montaže (uk.)</label>
                <div className="input f-mono" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{((Number(p.brojMontera) || 0) * (Number(p.planiraniSatiMontaza) || 0) * (Number(p.kolicina) || 0)).toFixed(1)} h</div>
              </div>
              <div style={{ width: 140 }}>
                <label className="label">Trošak montaže</label>
                <div className="input f-mono" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{fmtCurDec(montazaPoz(p))}</div>
              </div>
            </div>

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-strong)" }}>
              <div className="label" style={{ marginBottom: 2 }}>Ostalo (transport, projektiranje…) — za ovu stavku</div>
              <LineItemsEditor mode="custom" rows={p.ostaleStavke || []} setRows={(rows) => updatePoz(p.id, { ostaleStavke: rows })} materijali={materijaliSkladiste} />
            </div>

            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 18, fontSize: 12.5, flexWrap: "wrap" }}>
              <span style={{ color: "var(--ink-soft)" }}>Masa/kom: <strong className="f-mono" style={{ color: "var(--ink)" }}>{masaJedEfektivna.toFixed(2)} kg</strong></span>
              <span style={{ color: "var(--ink-soft)" }}>Ukupno masa: <strong className="f-mono" style={{ color: "var(--ink)" }}>{(Number(p.kolicina) * masaJedEfektivna || 0).toLocaleString("hr-HR", { maximumFractionDigits: 1 })} kg</strong></span>
              <span style={{ color: "var(--ink-soft)" }}>Ukupno sati: <strong className="f-mono" style={{ color: "var(--ink)" }}>{satiPoz(p)} h</strong></span>
              <span style={{ color: "var(--ink-soft)" }}>Trošak rada: <strong className="f-mono" style={{ color: "var(--ink)" }}>{fmtCurDec(trosakPoz(p))}</strong></span>
            </div>
          </div>
        );
      })()}

      {/* Optimizacija sirovog materijala (šipke 6/12 m, limovi s otpadom) po prirodi računa preko
          SVIH stavki zajedno — narudžba se reže odjednom, ne po pojedinoj stavci — zato živi u
          svojoj kartici, odvojeno od pojedinih stavki. */}
      {aktivnaKartica === "materijal" && calc && (
        <div>
          <label className="label" style={{ marginBottom: 6, display: "block" }}>Potreban sirovi materijal za cijeli projekt (zbrojeno za sve stavke) — cijena se upisuje na svakoj stavci</label>
          {calc.potrebanMaterijal.profili.length === 0 && calc.potrebanMaterijal.limovi.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--ink-faint)", padding: "16px 0", fontSize: 13 }}>Nema izračunatog materijala — dodaj stavke sa "Stavkama materijala iz kataloga".</div>
          )}
          {calc.potrebanMaterijal.profili.length > 0 && (
            <table className="erp-table" style={{ marginBottom: 10 }}>
              <thead><tr><th>Profil</th><th style={{ width: 70 }}>Komada</th><th style={{ width: 90 }}>Potrebno (m)</th><th style={{ width: 80 }}>Šipki 6m</th><th style={{ width: 80 }}>Šipki 12m</th><th style={{ width: 80 }}>Otpad (m)</th></tr></thead>
              <tbody>
                {calc.potrebanMaterijal.profili.map((p) => (
                  <tr key={p.katalogId}>
                    <td>{p.oznaka}</td>
                    <td className="f-mono">{p.brojKomada}</td>
                    <td className="f-mono">{p.ukupnoPotrebno.toFixed(2)}</td>
                    <td className="f-mono">{p.brojPo6}</td>
                    <td className="f-mono">{p.brojPo12}</td>
                    <td className="f-mono" style={{ color: "var(--ink-faint)" }}>{p.otpadM.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {calc.potrebanMaterijal.limovi.length > 0 && (
            <table className="erp-table" style={{ marginBottom: 16 }}>
              <thead><tr><th>Lim</th><th style={{ width: 110 }}>Površina (m²)</th><th style={{ width: 110 }}>Otpad (%)</th><th style={{ width: 110 }}>Masa s otpadom (kg)</th></tr></thead>
              <tbody>
                {calc.potrebanMaterijal.limovi.map((l) => (
                  <tr key={l.katalogId}>
                    <td>{l.oznaka}</td>
                    <td className="f-mono">{l.povrsinaM2.toFixed(2)}</td>
                    <td><input className="input f-mono" type="number" min="0" step="1" value={l.otpadPostotak} onChange={(e) => azurirajOtpadLima(l.katalogId, e.target.value === "" ? 0 : Number(e.target.value))} /></td>
                    <td className="f-mono">{l.masaKg.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {aktivnaKartica === "rekap" && calc && (() => {
        const postotakMarze = Number(calc.postotakMarze) || 0;
        let ukupnoSveStavkeSaMarzom = 0;
        return (
          <table className="erp-table">
            <thead>
              <tr>
                <th>Stavka</th><th style={{ width: 90 }}>Trošak rada</th><th style={{ width: 90 }}>Materijal</th>
                <th style={{ width: 80 }}>AKZ</th><th style={{ width: 90 }}>Montaža</th><th style={{ width: 80 }}>Ostalo</th>
                <th style={{ width: 90 }}>Marža</th><th style={{ width: 100 }}>Cijena/kom</th><th style={{ width: 120 }}>Ukupno (kol.)</th>
              </tr>
            </thead>
            <tbody>
              {pozicije.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-faint)" }}>Nema stavki.</td></tr>}
              {pozicije.map((p) => {
                const rada = trosakPoz(p);
                const materijal = materijalPoz(p);
                const akz = akzPoz(p);
                const montaza = montazaPoz(p);
                const ostalo = ostaloPoz(p);
                const bezMarze = rada + materijal + akz + montaza + ostalo;
                const marza = bezMarze * (postotakMarze / 100);
                const saMarzom = bezMarze + marza;
                ukupnoSveStavkeSaMarzom += saMarzom;
                const kolicina = Number(p.kolicina) || 1;
                const otvoren = !!opisOtvoren[p.id];
                return (
                  <React.Fragment key={p.id}>
                    <tr>
                      <td>
                        {p.oznaka} {p.naziv && `— ${p.naziv}`}
                        <button
                          className="btn btn-icon btn-ghost" style={{ marginLeft: 6, verticalAlign: "middle" }}
                          title={p.opis ? "Uredi opis stavke za ponudu" : "Dodaj opis stavke za ponudu"}
                          onClick={() => setOpisOtvoren((o) => ({ ...o, [p.id]: !o[p.id] }))}
                        >
                          <FileText size={13} color={p.opis ? "var(--steel)" : "var(--ink-faint)"} />
                        </button>
                      </td>
                      <td className="f-mono">{fmtCurDec(rada)}</td>
                      <td className="f-mono">{fmtCurDec(materijal)}</td>
                      <td className="f-mono">{fmtCurDec(akz)}</td>
                      <td className="f-mono">{fmtCurDec(montaza)}</td>
                      <td className="f-mono">{fmtCurDec(ostalo)}</td>
                      <td className="f-mono">{fmtCurDec(marza)}</td>
                      <td className="f-mono">{fmtCurDec(saMarzom / kolicina)}</td>
                      <td className="f-mono" style={{ fontWeight: 600 }}>{fmtCurDec(saMarzom)}</td>
                    </tr>
                    {otvoren && (
                      <tr>
                        <td colSpan={9} style={{ background: "var(--surface-alt)", padding: "8px 10px" }}>
                          <label className="label" style={{ marginBottom: 4 }}>Opis stavke (vidljivo u ponudi)</label>
                          <textarea
                            className="textarea" rows={2} style={{ width: "100%" }}
                            placeholder="npr. detaljniji tehnički opis konstrukcije za ovu stavku…"
                            value={p.opis || ""}
                            onChange={(e) => updatePoz(p.id, { opis: e.target.value })}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line-strong)" }}><td colSpan={8} style={{ textAlign: "right", fontWeight: 700 }}>UKUPNA CIJENA PONUDE (sa maržom {postotakMarze}%)</td><td className="f-mono" style={{ fontWeight: 700, fontSize: 15, color: "var(--steel)" }}>{fmtCurDec(ukupnoSveStavkeSaMarzom)}</td></tr>
            </tfoot>
          </table>
        );
      })()}

      {aktivnaKartica === "rekap" && (
        <div style={{ marginTop: 16 }}>
          <label className="label">Uvjeti za njemačku ponudu (prikazuje se samo kad je odabran njemački jezik ispisa)</label>
          <textarea className="textarea f-mono" rows={12} style={{ fontSize: 11.5 }} value={napomenaNjemacki || ""} onChange={(e) => setNapomenaNjemacki(e.target.value)} />
        </div>
      )}
    </div>
  );
}

function CjenikRadaModal({ cjenikRada, onSave, onClose }) {
  const [form, setForm] = useState(cjenikRada);
  return (
    <Modal title="Cjenik rada po operaciji (€/h)" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={() => onSave(form)}>Spremi cjenik</Btn></>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>Ove satnice koriste se za izračun troška rada u kalkulaciji ponuda.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {OPERACIJE.map((o) => (
          <Field key={o.key} label={o.label}>
            <input className="input f-mono" type="number" min="0" step="0.5" value={form[o.key]} onChange={(e) => setForm({ ...form, [o.key]: e.target.value })} />
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function StandardniZadaciModal({ standardniZadaci, update, showToast, onClose }) {
  const [noviNaziv, setNoviNaziv] = useState("");
  const dodaj = () => {
    if (!noviNaziv.trim()) return;
    update("standardniZadaci", [...standardniZadaci, { id: uid("std"), naziv: noviNaziv.trim() }]);
    setNoviNaziv("");
  };
  const obrisi = (id) => { update("standardniZadaci", standardniZadaci.filter((t) => t.id !== id)); };
  return (
    <Modal title="Standardni zadaci projekta" onClose={onClose} footer={<Btn onClick={onClose}>Zatvori</Btn>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>Ovi zadaci se automatski dodaju na svaki novi projekt (i pri pretvaranju ponude u projekt). Brisanje ovdje ne utječe na zadatke već postojećih projekata.</p>
      <div style={{ marginBottom: 14 }}>
        {standardniZadaci.length === 0 && <EmptyState text="Nema standardnih zadataka." />}
        {standardniZadaci.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={{ fontSize: 13.5 }}>{t.naziv}</span>
            <button className="btn btn-icon btn-ghost" onClick={() => obrisi(t.id)}><Trash2 size={14} color="var(--rust)" /></button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="Naziv novog standardnog zadatka…" value={noviNaziv} onChange={(e) => setNoviNaziv(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") dodaj(); }} />
        <Btn variant="primary" icon={Plus} onClick={dodaj}>Dodaj</Btn>
      </div>
    </Modal>
  );
}

// Tablica stavki jedne grupe normativa (Pod ili Komplet) unutar detalja projekta — svaka
// grupa ima svoju listu tipova jer se pod i komplet naručuju kao nezavisne stavke (različite
// oznake i količine u narudžbenici, npr. varijanta poda za prizemlje bez para u stranicama).
// Uvoz stavki iz vec unesene Narudzbe kupca (koja vec ima sifru/naziv/kolicinu/masu po stavci)
// u Pod/Komplet tablice normativa, da se iste stavke ne moraju upisivati dvaput. Svaka uvezena
// stavka pamti izNarudzbeId pa ponovni uvoz azurira postojeci redak umjesto da ga duplicira.
function NarudzbaUvozModal({ narudzba, stavkePod, stavkeKomplet, onUvezi, onClose }) {
  const pocetniIzbor = () => {
    const vecPod = new Set(stavkePod.map((s) => s.izNarudzbeId).filter(Boolean));
    const vecKomplet = new Set(stavkeKomplet.map((s) => s.izNarudzbeId).filter(Boolean));
    return Object.fromEntries((narudzba.stavke || []).map((s) => [s.id, vecPod.has(s.id) ? "stavkePod" : vecKomplet.has(s.id) ? "stavkeKomplet" : ""]));
  };
  const [izbor, setIzbor] = useState(pocetniIzbor);

  const spremi = () => {
    const odabrano = (narudzba.stavke || []).filter((s) => izbor[s.id]);
    if (odabrano.length > 0) onUvezi(odabrano.map((s) => ({ narudzbaStavka: s, grupa: izbor[s.id] })));
    onClose();
  };

  return (
    <Modal wide title="Uvezi stavke iz narudžbe" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Download} onClick={spremi}>Uvezi odabrano</Btn></>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>
        Za svaku stavku iz narudžbe {narudzba.broj} odaberi ide li u Pod ili Komplet tablicu normativa. Ponovni uvoz iste stavke ažurira već uvezeni redak (oznaku, masu, komade) umjesto da ga duplicira.
      </p>
      <table className="erp-table">
        <thead><tr><th>Naziv</th><th style={{ width: 80 }}>Kom</th><th style={{ width: 110 }}>Masa (kg/kom)</th><th style={{ width: 160 }}>Uvezi u</th></tr></thead>
        <tbody>
          {(narudzba.stavke || []).length === 0 && <tr><td colSpan={4}><EmptyState text="Narudžba nema unesenih stavki." /></td></tr>}
          {(narudzba.stavke || []).map((s) => (
            <tr key={s.id}>
              <td>{s.sifra ? `${s.sifra} — ` : ""}{s.naziv || "(bez naziva)"}</td>
              <td className="f-mono">{s.kolicina || 0}</td>
              <td className="f-mono">{s.masaJed || 0}</td>
              <td>
                <select className="select" value={izbor[s.id] || ""} onChange={(e) => setIzbor({ ...izbor, [s.id]: e.target.value })}>
                  <option value="">Preskoči</option>
                  <option value="stavkePod">Pod</option>
                  <option value="stavkeKomplet">Stranica</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function StavkeNormativaTablica({ naslov, rezultat, rasporedjeno, onDodaj, onAzuriraj, onObrisi }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="label" style={{ marginBottom: 6 }}>{naslov}</div>
      <table className="erp-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Oznaka tipa</th>
            <th style={{ width: 110 }}>Masa (kg/kom)</th>
            <th style={{ width: 80 }}>Komada</th>
            <th style={{ width: 100 }}>Ukupno kg</th>
            <th style={{ width: 110 }}>Vrijednost</th>
            <th style={{ width: 90 }}>Sati</th>
            <th style={{ width: 90 }}>U rasporedu</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {rezultat.poStavci.length === 0 && (
            <tr><td colSpan={8}><EmptyState text="Nema unesenih stavki." /></td></tr>
          )}
          {rezultat.poStavci.map((r) => {
            const rasp = rasporedjeno(r.stavka.id);
            const kom = Number(r.stavka.komada) || 0;
            return (
              <tr key={r.stavka.id}>
                <td><input className="input" placeholder="npr. Typ A1" value={r.stavka.oznaka} onChange={(e) => onAzuriraj(r.stavka.id, { oznaka: e.target.value })} /></td>
                <td><input className="input f-mono" type="number" min="0" step="1" value={r.stavka.masaJed} onChange={(e) => onAzuriraj(r.stavka.id, { masaJed: e.target.value })} /></td>
                <td><input className="input f-mono" type="number" min="0" step="1" value={r.stavka.komada} onChange={(e) => onAzuriraj(r.stavka.id, { komada: e.target.value })} /></td>
                <td className="f-mono">{Math.round(r.masaUk).toLocaleString("hr-HR")}</td>
                <td className="f-mono">{fmtCur(r.vrijednost)}</td>
                <td className="f-mono">{r.sati.toFixed(1)} h</td>
                <td className="f-mono" style={{ color: rasp === kom ? "var(--green)" : "var(--rust)" }}>{rasp}/{kom}</td>
                <td><button className="btn btn-icon btn-ghost" onClick={() => onObrisi(r.stavka.id)}><Trash2 size={14} /></button></td>
              </tr>
            );
          })}
          {rezultat.poStavci.length > 0 && (
            <tr style={{ fontWeight: 700, background: "var(--surface-alt)" }}>
              <td>UKUPNO</td>
              <td></td>
              <td className="f-mono">{rezultat.ukupno.komada}</td>
              <td className="f-mono">{Math.round(rezultat.ukupno.masaUk).toLocaleString("hr-HR")}</td>
              <td className="f-mono">{fmtCur(rezultat.ukupno.vrijednost)}</td>
              <td className="f-mono">{rezultat.ukupno.sati.toFixed(1)} h</td>
              <td></td>
              <td></td>
            </tr>
          )}
        </tbody>
      </table>
      <Btn variant="ghost" size="sm" icon={Plus} onClick={onDodaj}>Dodaj stavku</Btn>
    </div>
  );
}

/* ============================== NORMATIV TIPSKIH PROJEKATA — UREĐIVANJE ============================== */
function NormativiModal({ db, update, showToast, onClose }) {
  const [form, setForm] = useState(() => JSON.parse(JSON.stringify(db.normativi || { naziv: "", grupe: [] })));

  const azurirajGrupu = (kljuc, patch) => setForm({ ...form, grupe: form.grupe.map((g) => (g.kljuc === kljuc ? { ...g, ...patch } : g)) });
  const azurirajPostotak = (kljuc, opKey, val) => setForm({
    ...form,
    grupe: form.grupe.map((g) => (g.kljuc === kljuc ? { ...g, raspodjela: { ...g.raspodjela, [opKey]: val === "" ? 0 : Number(val) } } : g)),
  });

  const spremi = () => {
    const losa = form.grupe.find((g) => Math.abs(zbrojRaspodjele(g.raspodjela) - 100) > 0.01);
    if (losa) { showToast(`Raspodjela za "${losa.naziv}" ne daje 100% (trenutno ${zbrojRaspodjele(losa.raspodjela).toFixed(1)}%).`); return; }
    update("normativi", form);
    showToast("Normativ spremljen.");
    onClose();
  };

  return (
    <Modal wide title="Normativ tipskih projekata (ugovorene cijene)" onClose={onClose}
      footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi}>Spremi</Btn></>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>
        Postavlja se jednom i vrijedi za sve projekte koji koriste normativ. Cijena i sati izvode se iz mase:
        <strong> vrijednost = masa × €/kg</strong>, <strong>sati = masa ÷ (kg/h)</strong>, a ti se sati raspoređuju po operacijama prema postotku ispod.
      </p>
      <Field label="Naziv normativa"><input className="input" value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} /></Field>

      {form.grupe.map((g) => {
        const zbroj = zbrojRaspodjele(g.raspodjela);
        const ok = Math.abs(zbroj - 100) < 0.01;
        return (
          <div key={g.kljuc} className="card" style={{ padding: 14, marginBottom: 14, background: "var(--surface-alt)" }}>
            <div className="f-display" style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{g.naziv}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <Field label="Ugovorena cijena (€/kg)"><input className="input f-mono" type="number" step="0.01" min="0" value={g.cijenaKg} onChange={(e) => azurirajGrupu(g.kljuc, { cijenaKg: e.target.value })} /></Field>
              <Field label="Učinak (kg/h)"><input className="input f-mono" type="number" step="0.1" min="0" value={g.ucinakKgH} onChange={(e) => azurirajGrupu(g.kljuc, { ucinakKgH: e.target.value })} /></Field>
            </div>
            <div className="label" style={{ marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
              <span>Raspodjela sati po operacijama (%)</span>
              <span className="f-mono" style={{ color: ok ? "var(--green)" : "var(--rust)", fontWeight: 700 }}>{zbroj.toFixed(1)}% {ok ? "✓" : "— mora biti 100%"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {OPERACIJE.map((o) => (
                <div key={o.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11.5, flex: 1, color: "var(--ink-soft)" }}>{o.label}</span>
                  <input className="input f-mono" type="number" step="0.5" min="0" style={{ width: 62 }} value={g.raspodjela?.[o.key] ?? 0} onChange={(e) => azurirajPostotak(g.kljuc, o.key, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

/* ============================== DETALJI PROJEKTA ============================== */
function ProjektDetaljModal({ projekt, db, update, patchProjekt: patchProjektAsync, patchUpiti, showToast, setPage, onClose, mojId }) {
  const kupac = db.kupci.find((k) => k.id === projekt.kupacId);
  const voditelj = db.zaposlenici.find((z) => z.id === projekt.voditeljId);
  const nalozi = db.radniNalozi.filter((r) => r.projektId === projekt.id);
  // Kreira po jedan radni nalog za svaku fazu koja na projektu ima planiranih, a još
  // nerasporedenih sati (preostaloSatiFaze) — ne diraju se faze bez planiranih sati ili one
  // za koje je već sve raspoređeno. Ručno pokrenuto gumbom, nikad automatski.
  const kreirajRadneNaloge = () => {
    let brojac = parseInt(sljedeciBrojRadnogNaloga(db.radniNalozi, projekt.sifra).split("/").pop(), 10);
    const noviNalozi = FAZE
      .map((faza) => ({ faza, preostalo: preostaloSatiFaze(projekt, faza, db.radniNalozi, null) }))
      .filter(({ preostalo }) => preostalo > 0)
      .map(({ faza, preostalo }) => ({
        id: uid("rn"), broj: `${projekt.sifra}/${brojac++}`, projektId: projekt.id,
        naziv: projekt.naziv, faza, zaduzenTim: "", status: "Planiran",
        planiranoSati: preostalo, utrosenoSati: 0, datumPocetka: todayISO(), datumZavrsetka: todayISO(),
        stavke: [], materijalIzdan: false, ovisiONalogId: null, ovisnostTip: "zavrsetak", ovisnostSati: 8,
      }));
    if (noviNalozi.length === 0) { showToast("Sve planirane faze već imaju radne naloge."); return; }
    update("radniNalozi", [...db.radniNalozi, ...noviNalozi]);
    showToast(`Kreirano ${noviNalozi.length} radnih naloga.`);
  };
  const planiranoUkupno = nalozi.reduce((s, n) => s + (Number(n.planiranoSati) || 0), 0);
  const utrosenoUkupno = nalozi.reduce((s, n) => s + (Number(n.utrosenoSati) || 0), 0);
  const postotak = planiranoUkupno > 0 ? Math.min(100, Math.round((utrosenoUkupno / planiranoUkupno) * 100)) : 0;
  const pozicije = projekt.pozicije || [];
  const materijalStavke = projekt.materijalStavke || [];
  const ostaleStavke = projekt.ostaleStavke || [];
  const zadaci = projekt.zadaci || [];
  const zadaciDone = zadaci.filter((z) => z.izvrseno).length;
  // Svi zadaci ostaju vidljivi i nakon što su izvršeni (da se vidi tko ih je i kad izvršio) —
  // samo se izvršeni spuste na dno popisa da nedovršeni ostanu pri vrhu.
  const zadaciPrikaz = [...zadaci].sort((a, b) => (a.izvrseno === b.izvrseno ? 0 : a.izvrseno ? 1 : -1));
  const [noviZadatak, setNoviZadatak] = useState("");
  const [noviZadatakDatum, setNoviZadatakDatum] = useState("");
  const [noviZadatakKome, setNoviZadatakKome] = useState("");
  const [narudzbaModal, setNarudzbaModal] = useState(false);
  const [potvrdaModal, setPotvrdaModal] = useState(false);
  const [otpremniceModal, setOtpremniceModal] = useState(false);
  const narudzba = db.narudzbe.find((n) => n.projektId === projekt.id);
  const brojOtpremnica = db.otpremnice.filter((o) => o.projektId === projekt.id).length;

  const [normativOtvoren, setNormativOtvoren] = useState(false);
  const stavkePod = projekt.stavkePod || [];
  const stavkeKomplet = projekt.stavkeKomplet || [];
  const isporuke = projekt.isporuke || [];
  const koristiNormativ = !!projekt.koristiNormativ;
  const izracunNorm = useMemo(() => izracunTipskogProjekta({ stavkePod, stavkeKomplet }, db.normativi), [stavkePod, stavkeKomplet, db.normativi]);
  const patchProjekt = (patch) => patchProjektAsync(projekt.id, patch);
  const dodajStavku = (grupa) => patchProjekt({ [grupa]: [...(projekt[grupa] || []), { id: uid("stv"), oznaka: "", masaJed: 0, komada: 0 }] });
  const azurirajStavku = (grupa, id, patch) => patchProjekt({ [grupa]: (projekt[grupa] || []).map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const obrisiStavku = (grupa, id) => patchProjekt({ [grupa]: (projekt[grupa] || []).filter((s) => s.id !== id), isporuke: isporuke.filter((i) => !(i.grupa === grupa && i.stavkaId === id)) });
  // Sve unesene stavke (pod + komplet) u jednoj listi, za padajući izbornik u rasporedu isporuka
  const sveStavke = [
    ...stavkePod.map((s) => ({ grupa: "stavkePod", stavka: s })),
    ...stavkeKomplet.map((s) => ({ grupa: "stavkeKomplet", stavka: s })),
  ];
  const nadjiStavku = (grupa, stavkaId) => (grupa === "stavkePod" ? stavkePod : stavkeKomplet).find((s) => s.id === stavkaId);
  const rasporedjenoZaStavku = (grupa, stavkaId) => isporuke.filter((i) => i.grupa === grupa && i.stavkaId === stavkaId).reduce((s, i) => s + (Number(i.komada) || 0), 0);
  const [uvozOtvoren, setUvozOtvoren] = useState(false);
  const uveziIzNarudzbe = (odabrane) => {
    const noviPod = [...stavkePod];
    const noviKomplet = [...stavkeKomplet];
    odabrane.forEach(({ narudzbaStavka, grupa }) => {
      const cilj = grupa === "stavkePod" ? noviPod : noviKomplet;
      const patch = { izNarudzbeId: narudzbaStavka.id, oznaka: narudzbaStavka.naziv, masaJed: Number(narudzbaStavka.masaJed) || 0, komada: Number(narudzbaStavka.kolicina) || 0 };
      const idx = cilj.findIndex((s) => s.izNarudzbeId === narudzbaStavka.id);
      if (idx >= 0) cilj[idx] = { ...cilj[idx], ...patch };
      else cilj.push({ id: uid("stv"), ...patch });
    });
    patchProjekt({ stavkePod: noviPod, stavkeKomplet: noviKomplet });
    showToast && showToast("Stavke uvezene iz narudžbe.");
  };
  const dodajIsporuku = () => {
    const prva = sveStavke[0];
    patchProjekt({ isporuke: [...isporuke, { id: uid("isp"), redniBroj: isporuke.length + 1, grupa: prva?.grupa || "stavkePod", stavkaId: prva?.stavka.id || "", komada: 1, datum: "", isporuceno: false }] });
  };
  const azurirajIsporuku = (id, patch) => patchProjekt({ isporuke: isporuke.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const obrisiIsporuku = (id) => patchProjekt({ isporuke: isporuke.filter((i) => i.id !== id) });

  const azurirajZadatke = (noviZadaci) => patchProjekt({ zadaci: noviZadaci });
  const azurirajMaterijal = (noveStavke) => patchProjekt({ materijalStavke: noveStavke });
  const pokreniKreiranjeUpita = () => {
    const noviUpit = kreirajUpitIzMaterijala({ ...projekt, materijalStavke }, db, patchUpiti, showToast);
    if (noviUpit && setPage) setPage("nabava");
  };
  const toggleZadatak = (zadId, checked) => azurirajZadatke(zadaci.map((z) => (z.id === zadId ? { ...z, izvrseno: checked, izvrsioId: checked ? (z.izvrsioId || mojId) : null, datumIzvrsenja: checked ? z.datumIzvrsenja || todayISO() : null } : z)));
  const postaviIzvrsitelja = (zadId, izvrsioId) => azurirajZadatke(zadaci.map((z) => (z.id === zadId ? { ...z, izvrsioId, izvrseno: true, datumIzvrsenja: z.datumIzvrsenja || todayISO() } : z)));
  const postaviPlaniraniDatum = (zadId, datum) => azurirajZadatke(zadaci.map((z) => (z.id === zadId ? { ...z, planiraniDatum: datum } : z)));
  const postaviDodjelu = (zadId, dodijeljenoId) => azurirajZadatke(zadaci.map((z) => (z.id === zadId ? { ...z, dodijeljenoId: dodijeljenoId || null } : z)));
  const obrisiZadatak = (zadId) => azurirajZadatke(zadaci.filter((z) => z.id !== zadId));
  const postaviNapomenu = (zadId, tekst) => azurirajZadatke(zadaci.map((z) => (z.id === zadId ? { ...z, napomena: tekst || null, napomenaAutorId: tekst ? mojId : null, napomenaDatum: tekst ? todayISO() : null } : z)));
  const imeZaposlenikaZadatka = (id) => { const zz = db.zaposlenici.find((x) => x.id === id); return zz ? `${zz.prezime} ${zz.ime}` : "—"; };
  const dodajZadatak = () => {
    if (!noviZadatak.trim()) return;
    azurirajZadatke([...zadaci, { id: uid("zad"), naziv: noviZadatak.trim(), izvrseno: false, izvrsioId: null, datumIzvrsenja: null, planiraniDatum: noviZadatakDatum || null, dodijeljenoId: noviZadatakKome || null }]);
    setNoviZadatak("");
    setNoviZadatakDatum("");
    setNoviZadatakKome("");
    showToast && showToast("Zadatak dodan.");
  };

  return (
    <>
    <Modal wide title={`Detalji projekta — ${projekt.sifra}`} onClose={onClose} footer={<Btn onClick={onClose}>Zatvori</Btn>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }} className="f-display">{projekt.naziv}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>{kupac?.naziv || "—"} · Rok: {fmtDate(projekt.rokPocetka)} – {fmtDate(projekt.rokZavrsetka)}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2, display: "flex", alignItems: "center", gap: 8 }}>
            Voditelj projekta: <strong style={{ color: "var(--ink)" }}>{voditelj ? `${voditelj.prezime} ${voditelj.ime}` : "nije dodijeljen"}</strong>
            {voditelj && <Btn variant="ghost" size="sm" onClick={() => { const ok = posaljiObavijestVoditelju(projekt, voditelj); showToast && showToast(ok ? "Otvoren e-mail za slanje obavijesti." : "Voditelj nema unesen e-mail."); }}>Pošalji obavijest</Btn>}
          </div>
          {(projekt.kontaktOsoba || projekt.kontaktEmail || projekt.kontaktTelefon) && (
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>
              Kontakt: <strong style={{ color: "var(--ink)" }}>{projekt.kontaktOsoba || "—"}</strong>
              {projekt.kontaktEmail && <> · <a href={`mailto:${projekt.kontaktEmail}`}>{projekt.kontaktEmail}</a></>}
              {projekt.kontaktTelefon && <> · {projekt.kontaktTelefon}</>}
            </div>
          )}
          {projekt.mjestoIsporuke && <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>Mjesto isporuke: <strong style={{ color: "var(--ink)" }}>{projekt.mjestoIsporuke}</strong></div>}
          {projekt.izvorPonudaId && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>Kreirano iz ponude {db.ponude.find((p) => p.id === projekt.izvorPonudaId)?.broj || projekt.izvorPonudaId}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <Badge status={projekt.status} />
          <div className="f-mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{fmtCur(projekt.vrijednost)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 16, background: "var(--surface-alt)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
          <span style={{ color: "var(--ink-soft)" }}>Napredak izvršenja (sati)</span>
          <span className="f-mono">{utrosenoUkupno} / {planiranoUkupno} h ({postotak}%)</span>
        </div>
        <div style={{ height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${postotak}%`, background: postotak >= 100 ? "var(--green)" : "var(--steel)" }} />
        </div>
      </div>

      {/* ===== Tipski projekt po normativu (kupaonice i sl.) ===== */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={koristiNormativ} onChange={(e) => patchProjekt({ koristiNormativ: e.target.checked })} />
            <strong className="f-display" style={{ fontSize: 14 }}>Tipski projekt po normativu</strong>
          </label>
          {koristiNormativ && (
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" size="sm" icon={Download} onClick={() => setUvozOtvoren(true)} disabled={!narudzba}>Uvezi iz narudžbe</Btn>
              <Btn variant="ghost" size="sm" icon={Settings} onClick={() => setNormativOtvoren(true)}>Uredi normativ</Btn>
            </div>
          )}
        </div>

        {!koristiNormativ && <p style={{ fontSize: 12, color: "var(--ink-faint)" }}>Uključi ako se projekt obračunava po ugovorenoj cijeni €/kg (npr. tipske kupaonice) — tada se vrijednost i sati računaju iz mase, a ne unose ručno po poziciji. Pod i komplet unose se odvojeno, kao zasebne stavke narudžbenice.</p>}

        {koristiNormativ && (
          <>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginBottom: 10 }}>
              Normativ: <strong>{db.normativi?.naziv}</strong> · {(db.normativi?.grupe || []).map((g) => `${g.naziv.split(" (")[0]}: ${g.cijenaKg} €/kg, ${g.ucinakKgH} kg/h`).join(" · ")}
              {!narudzba && <span> · Za uvoz stavki iz narudžbe prvo kreiraj narudžbu kupca za ovaj projekt.</span>}
            </div>

            <StavkeNormativaTablica naslov="Pod (podna konstrukcija)" rezultat={izracunNorm.pod} rasporedjeno={(id) => rasporedjenoZaStavku("stavkePod", id)} onDodaj={() => dodajStavku("stavkePod")} onAzuriraj={(id, patch) => azurirajStavku("stavkePod", id, patch)} onObrisi={(id) => obrisiStavku("stavkePod", id)} />
            <StavkeNormativaTablica naslov="Stranice" rezultat={izracunNorm.komplet} rasporedjeno={(id) => rasporedjenoZaStavku("stavkeKomplet", id)} onDodaj={() => dodajStavku("stavkeKomplet")} onAzuriraj={(id, patch) => azurirajStavku("stavkeKomplet", id, patch)} onObrisi={(id) => obrisiStavku("stavkeKomplet", id)} />

            {izracunNorm.pod.ukupno.komada > 0 && izracunNorm.komplet.ukupno.komada > 0 && izracunNorm.pod.ukupno.komada !== izracunNorm.komplet.ukupno.komada && (
              <p style={{ fontSize: 11.5, color: "var(--rust)", marginTop: -6, marginBottom: 14 }}>
                Napomena: ukupno komada poda ({izracunNorm.pod.ukupno.komada}) i kompleta ({izracunNorm.komplet.ukupno.komada}) se ne poklapaju.
              </p>
            )}

            <div className="card" style={{ padding: "10px 14px", marginBottom: 14, background: "var(--surface-alt)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong style={{ fontSize: 13 }}>UKUPNO PROJEKT</strong>
              <span className="f-mono" style={{ fontSize: 13 }}>{Math.round(izracunNorm.ukupno.masaUk).toLocaleString("hr-HR")} kg · {fmtCur(izracunNorm.ukupno.vrijednost)} · {izracunNorm.ukupno.sati.toFixed(1)} h</span>
            </div>

            {izracunNorm.ukupno.vrijednost > 0 && Math.abs(izracunNorm.ukupno.vrijednost - (Number(projekt.vrijednost) || 0)) > 1 && (
              <div style={{ marginBottom: 14 }}>
                <Btn variant="ghost" size="sm" onClick={() => patchProjekt({ vrijednost: Math.round(izracunNorm.ukupno.vrijednost) })}>Prepiši vrijednost projekta ({fmtCur(izracunNorm.ukupno.vrijednost)})</Btn>
              </div>
            )}

            {izracunNorm.ukupno.sati > 0 && (
              <>
                <div className="label" style={{ marginBottom: 6 }}>Planirani sati po operacijama (izračunato iz normativa)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
                  {OPERACIJE.filter((o) => izracunNorm.ukupno.satiPoOperaciji[o.key] > 0.01).map((o) => (
                    <div key={o.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "3px 8px", background: "var(--surface-alt)", borderRadius: 3 }}>
                      <span style={{ color: "var(--ink-soft)" }}>{o.label}</span>
                      <span className="f-mono" style={{ fontWeight: 600 }}>{izracunNorm.ukupno.satiPoOperaciji[o.key].toFixed(1)} h</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ===== Raspored isporuka (po stavkama poda/kompleta, djeljivo na više datuma) ===== */}
      {koristiNormativ && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <strong className="f-display" style={{ fontSize: 14 }}>Raspored isporuka ({isporuke.length})</strong>
            <Btn variant="ghost" size="sm" icon={Plus} onClick={dodajIsporuku} disabled={sveStavke.length === 0}>Dodaj isporuku</Btn>
          </div>
          {sveStavke.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--ink-faint)" }}>Prvo unesi barem jednu stavku poda ili kompleta.</p>
          ) : isporuke.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--ink-faint)" }}>Dodaj redak, izaberi tip (pod ili komplet) iz padajućeg izbornika i unesi koliko komada te stavke ide na koji datum — ista stavka može imati više redaka ako se isporučuje u više navrata.</p>
          ) : (
            <table className="erp-table">
              <thead><tr><th style={{ width: 40 }}>Br.</th><th>Tip</th><th style={{ width: 80 }}>Komada</th><th style={{ width: 150 }}>Datum isporuke</th><th style={{ width: 100 }}>Isporučeno</th><th></th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {[...isporuke].sort((a, b) => (a.datum || "9999").localeCompare(b.datum || "9999")).map((i) => {
                  const kasni = i.datum && !i.isporuceno && i.datum < todayISO();
                  const stavka = nadjiStavku(i.grupa, i.stavkaId);
                  return (
                    <tr key={i.id}>
                      <td className="f-mono">{i.redniBroj}</td>
                      <td>
                        <select className="select" disabled={!!i.uOtpremniciId} style={{ color: i.grupa === "stavkePod" ? "var(--steel)" : "var(--rust)", fontWeight: 600 }} value={`${i.grupa}:${i.stavkaId}`} onChange={(e) => { const [g, id] = e.target.value.split(":"); azurirajIsporuku(i.id, { grupa: g, stavkaId: id }); }}>
                          <optgroup label="Pod">
                            {stavkePod.map((s) => <option key={s.id} value={`stavkePod:${s.id}`}>{s.oznaka || "(bez oznake)"}</option>)}
                          </optgroup>
                          <optgroup label="Stranica">
                            {stavkeKomplet.map((s) => <option key={s.id} value={`stavkeKomplet:${s.id}`}>{s.oznaka || "(bez oznake)"}</option>)}
                          </optgroup>
                        </select>
                      </td>
                      <td><input className="input f-mono" type="number" min="0" step="1" max={stavka?.komada || undefined} disabled={!!i.uOtpremniciId} value={i.komada} onChange={(e) => azurirajIsporuku(i.id, { komada: e.target.value })} /></td>
                      <td><input className="input" type="date" disabled={!!i.uOtpremniciId} value={i.datum || ""} onChange={(e) => azurirajIsporuku(i.id, { datum: e.target.value })} /></td>
                      <td><input type="checkbox" checked={!!i.isporuceno} disabled={!!i.uOtpremniciId} title={i.uOtpremniciId ? `Uključeno u otpremnicu ${db.otpremnice.find((o) => o.id === i.uOtpremniciId)?.broj || ""}` : ""} onChange={(e) => azurirajIsporuku(i.id, { isporuceno: e.target.checked })} /></td>
                      <td style={{ fontSize: 11 }}>{i.uOtpremniciId ? <span style={{ color: "var(--ink-soft)" }}>U otpremnici {db.otpremnice.find((o) => o.id === i.uOtpremniciId)?.broj || ""}</span> : kasni ? <span style={{ color: "var(--rust)", fontWeight: 600 }}>Kasni</span> : null}</td>
                      <td><button className="btn btn-icon btn-ghost" disabled={!!i.uOtpremniciId} onClick={() => obrisiIsporuku(i.id)}><Trash2 size={14} color={i.uOtpremniciId ? "var(--ink-faint)" : "var(--rust)"} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Btn variant="ghost" icon={narudzba ? Pencil : Plus} onClick={() => setNarudzbaModal(true)}>{narudzba ? `Narudžba ${narudzba.broj}` : "Narudžba"}</Btn>
        {narudzba && <Btn variant="ghost" icon={FileText} onClick={() => setPotvrdaModal(true)}>{narudzba.potvrda ? `Potvrda ${narudzba.potvrda.broj}` : "Potvrda narudžbe"}</Btn>}
        <Btn variant="ghost" icon={Truck} onClick={() => setOtpremniceModal(true)}>Otpremnice{brojOtpremnica > 0 ? ` (${brojOtpremnica})` : ""}</Btn>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div className="label" style={{ marginBottom: 0 }}>Zadaci projekta</div>
          <span className="f-mono" style={{ fontSize: 12 }}>{zadaciDone}/{zadaci.length}</span>
        </div>
        <div className="card">
          {zadaciPrikaz.length === 0 && <EmptyState text="Nema zadataka." />}
          {zadaciPrikaz.map((z) => {
            const zakasnio = z.planiraniDatum && daysUntil(z.planiraniDatum) < 0;
            return (
              <div key={z.id} style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="checkbox" checked={z.izvrseno} onChange={(e) => toggleZadatak(z.id, e.target.checked)} style={{ width: 15, height: 15, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13.5, textDecoration: z.izvrseno ? "line-through" : "none", color: z.izvrseno ? "var(--ink-faint)" : "var(--ink)" }}>{z.naziv}</span>
                  {zakasnio && <Badge status="Kasni" />}
                  <button className="btn btn-icon btn-ghost" onClick={() => obrisiZadatak(z.id)}><X size={14} /></button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginLeft: 25, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 11, color: "var(--ink-faint)" }}>Dodijeljeno:</label>
                  <select className="select" style={{ maxWidth: 175, fontSize: 12, padding: "4px 8px" }} value={z.dodijeljenoId || ""} onChange={(e) => postaviDodjelu(z.id, e.target.value)}>
                    <option value="">Nije dodijeljeno…</option>
                    {[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((zz) => <option key={zz.id} value={zz.id}>{zz.prezime} {zz.ime}</option>)}
                  </select>
                  <label style={{ fontSize: 11, color: "var(--ink-faint)" }}>Planirano do:</label>
                  <input type="date" className="input f-mono" style={{ width: 145, fontSize: 12, padding: "4px 8px", borderColor: zakasnio ? "var(--rust)" : undefined }} value={z.planiraniDatum || ""} onChange={(e) => postaviPlaniraniDatum(z.id, e.target.value)} />
                  <select className="select" style={{ maxWidth: 175, fontSize: 12, padding: "4px 8px" }} value={z.izvrsioId || ""} onChange={(e) => postaviIzvrsitelja(z.id, e.target.value)}>
                    <option value="">Izvršio…</option>
                    {[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((zz) => <option key={zz.id} value={zz.id}>{zz.prezime} {zz.ime}</option>)}
                  </select>
                  {z.izvrseno && z.datumIzvrsenja && <span style={{ fontSize: 11.5, color: "var(--green)" }}>✓ Izvršeno {fmtDate(z.datumIzvrsenja)}</span>}
                </div>
                <NapomenaZadatka zadatak={z} imeZaposlenika={imeZaposlenikaZadatka} mozeUredjivati onSpremi={(tekst) => postaviNapomenu(z.id, tekst)} uvlaka={25} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input className="input" placeholder="Dodaj novi zadatak za ovaj projekt…" value={noviZadatak} onChange={(e) => setNoviZadatak(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") dodajZadatak(); }} />
          <select className="select" style={{ width: 170 }} value={noviZadatakKome} onChange={(e) => setNoviZadatakKome(e.target.value)}>
            <option value="">Dodijeli…</option>
            {[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((zz) => <option key={zz.id} value={zz.id}>{zz.prezime} {zz.ime}</option>)}
          </select>
          <input type="date" className="input" style={{ width: 150 }} value={noviZadatakDatum} onChange={(e) => setNoviZadatakDatum(e.target.value)} title="Planirani datum izvršenja" />
          <Btn variant="ghost" size="sm" icon={Plus} onClick={dodajZadatak}>Dodaj</Btn>
        </div>
      </div>

      {pozicije.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 6 }}>Pozicije (iz kalkulacije ponude)</div>
          <table className="erp-table">
            <thead><tr><th>Oz.</th><th>Naziv</th><th>Kom</th><th>Masa/kom</th><th>Ukupno masa</th><th>Sati</th></tr></thead>
            <tbody>
              {pozicije.map((p) => {
                const masaJed = masaPozicije(p, db.katalogProfila, db.kvaliteteMaterijala);
                const sati = OPERACIJE.reduce((s, o) => s + (Number(p.operacije?.[o.key]) || 0), 0);
                return (
                  <tr key={p.id}>
                    <td className="f-mono">{p.oznaka}</td>
                    <td>{p.naziv}</td>
                    <td className="f-mono">{p.kolicina}</td>
                    <td className="f-mono">{masaJed.toFixed(1)} kg</td>
                    <td className="f-mono">{(masaJed * Number(p.kolicina)).toFixed(1)} kg</td>
                    <td className="f-mono">{sati} h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div className="label" style={{ marginBottom: 0 }}>Potreban materijal za izradu</div>
          <Btn variant="ghost" size="sm" icon={FolderInput} onClick={pokreniKreiranjeUpita}>Kreiraj upit iz materijala</Btn>
        </div>
        <LineItemsEditor mode="materijal" rows={materijalStavke} setRows={azurirajMaterijal} materijali={db.materijali} katalog={db.katalogProfila} narudzbenice={db.narudzbenice} dozvoliKatalog />
      </div>

      {ostaleStavke.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 6 }}>Ostale stavke</div>
          <table className="erp-table">
            <thead><tr><th>Opis</th><th>Kom</th><th>Cijena/jed.</th></tr></thead>
            <tbody>{ostaleStavke.map((s, i) => <tr key={i}><td>{s.opis}</td><td className="f-mono">{s.kolicina} {s.jm}</td><td className="f-mono">{fmtCurDec(s.cijenaJed)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div className="label">Radni nalozi</div>
          <Btn variant="ghost" size="sm" icon={Plus} onClick={kreirajRadneNaloge}>Kreiraj radne naloge</Btn>
        </div>
        {nalozi.length === 0 ? <EmptyState text="Nema radnih naloga za ovaj projekt." /> : (
          <table className="erp-table">
            <thead><tr><th>Broj</th><th>Faza</th><th>Tim</th><th>Sati (utr./plan.)</th><th>Status</th></tr></thead>
            <tbody>
              {nalozi.map((n) => (
                <tr key={n.id}>
                  <td className="f-mono">{n.broj}</td>
                  <td>{n.faza}</td>
                  <td>{n.zaduzenTim || "—"}</td>
                  <td className="f-mono">{n.utrosenoSati} / {n.planiranoSati}</td>
                  <td><Badge status={n.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>

    {narudzbaModal && <NarudzbaModal narudzba={narudzba} projekt={projekt} db={db} update={update} showToast={showToast} onClose={() => setNarudzbaModal(false)} />}
    {potvrdaModal && narudzba && <PotvrdaNarudzbeModal narudzba={narudzba} projekt={projekt} db={db} update={update} showToast={showToast} mojId={mojId} onClose={() => setPotvrdaModal(false)} />}
    {otpremniceModal && <OtpremniceListModal projekt={projekt} narudzba={narudzba} db={db} update={update} patchProjekt={patchProjektAsync} showToast={showToast} onClose={() => setOtpremniceModal(false)} />}
    {normativOtvoren && <NormativiModal db={db} update={update} showToast={showToast} onClose={() => setNormativOtvoren(false)} />}
    {uvozOtvoren && narudzba && <NarudzbaUvozModal narudzba={narudzba} stavkePod={stavkePod} stavkeKomplet={stavkeKomplet} onUvezi={uveziIzNarudzbe} onClose={() => setUvozOtvoren(false)} />}
    </>
  );
}

/* ============================== PROJEKTI I PONUDE ============================== */
// Priprema i pokušaj otvaranja e-mail klijenta korisnika s obavijesti o dodjeli voditelja projekta
// NAPOMENA: artefakt nema pristup serveru za slanje e-pošte, pa ovo otvara mailto: koji korisnik treba potvrditi/poslati u svom mail programu.
const posaljiObavijestVoditelju = (projekt, zaposlenik) => {
  if (!zaposlenik?.email) return false;
  const subject = `Dodijeljen/a si kao voditelj projekta ${projekt.sifra} — ${projekt.naziv}`;
  const body = `Pozdrav ${zaposlenik.ime},\n\nDodijeljen/a si kao voditelj/ica projekta:\n\nŠifra: ${projekt.sifra}\nNaziv: ${projekt.naziv}\nRok završetka: ${fmtDate(projekt.rokZavrsetka)}\nVrijednost: ${fmtCur(projekt.vrijednost)}\n\nPrijavi se u ERP za popis zadataka i detalje.\n\nLijep pozdrav,\nECON D.O.O. ERP`;
  window.open(`mailto:${zaposlenik.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
  return true;
};

// Prijevodi teksta na PDF-u ponude — samo strukturni natpisi (naslovi, oznake, standardne
// stavke koje app sama generira); slobodni tekst koji je korisnik upisao (djelatnost, napomena,
// ostale stavke, naziv posla) ostaje kakav je upisan jer se ne može pouzdano strojno prevesti.
const PRIJEVODI_PONUDE = {
  hr: {
    ponuda: "PONUDA", broj: "Broj", narucitelj: "Naručitelj:", oib: "OIB",
    datumPonude: "Datum ponude:", vrijediDo: "Ponuda vrijedi do:", predmet: "Predmet:",
    tehnickiOpis: "Tehnički opis konstrukcije", poz: "Poz.", naziv: "Naziv", kom: "Kom.",
    jedCijena: "Jedinična cijena", ukupnaCijena: "Ukupna cijena",
    osnovica: "Osnovica:", pdv: "PDV", ukupno: "UKUPNO:", napomena: "Napomena:",
    uvjeti: "Uvjeti plaćanja i rok isporuke definiraju se ugovorom/narudžbom po prihvaćanju ponude.",
    postovanje: "S poštovanjem,",
    upisano: "Poduzeće je upisano na", mbs: "MBS", uprava: "Uprava",
  },
  de: {
    ponuda: "ANGEBOT", broj: "Nummer", narucitelj: "Auftraggeber:", oib: "USt-IdNr. (HR)",
    datumPonude: "Angebotsdatum:", vrijediDo: "Angebot gültig bis:", predmet: "Betreff:",
    tehnickiOpis: "Technische Beschreibung der Konstruktion", poz: "Pos.", naziv: "Bezeichnung", kom: "Stk.",
    jedCijena: "Einzelpreis", ukupnaCijena: "Gesamtpreis",
    osnovica: "Nettobetrag:", pdv: "MwSt.", ukupno: "GESAMT:", napomena: "Anmerkung:",
    uvjeti: "Zahlungsbedingungen und Lieferfrist werden nach Annahme des Angebots im Vertrag/der Bestellung festgelegt.",
    postovanje: "Mit freundlichen Grüßen,",
    upisano: "Das Unternehmen ist eingetragen beim", mbs: "MBS", uprava: "Geschäftsführung",
    napomenaPorez: "Preis versteht sich ausschließlich gesetzliche Mehrwertsteuer",
  },
};

// Standardni uvjeti za njemačku varijantu ponude — automatski se upiše u novu ponudu, ostaje
// slobodno uredljiv (Rekapitulacija → "Uvjeti za njemačku ponudu") jer se razlikuje od posla do posla.
const NJEMACKI_UVJETI_ZADANO = `Allgemein:
-Material: S235
-Korrosionsschutz: ohne
-Transport: nach München
-Abrechnung: Gemäß den tatsächlichen Längen. Die Länge des Geländers verläuft parallel zur Länge des oberen Flansches des Geländers.
-Herstellung nach: nach beigefügten Zeichnung
- Stahlkonstruktion nach EN 1090-2, EXC2
-Lieferzeit: nach Absprache, ca. 5KW nach nach Erhalt der Zeichnungen

Im Angebot nicht enthalten:
-\tVerbindungsmaterialien (Bauseits)
-\tStatische Nachweise (Bauseits)
-\tMontage (Bauseits)

Zahlung: 14 Kalendertage nach Lieferung

Angebot 30 Tage gültig.`;

function PonudaPrintModal({ ponuda, kupac, db, onClose }) {
  const [jezik, setJezik] = useState("hr");
  const L = PRIJEVODI_PONUDE[jezik];
  const t = db.postavkeTvrtke || {};
  const izradio = db.zaposlenici.find((z) => z.id === ponuda.izradioId);
  const calc = izracunPonude(ponuda, db.materijali, db.cjenikRada, db.katalogProfila, db.kvaliteteMaterijala);
  const pdvStopa = Number(t.pdvStopa ?? 25);
  // Cijena po stavci (sa maržom) — ista formula kao u Rekapitulaciji; osnovica ponude je zbroj
  // cijena svih stavki, umjesto zasebnog "Komercijalna ponuda" popisa troškova.
  const cijenePozicija = (ponuda.pozicije || []).map((p) => ({
    p,
    cijena: cijenaPozicijeSaMarzom(p, { cjenikRada: db.cjenikRada, katalog: db.katalogProfila, kvalitete: db.kvaliteteMaterijala, satnicaMontaza: ponuda.satnicaMontaza, materijaliSkladiste: db.materijali, postotakMarze: calc.postotakMarze }),
  }));
  const osnovica = cijenePozicija.reduce((s, r) => s + r.cijena, 0);
  const pdvIznos = osnovica * (pdvStopa / 100);
  const ukupno = osnovica + pdvIznos;

  return (
    <Modal wide title={`Pregled za ispis — Ponuda ${ponuda.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => ispisPdf(ponuda.broj)}>Ispis / Spremi kao PDF</Btn></>}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Jezik ponude:</span>
        <Btn size="sm" variant={jezik === "hr" ? "primary" : "ghost"} onClick={() => setJezik("hr")}>Hrvatski</Btn>
        <Btn size="sm" variant={jezik === "de" ? "primary" : "ghost"} onClick={() => setJezik("de")}>Deutsch</Btn>
      </div>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{L.ponuda}</div>
            <div className="f-mono" style={{ fontSize: 13 }}>{L.broj}: {ponuda.broj}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.naziv}</div>
            <div style={{ fontSize: 9.5, color: "#555", maxWidth: 260 }}>{t.djelatnost}</div>
            <div>{t.adresa}</div>
            <div>{t.telefon}</div>
            <div>{t.email}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 11.5 }}>
          <div>
            <div style={{ color: "#555", marginBottom: 3 }}>{L.narucitelj}</div>
            <div style={{ fontWeight: 700 }}>{kupac?.naziv || "—"}</div>
            <div>{kupac?.adresa}</div>
            {kupac?.oib && <div>{L.oib}: {kupac.oib}</div>}
          </div>
          <table style={{ borderCollapse: "collapse", height: "fit-content" }}>
            <tbody>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>{L.datumPonude}</td><td style={{ fontWeight: 600 }}>{fmtDate(ponuda.datum)}</td></tr>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>{L.vrijediDo}</td><td style={{ fontWeight: 600 }}>{fmtDate(addDays(ponuda.datum, 30))}</td></tr>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>{L.predmet}</td><td style={{ fontWeight: 600 }}>{ponuda.naziv}</td></tr>
            </tbody>
          </table>
        </div>

        {jezik === "de" && (
          <div style={{ fontSize: 11, marginBottom: 16 }}>
            <div>{ponuda.kontaktOsobaTitula === "frau" ? "Sehr geehrte Frau" : "Sehr geehrter Herr"} {ponuda.kontaktOsoba || "___"},</div>
            <div style={{ marginTop: 8 }}>vielen Dank auf Ihre Anfrage.</div>
            <div>Aufgrund Ihrer Anfrage hiermit unsere Angebot für die Material, Herstellung und Lieferung zwar wie folgt:</div>
          </div>
        )}

        {cijenePozicija.length > 0 && (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>{L.tehnickiOpis}</div>
            <table className="doc-table" style={{ marginBottom: 16 }}>
              <thead><tr><th style={{ width: 34 }}>{L.poz}</th><th>{L.naziv}</th><th style={{ width: 55 }}>{L.kom}</th><th style={{ width: 95 }}>{L.jedCijena}</th><th style={{ width: 95 }}>{L.ukupnaCijena}</th></tr></thead>
              <tbody>
                {cijenePozicija.map(({ p, cijena }) => (
                  <tr key={p.id}>
                    <td>{p.oznaka}</td>
                    <td>{p.naziv}{p.opis && <div style={{ fontSize: 9.5, color: "#555", marginTop: 2, whiteSpace: "pre-line" }}>{p.opis}</div>}</td>
                    <td>{p.kolicina}</td>
                    <td>{fmtCurDec(cijena / (Number(p.kolicina) || 1))}</td>
                    <td>{fmtCurDec(cijena)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: jezik === "de" ? 6 : 20 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 240 }}>
            <tbody>
              {jezik === "de" ? (
                <tr><td style={{ padding: "3px 14px 0 0", fontWeight: 700 }}>{L.ukupno}</td><td style={{ textAlign: "right", fontWeight: 700, fontSize: 14 }}>{fmtCurDec(osnovica)}</td></tr>
              ) : (
                <>
                  <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>{L.osnovica}</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(osnovica)}</td></tr>
                  <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>{L.pdv} ({pdvStopa}%):</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(pdvIznos)}</td></tr>
                  <tr style={{ borderTop: "1px solid #333" }}><td style={{ padding: "6px 14px 0 0", fontWeight: 700 }}>{L.ukupno}</td><td style={{ textAlign: "right", fontWeight: 700, paddingTop: 6, fontSize: 14 }}>{fmtCurDec(ukupno)}</td></tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        {jezik === "de" && <div style={{ fontSize: 10, color: "#555", textAlign: "right", marginBottom: 20 }}>{L.napomenaPorez}</div>}

        {jezik === "de" && ponuda.napomenaNjemacki && (
          <div style={{ fontSize: 10.5, marginBottom: 20, whiteSpace: "pre-line" }}>{ponuda.napomenaNjemacki}</div>
        )}

        {ponuda.napomena && <div style={{ fontSize: 11, marginBottom: 16 }}><strong>{L.napomena}</strong> {ponuda.napomena}</div>}

        <div style={{ fontSize: 11, marginBottom: 20 }}>
          {jezik !== "de" && <div>{L.uvjeti}</div>}
          <div style={{ marginTop: 10 }}>{L.postovanje}</div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 700 }}>{t.naziv}</div>
            {izradio && (
              <>
                <div>{izradio.prezime} {izradio.ime}</div>
                {izradio.telefon && <div>Mobil: {izradio.telefon}</div>}
                {izradio.email && <div>e-Mail: {izradio.email}</div>}
              </>
            )}
          </div>
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>{L.oib}</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | {L.upisano} {t.sud}, <strong>{L.mbs}:</strong> {t.mbs} | <strong>{L.uprava}:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

const prazanFormatLasera = (tipLasera) => (tipLasera === "cijevni"
  ? { id: uid("frm"), duzinaMM: 1000, komada: 1, kgPoM: 0, cijenaMaterijalaEurKg: 0.9 }
  : { id: uid("frm"), duzinaMM: 1000, sirinaMM: 1000, debljinaMM: 3, komada: 1, kvaliteta: "celik", cijenaMaterijalaEurKg: 0.9 });

// Jedan format (dimenzija) unutar stavke — stavka može imati više formata (npr. više različitih
// limova ili profila) koji dijele isti opis i isto vrijeme rezanja/pripreme.
function FormatLaseraRedak({ format: f, tipLasera, kvalitete, onAzuriraj, onObrisi, jedini }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: "6px 0", borderBottom: "1px dashed var(--line)" }}>
      {tipLasera === "cijevni" ? (
        <>
          <div style={{ width: 100 }}><label className="label">Dužina (mm)</label><input className="input f-mono" type="number" min="0" value={f.duzinaMM} onChange={(e) => onAzuriraj({ duzinaMM: e.target.value })} /></div>
          <div style={{ width: 80 }}><label className="label">Komada</label><input className="input f-mono" type="number" min="0" value={f.komada} onChange={(e) => onAzuriraj({ komada: e.target.value })} /></div>
          <div style={{ width: 100 }}><label className="label">Masa po m' (kg/m)</label><input className="input f-mono" type="number" min="0" step="0.01" value={f.kgPoM} onChange={(e) => onAzuriraj({ kgPoM: e.target.value })} /></div>
        </>
      ) : (
        <>
          <div style={{ width: 95 }}><label className="label">Dužina (mm)</label><input className="input f-mono" type="number" min="0" value={f.duzinaMM} onChange={(e) => onAzuriraj({ duzinaMM: e.target.value })} /></div>
          <div style={{ width: 95 }}><label className="label">Širina (mm)</label><input className="input f-mono" type="number" min="0" value={f.sirinaMM} onChange={(e) => onAzuriraj({ sirinaMM: e.target.value })} /></div>
          <div style={{ width: 85 }}><label className="label">Debljina (mm)</label><input className="input f-mono" type="number" min="0" step="0.1" value={f.debljinaMM} onChange={(e) => onAzuriraj({ debljinaMM: e.target.value })} /></div>
          <div style={{ width: 70 }}><label className="label">Komada</label><input className="input f-mono" type="number" min="0" value={f.komada} onChange={(e) => onAzuriraj({ komada: e.target.value })} /></div>
          <div style={{ width: 165 }}>
            <label className="label">Kvaliteta materijala</label>
            <select className="select" value={f.kvaliteta} onChange={(e) => onAzuriraj({ kvaliteta: e.target.value })}>
              {(kvalitete && kvalitete.length ? kvalitete : ZADANE_KVALITETE_MATERIJALA).map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}
            </select>
          </div>
        </>
      )}
      <div style={{ width: 110 }}><label className="label">Cijena materijala (€/kg)</label><input className="input f-mono" type="number" min="0" step="0.01" value={f.cijenaMaterijalaEurKg} onChange={(e) => onAzuriraj({ cijenaMaterijalaEurKg: e.target.value })} /></div>
      <div style={{ marginLeft: "auto", textAlign: "right" }}>
        <label className="label">Masa</label>
        <div className="f-mono" style={{ fontWeight: 600, fontSize: 13 }}>{(f.masaKg || 0).toFixed(1)} kg</div>
      </div>
      {!jedini && <button className="btn btn-icon btn-ghost" onClick={onObrisi}><X size={14} /></button>}
    </div>
  );
}

// Redak jedne stavke ponude za lasersko rezanje — tip lasera bira koji se uređaj/satnica koristi
// (pločasti = rezanje limova po dimenzijama i gustoći kvalitete; cijevni = rezanje po dužini i
// masi po m', isti princip kao profili na skladištu). Jedna stavka može sadržavati više formata
// (npr. više različitih limova/profila) koji dijele isti opis i isto vrijeme rezanja/pripreme —
// masa/trošak materijala zbrajaju se preko svih formata, a masa/trošak stavke prikazuju uživo.
function LaserStavkaRedak({ stavka: s, kvalitete, onAzuriraj, onObrisi }) {
  const izracun = izracunStavkeLasera(s, s._cjenik, kvalitete);
  const formati = izracun.formati;
  const promijeniTip = (noviTip) => onAzuriraj({ tipLasera: noviTip, formati: [prazanFormatLasera(noviTip)] });
  const azurirajFormat = (fid, patch) => onAzuriraj({ formati: (s.formati || []).map((f) => (f.id === fid ? { ...f, ...patch } : f)) });
  const obrisiFormat = (fid) => onAzuriraj({ formati: (s.formati || []).filter((f) => f.id !== fid) });
  const dodajFormat = () => onAzuriraj({ formati: [...(s.formati || []), prazanFormatLasera(s.tipLasera)] });

  return (
    <div className="card" style={{ padding: 10, marginBottom: 8, background: "var(--surface-alt)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}><label className="label">Opis stavke</label><input className="input" value={s.opis} onChange={(e) => onAzuriraj({ opis: e.target.value })} /></div>
        <div style={{ width: 150 }}>
          <label className="label">Tip lasera</label>
          <select className="select" value={s.tipLasera} onChange={(e) => promijeniTip(e.target.value)}>
            <option value="plocasti">Pločasti (limovi)</option>
            <option value="cijevni">Cijevni (profili)</option>
          </select>
        </div>
        <button className="btn btn-icon btn-ghost" onClick={onObrisi}><X size={14} /></button>
      </div>

      <div style={{ marginTop: 8 }}>
        <div className="label" style={{ marginBottom: 2 }}>Formati (limovi/profili u ovoj stavci)</div>
        {formati.map((f) => (
          <FormatLaseraRedak
            key={f.id} format={f} tipLasera={s.tipLasera} kvalitete={kvalitete} jedini={formati.length === 1}
            onAzuriraj={(patch) => azurirajFormat(f.id, patch)} onObrisi={() => obrisiFormat(f.id)}
          />
        ))}
        <Btn variant="ghost" size="sm" icon={Plus} onClick={dodajFormat} style={{ marginTop: 6 }}>Dodaj format</Btn>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-strong)" }}>
        <div style={{ width: 90 }}><label className="label">Rezanje (min)</label><input className="input f-mono" type="number" min="0" value={s.rezanjeMin} onChange={(e) => onAzuriraj({ rezanjeMin: e.target.value })} /></div>
        <div style={{ width: 90 }}><label className="label">Priprema (min)</label><input className="input f-mono" type="number" min="0" value={s.pripremaMin} onChange={(e) => onAzuriraj({ pripremaMin: e.target.value })} /></div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <label className="label">Masa / Trošak stavke</label>
          <div className="f-mono" style={{ fontWeight: 700, fontSize: 14 }}>{izracun.masaKg.toFixed(1)} kg · {fmtCurDec(izracun.ukupno)}</div>
        </div>
      </div>
    </div>
  );
}

function PonudaLaseraModal({ form, setForm, db, onSave, onClose }) {
  const calc = izracunPonudeLasera(form, db.kvaliteteMaterijala);
  const prazanRed = () => ({ id: uid("lst"), opis: "", tipLasera: "plocasti", rezanjeMin: 0, pripremaMin: 0, formati: [prazanFormatLasera("plocasti")] });
  const azurirajStavku = (id, patch) => setForm({ ...form, stavke: form.stavke.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const obrisiStavku = (id) => setForm({ ...form, stavke: form.stavke.filter((s) => s.id !== id) });
  const azurirajCjenik = (patch) => setForm({ ...form, cjenik: { ...prazniCjenikLasera(), ...form.cjenik, ...patch } });
  // Kartice — isti princip kao Pozicije/Materijal/Rekapitulacija kod obične ponude: "Stavke
  // rezanja" su unos, "Materijal" je izvedeni pregled potrebnog sirovog materijala (bez
  // optimizacije po standardnim dužinama/limovima jer stavke lasera nemaju katalošku vezu,
  // za razliku od pozicija konstrukcije), a "Rekapitulacija" je čist pregled troška po stavci.
  const [aktivnaKartica, setAktivnaKartica] = useState("stavke");
  // Materijal se prikazuje po FORMATU (ne po stavci) jer jedna stavka može sadržavati više
  // različitih dimenzija — svaki format nosi opis svoje matične stavke radi snalaženja.
  const uzTrosakFormata = (s) => s.formati.map((f) => ({ ...f, opis: s.opis, trosakMaterijala: f.masaKg * (Number(f.cijenaMaterijalaEurKg) || 0) }));
  const formatiProfili = calc.stavke.filter((s) => s.tipLasera === "cijevni").flatMap(uzTrosakFormata);
  const formatiLimovi = calc.stavke.filter((s) => s.tipLasera !== "cijevni").flatMap(uzTrosakFormata);

  return (
    <Modal wide title={form.id ? `Ponuda za laser ${form.broj}` : "Nova ponuda za laser"} onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={onSave}>Spremi</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
        <Field label="Naziv posla"><input className="input" placeholder="npr. Usluga laserskog rezanja" value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} /></Field>
        <Field label="Kupac"><select className="select" value={form.kupacId} onChange={(e) => setForm({ ...form, kupacId: e.target.value })}>{db.kupci.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}</select></Field>
        <Field label="Datum"><input className="input" type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} /></Field>
      </div>
      <Field label="Status"><select className="select" style={{ maxWidth: 220 }} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["U izradi", "Poslana", "Prihvaćena", "Odbijena"].map((s) => <option key={s}>{s}</option>)}</select></Field>

      <div className="label" style={{ marginTop: 6 }}>Satnice i dodatak (vrijede za ovu ponudu)</div>
      <div className="card" style={{ padding: 14, background: "var(--surface-alt)", marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          <Field label="Pločasti laser (€/h)"><input className="input f-mono" type="number" min="0" step="1" value={form.cjenik?.plocastiEurH ?? 0} onChange={(e) => azurirajCjenik({ plocastiEurH: Number(e.target.value) || 0 })} /></Field>
          <Field label="Priprema pločasti (€/h)"><input className="input f-mono" type="number" min="0" step="1" value={form.cjenik?.pripremaPlocastiEurH ?? 0} onChange={(e) => azurirajCjenik({ pripremaPlocastiEurH: Number(e.target.value) || 0 })} /></Field>
          <div />
          <Field label="Cijevni laser (€/h)"><input className="input f-mono" type="number" min="0" step="1" value={form.cjenik?.cijevniEurH ?? 0} onChange={(e) => azurirajCjenik({ cijevniEurH: Number(e.target.value) || 0 })} /></Field>
          <Field label="Priprema cijevni (€/h)"><input className="input f-mono" type="number" min="0" step="1" value={form.cjenik?.pripremaCijevniEurH ?? 0} onChange={(e) => azurirajCjenik({ pripremaCijevniEurH: Number(e.target.value) || 0 })} /></Field>
          <div />
          <Field label="Savijanje (€/h)"><input className="input f-mono" type="number" min="0" step="1" value={form.cjenik?.savijanjeEurH ?? 0} onChange={(e) => azurirajCjenik({ savijanjeEurH: Number(e.target.value) || 0 })} /></Field>
          <Field label="Dodatak (%)"><input className="input f-mono" type="number" min="0" step="0.5" value={form.cjenik?.dodatakPct ?? 0} onChange={(e) => azurirajCjenik({ dodatakPct: Number(e.target.value) || 0 })} /></Field>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 12 }}>
        <div className={`nav-tab ${aktivnaKartica === "stavke" ? "active" : ""}`} onClick={() => setAktivnaKartica("stavke")} style={{ padding: "6px 12px", fontSize: 12.5 }}>Stavke rezanja</div>
        <div className={`nav-tab ${aktivnaKartica === "materijal" ? "active" : ""}`} onClick={() => setAktivnaKartica("materijal")} style={{ padding: "6px 12px", fontSize: 12.5 }}>Materijal</div>
        <div className={`nav-tab ${aktivnaKartica === "rekap" ? "active" : ""}`} onClick={() => setAktivnaKartica("rekap")} style={{ padding: "6px 12px", fontSize: 12.5, fontWeight: 600 }}>Rekapitulacija</div>
      </div>

      {aktivnaKartica === "stavke" && (
        <>
          <div className="label" style={{ marginBottom: 4 }}>Stavke rezanja</div>
          {form.stavke.length === 0 && <div style={{ textAlign: "center", color: "var(--ink-faint)", padding: "14px 0", fontSize: 13 }}>Nema stavki. Dodaj stavku rezanja.</div>}
          {form.stavke.map((s) => (
            <LaserStavkaRedak key={s.id} stavka={{ ...s, _cjenik: calc.cjenik }} kvalitete={db.kvaliteteMaterijala} onAzuriraj={(patch) => azurirajStavku(s.id, patch)} onObrisi={() => obrisiStavku(s.id)} />
          ))}
          <Btn variant="ghost" size="sm" icon={Plus} onClick={() => setForm({ ...form, stavke: [...form.stavke, prazanRed()] })} style={{ marginBottom: 16 }}>Dodaj stavku rezanja</Btn>

          <div className="label" style={{ marginBottom: 4 }}>Savijanje (opcionalno)</div>
          <div className="card" style={{ padding: 14, background: "var(--surface-alt)", marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            <Field label="Broj pregiba"><input className="input f-mono" type="number" min="0" value={form.savijanje?.brojPregiba ?? 0} onChange={(e) => setForm({ ...form, savijanje: { ...form.savijanje, brojPregiba: e.target.value } })} /></Field>
            <Field label="Min. po komadu"><input className="input f-mono" type="number" min="0" step="0.5" value={form.savijanje?.minPoKom ?? 0} onChange={(e) => setForm({ ...form, savijanje: { ...form.savijanje, minPoKom: e.target.value } })} /></Field>
            <div><div className="label">Trošak savijanja</div><div className="f-mono" style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>{fmtCurDec(calc.trosakSavijanja)}</div></div>
          </div>

          <Field label="Ostale stavke (crtanje, transport…)"><LineItemsEditor mode="custom" rows={form.ostaleStavke} setRows={(rows) => setForm({ ...form, ostaleStavke: rows })} /></Field>
          <Field label="Napomena"><textarea className="textarea" rows={2} value={form.napomena} onChange={(e) => setForm({ ...form, napomena: e.target.value })} /></Field>
        </>
      )}

      {aktivnaKartica === "materijal" && (
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Profili (cijevni laser) — potrebna dužina i masa</div>
          {formatiProfili.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--ink-faint)", padding: "12px 0", fontSize: 13, marginBottom: 16 }}>Nema stavki cijevnog lasera.</div>
          ) : (
            <table className="erp-table" style={{ marginBottom: 16 }}>
              <thead><tr><th>Stavka</th><th style={{ width: 90 }}>Dužina (m)</th><th style={{ width: 70 }}>Komada</th><th style={{ width: 90 }}>Masa (kg)</th><th style={{ width: 110 }}>Trošak materijala</th></tr></thead>
              <tbody>
                {formatiProfili.map((f) => (
                  <tr key={f.id}>
                    <td>{f.opis || "—"}</td>
                    <td className="f-mono">{((Number(f.duzinaMM) || 0) / 1000).toFixed(2)}</td>
                    <td className="f-mono">{f.komada}</td>
                    <td className="f-mono">{f.masaKg.toFixed(1)}</td>
                    <td className="f-mono">{fmtCurDec(f.trosakMaterijala)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: "1px solid var(--line-strong)" }}>
                  <td>Ukupno</td>
                  <td className="f-mono">{formatiProfili.reduce((s, x) => s + ((Number(x.duzinaMM) || 0) / 1000) * (Number(x.komada) || 0), 0).toFixed(2)}</td>
                  <td className="f-mono">{formatiProfili.reduce((s, x) => s + (Number(x.komada) || 0), 0)}</td>
                  <td className="f-mono">{formatiProfili.reduce((s, x) => s + x.masaKg, 0).toFixed(1)}</td>
                  <td className="f-mono">{fmtCurDec(formatiProfili.reduce((s, x) => s + x.trosakMaterijala, 0))}</td>
                </tr>
              </tfoot>
            </table>
          )}

          <div className="label" style={{ marginBottom: 6 }}>Limovi (pločasti laser) — potrebna površina i masa</div>
          {formatiLimovi.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--ink-faint)", padding: "12px 0", fontSize: 13 }}>Nema stavki pločastog lasera.</div>
          ) : (
            <table className="erp-table">
              <thead><tr><th>Stavka</th><th style={{ width: 90 }}>Površina (m²)</th><th style={{ width: 70 }}>Komada</th><th style={{ width: 90 }}>Masa (kg)</th><th style={{ width: 110 }}>Trošak materijala</th></tr></thead>
              <tbody>
                {formatiLimovi.map((f) => (
                  <tr key={f.id}>
                    <td>{f.opis || "—"}</td>
                    <td className="f-mono">{(((Number(f.duzinaMM) || 0) * (Number(f.sirinaMM) || 0)) / 1e6 * (Number(f.komada) || 0)).toFixed(2)}</td>
                    <td className="f-mono">{f.komada}</td>
                    <td className="f-mono">{f.masaKg.toFixed(1)}</td>
                    <td className="f-mono">{fmtCurDec(f.trosakMaterijala)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: "1px solid var(--line-strong)" }}>
                  <td>Ukupno</td>
                  <td className="f-mono">{formatiLimovi.reduce((s, x) => s + ((Number(x.duzinaMM) || 0) * (Number(x.sirinaMM) || 0)) / 1e6 * (Number(x.komada) || 0), 0).toFixed(2)}</td>
                  <td className="f-mono">{formatiLimovi.reduce((s, x) => s + (Number(x.komada) || 0), 0)}</td>
                  <td className="f-mono">{formatiLimovi.reduce((s, x) => s + x.masaKg, 0).toFixed(1)}</td>
                  <td className="f-mono">{fmtCurDec(formatiLimovi.reduce((s, x) => s + x.trosakMaterijala, 0))}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {aktivnaKartica === "rekap" && (
        <table className="erp-table">
          <thead><tr><th>Stavka</th><th style={{ width: 70 }}>Masa (kg)</th><th style={{ width: 90 }}>Rezanje</th><th style={{ width: 90 }}>Priprema</th><th style={{ width: 100 }}>Materijal</th><th style={{ width: 100 }}>Ukupno</th></tr></thead>
          <tbody>
            {calc.stavke.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-faint)" }}>Nema stavki.</td></tr>}
            {calc.stavke.map((s) => (
              <tr key={s.id}>
                <td>{s.opis || "—"} <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>({s.tipLasera === "cijevni" ? "cijevni" : "pločasti"})</span></td>
                <td className="f-mono">{s.masaKg.toFixed(1)}</td>
                <td className="f-mono">{fmtCurDec(s.trosakRezanja)}</td>
                <td className="f-mono">{fmtCurDec(s.trosakPripreme)}</td>
                <td className="f-mono">{fmtCurDec(s.trosakMaterijala)}</td>
                <td className="f-mono" style={{ fontWeight: 600 }}>{fmtCurDec(s.ukupno)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "1px solid var(--line-strong)" }}><td colSpan={5} style={{ textAlign: "right" }}>Zbroj stavki rezanja</td><td className="f-mono" style={{ fontWeight: 600 }}>{fmtCurDec(calc.zbrojStavki)}</td></tr>
            <tr><td colSpan={5} style={{ textAlign: "right" }}>Dodatak ({calc.dodatakPct}%)</td><td className="f-mono">{fmtCurDec(calc.iznosDodatka)}</td></tr>
            <tr><td colSpan={5} style={{ textAlign: "right" }}>Savijanje + ostalo</td><td className="f-mono">{fmtCurDec(calc.trosakSavijanja + calc.trosakOstalo)}</td></tr>
            <tr style={{ borderTop: "2px solid var(--line-strong)" }}><td colSpan={5} style={{ textAlign: "right", fontWeight: 700 }}>KONAČNA CIJENA PONUDE</td><td className="f-mono" style={{ fontWeight: 700, fontSize: 15, color: "var(--steel)" }}>{fmtCurDec(calc.cijenaKonacna)}</td></tr>
          </tfoot>
        </table>
      )}
    </Modal>
  );
}

function PonudaLaseraPrintModal({ ponuda, kupac, db, onClose }) {
  const t = db.postavkeTvrtke || {};
  const calc = izracunPonudeLasera(ponuda, db.kvaliteteMaterijala);
  const pdvStopa = Number(t.pdvStopa ?? 25);
  const pdvIznos = calc.cijenaKonacna * (pdvStopa / 100);
  const ukupnoSPdv = calc.cijenaKonacna + pdvIznos;
  // Dodatak se ne navodi kao posebna stavka na ispisu — uračunat je izravno u cijenu svake
  // stavke rezanja (isto kao uvećanje kod standardnih ponuda).
  const faktorDodatka = 1 + (calc.dodatakPct || 0) / 100;

  return (
    <Modal wide title={`Pregled za ispis — Ponuda za laser ${ponuda.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => ispisPdf(ponuda.broj)}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>PONUDA — USLUGA LASERSKOG REZANJA</div>
            <div className="f-mono" style={{ fontSize: 13 }}>Broj: {ponuda.broj}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.naziv}</div>
            <div style={{ fontSize: 9.5, color: "#555", maxWidth: 260 }}>{t.djelatnost}</div>
            <div>{t.adresa}</div>
            <div>{t.telefon}</div>
            <div>{t.email}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 11.5 }}>
          <div>
            <div style={{ color: "#555", marginBottom: 3 }}>Naručitelj:</div>
            <div style={{ fontWeight: 700 }}>{kupac?.naziv || "—"}</div>
            <div>{kupac?.adresa}</div>
            {kupac?.oib && <div>OIB: {kupac.oib}</div>}
          </div>
          <table style={{ borderCollapse: "collapse", height: "fit-content" }}>
            <tbody>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Datum ponude:</td><td style={{ fontWeight: 600 }}>{fmtDate(ponuda.datum)}</td></tr>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Ponuda vrijedi do:</td><td style={{ fontWeight: 600 }}>{fmtDate(addDays(ponuda.datum, 30))}</td></tr>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Predmet:</td><td style={{ fontWeight: 600 }}>{ponuda.naziv}</td></tr>
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Stavke rezanja</div>
        <table className="doc-table" style={{ marginBottom: 16 }}>
          <thead><tr><th>Opis</th><th style={{ width: 90 }}>Tip lasera</th><th style={{ width: 55 }}>Kom.</th><th style={{ width: 90 }}>Iznos</th></tr></thead>
          <tbody>
            {calc.stavke.map((s) => (
              <tr key={s.id}>
                <td>{s.opis || "—"}</td>
                <td>{s.tipLasera === "cijevni" ? "Cijevni" : "Pločasti"}</td>
                <td className="f-mono">{s.formati.reduce((sum, f) => sum + (Number(f.komada) || 0), 0)}</td>
                <td className="f-mono">{fmtCurDec(s.ukupno * faktorDodatka)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {(ponuda.ostaleStavke || []).length > 0 && (
          <table className="doc-table" style={{ marginBottom: 16 }}>
            <thead><tr><th>Ostale stavke</th><th style={{ width: 100 }}>Iznos</th></tr></thead>
            <tbody>{ponuda.ostaleStavke.map((r, i) => <tr key={i}><td>{r.opis}</td><td className="f-mono">{fmtCurDec((Number(r.kolicina) || 0) * (Number(r.cijenaJed) || 0))}</td></tr>)}</tbody>
          </table>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 260 }}>
            <tbody>
              {calc.trosakSavijanja > 0 && <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>Savijanje:</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(calc.trosakSavijanja)}</td></tr>}
              {calc.trosakOstalo > 0 && <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>Ostalo:</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(calc.trosakOstalo)}</td></tr>}
              <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>Osnovica:</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(calc.cijenaKonacna)}</td></tr>
              <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>PDV ({pdvStopa}%):</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(pdvIznos)}</td></tr>
              <tr style={{ borderTop: "1px solid #333" }}><td style={{ padding: "6px 14px 0 0", fontWeight: 700 }}>UKUPNO:</td><td style={{ textAlign: "right", fontWeight: 700, paddingTop: 6, fontSize: 14 }}>{fmtCurDec(ukupnoSPdv)}</td></tr>
            </tbody>
          </table>
        </div>

        {ponuda.napomena && <div style={{ fontSize: 11, marginBottom: 16 }}><strong>Napomena:</strong> {ponuda.napomena}</div>}

        <div style={{ fontSize: 11, marginBottom: 20 }}>
          <div>Uvjeti plaćanja i rok isporuke definiraju se ugovorom/narudžbom po prihvaćanju ponude.</div>
          <div style={{ marginTop: 10 }}>S poštovanjem,</div>
          <div style={{ fontWeight: 700, marginTop: 8 }}>{t.naziv}</div>
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

function ProjektiPage({ db, update, patchProjekt, patchProjekti, patchUpiti, showToast, setPage, mojaPozicija, mojId, otvoriProjektId, ocistiOtvoriProjekt }) {
  const dozvKartice = dozvoljeneKarticeModula(mojaPozicija, "projekti");
  const [tab, setTab] = useState(dozvKartice[0]?.key || "projekti");
  useEffect(() => { if (!dozvKartice.some((k) => k.key === tab)) setTab(dozvKartice[0]?.key || "projekti"); }, [dozvKartice, tab]);
  const mozeProjekti = dozvolaZaKarticu(mojaPozicija, "projekti", "projekti").izmjene;
  const mozePonude = dozvolaZaKarticu(mojaPozicija, "projekti", "ponude").izmjene;
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);

  // Dok nitko ručno ne posloži redoslijed (povlačenjem), projekti se prirodno sortiraju po
  // šifri. Čim se bilo koji projekt jednom ručno povuče, SVI projekti dobiju eksplicitan
  // "poredak" (potpuni snapshot trenutnog redoslijeda) i taj poredak od tad vrijedi umjesto
  // automatskog sortiranja — dok ga netko ne vrati na automatski.
  const imaRucniPoredak = db.projekti.some((p) => p.poredak != null);
  // Završeni projekti se ne prikazuju među aktivnim (lista bi inače samo rasla) — imaju svoju
  // zasebnu karticu "Završeni projekti".
  const projektiSortirani = useMemo(() => {
    const lista = db.projekti.filter((p) => p.status !== "Završen");
    lista.sort(imaRucniPoredak ? (a, b) => (a.poredak ?? Infinity) - (b.poredak ?? Infinity) : (a, b) => usporediPrirodno(a.sifra, b.sifra));
    return lista;
  }, [db.projekti, imaRucniPoredak]);
  const projektiZavrseni = useMemo(() => [...db.projekti].filter((p) => p.status === "Završen").sort((a, b) => (b.rokZavrsetka || "").localeCompare(a.rokZavrsetka || "")), [db.projekti]);
  // Ispis popisa u PDF (novi prozor + dijalog za ispis, "Spremi kao PDF"). zaglavlja: [naziv stupca],
  // redovi: [[ćelije kao tekst]]; ćelije u zaglavlju koje počinju s "#" ispisuju se monospace fontom.
  const ispisiTablicu = (naslov, zaglavlja, redovi) => {
    const css = "body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:10px;margin:0}h1{font-size:15px;margin:0 0 2px}.sub{color:#555;margin-bottom:8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eee;font-size:9.5px}thead{display:table-header-group}tr{page-break-inside:avoid}.m{font-family:Consolas,monospace;white-space:nowrap}@page{size:A4 landscape;margin:10mm}";
    const mono = zaglavlja.map((z) => z.startsWith("#"));
    const tijelo = redovi.map((r) => "<tr>" + r.map((c, i) => `<td${mono[i] ? " class=\"m\"" : ""}>${escHtml(c)}</td>`).join("") + "</tr>").join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(naslov)}</title><style>${css}</style></head><body><h1>${escHtml(db.postavkeTvrtke?.naziv || "ECON d.o.o.")} — ${escHtml(naslov)}</h1><div class="sub">Ispisano ${escHtml(fmtDate(todayISO()))} · ${redovi.length} zapisa</div><table><thead><tr>${zaglavlja.map((z) => `<th>${escHtml(z.replace(/^#/, ""))}</th>`).join("")}</tr></thead><tbody>${tijelo}</tbody></table></body></html>`;
    const w = window.open("", "_blank");
    if (!w) { showToast("Preglednik je blokirao novi prozor — dozvoli skočne prozore za ovu stranicu i pokušaj ponovno."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };
  const ispisiProjekte = (lista, naslov) => {
    const imeVoditelja = (id) => { const v = db.zaposlenici.find((z) => z.id === id); return v ? `${v.prezime} ${v.ime}` : ""; };
    ispisiTablicu(naslov, ["#Šifra", "Naziv", "Voditelj", "Kupac", "#Broj narudžbe", "#Rok završetka", "Status"], lista.map((p) => [
      p.sifra, p.naziv, imeVoditelja(p.voditeljId), db.kupci.find((k) => k.id === p.kupacId)?.naziv || "",
      db.narudzbe.filter((n) => n.projektId === p.id && n.broj).map((n) => n.broj).join(", "), p.rokZavrsetka ? fmtDate(p.rokZavrsetka) : "", p.status,
    ]));
  };
  const ispisiPonude = (lista, naslov, laser) => {
    ispisiTablicu(naslov, ["#Broj", "Naziv posla", "Kupac", ...(laser ? [] : ["#Sati"]), "#Vrijednost", "Status", "Projekt"], lista.map((p) => {
      const izr = laser ? izracunPonudeLasera(p, db.kvaliteteMaterijala) : izracunPonude(p, db.materijali, db.cjenikRada, db.katalogProfila, db.kvaliteteMaterijala);
      return [p.broj, p.naziv, kupacNaziv(p.kupacId), ...(laser ? [] : [`${izr.ukupnoSati} h`]), fmtCurDec(izr.cijenaKonacna), p.status, p.projektId ? projSifra(p.projektId) : ""];
    }));
  };
  const rasporediProjekte = (novaLista) => patchProjekti(novaLista.map((p, i) => ({ ...p, poredak: i })), []);
  const vratiAutomatskoSortiranje = () => patchProjekti(db.projekti.map(({ poredak, ...ostalo }) => ostalo), []);

  const noviZadaciIzStandarda = () => (db.standardniZadaci || []).map((t) => ({ id: uid("zad"), naziv: t.naziv, izvrseno: false, izvrsioId: null, datumIzvrsenja: null, planiraniDatum: null }));
  const emptyProj = () => ({ sifra: "", naziv: "", kupacId: db.kupci[0]?.id || "", status: "Ponuda", vrijednost: 0, rokPocetka: todayISO(), rokZavrsetka: todayISO(), opis: "", voditeljId: "", kontaktOsoba: "", kontaktEmail: "", kontaktTelefon: "", mjestoIsporuke: "", zadaci: noviZadaciIzStandarda(), faze: praznaFazaSati() });
  const [projForm, setProjForm] = useState(emptyProj());

  const emptyPon = () => ({ id: null, broj: sljedeciBroj(db.ponude, "broj", "PON-2026-"), naziv: "", kupacId: db.kupci[0]?.id || "", kontaktOsoba: db.kupci[0]?.kontaktOsoba || "", kontaktOsobaTitula: "herr", datum: todayISO(), status: "U izradi", napomena: "", projektId: null, izradioId: mojId || "", pozicije: [], sirovineStavke: [], satnicaMontaza: 0, otpadLimPoTipu: {}, postotakMarze: 0, napomenaNjemacki: NJEMACKI_UVJETI_ZADANO });
  const [ponForm, setPonForm] = useState(emptyPon());
  const [cjenikOpen, setCjenikOpen] = useState(false);
  const [zadaciOpen, setZadaciOpen] = useState(false);
  const [detalj, setDetalj] = useState(null);
  // Klik na zadatak na nadzornoj ploči otvara detalje baš tog projekta (a ne samo popis projekata).
  useEffect(() => {
    if (!otvoriProjektId) return;
    const p = db.projekti.find((x) => x.id === otvoriProjektId);
    if (p) setDetalj(p);
    ocistiOtvoriProjekt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otvoriProjektId]);
  const [printPonuda, setPrintPonuda] = useState(null);

  const emptyLaser = () => ({ id: null, broj: sljedeciBroj(db.ponudeLasera, "broj", "LAS-2026-"), naziv: "", kupacId: db.kupci[0]?.id || "", datum: todayISO(), status: "U izradi", napomena: "", cjenik: prazniCjenikLasera(), stavke: [], savijanje: { brojPregiba: 0, minPoKom: 0 }, ostaleStavke: [], projektId: null });
  const [laserForm, setLaserForm] = useState(emptyLaser());
  const [printLaser, setPrintLaser] = useState(null);
  const mozeLaser = dozvolaZaKarticu(mojaPozicija, "projekti", "laser").izmjene;
  const [detaljZavrsen, setDetaljZavrsen] = useState(null); // završeni projekt otvoren za analizu plan/stvarno
  const [pretvorba, setPretvorba] = useState(null); // { ponuda, tip: "standard"|"laser", broj, naziv } — prije kreiranja projekta iz ponude pita se za broj naloga (šifru) jer taj broj slijedi vlastitu, ručno vođenu numeraciju tvrtke (serije po vrsti posla), a ne može se pouzdano pogoditi automatski

  const kupacNaziv = (id) => db.kupci.find((k) => k.id === id)?.naziv || "—";
  const projSifra = (id) => db.projekti.find((p) => p.id === id)?.sifra || "";

  const saveProj = () => {
    if (!projForm.sifra.trim() || !projForm.naziv.trim()) return;
    const payload = { ...projForm, vrijednost: Number(projForm.vrijednost) };
    const stariProjekt = projForm.id ? db.projekti.find((p) => p.id === projForm.id) : null;
    const voditeljPromijenjen = payload.voditeljId && payload.voditeljId !== stariProjekt?.voditeljId;
    // Kad projekt prijeđe u "Završen", svi njegovi radni nalozi koji to već nisu automatski dobiju
    // isti status — projekt time seli u karticu "Završeni projekti", a njegovi radni nalozi nestaju
    // iz aktivne tablice Radnih naloga (vidi filtar u ProizvodnjaPage). Prije toga se pamti TOČNO
    // koji su nalozi i s kojeg statusa promijenjeni (autoZavrsenoNalozi) te izvorni status projekta
    // (statusPrijeZavrsetka) — isključivo da "Vrati u aktivne" (u slučaju pogrešnog klika) može
    // precizno vratiti SAMO ono što je ova akcija stvarno promijenila, ne i naloge koji su već bili
    // završeni i prije ovog klika.
    const prelaziUZavrseno = projForm.id && stariProjekt && stariProjekt.status !== "Završen" && payload.status === "Završen";
    if (prelaziUZavrseno) {
      payload.statusPrijeZavrsetka = stariProjekt.status;
      payload.autoZavrsenoNalozi = db.radniNalozi.filter((r) => r.projektId === projForm.id && r.status !== "Završen").map((r) => ({ id: r.id, staviStatus: r.status }));
    }
    if (projForm.id) patchProjekti([payload], []);
    else patchProjekti([{ ...payload, id: uid("proj") }], []);
    // Naziv radnog naloga uvijek prati naziv projekta — kad se projekt preimenuje, isto ime
    // se prepiše na sve njegove radne naloge da ne ostanu razdvojeni.
    if (projForm.id && stariProjekt && stariProjekt.naziv !== payload.naziv) {
      update("radniNalozi", db.radniNalozi.map((r) => (r.projektId === projForm.id ? { ...r, naziv: payload.naziv } : r)));
    }
    if (prelaziUZavrseno) {
      const dotaknutiIds = new Set(payload.autoZavrsenoNalozi.map((n) => n.id));
      update("radniNalozi", db.radniNalozi.map((r) => (dotaknutiIds.has(r.id) ? { ...r, status: "Završen" } : r)));
    }
    setModal(null);
    if (voditeljPromijenjen) {
      const zaposlenik = db.zaposlenici.find((z) => z.id === payload.voditeljId);
      const poslano = posaljiObavijestVoditelju(payload, zaposlenik);
      showToast(poslano ? `Projekt spremljen. Otvoren e-mail za ${zaposlenik.ime} ${zaposlenik.prezime}.` : "Projekt spremljen. Voditelj nema unesen e-mail — obavijest nije pripremljena.");
    } else {
      showToast("Projekt spremljen.");
    }
  };

  // Vraća projekt pogrešno označen kao "Završen" natrag u aktivne — precizno poništava SAMO ono
  // što je taj klik promijenio: status projekta ide natrag na onaj koji je imao TOČNO prije (ne
  // uvijek "U izradi"), a nazad se vraćaju SAMO oni radni nalozi koje je taj klik automatski
  // završio (svaki na svoj točan raniji status) — nalozi koji su bili završeni i prije ostaju
  // netaknuti.
  const vratiUAktivne = (projekt) => {
    const dotaknuti = projekt.autoZavrsenoNalozi || [];
    if (dotaknuti.length > 0) {
      const statusPoNalogu = new Map(dotaknuti.map((n) => [n.id, n.staviStatus]));
      update("radniNalozi", db.radniNalozi.map((r) => (statusPoNalogu.has(r.id) ? { ...r, status: statusPoNalogu.get(r.id) } : r)));
    }
    patchProjekti([{ ...projekt, status: projekt.statusPrijeZavrsetka || "U izradi", statusPrijeZavrsetka: null, autoZavrsenoNalozi: [] }], []);
    showToast("Projekt vraćen u aktivne.");
  };
  // Izravna promjena statusa iz tablice — ista pravila kao u obrascu (prelazak u "Završen"
  // automatski završava otvorene radne naloge i pamti što je promijenjeno za "Vrati u aktivne").
  const promijeniStatusProjekta = (projekt, noviStatus) => {
    if (noviStatus === projekt.status) return;
    const payload = { ...projekt, status: noviStatus };
    const prelaziUZavrseno = projekt.status !== "Završen" && noviStatus === "Završen";
    if (prelaziUZavrseno) {
      payload.statusPrijeZavrsetka = projekt.status;
      payload.autoZavrsenoNalozi = db.radniNalozi.filter((r) => r.projektId === projekt.id && r.status !== "Završen").map((r) => ({ id: r.id, staviStatus: r.status }));
    }
    patchProjekti([payload], []);
    if (prelaziUZavrseno) {
      const dotaknutiIds = new Set(payload.autoZavrsenoNalozi.map((n) => n.id));
      update("radniNalozi", db.radniNalozi.map((r) => (dotaknutiIds.has(r.id) ? { ...r, status: "Završen" } : r)));
    }
    showToast(`Status projekta ${projekt.sifra}: ${noviStatus}.`);
  };
  const savePon = () => {
    if (!ponForm.naziv.trim()) return;
    if (ponForm.id) update("ponude", db.ponude.map((p) => (p.id === ponForm.id ? ponForm : p)));
    else update("ponude", [...db.ponude, { ...ponForm, id: uid("pon") }]);
    setModal(null);
    showToast("Ponuda spremljena.");
  };
  const saveLaser = () => {
    if (!laserForm.naziv.trim()) return;
    if (laserForm.id) update("ponudeLasera", db.ponudeLasera.map((p) => (p.id === laserForm.id ? laserForm : p)));
    else update("ponudeLasera", [...db.ponudeLasera, { ...laserForm, id: uid("las") }]);
    setModal(null);
    showToast("Ponuda za laser spremljena.");
  };
  // Kopija ponude — nova ponuda s istim stavkama/pozicijama, ali svoj broj, "U izradi" status i
  // bez veze na projekt (kopija koja je već pretvorena u projekt ne smije "naslijediti" tu vezu).
  const kopirajPonudu = (ponuda) => {
    const kopija = { ...JSON.parse(JSON.stringify(ponuda)), id: uid("pon"), broj: sljedeciBroj(db.ponude, "broj", "PON-2026-"), status: "U izradi", projektId: null, datum: todayISO() };
    update("ponude", [...db.ponude, kopija]);
    showToast(`Ponuda kopirana kao ${kopija.broj}.`);
  };
  const kopirajLaser = (ponuda) => {
    const kopija = { ...JSON.parse(JSON.stringify(ponuda)), id: uid("las"), broj: sljedeciBroj(db.ponudeLasera, "broj", "LAS-2026-"), status: "U izradi", projektId: null, datum: todayISO() };
    update("ponudeLasera", [...db.ponudeLasera, kopija]);
    showToast(`Ponuda za laser kopirana kao ${kopija.broj}.`);
  };
  const saveCjenik = (novi) => {
    const cleaned = Object.fromEntries(Object.entries(novi).map(([k, v]) => [k, Number(v) || 0]));
    update("cjenikRada", cleaned);
    setCjenikOpen(false);
    showToast("Cjenik rada ažuriran.");
  };
  const pretvoriUProjekt = (ponuda, sifra, naziv) => {
    const calc = izracunPonude(ponuda, db.materijali, db.cjenikRada, db.katalogProfila, db.kvaliteteMaterijala);
    // Materijal (iz skladišta) i Ostalo se sad vode po stavci ponude — projekt ih i dalje drži
    // kao JEDAN zajednički popis, pa se ovdje zbrajaju preko svih stavki.
    const sviMaterijalStavke = (ponuda.pozicije || []).flatMap((p) => p.materijalStavke || []);
    const sveOstaleStavke = (ponuda.pozicije || []).flatMap((p) => p.ostaleStavke || []);
    const noviProjekt = {
      id: uid("proj"), sifra, naziv, kupacId: ponuda.kupacId,
      status: "Odobren", vrijednost: Math.round(calc.cijenaKonacna), rokPocetka: todayISO(), rokZavrsetka: addDays(todayISO(), 60),
      opis: `Kreirano iz ponude ${ponuda.broj}.`,
      izvorPonudaId: ponuda.id, pozicije: ponuda.pozicije || [], materijalStavke: sviMaterijalStavke, ostaleStavke: sveOstaleStavke,
      voditeljId: "", zadaci: noviZadaciIzStandarda(),
      faze: { ...praznaFazaSati(), ...Object.fromEntries(OPERACIJE.map((o) => [o.label, calc.satiPoOperaciji[o.key]])), "Montaža (teren)": calc.satiMontaze },
    };
    let rnBrojac = parseInt(sljedeciBrojRadnogNaloga(db.radniNalozi, noviProjekt.sifra).split("/").pop(), 10);
    const sljedeciRnBroj = () => `${noviProjekt.sifra}/${rnBrojac++}`;
    let noviNalozi = OPERACIJE.filter((o) => calc.satiPoOperaciji[o.key] > 0).map((o) => ({
      id: uid("rn"), broj: sljedeciRnBroj(), projektId: noviProjekt.id,
      naziv: noviProjekt.naziv, faza: o.label, zaduzenTim: "", status: "Planiran",
      planiranoSati: calc.satiPoOperaciji[o.key], utrosenoSati: 0, datumPocetka: todayISO(), datumZavrsetka: addDays(todayISO(), 14),
      stavke: o.key === "pripremaPozicija" ? sviMaterijalStavke : [], materijalIzdan: false,
    }));
    // Osiguraj da materijal iz ponude uvijek završi na nekom radnom nalogu, čak i ako "priprema pozicija" nema planiranih sati
    const imaPripremuNalog = noviNalozi.some((n) => n.faza === "Priprema pozicija za sklapanje");
    if (!imaPripremuNalog && sviMaterijalStavke.length > 0) {
      noviNalozi = [...noviNalozi, {
        id: uid("rn"), broj: sljedeciRnBroj(), projektId: noviProjekt.id,
        naziv: noviProjekt.naziv, faza: "Priprema pozicija za sklapanje", zaduzenTim: "", status: "Planiran",
        planiranoSati: 0, utrosenoSati: 0, datumPocetka: todayISO(), datumZavrsetka: addDays(todayISO(), 14),
        stavke: sviMaterijalStavke, materijalIzdan: false,
      }];
    }
    if (calc.satiMontaze > 0) {
      noviNalozi = [...noviNalozi, {
        id: uid("rn"), broj: sljedeciRnBroj(), projektId: noviProjekt.id,
        naziv: noviProjekt.naziv, faza: "Montaža (teren)", zaduzenTim: "", status: "Planiran",
        planiranoSati: calc.satiMontaze, utrosenoSati: 0, datumPocetka: todayISO(), datumZavrsetka: addDays(todayISO(), 14),
        stavke: [], materijalIzdan: false,
      }];
    }
    patchProjekti([noviProjekt], []);
    update("radniNalozi", [...db.radniNalozi, ...noviNalozi]);
    update("ponude", db.ponude.map((p) => (p.id === ponuda.id ? { ...p, projektId: noviProjekt.id } : p)));
    showToast(`Projekt ${noviProjekt.sifra} kreiran s ${noviNalozi.length} radnih naloga.`);
    setTab("projekti");
  };

  // Analogno pretvoriUProjekt, ali za uslugu laserskog rezanja: nema pozicija/AKZ/montaže, samo
  // radni nalog(i) za sam posao rezanja — jedan za "Laser za profile" i/ili jedan za "Laser za
  // limove", ovisno koje vrste stavki ponuda uopće ima, s planiranim satima = zbroj rezanja +
  // pripreme svih stavki tog tipa.
  const pretvoriUProjektLaser = (ponuda, sifra, naziv) => {
    const calc = izracunPonudeLasera(ponuda, db.kvaliteteMaterijala);
    const noviProjekt = {
      id: uid("proj"), sifra, naziv, kupacId: ponuda.kupacId,
      status: "Odobren", vrijednost: Math.round(calc.cijenaKonacna), rokPocetka: todayISO(), rokZavrsetka: addDays(todayISO(), 30),
      opis: `Kreirano iz ponude za laser ${ponuda.broj}.`,
      izvorPonudaLaseraId: ponuda.id, pozicije: [], materijalStavke: [], ostaleStavke: ponuda.ostaleStavke || [],
      voditeljId: "", zadaci: noviZadaciIzStandarda(), faze: praznaFazaSati(),
    };
    const minPoTipu = { cijevni: 0, plocasti: 0 };
    calc.stavke.forEach((s) => { minPoTipu[s.tipLasera === "cijevni" ? "cijevni" : "plocasti"] += (Number(s.rezanjeMin) || 0) + (Number(s.pripremaMin) || 0); });
    let rnBrojac = parseInt(sljedeciBrojRadnogNaloga(db.radniNalozi, noviProjekt.sifra).split("/").pop(), 10);
    const sljedeciRnBroj = () => `${noviProjekt.sifra}/${rnBrojac++}`;
    const noviNalozi = [];
    [{ tip: "cijevni", faza: "Laser za profile" }, { tip: "plocasti", faza: "Laser za limove" }].forEach(({ tip, faza }) => {
      const sati = Math.round((minPoTipu[tip] / 60) * 100) / 100;
      if (sati <= 0) return;
      noviProjekt.faze[faza] = sati;
      noviNalozi.push({
        id: uid("rn"), broj: sljedeciRnBroj(), projektId: noviProjekt.id,
        naziv: noviProjekt.naziv, faza, zaduzenTim: "", status: "Planiran",
        planiranoSati: sati, utrosenoSati: 0, datumPocetka: todayISO(), datumZavrsetka: addDays(todayISO(), 14),
        stavke: [], materijalIzdan: false,
      });
    });
    patchProjekti([noviProjekt], []);
    update("radniNalozi", [...db.radniNalozi, ...noviNalozi]);
    update("ponudeLasera", db.ponudeLasera.map((p) => (p.id === ponuda.id ? { ...p, projektId: noviProjekt.id } : p)));
    showToast(`Projekt ${noviProjekt.sifra} kreiran${noviNalozi.length ? ` s ${noviNalozi.length} radnih naloga` : ""}.`);
    setTab("projekti");
  };

  const potvrdiPretvorbu = () => {
    const sifra = pretvorba.broj.trim();
    const naziv = pretvorba.naziv.trim();
    if (!sifra) { showToast("Upiši broj naloga."); return; }
    if (!naziv) { showToast("Upiši naziv projekta."); return; }
    if (db.projekti.some((p) => p.sifra.trim().toLowerCase() === sifra.toLowerCase())) { showToast(`Broj naloga ${sifra} je već iskorišten na drugom projektu.`); return; }
    if (pretvorba.tip === "laser") pretvoriUProjektLaser(pretvorba.ponuda, sifra, naziv);
    else pretvoriUProjekt(pretvorba.ponuda, sifra, naziv);
    setPretvorba(null);
  };

  return (
    <div>
      <PageHeader title="Projekti i ponude" subtitle="Praćenje projekata od ponude do realizacije" icon={Building2} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 20 }}>
          {dozvKartice.some((k) => k.key === "projekti") && <div className={`nav-tab ${tab === "projekti" ? "active" : ""}`} onClick={() => setTab("projekti")}>Projekti</div>}
          {dozvKartice.some((k) => k.key === "ponude") && <div className={`nav-tab ${tab === "ponude" ? "active" : ""}`} onClick={() => setTab("ponude")}>Ponude</div>}
          {dozvKartice.some((k) => k.key === "laser") && <div className={`nav-tab ${tab === "laser" ? "active" : ""}`} onClick={() => setTab("laser")}>Ponude - Laser</div>}
          {dozvKartice.some((k) => k.key === "zavrseni") && <div className={`nav-tab ${tab === "zavrseni" ? "active" : ""}`} onClick={() => setTab("zavrseni")}>Završeni projekti</div>}
        </div>
        {tab === "ponude" && (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" size="sm" icon={Printer} onClick={() => ispisiPonude(db.ponude, "Popis ponuda", false)}>Ispis / PDF</Btn>
            <Btn variant="ghost" size="sm" icon={Settings} onClick={() => setCjenikOpen(true)}>Cjenik rada</Btn>
          </div>
        )}
        {tab === "projekti" && (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" size="sm" icon={Printer} onClick={() => ispisiProjekte(projektiSortirani, "Popis projekata")}>Ispis / PDF</Btn>
            <Btn variant="ghost" size="sm" icon={Settings} onClick={() => setZadaciOpen(true)}>Standardni zadaci</Btn>
          </div>
        )}
        {tab === "zavrseni" && <Btn variant="ghost" size="sm" icon={Printer} onClick={() => ispisiProjekte(projektiZavrseni, "Završeni projekti")}>Ispis / PDF</Btn>}
        {tab === "laser" && <Btn variant="ghost" size="sm" icon={Printer} onClick={() => ispisiPonude(db.ponudeLasera, "Popis ponuda — laser", true)}>Ispis / PDF</Btn>}
      </div>

      {tab === "projekti" && (
        <>
          {imaRucniPoredak && mozeProjekti && (
            <div style={{ marginBottom: 10 }}>
              <Btn variant="ghost" size="sm" onClick={vratiAutomatskoSortiranje}>Vrati automatsko sortiranje (po šifri)</Btn>
            </div>
          )}
          <EntityPage
          title="" data={projektiSortirani}
          onReorder={mozeProjekti ? rasporediProjekte : undefined}
          onAdd={() => { setProjForm(emptyProj()); setModal("proj"); }}
          onEdit={(row) => { setProjForm({ ...emptyProj(), ...row, zadaci: row.zadaci || noviZadaciIzStandarda(), voditeljId: row.voditeljId || "", faze: { ...praznaFazaSati(), ...(row.faze || {}) } }); setModal("proj"); }}
          onDelete={(r) => setDel({ type: "proj", row: r })}
          addLabel="Novi projekt" searchKeys={["sifra", "naziv"]} readOnly={!mozeProjekti}
          columns={[
            { key: "sifra", label: "Šifra", render: (r) => <span className="f-mono">{r.sifra}</span> },
            { key: "naziv", label: "Naziv" },
            { key: "voditelj", label: "Voditelj", render: (r) => { const v = db.zaposlenici.find((z) => z.id === r.voditeljId); return v ? `${v.prezime} ${v.ime}` : <span style={{ color: "var(--ink-faint)" }}>—</span>; } },
            { key: "kupac", label: "Kupac", render: (r) => kupacNaziv(r.kupacId) },
            { key: "brojNarudzbe", label: "Broj narudžbe", render: (r) => { const brojevi = db.narudzbe.filter((n) => n.projektId === r.id && n.broj).map((n) => n.broj); return brojevi.length ? <span className="f-mono">{brojevi.join(", ")}</span> : <span style={{ color: "var(--ink-faint)" }}>—</span>; } },
            { key: "rokZavrsetka", label: "Rok završetka", render: (r) => fmtDate(r.rokZavrsetka) },
            {
              key: "status", label: "Status", render: (r) => mozeProjekti ? (
                <select className="select" style={{ fontSize: 12, padding: "4px 8px", width: 120 }} value={r.status} onClick={(e) => e.stopPropagation()} onChange={(e) => promijeniStatusProjekta(r, e.target.value)}>
                  {["Ponuda", "Odobren", "U izradi", "Montaža", "Završen", "Otkazan"].map((s) => <option key={s}>{s}</option>)}
                </select>
              ) : <Badge status={r.status} />
            },
            { key: "detalji", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => setDetalj(r)}>Detalji</Btn> },
          ]}
          />
        </>
      )}

      {tab === "ponude" && (
        <EntityPage
          title="" data={db.ponude}
          onAdd={() => { setPonForm(emptyPon()); setModal("pon"); }}
          onEdit={(row) => {
            setPonForm({
              ...emptyPon(), ...JSON.parse(JSON.stringify(row)), pozicije: row.pozicije || [],
              // Stare ponude (prije ovih polja) nemaju kontakt osobu ni njemačke uvjete spremljene —
              // nadopuni ih razumnim zadanim vrijednostima umjesto emptyPon()-ovog zadanog kupca[0].
              kontaktOsoba: row.kontaktOsoba || db.kupci.find((k) => k.id === row.kupacId)?.kontaktOsoba || "",
              napomenaNjemacki: row.napomenaNjemacki || NJEMACKI_UVJETI_ZADANO,
            });
            setModal("pon");
          }}
          onDelete={(r) => setDel({ type: "pon", row: r })}
          addLabel="Nova ponuda" searchKeys={["broj", "naziv"]} readOnly={!mozePonude}
          columns={[
            { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
            { key: "naziv", label: "Naziv posla" },
            { key: "kupac", label: "Kupac", render: (r) => kupacNaziv(r.kupacId) },
            { key: "sati", label: "Sati", render: (r) => <span className="f-mono">{izracunPonude(r, db.materijali, db.cjenikRada, db.katalogProfila, db.kvaliteteMaterijala).ukupnoSati} h</span> },
            { key: "ukupno", label: "Vrijednost", render: (r) => <span className="f-mono">{fmtCurDec(izracunPonude(r, db.materijali, db.cjenikRada, db.katalogProfila, db.kvaliteteMaterijala).cijenaKonacna)}</span> },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            { key: "pdf", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => setPrintPonuda(r)}>PDF ponude</Btn> },
            { key: "kopiraj", label: "", render: (r) => <Btn size="sm" variant="ghost" icon={Copy} onClick={() => kopirajPonudu(r)}>Kopiraj</Btn> },
            {
              key: "akcija", label: "", render: (r) =>
                r.projektId ? <span style={{ fontSize: 11, color: "var(--green)" }}>→ {projSifra(r.projektId)}</span>
                : r.status === "Prihvaćena" ? <Btn size="sm" icon={FolderInput} onClick={() => setPretvorba({ ponuda: r, tip: "standard", broj: "", naziv: r.naziv })}>Pretvori u projekt</Btn>
                : null
            },
          ]}
        />
      )}

      {tab === "laser" && (
        <EntityPage
          title="" data={db.ponudeLasera}
          onAdd={() => { setLaserForm(emptyLaser()); setModal("laser"); }}
          onEdit={(row) => { setLaserForm({ ...emptyLaser(), ...JSON.parse(JSON.stringify(row)), stavke: row.stavke || [], ostaleStavke: row.ostaleStavke || [], cjenik: { ...prazniCjenikLasera(), ...(row.cjenik || {}) } }); setModal("laser"); }}
          onDelete={(r) => setDel({ type: "laser", row: r })}
          addLabel="Nova ponuda za laser" searchKeys={["broj", "naziv"]} readOnly={!mozeLaser}
          columns={[
            { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
            { key: "naziv", label: "Naziv posla" },
            { key: "kupac", label: "Kupac", render: (r) => kupacNaziv(r.kupacId) },
            { key: "ukupno", label: "Vrijednost", render: (r) => <span className="f-mono">{fmtCurDec(izracunPonudeLasera(r, db.kvaliteteMaterijala).cijenaKonacna)}</span> },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            { key: "pdf", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => setPrintLaser(r)}>PDF ponude</Btn> },
            { key: "kopiraj", label: "", render: (r) => <Btn size="sm" variant="ghost" icon={Copy} onClick={() => kopirajLaser(r)}>Kopiraj</Btn> },
            {
              key: "akcija", label: "", render: (r) =>
                r.projektId ? <span style={{ fontSize: 11, color: "var(--green)" }}>→ {projSifra(r.projektId)}</span>
                : r.status === "Prihvaćena" ? <Btn size="sm" icon={FolderInput} onClick={() => setPretvorba({ ponuda: r, tip: "laser", broj: "", naziv: r.naziv })}>Pretvori u projekt</Btn>
                : null
            },
          ]}
        />
      )}

      {tab === "zavrseni" && (
        <EntityPage
          title="" data={projektiZavrseni} readOnly searchKeys={["sifra", "naziv"]}
          columns={[
            { key: "sifra", label: "Šifra", render: (r) => <span className="f-mono">{r.sifra}</span> },
            { key: "naziv", label: "Naziv" },
            { key: "kupac", label: "Kupac", render: (r) => kupacNaziv(r.kupacId) },
            { key: "vrijednost", label: "Vrijednost", render: (r) => <span className="f-mono">{fmtCur(r.vrijednost)}</span> },
            { key: "rokZavrsetka", label: "Rok završetka", render: (r) => fmtDate(r.rokZavrsetka) },
            { key: "analiza", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => setDetaljZavrsen(r)}>Analiza</Btn> },
            { key: "vrati", label: "", render: (r) => mozeProjekti && <Btn size="sm" variant="ghost" onClick={() => vratiUAktivne(r)}>Vrati u aktivne</Btn> },
          ]}
        />
      )}

      {detaljZavrsen && <ZavrsenProjektAnalizaModal projekt={detaljZavrsen} db={db} onClose={() => setDetaljZavrsen(null)} />}

      {modal === "proj" && (
        <Modal title={projForm.id ? "Uredi projekt" : "Novi projekt"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={saveProj}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Šifra projekta"><input className="input" value={projForm.sifra} onChange={(e) => setProjForm({ ...projForm, sifra: e.target.value })} /></Field>
            <Field label="Kupac"><select className="select" value={projForm.kupacId} onChange={(e) => setProjForm({ ...projForm, kupacId: e.target.value })}>{db.kupci.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}</select></Field>
          </div>
          <Field label="Naziv projekta"><input className="input" value={projForm.naziv} onChange={(e) => setProjForm({ ...projForm, naziv: e.target.value })} /></Field>
          <Field label="Voditelj projekta">
            <select className="select" value={projForm.voditeljId || ""} onChange={(e) => setProjForm({ ...projForm, voditeljId: e.target.value })}>
              <option value="">— Nije dodijeljen —</option>
              {[...db.zaposlenici].filter((z) => z.status === "Aktivan").sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
            </select>
          </Field>
          <div className="label" style={{ marginTop: 6 }}>Kontakt i isporuka</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Kontakt osoba"><input className="input" value={projForm.kontaktOsoba || ""} onChange={(e) => setProjForm({ ...projForm, kontaktOsoba: e.target.value })} /></Field>
            <Field label="E-mail"><input className="input" type="email" value={projForm.kontaktEmail || ""} onChange={(e) => setProjForm({ ...projForm, kontaktEmail: e.target.value })} /></Field>
            <Field label="Telefon"><input className="input" value={projForm.kontaktTelefon || ""} onChange={(e) => setProjForm({ ...projForm, kontaktTelefon: e.target.value })} /></Field>
          </div>
          <Field label="Mjesto isporuke"><input className="input" placeholder="npr. ulica i broj, poštanski broj, grad, država" value={projForm.mjestoIsporuke || ""} onChange={(e) => setProjForm({ ...projForm, mjestoIsporuke: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Status"><select className="select" value={projForm.status} onChange={(e) => setProjForm({ ...projForm, status: e.target.value })}>{["Ponuda", "Odobren", "U izradi", "Montaža", "Završen", "Otkazan"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Vrijednost (€)"><input className="input f-mono" type="number" value={projForm.vrijednost} onChange={(e) => setProjForm({ ...projForm, vrijednost: e.target.value })} /></Field>
            <Field label="Završna obrada (plan proizvodnje)">
              <select className="select" value={projForm.zavrsnaObrada || zavrsnaObradaProjekta(projForm, db.radniNalozi)} onChange={(e) => setProjForm({ ...projForm, zavrsnaObrada: e.target.value })}>
                {ZAVRSNE_OBRADE.map((z) => <option key={z.key} value={z.key}>{z.naziv}</option>)}
              </select>
            </Field>
            <Field label="Rok početka"><input className="input" type="date" value={projForm.rokPocetka} onChange={(e) => setProjForm({ ...projForm, rokPocetka: e.target.value })} /></Field>
            <Field label="Rok završetka (isporuka kupcu)"><input className="input" type="date" value={projForm.rokZavrsetka} onChange={(e) => setProjForm({ ...projForm, rokZavrsetka: e.target.value })} /></Field>
          </div>
          <Field label="Opis"><textarea className="textarea" rows={3} value={projForm.opis} onChange={(e) => setProjForm({ ...projForm, opis: e.target.value })} /></Field>
          <div className="label" style={{ marginTop: 6 }}>Faze izrade (planirani sati)</div>
          <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 8 }}>Sati po fazi koriste se kao predložak kad se za ovaj projekt kasnije kreira radni nalog — nisu obavezni za faze koje se ne planiraju.</div>
          <div className="card" style={{ padding: 14, background: "var(--surface-alt)", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {FAZE.map((f) => (
              <Field key={f} label={f}>
                <input className="input f-mono" type="number" min="0" step="0.5" value={projForm.faze?.[f] ?? 0} onChange={(e) => setProjForm({ ...projForm, faze: { ...(projForm.faze || praznaFazaSati()), [f]: Number(e.target.value) || 0 } })} />
              </Field>
            ))}
          </div>
        </Modal>
      )}

      {modal === "pon" && (() => {
        const calc = izracunPonude(ponForm, db.materijali, db.cjenikRada, db.katalogProfila, db.kvaliteteMaterijala);

        const azurirajOtpadLima = (katalogId, postotak) => setPonForm({ ...ponForm, otpadLimPoTipu: { ...(ponForm.otpadLimPoTipu || {}), [katalogId]: postotak } });

        return (
          <Modal xwide title={ponForm.id ? `Ponuda ${ponForm.broj}` : "Nova ponuda"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={savePon}>Spremi</Btn></>}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
              <Field label="Naziv posla / konstrukcije"><input className="input" placeholder="npr. Nadstrešnica autobusnog kolodvora" value={ponForm.naziv} onChange={(e) => setPonForm({ ...ponForm, naziv: e.target.value })} /></Field>
              <Field label="Kupac">
                <select
                  className="select" value={ponForm.kupacId}
                  onChange={(e) => {
                    const noviKupac = db.kupci.find((k) => k.id === e.target.value);
                    setPonForm({ ...ponForm, kupacId: e.target.value, kontaktOsoba: noviKupac?.kontaktOsoba || ponForm.kontaktOsoba });
                  }}
                >{db.kupci.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}</select>
              </Field>
              <Field label="Datum"><input className="input" type="date" value={ponForm.datum} onChange={(e) => setPonForm({ ...ponForm, datum: e.target.value })} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Status"><select className="select" value={ponForm.status} onChange={(e) => setPonForm({ ...ponForm, status: e.target.value })}>{["U izradi", "Poslana", "Prihvaćena", "Odbijena"].map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Izradio (potpis na ponudi)">
                <select className="select" value={ponForm.izradioId || ""} onChange={(e) => setPonForm({ ...ponForm, izradioId: e.target.value })}>
                  <option value="">— odaberi —</option>
                  {[...db.zaposlenici].filter((z) => z.status === "Aktivan").sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
                </select>
              </Field>
              <Field label="Kontakt osoba (pozdrav u njem. ponudi)">
                <div style={{ display: "flex", gap: 6 }}>
                  <select className="select" style={{ width: 85, flexShrink: 0 }} value={ponForm.kontaktOsobaTitula || "herr"} onChange={(e) => setPonForm({ ...ponForm, kontaktOsobaTitula: e.target.value })}>
                    <option value="herr">Herr</option>
                    <option value="frau">Frau</option>
                  </select>
                  <input className="input" placeholder="Prezime osobe koja je poslala upit" value={ponForm.kontaktOsoba || ""} onChange={(e) => setPonForm({ ...ponForm, kontaktOsoba: e.target.value })} />
                </div>
              </Field>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              <label className="label" style={{ marginBottom: 0 }}>Pozicije i kalkulacija sati</label>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>Satnice se uređuju putem gumba "Cjenik rada"</span>
            </div>
            <div style={{ marginTop: 8, marginBottom: 16 }}>
              <PozicijeEditor pozicije={ponForm.pozicije} setPozicije={(rows) => setPonForm({ ...ponForm, pozicije: rows })} cjenikRada={db.cjenikRada} katalog={db.katalogProfila} kvalitete={db.kvaliteteMaterijala} satnicaMontaza={ponForm.satnicaMontaza} calc={calc}
                azurirajOtpadLima={azurirajOtpadLima}
                materijaliSkladiste={db.materijali} narudzbenice={db.narudzbenice}
                napomenaNjemacki={ponForm.napomenaNjemacki} setNapomenaNjemacki={(v) => setPonForm({ ...ponForm, napomenaNjemacki: v })} />
            </div>

            <Field label="Napomena"><textarea className="textarea" rows={2} value={ponForm.napomena} onChange={(e) => setPonForm({ ...ponForm, napomena: e.target.value })} /></Field>

            <div className="label" style={{ marginTop: 6 }}>Montaža i uvećanje cijene</div>
            <div className="card" style={{ padding: 14, background: "var(--surface-alt)", marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                <Field label="Satnica montaže (€/h, fiksna za ovu ponudu)"><input className="input f-mono" type="number" min="0" step="0.5" value={ponForm.satnicaMontaza ?? 0} onChange={(e) => setPonForm({ ...ponForm, satnicaMontaza: e.target.value === "" ? 0 : Number(e.target.value) })} /></Field>
                <Field label="Uvećanje cijene / marža (%)"><input className="input f-mono" type="number" min="0" step="0.5" value={ponForm.postotakMarze ?? 0} onChange={(e) => setPonForm({ ...ponForm, postotakMarze: e.target.value === "" ? 0 : Number(e.target.value) })} /></Field>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 8 }}>
                Ukupna masa konstrukcije: <strong className="f-mono">{calc.ukupnaMasaKonstrukcije.toFixed(1)} kg</strong> · Sati montaže: <strong className="f-mono">{calc.satiMontaze.toFixed(1)} h</strong>
                {calc.iznosAKZ > 0 && <> · AKZ: <strong className="f-mono">{fmtCurDec(calc.iznosAKZ)}</strong> ({calc.akzPoTipu.filter((t) => t.iznos > 0).map((t) => t.label).join(", ")})</>}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 4 }}>AKZ se sada dodaje po poziciji (vidi karticu "AKZ" unutar svake pozicije iznad). Potreban sirovi materijal (zbrojen za sve pozicije) nalazi se u kartici "Rekapitulacija" iznad.</div>
            </div>
          </Modal>
        );
      })()}

      {cjenikOpen && <CjenikRadaModal cjenikRada={db.cjenikRada} onSave={saveCjenik} onClose={() => setCjenikOpen(false)} />}
      {zadaciOpen && <StandardniZadaciModal standardniZadaci={db.standardniZadaci} update={update} showToast={showToast} onClose={() => setZadaciOpen(false)} />}
      {detalj && <ProjektDetaljModal projekt={db.projekti.find((p) => p.id === detalj.id) || detalj} db={db} update={update} patchProjekt={patchProjekt} patchUpiti={patchUpiti} showToast={showToast} setPage={setPage} onClose={() => setDetalj(null)} mojId={mojId} />}

      {pretvorba && (
        <Modal title="Pretvori ponudu u projekt" onClose={() => setPretvorba(null)}
          footer={<>
            <Btn onClick={() => setPretvorba(null)}>Odustani</Btn>
            <Btn variant="primary" icon={FolderInput} onClick={potvrdiPretvorbu}>Kreiraj projekt</Btn>
          </>}>
          <Field label="Broj naloga (šifra projekta)">
            <input className="input f-mono" autoFocus placeholder="npr. RN 170-322" value={pretvorba.broj} onChange={(e) => setPretvorba({ ...pretvorba, broj: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") potvrdiPretvorbu(); }} />
          </Field>
          <Field label="Naziv projekta">
            <input className="input" value={pretvorba.naziv} onChange={(e) => setPretvorba({ ...pretvorba, naziv: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") potvrdiPretvorbu(); }} />
          </Field>
          <p style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Broj naloga je šifra pod kojom će se voditi projekt i svi njegovi radni nalozi (npr. RN 170-322/1, /2, …) — upiši ga po vašoj uobičajenoj numeraciji.</p>
        </Modal>
      )}
      {printPonuda && <PonudaPrintModal ponuda={printPonuda} kupac={db.kupci.find((k) => k.id === printPonuda.kupacId)} db={db} onClose={() => setPrintPonuda(null)} />}
      {modal === "laser" && <PonudaLaseraModal form={laserForm} setForm={setLaserForm} db={db} onSave={saveLaser} onClose={() => setModal(null)} />}
      {printLaser && <PonudaLaseraPrintModal ponuda={printLaser} kupac={db.kupci.find((k) => k.id === printLaser.kupacId)} db={db} onClose={() => setPrintLaser(null)} />}

      {del && (
        <ConfirmDelete
          label={del.type === "proj" || del.type === "laser" ? (del.row.naziv || del.row.broj) : del.row.broj}
          onCancel={() => setDel(null)}
          onConfirm={() => {
            if (del.type === "proj") patchProjekti([], [del.row.id]);
            else if (del.type === "laser") update("ponudeLasera", db.ponudeLasera.filter((p) => p.id !== del.row.id));
            else update("ponude", db.ponude.filter((p) => p.id !== del.row.id));
            setDel(null);
            showToast("Stavka obrisana.");
          }}
        />
      )}
    </div>
  );
}

// Analiza završenog projekta: sati po operaciji (planirano iz radnih naloga vs stvarno odrađeno,
// oboje već izvedeno preko planiranoSati/utrosenoSati) i materijal (planirano iz ponude koja je
// projekt pretvorila u projekt, vs stvarno iz izdatnica materijala na taj projekt).
function ZavrsenProjektAnalizaModal({ projekt, db, onClose }) {
  const nalozi = (db.radniNalozi || []).filter((r) => r.projektId === projekt.id);
  const poFazi = FAZE.map((faza) => {
    const zaFazu = nalozi.filter((n) => n.faza === faza);
    if (zaFazu.length === 0) return null;
    const planirano = zaFazu.reduce((s, n) => s + (Number(n.planiranoSati) || 0), 0);
    const stvarno = zaFazu.reduce((s, n) => s + (Number(n.utrosenoSati) || 0), 0);
    return { faza, planirano, stvarno };
  }).filter(Boolean);
  const ukPlanirano = poFazi.reduce((s, r) => s + r.planirano, 0);
  const ukStvarno = poFazi.reduce((s, r) => s + r.stvarno, 0);

  const ponuda = projekt.izvorPonudaId ? db.ponude.find((p) => p.id === projekt.izvorPonudaId) : null;
  const planiranoMaterijal = ponuda ? izracunPonude(ponuda, db.materijali, db.cjenikRada, db.katalogProfila, db.kvaliteteMaterijala).trosakMaterijala : null;

  const izdatniceZaProjekt = (db.izdatnice || []).filter((i) => i.projektId === projekt.id);
  const stvarnoMaterijal = izdatniceZaProjekt.reduce((s, izd) => s + (izd.stavke || []).reduce((s2, st) => {
    const m = db.materijali.find((x) => x.id === st.materijalId);
    const neto = (Number(st.kolicinaIzdano) || 0) - (Number(st.kolicinaVraceno) || 0);
    return s2 + neto * (m ? Number(m.cijena) || 0 : 0);
  }, 0), 0);
  const razlikaMaterijal = planiranoMaterijal != null ? stvarnoMaterijal - planiranoMaterijal : null;

  return (
    <Modal wide title={`Analiza projekta — ${projekt.sifra} — ${projekt.naziv}`} onClose={onClose} footer={<Btn onClick={onClose}>Zatvori</Btn>}>
      <div className="label" style={{ marginBottom: 6 }}>Sati po operaciji (planirano vs stvarno)</div>
      {poFazi.length === 0 ? <EmptyState text="Nema radnih naloga s planiranim satima na ovom projektu." /> : (
        <table className="erp-table" style={{ marginBottom: 16 }}>
          <thead><tr><th>Operacija</th><th style={{ width: 100 }}>Planirano</th><th style={{ width: 100 }}>Stvarno</th><th style={{ width: 100 }}>Razlika</th></tr></thead>
          <tbody>
            {poFazi.map((r) => {
              const razlika = r.stvarno - r.planirano;
              return (
                <tr key={r.faza}>
                  <td>{r.faza}</td>
                  <td className="f-mono">{r.planirano.toFixed(1)} h</td>
                  <td className="f-mono">{r.stvarno.toFixed(1)} h</td>
                  <td className="f-mono" style={{ color: razlika > 0 ? "var(--rust)" : razlika < 0 ? "var(--green)" : "inherit" }}>{razlika > 0 ? "+" : ""}{razlika.toFixed(1)} h</td>
                </tr>
              );
            })}
            <tr style={{ fontWeight: 700, background: "var(--surface-alt)" }}>
              <td>UKUPNO</td>
              <td className="f-mono">{ukPlanirano.toFixed(1)} h</td>
              <td className="f-mono">{ukStvarno.toFixed(1)} h</td>
              <td className="f-mono">{(ukStvarno - ukPlanirano) > 0 ? "+" : ""}{(ukStvarno - ukPlanirano).toFixed(1)} h</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="label" style={{ marginBottom: 6 }}>Materijal (planirano iz ponude vs stvarno preko izdatnica)</div>
      {planiranoMaterijal == null ? (
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginBottom: 10 }}>Projekt nije kreiran iz ponude — planirani trošak materijala nije poznat. Stvarni trošak (izdatnice) prikazan je ispod.</p>
      ) : null}
      <div className="card" style={{ padding: 14, background: "var(--surface-alt)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, fontSize: 12.5 }}>
          <div><div style={{ color: "var(--ink-soft)" }}>Planirano (ponuda)</div><div className="f-mono" style={{ fontSize: 15, fontWeight: 700 }}>{planiranoMaterijal != null ? fmtCurDec(planiranoMaterijal) : "—"}</div></div>
          <div><div style={{ color: "var(--ink-soft)" }}>Stvarno (izdatnice)</div><div className="f-mono" style={{ fontSize: 15, fontWeight: 700 }}>{fmtCurDec(stvarnoMaterijal)}</div></div>
          <div>
            <div style={{ color: "var(--ink-soft)" }}>Razlika</div>
            <div className="f-mono" style={{ fontSize: 15, fontWeight: 700, color: razlikaMaterijal == null ? "inherit" : razlikaMaterijal > 0 ? "var(--rust)" : razlikaMaterijal < 0 ? "var(--green)" : "inherit" }}>
              {razlikaMaterijal != null ? `${razlikaMaterijal > 0 ? "+" : ""}${fmtCurDec(razlikaMaterijal)}` : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="label" style={{ marginTop: 16, marginBottom: 6 }}>Radni nalozi projekta ({nalozi.length})</div>
      {nalozi.length === 0 ? <EmptyState text="Projekt nema radnih naloga." /> : (
        <table className="erp-table">
          <thead><tr><th>Broj</th><th>Faza</th><th style={{ width: 90 }}>Planirano</th><th style={{ width: 90 }}>Stvarno</th></tr></thead>
          <tbody>
            {[...nalozi].sort((a, b) => usporediPrirodno(a.broj, b.broj)).map((n) => (
              <tr key={n.id}>
                <td className="f-mono">{n.broj}</td>
                <td>{n.faza}</td>
                <td className="f-mono">{Number(n.planiranoSati || 0).toFixed(1)} h</td>
                <td className="f-mono">{Number(n.utrosenoSati || 0).toFixed(1)} h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

/* ============================== FAKTURIRANJE ============================== */
function FakturaPrintModal({ faktura, kupac, projekt, postavkeTvrtke, onClose }) {
  const t = postavkeTvrtke || {};
  const calc = izracunFakture(faktura, t.pdvStopa);
  return (
    <Modal wide title={`Pregled za ispis — Faktura ${faktura.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => window.print()}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>RAČUN</div>
            <div className="f-mono" style={{ fontSize: 13 }}>Broj: {faktura.broj}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.naziv}</div>
            <div>{t.adresa}</div>
            <div>{t.telefon}</div>
            <div>{t.email}</div>
            <div>OIB: {t.oib}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 11.5 }}>
          <div>
            <div style={{ color: "#555", marginBottom: 3 }}>Kupac:</div>
            <div style={{ fontWeight: 700 }}>{kupac?.naziv || "—"}</div>
            <div>{kupac?.adresa}</div>
            {kupac?.oib && <div>OIB: {kupac.oib}</div>}
          </div>
          <table style={{ borderCollapse: "collapse", height: "fit-content" }}>
            <tbody>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Datum izdavanja:</td><td style={{ fontWeight: 600 }}>{fmtDate(faktura.datumIzdavanja)}</td></tr>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Rok plaćanja:</td><td style={{ fontWeight: 600 }}>{fmtDate(faktura.rokPlacanja)}</td></tr>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Poziv na broj:</td><td style={{ fontWeight: 600 }}>{faktura.broj}</td></tr>
              {projekt && <tr><td style={{ paddingRight: 10, color: "#555" }}>Projekt:</td><td style={{ fontWeight: 600 }}>{projekt.sifra}</td></tr>}
            </tbody>
          </table>
        </div>

        <table className="doc-table" style={{ marginBottom: 14 }}>
          <thead><tr><th style={{ width: 30 }}>R.br.</th><th>Opis</th><th style={{ width: 55 }}>Kom.</th><th style={{ width: 45 }}>JM</th><th style={{ width: 80 }}>Cijena/jed.</th><th style={{ width: 90 }}>Iznos</th></tr></thead>
          <tbody>
            {(faktura.stavke || []).map((s, i) => (
              <tr key={i}><td>{i + 1}.</td><td>{s.opis}</td><td>{s.kolicina}</td><td>{s.jm}</td><td>{fmtCurDec(s.cijenaJed)}</td><td>{fmtCurDec(s.kolicina * s.cijenaJed)}</td></tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 240 }}>
            <tbody>
              <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>Osnovica:</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(calc.osnovica)}</td></tr>
              <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>PDV ({calc.stopa}%):</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(calc.pdvIznos)}</td></tr>
              <tr style={{ borderTop: "1px solid #333" }}><td style={{ padding: "6px 14px 0 0", fontWeight: 700 }}>UKUPNO ZA PLATITI:</td><td style={{ textAlign: "right", fontWeight: 700, paddingTop: 6, fontSize: 14 }}>{fmtCurDec(calc.ukupno)}</td></tr>
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 11, marginBottom: 20 }}>
          <div>Molimo uplatu izvršiti na žiro račun/IBAN: <strong>{t.iban}</strong> ({t.naziv}), s pozivom na broj <strong>{faktura.broj}</strong>.</div>
        </div>

        <div style={{ border: "1px solid #c9a227", background: "#fdf6e3", padding: "8px 10px", fontSize: 9.5, color: "#6b5511", marginBottom: 16, lineHeight: 1.5 }}>
          <strong>Napomena:</strong> Ovo je interni/predračunski ispis iz ERP sustava. Od 1.1.2026. B2B računi u Hrvatskoj moraju biti izdani kao fiskalizirani eRačun (Fiskalizacija 2.0) — ovaj PDF ne zamjenjuje tu zakonsku obvezu. Za pravno valjano izdavanje računa prema drugim tvrtkama koristite ovlašteni sustav za eRačune (npr. besplatnu aplikaciju MikroeRačun ili informacijskog posrednika).
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>Žiro račun:</strong> {t.ziroRacun}<br />
          <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

/* ============================== PODLOGA ZA FAKTURU ============================== */
// Spaja stavke odabranih otpremnica po istoj stavci narudžbe (zbraja količine ako se
// ista stavka isporučuje kroz više otpremnica) i množi s cijenom iz narudžbe kupca.
const izracunajStavkePodloge = (otpremniceOdabrane, narudzba) => {
  const mapa = {};
  otpremniceOdabrane.forEach((o) => {
    o.stavke.forEach((s) => {
      const nst = narudzba?.stavke?.find((n) => n.id === s.narudzbaStavkaId);
      const key = s.narudzbaStavkaId || s.naziv;
      if (!mapa[key]) mapa[key] = { naziv: s.naziv, sifra: nst?.sifra || "", jm: s.jm, cijena: Number(nst?.cijena) || 0, kolicina: 0 };
      mapa[key].kolicina += Number(s.kolicina) || 0;
    });
  });
  return Object.values(mapa).map((s) => ({ ...s, ukupno: s.kolicina * s.cijena }));
};

function PodlogaZaFakturuFormModal({ db, update, showToast, onClose }) {
  const [projektId, setProjektId] = useState("");
  const [odabraneOtpId, setOdabraneOtpId] = useState([]);
  const [vorkasa, setVorkasa] = useState(0);
  const [datum, setDatum] = useState(todayISO());

  const otpremniceZaProjekt = db.otpremnice.filter((o) => o.projektId === projektId);
  const projekt = db.projekti.find((p) => p.id === projektId);
  const narudzba = db.narudzbe.find((n) => n.projektId === projektId);
  const odabraneOtp = otpremniceZaProjekt.filter((o) => odabraneOtpId.includes(o.id));
  const stavke = izracunajStavkePodloge(odabraneOtp, narudzba);
  const zbroj = stavke.reduce((s, x) => s + x.ukupno, 0);
  const zaPlatiti = zbroj - (Number(vorkasa) || 0);

  const toggleOtp = (id) => setOdabraneOtpId((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const spremi = () => {
    if (!projekt) { showToast("Odaberi projekt."); return; }
    if (odabraneOtp.length === 0) { showToast("Odaberi barem jednu otpremnicu."); return; }
    const nova = {
      id: uid("pdf"), broj: sljedeciBrojPodloge(db.podlogeZaFakturu, projekt.sifra),
      projektId, otpremniceIds: odabraneOtpId, narudzbaId: narudzba?.id || null,
      datum, vorkasa: Number(vorkasa) || 0, stavke, zbroj, zaPlatiti,
    };
    update("podlogeZaFakturu", [...db.podlogeZaFakturu, nova]);
    showToast("Podloga za fakturu kreirana.");
    onClose();
  };

  return (
    <Modal wide title="Nova podloga za fakturu" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi}>Kreiraj podlogu</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Projekt">
          <select className="select" value={projektId} onChange={(e) => { setProjektId(e.target.value); setOdabraneOtpId([]); }}>
            <option value="">— Odaberi —</option>
            {db.projekti.filter((p) => db.otpremnice.some((o) => o.projektId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}
          </select>
        </Field>
        <Field label="Datum obračuna"><input className="input" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></Field>
      </div>

      {projektId && (
        <>
          {!narudzba && <div style={{ fontSize: 12.5, color: "var(--rust)", marginBottom: 10 }}>Ovaj projekt nema narudžbu kupca — cijene neće biti dostupne.</div>}
          <div className="label" style={{ marginTop: 6, marginBottom: 6 }}>Otpremnice za uključiti u obračun</div>
          {otpremniceZaProjekt.length === 0 ? <EmptyState text="Nema otpremnica za ovaj projekt." /> : (
            <table className="erp-table">
              <thead><tr><th style={{ width: 30 }}></th><th>Broj</th><th>Datum</th><th>Stavki</th></tr></thead>
              <tbody>
                {otpremniceZaProjekt.map((o) => (
                  <tr key={o.id}>
                    <td><input type="checkbox" checked={odabraneOtpId.includes(o.id)} onChange={() => toggleOtp(o.id)} /></td>
                    <td className="f-mono">{o.broj}</td>
                    <td>{fmtDate(o.datum)}</td>
                    <td className="f-mono">{o.stavke.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {stavke.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 14, marginBottom: 6 }}>Pregled stavki</div>
              <table className="erp-table">
                <thead><tr><th>Naziv</th><th style={{ width: 70 }}>JM</th><th style={{ width: 80 }}>Kol.</th><th style={{ width: 100 }}>Cijena</th><th style={{ width: 110 }}>Ukupno</th></tr></thead>
                <tbody>{stavke.map((s, i) => <tr key={i}><td>{s.sifra ? `${s.sifra} — ` : ""}{s.naziv}</td><td className="f-mono">{s.jm}</td><td className="f-mono">{s.kolicina}</td><td className="f-mono">{fmtCurDec(s.cijena)}</td><td className="f-mono">{fmtCurDec(s.ukupno)}</td></tr>)}</tbody>
              </table>

              <div className="card" style={{ padding: 12, background: "var(--surface-alt)", marginTop: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
                  <div><div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Zbroj</div><div className="f-mono" style={{ fontWeight: 700 }}>{fmtCurDec(zbroj)}</div></div>
                  <Field label="Predujam (Vorkasse)"><input className="input f-mono" type="number" step="0.01" value={vorkasa} onChange={(e) => setVorkasa(e.target.value)} /></Field>
                  <div><div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Za platiti</div><div className="f-mono" style={{ fontWeight: 700, color: "var(--steel)", fontSize: 16 }}>{fmtCurDec(zaPlatiti)}</div></div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function PodlogaZaFakturuPrintModal({ podloga, projekt, narudzba, kupac, otpremnice, postavkeTvrtke, onClose }) {
  const t = postavkeTvrtke || {};
  return (
    <Modal wide title={`Pregled za ispis — Podloga za fakturu ${podloga.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => window.print()}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ marginBottom: 16, fontSize: 10.5 }}>
          <strong>{t.naziv}</strong><div>{t.adresa}</div>
        </div>

        <div style={{ border: "1px solid #333", padding: "10px 14px", marginBottom: 16 }}>
          <div style={{ textAlign: "center", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>PODLOGA ZA FAKTURU / <span style={{ fontStyle: "italic" }}>ABRECHNUNG</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 11 }}>
            <div>
              <div style={{ fontWeight: 700 }}>AG / Kupac:</div>
              <div>{kupac?.naziv}</div>
              <div>{kupac?.adresa}</div>
            </div>
            <div>
              <div><strong>Bestellung Nr.:</strong> {narudzba?.broj || "—"}</div>
              <div><strong>Bestelldatum:</strong> {narudzba ? fmtDate(narudzba.datum) : "—"}</div>
              <div><strong>Projekt:</strong> {projekt?.sifra}{projekt?.naziv ? ` — ${projekt.naziv}` : ""}</div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, marginBottom: 12 }}>
          <strong>Lieferscheine:</strong> {otpremnice.map((o) => o.broj).join(", ") || "—"}
        </div>

        <table className="doc-table" style={{ marginBottom: 16 }}>
          <thead><tr><th style={{ width: 30 }}>Nr.</th><th>Leistungsbeschreibung</th><th style={{ width: 60 }}>Menge</th><th style={{ width: 60 }}>Einheit</th><th style={{ width: 80 }}>E.P (€)</th><th style={{ width: 90 }}>G.P. (€)</th></tr></thead>
          <tbody>
            {podloga.stavke.map((s, i) => (
              <tr key={i}>
                <td>{i + 1}.</td>
                <td>{s.sifra && <div style={{ fontWeight: 700 }}>{s.sifra}</div>}<div>{s.naziv}</div></td>
                <td className="f-mono">{s.kolicina}</td>
                <td>{s.jm}</td>
                <td className="f-mono">{fmtCurDec(s.cijena)}</td>
                <td className="f-mono">{fmtCurDec(s.ukupno)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table style={{ marginLeft: "auto", fontSize: 12, borderCollapse: "collapse", minWidth: 260 }}>
          <tbody>
            <tr><td style={{ padding: "4px 10px", border: "1px solid #333" }}>Summe:</td><td style={{ padding: "4px 10px", border: "1px solid #333", textAlign: "right", fontWeight: 700 }} className="f-mono">{fmtCurDec(podloga.zbroj)}</td></tr>
            <tr><td style={{ padding: "4px 10px", border: "1px solid #333" }}>Vorkasse:</td><td style={{ padding: "4px 10px", border: "1px solid #333", textAlign: "right" }} className="f-mono">{fmtCurDec(podloga.vorkasa)}</td></tr>
            <tr><td style={{ padding: "4px 10px", border: "1px solid #333", fontWeight: 700 }}>Gesamt zu Zahlen:</td><td style={{ padding: "4px 10px", border: "1px solid #333", textAlign: "right", fontWeight: 700 }} className="f-mono">{fmtCurDec(podloga.zaPlatiti)}</td></tr>
          </tbody>
        </table>

        <div style={{ marginTop: 20, fontSize: 11 }}>DATUM: {fmtDate(podloga.datum)}</div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, marginTop: 24, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>Žiro račun:</strong> {t.ziroRacun}<br />
          <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Temeljni kapital:</strong> {t.temeljniKapital} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

function PodlogeZaFakturuTab({ db, update, showToast, mozeMijenjati = true }) {
  const [formOpen, setFormOpen] = useState(false);
  const [printPodloga, setPrintPodloga] = useState(null);
  const [del, setDel] = useState(null);
  const projektInfo = (id) => db.projekti.find((p) => p.id === id);

  return (
    <div>
      {mozeMijenjati && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <Btn variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>Nova podloga za fakturu</Btn>
        </div>
      )}
      {db.podlogeZaFakturu.length === 0 ? <EmptyState text="Nema izrađenih podloga za fakturu." /> : (
        <table className="erp-table">
          <thead><tr><th>Broj</th><th>Projekt</th><th>Datum</th><th>Za platiti</th><th></th></tr></thead>
          <tbody>
            {[...db.podlogeZaFakturu].sort((a, b) => b.datum.localeCompare(a.datum)).map((p) => (
              <tr key={p.id}>
                <td className="f-mono">{p.broj}</td>
                <td>{projektInfo(p.projektId)?.sifra || "—"}</td>
                <td>{fmtDate(p.datum)}</td>
                <td className="f-mono">{fmtCurDec(p.zaPlatiti)}</td>
                <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <Btn size="sm" icon={Eye} onClick={() => setPrintPodloga(p)}>PDF</Btn>
                  {mozeMijenjati && <button className="btn btn-icon btn-ghost" onClick={() => setDel(p)}><Trash2 size={14} color="var(--rust)" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {formOpen && <PodlogaZaFakturuFormModal db={db} update={update} showToast={showToast} onClose={() => setFormOpen(false)} />}
      {printPodloga && (
        <PodlogaZaFakturuPrintModal
          podloga={printPodloga}
          projekt={projektInfo(printPodloga.projektId)}
          narudzba={db.narudzbe.find((n) => n.id === printPodloga.narudzbaId)}
          kupac={db.kupci.find((k) => k.id === db.narudzbe.find((n) => n.id === printPodloga.narudzbaId)?.kupacId)}
          otpremnice={db.otpremnice.filter((o) => printPodloga.otpremniceIds.includes(o.id))}
          postavkeTvrtke={db.postavkeTvrtke}
          onClose={() => setPrintPodloga(null)}
        />
      )}
      {del && <ConfirmDelete label={del.broj} onCancel={() => setDel(null)} onConfirm={() => { update("podlogeZaFakturu", db.podlogeZaFakturu.filter((p) => p.id !== del.id)); setDel(null); showToast("Podloga obrisana."); }} />}
    </div>
  );
}

function OtpremniceTab({ db, update, patchProjekt, showToast, mozeMijenjati = true }) {
  const [printOtp, setPrintOtp] = useState(null);
  const [del, setDel] = useState(null);
  const [novaOtvorena, setNovaOtvorena] = useState(false);
  const projektInfo = (id) => db.projekti.find((p) => p.id === id);
  const kupacInfo = (id) => db.kupci.find((k) => k.id === id);

  return (
    <div>
      {mozeMijenjati && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
          <Btn variant="primary" icon={Plus} onClick={() => setNovaOtvorena(true)}>Nova otpremnica</Btn>
        </div>
      )}
      {db.otpremnice.length === 0 ? <EmptyState text="Nema izdanih otpremnica." /> : (
        <table className="erp-table">
          <thead><tr><th>Broj</th><th>Projekt</th><th>Primatelj</th><th>Vrsta</th><th>Datum</th><th>Stavki</th><th></th></tr></thead>
          <tbody>
            {[...db.otpremnice].sort((a, b) => b.datum.localeCompare(a.datum)).map((o) => {
              const projekt = projektInfo(o.projektId);
              const jeKooperant = o.vrsta === "kooperant";
              const primatelj = jeKooperant ? db.dobavljaci.find((d) => d.id === o.dobavljacId)?.naziv : kupacInfo(o.kupacId)?.naziv;
              return (
                <tr key={o.id}>
                  <td className="f-mono">{o.broj}</td>
                  <td>{projekt?.sifra}{projekt?.naziv ? ` — ${projekt.naziv}` : ""}</td>
                  <td>{primatelj || "—"}</td>
                  <td>{jeKooperant ? <span style={{ color: "var(--steel)" }}>Kooperant (dorada)</span> : "Kupac"}</td>
                  <td>{fmtDate(o.datum)}</td>
                  <td className="f-mono">{o.stavke.length}</td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <Btn size="sm" icon={Eye} onClick={() => setPrintOtp(o)}>PDF</Btn>
                    {mozeMijenjati && <button className="btn btn-icon btn-ghost" onClick={() => setDel(o)}><Trash2 size={14} color="var(--rust)" /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {printOtp && <OtpremnicaPrintModal otpremnica={printOtp} db={db} onClose={() => setPrintOtp(null)} />}
      {del && (
        <ConfirmDelete label={del.broj} onCancel={() => setDel(null)} onConfirm={() => {
          // Brisanje otpremnice mora osloboditi isporuke tipskog projekta koje je "zaključavala"
          // (uOtpremniciId) — inače ostaju trajno prikazane kao "U otpremnici" s onemogućenom
          // kvačicom, iako otpremnica na koju upućuju više ne postoji.
          update("otpremnice", db.otpremnice.filter((o) => o.id !== del.id));
          const projekt = db.projekti.find((p) => p.id === del.projektId);
          if (projekt) patchProjekt(del.projektId, { isporuke: (projekt.isporuke || []).map((i) => (i.uOtpremniciId === del.id ? { ...i, uOtpremniciId: null } : i)) });
          setDel(null);
          showToast("Otpremnica obrisana, isporuke oslobođene.");
        }} />
      )}
      {novaOtvorena && <NovaOtpremnicaModal db={db} update={update} patchProjekt={patchProjekt} showToast={showToast} onClose={() => setNovaOtvorena(false)} />}
    </div>
  );
}

// Otpremnice se inače kreiraju iz detalja pojedinog projekta (OtpremniceListModal) — ovaj modal
// omogućava isto izravno iz opće liste Otpremnica. Prvo pita vrstu: "Kupcu" (postojeći tijek —
// jedan korak ispred, odabir projekta, pa ISTI obrazac OtpremnicaFormModal) ili "Kooperantu"
// (dorada poput plastifikacije — slobodan unos stavki vezan uz radni nalog, ne uz narudžbu kupca).
function NovaOtpremnicaModal({ db, update, patchProjekt, showToast, onClose }) {
  const [vrsta, setVrsta] = useState(null); // null | "kupac" | "kooperant"
  const [projektId, setProjektId] = useState("");

  if (vrsta === "kooperant") {
    return <OtpremnicaKooperantuModal db={db} update={update} showToast={showToast} onClose={onClose} />;
  }

  if (vrsta === "kupac") {
    // Nudi samo projekte koji stvarno imaju što otpremiti — ista provjera kao "nemaStavki" u
    // OtpremniceListModal (per-projektnom prikazu), da izbor ne vodi u prazan obrazac.
    const projektiZaOtpremu = db.projekti.filter((p) => (p.koristiNormativ
      ? (p.isporuke || []).some((i) => i.isporuceno && !i.uOtpremniciId)
      : db.narudzbe.some((n) => n.projektId === p.id)));
    const projekt = db.projekti.find((p) => p.id === projektId);

    if (projekt) {
      const narudzba = db.narudzbe.find((n) => n.projektId === projekt.id);
      return <OtpremnicaFormModal narudzba={narudzba} projekt={projekt} db={db} update={update} patchProjekt={patchProjekt} showToast={showToast} onClose={onClose} />;
    }

    return (
      <Modal title="Nova otpremnica — odaberi projekt" onClose={onClose} footer={<><Btn onClick={() => setVrsta(null)}>Natrag</Btn><Btn onClick={onClose}>Odustani</Btn></>}>
        <Field label="Projekt">
          <select className="select" value={projektId} onChange={(e) => setProjektId(e.target.value)}>
            <option value="">— odaberi projekt —</option>
            {projektiZaOtpremu.map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}
          </select>
        </Field>
        {projektiZaOtpremu.length === 0 && (
          <p style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>Nema projekata spremnih za otpremu — potrebna je unesena narudžba kupca, ili (za tipske projekte/kupaonice) barem jedna stavka označena kao spremna za otpremu u rasporedu isporuka.</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="Nova otpremnica" onClose={onClose} footer={<Btn onClick={onClose}>Odustani</Btn>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>Kome se šalje ova otpremnica?</p>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn variant="primary" onClick={() => setVrsta("kupac")}>Kupcu</Btn>
        <Btn variant="primary" onClick={() => setVrsta("kooperant")}>Kooperantu (dorada)</Btn>
      </div>
    </Modal>
  );
}

// Otpremnica prema kooperantu (npr. slanje na plastifikaciju/pocinčavanje) — vezana uz radni
// nalog umjesto uz narudžbu kupca, sa slobodnim unosom naziva stavki jer se često razlikuju od
// naziva na narudžbenici materijala.
function OtpremnicaKooperantuModal({ db, update, showToast, onClose }) {
  const [projektId, setProjektId] = useState("");
  const [dobavljacId, setDobavljacId] = useState(db.dobavljaci[0]?.id || "");
  const [datum, setDatum] = useState(todayISO());
  const [mjesto, setMjesto] = useState("Prelog");
  const [izdaoId, setIzdaoId] = useState("");
  const [napomena, setNapomena] = useState("");
  const prazanRedak = () => ({ id: uid("ost"), naziv: "", jm: "kom", kolicina: "" });
  const [stavke, setStavke] = useState([prazanRedak()]);

  const aktivniProjekti = [...db.projekti].filter((p) => p.status !== "Završen").sort((a, b) => usporediPrirodno(a.sifra, b.sifra));

  const azurirajStavku = (i, patch) => setStavke(stavke.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const spremi = () => {
    if (!projektId) { showToast("Odaberi projekt."); return; }
    if (!dobavljacId) { showToast("Odaberi kooperanta."); return; }
    const validne = stavke.filter((s) => s.naziv.trim() && Number(s.kolicina) > 0).map((s) => ({ ...s, kolicina: Number(s.kolicina) }));
    if (validne.length === 0) { showToast("Dodaj barem jednu stavku s nazivom i količinom."); return; }
    const nova = {
      id: uid("otp"), broj: sljedeciBrojOtpremnice(db.otpremnice, datum), datum, mjesto,
      vrsta: "kooperant", dobavljacId, projektId,
      kupacId: null, narudzbaId: null, izdaoId, napomena, stavke: validne,
    };
    update("otpremnice", [...db.otpremnice, nova]);
    showToast("Otpremnica kooperantu kreirana.");
    onClose();
  };

  return (
    <Modal wide title="Nova otpremnica — kooperantu (dorada)" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi}>Kreiraj otpremnicu</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Projekt">
          <select className="select" value={projektId} onChange={(e) => setProjektId(e.target.value)}>
            <option value="">— odaberi —</option>
            {aktivniProjekti.map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}
          </select>
        </Field>
        <Field label="Kooperant (dobavljač)">
          <select className="select" value={dobavljacId} onChange={(e) => setDobavljacId(e.target.value)}>
            {db.dobavljaci.map((d) => <option key={d.id} value={d.id}>{d.naziv}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="Datum"><input className="input" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></Field>
        <Field label="Mjesto"><input className="input" value={mjesto} onChange={(e) => setMjesto(e.target.value)} /></Field>
        <Field label="Izdao (zaposlenik)">
          <select className="select" value={izdaoId} onChange={(e) => setIzdaoId(e.target.value)}>
            <option value="">—</option>
            {[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
          </select>
        </Field>
      </div>

      <div className="label" style={{ marginTop: 6, marginBottom: 6 }}>Stavke za otpremu (slobodan unos naziva — ne moraju odgovarati nazivima iz narudžbenice)</div>
      <table className="erp-table" style={{ marginBottom: 8 }}>
        <thead><tr><th>Naziv</th><th style={{ width: 90 }}>JM</th><th style={{ width: 130 }}>Količina</th><th style={{ width: 36 }}></th></tr></thead>
        <tbody>
          {stavke.map((s, i) => (
            <tr key={s.id}>
              <td><input className="input" value={s.naziv} onChange={(e) => azurirajStavku(i, { naziv: e.target.value })} placeholder="npr. Profili za plastifikaciju" /></td>
              <td><input className="input" value={s.jm} onChange={(e) => azurirajStavku(i, { jm: e.target.value })} /></td>
              <td><input className="input f-mono" type="number" min="0" value={s.kolicina} onChange={(e) => azurirajStavku(i, { kolicina: e.target.value })} /></td>
              <td><button className="btn btn-icon btn-ghost" onClick={() => setStavke(stavke.filter((_, idx) => idx !== i))}><X size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Btn variant="ghost" size="sm" icon={Plus} onClick={() => setStavke([...stavke, prazanRedak()])}>Dodaj stavku</Btn>

      <Field label="Napomena"><textarea className="textarea" rows={2} value={napomena} onChange={(e) => setNapomena(e.target.value)} /></Field>
    </Modal>
  );
}

/* ============================== CMR (međunarodni teretni list za izvoz) ============================== */
// Sljedeći broj CMR-a, format CMR-DD-MM-N/YY (isti princip kao otpremnice). Server dodatno
// jamči jedinstvenost (vidi /api/cmr/patch).
const sljedeciBrojCmr = (lista, datumISO) => {
  const d = new Date(datumISO);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const prefiks = `CMR-${dd}-${mm}-`;
  const sufiks = `/${yy}`;
  const brojevi = (lista || []).map((c) => c?.broj).filter((b) => b && b.startsWith(prefiks) && b.endsWith(sufiks))
    .map((b) => parseInt(b.slice(prefiks.length, b.length - sufiks.length), 10)).filter((n) => !isNaN(n));
  return `${prefiks}${(brojevi.length ? Math.max(...brojevi) : 0) + 1}${sufiks}`;
};

// Težina otpremnice: po stavci uzima masu upisanu na otpremnici (masaKg), a ako nje nema, masu iz
// narudžbe kupca (masa po jedinici × količina). Stavke bez ijednog podatka se broje u "nedostaje".
const tezinaOtpremnice = (otpremnica, db) => {
  const narudzba = db.narudzbe.find((n) => n.id === otpremnica.narudzbaId);
  let ukupno = 0, nedostaje = 0;
  (otpremnica.stavke || []).forEach((s) => {
    const upisana = Number(s.masaKg);
    if (upisana > 0) { ukupno += upisana; return; }
    const nst = narudzba?.stavke?.find((x) => x.id === s.narudzbaStavkaId);
    const izNarudzbe = (Number(nst?.masaJed) || 0) * (Number(s.kolicina) || 0);
    if (izNarudzbe > 0) ukupno += izNarudzbe; else nedostaje += 1;
  });
  return { ukupno, nedostaje };
};

const CMR_STATUSI = ["Izdan", "Potpisao prijevoznik", "Isporučeno (potpisao primatelj)"];

// Prijedlog svih polja CMR-a iz projekta i odabranih otpremnica — sve se kasnije može ručno urediti.
const cmrPrijedlog = (db, projekt, otpremniceIds, datum) => {
  const t = db.postavkeTvrtke || {};
  const kupac = db.kupci.find((k) => k.id === projekt?.kupacId);
  const odabrane = db.otpremnice.filter((o) => otpremniceIds.includes(o.id));
  const primatelj = [kupac?.naziv, kupac?.adresa].filter(Boolean).join("\n");
  const mjestoIsporuke = projekt?.mjestoIsporuke || primatelj;
  const zadnjaLinija = mjestoIsporuke.split("\n").map((l) => l.trim()).filter(Boolean).pop() || "";
  const tezina = odabrane.reduce((s, o) => s + tezinaOtpremnice(o, db).ukupno, 0);
  return {
    projektId: projekt?.id || "", kupacId: projekt?.kupacId || "", otpremniceIds, datum,
    posiljatelj: [t.naziv, t.adresa, "CRO"].filter(Boolean).join("\n"),
    primatelj, mjestoIsporuke,
    mjestoPreuzimanja: [t.adresa, fmtDate(datum)].filter(Boolean).join("\n"),
    dokumenti: odabrane.length ? `Otpremnice: ${odabrane.map((o) => String(o.broj).replace(/^OTP-/, "")).join("; ")}` : "",
    prijevoznikId: "", registracija: "", vozac: "", prijevoznikTekst: "",
    napomenePrijevoznika: "", posebniDogovori: "",
    oznake: projekt?.sifra || "", brojKoleta: "", vrstaPakiranja: "",
    opisRobe: projekt?.cmrOpisRobe || "Stahlkonstruktion",
    statistickiBroj: t.cmrStatistickiBroj || "73089098",
    brutoTezina: tezina > 0 ? String(Math.round(tezina * 10) / 10) : "", volumen: "",
    upute: [t.naziv ? `Exp: ${t.naziv}` : "", kupac?.naziv ? `Imp: ${kupac.naziv}` : ""].filter(Boolean).join("\n"),
    uvjetIsporuke: `${t.cmrUvjetIsporuke || "DAP"}${zadnjaLinija ? `: ${zadnjaLinija}` : ""}`,
    placanjeVozarine: "", mjestoIzdavanja: "Prelog",
  };
};

const CMR_NASLOVI_PRIMJERAKA = [
  "Primjerak 1 — pošiljatelj / Exemplar 1 — Absender / Copy 1 — Sender",
  "Primjerak 2 — primatelj / Exemplar 2 — Empfänger / Copy 2 — Consignee",
  "Primjerak 3 — prijevoznik / Exemplar 3 — Frachtführer / Copy 3 — Carrier",
];

const CMR_CSS = `
.cmr-page{position:relative;width:595pt;height:842pt;font-family:Arial,Helvetica,sans-serif;color:#000;page-break-after:always;overflow:hidden;background:#fff}
.cmr-page:last-child{page-break-after:auto}
.cmr-traka{position:absolute;left:0;top:0;width:595pt;height:24pt;background:#000;color:#fff;font-size:8pt;line-height:24pt;padding-left:32pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cmr-b{position:absolute;border:0.8pt solid #000;box-sizing:border-box;overflow:hidden}
.cmr-b.teska{border-width:1.6pt}
.cmr-n{position:absolute;left:3pt;top:2pt;font-size:7pt;font-weight:700}
.cmr-l{position:absolute;left:14pt;top:2pt;right:3pt;font-size:5.6pt;line-height:1.15;color:#222}
.cmr-l i{display:block;font-style:normal;color:#444}
.cmr-v{position:absolute;left:5pt;right:4pt;white-space:pre-line;font-size:9.5pt;line-height:1.2}
.cmr-c{position:absolute;border-left:0.8pt solid #000;box-sizing:border-box}
.cmr-r{position:absolute;border-top:0.8pt solid #000;box-sizing:border-box}
.cmr-mali{font-size:5.6pt;line-height:1.15}
.cmr-podnozje{position:absolute;left:0;top:800pt;width:595pt;height:34pt;background:#000;color:#fff;font-size:5.8pt;line-height:1.4;padding:6pt 0 0 32pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
`;

const cmrStranicaHtml = (c, db, naslovPrimjerka) => {
  const prijevoznik = db.dobavljaci.find((d) => d.id === c.prijevoznikId);
  const L = (de, en) => `<div class="cmr-l">${de}<i>${en}</i></div>`;
  // x, y, w, h u pt (A4 595×842); n = broj polja; v = tekst; vTop = odmak teksta od vrha
  const kutija = (n, de, en, x, y, w, h, v, o = {}) =>
    `<div class="cmr-b${o.teska ? " teska" : ""}" style="left:${x}pt;top:${y}pt;width:${w}pt;height:${h}pt"><span class="cmr-n">${n}</span>${L(de, en)}`
    + (v ? `<div class="cmr-v" style="top:${o.vTop ?? 22}pt;${o.vStil || ""}">${escHtml(v)}</div>` : "") + (o.extra || "") + `</div>`;
  const tez = c.brutoTezina ? `${c.brutoTezina} kg` : "";
  // Tablica 19 (naknade) — samo prazna mreža, popunjava se ručno
  const naknade = ["Fracht|Carriage", "Ermäßigung|Reductions", "Zwischensumme|Balance", "Zuschläge|Supplement charges", "Nebengebühren|Additional charges", "Sonstiges|Miscellaneous", "Gesamtbetrag|Total to be paid"];
  const redakNaknade = (txt, i) => {
    const [de, en] = txt.split("|"); const top = 30 + i * 13.5;
    return `<div class="cmr-r" style="left:0;top:${top}pt;width:240pt;height:13.5pt"></div><div class="cmr-mali" style="position:absolute;left:3pt;top:${top + 1.5}pt;width:60pt">${de}<br>${en}</div>`;
  };
  const tablica19 = `<div class="cmr-mali" style="position:absolute;left:62pt;top:3pt;width:60pt;font-weight:700">Zu bezahlen vom<br>To be paid by</div>`
    + `<div class="cmr-mali" style="position:absolute;left:122pt;top:3pt;width:58pt;text-align:center">Absender<br>Sender</div><div class="cmr-mali" style="position:absolute;left:150pt;top:3pt;width:50pt;text-align:center">Währung<br>Currency</div><div class="cmr-mali" style="position:absolute;left:200pt;top:3pt;width:40pt;text-align:center">Empfänger<br>Consignee</div>`
    + `<div class="cmr-r" style="left:0;top:26pt;width:240pt;height:0"></div>`
    + naknade.map(redakNaknade).join("")
    + [61, 121, 149, 177, 205].map((x) => `<div class="cmr-c" style="left:${x}pt;top:26pt;height:96pt"></div>`).join("");
  const kolone = [[0, 98, "6", "Kennzeichen u. Nummern", "Marks and Nos"], [98, 84, "7", "Anzahl der Pakete", "Number of packages"], [182, 88, "8", "Art der Verpackung", "Method of packing"], [270, 86, "9", "Bezeichnung des Gutes*", "Nature of the goods*"], [356, 58, "10", "Statistiknr.", "Statistical nr."], [414, 54, "11", "Bruttogew. kg", "Gross weight kg"], [468, 67, "12", "Volumen in m³", "Volume in m³"]];
  const vrijednostiRobe = [c.oznake, c.brojKoleta, c.vrstaPakiranja, c.opisRobe, c.statistickiBroj, tez, c.volumen];
  const roba = `<div class="cmr-b" style="left:32pt;top:318pt;width:535pt;height:176pt">`
    + kolone.map(([x, w, n, de, en], i) => `<div class="cmr-c" style="left:${x}pt;top:0;width:${w}pt;height:154pt;${i === 0 ? "border-left:none" : ""}"><span class="cmr-n">${n}</span>${L(de, en)}<div class="cmr-v" style="top:26pt;left:3pt;font-size:9pt">${escHtml(vrijednostiRobe[i])}</div></div>`).join("")
    + `<div class="cmr-r" style="left:0;top:154pt;width:535pt;height:22pt"></div>`
    + `<div class="cmr-mali" style="position:absolute;left:4pt;top:156pt;width:520pt">UN-Nr. / UN No. &nbsp;&nbsp;&nbsp; Ben. s. Nr. 9 / name s. nr. 9 &nbsp;&nbsp;&nbsp; Gefahrzettelmuster-Nr. / Hazard label sample no. &nbsp;&nbsp;&nbsp; Verp.-Grp. / Pack. group &nbsp;&nbsp;&nbsp;(*Bei gefährlichen Gütern: Klasse, UN-Nr., Verpackungsgruppe — In case of dangerous goods: class, UN number, packing group)</div></div>`;
  const kvacica = (oznaceno) => (oznaceno ? "X" : "&nbsp;");
  return `<div class="cmr-page"><div class="cmr-traka">${escHtml(naslovPrimjerka)}</div>`
    + kutija("1", "Absender (Name, Adresse, Land)", "Sender (name, address, country)", 32, 40, 295, 64, c.posiljatelj)
    + `<div class="cmr-b" style="left:327pt;top:40pt;width:240pt;height:64pt"><div style="position:absolute;left:5pt;top:3pt;font-size:7.5pt;font-weight:700;line-height:1.15">INTERNATIONALER FRACHTBRIEF<br>INTERNATIONAL CONSIGNMENT NOTE</div>`
    + `<div style="position:absolute;right:6pt;top:3pt;width:30pt;height:14pt;border:1pt solid #000;border-radius:7pt;text-align:center;font-size:8pt;font-weight:700;line-height:14pt">CMR</div><div style="position:absolute;right:6pt;top:19pt;font-size:10pt;font-weight:700">№ ${escHtml(c.broj || "")}</div>`
    + `<div class="cmr-mali" style="position:absolute;left:5pt;top:32pt;width:112pt">Diese Beförderung unterliegt, unbeschadet anders lautender Bestimmungen, dem Übereinkommen über den Vertrag über den internationalen Güterkraftverkehr (CMR).</div>`
    + `<div class="cmr-mali" style="position:absolute;left:122pt;top:32pt;width:114pt">This carriage is subject, notwithstanding any clause to the contrary, to the Convention on the Contract for the international Carriage of goods by road (CMR).</div></div>`
    + kutija("2", "Empfänger (Name, Adresse, Land)", "Consignee (name, address, country)", 32, 104, 295, 62, c.primatelj)
    + kutija("16", "Frachtführer (Name, Adresse, Land)", "Carrier (name, address, country)", 327, 104, 240, 62, c.prijevoznikTekst || [prijevoznik?.naziv, prijevoznik?.adresa].filter(Boolean).join("\n"), { teska: true })
    + kutija("3", "Auslieferort des Gutes (Ort, Land)", "Place of delivery of the goods (place, country)", 32, 166, 295, 62, c.mjestoIsporuke)
    + kutija("17", "Nachfolgender Frachtführer (Name, Adresse, Land)", "Successive carriers (name, address, country)", 327, 166, 240, 62, "")
    + kutija("4", "Ort und Datum der Übernahme des Gutes (Ort, Land, Datum)", "Place and date of taking over the goods (place, country, date)", 32, 228, 295, 48, c.mjestoPreuzimanja)
    + kutija("18", "Vorbehalte und Bemerkungen der Frachtführer", "Carrier's reservations and observations", 327, 228, 240, 90, c.napomenePrijevoznika, { teska: true })
    + kutija("5", "Beigefügte Dokumente", "Documents attached", 32, 276, 295, 42, c.dokumenti, { vTop: 17 })
    + roba
    + kutija("13", "Anweisungen des Absenders (Zoll-, amtl. Behandlungen, Sondervorschriften, etc.)", "Sender's instructions (customs and other formalities)", 32, 494, 295, 134, c.upute)
    + `<div class="cmr-b" style="left:327pt;top:494pt;width:240pt;height:134pt"><span class="cmr-n">19</span>${tablica19}</div>`
    + kutija("14", "Rückerstattung", "Cash on delivery", 32, 628, 535, 24, c.uvjetIsporuke, { vTop: 8, vStil: "left:90pt;" })
    + kutija("15", "Frachtzahlungsanweisungen", "Instruction as to payment carriage", 32, 652, 295, 36, "", { extra: `<div class="cmr-mali" style="position:absolute;left:14pt;top:17pt">Frei / Carriage paid: <b>${kvacica(c.placanjeVozarine === "frei")}</b> &nbsp;&nbsp;&nbsp; Unfrei / Carriage forward: <b>${kvacica(c.placanjeVozarine === "unfrei")}</b></div>` })
    + kutija("21", "Ausgefertigt in", "Established in", 32, 688, 295, 26, "", { extra: `<div style="position:absolute;left:62pt;top:7pt;font-size:10pt">${escHtml(c.mjestoIzdavanja || "")}</div><div class="cmr-mali" style="position:absolute;left:170pt;top:5pt">am / on</div><div style="position:absolute;left:200pt;top:7pt;font-size:10pt">${escHtml(fmtDate(c.datum))}</div>` })
    + kutija("20", "Besondere Vereinbarungen", "Special agreements", 327, 652, 240, 62, c.posebniDogovori)
    + kutija("22", "Signatur und Stempel des Absenders", "Signature and stamp of the sender", 32, 714, 215, 84, (() => { const z = (db.zaposlenici || []).find((x) => x.id === c.izradioId); return z ? `${z.ime} ${z.prezime}` : ""; })(), { vTop: 24, vStil: "font-size:10pt;", extra: `<div class="cmr-mali" style="position:absolute;left:14pt;bottom:2pt">Signatur und Stempel des Absenders<br>Signature and stamp of the sender</div>` })
    + kutija("23", "Unterschrift und Stempel des Frachtführers", "Signature and stamp of the carrier", 247, 714, 190, 84, "", { teska: true })
    + kutija("24", "Gut empfangen", "Goods received", 437, 714, 130, 84, "", { extra: `<div class="cmr-mali" style="position:absolute;left:5pt;top:20pt">Ort / Place</div><div class="cmr-mali" style="position:absolute;left:5pt;top:34pt">am / on</div><div class="cmr-mali" style="position:absolute;left:5pt;bottom:2pt">Unterschrift und Stempel des Empfängers<br>Signature and stamp of the consignee</div>` })
    + `<div class="cmr-podnozje">Das CMR/IRU/Polen-Modell von 1976 für den internationalen Straßenverkehr entspricht den Regelungen der Internationalen Straßenverkehrsunion /IRU/.<br>The 1976 CMR/IRU/Poland model for international road transport complies with the rules of the International Road Transport Union /IRU/.</div></div>`;
};

const cmrPrintHtml = (c, db) => `<style>${CMR_CSS}</style>${CMR_NASLOVI_PRIMJERAKA.map((n) => cmrStranicaHtml(c, db, n)).join("")}`;

const otvoriIspisCmr = (html, naslov) => {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(naslov)}</title><style>@page{size:A4 portrait;margin:0}body{margin:0}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
};

function CmrPrintModal({ cmr, db, showToast, onClose }) {
  const html = useMemo(() => cmrPrintHtml(cmr, db), [cmr, db]);
  const projekt = db.projekti.find((p) => p.id === cmr.projektId);
  const naslov = `${String(cmr.datum || "").slice(2).replace(/-/g, "")}_CMR_${(projekt?.sifra || "").replace(/\s+/g, "_")}`;
  const ispisi = () => { if (!otvoriIspisCmr(html, naslov)) showToast("Preglednik je blokirao novi prozor — dozvoli skočne prozore za ovu stranicu i pokušaj ponovno."); };
  return (
    <Modal wide title={`Pregled za ispis — ${cmr.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={ispisi}>Ispis / Spremi kao PDF (3 primjerka)</Btn></>}>
      <div style={{ overflow: "auto", maxHeight: "70vh", background: "#ddd", padding: 8 }}>
        <div style={{ transform: "scale(0.95)", transformOrigin: "top left" }} dangerouslySetInnerHTML={{ __html: html.replace(/page-break-after:always/g, "margin-bottom:10px") }} />
      </div>
    </Modal>
  );
}

function CmrFormModal({ db, pocetni, onSpremi, onClose }) {
  const [f, setF] = useState(pocetni);
  const projekt = db.projekti.find((p) => p.id === f.projektId);
  const otpremniceProjekta = db.otpremnice.filter((o) => o.projektId === f.projektId && o.vrsta !== "kooperant").sort((a, b) => a.datum.localeCompare(b.datum));
  const prijevoznici = db.dobavljaci.filter((d) => d.prijevoznik);
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const odaberiProjekt = (id) => {
    const p = db.projekti.find((x) => x.id === id);
    setF((prev) => ({ ...prev, ...cmrPrijedlog(db, p, [], prev.datum), id: prev.id, broj: prev.broj, status: prev.status, statusDatumi: prev.statusDatumi,
      prijevoznikId: prev.prijevoznikId, registracija: prev.registracija, vozac: prev.vozac, prijevoznikTekst: prev.prijevoznikTekst, izradioId: prev.izradioId }));
  };
  const promijeniOtpremnice = (ids) => {
    const odabrane = db.otpremnice.filter((o) => ids.includes(o.id));
    const tezina = odabrane.reduce((s, o) => s + tezinaOtpremnice(o, db).ukupno, 0);
    set({ otpremniceIds: ids,
      dokumenti: odabrane.length ? `Otpremnice: ${odabrane.map((o) => String(o.broj).replace(/^OTP-/, "")).join("; ")}` : "",
      brutoTezina: tezina > 0 ? String(Math.round(tezina * 10) / 10) : f.brutoTezina });
  };
  const tekstPrijevoznika = (id, reg, vozac) => {
    const d = db.dobavljaci.find((x) => x.id === id);
    return [d?.naziv, d?.adresa, reg ? `Reg. oznaka / Kennzeichen: ${reg}` : "", vozac ? `Vozač / Fahrer: ${vozac}` : ""].filter(Boolean).join("\n");
  };
  const promijeniPrijevoz = (patch) => { const n = { ...f, ...patch }; set({ ...patch, prijevoznikTekst: tekstPrijevoznika(n.prijevoznikId, n.registracija, n.vozac) }); };
  const odabraneTezine = db.otpremnice.filter((o) => f.otpremniceIds.includes(o.id)).map((o) => tezinaOtpremnice(o, db));
  const bezTezine = odabraneTezine.reduce((s, t) => s + t.nedostaje, 0);
  const T = (label, k, rows = 2) => (
    <Field label={label}><textarea className="textarea" rows={rows} value={f[k] || ""} onChange={(e) => set({ [k]: e.target.value })} /></Field>
  );
  const I = (label, k, mono) => <Field label={label}><input className={`input${mono ? " f-mono" : ""}`} value={f[k] || ""} onChange={(e) => set({ [k]: e.target.value })} /></Field>;
  return (
    <Modal wide title={f.id ? `Uredi ${f.broj}` : "Novi CMR"} onClose={onClose}
      footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={() => onSpremi(f, false)}>Spremi</Btn><Btn variant="primary" icon={Eye} onClick={() => onSpremi(f, true)}>Spremi i pregledaj ispis</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
        <Field label="Projekt">
          <select className="select" disabled={!!f.id} value={f.projektId} onChange={(e) => odaberiProjekt(e.target.value)}>
            <option value="">— odaberi projekt —</option>
            {db.projekti.map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}
          </select>
        </Field>
        <Field label="Broj CMR-a"><input className="input f-mono" value={f.broj} disabled /></Field>
        <Field label="Datum"><input className="input" type="date" value={f.datum} onChange={(e) => set({ datum: e.target.value, broj: f.id ? f.broj : sljedeciBrojCmr(db.cmr, e.target.value), mjestoPreuzimanja: [(db.postavkeTvrtke || {}).adresa, fmtDate(e.target.value)].filter(Boolean).join("\n") })} /></Field>
      </div>

      {projekt && (
        <>
          <div className="label" style={{ marginTop: 6 }}>Otpremnice koje ulaze u ovaj CMR (polje 5)</div>
          {otpremniceProjekta.length === 0 ? <EmptyState text="Za ovaj projekt još nema otpremnica." /> : (
            <div className="card" style={{ padding: 8, marginBottom: 10 }}>
              {otpremniceProjekta.map((o) => {
                const drugiCmr = db.cmr.find((c) => c.id !== f.id && (c.otpremniceIds || []).includes(o.id));
                const t = tezinaOtpremnice(o, db);
                return (
                  <label key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", cursor: "pointer", fontSize: 12.5 }}>
                    <input type="checkbox" checked={f.otpremniceIds.includes(o.id)} onChange={(e) => promijeniOtpremnice(e.target.checked ? [...f.otpremniceIds, o.id] : f.otpremniceIds.filter((i) => i !== o.id))} />
                    <span className="f-mono">{o.broj}</span> · {fmtDate(o.datum)} · {(o.stavke || []).length} stavki
                    <span style={{ color: "var(--ink-faint)" }}>· {t.ukupno > 0 ? `${Math.round(t.ukupno * 10) / 10} kg${t.nedostaje ? ` (+ ${t.nedostaje} stavki bez težine)` : ""}` : "težina nije upisana"}</span>
                    {drugiCmr && <span style={{ color: "var(--rust)" }}>· već u {drugiCmr.broj}</span>}
                  </label>
                );
              })}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {T("1 — Pošiljatelj", "posiljatelj", 3)}
            {T("2 — Primatelj", "primatelj", 3)}
            {T("3 — Mjesto isporuke (iz projekta)", "mjestoIsporuke", 3)}
            {T("4 — Mjesto i datum preuzimanja", "mjestoPreuzimanja", 3)}
            {T("5 — Priloženi dokumenti", "dokumenti", 2)}
            {T("13 — Upute pošiljatelja (carina…)", "upute", 2)}
          </div>

          <div className="label" style={{ marginTop: 6 }}>Prijevoznik (polje 16)</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            <Field label="Prijevoznik">
              <select className="select" value={f.prijevoznikId || ""} onChange={(e) => promijeniPrijevoz({ prijevoznikId: e.target.value })}>
                <option value="">— odaberi —</option>
                {prijevoznici.map((d) => <option key={d.id} value={d.id}>{d.naziv}</option>)}
              </select>
              {prijevoznici.length === 0 && <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3 }}>Nema prijevoznika — u Partneri → Dobavljači označi dobavljača kao "Prijevoznik".</div>}
            </Field>
            <Field label="Registracija vozila"><input className="input f-mono" value={f.registracija || ""} onChange={(e) => promijeniPrijevoz({ registracija: e.target.value })} /></Field>
            <Field label="Vozač"><input className="input" value={f.vozac || ""} onChange={(e) => promijeniPrijevoz({ vozac: e.target.value })} /></Field>
          </div>
          {T("16 — Tekst prijevoznika na CMR-u", "prijevoznikTekst", 3)}

          <div className="label" style={{ marginTop: 6 }}>Roba (polja 6–12)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            {I("6 — Oznake i brojevi", "oznake", true)}
            {I("7 — Broj koleta", "brojKoleta", true)}
            {I("8 — Vrsta pakiranja", "vrstaPakiranja")}
            {I("9 — Opis robe (pamti se po projektu)", "opisRobe")}
            {I("10 — Carinska tarifna oznaka", "statistickiBroj", true)}
            <Field label="11 — Bruto težina (kg)">
              <input className="input f-mono" value={f.brutoTezina || ""} onChange={(e) => set({ brutoTezina: e.target.value })} />
              {f.otpremniceIds.length > 0 && <div style={{ fontSize: 10.5, color: bezTezine ? "var(--rust)" : "var(--ink-faint)", marginTop: 3 }}>{bezTezine ? `Za ${bezTezine} stavki nema težine (otpremnica/narudžba) — dopuni ručno.` : "Izračunato iz otpremnica/narudžbe."}</div>}
            </Field>
            {I("12 — Volumen (m³)", "volumen", true)}
          </div>

          <div className="label" style={{ marginTop: 6 }}>Plaćanje i ostalo</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            {I("14 — Uvjet isporuke (Incoterm: mjesto)", "uvjetIsporuke")}
            <Field label="15 — Plaćanje vozarine">
              <select className="select" value={f.placanjeVozarine || ""} onChange={(e) => set({ placanjeVozarine: e.target.value })}>
                <option value="">—</option>
                <option value="frei">Frei / Carriage paid</option>
                <option value="unfrei">Unfrei / Carriage forward</option>
              </select>
            </Field>
            {I("21 — Izdano u (mjesto)", "mjestoIzdavanja")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            <Field label="22 — Izradio (ime i prezime u polju pošiljatelja)">
              <select className="select" value={f.izradioId || ""} onChange={(e) => set({ izradioId: e.target.value })}>
                <option value="">—</option>
                {[...db.zaposlenici].filter((z) => z.status === "Aktivan" || z.id === f.izradioId).sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {T("18 — Napomene prijevoznika", "napomenePrijevoznika", 2)}
            {T("20 — Posebni dogovori", "posebniDogovori", 2)}
          </div>
        </>
      )}
    </Modal>
  );
}

function CmrTab({ db, update, patchProjekt, showToast, mozeMijenjati, mojId }) {
  const [forma, setForma] = useState(null); // { pocetni }
  const [printCmr, setPrintCmr] = useState(null);
  const [del, setDel] = useState(null);
  const projSifra = (id) => db.projekti.find((p) => p.id === id)?.sifra || "—";
  const novi = () => ({ id: null, broj: sljedeciBrojCmr(db.cmr, todayISO()), status: CMR_STATUSI[0], statusDatumi: {}, ...cmrPrijedlog(db, null, [], todayISO()), izradioId: mojId || "" });
  const spremi = (f, pregled) => {
    if (!f.projektId) { showToast("Odaberi projekt."); return; }
    if (!f.otpremniceIds.length) { showToast("Odaberi barem jednu otpremnicu."); return; }
    const zapis = { ...f, id: f.id || uid("cmr") };
    update("cmr", f.id ? db.cmr.map((c) => (c.id === f.id ? zapis : c)) : [...db.cmr, zapis]);
    const projekt = db.projekti.find((p) => p.id === f.projektId);
    if (projekt && f.opisRobe && projekt.cmrOpisRobe !== f.opisRobe) patchProjekt(projekt.id, { cmrOpisRobe: f.opisRobe });
    setForma(null);
    showToast("CMR spremljen.");
    if (pregled) setPrintCmr(zapis);
  };
  const promijeniStatus = (c, status) => update("cmr", db.cmr.map((x) => (x.id === c.id ? { ...x, status, statusDatumi: { ...(x.statusDatumi || {}), [status]: todayISO() } } : x)));
  const podaci = [...db.cmr].sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || b.broj.localeCompare(a.broj));
  const brojeviOtpremnica = (c) => (c.otpremniceIds || []).map((id) => String(db.otpremnice.find((o) => o.id === id)?.broj || "").replace(/^OTP-/, "")).filter(Boolean).join("; ");
  return (
    <>
      <EntityPage
        title="" data={podaci} onAdd={() => setForma({ pocetni: novi() })} onEdit={(row) => setForma({ pocetni: JSON.parse(JSON.stringify(row)) })} onDelete={(r) => setDel(r)}
        addLabel="Novi CMR" searchKeys={["broj", "primatelj", "dokumenti"]} readOnly={!mozeMijenjati}
        columns={[
          { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
          { key: "datum", label: "Datum", render: (r) => fmtDate(r.datum) },
          { key: "projekt", label: "Projekt", render: (r) => projSifra(r.projektId) },
          { key: "primatelj", label: "Primatelj", render: (r) => String(r.primatelj || "").split("\n")[0] || "—" },
          { key: "otpremnice", label: "Otpremnice", render: (r) => <span style={{ fontSize: 11.5 }}>{brojeviOtpremnica(r) || "—"}</span> },
          { key: "tezina", label: "Težina", render: (r) => <span className="f-mono">{r.brutoTezina ? `${r.brutoTezina} kg` : "—"}</span> },
          { key: "prijevoznik", label: "Prijevoznik", render: (r) => db.dobavljaci.find((d) => d.id === r.prijevoznikId)?.naziv || "—" },
          {
            key: "status", label: "Status", render: (r) => (
              <div>
                {mozeMijenjati ? (
                  <select className="select" style={{ fontSize: 12, padding: "4px 8px", width: 200 }} value={r.status || CMR_STATUSI[0]} onClick={(e) => e.stopPropagation()} onChange={(e) => promijeniStatus(r, e.target.value)}>
                    {CMR_STATUSI.map((s) => <option key={s}>{s}</option>)}
                  </select>
                ) : <Badge status={r.status || CMR_STATUSI[0]} />}
                {r.statusDatumi?.[r.status] && <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 2 }}>{fmtDate(r.statusDatumi[r.status])}</div>}
              </div>
            ),
          },
          { key: "pdf", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => setPrintCmr(r)}>Ispis</Btn> },
        ]}
      />
      {forma && <CmrFormModal db={db} pocetni={forma.pocetni} onSpremi={spremi} onClose={() => setForma(null)} />}
      {printCmr && <CmrPrintModal cmr={printCmr} db={db} showToast={showToast} onClose={() => setPrintCmr(null)} />}
      {del && <ConfirmDelete label={del.broj} onCancel={() => setDel(null)} onConfirm={() => { update("cmr", db.cmr.filter((c) => c.id !== del.id)); setDel(null); showToast("CMR obrisan."); }} />}
    </>
  );
}

function FakturiranjePage({ db, update, patchProjekt, showToast, mojaPozicija, mojId }) {
  const dozvKartice = dozvoljeneKarticeModula(mojaPozicija, "fakturiranje");
  const [tab, setTab] = useState(dozvKartice[0]?.key || "fakture");
  useEffect(() => { if (!dozvKartice.some((k) => k.key === tab)) setTab(dozvKartice[0]?.key || "fakture"); }, [dozvKartice, tab]);
  const mozeFakture = dozvolaZaKarticu(mojaPozicija, "fakturiranje", "fakture").izmjene;
  const mozeOtpremnice = dozvolaZaKarticu(mojaPozicija, "fakturiranje", "otpremnice").izmjene;
  const mozePodloge = dozvolaZaKarticu(mojaPozicija, "fakturiranje", "podloge").izmjene;
  const mozeCmr = dozvolaZaKarticu(mojaPozicija, "fakturiranje", "cmr").izmjene;
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [printFaktura, setPrintFaktura] = useState(null);
  const emptyForm = () => ({ id: null, broj: sljedeciBroj(db.fakture, "broj", "FAK-2026-", 4), projektId: db.projekti[0]?.id || "", kupacId: db.projekti[0]?.kupacId || db.kupci[0]?.id, datumIzdavanja: todayISO(), rokPlacanja: todayISO(), status: "Nacrt", stavke: [] });
  const [form, setForm] = useState(emptyForm());

  const openAdd = () => { setForm(emptyForm()); setModal(true); };
  const openEdit = (row) => { setForm(JSON.parse(JSON.stringify(row))); setModal(true); };
  const save = () => {
    if (form.id) update("fakture", db.fakture.map((f) => (f.id === form.id ? form : f)));
    else update("fakture", [...db.fakture, { ...form, id: uid("fak") }]);
    setModal(false);
    showToast("Faktura spremljena.");
  };
  const kupacNaziv = (id) => db.kupci.find((k) => k.id === id)?.naziv || "—";
  const projNaziv = (id) => db.projekti.find((p) => p.id === id)?.naziv || "—";
  const isOverdue = (row) => row.status !== "Plaćeno" && daysUntil(row.rokPlacanja) < 0;

  return (
    <div>
      <PageHeader title="Otpremnice i fakturiranje" icon={Receipt} subtitle="Otpremnice, izlazne fakture i naplata po projektima" />
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        {dozvKartice.some((k) => k.key === "fakture") && <div className={`nav-tab ${tab === "fakture" ? "active" : ""}`} onClick={() => setTab("fakture")}>Fakture</div>}
        {dozvKartice.some((k) => k.key === "otpremnice") && <div className={`nav-tab ${tab === "otpremnice" ? "active" : ""}`} onClick={() => setTab("otpremnice")}>Otpremnice</div>}
        {dozvKartice.some((k) => k.key === "cmr") && <div className={`nav-tab ${tab === "cmr" ? "active" : ""}`} onClick={() => setTab("cmr")}>CMR</div>}
        {dozvKartice.some((k) => k.key === "podloge") && <div className={`nav-tab ${tab === "podloge" ? "active" : ""}`} onClick={() => setTab("podloge")}>Podloge za fakturu</div>}
      </div>

      {tab === "otpremnice" && <OtpremniceTab db={db} update={update} patchProjekt={patchProjekt} showToast={showToast} mozeMijenjati={mozeOtpremnice} />}
      {tab === "cmr" && <CmrTab db={db} update={update} patchProjekt={patchProjekt} showToast={showToast} mozeMijenjati={mozeCmr} mojId={mojId} />}
      {tab === "podloge" && <PodlogeZaFakturuTab db={db} update={update} showToast={showToast} mozeMijenjati={mozePodloge} />}

      {tab === "fakture" && (
      <EntityPage
        title="" data={db.fakture} onAdd={openAdd} onEdit={openEdit} onDelete={(r) => setDel(r)}
        addLabel="Nova faktura" searchKeys={["broj"]} readOnly={!mozeFakture}
        rowClass={(r) => (isOverdue(r) ? "row-warn" : "")}
        columns={[
          { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
          { key: "kupac", label: "Kupac", render: (r) => kupacNaziv(r.kupacId) },
          { key: "projekt", label: "Projekt", render: (r) => projNaziv(r.projektId) },
          { key: "datumIzdavanja", label: "Izdano", render: (r) => fmtDate(r.datumIzdavanja) },
          { key: "rokPlacanja", label: "Rok plaćanja", render: (r) => <span style={{ color: isOverdue(r) ? "var(--rust)" : "inherit", fontWeight: isOverdue(r) ? 700 : 400 }}>{fmtDate(r.rokPlacanja)}</span> },
          { key: "iznos", label: "Iznos (s PDV-om)", render: (r) => <span className="f-mono">{fmtCurDec(izracunFakture(r, db.postavkeTvrtke?.pdvStopa).ukupno)}</span> },
          { key: "status", label: "Status", render: (r) => <Badge status={isOverdue(r) ? "Kasni" : r.status} /> },
          { key: "print", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => setPrintFaktura(r)}>PDF</Btn> },
        ]}
      />
      )}

      {modal && (
        <Modal wide title={form.id ? `Faktura ${form.broj}` : "Nova faktura"} onClose={() => setModal(false)} footer={<><Btn onClick={() => setModal(false)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={save}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Projekt"><select className="select" value={form.projektId} onChange={(e) => { const proj = db.projekti.find((p) => p.id === e.target.value); setForm({ ...form, projektId: e.target.value, kupacId: proj?.kupacId || form.kupacId }); }}>{db.projekti.map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}</select></Field>
            <Field label="Kupac"><select className="select" value={form.kupacId} onChange={(e) => setForm({ ...form, kupacId: e.target.value })}>{db.kupci.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}</select></Field>
            <Field label="Datum izdavanja"><input className="input" type="date" value={form.datumIzdavanja} onChange={(e) => setForm({ ...form, datumIzdavanja: e.target.value })} /></Field>
            <Field label="Rok plaćanja"><input className="input" type="date" value={form.rokPlacanja} onChange={(e) => setForm({ ...form, rokPlacanja: e.target.value })} /></Field>
          </div>
          <Field label="Status"><select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["Nacrt", "Poslano", "Djelomično plaćeno", "Plaćeno", "Kasni"].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Stavke fakture"><LineItemsEditor mode="custom" rows={form.stavke} setRows={(rows) => setForm({ ...form, stavke: rows })} materijali={db.materijali} /></Field>
          {(() => { const calc = izracunFakture(form, db.postavkeTvrtke?.pdvStopa); return (
            <div className="card" style={{ padding: 12, background: "var(--surface-alt)", marginTop: 4 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, fontSize: 12.5 }}>
                <div><div style={{ color: "var(--ink-soft)" }}>Osnovica</div><div className="f-mono" style={{ fontWeight: 700 }}>{fmtCurDec(calc.osnovica)}</div></div>
                <div><div style={{ color: "var(--ink-soft)" }}>PDV ({calc.stopa}%)</div><div className="f-mono" style={{ fontWeight: 700 }}>{fmtCurDec(calc.pdvIznos)}</div></div>
                <div><div style={{ color: "var(--ink-soft)" }}>Ukupno za platiti</div><div className="f-mono" style={{ fontWeight: 700, color: "var(--steel)" }}>{fmtCurDec(calc.ukupno)}</div></div>
              </div>
            </div>
          ); })()}
        </Modal>
      )}
      {del && <ConfirmDelete label={del.broj} onCancel={() => setDel(null)} onConfirm={() => { update("fakture", db.fakture.filter((f) => f.id !== del.id)); setDel(null); showToast("Faktura obrisana."); }} />}
      {printFaktura && <FakturaPrintModal faktura={printFaktura} kupac={db.kupci.find((k) => k.id === printFaktura.kupacId)} projekt={db.projekti.find((p) => p.id === printFaktura.projektId)} postavkeTvrtke={db.postavkeTvrtke} onClose={() => setPrintFaktura(null)} />}
    </div>
  );
}

/* ============================== PARTNERI (KUPCI / DOBAVLJAČI) ============================== */
// Zadane vrste dobavljača — samo predložak/početni skup; bilo koja nova vrsta upisana na
// dobavljaču automatski postaje dio popisa za odabir (vidi vrsteDobavljaca ispod).
const ZADANE_VRSTE_DOBAVLJACA = ["Metali", "Transport", "Ostalo"];

function PartneriPage({ db, update, showToast, mojaPozicija }) {
  const dozvKartice = dozvoljeneKarticeModula(mojaPozicija, "partneri");
  const [tab, setTab] = useState(dozvKartice[0]?.key || "kupci");
  useEffect(() => { if (!dozvKartice.some((k) => k.key === tab)) setTab(dozvKartice[0]?.key || "kupci"); }, [dozvKartice, tab]);
  const mozeMijenjatiTab = dozvolaZaKarticu(mojaPozicija, "partneri", tab).izmjene;
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [filtarVrsta, setFiltarVrsta] = useState("");
  const emptyKupac = { naziv: "", oib: "", kontaktOsoba: "", telefon: "", email: "", adresa: "" };
  const emptyDobav = { naziv: "", oib: "", kontaktOsoba: "", telefon: "", email: "", adresa: "", prijevoznik: false, vrsta: "", dodatakIznos: 0, dodatakNapomena: "" };
  const [form, setForm] = useState(emptyKupac);

  const key = tab === "kupci" ? "kupci" : "dobavljaci";
  const empty = tab === "kupci" ? emptyKupac : emptyDobav;

  // Popis vrsta za odabir — zadane + sve koje su ljudi već upisali na dobavljačima (npr. ako
  // netko upiše novu vrstu "Elektromaterijal", ona se od tog trenutka nudi svima).
  const vrsteDobavljaca = useMemo(() => {
    const koristene = db.dobavljaci.map((d) => d.vrsta).filter(Boolean);
    return Array.from(new Set([...ZADANE_VRSTE_DOBAVLJACA, ...koristene]));
  }, [db.dobavljaci]);

  // Dobavljači se uvijek prikazuju abecedno po nazivu; kupci ostaju u zatečenom redoslijedu.
  const podaci = useMemo(() => {
    if (tab !== "dobavljaci") return db[key];
    const lista = [...db.dobavljaci].sort((a, b) => a.naziv.localeCompare(b.naziv, "hr"));
    return filtarVrsta ? lista.filter((d) => (d.vrsta || "") === filtarVrsta) : lista;
  }, [tab, db, key, filtarVrsta]);

  const openAdd = () => { setForm(empty); setModal("add"); };
  const openEdit = (row) => { setForm(row); setModal("edit"); };
  const save = () => {
    if (!form.naziv.trim()) return;
    if (modal === "add") update(key, [...db[key], { ...form, id: uid(tab === "kupci" ? "kup" : "dob") }]);
    else update(key, db[key].map((r) => (r.id === form.id ? form : r)));
    setModal(null);
    showToast("Partner spremljen.");
  };

  const cols = tab === "kupci" ? [
    { key: "naziv", label: "Naziv" },
    { key: "oib", label: "OIB", render: (r) => <span className="f-mono">{r.oib}</span> },
    { key: "kontaktOsoba", label: "Kontakt osoba" },
    { key: "telefon", label: "Telefon" },
    { key: "email", label: "E-mail" },
  ] : [
    { key: "naziv", label: "Naziv" },
    { key: "vrsta", label: "Vrsta robe", render: (r) => r.vrsta || <span style={{ color: "var(--ink-faint)" }}>—</span> },
    { key: "oib", label: "OIB", render: (r) => <span className="f-mono">{r.oib}</span> },
    { key: "kontaktOsoba", label: "Kontakt osoba" },
    { key: "telefon", label: "Telefon" },
    { key: "email", label: "E-mail" },
  ];

  return (
    <div>
      <PageHeader title="Kupci i dobavljači" subtitle="Poslovni partneri" icon={Users} />
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        {dozvKartice.some((k) => k.key === "kupci") && <div className={`nav-tab ${tab === "kupci" ? "active" : ""}`} onClick={() => setTab("kupci")}>Kupci</div>}
        {dozvKartice.some((k) => k.key === "dobavljaci") && <div className={`nav-tab ${tab === "dobavljaci" ? "active" : ""}`} onClick={() => setTab("dobavljaci")}>Dobavljači</div>}
      </div>
      {tab === "dobavljaci" && (
        <div className="card" style={{ marginBottom: 14, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, maxWidth: 320 }}>
          <span style={{ fontSize: 12.5, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>Vrsta robe</span>
          <select className="select" style={{ border: "none" }} value={filtarVrsta} onChange={(e) => setFiltarVrsta(e.target.value)}>
            <option value="">Sve vrste</option>
            {vrsteDobavljaca.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      )}
      <EntityPage
        title="" data={podaci} onAdd={openAdd} onEdit={openEdit} onDelete={(r) => setDel(r)}
        addLabel={tab === "kupci" ? "Novi kupac" : "Novi dobavljač"} searchKeys={["naziv", "oib", "kontaktOsoba"]}
        columns={cols} readOnly={!mozeMijenjatiTab}
      />
      {modal && (
        <Modal title={modal === "add" ? "Novi partner" : "Uredi partnera"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={save}>Spremi</Btn></>}>
          <Field label="Naziv tvrtke"><input className="input" value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} /></Field>
          {tab === "dobavljaci" && (
            <Field label="Vrsta robe">
              <div style={{ position: "relative" }}>
                <input className="input" style={{ paddingRight: 24 }} list="vrste-dobavljaca-popis" value={form.vrsta || ""} onChange={(e) => setForm({ ...form, vrsta: e.target.value })} placeholder="Odaberi postojeću ili upiši novu…" />
                <ChevronDown size={13} style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--ink-faint)" }} />
              </div>
              <datalist id="vrste-dobavljaca-popis">{vrsteDobavljaca.map((v) => <option key={v} value={v} />)}</datalist>
            </Field>
          )}
          {tab === "dobavljaci" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
                <Field label="Zadani dodatak (€)"><input className="input f-mono" type="number" min="0" step="0.01" value={form.dodatakIznos ?? 0} onChange={(e) => setForm({ ...form, dodatakIznos: e.target.value === "" ? 0 : Number(e.target.value) })} /></Field>
                <Field label="Napomena uz dodatak"><input className="input" placeholder="npr. transport, pakiranje…" value={form.dodatakNapomena || ""} onChange={(e) => setForm({ ...form, dodatakNapomena: e.target.value })} /></Field>
              </div>
              <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: -8, marginBottom: 14 }}>Samo predložak — kod svake ponude u Upitima nabave dodatak se može posebno urediti po stavci.</p>
            </>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="OIB"><input className="input f-mono" value={form.oib} onChange={(e) => setForm({ ...form, oib: e.target.value })} /></Field>
            <Field label="Kontakt osoba"><input className="input" value={form.kontaktOsoba} onChange={(e) => setForm({ ...form, kontaktOsoba: e.target.value })} /></Field>
            <Field label="Telefon"><input className="input" value={form.telefon} onChange={(e) => setForm({ ...form, telefon: e.target.value })} /></Field>
            <Field label="E-mail"><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          </div>
          <Field label="Adresa"><input className="input" value={form.adresa || ""} onChange={(e) => setForm({ ...form, adresa: e.target.value })} /></Field>
          {tab === "dobavljaci" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginBottom: 8 }}>
              <input type="checkbox" checked={!!form.prijevoznik} onChange={(e) => setForm({ ...form, prijevoznik: e.target.checked })} />
              Prijevoznik (nudi se za odabir na CMR-u)
            </label>
          )}
        </Modal>
      )}
      {del && <ConfirmDelete label={del.naziv} onCancel={() => setDel(null)} onConfirm={() => { update(key, db[key].filter((r) => r.id !== del.id)); setDel(null); showToast("Partner obrisan."); }} />}
    </div>
  );
}

/* ============================== ZAPOSLENICI ============================== */
// Provjera zahtjeva za lozinku — isto pravilo kao na backendu (server je taj koji ga stvarno provodi,
// ovo je samo trenutna povratna informacija korisniku dok tipka).
const lozinkaZahtjevi = (lozinka) => ([
  { ok: lozinka.length >= 8, tekst: "najmanje 8 znakova" },
  { ok: /[A-Za-z]/.test(lozinka), tekst: "barem jedno slovo" },
  { ok: /[0-9]/.test(lozinka), tekst: "barem jedan broj" },
  { ok: /[^A-Za-z0-9]/.test(lozinka), tekst: "barem jedan poseban znak (npr. ! ? # -)" },
]);

function PostaviLozinkuModal({ zaposlenik, onClose, showToast, refetchKljuc }) {
  const [nova, setNova] = useState("");
  const [potvrda, setPotvrda] = useState("");
  const [greska, setGreska] = useState("");
  const [saljem, setSaljem] = useState(false);
  const zahtjevi = lozinkaZahtjevi(nova);
  const sviIspunjeni = zahtjevi.every((z) => z.ok);

  const spremi = async () => {
    if (!sviIspunjeni) { setGreska("Lozinka ne zadovoljava sve uvjete."); return; }
    if (nova !== potvrda) { setGreska("Lozinke se ne podudaraju."); return; }
    setSaljem(true);
    setGreska("");
    try {
      const res = await fetch(`${API_URL}/api/zaposlenici/${zaposlenik.id}/lozinka`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
        body: JSON.stringify({ lozinka: nova }),
      });
      const data = await res.json();
      if (!res.ok) { setGreska(data.error || "Greška pri spremanju lozinke."); return; }
      await refetchKljuc("zaposlenici");
      showToast(`Lozinka za ${zaposlenik.ime} ${zaposlenik.prezime} je postavljena.`);
      onClose();
    } catch {
      setGreska("Greška pri povezivanju s poslužiteljem.");
    } finally {
      setSaljem(false);
    }
  };

  return (
    <Modal title={`Postavi lozinku — ${zaposlenik.ime} ${zaposlenik.prezime}`} onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi} disabled={saljem}>{saljem ? "Spremanje…" : "Postavi lozinku"}</Btn></>}>
      <Field label="Nova lozinka"><input className="input f-mono" type="password" value={nova} onChange={(e) => { setNova(e.target.value); setGreska(""); }} /></Field>
      <Field label="Potvrdi lozinku"><input className="input f-mono" type="password" value={potvrda} onChange={(e) => { setPotvrda(e.target.value); setGreska(""); }} onKeyDown={(e) => { if (e.key === "Enter") spremi(); }} /></Field>
      <ul style={{ margin: "8px 0 12px 18px", padding: 0, fontSize: 12.5 }}>
        {zahtjevi.map((z) => (
          <li key={z.tekst} style={{ color: z.ok ? "var(--green)" : "var(--ink-faint)" }}>{z.ok ? "✓" : "—"} {z.tekst}</li>
        ))}
      </ul>
      {greska && <div style={{ color: "var(--rust)", fontSize: 12.5, marginBottom: 10 }}>{greska}</div>}
    </Modal>
  );
}

/* ============================== POSTAVKE PLAĆA ============================== */
function PostavkePlacaModal({ db, update, showToast, onClose }) {
  const [form, setForm] = useState(db.postavkePlaca);
  const [praznici, setPraznici] = useState(db.praznici || []);
  const [noviPraznik, setNoviPraznik] = useState({ datum: "", naziv: "" });

  const polja = [
    ["vrijednostBoda", "Vrijednost boda (€)", 0.01],
    ["dodatakStazPoGodini", "Dodatak na staž (€ po godini staža, za svaki dan 4+ h)", 0.1],
    ["fondSatiMjesec", "Godišnji fond sati (prosjek mjesečno, za satnicu)", 1],
    ["normaSatiDan", "Norma sati po danu", 0.5],
    ["prekovremeniFaktor", "Faktor prekovremenih (1.5 = +50%)", 0.1],
    ["cijenaKm", "Putni trošak (€/km, jedan smjer)", 0.01],
    ["topliObrokIznos", "Topli obrok (€/dan)", 0.5],
    ["topliObrokMinSati", "Topli obrok — min. sati", 0.5],
    ["autoOdjavaSati", "Automatska odjava nakon (h)", 1],
    ["obracunskaJedinicaMin", "Obračunska jedinica (min)", 5],
    ["dnevnicaTerenEurDan", "Dnevnica za službeni put (€/dan)", 1],
  ];

  const spremi = () => {
    update("postavkePlaca", form);
    update("praznici", praznici);
    showToast("Postavke plaća spremljene.");
    onClose();
  };
  const dodajPraznik = () => {
    if (!noviPraznik.datum || !noviPraznik.naziv.trim()) return;
    setPraznici([...praznici, { ...noviPraznik, id: uid("prz") }].sort((a, b) => a.datum.localeCompare(b.datum)));
    setNoviPraznik({ datum: "", naziv: "" });
  };

  return (
    <Modal wide title="Postavke obračuna plaća" onClose={onClose}
      footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi}>Spremi</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        {polja.map(([k, label, step]) => (
          <Field key={k} label={label}>
            <input className="input f-mono" type="number" step={step} min="0" value={form[k] ?? 0} onChange={(e) => setForm({ ...form, [k]: e.target.value === "" ? 0 : Number(e.target.value) })} />
          </Field>
        ))}
        <Field label="Granica prijave (upozorenje računovodstvu)">
          <input className="input f-mono" type="time" value={form.granicaPrijaveSat || "08:00"} onChange={(e) => setForm({ ...form, granicaPrijaveSat: e.target.value })} />
        </Field>
      </div>

      <div className="label" style={{ marginBottom: 6 }}>Smjene</div>
      <div className="card" style={{ padding: 10, background: "var(--surface-alt)", marginBottom: 16 }}>
        <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 8 }}>
          Smjena se prepoznaje automatski prema vremenu prijave (uzima se smjena čiji je početak najbliži). Raniji dolazak od početka smjene ne priznaje se — obračun kreće od početka smjene.
        </p>
        {(form.smjene || []).map((s, i) => (
          <div key={s.kljuc} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <input className="input" value={s.naziv} onChange={(e) => setForm({ ...form, smjene: form.smjene.map((x, j) => (j === i ? { ...x, naziv: e.target.value } : x)) })} />
            <input className="input f-mono" type="time" value={s.pocetak} onChange={(e) => setForm({ ...form, smjene: form.smjene.map((x, j) => (j === i ? { ...x, pocetak: e.target.value } : x)) })} />
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input className="input f-mono" type="number" step="1" min="0" value={s.dodatakPostotak} onChange={(e) => setForm({ ...form, smjene: form.smjene.map((x, j) => (j === i ? { ...x, dodatakPostotak: Number(e.target.value) || 0 } : x)) })} />
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>% dodatka</span>
            </div>
            <button className="btn btn-icon btn-ghost" onClick={() => setForm({ ...form, smjene: form.smjene.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
          </div>
        ))}
        <Btn variant="ghost" size="sm" icon={Plus} onClick={() => setForm({ ...form, smjene: [...(form.smjene || []), { kljuc: uid("smj"), naziv: "Nova smjena", pocetak: "22:00", dodatakPostotak: 0 }] })}>Dodaj smjenu</Btn>
      </div>

      <div className="label" style={{ marginBottom: 6 }}>Neradni dani / praznici ({praznici.length})</div>
      <div className="card" style={{ padding: 10, background: "var(--surface-alt)", maxHeight: 220, overflowY: "auto", marginBottom: 8 }}>
        {praznici.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 12.5 }}>
            <span className="f-mono" style={{ width: 90 }}>{fmtDate(p.datum)}</span>
            <span style={{ flex: 1 }}>{p.naziv}</span>
            <button className="btn btn-icon btn-ghost" onClick={() => setPraznici(praznici.filter((x) => x.id !== p.id))}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input" type="date" style={{ width: 160 }} value={noviPraznik.datum} onChange={(e) => setNoviPraznik({ ...noviPraznik, datum: e.target.value })} />
        <input className="input" placeholder="Naziv praznika" value={noviPraznik.naziv} onChange={(e) => setNoviPraznik({ ...noviPraznik, naziv: e.target.value })} />
        <Btn variant="ghost" icon={Plus} onClick={dodajPraznik}>Dodaj</Btn>
      </div>
    </Modal>
  );
}

/* ============================== EVIDENCIJA RADA — sažetak dana, zbrojevi i ispis ============================== */
const hhmmISO = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "—");

// Sažetak jednog dana jednog zaposlenika (iz svih njegovih zapisa za taj datum) — koristi se i za
// ćeliju u mreži i za ispis u PDF, da oba uvijek prikazuju isto.
const sazetakDanaEvidencije = (zapisi, postavkePlaca) => {
  if (!zapisi.length) return null;
  const posebna = zapisi.find((z) => z.vrsta !== "rad");
  if (posebna) return { posebna: posebna.vrsta };
  const radni = zapisi.filter((z) => z.vrsta === "rad").sort((a, b) => a.vrijemeDolaska.localeCompare(b.vrijemeDolaska));
  const sati = radni.reduce((s, z) => s + obracunskiSati(z.vrijemeDolaska, z.vrijemeOdlaska, odrediSmjenu(z.vrijemeDolaska, postavkePlaca), postavkePlaca), 0);
  return {
    prvi: radni[0].vrijemeDolaska,
    zadnji: radni[radni.length - 1].vrijemeOdlaska,
    sati,
    popodne: radni.some((z) => odrediSmjenu(z.vrijemeDolaska, postavkePlaca)?.dodatakPostotak > 0),
    autoOdjava: radni.some((z) => z.autoOdjava && !z.potvrdenoRacunovodstvo),
    brojSegmenata: radni.length,
  };
};

// Mjesečni zbrojevi uz mrežu evidencije — isti izračun kao u obračunu plaće (pa se brojke slažu):
// "Ukupno sati" = redovni + prekovremeni + plaćeni izostanci (praznik, godišnji, dopust, detašman);
// bolovanje/očinski/roditeljski se ne zbrajaju u sate nego se prikazuju kao broj dana.
const zbrojeviEvidencije = (zaposlenik, mjesec, db) => {
  const r = obracunMjeseca(zaposlenik, mjesec, db);
  return {
    ukupno: r.redovni + r.prekovremeniStvarno + r.praznikSati + r.godisnjiSati + r.dopustSati + r.detasmanSati,
    redovni: r.redovni,
    prekovremeni: r.prekovremeniStvarno,
    praznikDana: r.dani.filter((d) => d.praznikSati > 0).length,
    goDana: r.dani.filter((d) => d.godisnjiSati > 0).length,
    boDana: r.dani.filter((d) => d.bolovanjeSati > 0).length,
  };
};

const escHtml = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const EVP_CSS = `
.evp{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:8px}
.evp *{box-sizing:border-box}
.evp-zag{display:flex;justify-content:space-between;font-weight:700;font-size:11px;margin-bottom:6px}
.evp-t{border-collapse:collapse;width:100%}
.evp-t th,.evp-t td{border:1px solid #999;padding:1px 2px;text-align:center;vertical-align:middle;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.evp-t th{background:#eee;font-size:7.5px}
.evp-t td div{font-size:6.5px;color:#555;line-height:1.15}
.evp-t td b{font-size:8px}
.evp-t .evp-ime{text-align:left;min-width:110px;font-weight:600;padding:1px 4px}
.evp-t .evp-vk{background:#f0f0f0}
.evp-t .evp-pr{background:#fbeae6}
.evp-t .evp-pod{background:#d6f0dd}
.evp-t .evp-pod b{color:#1b6e36}
.evp-t .evp-auto{background:#fbeae6}
.evp-t .evp-zb{background:#f6f6f6}
.evp-t .evp-uk td{font-weight:700;background:#eee}
.evp-t tr{page-break-inside:avoid}
.evp-t thead{display:table-header-group}
.evp-nova{page-break-before:always}
.evp-leg{margin-top:6px;font-size:8px;display:flex;flex-wrap:wrap;gap:12px}
.evp-leg i{display:inline-block;width:9px;height:9px;border:1px solid #999;vertical-align:middle;margin-right:3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
`;

// grupe: [{ naziv, zaposlenici }]; sazetci: Map(zaposlenikId -> zbrojeviEvidencije); dani: dani u mjesecu.
const evidencijaPrintHtml = ({ mjesec, grupe, dani, zapisiMapa, sazetci, db }) => {
  const [g, m] = mjesec.split("-");
  const nazivDana = ["ned", "pon", "uto", "sri", "čet", "pet", "sub"];
  const t = db.postavkeTvrtke || {};
  const celija = (z, d) => {
    const razred = d.praznik ? "evp-pr" : d.vikend ? "evp-vk" : "";
    const sd = sazetakDanaEvidencije(zapisiMapa.get(`${z.id}|${d.datum}`) || [], db.postavkePlaca);
    if (!sd) return `<td class="${razred}">${d.praznik ? "P" : ""}</td>`;
    if (sd.posebna) {
      const o = OZNAKA_VRSTE_DANA[sd.posebna];
      return `<td style="background:${o?.bg || "#eee"};color:${o?.boja || "#000"};font-weight:700">${escHtml(o?.kratica || "?")}</td>`;
    }
    const cls = sd.autoOdjava ? "evp-auto" : sd.popodne ? "evp-pod" : razred;
    return `<td class="${cls}"><div>${hhmmISO(sd.prvi)}</div><div>${hhmmISO(sd.zadnji)}</div><b>${sd.sati.toFixed(1)}</b></td>`;
  };
  const f1 = (n) => (Number(n) || 0).toFixed(1);
  let html = `<style>${EVP_CSS}</style><div class="evp">`;
  let prva = true;
  grupe.forEach((grupa) => {
    if (grupa.zaposlenici.length === 0) return;
    const uk = { ukupno: 0, redovni: 0, prekovremeni: 0, praznikDana: 0, goDana: 0, boDana: 0 };
    let redovi = "";
    grupa.zaposlenici.forEach((z) => {
      const s = sazetci.get(z.id) || uk;
      Object.keys(uk).forEach((k) => { uk[k] += s[k] || 0; });
      redovi += `<tr><td class="evp-ime">${escHtml(`${z.prezime} ${z.ime}`)}</td>${dani.map((d) => celija(z, d)).join("")}`
        + `<td class="evp-zb"><b>${f1(s.ukupno)}</b></td><td class="evp-zb">${f1(s.redovni)}</td><td class="evp-zb">${f1(s.prekovremeni)}</td>`
        + `<td class="evp-zb">${s.praznikDana}</td><td class="evp-zb">${s.goDana}</td><td class="evp-zb">${s.boDana}</td></tr>`;
    });
    html += `<div class="${prva ? "" : "evp-nova"}"><div class="evp-zag"><span>${escHtml(t.naziv || "ECON d.o.o.")}</span><span>EVIDENCIJA RADNOG VREMENA · ${escHtml(grupa.naziv)}</span><span>Mjesec: ${m}/${g}</span></div>`
      + `<table class="evp-t"><thead><tr><th class="evp-ime">Zaposlenik</th>`
      + dani.map((d) => `<th class="${d.praznik ? "evp-pr" : d.vikend ? "evp-vk" : ""}"><b>${d.dan}</b><br>${nazivDana[d.dow]}</th>`).join("")
      + `<th>Ukupno<br>sati</th><th>Redovni<br>rad</th><th>Prekovre-<br>mene</th><th>Praznik<br>(dana)</th><th>GO<br>(dana)</th><th>BO<br>(dana)</th></tr></thead><tbody>${redovi}`
      + `<tr class="evp-uk"><td class="evp-ime">UKUPNO (${grupa.zaposlenici.length})</td>${dani.map(() => "<td></td>").join("")}`
      + `<td>${f1(uk.ukupno)}</td><td>${f1(uk.redovni)}</td><td>${f1(uk.prekovremeni)}</td><td>${uk.praznikDana}</td><td>${uk.goDana}</td><td>${uk.boDana}</td></tr></tbody></table>`
      + `<div class="evp-leg"><span><i style="background:#d6f0dd"></i>popodnevna smjena</span><span><i style="background:#fbeae6"></i>praznik / automatska odjava</span><span><i style="background:#f0f0f0"></i>vikend</span>`
      + Object.values(OZNAKA_VRSTE_DANA).map((o) => `<span><b style="color:${o.boja}">${escHtml(o.kratica)}</b> ${escHtml(o.naziv.toLowerCase())}</span>`).join("")
      + `</div></div>`;
    prva = false;
  });
  return `${html}</div>`;
};

// Ispis u novom prozoru (a ne preko aplikacije) — tablica s ~35 stupaca i više skupina mora se
// moći prelomiti na više stranica, što ne radi unutar modala aplikacije.
const otvoriIspisEvidencije = (html, naslov) => {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(naslov)}</title><style>@page{size:A3 landscape;margin:10mm}body{margin:0}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
};

function EvidencijaPrintModal({ mjesec, grupe, dani, zapisiMapa, sazetci, db, showToast, onClose }) {
  const html = useMemo(() => evidencijaPrintHtml({ mjesec, grupe, dani, zapisiMapa, sazetci, db }), [mjesec, grupe, dani, zapisiMapa, sazetci, db]);
  const [g, m] = mjesec.split("-");
  const ispisi = () => {
    if (!otvoriIspisEvidencije(html, `Evidencija_rada_${m}${g}`)) showToast("Preglednik je blokirao novi prozor — dozvoli skočne prozore za ovu stranicu i pokušaj ponovno.");
  };
  return (
    <Modal wide title={`Pregled za ispis — Evidencija rada ${mjesec}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={ispisi}>Ispis / Spremi kao PDF</Btn></>}>
      <div style={{ overflow: "auto", zoom: 1.3, background: "#fff", padding: 6 }} dangerouslySetInnerHTML={{ __html: html }} />
    </Modal>
  );
}

const NAZIVI_MJESECI = ["Siječanj", "Veljača", "Ožujak", "Travanj", "Svibanj", "Lipanj", "Srpanj", "Kolovoz", "Rujan", "Listopad", "Studeni", "Prosinac"];

// Zamjena za <input type="month"> — taj nativni kontrol je neintuitivan za klik/upis (lako se
// promijeni pogrešan dio datuma), pa je ovdje dva obična padajuća izbornika (mjesec + godina).
function MjesecOdabir({ value, onChange, style }) {
  const [godina, mjesec] = value.split("-");
  const godinaSad = new Date().getFullYear();
  const godine = Array.from({ length: 4 }, (_, i) => godinaSad - 2 + i);
  return (
    <div style={{ display: "flex", gap: 6, ...style }}>
      <select className="select f-mono" style={{ width: 132 }} value={mjesec} onChange={(e) => onChange(`${godina}-${e.target.value}`)}>
        {NAZIVI_MJESECI.map((naziv, i) => <option key={naziv} value={String(i + 1).padStart(2, "0")}>{naziv}</option>)}
      </select>
      <select className="select f-mono" style={{ width: 84 }} value={godina} onChange={(e) => onChange(`${e.target.value}-${mjesec}`)}>
        {godine.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
    </div>
  );
}

/* ============================== EVIDENCIJA RADA — MJESEČNA MREŽA ============================== */
function EvidencijaTab({ db, patchEvidencija, showToast, mozeMijenjati = true }) {
  const [mjesec, setMjesec] = useState(todayISO().slice(0, 7));
  const [urediCeliju, setUrediCeliju] = useState(null); // { zaposlenikId, datum, vrsta, od, do, postojeciId }

  // Automatska odjava zaostalih smjena sad se pokreće sama na backendu (vidi provjeriAutoOdjavu u
  // server.js) — više ne ovisi o tome je li itko baš otvorio ovaj tab na vrijeme.

  const { neprijavljeni, neodjavljeni } = useMemo(() => upozorenjaEvidencije(db), [db]);
  const kioskUrl = `${window.location.origin}${window.location.pathname}?kiosk=1`;
  const [printOtvoren, setPrintOtvoren] = useState(false);

  // Dani u odabranom mjesecu
  const dani = useMemo(() => {
    const [g, m] = mjesec.split("-").map(Number);
    const brojDana = new Date(g, m, 0).getDate();
    return Array.from({ length: brojDana }, (_, i) => {
      const datum = `${mjesec}-${String(i + 1).padStart(2, "0")}`;
      const dow = new Date(datum).getDay();
      return { datum, dan: i + 1, dow, vikend: dow === 0 || dow === 6, praznik: jePraznik(datum, db.praznici) };
    });
  }, [mjesec, db.praznici]);

  // Brzi pristup zapisima: "zaposlenikId|datum" -> NIZ zapisa (jedan dan može imati više
  // odvojenih prijava/odjava — npr. jutarnja smjena pa kratki povratak u tvrtku).
  const zapisiMapa = useMemo(() => {
    const m = new Map();
    (db.evidencijaRada || []).forEach((e) => {
      const k = `${e.zaposlenikId}|${e.vrijemeDolaska.slice(0, 10)}`;
      const niz = m.get(k);
      if (niz) niz.push(e); else m.set(k, [e]);
    });
    return m;
  }, [db.evidencijaRada]);

  const aktivniSort = useMemo(() => db.zaposlenici
    .filter((z) => z.status === "Aktivan")
    .sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")), [db.zaposlenici]);
  const radionaSort = useMemo(() => aktivniSort.filter((z) => grupaEvidencije(z, db.pozicijeZaposlenika) === "radiona"), [aktivniSort, db.pozicijeZaposlenika]);
  const praktikantiSort = useMemo(() => aktivniSort.filter((z) => grupaEvidencije(z, db.pozicijeZaposlenika) === "praktikant"), [aktivniSort, db.pozicijeZaposlenika]);
  const tehnickiSort = useMemo(() => aktivniSort.filter((z) => grupaEvidencije(z, db.pozicijeZaposlenika) === "ostalo"), [aktivniSort, db.pozicijeZaposlenika]);
  const kooperantiSort = useMemo(() => aktivniSort.filter((z) => grupaEvidencije(z, db.pozicijeZaposlenika) === "kooperant"), [aktivniSort, db.pozicijeZaposlenika]);

  // Mjesečni zbrojevi za desne stupce mreže (i ispis) — isti izračun kao obračun plaće.
  const sazetci = useMemo(() => new Map(aktivniSort.map((z) => [z.id, zbrojeviEvidencije(z, mjesec, db)])), [aktivniSort, mjesec, db]);
  const grupeZaIspis = useMemo(() => [
    { naziv: "Radiona", zaposlenici: radionaSort },
    { naziv: "Praktikanti", zaposlenici: praktikantiSort },
    { naziv: "Tehnički ured i administracija", zaposlenici: tehnickiSort },
    { naziv: "Kooperanti", zaposlenici: kooperantiSort },
  ], [radionaSort, praktikantiSort, tehnickiSort, kooperantiSort]);

  const otvoriCeliju = (zaposlenikId, datum) => {
    if (!mozeMijenjati) return;
    const zapisi = zapisiMapa.get(`${zaposlenikId}|${datum}`) || [];
    const posebna = zapisi.find((z) => z.vrsta !== "rad");
    const radni = zapisi.filter((z) => z.vrsta === "rad");
    setUrediCeliju({
      zaposlenikId, datum,
      vrsta: posebna?.vrsta || "rad",
      segmenti: radni.length
        ? radni.map((z) => ({ id: z.id, od: new Date(z.vrijemeDolaska).toTimeString().slice(0, 5), do: z.vrijemeOdlaska ? new Date(z.vrijemeOdlaska).toTimeString().slice(0, 5) : "" }))
        : [{ id: null, od: "06:00", do: "14:00" }],
    });
  };

  // Sprema cijeli dan odjednom: makne SVE postojeće zapise tog zaposlenika za taj datum i
  // zamijeni ih onim što je trenutno u editoru (jedan zapis po radnom segmentu, ili jedan
  // zapis za cjelodnevnu vrstu poput godišnjeg) — tako više radnih segmenata istog dana
  // (npr. jutarnja smjena + kratki povratak) ostaju svaki zaseban, umjesto da se izgube.
  // Umjesto da izračuna cijeli novi popis evidencije i pošalje ga natrag (što bi na bazi
  // prepisalo bilo koju prijavu/odjavu s kioska koja je stigla nakon što je ovaj preglednik
  // zadnji put dohvatio podatke), šalje se samo TOČNO ono što se za ovaj dan mijenja —
  // patchEvidencija to primjenjuje na trenutni popis u bazi, zaključan za vrijeme izmjene.
  const spremiCeliju = async () => {
    const { zaposlenikId, datum, vrsta, segmenti } = urediCeliju;
    const postojeciZaDan = db.evidencijaRada.filter((e) => e.zaposlenikId === zaposlenikId && e.vrijemeDolaska.slice(0, 10) === datum);
    const noviZapisi = vrsta === "rad"
      ? segmenti.filter((s) => s.od).map((s) => ({
          id: s.id || uid("evr"), zaposlenikId,
          vrijemeDolaska: `${datum}T${s.od}:00`, vrijemeOdlaska: s.do ? `${datum}T${s.do}:00` : null,
          vrsta: "rad", autoOdjava: false, potvrdenoRacunovodstvo: true, unioRucnoId: "racunovodstvo",
        }))
      : [{ id: uid("evr"), zaposlenikId, vrijemeDolaska: `${datum}T00:00:00`, vrijemeOdlaska: `${datum}T00:00:00`, vrsta, autoOdjava: false, potvrdenoRacunovodstvo: true, unioRucnoId: "racunovodstvo" }];
    const zadrzaniIds = new Set(noviZapisi.map((z) => z.id));
    const zaUkloniti = postojeciZaDan.filter((e) => !zadrzaniIds.has(e.id)).map((e) => e.id);
    const ok = await patchEvidencija(noviZapisi, zaUkloniti);
    if (ok) { setUrediCeliju(null); showToast("Evidencija spremljena."); }
  };

  const obrisiCeliju = async () => {
    const { zaposlenikId, datum } = urediCeliju;
    const zaUkloniti = db.evidencijaRada.filter((e) => e.zaposlenikId === zaposlenikId && e.vrijemeDolaska.slice(0, 10) === datum).map((e) => e.id);
    const ok = await patchEvidencija([], zaUkloniti);
    if (ok) { setUrediCeliju(null); showToast("Zapis obrisan."); }
  };

  const potvrdiAutoOdjavu = (id) => {
    if (!mozeMijenjati) return;
    const zapis = db.evidencijaRada.find((e) => e.id === id);
    if (zapis) patchEvidencija([{ ...zapis, potvrdenoRacunovodstvo: true }], []);
  };
  const zaposlenikIme = (id) => { const z = db.zaposlenici.find((zz) => zz.id === id); return z ? `${z.prezime} ${z.ime}` : "—"; };

  // Sadržaj jedne ćelije — dan može imati više radnih segmenata (npr. jutarnja smjena + kratki
  // povratak u tvrtku); sati se zbrajaju preko svih, a prikazuje se raspon prvi dolazak-zadnja
  // odjava uz oznaku "+N" kad ih ima više od jednog.
  const Celija = ({ zaposlenik, dan }) => {
    const zapisi = zapisiMapa.get(`${zaposlenik.id}|${dan.datum}`) || [];
    const bgBase = dan.praznik ? "#FBEAE6" : dan.vikend ? "var(--surface-alt)" : "var(--surface)";
    const stil = { padding: "2px 3px", textAlign: "center", cursor: "pointer", background: bgBase, borderRight: "1px solid var(--line)", minWidth: 54, height: 46, verticalAlign: "middle" };

    if (zapisi.length === 0) {
      return <td style={stil} onClick={() => otvoriCeliju(zaposlenik.id, dan.datum)} title="Klikni za unos">
        <span style={{ color: "var(--ink-faint)", fontSize: 13 }}>{dan.praznik ? "P" : dan.vikend ? "" : "—"}</span>
      </td>;
    }

    const sd = sazetakDanaEvidencije(zapisi, db.postavkePlaca);
    const oznaka = sd.posebna && OZNAKA_VRSTE_DANA[sd.posebna];
    if (oznaka) {
      return <td style={{ ...stil, background: oznaka.bg }} onClick={() => otvoriCeliju(zaposlenik.id, dan.datum)} title={oznaka.naziv}>
        <span className="f-mono" style={{ fontSize: 11, fontWeight: 700, color: oznaka.boja }}>{oznaka.kratica}</span>
      </td>;
    }

    // Popodnevna smjena je zeleno označena; automatska odjava (crveno) ima prednost jer traži provjeru.
    const pozadina = sd.autoOdjava ? "#FBEAE6" : sd.popodne ? "#D6F0DD" : bgBase;
    return (
      <td style={{ ...stil, background: pozadina }} onClick={() => otvoriCeliju(zaposlenik.id, dan.datum)} title={sd.autoOdjava ? "Automatska odjava — provjeri" : sd.popodne ? "Popodnevna smjena" : sd.brojSegmenata > 1 ? `${sd.brojSegmenata} segmenta — klikni za izmjenu` : "Klikni za izmjenu"}>
        <div className="f-mono" style={{ fontSize: 9, color: "var(--ink-faint)", lineHeight: 1.25 }}>{hhmmISO(sd.prvi)}</div>
        <div className="f-mono" style={{ fontSize: 9, color: sd.autoOdjava ? "var(--rust)" : "var(--ink-faint)", lineHeight: 1.25 }}>{hhmmISO(sd.zadnji)}</div>
        <div className="f-mono" style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.3, color: sd.popodne && !sd.autoOdjava ? "#1B6E36" : "var(--ink)" }}>{sd.sati.toFixed(1)}{sd.brojSegmenata > 1 && <sup style={{ fontSize: 8 }}>+{sd.brojSegmenata - 1}</sup>}</div>
      </td>
    );
  };

  const stilPrviStupac = { position: "sticky", left: 0, zIndex: 2, background: "var(--surface)", borderRight: "2px solid var(--line-strong)", minWidth: 150, padding: "4px 8px" };

  return (
    <div>
      <div className="card" style={{ padding: 14, marginBottom: 16, background: "var(--surface-alt)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", maxWidth: 460 }}>
          Kiosk zaslon za prijavu NFC karticom postavi na uređaj na ulazu.
        </div>
        <Btn variant="primary" icon={UserCog} onClick={() => window.open(kioskUrl, "_blank")}>Otvori kiosk zaslon</Btn>
      </div>

      {neprijavljeni.length > 0 && (
        <div className="card" style={{ padding: "10px 14px", marginBottom: 12, background: "#FDF6E3", borderColor: "#F0C36B" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <AlertTriangle size={15} color="#8A6100" />
            <span style={{ fontSize: 12.5, color: "#6b5511" }}>
              <strong>Nisu se prijavili danas do {db.postavkePlaca?.granicaPrijaveSat}:</strong> {neprijavljeni.map((z) => `${z.prezime} ${z.ime}`).join(", ")} — klikni njihovu ćeliju za današnji dan da uneseš prijavu ili odsutnost.
            </span>
          </div>
        </div>
      )}

      {neodjavljeni.length > 0 && (
        <div className="card" style={{ padding: "10px 14px", marginBottom: 12, background: "#FBEAE6", borderColor: "#F0C2B5" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <AlertCircle size={15} color="#9A2E1B" />
            <strong style={{ fontSize: 12.5, color: "#7d2a19" }}>Automatski odjavljeni (nisu se odjavili) — {neodjavljeni.length}</strong>
          </div>
          {neodjavljeni.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 3 }}>
              <span style={{ flex: 1 }}>{zaposlenikIme(e.zaposlenikId)} · {fmtDate(e.vrijemeDolaska.slice(0, 10))}</span>
              <Btn variant="ghost" size="sm" onClick={() => otvoriCeliju(e.zaposlenikId, e.vrijemeDolaska.slice(0, 10))}>Ispravi</Btn>
              <Btn variant="ghost" size="sm" onClick={() => potvrdiAutoOdjavu(e.id)}>Potvrdi</Btn>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="label">Mjesec</span>
          <MjesecOdabir value={mjesec} onChange={setMjesec} />
          <Btn variant="ghost" icon={Eye} onClick={() => setPrintOtvoren(true)}>Ispis / PDF</Btn>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--ink-soft)", flexWrap: "wrap" }}>
          {Object.values(OZNAKA_VRSTE_DANA).map((o) => (
            <span key={o.kratica}><span className="f-mono" style={{ fontWeight: 700, color: o.boja }}>{o.kratica}</span> {o.naziv.toLowerCase()}</span>
          ))}
          <span><span style={{ display: "inline-block", width: 9, height: 9, background: "#FBEAE6", border: "1px solid #F0C2B5", borderRadius: 2 }} /> praznik / auto odjava</span>
          <span><span style={{ display: "inline-block", width: 9, height: 9, background: "#D6F0DD", border: "1px solid #9CCFAB", borderRadius: 2 }} /> <span className="f-mono" style={{ color: "#1B6E36", fontWeight: 700 }}>8.0</span> popodnevna smjena</span>
        </div>
      </div>

      {(() => {
        const TablicaEvidencije = ({ lista }) => (
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--surface-alt)" }}>
                  <th style={{ ...stilPrviStupac, background: "var(--surface-alt)", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-soft)" }}>Zaposlenik</th>
                  {dani.map((d) => (
                    <th key={d.datum} style={{ padding: "4px 2px", textAlign: "center", minWidth: 54, borderRight: "1px solid var(--line)", background: d.praznik ? "#FBEAE6" : d.vikend ? "var(--line)" : "var(--surface-alt)" }}>
                      <div className="f-mono" style={{ fontSize: 12, fontWeight: 700 }}>{d.dan}</div>
                      <div style={{ fontSize: 9, color: "var(--ink-faint)", textTransform: "uppercase" }}>{["ned", "pon", "uto", "sri", "čet", "pet", "sub"][d.dow]}</div>
                    </th>
                  ))}
                  {["Ukupno sati", "Redovni rad", "Prekovremene", "Praznik (dana)", "GO (dana)", "BO (dana)"].map((naslov) => (
                    <th key={naslov} style={{ padding: "4px 8px", textAlign: "center", minWidth: 64, background: "var(--surface-alt)", fontSize: 10.5, color: "var(--ink-soft)", borderLeft: naslov === "Ukupno sati" ? "2px solid var(--line-strong)" : undefined }}>{naslov}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map((z) => {
                  const zb = sazetci.get(z.id) || { ukupno: 0, redovni: 0, prekovremeni: 0, praznikDana: 0, goDana: 0, boDana: 0 };
                  const stilZb = { textAlign: "center", background: "var(--surface-alt)" };
                  return (
                    <tr key={z.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={stilPrviStupac}>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{z.prezime} {z.ime}</div>
                        <div style={{ fontSize: 9.5, color: "var(--ink-faint)" }}>{z.rfidKod}</div>
                      </td>
                      {dani.map((d) => <Celija key={d.datum} zaposlenik={z} dan={d} />)}
                      <td className="f-mono" style={{ ...stilZb, fontWeight: 700, borderLeft: "2px solid var(--line-strong)" }}>{zb.ukupno.toFixed(1)}</td>
                      <td className="f-mono" style={stilZb}>{zb.redovni.toFixed(1)}</td>
                      <td className="f-mono" style={{ ...stilZb, color: zb.prekovremeni > 0 ? "var(--steel)" : undefined }}>{zb.prekovremeni.toFixed(1)}</td>
                      <td className="f-mono" style={stilZb}>{zb.praznikDana}</td>
                      <td className="f-mono" style={stilZb}>{zb.goDana}</td>
                      <td className="f-mono" style={stilZb}>{zb.boDana}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        return (
          <>
            <div className="label" style={{ marginBottom: 6 }}>Radiona ({radionaSort.length})</div>
            {radionaSort.length === 0 ? <EmptyState text="Nema aktivnih zaposlenika u radioni." /> : <TablicaEvidencije lista={radionaSort} />}

            <div className="label" style={{ marginTop: 20, marginBottom: 6 }}>Praktikanti ({praktikantiSort.length})</div>
            {praktikantiSort.length === 0 ? <EmptyState text="Nema aktivnih praktikanata." /> : <TablicaEvidencije lista={praktikantiSort} />}

            <div className="label" style={{ marginTop: 20, marginBottom: 6 }}>Tehnički ured i administracija ({tehnickiSort.length})</div>
            {tehnickiSort.length === 0 ? <EmptyState text="Nema aktivnih zaposlenika u tehničkom uredu." /> : <TablicaEvidencije lista={tehnickiSort} />}

            <div className="label" style={{ marginTop: 20, marginBottom: 6 }}>Kooperanti ({kooperantiSort.length})</div>
            {kooperantiSort.length === 0 ? <EmptyState text="Nema aktivnih kooperanata." /> : <TablicaEvidencije lista={kooperantiSort} />}
          </>
        );
      })()}
      <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8 }}>Klikni bilo koju ćeliju za unos ili izmjenu. Sati su obračunski (zaokruženo na {db.postavkePlaca?.obracunskaJedinicaMin || 30} min, raniji dolazak od početka smjene se ne priznaje).</p>

      {printOtvoren && <EvidencijaPrintModal mjesec={mjesec} grupe={grupeZaIspis} dani={dani} zapisiMapa={zapisiMapa} sazetci={sazetci} db={db} showToast={showToast} onClose={() => setPrintOtvoren(false)} />}

      {urediCeliju && (
        <Modal title={`${zaposlenikIme(urediCeliju.zaposlenikId)} — ${fmtDate(urediCeliju.datum)}`} onClose={() => setUrediCeliju(null)}
          footer={<>
            <Btn variant="ghost" icon={Trash2} onClick={obrisiCeliju}>Obriši cijeli dan</Btn>
            <div style={{ flex: 1 }} />
            <Btn onClick={() => setUrediCeliju(null)}>Odustani</Btn>
            <Btn variant="primary" icon={Save} onClick={spremiCeliju}>Spremi</Btn>
          </>}>
          <Field label="Vrsta dana">
            <select className="select" value={urediCeliju.vrsta} onChange={(e) => setUrediCeliju({ ...urediCeliju, vrsta: e.target.value })}>
              {VRSTE_DANA.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </Field>
          {urediCeliju.vrsta === "rad" && (
            <>
              <div className="label" style={{ marginTop: 6 }}>Radni segmenti (dolazak — odjava)</div>
              <p style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 8 }}>Više segmenata koristi se kad je netko istog dana radio u dvije razdvojene prijave (npr. jutarnja smjena pa kratki povratak u tvrtku).</p>
              {urediCeliju.segmenti.map((seg, i) => {
                const dolazak = `${urediCeliju.datum}T${seg.od || "00:00"}:00`;
                const odlazak = seg.do ? `${urediCeliju.datum}T${seg.do}:00` : null;
                const smj = odrediSmjenu(dolazak, db.postavkePlaca);
                const h = odlazak ? obracunskiSati(dolazak, odlazak, smj, db.postavkePlaca) : 0;
                const azurirajSeg = (patch) => setUrediCeliju({ ...urediCeliju, segmenti: urediCeliju.segmenti.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
                return (
                  <div key={i} className="card" style={{ padding: 10, marginBottom: 8, background: "var(--surface-alt)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <Field label="Prijava"><input className="input f-mono" type="time" value={seg.od} onChange={(e) => azurirajSeg({ od: e.target.value })} /></Field>
                      <Field label="Odjava"><input className="input f-mono" type="time" value={seg.do} onChange={(e) => azurirajSeg({ do: e.target.value })} /></Field>
                      {urediCeliju.segmenti.length > 1 && (
                        <button className="btn btn-icon btn-ghost" onClick={() => setUrediCeliju({ ...urediCeliju, segmenti: urediCeliju.segmenti.filter((_, idx) => idx !== i) })}><X size={14} /></button>
                      )}
                    </div>
                    {seg.do ? (
                      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>
                        Smjena: <strong>{smj?.naziv}</strong>{smj?.dodatakPostotak > 0 && <span style={{ color: "var(--steel)" }}> (+{smj.dodatakPostotak}%)</span>} · obračunski sati: <strong className="f-mono">{h.toFixed(1)} h</strong>
                      </div>
                    ) : seg.od && (
                      <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 6 }}>
                        Bez odjave — evidentira se kao "još na poslu", upiši odjavu naknadno kad se zaposlenik javi.
                      </div>
                    )}
                  </div>
                );
              })}
              <Btn variant="ghost" size="sm" icon={Plus} onClick={() => setUrediCeliju({ ...urediCeliju, segmenti: [...urediCeliju.segmenti, { id: null, od: "14:00", do: "" }] })}>Dodaj segment</Btn>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ============================== OBRAČUN PLAĆA — TAB ============================== */
function ObracunPlacaTab({ db, update, showToast, mozeMijenjati = true }) {
  const [mjesec, setMjesec] = useState(todayISO().slice(0, 7));
  const [postavkeOtvorene, setPostavkeOtvorene] = useState(false);
  const [detalj, setDetalj] = useState(null);
  const [detaljKoop, setDetaljKoop] = useState(null);
  const [detaljVanjski, setDetaljVanjski] = useState(null);
  const [printGrupa, setPrintGrupa] = useState(null); // "radiona" | "praktikant" | "ostalo" | "kooperant" | "vanjski"

  const redovi = useMemo(() => db.zaposlenici
    .filter((z) => z.status === "Aktivan" && !jeKooperant(z, db.pozicijeZaposlenika) && !jeVanjskiSuradnik(z, db.pozicijeZaposlenika))
    .map((z) => obracunMjeseca(z, mjesec, db))
    .filter((r) => r.brojDana > 0)
    .sort((a, b) => (a.zaposlenik.prezime + a.zaposlenik.ime).localeCompare(b.zaposlenik.prezime + b.zaposlenik.ime, "hr")),
    [db, mjesec]);

  // Ista podjela kao u Evidenciji rada (Radiona / Praktikanti / Tehnički ured i administracija) —
  // svaka skupina ima svoju tablicu i svoj poseban PDF ispis.
  const radionaRedovi = useMemo(() => redovi.filter((r) => grupaEvidencije(r.zaposlenik, db.pozicijeZaposlenika) === "radiona"), [redovi, db.pozicijeZaposlenika]);
  const praktikantiRedovi = useMemo(() => redovi.filter((r) => grupaEvidencije(r.zaposlenik, db.pozicijeZaposlenika) === "praktikant"), [redovi, db.pozicijeZaposlenika]);
  const tehnickiRedovi = useMemo(() => redovi.filter((r) => grupaEvidencije(r.zaposlenik, db.pozicijeZaposlenika) === "ostalo"), [redovi, db.pozicijeZaposlenika]);

  const detaljZaposlenik = detalj ? redovi.find((r) => r.zaposlenik.id === detalj) : null;

  // Ručni mjesečni dodaci/odbici (stimulacija, kredit, usteg prehrane) po zaposleniku — ne
  // proizlaze iz evidencije rada, pa se pamte kao zaseban zapis po (zaposlenik, mjesec).
  const spremiDoplatak = (zaposlenikId, patch) => {
    const postojeci = (db.doplaciPlaca || []).find((d) => d.zaposlenikId === zaposlenikId && d.mjesec === mjesec);
    if (postojeci) {
      update("doplaciPlaca", db.doplaciPlaca.map((d) => (d.id === postojeci.id ? { ...d, ...patch } : d)));
    } else {
      update("doplaciPlaca", [...(db.doplaciPlaca || []), { id: uid("dpl"), zaposlenikId, mjesec, stimulacija: 0, kredit: 0, ustegPrehrane: 0, prikazPrekovremenihSati: "", ...patch }]);
    }
  };

  const redoviKooperanti = useMemo(() => db.zaposlenici
    .filter((z) => z.status === "Aktivan" && jeKooperant(z, db.pozicijeZaposlenika))
    .map((z) => obracunMjesecaKooperant(z, mjesec, db))
    .filter((r) => r.brojDana > 0)
    .sort((a, b) => (a.zaposlenik.prezime + a.zaposlenik.ime).localeCompare(b.zaposlenik.prezime + b.zaposlenik.ime, "hr")),
    [db, mjesec]);

  const zbrojiRedove = (lista) => lista.reduce((s, r) => ({
    redovni: s.redovni + r.redovni, prekovremeni: s.prekovremeni + r.prekovremeni, prekovremeniStvarno: s.prekovremeniStvarno + r.prekovremeniStvarno,
    putni: s.putni + r.putni, topliObrok: s.topliObrok + r.topliObrok, ukupno: s.ukupno + r.ukupno,
  }), { redovni: 0, prekovremeni: 0, prekovremeniStvarno: 0, putni: 0, topliObrok: 0, ukupno: 0 });

  const ukKooperanti = redoviKooperanti.reduce((s, r) => ({ sati: s.sati + r.sati, ukupno: s.ukupno + r.ukupno }), { sati: 0, ukupno: 0 });

  // Vanjski suradnici se isplaćuju fiksnim iznosom bez obzira na odrađene sate, pa se (za
  // razliku od ostalih skupina) prikazuju svaki mjesec dok god su aktivni — ne samo mjesece u
  // kojima imaju bar jedan zapis u evidenciji.
  const redoviVanjski = useMemo(() => db.zaposlenici
    .filter((z) => z.status === "Aktivan" && jeVanjskiSuradnik(z, db.pozicijeZaposlenika))
    .map((z) => obracunMjesecaVanjskiSuradnik(z, mjesec, db))
    .sort((a, b) => (a.zaposlenik.prezime + a.zaposlenik.ime).localeCompare(b.zaposlenik.prezime + b.zaposlenik.ime, "hr")),
    [db, mjesec]);
  const ukVanjski = redoviVanjski.reduce((s, r) => ({ sati: s.sati + r.sati, iznos: s.iznos + r.iznos, naknadaPrijevoz: s.naknadaPrijevoz + r.naknadaPrijevoz, ukupno: s.ukupno + r.ukupno }), { sati: 0, iznos: 0, naknadaPrijevoz: 0, ukupno: 0 });

  const imaBolovanje = redovi.some((r) => r.dani.some((d) => d.vrsta === "bolovanje"));

  // Jedna tablica za sve tri formulom-obračunate skupine (Radiona / Praktikanti / Tehnički ured) —
  // Kooperanti imaju drugačiji (jednostavniji) obračun pa zadržavaju svoju zasebnu tablicu.
  const TablicaObracuna = ({ lista }) => {
    const uk = zbrojiRedove(lista);
    return (
      <table className="erp-table">
        <thead>
          <tr>
            <th>Zaposlenik</th>
            <th style={{ width: 70 }}>Satnica</th>
            <th style={{ width: 70 }}>Redovni</th>
            <th style={{ width: 80 }}>Prekovremeni</th>
            <th style={{ width: 100 }}>Prikaz prekovremenih</th>
            <th style={{ width: 90 }}>God./praz.</th>
            <th style={{ width: 70 }}>Putni</th>
            <th style={{ width: 80 }}>Obrok</th>
            <th style={{ width: 95 }}>Ukupno neto</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {lista.map((r) => (
            <tr key={r.zaposlenik.id}>
              <td><strong>{r.zaposlenik.prezime} {r.zaposlenik.ime}</strong><div style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{r.bodovi} bodova · staž {r.staz} god.{r.jeUred && <span style={{ color: "var(--steel)" }}> · fiksna plaća {fmtCurDec(r.fiksnaPlaca)}</span>}{r.satiSDodatkom > 0 && <span style={{ color: "var(--steel)" }}> · {r.satiSDodatkom.toFixed(1)}h u smjeni s dodatkom</span>}</div></td>
              <td className="f-mono">{r.satnica.toFixed(2)}{Math.abs(r.satnicaKorigirana - r.satnica) > 0.005 && <div style={{ fontSize: 10, color: "var(--steel)" }} title="Satnica za ovaj mjesec korigirana na ostvareni / mjesečni fond sati">{r.satnicaKorigirana.toFixed(2)} u mj.</div>}</td>
              <td className="f-mono">{r.redovni.toFixed(1)} h</td>
              <td className="f-mono" style={{ color: r.prekovremeniStvarno > 0 ? "var(--steel)" : "inherit" }}>{r.prekovremeniStvarno.toFixed(1)} h</td>
              <td>
                <input
                  className="input f-mono" type="number" step="0.5" min="0" placeholder="0" style={{ width: 80 }}
                  value={r.prikazPrekovremenihSati}
                  onChange={(e) => spremiDoplatak(r.zaposlenik.id, { prikazPrekovremenihSati: e.target.value === "" ? "" : Number(e.target.value) })}
                  disabled={!mozeMijenjati}
                />
              </td>
              <td className="f-mono">{r.placeniNerad.toFixed(1)} h</td>
              <td className="f-mono">{fmtCurDec(r.putni)}</td>
              <td className="f-mono">{fmtCurDec(r.topliObrok)}</td>
              <td className="f-mono" style={{ fontWeight: 700 }}>{fmtCurDec(r.ukupno)}</td>
              <td><button className="btn btn-icon btn-ghost" title="Detalji po danima" onClick={() => setDetalj(r.zaposlenik.id)}><Eye size={14} /></button></td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, background: "var(--surface-alt)" }}>
            <td colSpan={2}>UKUPNO ({lista.length})</td>
            <td className="f-mono">{uk.redovni.toFixed(1)} h</td>
            <td className="f-mono">{uk.prekovremeniStvarno.toFixed(1)} h</td>
            <td className="f-mono">{uk.prekovremeni.toFixed(1)} h</td>
            <td></td>
            <td className="f-mono">{fmtCurDec(uk.putni)}</td>
            <td className="f-mono">{fmtCurDec(uk.topliObrok)}</td>
            <td className="f-mono">{fmtCurDec(uk.ukupno)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    );
  };

  const NaslovSaPdf = ({ naslov, broj, grupa }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <div className="label" style={{ marginBottom: 0 }}>{naslov} ({broj})</div>
      {broj > 0 && <Btn variant="ghost" size="sm" icon={Eye} onClick={() => setPrintGrupa(grupa)}>PDF</Btn>}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="label">Mjesec</span>
          <MjesecOdabir value={mjesec} onChange={setMjesec} />
        </div>
        {mozeMijenjati && <Btn variant="ghost" icon={Settings} onClick={() => setPostavkeOtvorene(true)}>Postavke plaća</Btn>}
      </div>

      {imaBolovanje && (
        <div className="card" style={{ padding: "10px 14px", marginBottom: 14, background: "#FDF6E3", borderColor: "#F0C36B", display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={15} color="#8A6100" />
          <span style={{ fontSize: 12.5, color: "#6b5511" }}>U ovom mjesecu ima evidentiranih dana bolovanja. <strong>Pravilo obračuna bolovanja još nije definirano</strong> — ti dani se evidentiraju, ali se trenutno ne obračunavaju (0 €).</span>
        </div>
      )}

      <NaslovSaPdf naslov="Radiona" broj={radionaRedovi.length} grupa="radiona" />
      {radionaRedovi.length === 0 ? <EmptyState text="Nema evidentiranih sati za odabrani mjesec." /> : <TablicaObracuna lista={radionaRedovi} />}

      <div style={{ marginTop: 24 }}><NaslovSaPdf naslov="Praktikanti" broj={praktikantiRedovi.length} grupa="praktikant" /></div>
      {praktikantiRedovi.length === 0 ? <EmptyState text="Nema evidentiranih sati za odabrani mjesec." /> : <TablicaObracuna lista={praktikantiRedovi} />}

      <div style={{ marginTop: 24 }}><NaslovSaPdf naslov="Tehnički ured i administracija" broj={tehnickiRedovi.length} grupa="ostalo" /></div>
      {tehnickiRedovi.length === 0 ? <EmptyState text="Nema evidentiranih sati za odabrani mjesec." /> : <TablicaObracuna lista={tehnickiRedovi} />}

      {redovi.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 10 }}>
          Iznosi su <strong>neto</strong>, izračunati prema internim pravilima (bodovi, staž, stvarno odrađeni sati). Ovo nije obračun za poreznu prijavu — doprinosi, porezi i JOPPD nisu obuhvaćeni.
        </p>
      )}

      <div style={{ marginTop: 24 }}><NaslovSaPdf naslov="Kooperanti (isplata po satnici)" broj={redoviKooperanti.length} grupa="kooperant" /></div>
      {redoviKooperanti.length === 0 ? <EmptyState text="Nema evidentiranih sati kooperanata za odabrani mjesec." /> : (
        <>
          <table className="erp-table">
            <thead>
              <tr>
                <th>Kooperant</th>
                <th style={{ width: 90 }}>Satnica</th>
                <th style={{ width: 90 }}>Sati</th>
                <th style={{ width: 110 }}>Za isplatu</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {redoviKooperanti.map((r) => (
                <tr key={r.zaposlenik.id}>
                  <td><strong>{r.zaposlenik.prezime} {r.zaposlenik.ime}</strong></td>
                  <td className="f-mono">{fmtCurDec(r.satnica)}</td>
                  <td className="f-mono">{r.sati.toFixed(1)} h</td>
                  <td className="f-mono" style={{ fontWeight: 700 }}>{fmtCurDec(r.ukupno)}</td>
                  <td><button className="btn btn-icon btn-ghost" title="Detalji po danima" onClick={() => setDetaljKoop(r)}><Eye size={14} /></button></td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, background: "var(--surface-alt)" }}>
                <td>UKUPNO ({redoviKooperanti.length})</td>
                <td></td>
                <td className="f-mono">{ukKooperanti.sati.toFixed(1)} h</td>
                <td className="f-mono">{fmtCurDec(ukKooperanti.ukupno)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 10 }}>
            Kooperanti se ne obračunavaju po formuli plaće (bodovi/staž/putni/topli obrok) — plaćaju se isključivo po ugovorenoj satnici × stvarno odrađeni sati.
          </p>
        </>
      )}

      <div style={{ marginTop: 24 }}><NaslovSaPdf naslov="Vanjski suradnici (fiksni mjesečni iznos)" broj={redoviVanjski.length} grupa="vanjski" /></div>
      {redoviVanjski.length === 0 ? <EmptyState text="Nema aktivnih vanjskih suradnika." /> : (
        <>
          <table className="erp-table">
            <thead>
              <tr>
                <th>Vanjski suradnik</th>
                <th style={{ width: 90 }}>Sati (evidencija)</th>
                <th style={{ width: 110 }}>Fiksni iznos</th>
                <th style={{ width: 110 }}>Naknada za prijevoz</th>
                <th style={{ width: 110 }}>Ukupno</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {redoviVanjski.map((r) => (
                <tr key={r.zaposlenik.id}>
                  <td><strong>{r.zaposlenik.prezime} {r.zaposlenik.ime}</strong></td>
                  <td className="f-mono">{r.sati.toFixed(1)} h</td>
                  <td className="f-mono">{fmtCurDec(r.iznos)}</td>
                  <td className="f-mono">{fmtCurDec(r.naknadaPrijevoz)}</td>
                  <td className="f-mono" style={{ fontWeight: 700 }}>{fmtCurDec(r.ukupno)}</td>
                  <td><button className="btn btn-icon btn-ghost" title="Detalji po danima" onClick={() => setDetaljVanjski(r)}><Eye size={14} /></button></td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, background: "var(--surface-alt)" }}>
                <td>UKUPNO ({redoviVanjski.length})</td>
                <td className="f-mono">{ukVanjski.sati.toFixed(1)} h</td>
                <td className="f-mono">{fmtCurDec(ukVanjski.iznos)}</td>
                <td className="f-mono">{fmtCurDec(ukVanjski.naknadaPrijevoz)}</td>
                <td className="f-mono">{fmtCurDec(ukVanjski.ukupno)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 10 }}>
            Vanjski suradnici se ne obračunavaju po satu — isplaćuje im se fiksni dogovoreni mjesečni iznos + fiksna naknada za prijevoz, bez obzira na odrađene sate. Sati su prikazani samo informativno iz evidencije rada.
          </p>
        </>
      )}

      {detaljVanjski && (
        <Modal title={`Evidencija — ${detaljVanjski.zaposlenik.prezime} ${detaljVanjski.zaposlenik.ime} (${mjesec})`} onClose={() => setDetaljVanjski(null)} footer={<Btn onClick={() => setDetaljVanjski(null)}>Zatvori</Btn>}>
          <table className="erp-table">
            <thead><tr><th>Datum</th><th style={{ width: 90 }}>Sati</th></tr></thead>
            <tbody>
              {[...detaljVanjski.dani].sort((a, b) => a.datum.localeCompare(b.datum)).map((d) => (
                <tr key={d.datum}><td className="f-mono">{fmtDate(d.datum)}</td><td className="f-mono">{d.odradjeniSati.toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="card" style={{ padding: 12, marginTop: 12, background: "var(--surface-alt)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12.5 }}>
              <span>Fiksni mjesečni iznos (ne ovisi o satima)</span><span className="f-mono" style={{ textAlign: "right" }}>{fmtCurDec(detaljVanjski.iznos)}</span>
              <span>Naknada za prijevoz</span><span className="f-mono" style={{ textAlign: "right" }}>{fmtCurDec(detaljVanjski.naknadaPrijevoz)}</span>
              <span style={{ fontWeight: 700, borderTop: "1px solid var(--line)", paddingTop: 6 }}>UKUPNO</span>
              <span className="f-mono" style={{ textAlign: "right", fontWeight: 700, borderTop: "1px solid var(--line)", paddingTop: 6 }}>{fmtCurDec(detaljVanjski.ukupno)}</span>
            </div>
          </div>
        </Modal>
      )}

      {detaljKoop && (
        <Modal title={`Odrađeni sati — ${detaljKoop.zaposlenik.prezime} ${detaljKoop.zaposlenik.ime} (${mjesec})`} onClose={() => setDetaljKoop(null)} footer={<Btn onClick={() => setDetaljKoop(null)}>Zatvori</Btn>}>
          <table className="erp-table">
            <thead><tr><th>Datum</th><th style={{ width: 90 }}>Sati</th></tr></thead>
            <tbody>
              {[...detaljKoop.dani].sort((a, b) => a.datum.localeCompare(b.datum)).map((d) => (
                <tr key={d.datum}><td className="f-mono">{fmtDate(d.datum)}</td><td className="f-mono">{d.odradjeniSati.toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="card" style={{ padding: 12, marginTop: 12, background: "var(--surface-alt)", display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span>{detaljKoop.sati.toFixed(1)} h × {fmtCurDec(detaljKoop.satnica)}/h</span>
            <strong className="f-mono">{fmtCurDec(detaljKoop.ukupno)}</strong>
          </div>
        </Modal>
      )}

      {detaljZaposlenik && (
        <Modal wide title={`Obračun po danima — ${detaljZaposlenik.zaposlenik.prezime} ${detaljZaposlenik.zaposlenik.ime} (${mjesec})`} onClose={() => setDetalj(null)} footer={<Btn onClick={() => setDetalj(null)}>Zatvori</Btn>}>
          <div className="card" style={{ padding: 12, marginBottom: 12, background: "var(--surface-alt)", fontSize: 12.5 }}>
            {detaljZaposlenik.bodovi} bodova × {db.postavkePlaca?.vrijednostBoda} € = <strong className="f-mono">{fmtCurDec(detaljZaposlenik.osnovica)}</strong> ÷ {db.postavkePlaca?.fondSatiMjesec} h (godišnji fond) = <strong className="f-mono" style={{ color: "var(--steel)" }}>{detaljZaposlenik.satnica.toFixed(3)} €/h</strong>
            {detaljZaposlenik.jeUred && (
              <div style={{ marginTop: 6, color: "var(--ink-soft)" }}>
                <strong>Ured — fiksna neto plaća:</strong> {detaljZaposlenik.bodovi} bodova × {db.postavkePlaca?.vrijednostBoda} €{detaljZaposlenik.polaRadnoVrijeme && <> × 0,5 (pola radnog vremena)</>} = <strong className="f-mono">{fmtCurDec(detaljZaposlenik.fiksnaPlacaPuna)}</strong> za cijeli mjesečni fond ({detaljZaposlenik.mjesecniFond} h)
                {detaljZaposlenik.neplaceniDaniUred > 0 && <> · umanjeno za <strong className="f-mono">{detaljZaposlenik.neplaceniDaniUred}</strong> neplaćenih radnih dana (bolovanje/očinski/roditeljski/prije zaposlenja) = <strong className="f-mono">{fmtCurDec(detaljZaposlenik.fiksnaPlaca)}</strong></>}
                . Prekovremeni se računaju po satnici ({detaljZaposlenik.satnica.toFixed(3)} €/h × 1,5).
              </div>
            )}
            {!detaljZaposlenik.jeUred && <div style={{ marginTop: 6, color: "var(--ink-soft)" }}>Fond sati ovog mjeseca: <strong className="f-mono">{detaljZaposlenik.mjesecniFond} h</strong> ({detaljZaposlenik.radniDaniMjeseca} radnih dana × 8) · ostvareno <strong className="f-mono">{detaljZaposlenik.ostvareniSati.toFixed(1)} h</strong> → satnica za ovaj mjesec <strong className="f-mono" style={{ color: "var(--steel)" }}>{detaljZaposlenik.satnicaKorigirana.toFixed(3)} €/h</strong> (plaća se samo ostvareno: sati × {detaljZaposlenik.satnica.toFixed(3)} €/h)</div>}
          </div>
          <table className="erp-table">
            <thead><tr><th style={{ width: 100 }}>Datum</th><th style={{ width: 85 }}>Vrsta</th><th style={{ width: 95 }}>Smjena</th><th style={{ width: 65 }}>Sati</th><th style={{ width: 65 }}>Redovni</th><th style={{ width: 75 }}>Prekovr.</th><th style={{ width: 65 }}>Putni</th><th style={{ width: 65 }}>Obrok</th></tr></thead>
            <tbody>
              {[...detaljZaposlenik.dani].sort((a, b) => a.datum.localeCompare(b.datum)).map((d) => (
                <tr key={d.datum}>
                  <td className="f-mono">{fmtDate(d.datum)}{d.danUTjednu === 6 && <span style={{ color: "var(--steel)", fontSize: 10 }}> SUB</span>}{d.praznik && <span style={{ color: "var(--rust)", fontSize: 10 }}> PRAZ</span>}</td>
                  <td style={{ fontSize: 11.5 }}>{VRSTE_DANA.find((v) => v.key === d.vrsta)?.label}</td>
                  <td style={{ fontSize: 11.5 }}>{d.vrsta === "rad" ? <>{d.smjena?.naziv}{d.dodatakSmjene > 1 && <span style={{ color: "var(--steel)", fontWeight: 600 }}> +{Math.round((d.dodatakSmjene - 1) * 100)}%</span>}</> : "—"}</td>
                  <td className="f-mono">{d.odradjeniSati.toFixed(1)}</td>
                  <td className="f-mono">{d.redovni.toFixed(1)}{d.redovni > 0 && d.dodatakSmjene > 1 && <span style={{ fontSize: 9.5, color: "var(--steel)" }}> ×{d.dodatakSmjene.toFixed(1)}</span>}</td>
                  <td className="f-mono" style={{ color: d.prekovremeni > 0 ? "var(--steel)" : "inherit" }}>{d.prekovremeni.toFixed(1)}{d.prekovremeni > 0 && <span style={{ fontSize: 9.5 }}> ×{d.faktorPrekSaSmjenom.toFixed(1)}</span>}</td>
                  <td className="f-mono">{d.putni > 0 ? fmtCurDec(d.putni) : "—"}</td>
                  <td className="f-mono">{d.topliObrok > 0 ? fmtCurDec(d.topliObrok) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card" style={{ padding: 12, marginTop: 12, background: "var(--surface-alt)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12.5 }}>
              <span>{detaljZaposlenik.jeUred ? "Fiksna neto plaća (ured)" : `Redovni rad (${detaljZaposlenik.redovni.toFixed(1)} h)`}</span><span className="f-mono" style={{ textAlign: "right" }}>{fmtCurDec(detaljZaposlenik.iznosRedovni)}</span>
              <span>Prekovremeni ({detaljZaposlenik.prekovremeni.toFixed(1)} h{detaljZaposlenik.visakPrekovremenihSati > 0 && <span style={{ color: "var(--ink-faint)" }}> — stvarno {detaljZaposlenik.prekovremeniStvarno.toFixed(1)} h, {detaljZaposlenik.visakPrekovremenihSati.toFixed(1)} h u stimulaciji</span>})</span><span className="f-mono" style={{ textAlign: "right" }}>{fmtCurDec(detaljZaposlenik.iznosPrekovremeni)}</span>
              <span>Godišnji / praznici / dopust / detašman ({detaljZaposlenik.placeniNerad.toFixed(1)} h)</span><span className="f-mono" style={{ textAlign: "right" }}>{fmtCurDec(detaljZaposlenik.iznosNerad)}</span>
              {detaljZaposlenik.detasmanSati > 0 && <><span style={{ color: "var(--ink-faint)", fontSize: 11 }}>— od toga detašman: {detaljZaposlenik.detasmanSati.toFixed(1)} h</span><span></span></>}
              <span>Dodatak na staž ({detaljZaposlenik.staz} god. × {detaljZaposlenik.daniStaza} dana)</span><span className="f-mono" style={{ textAlign: "right" }}>{fmtCurDec(detaljZaposlenik.dodatakStaz)}</span>
              <span>Putni troškovi</span><span className="f-mono" style={{ textAlign: "right" }}>{fmtCurDec(detaljZaposlenik.putni)}</span>
              <span>Topli obrok</span><span className="f-mono" style={{ textAlign: "right" }}>{fmtCurDec(detaljZaposlenik.topliObrok)}</span>
              {detaljZaposlenik.prebacenoSubota > 0 && <><span style={{ color: "var(--ink-faint)", fontSize: 11 }}>— subotnji putni ({fmtCurDec(detaljZaposlenik.prebacenoPutni)}) i topli obrok ({fmtCurDec(detaljZaposlenik.prebacenoObrok)}) prebačeni u stimulaciju</span><span></span></>}
              {detaljZaposlenik.danaSluzbenogPuta > 0 && <><span>Dnevnica službeni put ({detaljZaposlenik.danaSluzbenogPuta} dana)</span><span className="f-mono" style={{ textAlign: "right" }}>{fmtCurDec(detaljZaposlenik.dnevnicaTeren)}</span></>}
              {detaljZaposlenik.ocinskiSati > 0 && <><span style={{ color: "var(--ink-faint)" }}>Očinski ({detaljZaposlenik.ocinskiSati.toFixed(1)} h, evidentirano)</span><span className="f-mono" style={{ textAlign: "right", color: "var(--ink-faint)" }}>0,00 €</span></>}
              {detaljZaposlenik.roditeljskiSati > 0 && <><span style={{ color: "var(--ink-faint)" }}>Roditeljski ({detaljZaposlenik.roditeljskiSati.toFixed(1)} h, evidentirano)</span><span className="f-mono" style={{ textAlign: "right", color: "var(--ink-faint)" }}>0,00 €</span></>}
              {detaljZaposlenik.bolovanjeSati > 0 && <><span style={{ color: "var(--ink-faint)" }}>Bolovanje ({detaljZaposlenik.bolovanjeSati.toFixed(1)} h, evidentirano)</span><span className="f-mono" style={{ textAlign: "right", color: "var(--ink-faint)" }}>0,00 €</span></>}
              <span style={{ fontWeight: 700, borderTop: "1px solid var(--line)", paddingTop: 6 }}>UKUPNO NETO</span>
              <span className="f-mono" style={{ textAlign: "right", fontWeight: 700, borderTop: "1px solid var(--line)", paddingTop: 6 }}>{fmtCurDec(detaljZaposlenik.ukupno)}</span>
            </div>
          </div>

          <div className="label" style={{ marginTop: 16, marginBottom: 6 }}>Ručni dodaci/odbici za {mjesec}</div>
          <div className="card" style={{ padding: 12, background: "var(--surface-alt)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <Field label="Stimulacija (€, ručno)">
                <input className="input f-mono" type="number" step="0.01" value={detaljZaposlenik.stimulacijaRucno || 0} onChange={(e) => spremiDoplatak(detaljZaposlenik.zaposlenik.id, { stimulacija: Number(e.target.value) || 0 })} disabled={!mozeMijenjati} />
              </Field>
              <Field label="Odbitak kredita (€)">
                <input className="input f-mono" type="number" step="0.01" value={detaljZaposlenik.kredit || 0} onChange={(e) => spremiDoplatak(detaljZaposlenik.zaposlenik.id, { kredit: Number(e.target.value) || 0 })} disabled={!mozeMijenjati} />
              </Field>
              <Field label="Usteg prehrane (€)">
                <input className="input f-mono" type="number" step="0.01" value={detaljZaposlenik.ustegPrehrane || 0} onChange={(e) => spremiDoplatak(detaljZaposlenik.zaposlenik.id, { ustegPrehrane: Number(e.target.value) || 0 })} disabled={!mozeMijenjati} />
              </Field>
              <Field label="Prikaz prekovremenih (h)">
                <input className="input f-mono" type="number" step="0.5" min="0" placeholder="0" value={detaljZaposlenik.prikazPrekovremenihSati} onChange={(e) => spremiDoplatak(detaljZaposlenik.zaposlenik.id, { prikazPrekovremenihSati: e.target.value === "" ? "" : Number(e.target.value) })} disabled={!mozeMijenjati} />
                <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3 }}>Stvarno ostvareno: {detaljZaposlenik.prekovremeniStvarno.toFixed(1)} h. Prazno ili 0 = ništa se ne prikazuje, sve ide u stimulaciju.</div>
              </Field>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <strong style={{ fontSize: 13 }}>ISPLATA</strong>
              <strong className="f-mono" style={{ fontSize: 15 }}>{fmtCurDec(detaljZaposlenik.isplata)}</strong>
            </div>
          </div>
        </Modal>
      )}

      {postavkeOtvorene && <PostavkePlacaModal db={db} update={update} showToast={showToast} onClose={() => setPostavkeOtvorene(false)} />}
      {printGrupa && printGrupa !== "kooperant" && printGrupa !== "vanjski" && (
        <ObracunPlacaPrintModal
          redovi={printGrupa === "radiona" ? radionaRedovi : printGrupa === "praktikant" ? praktikantiRedovi : tehnickiRedovi}
          naslovGrupe={printGrupa === "radiona" ? "Radiona" : printGrupa === "praktikant" ? "Praktikanti" : "Tehnički ured i administracija"}
          mjesec={mjesec} db={db} onClose={() => setPrintGrupa(null)}
        />
      )}
      {printGrupa === "kooperant" && <ObracunKooperantiPrintModal redovi={redoviKooperanti} mjesec={mjesec} db={db} onClose={() => setPrintGrupa(null)} />}
      {printGrupa === "vanjski" && <ObracunVanjskiPrintModal redovi={redoviVanjski} mjesec={mjesec} db={db} onClose={() => setPrintGrupa(null)} />}
    </div>
  );
}

// Grupira dane određene vrste (bolovanje, detašman...) u raspone datuma po zaposleniku — koristi
// se za "Bolovanja:"/"Detašmani:" napomenu ispod obračuna u PDF ispisu. Prikazuju se svi rasponi
// koji dodiruju odabrani mjesec, samo za zaposlenike iz dane skupine (da PDF jedne skupine ne
// prikazuje tuđe podatke).
const rasponiVrsteDana = (evidencijaRada, zaposlenici, mjesec, dozvoljeniIds, vrsta) => {
  const poZaposleniku = new Map();
  (evidencijaRada || []).filter((e) => e.vrsta === vrsta && dozvoljeniIds.has(e.zaposlenikId)).forEach((e) => {
    const datum = e.vrijemeDolaska.slice(0, 10);
    const niz = poZaposleniku.get(e.zaposlenikId) || [];
    niz.push(datum);
    poZaposleniku.set(e.zaposlenikId, niz);
  });
  const rezultat = [];
  poZaposleniku.forEach((datumi, zapId) => {
    const sortirano = [...new Set(datumi)].sort();
    let raspon = null;
    const rasponi = [];
    sortirano.forEach((d) => {
      if (raspon && addDays(raspon.do, 1) === d) raspon.do = d;
      else { if (raspon) rasponi.push(raspon); raspon = { od: d, do: d }; }
    });
    if (raspon) rasponi.push(raspon);
    const zap = zaposlenici.find((z) => z.id === zapId);
    rasponi.filter((r) => r.od.slice(0, 7) <= mjesec && r.do.slice(0, 7) >= mjesec)
      .forEach((r) => rezultat.push({ ime: zap ? `${zap.prezime} ${zap.ime}` : "—", ...r }));
  });
  return rezultat.sort((a, b) => a.ime.localeCompare(b.ime, "hr"));
};

// Ispis obračuna plaće za cijelu tvrtku za odabrani mjesec — po uzoru na postojeći excel koji
// računovodstvo šalje vanjskom knjigovodstvu. Bolovanja i detašmani se prikazuju kao popis
// raspona datuma (bolovanje se evidentira ali ne obračunava — vidi obracunDana — pa nosi
// napomenu "dodati"; detašman je već uključen u iznos u tablici, pa ta napomena ne treba),
// a poziv na broj se ne može izvesti automatski pa ostaje ručno polje.
function ObracunPlacaPrintModal({ redovi, naslovGrupe, mjesec, db, onClose }) {
  const t = db.postavkeTvrtke || {};
  const [pozivBroj, setPozivBroj] = useState("");
  const [gmesec, gg] = mjesec.split("-");

  const brojDanaSObrokom = (r) => r.daniObroka;
  const ukupnoSati = (r) => r.redovni + r.prekovremeni + r.praznikSati + r.godisnjiSati + r.dopustSati + r.detasmanSati + r.bolovanjeSati + r.ocinskiSati + r.roditeljskiSati;
  const ukupnoFondSatiEur = (r) => r.iznosRedovni + r.iznosPrekovremeni + r.iznosNerad;
  const ukupnoPdf = (r) => r.stimulacija + r.dodatakStaz + ukupnoFondSatiEur(r);

  const ukupnaIsplata = redovi.reduce((s, r) => s + r.isplata, 0);

  // Bolovanja (uključujući roditeljski/dulja odsustva evidentirana kao "bolovanje") i detašmani —
  // raspon datuma po zaposleniku, samo za zaposlenike iz OVE skupine (redovi), da PDF jedne
  // skupine ne prikazuje tuđe podatke.
  const uSkupini = useMemo(() => new Set(redovi.map((r) => r.zaposlenik.id)), [redovi]);
  const bolovanja = useMemo(() => rasponiVrsteDana(db.evidencijaRada, db.zaposlenici, mjesec, uSkupini, "bolovanje"), [db.evidencijaRada, db.zaposlenici, mjesec, uSkupini]);
  const ocinski = useMemo(() => rasponiVrsteDana(db.evidencijaRada, db.zaposlenici, mjesec, uSkupini, "ocinski"), [db.evidencijaRada, db.zaposlenici, mjesec, uSkupini]);
  const roditeljski = useMemo(() => rasponiVrsteDana(db.evidencijaRada, db.zaposlenici, mjesec, uSkupini, "roditeljski"), [db.evidencijaRada, db.zaposlenici, mjesec, uSkupini]);
  const detasmani = useMemo(() => rasponiVrsteDana(db.evidencijaRada, db.zaposlenici, mjesec, uSkupini, "detasman"), [db.evidencijaRada, db.zaposlenici, mjesec, uSkupini]);

  const tdS = { padding: "3px 4px", fontSize: 9, whiteSpace: "nowrap" };
  const thS = { ...tdS, fontWeight: 700, background: "#f0f0f0" };

  return (
    <Modal wide title={`Pregled za ispis — Obračun plaće ${naslovGrupe} ${mjesec}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => ispisPdf(`Placa_${naslovGrupe.replace(/\s+/g, "-")}_${gg}${gmesec}`)}>Ispis / Spremi kao PDF</Btn></>}>
      <style>{"@media print { @page { size: A3 landscape; } }"}</style>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
          <span>{t.naziv || "ECON d.o.o."}</span>
          <span>OBRAČUN PLAĆE - HR · {naslovGrupe}</span>
          <span>Mjesec obračuna: {gmesec}/{gg}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={thS}>Red. broj</th>
                <th style={thS}>Matični broj</th>
                <th style={thS}>Ime i prezime</th>
                <th style={thS}>Radni sati</th>
                <th style={thS}>Sati preko</th>
                <th style={thS}>Praznik</th>
                <th style={thS}>Plaćeni dopust</th>
                <th style={thS}>Detašman</th>
                <th style={thS}>GO sati</th>
                <th style={thS}>BO sati</th>
                <th style={thS}>OČ sati</th>
                <th style={thS}>RD sati</th>
                <th style={thS}>Ukupno sati</th>
                <th style={thS}>Stimulacija I</th>
                <th style={thS}>Dodatak na staž</th>
                <th style={thS}>Ukupno fond sati €</th>
                <th style={thS}>UKUPNO</th>
                <th style={thS}>D</th>
                <th style={thS}>Prehrana</th>
                <th style={thS}>D</th>
                <th style={thS}>Teren.DE</th>
                <th style={thS}>Prijevoz</th>
                <th style={thS}>DODACI ukupno</th>
                <th style={thS}>ODBICI KREDIT</th>
                <th style={thS}>USTEG Prehrana</th>
                <th style={thS}>ISPLATA</th>
              </tr>
            </thead>
            <tbody>
              {redovi.map((r, i) => (
                <tr key={r.zaposlenik.id}>
                  <td style={tdS}>{i + 1}</td>
                  <td style={tdS}>{r.zaposlenik.maticniBroj || ""}</td>
                  <td style={tdS}>{r.zaposlenik.prezime} {r.zaposlenik.ime}</td>
                  <td style={tdS}>{r.redovni.toFixed(2)}</td>
                  <td style={tdS}>{r.prekovremeni.toFixed(2)}</td>
                  <td style={tdS}>{r.praznikSati.toFixed(0)}</td>
                  <td style={tdS}>{r.dopustSati.toFixed(0)}</td>
                  <td style={tdS}>{r.detasmanSati.toFixed(0)}</td>
                  <td style={tdS}>{r.godisnjiSati.toFixed(0)}</td>
                  <td style={tdS}>{r.bolovanjeSati.toFixed(0)}</td>
                  <td style={tdS}>{r.ocinskiSati.toFixed(0)}</td>
                  <td style={tdS}>{r.roditeljskiSati.toFixed(0)}</td>
                  <td style={tdS}>{ukupnoSati(r).toFixed(2)}</td>
                  <td style={tdS}>{fmtCurDec(r.stimulacija).replace(" €", "")}</td>
                  <td style={tdS}>{fmtCurDec(r.dodatakStaz).replace(" €", "")}</td>
                  <td style={tdS}>{fmtCurDec(ukupnoFondSatiEur(r)).replace(" €", "")}</td>
                  <td style={{ ...tdS, fontWeight: 700 }}>{fmtCurDec(ukupnoPdf(r)).replace(" €", "")}</td>
                  <td style={tdS}>{brojDanaSObrokom(r)}</td>
                  <td style={tdS}>{fmtCurDec(r.topliObrok).replace(" €", "")}</td>
                  <td style={tdS}>{r.danaSluzbenogPuta}</td>
                  <td style={tdS}>{fmtCurDec(r.dnevnicaTeren).replace(" €", "")}</td>
                  <td style={tdS}>{fmtCurDec(r.putni).replace(" €", "")}</td>
                  <td style={tdS}>{fmtCurDec(r.dodaciUkupno).replace(" €", "")}</td>
                  <td style={tdS}>{fmtCurDec(r.kredit).replace(" €", "")}</td>
                  <td style={tdS}>{fmtCurDec(r.ustegPrehrane).replace(" €", "")}</td>
                  <td style={{ ...tdS, fontWeight: 700 }}>{fmtCurDec(r.isplata).replace(" €", "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ textAlign: "right", fontWeight: 700, fontSize: 11, marginTop: 6, paddingRight: 4 }}>{fmtCurDec(ukupnaIsplata)}</div>
        </div>

        {bolovanja.length > 0 && (
          <div style={{ marginTop: 18, fontSize: 10.5 }}>
            <div style={{ fontWeight: 700, textDecoration: "underline", marginBottom: 4 }}>Bolovanja:</div>
            {bolovanja.map((b, i) => (
              <div key={i}><strong>{b.ime}:</strong> bolovanje od {fmtDate(b.od)} do {fmtDate(b.do)} — <strong>dodati</strong></div>
            ))}
          </div>
        )}

        {ocinski.length > 0 && (
          <div style={{ marginTop: 18, fontSize: 10.5 }}>
            <div style={{ fontWeight: 700, textDecoration: "underline", marginBottom: 4 }}>Očinski:</div>
            {ocinski.map((b, i) => (
              <div key={i}><strong>{b.ime}:</strong> očinski od {fmtDate(b.od)} do {fmtDate(b.do)} — <strong>dodati</strong></div>
            ))}
          </div>
        )}

        {roditeljski.length > 0 && (
          <div style={{ marginTop: 18, fontSize: 10.5 }}>
            <div style={{ fontWeight: 700, textDecoration: "underline", marginBottom: 4 }}>Roditeljski:</div>
            {roditeljski.map((b, i) => (
              <div key={i}><strong>{b.ime}:</strong> roditeljski od {fmtDate(b.od)} do {fmtDate(b.do)} — <strong>dodati</strong></div>
            ))}
          </div>
        )}

        {detasmani.length > 0 && (
          <div style={{ marginTop: 18, fontSize: 10.5 }}>
            <div style={{ fontWeight: 700, textDecoration: "underline", marginBottom: 4 }}>Detašmani:</div>
            {detasmani.map((d, i) => (
              <div key={i}><strong>{d.ime}:</strong> detašman od {fmtDate(d.od)} do {fmtDate(d.do)}</div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 18, fontSize: 10.5 }}>
          Svi isplata plaće poziv na broj platitelja: Model <strong>67</strong> poziv na broj platitelja <strong className="f-mono">{t.oib}</strong>-
          <input className="f-mono" style={{ border: "1px solid #ccc", width: 70, fontSize: 10.5, padding: "1px 4px" }} value={pozivBroj} onChange={(e) => setPozivBroj(e.target.value)} placeholder="XXXXX" />
          -0
        </div>
      </div>
    </Modal>
  );
}

// Kooperanti se obračunavaju drugačije (samo sati × ugovorena satnica) pa imaju svoj, jednostavniji ispis.
function ObracunKooperantiPrintModal({ redovi, mjesec, db, onClose }) {
  const t = db.postavkeTvrtke || {};
  const [gmesec, gg] = mjesec.split("-");
  const tdS = { padding: "3px 4px", fontSize: 9, whiteSpace: "nowrap" };
  const thS = { ...tdS, fontWeight: 700, background: "#f0f0f0" };
  const ukupnaIsplata = redovi.reduce((s, r) => s + r.ukupno, 0);

  return (
    <Modal title={`Pregled za ispis — Obračun kooperanata ${mjesec}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => ispisPdf(`Placa_Kooperanti_${gg}${gmesec}`)}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
          <span>{t.naziv || "ECON d.o.o."}</span>
          <span>OBRAČUN KOOPERANATA</span>
          <span>Mjesec obračuna: {gmesec}/{gg}</span>
        </div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={thS}>Red. broj</th>
              <th style={thS}>Ime i prezime</th>
              <th style={thS}>Satnica</th>
              <th style={thS}>Sati</th>
              <th style={thS}>Za isplatu</th>
            </tr>
          </thead>
          <tbody>
            {redovi.map((r, i) => (
              <tr key={r.zaposlenik.id}>
                <td style={tdS}>{i + 1}</td>
                <td style={tdS}>{r.zaposlenik.prezime} {r.zaposlenik.ime}</td>
                <td style={tdS}>{fmtCurDec(r.satnica)}</td>
                <td style={tdS}>{r.sati.toFixed(1)}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtCurDec(r.ukupno)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: "right", fontWeight: 700, fontSize: 11, marginTop: 6, paddingRight: 4 }}>{fmtCurDec(ukupnaIsplata)}</div>
      </div>
    </Modal>
  );
}

function ObracunVanjskiPrintModal({ redovi, mjesec, db, onClose }) {
  const t = db.postavkeTvrtke || {};
  const [gmesec, gg] = mjesec.split("-");
  const tdS = { padding: "3px 4px", fontSize: 9, whiteSpace: "nowrap" };
  const thS = { ...tdS, fontWeight: 700, background: "#f0f0f0" };
  const ukupnaIsplata = redovi.reduce((s, r) => s + r.ukupno, 0);

  return (
    <Modal title={`Pregled za ispis — Obračun vanjskih suradnika ${mjesec}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => ispisPdf(`Placa_Vanjski-suradnici_${gg}${gmesec}`)}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
          <span>{t.naziv || "ECON d.o.o."}</span>
          <span>OBRAČUN VANJSKIH SURADNIKA</span>
          <span>Mjesec obračuna: {gmesec}/{gg}</span>
        </div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={thS}>Red. broj</th>
              <th style={thS}>Ime i prezime</th>
              <th style={thS}>Sati (evidencija)</th>
              <th style={thS}>Fiksni iznos</th>
              <th style={thS}>Naknada za prijevoz</th>
              <th style={thS}>Ukupno</th>
            </tr>
          </thead>
          <tbody>
            {redovi.map((r, i) => (
              <tr key={r.zaposlenik.id}>
                <td style={tdS}>{i + 1}</td>
                <td style={tdS}>{r.zaposlenik.prezime} {r.zaposlenik.ime}</td>
                <td style={tdS}>{r.sati.toFixed(1)}</td>
                <td style={tdS}>{fmtCurDec(r.iznos)}</td>
                <td style={tdS}>{fmtCurDec(r.naknadaPrijevoz)}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtCurDec(r.ukupno)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: "right", fontWeight: 700, fontSize: 11, marginTop: 6, paddingRight: 4 }}>{fmtCurDec(ukupnaIsplata)}</div>
      </div>
    </Modal>
  );
}

/* ============================== SATI PO NALOZIMA ============================== */
// Dnevni unos sati po radnom nalogu, po zaposleniku. "utrosenoSati" na radnom nalogu postaje
// IZVEDENO polje (zbroj ovih redaka) umjesto ručno upisanog broja — vidi zbrojSatiZaNalog i
// polje "Utrošeno sati" u ProizvodnjaPage.
function SatiPoNalozimaTab({ db, update, showToast, mozeMijenjati = true }) {
  const [prikaz, setPrikaz] = useState("dnevno"); // "dnevno" (unos) | "mjesecno" (pregled po nalozima/operacijama)
  const [datum, setDatum] = useState(todayISO());
  const [uredjivanje, setUredjivanje] = useState(null); // id zaposlenika trenutno otvorenog za unos
  const [redoviUnos, setRedoviUnos] = useState([]);
  const [delZa, setDelZa] = useState(null); // zaposlenik čiji se unos za taj dan briše

  const [mjesecPregled, setMjesecPregled] = useState(todayISO().slice(0, 7));
  // Presjek za odabrani mjesec: stupci su radni nalozi koji su TAJ mjesec imali evidentirane sate
  // (a ne svi postojeći nalozi), retci su operacije/faze — svaki nalog ima točno jednu fazu, pa se
  // njegov zbroj sati pojavljuje u retku te faze, u stupcu tog naloga.
  const pregledMjeseca = useMemo(() => {
    const poNalogu = new Map();
    db.satiPoNalogu.filter((s) => s.datum.slice(0, 7) === mjesecPregled).forEach((s) => {
      poNalogu.set(s.radniNalogId, (poNalogu.get(s.radniNalogId) || 0) + (Number(s.sati) || 0));
    });
    const nalozi = [...poNalogu.entries()]
      .map(([radniNalogId, sati]) => ({ nalog: db.radniNalozi.find((n) => n.id === radniNalogId), sati }))
      .filter((r) => r.nalog)
      .sort((a, b) => usporediPrirodno(a.nalog.broj, b.nalog.broj));
    const faze = FAZE.filter((f) => nalozi.some((r) => r.nalog.faza === f));
    return { nalozi, faze };
  }, [db.satiPoNalogu, db.radniNalozi, mjesecPregled]);

  const zaposlenikIme = (id) => { const z = db.zaposlenici.find((zz) => zz.id === id); return z ? `${z.prezime} ${z.ime}` : "—"; };

  // Radnici koji su TOG dana stvarno radili (vrsta "rad") — samo za njih ima smisla raspoređivati
  // sate. Jedan dan može imati VIŠE odvojenih prijava/odjava (npr. jutarnja smjena pa kratki
  // povratak u tvrtku) — zbraja se preko svih "rad" segmenata tog dana, ne samo prvog pronađenog.
  const radnici = useMemo(() => db.zaposlenici
    .filter((z) => z.status === "Aktivan")
    .map((z) => {
      const zapisi = db.evidencijaRada.filter((e) => e.zaposlenikId === z.id && e.vrijemeDolaska.slice(0, 10) === datum && (e.vrsta || "rad") === "rad");
      if (zapisi.length === 0) return null;
      const satiPrijave = zapisi.reduce((s, e) => s + obracunskiSati(e.vrijemeDolaska, e.vrijemeOdlaska, odrediSmjenu(e.vrijemeDolaska, db.postavkePlaca), db.postavkePlaca), 0);
      const uneseno = db.satiPoNalogu.filter((s) => s.zaposlenikId === z.id && s.datum === datum);
      return { zaposlenik: z, satiPrijave, uneseno, satiUneseno: uneseno.reduce((s, r) => s + (Number(r.sati) || 0), 0) };
    })
    .filter(Boolean)
    .sort((a, b) => (a.zaposlenik.prezime + a.zaposlenik.ime).localeCompare(b.zaposlenik.prezime + b.zaposlenik.ime, "hr")),
    [db.zaposlenici, db.evidencijaRada, db.satiPoNalogu, db.postavkePlaca, datum]);

  const otvoriUnos = (r) => {
    if (!mozeMijenjati) return;
    setUredjivanje(r.zaposlenik.id);
    setRedoviUnos(r.uneseno.length ? r.uneseno.map((u) => ({ radniNalogId: u.radniNalogId, sati: u.sati })) : [{ radniNalogId: "", sati: "" }]);
  };
  const dodajRedak = () => setRedoviUnos([...redoviUnos, { radniNalogId: "", sati: "" }]);
  const azurirajRedak = (i, patch) => setRedoviUnos(redoviUnos.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const obrisiRedak = (i) => setRedoviUnos(redoviUnos.filter((_, idx) => idx !== i));

  const zbrojUnosa = redoviUnos.reduce((s, r) => s + (Number(r.sati) || 0), 0);
  const trenutniRadnik = radnici.find((r) => r.zaposlenik.id === uredjivanje);
  const poklapaSe = trenutniRadnik && Math.abs(zbrojUnosa - trenutniRadnik.satiPrijave) < 0.01;

  // Naloge se ne filtrira — samo poredaju tako da oni koji odgovaraju kompetencijama radnika i
  // nisu završeni idu prvi. Ovo je samo pomoć pri odabiru, ne ograničenje.
  const naloziZaOdabir = (zaposlenik) => {
    const kompetencije = zaposlenik?.kompetencije || [];
    return [...db.radniNalozi].sort((a, b) => {
      const rang = (n) => (n.status === "Završen" ? 2 : kompetencije.includes(n.faza) ? 0 : 1);
      const ra = rang(a), rb = rang(b);
      return ra !== rb ? ra - rb : a.broj.localeCompare(b.broj);
    });
  };

  const spremi = () => {
    if (!poklapaSe) return;
    const validni = redoviUnos.filter((r) => r.radniNalogId && Number(r.sati) > 0);
    if (validni.length === 0) { showToast("Dodaj barem jedan redak s nalogom i satima."); return; }

    const dotaknutiStari = new Set(db.satiPoNalogu.filter((s) => s.zaposlenikId === uredjivanje && s.datum === datum).map((s) => s.radniNalogId));
    const bezStarih = db.satiPoNalogu.filter((s) => !(s.zaposlenikId === uredjivanje && s.datum === datum));
    const noviRedovi = validni.map((r) => ({ id: uid("spn"), datum, zaposlenikId: uredjivanje, radniNalogId: r.radniNalogId, sati: Number(r.sati) }));
    const noviSatiPoNalogu = [...bezStarih, ...noviRedovi];

    const sviDotaknuti = new Set([...dotaknutiStari, ...validni.map((r) => r.radniNalogId)]);
    const noviRadniNalozi = db.radniNalozi.map((n) => (sviDotaknuti.has(n.id) ? { ...n, utrosenoSati: zbrojSatiZaNalog(n.id, noviSatiPoNalogu) } : n));

    update("satiPoNalogu", noviSatiPoNalogu);
    update("radniNalozi", noviRadniNalozi);
    setUredjivanje(null);
    showToast("Sati zabilježeni.");
  };

  // Briše cijeli dnevni unos za radnika (krivo evidentirani sati) — bez provjere poklapanja, jer je
  // svrha upravo poništiti pogrešan unos, a ne uskladiti ga sa satima prijave.
  const obrisiUnosZaDan = (zaposlenikId) => {
    const dotaknuti = new Set(db.satiPoNalogu.filter((s) => s.zaposlenikId === zaposlenikId && s.datum === datum).map((s) => s.radniNalogId));
    const noviSatiPoNalogu = db.satiPoNalogu.filter((s) => !(s.zaposlenikId === zaposlenikId && s.datum === datum));
    const noviRadniNalozi = db.radniNalozi.map((n) => (dotaknuti.has(n.id) ? { ...n, utrosenoSati: zbrojSatiZaNalog(n.id, noviSatiPoNalogu) } : n));
    update("satiPoNalogu", noviSatiPoNalogu);
    update("radniNalozi", noviRadniNalozi);
    setDelZa(null);
    if (uredjivanje === zaposlenikId) setUredjivanje(null);
    showToast("Unos sati obrisan.");
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        <div className={`nav-tab ${prikaz === "dnevno" ? "active" : ""}`} onClick={() => setPrikaz("dnevno")}>Dnevni unos</div>
        <div className={`nav-tab ${prikaz === "mjesecno" ? "active" : ""}`} onClick={() => setPrikaz("mjesecno")}>Pregled po mjesecu</div>
      </div>

      {prikaz === "dnevno" && (
      <>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>Dnevni unos po radniku — birani nalozi i sati moraju se točno poklopiti sa satima iz evidencije prijave/odjave prije spremanja.</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span className="label">Dan</span>
        <input className="input f-mono" type="date" style={{ width: 160 }} value={datum} onChange={(e) => { setDatum(e.target.value); setUredjivanje(null); }} />
      </div>

      {radnici.length === 0 ? <EmptyState text="Nitko nije evidentiran kao da je radio taj dan." /> : (
        <table className="erp-table">
          <thead><tr><th>Zaposlenik</th><th style={{ width: 90 }}>Prijava</th><th style={{ width: 90 }}>Uneseno</th><th style={{ width: 110 }}>Status</th><th style={{ width: 130 }}></th></tr></thead>
          <tbody>
            {radnici.map((r) => {
              const zavrseno = r.uneseno.length > 0 && Math.abs(r.satiUneseno - r.satiPrijave) < 0.01;
              return (
                <tr key={r.zaposlenik.id}>
                  <td>{r.zaposlenik.prezime} {r.zaposlenik.ime}</td>
                  <td className="f-mono">{r.satiPrijave.toFixed(1)} h</td>
                  <td className="f-mono" style={{ color: r.uneseno.length > 0 && !zavrseno ? "var(--rust)" : "inherit" }}>{r.satiUneseno.toFixed(1)} h</td>
                  <td>{zavrseno ? <span style={{ color: "var(--green)", fontSize: 12 }}>✓ Uneseno</span> : r.uneseno.length > 0 ? <span style={{ color: "var(--rust)", fontSize: 12 }}>Ne poklapa se</span> : <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>—</span>}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {mozeMijenjati && <Btn variant="ghost" size="sm" onClick={() => otvoriUnos(r)}>{r.uneseno.length ? "Uredi" : "Unesi"}</Btn>}
                    {mozeMijenjati && r.uneseno.length > 0 && <button className="btn btn-icon btn-ghost" title="Obriši unos za ovaj dan" onClick={() => setDelZa(r.zaposlenik)}><Trash2 size={14} /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      </>
      )}

      {prikaz === "mjesecno" && (() => {
        const { nalozi, faze } = pregledMjeseca;
        const ukupnoPoNalogu = (nalogId) => nalozi.find((r) => r.nalog.id === nalogId)?.sati || 0;
        const ukupnoPoFazi = (faza) => nalozi.filter((r) => r.nalog.faza === faza).reduce((s, r) => s + r.sati, 0);
        const ukupnoSve = nalozi.reduce((s, r) => s + r.sati, 0);
        return (
          <>
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>Presjek evidentiranih sati po radnom nalogu za odabrani mjesec, grupirano po operaciji (fazi) kojoj nalog pripada. Prikazani su samo nalozi koji su taj mjesec imali unesene sate.</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span className="label">Mjesec</span>
              <input className="input f-mono" type="month" style={{ width: 160 }} value={mjesecPregled} onChange={(e) => setMjesecPregled(e.target.value)} />
            </div>
            {nalozi.length === 0 ? <EmptyState text="Nema evidentiranih sati po nalozima za odabrani mjesec." /> : (
              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table className="erp-table" style={{ minWidth: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", left: 0, background: "var(--surface-alt)", zIndex: 1 }}>Operacija</th>
                      {nalozi.map((r) => <th key={r.nalog.id} style={{ minWidth: 90 }} title={`${r.nalog.broj} — ${r.nalog.naziv}`}>{r.nalog.broj}</th>)}
                      <th style={{ minWidth: 90, background: "var(--surface-alt)" }}>Ukupno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faze.map((faza) => (
                      <tr key={faza}>
                        <td style={{ position: "sticky", left: 0, background: "var(--surface)", fontWeight: 600 }}>{faza}</td>
                        {nalozi.map((r) => (
                          <td key={r.nalog.id} className="f-mono" style={{ textAlign: "center", color: r.nalog.faza === faza ? "var(--ink)" : "var(--ink-faint)" }}>
                            {r.nalog.faza === faza ? r.sati.toFixed(1) : "—"}
                          </td>
                        ))}
                        <td className="f-mono" style={{ textAlign: "center", fontWeight: 700, background: "var(--surface-alt)" }}>{ukupnoPoFazi(faza).toFixed(1)}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 700, background: "var(--surface-alt)" }}>
                      <td style={{ position: "sticky", left: 0, background: "var(--surface-alt)" }}>UKUPNO</td>
                      {nalozi.map((r) => <td key={r.nalog.id} className="f-mono" style={{ textAlign: "center" }}>{ukupnoPoNalogu(r.nalog.id).toFixed(1)}</td>)}
                      <td className="f-mono" style={{ textAlign: "center" }}>{ukupnoSve.toFixed(1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      })()}

      {uredjivanje && trenutniRadnik && (
        <Modal wide title={`Sati po nalozima — ${zaposlenikIme(uredjivanje)} — ${fmtDate(datum)}`} onClose={() => setUredjivanje(null)}
          footer={<><Btn onClick={() => setUredjivanje(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi} disabled={!poklapaSe}>Spremi</Btn></>}>
          <table className="erp-table" style={{ marginBottom: 10 }}>
            <thead><tr><th>Radni nalog</th><th style={{ width: 100 }}>Sati</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {redoviUnos.map((r, i) => (
                <tr key={i}>
                  <td>
                    <select className="select" value={r.radniNalogId} onChange={(e) => azurirajRedak(i, { radniNalogId: e.target.value })}>
                      <option value="">— odaberi —</option>
                      {naloziZaOdabir(trenutniRadnik.zaposlenik).map((n) => (
                        <option key={n.id} value={n.id}>{(trenutniRadnik.zaposlenik.kompetencije || []).includes(n.faza) ? "★ " : ""}{n.broj} — {n.naziv} ({n.faza})</option>
                      ))}
                    </select>
                  </td>
                  <td><input className="input f-mono" type="number" min="0" step="0.5" value={r.sati} onChange={(e) => azurirajRedak(i, { sati: e.target.value })} /></td>
                  <td><button className="btn btn-icon btn-ghost" onClick={() => obrisiRedak(i)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Btn variant="ghost" size="sm" icon={Plus} onClick={dodajRedak}>Dodaj redak</Btn>

          <div className="card" style={{ padding: 12, marginTop: 14, background: poklapaSe ? "#EAF6EF" : "#FBEAE6", border: `1px solid ${poklapaSe ? "#B9E3C9" : "#F0C2B5"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Uneseno: <strong className="f-mono">{zbrojUnosa.toFixed(1)} h</strong></span>
              <span>Prijava (evidencija): <strong className="f-mono">{trenutniRadnik.satiPrijave.toFixed(1)} h</strong></span>
            </div>
            {!poklapaSe && <div style={{ fontSize: 12, color: "var(--rust)", marginTop: 6 }}>Razlika {Math.abs(zbrojUnosa - trenutniRadnik.satiPrijave).toFixed(1)} h — mora se točno poklopiti prije spremanja.</div>}
          </div>
        </Modal>
      )}

      {delZa && (
        <ConfirmDelete label={`unos sati za ${zaposlenikIme(delZa.id)} — ${fmtDate(datum)}`} onCancel={() => setDelZa(null)} onConfirm={() => obrisiUnosZaDan(delZa.id)} />
      )}
    </div>
  );
}

function ZaposleniciPage({ db, update, showToast, refetchKljuc, patchEvidencija, mojaPozicija }) {
  const dozvKartice = dozvoljeneKarticeModula(mojaPozicija, "zaposlenici");
  const [tab, setTab] = useState(dozvKartice[0]?.key || "zaposlenici");
  useEffect(() => { if (!dozvKartice.some((k) => k.key === tab)) setTab(dozvKartice[0]?.key || "zaposlenici"); }, [dozvKartice, tab]);
  const mozeZaposlenici = dozvolaZaKarticu(mojaPozicija, "zaposlenici", "zaposlenici").izmjene;
  const mozePozicije = dozvolaZaKarticu(mojaPozicija, "zaposlenici", "pozicije").izmjene;
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [lozinkaZa, setLozinkaZa] = useState(null);

  const emptyZap = { ime: "", prezime: "", pozicijaId: db.pozicijeZaposlenika[0]?.id || "", email: "", telefon: "", status: "Aktivan", datumZaposlenja: todayISO(), kompetencije: [], rfidKod: "", bodovi: 0, udaljenostKm: 0, koristiPrehranuUTvrtki: false, satnicaKooperant: 0, fiksniMjesecniIznos: 0, naknadaPrijevoz: 0, maticniBroj: "", dodatniStazGodine: 0, radnoVrijeme: "puno" };
  const [zapForm, setZapForm] = useState(emptyZap);

  const emptyPoz = { naziv: "", opis: "", moduli: [], karticeDozvole: {} };
  const [pozForm, setPozForm] = useState(emptyPoz);

  const pozicijaNaziv = (id) => db.pozicijeZaposlenika.find((p) => p.id === id)?.naziv || "—";
  const brojZaposlenihNaPoziciji = (pozicijaId) => db.zaposlenici.filter((z) => z.pozicijaId === pozicijaId).length;

  const saveZap = () => {
    if (!zapForm.ime.trim() || !zapForm.prezime.trim()) return;
    if (zapForm.id) {
      update("zaposlenici", db.zaposlenici.map((z) => (z.id === zapForm.id ? zapForm : z)));
      setModal(null);
      showToast("Zaposlenik spremljen.");
    } else {
      const noviId = uid("zap");
      update("zaposlenici", [...db.zaposlenici, { ...zapForm, id: noviId }]);
      setModal(null);
      showToast("Zaposlenik dodan — postavi mu lozinku za prijavu (gumb \"Lozinka\" u tablici).");
    }
  };
  const savePoz = () => {
    if (!pozForm.naziv.trim()) return;
    if (pozForm.id) update("pozicijeZaposlenika", db.pozicijeZaposlenika.map((p) => (p.id === pozForm.id ? pozForm : p)));
    else update("pozicijeZaposlenika", [...db.pozicijeZaposlenika, { ...pozForm, id: uid("poz") }]);
    setModal(null);
    showToast("Pozicija spremljena.");
  };
  const toggleModul = (key) => {
    setPozForm((f) => ({ ...f, moduli: f.moduli.includes(key) ? f.moduli.filter((m) => m !== key) : [...f.moduli, key] }));
  };
  // Po zadanom (kad admin ništa ne dira) modul dodijeljen poziciji daje pun pristup i pravo
  // izmjene svim svojim karticama — karticeDozvole ovdje samo bilježi eksplicitna SUŽENJA.
  const postaviKarticu = (modulKey, karticaKey, polje, vrijednost) => {
    setPozForm((f) => {
      const trenutno = f.karticeDozvole?.[modulKey]?.[karticaKey] || {};
      const nova = { ...trenutno, [polje]: vrijednost };
      if (polje === "pristup" && !vrijednost) nova.izmjene = false;
      return { ...f, karticeDozvole: { ...(f.karticeDozvole || {}), [modulKey]: { ...(f.karticeDozvole?.[modulKey] || {}), [karticaKey]: nova } } };
    });
  };

  return (
    <div>
      <PageHeader title="Zaposlenici" icon={UserCog} subtitle="Zaposlenici, pozicije u tvrtki i ograničenja pristupa aplikaciji" />
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        {dozvKartice.some((k) => k.key === "zaposlenici") && <div className={`nav-tab ${tab === "zaposlenici" ? "active" : ""}`} onClick={() => setTab("zaposlenici")}>Zaposlenici</div>}
        {dozvKartice.some((k) => k.key === "pozicije") && <div className={`nav-tab ${tab === "pozicije" ? "active" : ""}`} onClick={() => setTab("pozicije")}>Pozicije</div>}
        {dozvKartice.some((k) => k.key === "evidencija") && <div className={`nav-tab ${tab === "evidencija" ? "active" : ""}`} onClick={() => setTab("evidencija")}>Evidencija rada</div>}
        {dozvKartice.some((k) => k.key === "obracun") && <div className={`nav-tab ${tab === "obracun" ? "active" : ""}`} onClick={() => setTab("obracun")}>Obračun plaća</div>}
        {dozvKartice.some((k) => k.key === "satinalozi") && <div className={`nav-tab ${tab === "satinalozi" ? "active" : ""}`} onClick={() => setTab("satinalozi")}>Sati po nalozima</div>}
      </div>

      {tab === "zaposlenici" && (
        <>
          {db.zaposlenici.some((z) => !z.lozinkaHash) && (
            <div className="card" style={{ padding: "10px 14px", marginBottom: 14, background: "#FDF6E3", borderColor: "#F0C36B", display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={15} color="#8A6100" />
              <span style={{ fontSize: 12.5, color: "#6b5511" }}><strong>{db.zaposlenici.filter((z) => !z.lozinkaHash).length}</strong> zaposlenika još nema postavljenu jaku lozinku (koriste stari PIN ili nemaju nikakvu) — postavi im lozinku gumbom "Lozinka" u tablici.</span>
            </div>
          )}
          <EntityPage
            title="" data={[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr"))}
            grupiraj={(z) => grupaEvidencije(z, db.pozicijeZaposlenika)}
            redoslijedGrupa={["radiona", "praktikant", "ostalo", "kooperant"]}
            nazivGrupe={(k) => ({ radiona: "Radiona", praktikant: "Praktikanti", ostalo: "Tehnički ured i administracija", kooperant: "Kooperanti" }[k])}
            onAdd={() => { setZapForm(emptyZap); setModal("zap"); }}
            onEdit={(row) => { setZapForm({ ...emptyZap, ...row, kompetencije: row.kompetencije || [], rfidKod: row.rfidKod || "" }); setModal("zap"); }}
            onDelete={(r) => setDel({ type: "zap", row: r })}
            addLabel="Novi zaposlenik" searchKeys={["ime", "prezime", "email"]} readOnly={!mozeZaposlenici}
            columns={[
              { key: "prezime", label: "Prezime i ime", render: (r) => <strong>{r.prezime} {r.ime}</strong> },
              { key: "pozicija", label: "Pozicija", render: (r) => pozicijaNaziv(r.pozicijaId) },
              { key: "email", label: "E-mail" },
              { key: "telefon", label: "Telefon" },
              { key: "lozinka", label: "Lozinka", render: (r) => (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: r.lozinkaHash ? "var(--green)" : "var(--rust)" }}>{r.lozinkaHash ? "✓ Postavljena" : "Stari/nema PIN"}</span>
                  <Btn variant="ghost" size="sm" onClick={() => setLozinkaZa(r)}>Lozinka</Btn>
                </div>
              ) },
              { key: "kompetencije", label: "Kompetencije", render: (r) => (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, maxWidth: 220 }}>
                  {(r.kompetencije || []).length === 0 ? <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>—</span> : r.kompetencije.map((k) => <span key={k} className="badge badge-muted" style={{ fontSize: 9.5 }}>{k}</span>)}
                </div>
              ) },
              { key: "datumZaposlenja", label: "Zaposlen od", render: (r) => fmtDate(r.datumZaposlenja) },
              { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            ]}
          />
        </>
      )}


      {tab === "pozicije" && (
        <>
          <div style={{ marginBottom: 12, fontSize: 13, color: "var(--ink-soft)" }}>
            Svaka pozicija određuje kojim modulima i karticama unutar njih zaposlenik na toj poziciji smije pristupiti, te smije li u svakoj kartici i mijenjati podatke ili samo gledati. Ovo je stvarno tehničko ograničenje — provodi ga backend na svakom čitanju i upisu podataka, ne samo sučelje.
          </div>
          <EntityPage
            title="" data={db.pozicijeZaposlenika}
            onAdd={() => { setPozForm(emptyPoz); setModal("poz"); }}
            onEdit={(row) => { setPozForm({ ...emptyPoz, ...row }); setModal("poz"); }}
            onDelete={(r) => setDel({ type: "poz", row: r })}
            addLabel="Nova pozicija" searchKeys={["naziv"]} readOnly={!mozePozicije}
            columns={[
              { key: "naziv", label: "Naziv pozicije" },
              { key: "opis", label: "Opis" },
              { key: "moduli", label: "Dopušteni moduli", render: (r) => (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(r.moduli || []).map((m) => <span key={m} className="badge badge-info">{MODULI_APLIKACIJE.find((mm) => mm.key === m)?.label || m}</span>)}
                </div>
              ) },
              { key: "broj", label: "Zaposlenika", render: (r) => <span className="f-mono">{brojZaposlenihNaPoziciji(r.id)}</span> },
            ]}
          />
        </>
      )}

      {tab === "evidencija" && <EvidencijaTab db={db} update={update} patchEvidencija={patchEvidencija} showToast={showToast} mozeMijenjati={dozvolaZaKarticu(mojaPozicija, "zaposlenici", "evidencija").izmjene} />}

      {tab === "obracun" && <ObracunPlacaTab db={db} update={update} showToast={showToast} mozeMijenjati={dozvolaZaKarticu(mojaPozicija, "zaposlenici", "obracun").izmjene} />}
      {tab === "satinalozi" && <SatiPoNalozimaTab db={db} update={update} showToast={showToast} mozeMijenjati={dozvolaZaKarticu(mojaPozicija, "zaposlenici", "satinalozi").izmjene} />}

      {modal === "zap" && (
        <Modal title={zapForm.id ? "Uredi zaposlenika" : "Novi zaposlenik"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={saveZap}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Ime"><input className="input" value={zapForm.ime} onChange={(e) => setZapForm({ ...zapForm, ime: e.target.value })} /></Field>
            <Field label="Prezime"><input className="input" value={zapForm.prezime} onChange={(e) => setZapForm({ ...zapForm, prezime: e.target.value })} /></Field>
          </div>
          <Field label="Pozicija u tvrtki">
            <select className="select" value={zapForm.pozicijaId} onChange={(e) => setZapForm({ ...zapForm, pozicijaId: e.target.value })}>
              {db.pozicijeZaposlenika.map((p) => <option key={p.id} value={p.id}>{p.naziv}</option>)}
            </select>
          </Field>
          {zapForm.pozicijaId && (
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: -8, marginBottom: 14 }}>
              Dopušteni moduli za ovu poziciju: {(db.pozicijeZaposlenika.find((p) => p.id === zapForm.pozicijaId)?.moduli || []).map((m) => MODULI_APLIKACIJE.find((mm) => mm.key === m)?.label).join(", ") || "nijedan"}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="E-mail"><input className="input" value={zapForm.email} onChange={(e) => setZapForm({ ...zapForm, email: e.target.value })} /></Field>
            <Field label="Telefon"><input className="input" value={zapForm.telefon} onChange={(e) => setZapForm({ ...zapForm, telefon: e.target.value })} /></Field>
            <Field label="Status"><select className="select" value={zapForm.status} onChange={(e) => setZapForm({ ...zapForm, status: e.target.value })}><option>Aktivan</option><option>Neaktivan</option></select></Field>
            <Field label="Zaposlen od"><input className="input" type="date" value={zapForm.datumZaposlenja} onChange={(e) => setZapForm({ ...zapForm, datumZaposlenja: e.target.value })} /></Field>
            <Field label="Matični broj"><input className="input f-mono" value={zapForm.maticniBroj || ""} onChange={(e) => setZapForm({ ...zapForm, maticniBroj: e.target.value })} /></Field>
            <Field label="Dodatni staž iz prijašnjeg zaposlenja (godine)">
              <input className="input f-mono" type="number" min="0" step="1" value={zapForm.dodatniStazGodine ?? 0} onChange={(e) => setZapForm({ ...zapForm, dodatniStazGodine: e.target.value === "" ? 0 : Number(e.target.value) })} />
            </Field>
            <Field label="Radno vrijeme">
              <select className="select" value={zapForm.radnoVrijeme || "puno"} onChange={(e) => setZapForm({ ...zapForm, radnoVrijeme: e.target.value })}>
                <option value="puno">Puno radno vrijeme</option>
                <option value="pola">Pola radnog vremena</option>
              </select>
            </Field>
            {db.pozicijeZaposlenika.find((p) => p.id === zapForm.pozicijaId)?.naziv?.trim().toLowerCase() === "kooperant" ? (
              <Field label="Satnica kooperanta (€/h)"><input className="input f-mono" type="number" min="0" step="0.5" value={zapForm.satnicaKooperant ?? 0} onChange={(e) => setZapForm({ ...zapForm, satnicaKooperant: e.target.value === "" ? 0 : Number(e.target.value) })} /></Field>
            ) : db.pozicijeZaposlenika.find((p) => p.id === zapForm.pozicijaId)?.naziv?.trim().toLowerCase() === "vanjski suradnik" ? (
              <>
                <Field label="Fiksni mjesečni iznos (€)"><input className="input f-mono" type="number" min="0" step="1" value={zapForm.fiksniMjesecniIznos ?? 0} onChange={(e) => setZapForm({ ...zapForm, fiksniMjesecniIznos: e.target.value === "" ? 0 : Number(e.target.value) })} /></Field>
                <Field label="Naknada za prijevoz (€, fiksno mjesečno)"><input className="input f-mono" type="number" min="0" step="1" value={zapForm.naknadaPrijevoz ?? 0} onChange={(e) => setZapForm({ ...zapForm, naknadaPrijevoz: e.target.value === "" ? 0 : Number(e.target.value) })} /></Field>
              </>
            ) : (
              <Field label="Bodovi (za satnicu)"><input className="input f-mono" type="number" min="0" value={zapForm.bodovi ?? 0} onChange={(e) => setZapForm({ ...zapForm, bodovi: e.target.value === "" ? 0 : Number(e.target.value) })} /></Field>
            )}
            <Field label="Udaljenost do posla (km, jedan smjer)"><input className="input f-mono" type="number" min="0" value={zapForm.udaljenostKm ?? 0} onChange={(e) => setZapForm({ ...zapForm, udaljenostKm: e.target.value === "" ? 0 : Number(e.target.value) })} /></Field>
            <Field label="Prehrana">
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, cursor: "pointer" }}>
                <input type="checkbox" checked={!!zapForm.koristiPrehranuUTvrtki} onChange={(e) => setZapForm({ ...zapForm, koristiPrehranuUTvrtki: e.target.checked })} />
                <span style={{ fontSize: 12.5 }}>Koristi prehranu u tvrtki (nema toplog obroka)</span>
              </label>
            </Field>
            {zapForm.id && (
              <Field label="Lozinka za prijavu">
                <div style={{ display: "flex", alignItems: "center", gap: 8, height: 36 }}>
                  <span style={{ fontSize: 11.5, color: zapForm.lozinkaHash ? "var(--green)" : "var(--rust)" }}>{zapForm.lozinkaHash ? "✓ Postavljena" : "Stari/nema PIN"}</span>
                  <Btn variant="ghost" size="sm" onClick={() => setLozinkaZa(zapForm)}>Promijeni lozinku</Btn>
                </div>
              </Field>
            )}
            <Field label="RFID/kiosk kod (za NFC karticu)">
              <div style={{ display: "flex", gap: 6 }}>
                <input className="input f-mono" style={{ textTransform: "uppercase" }} value={zapForm.rfidKod || ""} onChange={(e) => setZapForm({ ...zapForm, rfidKod: e.target.value.toUpperCase() })} />
                <Btn variant="ghost" size="sm" onClick={() => setZapForm({ ...zapForm, rfidKod: generirajRfidKod(zapForm.ime || "Z", zapForm.prezime || "ZZZ", db.zaposlenici.filter((z) => z.id !== zapForm.id).map((z) => z.rfidKod)) })}>Generiraj</Btn>
              </div>
            </Field>
          </div>
          {zapForm.rfidKod && (
            <div className="card" style={{ padding: 10, marginBottom: 14, background: "var(--surface-alt)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                Kiosk link za programiranje NFC kartice:<br />
                <span className="f-mono" style={{ fontSize: 11, color: "var(--ink)" }}>{`${window.location.origin}${window.location.pathname}?rfid=${zapForm.rfidKod}`}</span>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}?rfid=${zapForm.rfidKod}`); showToast("Link kopiran."); }}>Kopiraj link</Btn>
            </div>
          )}
          <Field label="Kompetencije — poslovi/faze proizvodnje koje ova osoba smije raditi">
            <div className="card" style={{ padding: 10, background: "var(--surface-alt)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {FAZE.filter((f) => f !== "Ostalo").map((f) => (
                  <label key={f} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, cursor: "pointer" }}>
                    <input
                      type="checkbox" checked={(zapForm.kompetencije || []).includes(f)}
                      onChange={() => setZapForm({ ...zapForm, kompetencije: (zapForm.kompetencije || []).includes(f) ? zapForm.kompetencije.filter((k) => k !== f) : [...(zapForm.kompetencije || []), f] })}
                    />
                    {f}
                  </label>
                ))}
              </div>
            </div>
          </Field>
        </Modal>
      )}

      {modal === "poz" && (
        <Modal title={pozForm.id ? "Uredi poziciju" : "Nova pozicija"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={savePoz}>Spremi</Btn></>}>
          <Field label="Naziv pozicije"><input className="input" placeholder="npr. Voditelj proizvodnje" value={pozForm.naziv} onChange={(e) => setPozForm({ ...pozForm, naziv: e.target.value })} /></Field>
          <Field label="Opis"><textarea className="textarea" rows={2} value={pozForm.opis} onChange={(e) => setPozForm({ ...pozForm, opis: e.target.value })} /></Field>
          <Field label="Ograničenja za aplikaciju — moduli i kartice">
            <p style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: -4, marginBottom: 8 }}>
              Uključi modul da bude vidljiv poziciji. Svaka kartica unutar modula ima svoju kvačicu za pristup (vidljivost) i posebno za izmjene (upis) — po zadanom su obje uključene čim je modul uključen.
            </p>
            <div className="card" style={{ padding: 10, background: "var(--surface-alt)" }}>
              {MODULI_APLIKACIJE.map((m) => {
                const otvoren = pozForm.moduli.includes(m.key);
                return (
                  <div key={m.key} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--line)" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      <input type="checkbox" checked={otvoren} onChange={() => toggleModul(m.key)} />
                      <m.icon size={14} color="var(--ink-soft)" /> {m.label}
                    </label>
                    {otvoren && (
                      <div style={{ marginLeft: 25, marginTop: 8, display: "grid", gap: 6 }}>
                        {(KARTICE_MODULA[m.key]?.kartice || []).map((k) => {
                          const { pristup, izmjene } = dozvolaZaKarticu(pozForm, m.key, k.key);
                          return (
                            <div key={k.key} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12 }}>
                              <span style={{ flex: 1, color: "var(--ink-soft)" }}>{k.naziv}</span>
                              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                                <input type="checkbox" checked={pristup} onChange={(e) => postaviKarticu(m.key, k.key, "pristup", e.target.checked)} /> Pristup
                              </label>
                              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: pristup ? "pointer" : "not-allowed", opacity: pristup ? 1 : 0.4 }}>
                                <input type="checkbox" checked={izmjene} disabled={!pristup} onChange={(e) => postaviKarticu(m.key, k.key, "izmjene", e.target.checked)} /> Izmjene
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Field>
        </Modal>
      )}

      {del && (
        <ConfirmDelete
          label={del.type === "zap" ? `${del.row.ime} ${del.row.prezime}` : del.row.naziv}
          onCancel={() => setDel(null)}
          onConfirm={() => {
            if (del.type === "zap") update("zaposlenici", db.zaposlenici.filter((z) => z.id !== del.row.id));
            else update("pozicijeZaposlenika", db.pozicijeZaposlenika.filter((p) => p.id !== del.row.id));
            setDel(null);
            showToast("Stavka obrisana.");
          }}
        />
      )}
      {lozinkaZa && <PostaviLozinkuModal zaposlenik={lozinkaZa} showToast={showToast} refetchKljuc={refetchKljuc} onClose={() => setLozinkaZa(null)} />}
    </div>
  );
}

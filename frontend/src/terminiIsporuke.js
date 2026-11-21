// Termini isporuke projekta: projekt može imati VIŠE rokova isporuke kupcu, svaki s vlastitim stavkama i količinama iz narudžbi kupca
// (npr. dio do 30.11., ostatak do 8.12.). Čiste funkcije nad podacima — testirano u terminiIsporuke.test.js.
//   projekt.termini = [{ id, datum, naziv, napomena, stavke: [{ narudzbaStavkaId, komada }], dio?, rucnoIsporuceno? }]
//   • stavke → količine iz narudžbi kupca projekta (narudzbe[].stavke[].id); isporučeno se računa iz otpremnica (kao u podlogama za fakturu)
//   • dio (neobavezno) → veza s dijelom projekta u planu: "osnovna" ili id dodatka (projekt.dodaci); tad rok tog dijela u planu = datum termina
//   • rucnoIsporuceno → samo za termin BEZ stavki (projekt bez narudžbe): ručna oznaka da je isporučeno
//   • projekt.rokZavrsetka ostaje i automatski je jednak zadnjem terminu (rokIzTermina), pa sve što ga čita radi kao i dosad
// Isporučeno po stavci raspoređuje se na termine KRONOLOŠKI (najraniji termin prvi): otpremnice ne moraju znati kojem terminu pripadaju.

const kol = (v) => Number(v) || 0;
const zaokruzi = (v) => Math.round(v * 1000) / 1000;
const ms = (iso) => { const [g, m, d] = String(iso).slice(0, 10).split("-").map(Number); return Date.UTC(g, m - 1, d); };
export const danaIzmedu = (od, doDatuma) => (od && doDatuma ? Math.round((ms(doDatuma) - ms(od)) / 86400000) : null);

export const imaTermine = (p) => Array.isArray(p?.termini) && p.termini.length > 0;
export const sortiraniTermini = (termini) => [...(termini || [])].sort((a, b) => String(a.datum || "9999-99-99").localeCompare(String(b.datum || "9999-99-99")) || String(a.naziv || "").localeCompare(String(b.naziv || ""), "hr"));

// Zadnji (najkasniji) datum termina — rok završetka projekta.
export const rokIzTermina = (termini) => (termini || []).map((t) => t.datum).filter(Boolean).sort().pop() || null;

// Stavke narudžbi kupca projekta: [{ id, narudzbaId, narudzbaBroj, naziv, sifra, jm, kolicina, masaJed, cijena }]
export function stavkeNarudzbi(projektId, narudzbe) {
  const r = [];
  (narudzbe || []).filter((n) => n.projektId === projektId).forEach((n) => (n.stavke || []).forEach((s) => r.push({ id: s.id, narudzbaId: n.id, narudzbaBroj: n.broj, naziv: s.naziv, sifra: s.sifra || "", jm: s.jm || "", kolicina: kol(s.kolicina), masaJed: kol(s.masaJed), cijena: kol(s.cijena) })));
  return r;
}

// Isporučeno kupcu po stavci narudžbe: Map(stavkaId → komada) iz otpremnica (ne kooperantu). Veza stavke otpremnice i narudžbe kao u podlogama za fakturu:
// po narudzbaStavkaId, inače po nazivu unutar narudžbe otpremnice (ili prve narudžbe projekta).
export function isporucenoPoStavciNarudzbe(projektId, narudzbe, otpremnice) {
  const nar = (narudzbe || []).filter((n) => n.projektId === projektId);
  const sve = nar.flatMap((n) => n.stavke || []);
  const m = new Map();
  (otpremnice || []).filter((o) => o.projektId === projektId && o.vrsta !== "kooperant").forEach((o) => {
    const narudzba = nar.find((n) => n.id === o.narudzbaId) || nar[0];
    (o.stavke || []).forEach((st) => {
      const k = kol(st.kolicina);
      if (k <= 0) return;
      const nst = sve.find((x) => x.id && x.id === st.narudzbaStavkaId) || narudzba?.stavke?.find((x) => x.naziv === st.naziv);
      if (nst) m.set(nst.id, (m.get(nst.id) || 0) + k);
    });
  });
  return m;
}

// Stanje svih termina projekta (po datumu): za svaki redovi po stavkama (planirano / isporučeno), postotak, masa i status
// ("isporuceno" | "kasni" | "djelomicno" | "ceka"). Uz to: bezTermina (stavke čiji dio nije ni u jednom terminu ni isporučen) i prekoraceno
// (u terminima je više nego što je naručeno).
export function stanjaTermina({ projekt, narudzbe, otpremnice, danas }) {
  const stavke = stavkeNarudzbi(projekt.id, narudzbe);
  const poId = new Map(stavke.map((s) => [s.id, s]));
  const isporuceno = isporucenoPoStavciNarudzbe(projekt.id, narudzbe, otpremnice);
  const slobodnoIsporuceno = new Map(isporuceno);
  const planiranoPoStavci = new Map();
  const termini = sortiraniTermini(projekt.termini).map((t) => {
    const redovi = (t.stavke || []).filter((x) => kol(x.komada) > 0).map((x) => {
      const s = poId.get(x.narudzbaStavkaId);
      const planirano = kol(x.komada);
      const dostupno = slobodnoIsporuceno.get(x.narudzbaStavkaId) || 0;
      const isp = Math.min(planirano, dostupno);
      slobodnoIsporuceno.set(x.narudzbaStavkaId, dostupno - isp);
      planiranoPoStavci.set(x.narudzbaStavkaId, (planiranoPoStavci.get(x.narudzbaStavkaId) || 0) + planirano);
      return { stavkaId: x.narudzbaStavkaId, naziv: s?.naziv || "(stavka više ne postoji u narudžbi)", sifra: s?.sifra || "", jm: s?.jm || "", planirano, isporuceno: zaokruzi(isp), masaJed: s?.masaJed || 0, cijena: s?.cijena || 0, nepoznata: !s };
    });
    const planiranoUk = zaokruzi(redovi.reduce((a, r) => a + r.planirano, 0));
    const isporucenoUk = zaokruzi(redovi.reduce((a, r) => a + r.isporuceno, 0));
    const masa = redovi.reduce((a, r) => a + r.planirano * r.masaJed, 0);
    const masaOtvorena = redovi.reduce((a, r) => a + (r.planirano - r.isporuceno) * r.masaJed, 0);
    const komadaOtvoreno = redovi.reduce((a, r) => a + (r.planirano - r.isporuceno), 0);
    const gotov = redovi.length > 0 ? redovi.every((r) => r.isporuceno >= r.planirano - 1e-9) : !!t.rucnoIsporuceno;
    const kasni = !!t.datum && !!danas && t.datum < danas;
    const status = gotov ? "isporuceno" : kasni ? "kasni" : isporucenoUk > 0 ? "djelomicno" : "ceka";
    return {
      termin: t, redovi, planirano: planiranoUk, isporuceno: isporucenoUk, posto: planiranoUk > 0 ? Math.round((isporucenoUk / planiranoUk) * 100) : (gotov ? 100 : 0),
      masa: zaokruzi(masa), tezinaOtvorena: masaOtvorena > 0 ? masaOtvorena : komadaOtvoreno > 0 ? komadaOtvoreno : 0, status, dana: t.datum && danas ? danaIzmedu(danas, t.datum) : null,
    };
  });
  const bezTermina = [];
  const prekoraceno = [];
  stavke.forEach((s) => {
    const planirano = planiranoPoStavci.get(s.id) || 0;
    const pokriveno = Math.max(planirano, isporuceno.get(s.id) || 0);
    if (s.kolicina - pokriveno > 1e-9) bezTermina.push({ stavka: s, kolicina: zaokruzi(s.kolicina - pokriveno) });
    if (planirano - s.kolicina > 1e-9) prekoraceno.push({ stavka: s, visak: zaokruzi(planirano - s.kolicina) });
  });
  return { termini, bezTermina, prekoraceno, stavke };
}

// Prvi neisporučeni termin (kad su svi isporučeni — zadnji); null ako projekt nema termina.
export function sljedeciTermin(stanja) {
  const t = stanja?.termini || [];
  return t.find((x) => x.status !== "isporuceno") || t[t.length - 1] || null;
}

// Projekt kakvim ga vide pregledi rokova (nadzorna ploča, Rokovi i statusi, Direktorski pregled): rokZavrsetka = rok sljedećeg neisporučenog termina,
// pa "kasni" znači da je rok TOG termina prošao. Stvarni rok projekta ostaje u rokProjekta; sljedeciTermin nosi naziv, redni broj i status.
// opcije.bezPodatakaOIsporuci: korisnik koji ne vidi narudžbe i otpremnice (npr. nadzorna ploča) — ne zna što je isporučeno, pa je sljedeći termin prvi s datumom
// od danas nadalje (ako ih nema, zadnji): prošli termini ne daju lažno "kasni".
export function projektSEfektivnimRokom(projekt, narudzbe, otpremnice, danas, opcije = {}) {
  if (!imaTermine(projekt)) return projekt;
  const stanja = stanjaTermina({ projekt, narudzbe, otpremnice, danas });
  const s = opcije.bezPodatakaOIsporuci ? (stanja.termini.find((x) => !x.termin.datum || x.termin.datum >= danas) || stanja.termini[stanja.termini.length - 1]) : sljedeciTermin(stanja);
  if (!s) return projekt;
  return { ...projekt, rokProjekta: projekt.rokZavrsetka, rokZavrsetka: s.termin.datum || projekt.rokZavrsetka, sljedeciTermin: { id: s.termin.id, naziv: s.termin.naziv || "", redni: stanja.termini.indexOf(s) + 1, ukupno: stanja.termini.length, status: s.status, datum: s.termin.datum } };
}

// Rokovi dijelova projekta koji imaju dodatke: Map("osnovna" | dodatakId → datum) iz termina povezanih s dijelom (termin.dio). Plan koristi taj datum umjesto roka dodatka.
export function rokoviDijelova(projekt) {
  const m = new Map();
  (projekt?.termini || []).forEach((t) => { if (t.dio && t.datum) { const stari = m.get(t.dio); if (!stari || t.datum > stari) m.set(t.dio, t.datum); } });
  return m;
}

// Plan proizvodnje: poslovi po terminima za projekt BEZ dodataka. nalozi = otvoreni nalozi projekta ({ id, broj, faza, operacija, planiranoSati, utrosenoSati, status, terminId? }).
// Nalog dodijeljen terminu (terminId) ide cijeli u njega; ostali se dijele na OTVORENE termine razmjerno težini neisporučenog dijela (masa, inače komadi, inače jednako).
// Podijeljeni nalog dobiva virtualni id `${nalog.id}|${termin.id}` sa satima razmjerno udjelu. Vraća [{ terminId, naziv, datum, nalozi: [{ id, broj, faza, operacija, plan, utroseno, status }] }].
export function posloviPoTerminima({ stanja, nalozi }) {
  const termini = stanja.termini || [];
  if (!termini.length) return [];
  let otvoreni = termini.filter((t) => t.status !== "isporuceno");
  if (!otvoreni.length) otvoreni = [termini[termini.length - 1]]; // sve isporučeno, a ima otvorenih naloga: zadnji termin
  const zbroj = otvoreni.reduce((a, t) => a + t.tezinaOtvorena, 0);
  const udio = (t) => (zbroj > 0 ? t.tezinaOtvorena / zbroj : 1 / otvoreni.length);
  const poslovi = otvoreni.map((t) => ({ terminId: t.termin.id, naziv: t.termin.naziv || "", datum: t.termin.datum, nalozi: [] }));
  const posao = (terminId) => poslovi.find((p) => p.terminId === terminId);
  (nalozi || []).forEach((n) => {
    const plan = kol(n.planiranoSati), utroseno = kol(n.utrosenoSati);
    const mjera = (id, p, u) => ({ id, broj: n.broj, faza: n.faza, operacija: n.operacija, plan: p, utroseno: u, status: n.status });
    const dodijeljen = n.terminId && posao(n.terminId);
    if (dodijeljen) { dodijeljen.nalozi.push(mjera(n.id, plan, utroseno)); return; }
    if (poslovi.length === 1) { poslovi[0].nalozi.push(mjera(n.id, plan, utroseno)); return; }
    otvoreni.forEach((t) => {
      const u = udio(t);
      if (u <= 0) return;
      posao(t.termin.id).nalozi.push(mjera(`${n.id}|${t.termin.id}`, zaokruzi(plan * u), zaokruzi(utroseno * u)));
    });
  });
  return poslovi.filter((p) => p.nalozi.length > 0);
}

// ---------- Kalendar isporuka ----------
export const pocetakTjedna = (iso) => { const d = new Date(ms(iso)); const dan = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dan); return d.toISOString().slice(0, 10); };
export const dodajDane = (iso, n) => new Date(ms(iso) + n * 86400000).toISOString().slice(0, 10);

const STATUSI_U_KALENDARU = ["Odobren", "U izradi", "Montaža"];
const kratkiOpisStavki = (redovi) => redovi.map((r) => `${r.sifra || r.naziv} × ${r.planirano}`).join(", ");

// Redovi kalendara: termini aktivnih projekata; projekt bez termina daje jedan red s rokom projekta, a tipski projekt (kupaonice) po jedan red za svaki
// datum iz rasporeda isporuka. Svaki red: { projektId, sifra, naziv, kupacId, voditeljId, datum, naziv termina, izvor, status, opis, planirano, isporuceno, masa, redni, ukupno }.
export function redoviKalendara({ projekti, narudzbe, otpremnice, danas }) {
  const redovi = [];
  (projekti || []).filter((p) => STATUSI_U_KALENDARU.includes(p.status)).forEach((p) => {
    const osnova = { projektId: p.id, sifra: p.sifra, naziv: p.naziv, kupacId: p.kupacId, voditeljId: p.voditeljId };
    if (imaTermine(p)) {
      const st = stanjaTermina({ projekt: p, narudzbe, otpremnice, danas });
      st.termini.forEach((t, i) => redovi.push({ ...osnova, terminId: t.termin.id, datum: t.termin.datum || "", nazivTermina: t.termin.naziv || `${i + 1}. isporuka`, izvor: "termin", status: t.status, opis: t.redovi.length ? kratkiOpisStavki(t.redovi) : (t.termin.napomena || ""), planirano: t.planirano, isporuceno: t.isporuceno, masa: t.masa, redni: i + 1, ukupno: st.termini.length }));
      return;
    }
    if (p.koristiNormativ && (p.isporuke || []).some((i) => i.datum)) {
      const poDatumu = new Map();
      (p.isporuke || []).filter((i) => i.datum).forEach((i) => { const a = poDatumu.get(i.datum) || { komada: 0, isporuceno: 0 }; a.komada += kol(i.komada); if (i.isporuceno || i.uOtpremniciId) a.isporuceno += kol(i.komada); poDatumu.set(i.datum, a); });
      const datumi = [...poDatumu.keys()].sort();
      datumi.forEach((d, i) => {
        const a = poDatumu.get(d);
        const gotov = a.isporuceno >= a.komada;
        redovi.push({ ...osnova, terminId: null, datum: d, nazivTermina: "Isporuka kupaonica", izvor: "kupaonice", status: gotov ? "isporuceno" : d < danas ? "kasni" : a.isporuceno > 0 ? "djelomicno" : "ceka", opis: `${a.komada} kom`, planirano: a.komada, isporuceno: a.isporuceno, masa: 0, redni: i + 1, ukupno: datumi.length });
      });
      return;
    }
    if (p.rokZavrsetka) redovi.push({ ...osnova, terminId: null, datum: p.rokZavrsetka, nazivTermina: "Rok projekta", izvor: "rok", status: p.rokZavrsetka < danas ? "kasni" : "ceka", opis: "", planirano: 0, isporuceno: 0, masa: 0, redni: 1, ukupno: 1 });
  });
  return redovi.sort((a, b) => String(a.datum || "9999").localeCompare(String(b.datum || "9999")) || String(a.sifra).localeCompare(String(b.sifra), "hr", { numeric: true }));
}

// Grupiranje po tjednima (ponedjeljak–nedjelja): [{ pocetak, kraj, redovi }]. Redovi bez datuma idu zadnji u grupu s pocetak = null.
export function grupirajPoTjednima(redovi) {
  const m = new Map();
  redovi.forEach((r) => { const k = r.datum ? pocetakTjedna(r.datum) : null; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return [...m.entries()].sort(([a], [b]) => String(a ?? "9999").localeCompare(String(b ?? "9999"))).map(([pocetak, rr]) => ({ pocetak, kraj: pocetak ? dodajDane(pocetak, 6) : null, redovi: rr }));
}

// Statistika isporuka (kartica u modulu Otpremnice i CMR): kilogrami poslani po mjesecu, odvojeno inozemstvo / tuzemstvo.
// Smjer (inozemstvo / tuzemstvo): ručno određen na otpremnici, inače otpremnica je u CMR-u, inače kupac ima stranu državu, inače tuzemstvo (vidi smjerOtpremnice).
// U popisu su sve otpremnice mjeseca; svaka ima kvačicu "ulazi u statistiku" (otpremnica.uStatistici). Zadano ulaze otpremnice kupcima i otpremnice
// "sebi" na vlastito gradilište (kooperant = sama tvrtka, vidi jeSebi), a dorade kooperantima (cinčanje, plastifikacija…) ne. Mjesec se određuje po datumu otpremnice.

const uMjesecu = (datum, mjesec) => String(datum || "").slice(0, 7) === mjesec;
const zaokruzi = (n) => Math.round((Number(n) || 0) * 10) / 10;

// Težina jedne stavke otpremnice (0 = nepoznata): masa upisana na stavci (masaKg); masa iz narudžbe kupca (masaJed × količina);
// za kupaonice po normativu (stavka ima isporukaIds) masa iz projekta: masaJed stavke Pod/Stranica × količina na otpremnici.
export function tezinaStavkeOtpremnice(s, otpremnica, { narudzbe = [], projekti = [] } = {}) {
  const narudzba = narudzbe.find((n) => n.id === otpremnica.narudzbaId);
  const projekt = projekti.find((p) => p.id === otpremnica.projektId);
  const kolicina = Number(s.kolicina) || 0;
  const upisana = Number(s.masaKg);
  if (upisana > 0) return upisana;
  const nst = narudzba?.stavke?.find((x) => x.id === s.narudzbaStavkaId);
  const izNarudzbe = (Number(nst?.masaJed) || 0) * kolicina;
  if (izNarudzbe > 0) return izNarudzbe;
  // grupirane isporuke iste stavke dijele masu jedinice; uzima se prva isporuka čija stavka ima masu
  let masaJed = 0;
  (s.isporukaIds || []).some((iid) => {
    const i = (projekt?.isporuke || []).find((x) => x.id === iid);
    const st = (i?.grupa === "stavkePod" ? projekt?.stavkePod : projekt?.stavkeKomplet || [])?.find((x) => x.id === i?.stavkaId);
    masaJed = Number(st?.masaJed) || 0;
    return masaJed > 0;
  });
  return masaJed * kolicina > 0 ? masaJed * kolicina : 0;
}

// Težina otpremnice: zbroj težina stavki (vidi tezinaStavkeOtpremnice); stavke bez ijednog podatka broje se u "nedostaje".
export function tezinaOtpremnice(otpremnica, izvori = {}) {
  let ukupno = 0, nedostaje = 0;
  (otpremnica.stavke || []).forEach((s) => {
    const t = tezinaStavkeOtpremnice(s, otpremnica, izvori);
    if (t > 0) ukupno += t; else nedostaje += 1;
  });
  return { ukupno, nedostaje };
}

// Isporučeno prema otpremnicama po stavci tipskog projekta (Pod / Stranice): zbroj količina sa stavki otpremnica tog projekta.
// Stavka otpremnice veže se uz tip preko isporukaIds → isporuka projekta → (grupa, stavkaId). Otpremnice kooperantu (dorade) ne broje.
// Starije otpremnice bez isporukaIds prepoznaju se po nazivu stavke ("Pod — <oznaka>", "Komplet — <oznaka>" ili "Stranica — <oznaka>") ako
// točno jedan tip projekta ima tu oznaku. Vraća Map "grupa:stavkaId" → { komada, otpremnice: [{ broj, datum, komada }] };
// stavke koje se ne mogu povezati s tipom (obrisana isporuka, nepoznat naziv) se preskaču.
const normNaziv = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
export function isporucenoPoStavkama(projekt, otpremnice = []) {
  const isporuke = new Map((projekt?.isporuke || []).map((i) => [i.id, i]));
  const poNazivu = (st) => {
    const m = normNaziv(st.naziv).match(/^(pod|komplet|stranica)\s+[—–-]\s+(.+)$/);
    if (!m) return null;
    const grupa = m[1] === "pod" ? "stavkePod" : "stavkeKomplet";
    const pogodaka = (projekt?.[grupa] || []).filter((s) => normNaziv(s.oznaka) === m[2]);
    return pogodaka.length === 1 ? { grupa, stavkaId: pogodaka[0].id } : null;
  };
  const rezultat = new Map();
  otpremnice.filter((o) => o.projektId === projekt?.id && o.vrsta !== "kooperant").forEach((o) => {
    (o.stavke || []).forEach((st) => {
      const komada = Number(st.kolicina) || 0;
      const isporuka = (st.isporukaIds || []).length > 0 ? (st.isporukaIds || []).map((id) => isporuke.get(id)).find(Boolean) : poNazivu(st);
      if (komada <= 0 || !isporuka) return;
      const kljuc = `${isporuka.grupa}:${isporuka.stavkaId}`;
      const r = rezultat.get(kljuc) || { komada: 0, otpremnice: [] };
      r.komada += komada;
      r.otpremnice.push({ broj: o.broj, datum: o.datum, komada });
      rezultat.set(kljuc, r);
    });
  });
  rezultat.forEach((r) => r.otpremnice.sort((a, b) => String(a.datum).localeCompare(String(b.datum)) || String(a.broj).localeCompare(String(b.broj), "hr", { numeric: true })));
  return rezultat;
}

// Država kupca (neobavezno polje na kupcu): prazno ili Hrvatska = tuzemstvo, svaka druga upisana država = inozemstvo.
const HR_NAZIVI = new Set(["hrvatska", "hr", "croatia", "kroatien"]);
export const jeStranaDrzava = (drzava) => {
  const d = String(drzava || "").trim().toLowerCase();
  return d !== "" && !HR_NAZIVI.has(d);
};

// Smjer otpremnice, po prednosti: 1) ručno određen smjer na otpremnici (smjer: "inozemstvo" | "tuzemstvo"), 2) otpremnica je u CMR-u,
// 3) kupac ima upisanu stranu državu, 4) inače tuzemstvo. Vraća { inozemstvo, izvor } (izvor: "ručno" | "CMR" | "država kupca" | "").
export function smjerOtpremnice(otpremnica, cmr, kupac) {
  if (otpremnica.smjer === "inozemstvo") return { inozemstvo: true, izvor: "ručno" };
  if (otpremnica.smjer === "tuzemstvo") return { inozemstvo: false, izvor: "ručno" };
  if (cmr) return { inozemstvo: true, izvor: "CMR" };
  if (jeStranaDrzava(kupac?.drzava)) return { inozemstvo: true, izvor: "država kupca" };
  return { inozemstvo: false, izvor: "" };
}

// Otpremnica kooperantu čiji je primatelj sama tvrtka (roba se šalje "sebi" na vlastito gradilište): dobavljač ima isti OIB kao tvrtka
// (Postavke tvrtke), a ako OIB nedostaje, isti naziv. Takva otpremnica je stvarna isporuka, za razliku od dorade (cinčanje, plastifikacija…).
const samoZnamenke = (t) => String(t || "").replace(/\D/g, "");
const normNazivTvrtke = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9čćžšđ]+/g, " ").trim();
export function jeSebi(otpremnica, dobavljaci = [], tvrtka = {}) {
  if (otpremnica.vrsta !== "kooperant") return false;
  const d = dobavljaci.find((x) => x.id === otpremnica.dobavljacId);
  if (!d) return false;
  const oibD = samoZnamenke(d.oib), oibT = samoZnamenke(tvrtka?.oib);
  if (oibD && oibT) return oibD === oibT;
  const nd = normNazivTvrtke(d.naziv);
  return nd !== "" && nd === normNazivTvrtke(tvrtka?.naziv);
}

// Ulazi li otpremnica u statistiku: kvačica na otpremnici (uStatistici: true | false) ima prednost; inače (zadano) ulaze sve otpremnice kupcima
// i otpremnice "sebi" na gradilište, a dorade kooperantima ne.
export const zadanoUStatistici = (otpremnica, sebi) => otpremnica.vrsta !== "kooperant" || !!sebi;
export const ulaziUStatistiku = (otpremnica, sebi) => (typeof otpremnica.uStatistici === "boolean" ? otpremnica.uStatistici : zadanoUStatistici(otpremnica, sebi));

// tezina(otpremnica) -> { ukupno, nedostaje } (nedostaje = broj stavki bez poznate težine)
// Popis (redovi) sadrži SVE otpremnice mjeseca; u zbrojeve ulaze samo one s kvačicom "ulazi u statistiku" (ulazi). Otpremnica "sebi" bez kupca
// preuzima državu kupca svog projekta (roba na stranom gradilištu je izvoz).
export function statistikaIsporuka({ otpremnice = [], cmr = [], kupci = [], dobavljaci = [], projekti = [], tvrtka = {} }, mjesec, tezina) {
  const cmrZaOtpremnicu = new Map();
  cmr.forEach((c) => (c.otpremniceIds || []).forEach((id) => { if (!cmrZaOtpremnicu.has(id)) cmrZaOtpremnicu.set(id, c); }));

  const redovi = otpremnice.filter((o) => uMjesecu(o.datum, mjesec)).map((o) => {
    const c = cmrZaOtpremnicu.get(o.id) || null;
    const sebi = jeSebi(o, dobavljaci, tvrtka);
    const kupacId = o.kupacId || (sebi ? projekti.find((p) => p.id === o.projektId)?.kupacId : undefined);
    const s = smjerOtpremnice(o, c, kupci.find((k) => k.id === kupacId));
    const t = tezina(o);
    const zadano = zadanoUStatistici(o, sebi);
    return { otpremnica: o, cmr: c, inozemstvo: s.inozemstvo, izvorSmjera: s.izvor, kg: t.ukupno, nedostaje: t.nedostaje, sebi, zadano, ulazi: ulaziUStatistiku(o, sebi), rucno: typeof o.uStatistici === "boolean" };
  });
  redovi.sort((a, b) => String(a.otpremnica.datum).localeCompare(String(b.otpremnica.datum)) || String(a.otpremnica.broj).localeCompare(String(b.otpremnica.broj), "hr", { numeric: true }));

  const zbroji = (lista) => ({ broj: lista.length, kg: zaokruzi(lista.reduce((s, r) => s + r.kg, 0)), bezTezine: lista.reduce((s, r) => s + r.nedostaje, 0) });
  const uZbroju = redovi.filter((r) => r.ulazi);
  const inozemstvo = uZbroju.filter((r) => r.inozemstvo);
  const tuzemstvo = uZbroju.filter((r) => !r.inozemstvo);

  // Za usporedbu s dosadašnjim postupkom: bruto težina upisana na CMR-ovima čije su otpremnice u ovom mjesecu (svaki CMR jednom).
  const cmrovi = [...new Set(inozemstvo.map((r) => r.cmr).filter(Boolean))];
  const cmrBruto = zaokruzi(cmrovi.reduce((s, c) => s + (Number(String(c.brutoTezina || "").replace(",", ".")) || 0), 0));

  return {
    redovi, izvanStatistike: redovi.length - uZbroju.length,
    inozemstvo: zbroji(inozemstvo), tuzemstvo: zbroji(tuzemstvo), ukupno: zbroji(uZbroju),
    cmrBroj: cmrovi.length, cmrBruto,
  };
}

// Godišnji pregled po mjesecima. spremljeno = { "GGGG-MM": { izvor: "zakljucano" | "rucno", ino: { kg, broj }, tuz: { kg, broj }, datum, korisnik, napomena } }:
// mjesec zaključan nakon slanja DZS-u i ručno unesen mjesec (npr. prije nego što su otpremnice u ERP-u) imaju prednost pred izračunom iz otpremnica.
// Ručni unos može imati samo ukupni iznos ({ izvor: "rucno", ukupno: { kg } } bez ino/tuz) — npr. izvješće DZS-u koje ne razdvaja inozemstvo i tuzemstvo;
// takav mjesec ulazi u ukupno, a inozemstvo/tuzemstvo su nepoznati (samoUkupno) pa zbroj inozemstva i tuzemstva nije cjelovit (nepotpuno > 0).
export function statistikaGodine(podaci, godina, tezina, spremljeno = {}) {
  const mjeseci = Array.from({ length: 12 }, (_, i) => `${godina}-${String(i + 1).padStart(2, "0")}`);
  const redovi = mjeseci.map((mjesec) => {
    const r = statistikaIsporuka(podaci, mjesec, tezina);
    const sp = spremljeno?.[mjesec] || null;
    const samoUkupno = !!sp && sp.izvor === "rucno" && !sp.ino && !sp.tuz && !!sp.ukupno;
    const ino = samoUkupno ? { kg: 0, broj: 0 } : sp ? { kg: zaokruzi(sp.ino?.kg), broj: Number(sp.ino?.broj) || 0 } : { kg: r.inozemstvo.kg, broj: r.inozemstvo.broj };
    const tuz = samoUkupno ? { kg: 0, broj: 0 } : sp ? { kg: zaokruzi(sp.tuz?.kg), broj: Number(sp.tuz?.broj) || 0 } : { kg: r.tuzemstvo.kg, broj: r.tuzemstvo.broj };
    const izvor = sp ? sp.izvor : (r.ukupno.broj > 0 ? "izracun" : "prazno");
    const ukupno = samoUkupno ? { kg: zaokruzi(sp.ukupno.kg), broj: Number(sp.ukupno.broj) || 0 } : { kg: zaokruzi(ino.kg + tuz.kg), broj: ino.broj + tuz.broj };
    // zaključani mjesec: koliko se današnji izračun razlikuje od poslanog (kasnije upisane težine, nove otpremnice)
    const razlika = sp && sp.izvor === "zakljucano" ? { ino: zaokruzi(r.inozemstvo.kg - ino.kg), tuz: zaokruzi(r.tuzemstvo.kg - tuz.kg) } : null;
    return { mjesec, izvor, samoUkupno, ino, tuz, ukupno, bezTezine: sp ? 0 : r.ukupno.bezTezine, razlika, spremljeno: sp };
  });
  const zbroj = (k) => ({ kg: zaokruzi(redovi.reduce((s, x) => s + x[k].kg, 0)), broj: redovi.reduce((s, x) => s + x[k].broj, 0) });
  return { godina, redovi, ino: zbroj("ino"), tuz: zbroj("tuz"), ukupno: zbroj("ukupno"), bezTezine: redovi.reduce((s, x) => s + x.bezTezine, 0), nepotpuno: redovi.filter((x) => x.samoUkupno).length };
}

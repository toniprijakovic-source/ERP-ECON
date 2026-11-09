// Statistika isporuka (kartica u modulu Otpremnice i CMR): kilogrami poslani kupcima po mjesecu, odvojeno inozemstvo / tuzemstvo.
// Smjer (inozemstvo / tuzemstvo): ručno određen na otpremnici, inače otpremnica je u CMR-u, inače kupac ima stranu državu, inače tuzemstvo (vidi smjerOtpremnice).
// Otpremnice kooperantu (dorade) nisu isporuka kupcu pa se ne ubrajaju. Mjesec se određuje po datumu otpremnice.

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

// tezina(otpremnica) -> { ukupno, nedostaje } (nedostaje = broj stavki bez poznate težine)
export function statistikaIsporuka({ otpremnice = [], cmr = [], kupci = [] }, mjesec, tezina) {
  const cmrZaOtpremnicu = new Map();
  cmr.forEach((c) => (c.otpremniceIds || []).forEach((id) => { if (!cmrZaOtpremnicu.has(id)) cmrZaOtpremnicu.set(id, c); }));

  const redovi = [];
  let kooperantske = 0;
  otpremnice.filter((o) => uMjesecu(o.datum, mjesec)).forEach((o) => {
    if (o.vrsta === "kooperant") { kooperantske += 1; return; }
    const c = cmrZaOtpremnicu.get(o.id) || null;
    const s = smjerOtpremnice(o, c, kupci.find((k) => k.id === o.kupacId));
    const t = tezina(o);
    redovi.push({ otpremnica: o, cmr: c, inozemstvo: s.inozemstvo, izvorSmjera: s.izvor, kg: t.ukupno, nedostaje: t.nedostaje });
  });
  redovi.sort((a, b) => String(a.otpremnica.datum).localeCompare(String(b.otpremnica.datum)) || String(a.otpremnica.broj).localeCompare(String(b.otpremnica.broj), "hr", { numeric: true }));

  const zbroji = (lista) => ({ broj: lista.length, kg: zaokruzi(lista.reduce((s, r) => s + r.kg, 0)), bezTezine: lista.reduce((s, r) => s + r.nedostaje, 0) });
  const inozemstvo = redovi.filter((r) => r.inozemstvo);
  const tuzemstvo = redovi.filter((r) => !r.inozemstvo);

  // Za usporedbu s dosadašnjim postupkom: bruto težina upisana na CMR-ovima čije su otpremnice u ovom mjesecu (svaki CMR jednom).
  const cmrovi = [...new Set(inozemstvo.map((r) => r.cmr).filter(Boolean))];
  const cmrBruto = zaokruzi(cmrovi.reduce((s, c) => s + (Number(String(c.brutoTezina || "").replace(",", ".")) || 0), 0));

  return {
    redovi, kooperantske,
    inozemstvo: zbroji(inozemstvo), tuzemstvo: zbroji(tuzemstvo), ukupno: zbroji(redovi),
    cmrBroj: cmrovi.length, cmrBruto,
  };
}

// Godišnji pregled po mjesecima. spremljeno = { "GGGG-MM": { izvor: "zakljucano" | "rucno", ino: { kg, broj }, tuz: { kg, broj }, datum, korisnik, napomena } }:
// mjesec zaključan nakon slanja DZS-u i ručno unesen mjesec (npr. prije nego što su otpremnice u ERP-u) imaju prednost pred izračunom iz otpremnica.
// Ručni unos može imati samo ukupni iznos ({ izvor: "rucno", ukupno: { kg } } bez ino/tuz) — npr. izvješće DZS-u koje ne razdvaja inozemstvo i tuzemstvo;
// takav mjesec ulazi u ukupno, a inozemstvo/tuzemstvo su nepoznati (samoUkupno) pa zbroj inozemstva i tuzemstva nije cjelovit (nepotpuno > 0).
export function statistikaGodine({ otpremnice = [], cmr = [], kupci = [] }, godina, tezina, spremljeno = {}) {
  const mjeseci = Array.from({ length: 12 }, (_, i) => `${godina}-${String(i + 1).padStart(2, "0")}`);
  const redovi = mjeseci.map((mjesec) => {
    const r = statistikaIsporuka({ otpremnice, cmr, kupci }, mjesec, tezina);
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

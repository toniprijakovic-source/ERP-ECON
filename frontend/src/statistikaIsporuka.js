// Statistika isporuka (kartica u modulu Otpremnice i CMR): kilogrami poslani kupcima po mjesecu, odvojeno inozemstvo / tuzemstvo.
// Inozemstvo = otpremnica kupcu koja je u nekom CMR-u; tuzemstvo = otpremnica kupcu bez CMR-a.
// Otpremnice kooperantu (dorade) nisu isporuka kupcu pa se ne ubrajaju. Mjesec se određuje po datumu otpremnice.

const uMjesecu = (datum, mjesec) => String(datum || "").slice(0, 7) === mjesec;
const zaokruzi = (n) => Math.round((Number(n) || 0) * 10) / 10;

// Težina otpremnice, po stavci redom: masa upisana na otpremnici (masaKg); masa iz narudžbe kupca (masaJed × količina);
// za kupaonice po normativu (stavka ima isporukaIds) masa iz projekta: masaJed stavke Pod/Stranica × količina na otpremnici.
// Stavke bez ijednog podatka broje se u "nedostaje".
export function tezinaOtpremnice(otpremnica, { narudzbe = [], projekti = [] } = {}) {
  const narudzba = narudzbe.find((n) => n.id === otpremnica.narudzbaId);
  const projekt = projekti.find((p) => p.id === otpremnica.projektId);
  let ukupno = 0, nedostaje = 0;
  (otpremnica.stavke || []).forEach((s) => {
    const kolicina = Number(s.kolicina) || 0;
    const upisana = Number(s.masaKg);
    if (upisana > 0) { ukupno += upisana; return; }
    const nst = narudzba?.stavke?.find((x) => x.id === s.narudzbaStavkaId);
    const izNarudzbe = (Number(nst?.masaJed) || 0) * kolicina;
    if (izNarudzbe > 0) { ukupno += izNarudzbe; return; }
    // grupirane isporuke iste stavke dijele masu jedinice; uzima se prva isporuka čija stavka ima masu
    let masaJed = 0;
    (s.isporukaIds || []).some((iid) => {
      const i = (projekt?.isporuke || []).find((x) => x.id === iid);
      const st = (i?.grupa === "stavkePod" ? projekt?.stavkePod : projekt?.stavkeKomplet || [])?.find((x) => x.id === i?.stavkaId);
      masaJed = Number(st?.masaJed) || 0;
      return masaJed > 0;
    });
    if (masaJed * kolicina > 0) ukupno += masaJed * kolicina; else nedostaje += 1;
  });
  return { ukupno, nedostaje };
}

// tezina(otpremnica) -> { ukupno, nedostaje } (nedostaje = broj stavki bez poznate težine)
export function statistikaIsporuka({ otpremnice = [], cmr = [] }, mjesec, tezina) {
  const cmrZaOtpremnicu = new Map();
  cmr.forEach((c) => (c.otpremniceIds || []).forEach((id) => { if (!cmrZaOtpremnicu.has(id)) cmrZaOtpremnicu.set(id, c); }));

  const redovi = [];
  let kooperantske = 0;
  otpremnice.filter((o) => uMjesecu(o.datum, mjesec)).forEach((o) => {
    if (o.vrsta === "kooperant") { kooperantske += 1; return; }
    const c = cmrZaOtpremnicu.get(o.id) || null;
    const t = tezina(o);
    redovi.push({ otpremnica: o, cmr: c, inozemstvo: !!c, kg: t.ukupno, nedostaje: t.nedostaje });
  });
  redovi.sort((a, b) => String(a.otpremnica.datum).localeCompare(String(b.otpremnica.datum)) || String(a.otpremnica.broj).localeCompare(String(b.otpremnica.broj), "hr", { numeric: true }));

  const zbroji = (lista) => ({ broj: lista.length, kg: zaokruzi(lista.reduce((s, r) => s + r.kg, 0)), bezTezine: lista.reduce((s, r) => s + r.nedostaje, 0) });
  const inozemstvo = redovi.filter((r) => r.inozemstvo);
  const tuzemstvo = redovi.filter((r) => !r.inozemstvo);

  // Za usporedbu s dosadašnjim postupkom: bruto težina upisana na CMR-ovima čije su otpremnice u ovom mjesecu (svaki CMR jednom).
  const cmrovi = [...new Set(inozemstvo.map((r) => r.cmr))];
  const cmrBruto = zaokruzi(cmrovi.reduce((s, c) => s + (Number(String(c.brutoTezina || "").replace(",", ".")) || 0), 0));

  return {
    redovi, kooperantske,
    inozemstvo: zbroji(inozemstvo), tuzemstvo: zbroji(tuzemstvo), ukupno: zbroji(redovi),
    cmrBroj: cmrovi.length, cmrBruto,
  };
}

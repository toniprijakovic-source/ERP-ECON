// Statistika isporuka (kartica u modulu Otpremnice i CMR): kilogrami poslani kupcima po mjesecu, odvojeno inozemstvo / tuzemstvo.
// Inozemstvo = otpremnica kupcu koja je u nekom CMR-u; tuzemstvo = otpremnica kupcu bez CMR-a.
// Otpremnice kooperantu (dorade) nisu isporuka kupcu pa se ne ubrajaju. Mjesec se određuje po datumu otpremnice.

const uMjesecu = (datum, mjesec) => String(datum || "").slice(0, 7) === mjesec;
const zaokruzi = (n) => Math.round((Number(n) || 0) * 10) / 10;

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

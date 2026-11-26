// Podloge za fakturu: koje stavke otpremnica su već obračunate i od kojih se stavki radi nova podloga.
// Čiste funkcije nad podacima — testirano u podlogeZaFakturu.test.js.
//   podloga.otpremniceIds      → otpremnice iz kojih je u podlogu ušla barem jedna stavka
//   podloga.stavkeOtpremnica   → { [otpremnicaId]: [indeksi stavki] } samo za otpremnice uključene DJELOMIČNO;
//                                otpremnica bez unosa (i sve podloge izrađene prije 11/2026) = uključene sve stavke
// Stavka otpremnice prepoznaje se po indeksu u otpremnica.stavke (stavke se nakon izdavanja ne preslažu ni brišu,
// samo im se može dopisati težina). Odznačena stavka ostaje neobračunata i nudi se u sljedećoj podlozi; ako se
// neće fakturirati kroz aplikaciju, otpremnica se označi "Već fakturirano" (fakturiranoRucno) kao i dosad.

export const podlogaPokrivaStavku = (podloga, otpremnicaId, indeks) => {
  if (!(podloga?.otpremniceIds || []).includes(otpremnicaId)) return false;
  const odabrane = podloga.stavkeOtpremnica?.[otpremnicaId];
  return !Array.isArray(odabrane) || odabrane.includes(indeks);
};

// Stanje obračuna jedne otpremnice kupcu.
//   podloge   → podloge u kojima je barem dio otpremnice
//   otvorene  → indeksi stavki koje još nisu ni u jednoj podlozi (prazno ako je otpremnica ručno označena kao fakturirana)
//   gotovo    → sve je obračunato (podlogama ili ručnom oznakom); djelomicno → dio u podlozi, dio još otvoren
export const fakturiranjeOtpremnice = (otpremnica, podloge) => {
  const id = otpremnica?.id;
  const ukupno = (otpremnica?.stavke || []).length;
  const svePodloge = (podloge || []).filter((p) => (p.otpremniceIds || []).includes(id));
  const nepokrivene = [];
  for (let i = 0; i < ukupno; i++) if (!svePodloge.some((p) => podlogaPokrivaStavku(p, id, i))) nepokrivene.push(i);
  const rucno = !!otpremnica?.fakturiranoRucno;
  const otvorene = rucno ? [] : nepokrivene;
  const gotovo = rucno || (svePodloge.length > 0 && otvorene.length === 0);
  return { podloge: svePodloge, otvorene, ukupno, rucno, gotovo, djelomicno: svePodloge.length > 0 && nepokrivene.length > 0 };
};

// Otpremnice kupcima (ne kooperantima) s još neobračunatim stavkama — za obavijest, izbor projekta i direktorski pregled.
export const otpremniceZaObracun = (otpremnice, podloge) =>
  (otpremnice || []).filter((o) => o.vrsta !== "kooperant" && !fakturiranjeOtpremnice(o, podloge).gotovo);

// Stavka narudžbe kupca za stavku otpremnice. Stavke otpremnica tipskih projekata (po normativu) nemaju narudzbaStavkaId pa se
// traži: po id-u; preko isporuke → stavke normativa → izNarudzbeId (uvoz iz narudžbe); po nazivu; po nazivu bez prefiksa
// "Pod — / Komplet — / Stranica — ".
export const nadjiStavkuNarudzbe = (s, stavkeNarudzbe, projekt) => {
  const poId = (id) => stavkeNarudzbe.find((n) => n.id === id);
  if (s.narudzbaStavkaId && poId(s.narudzbaStavkaId)) return poId(s.narudzbaStavkaId);
  for (const isporukaId of s.isporukaIds || []) {
    const isporuka = (projekt?.isporuke || []).find((i) => i.id === isporukaId);
    const stavkaNormativa = [...(projekt?.stavkePod || []), ...(projekt?.stavkeKomplet || [])].find((x) => x.id === isporuka?.stavkaId);
    if (stavkaNormativa?.izNarudzbeId && poId(stavkaNormativa.izNarudzbeId)) return poId(stavkaNormativa.izNarudzbeId);
  }
  const norm = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
  const naziv = norm(s.naziv);
  const bezPrefiksa = naziv.replace(/^(pod|komplet|stranica)\s+[—–-]\s+/, "");
  return stavkeNarudzbe.find((n) => norm(n.naziv) === naziv) || stavkeNarudzbe.find((n) => norm(n.naziv) === bezPrefiksa) || null;
};

// Redovi pregleda podloge: stavke odabranih otpremnica spojene po istoj stavci narudžbe (zbrajaju se količine ako se ista stavka
// isporučuje kroz više otpremnica), cijena iz narudžbe kupca. Uzimaju se samo stavke koje još nisu obračunate (otvorene).
//   odabrane → [{ otpremnica, indeksi }]; red.kljuc služi za kvačicu, red.izvori = [{ otpremnicaId, indeks }]
export const redoviPodloge = (odabrane, narudzba, projekt) => {
  const mapa = new Map();
  (odabrane || []).forEach(({ otpremnica, indeksi }) => {
    (indeksi || []).forEach((indeks) => {
      const s = otpremnica.stavke?.[indeks];
      if (!s) return;
      const nst = nadjiStavkuNarudzbe(s, narudzba?.stavke || [], projekt) || undefined;
      const kljuc = nst?.id || s.narudzbaStavkaId || s.naziv;
      if (!mapa.has(kljuc)) mapa.set(kljuc, { kljuc, naziv: s.naziv, sifra: nst?.sifra || "", jm: s.jm, cijena: Number(nst?.cijena) || 0, nemaVezeSNarudzbom: !nst, kolicina: 0, izvori: [] });
      const red = mapa.get(kljuc);
      red.kolicina += Number(s.kolicina) || 0;
      red.izvori.push({ otpremnicaId: otpremnica.id, indeks });
    });
  });
  return [...mapa.values()].map((r) => ({ ...r, ukupno: r.kolicina * r.cijena }));
};

// Što se upisuje u podlogu iz označenih redova: otpremnice s barem jednom uključenom stavkom i, za one uključene djelomično,
// popis indeksa. Stavka se piše bez pomoćnih polja (kljuc, izvori) — kao i dosad.
export const obuhvatPodloge = (redovi, iskljuceniKljucevi, otpremnice) => {
  const iskljuceni = new Set(iskljuceniKljucevi || []);
  const ukljuceni = (redovi || []).filter((r) => !iskljuceni.has(r.kljuc));
  const poOtpremnici = new Map();
  ukljuceni.forEach((r) => r.izvori.forEach(({ otpremnicaId, indeks }) => {
    if (!poOtpremnici.has(otpremnicaId)) poOtpremnici.set(otpremnicaId, new Set());
    poOtpremnici.get(otpremnicaId).add(indeks);
  }));
  const otpremniceIds = [];
  const stavkeOtpremnica = {};
  (otpremnice || []).forEach((o) => {
    const indeksi = poOtpremnici.get(o.id);
    if (!indeksi) return;
    otpremniceIds.push(o.id);
    if (indeksi.size < (o.stavke || []).length) stavkeOtpremnica[o.id] = [...indeksi].sort((a, b) => a - b);
  });
  const stavke = ukljuceni.map(({ kljuc, izvori, ...s }) => s);
  return { otpremniceIds, stavkeOtpremnica, stavke };
};

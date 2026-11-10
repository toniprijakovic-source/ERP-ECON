// Kontrola otpremnica tipskih projekata (kupaonice po normativu) u pregledniku — ista pravila kao poslužitelj (provjeriIsporukeNoveOtpremnice u backend/server.js),
// da se pogreška vidi odmah u obrascu; konačnu riječ ima poslužitelj (radi na svježim, zaključanim podacima).
// Stavka otpremnice veže se uz komade iz rasporeda isporuka projekta preko isporukaIds (jedan tip = jedna stavka, više isporuka).

const zaokruziKom = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const komada = (i) => Number(i?.komada) || 0;
const nazivTipa = (projekt, grupa, stavkaId) => `${grupa === "stavkePod" ? "Pod" : "Stranica"} — ${(projekt?.[grupa] || []).find((s) => s.id === stavkaId)?.oznaka || "(bez oznake)"}`;

// isporukaId → [{ id, broj, datum }] otpremnice na kojima komad stoji (po isporukaIds na stavkama).
export function isporukeNaOtpremnicama(otpremnice = []) {
  const mapa = new Map();
  otpremnice.forEach((o) => (o.stavke || []).forEach((st) => (st.isporukaIds || []).forEach((id) => {
    const popis = mapa.get(id) || [];
    if (!popis.some((x) => x.id === o.id)) popis.push({ id: o.id, broj: o.broj, datum: o.datum });
    mapa.set(id, popis);
  })));
  return mapa;
}

// Komadi koji se još smiju staviti na novu otpremnicu: označeni kao spremni za otpremu, a ni na jednoj postojećoj otpremnici
// (provjera po otpremnicama, ne samo po oznaci uOtpremniciId — oznaka se zna izgubiti ako je preglednik radio sa zastarjelom kopijom projekta).
export function slobodneIsporuke(projekt, otpremnice = []) {
  const zauzete = isporukeNaOtpremnicama(otpremnice);
  const postojece = new Set(otpremnice.map((o) => o.id));
  return (projekt?.isporuke || []).filter((i) => i.isporuceno && !zauzete.has(i.id) && !(i.uOtpremniciId && postojece.has(i.uOtpremniciId)));
}

// Komadi koji stoje na dvije ili više otpremnica (stari ili nastali zbog zastarjele kopije): [{ isporuka, tip, otpremnice: [{ broj, datum }] }].
export function dvostrukeIsporuke(projekt, otpremnice = []) {
  const zauzete = isporukeNaOtpremnicama(otpremnice.filter((o) => o.projektId === projekt?.id && o.vrsta !== "kooperant"));
  return (projekt?.isporuke || []).filter((i) => (zauzete.get(i.id) || []).length > 1).map((i) => ({ isporuka: i, tip: nazivTipa(projekt, i.grupa, i.stavkaId), otpremnice: zauzete.get(i.id) }));
}

// Podskup isporuka (po datumu pa redom unosa) čiji je zbroj komada TOČNO traženi broj; null ako se cijelim isporukama ne može složiti.
export function isporukeZaKolicinu(isporukaIds, isporuke, kolicina) {
  const trazeno = zaokruziKom(kolicina);
  const redom = (isporukaIds || []).map((id) => (isporuke || []).find((i) => i.id === id)).filter(Boolean)
    .sort((a, b) => String(a.datum || "").localeCompare(String(b.datum || "")) || (Number(a.redniBroj) || 0) - (Number(b.redniBroj) || 0));
  const odabrano = [];
  let zbroj = 0;
  for (const i of redom) {
    if (zaokruziKom(zbroj) >= trazeno) break;
    odabrano.push(i);
    zbroj += komada(i);
  }
  return zaokruziKom(zbroj) === trazeno ? odabrano.map((i) => i.id) : null;
}

// Provjera stavki obrasca nove otpremnice za tipski projekt. Vraća { stavke, greske }: stavke s isporukaIds skraćenim na količinu
// (kad se šalje manje nego je spremno, ostali komadi ostaju slobodni) i greske = { [stavka.id]: poruka }. Stavke bez isporukaIds se ne diraju.
export function pripremiStavkeNormativa(stavke = [], projekt, otpremnice = []) {
  const greske = {};
  const zauzete = isporukeNaOtpremnicama(otpremnice);
  const isporuke = projekt?.isporuke || [];
  const izlaz = stavke.map((s) => {
    const k = zaokruziKom(s.kolicina);
    if (!(s.isporukaIds || []).length || !(k > 0)) return s;
    const njihove = s.isporukaIds.map((id) => isporuke.find((i) => i.id === id));
    if (njihove.some((i) => !i)) { greske[s.id] = "Neki komad više ne postoji u rasporedu isporuka — zatvorite prozor i ponovno složite otpremnicu."; return s; }
    const zauzeta = njihove.find((i) => zauzete.has(i.id));
    if (zauzeta) { greske[s.id] = `Komad je već na otpremnici ${zauzete.get(zauzeta.id)[0].broj} — zatvorite prozor i ponovno složite otpremnicu.`; return s; }
    if (!Number.isInteger(k)) { greske[s.id] = "Količina mora biti cijeli broj komada."; return s; }
    const dostupno = zaokruziKom(njihove.reduce((a, i) => a + komada(i), 0));
    if (k > dostupno) { greske[s.id] = `Najviše ${dostupno} — toliko je komada označeno kao spremno za otpremu.`; return s; }
    let ids = s.isporukaIds;
    if (k < dostupno) {
      ids = isporukeZaKolicinu(s.isporukaIds, isporuke, k);
      if (!ids) { greske[s.id] = `Količina ${k} se ne može složiti od cijelih isporuka — upišite ${dostupno} ili razdvojite isporuku u rasporedu.`; return s; }
    }
    // ukupno otpremljeno po tipu (svaki komad jednom) ne smije premašiti naručeno
    const prva = njihove[0];
    const tip = (projekt?.[prva.grupa] || []).find((x) => x.id === prva.stavkaId);
    const naruceno = Number(tip?.komada) || 0;
    if (tip && naruceno > 0) {
      const vec = zaokruziKom(isporuke.filter((i) => i.grupa === prva.grupa && i.stavkaId === prva.stavkaId && zauzete.has(i.id)).reduce((a, i) => a + komada(i), 0));
      if (vec + k > naruceno) { greske[s.id] = `Naručeno ${naruceno}, na otpremnicama već ${vec} — još najviše ${Math.max(0, naruceno - vec)}. Povećajte naručenu količinu tipa ako je isporuka veća.`; return s; }
    }
    return ids === s.isporukaIds ? s : { ...s, isporukaIds: ids };
  });
  return { stavke: izlaz, greske };
}

// Obični projekti (stavke iz narudžbe kupca): upozorenje kad količina premašuje naručeno minus već otpremljeno. Vraća [{ stavkaId, poruka }].
// Preko naručenog je ponekad opravdano (rezervni komadi), pa je ovo upozorenje uz potvrdu, a ne zabrana.
export function prekoNarucenogPoNarudzbi(stavke = [], projektId, otpremnice = []) {
  const upozorenja = [];
  stavke.forEach((s) => {
    const k = Number(s.kolicina) || 0;
    const naruceno = Number(s.narucena);
    if (!s.narudzbaStavkaId || !(k > 0) || !(naruceno > 0)) return;
    const vec = otpremnice.filter((o) => o.projektId === projektId && o.vrsta !== "kooperant")
      .reduce((a, o) => a + (o.stavke || []).filter((x) => x.narudzbaStavkaId === s.narudzbaStavkaId).reduce((b, x) => b + (Number(x.kolicina) || 0), 0), 0);
    if (vec + k > naruceno) upozorenja.push({ stavkaId: s.id, poruka: `${s.naziv}: naručeno ${naruceno}, već otpremljeno ${vec}, na ovoj otpremnici ${k} — ukupno ${vec + k}.` });
  });
  return upozorenja;
}

// Statusi projekta i prijelazi između njih. Krajnja stanja projekta su TRI:
//   "Montaža" (još se radi) → "Završen" (posao je gotov, čeka se konačni obračun; projekt ostaje u popisu Projekti)
//   → "Arhiviran" (obračun gotov; selidba u karticu "Arhivirani projekti"). "Otkazan" je zasebno.
// Završen i Arhiviran su OBA "dovršeni" (posao je gotov: nalozi završeni, 100 % isporučeno u financijama, nema rokova);
// razlika je samo gdje se projekt vidi i smije li još primati dokumente (otpremnice, izdatnice, narudžbenice za trošak).

export const STATUSI_PROJEKTA = ["Ponuda", "Odobren", "U izradi", "Montaža", "Završen", "Arhiviran", "Otkazan"];

// Posao je gotov (Završen ili Arhiviran) — ne računa se u planiranje, rokove, projekcije.
export const projektDovrsen = (p) => p?.status === "Završen" || p?.status === "Arhiviran";

// Radi se na njemu / čeka se početak: nije dovršen ni otkazan. Zamjenjuje ranije `!["Završen","Otkazan"].includes(status)`.
export const projektAktivan = (p) => !projektDovrsen(p) && p?.status !== "Otkazan";

// Smije li se projekt još nuditi pri izdavanju materijala, narudžbenicama i sl. Završen (čeka obračun) smije — troškovi
// i dokumenti znaju stići i nakon završetka posla; Arhiviran i Otkazan ne.
export const projektPrimaDokumente = (p) => p?.status !== "Arhiviran" && p?.status !== "Otkazan";

// Promjena statusa projekta: što se mora zapisati na projekt i na njegove radne naloge.
//  • aktivan → Završen/Arhiviran: otvoreni nalozi se završavaju, pamti se koji su (autoZavrsenoNalozi) i s kojeg statusa
//    (statusPrijeZavrsetka) — samo zato da se pogrešan klik može precizno poništiti; datum završetka (zavrsenDatum).
//  • Završen/Arhiviran → aktivan: nalozi koje je prijelaz sam završio vraćaju se na raniji status; oznake se brišu.
//  • Završen ↔ Arhiviran: mijenja se samo datum arhiviranja, nalozi se ne diraju.
// Vraća { patch, zavrsiNaloge: [id], vratiNaloge: [{ id, status }] } — patch ide na projekt (samo promijenjena polja).
export function prijelazStatusa(stari, noviStatus, radniNalozi, danas) {
  const patch = { status: noviStatus };
  const zavrsiNaloge = [];
  const vratiNaloge = [];
  const novi = { status: noviStatus };
  if (!projektDovrsen(stari) && projektDovrsen(novi)) {
    const otvoreni = (radniNalozi || []).filter((r) => r.projektId === stari.id && r.status !== "Završen");
    patch.statusPrijeZavrsetka = stari.status;
    patch.autoZavrsenoNalozi = otvoreni.map((r) => ({ id: r.id, staviStatus: r.status }));
    patch.zavrsenDatum = danas;
    patch.arhiviranDatum = noviStatus === "Arhiviran" ? danas : null;
    otvoreni.forEach((r) => zavrsiNaloge.push(r.id));
  } else if (projektDovrsen(stari) && !projektDovrsen(novi) && noviStatus !== "Otkazan") {
    (stari.autoZavrsenoNalozi || []).forEach((n) => vratiNaloge.push({ id: n.id, status: n.staviStatus }));
    patch.statusPrijeZavrsetka = null;
    patch.autoZavrsenoNalozi = [];
    patch.zavrsenDatum = null;
    patch.arhiviranDatum = null;
  } else if (projektDovrsen(stari) && projektDovrsen(novi) && stari.status !== noviStatus) {
    patch.arhiviranDatum = noviStatus === "Arhiviran" ? danas : null;
  }
  return { patch, zavrsiNaloge, vratiNaloge };
}

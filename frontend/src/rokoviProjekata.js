// Rokovi i statusi projekata: tko kasni, što to vjerojatno znači (prijedlog statusa iz podataka) i što čeka obračun.
// Sve su čiste funkcije nad podacima (projekti, radni nalozi, otpremnice, CMR) — ništa se ne mijenja samo od sebe,
// aplikacija samo PREDLAŽE, a status mijenja čovjek (jedan klik).
import { projektDovrsen } from "./statusProjekta.js";

// Projekti kojima se prati rok isporuke (Ponuda još nije posao, Otkazan/Završen/Arhiviran više nemaju rok).
export const STATUSI_S_ROKOM = ["Odobren", "U izradi", "Montaža"];

export const RAZLOZI_POMAKA_ROKA = [
  "Kupac je pomaknuo rok",
  "Čekamo kupca (crteži, odobrenja, podaci)",
  "Čekamo materijal",
  "Čekamo kooperanta",
  "Kapacitet proizvodnje",
  "Promjena opsega (dodatak)",
  "Rok je bio pogrešno upisan",
  "Drugo",
];

const ms = (iso) => { const [g, m, d] = String(iso).slice(0, 10).split("-").map(Number); return Date.UTC(g, m - 1, d); };
// Broj dana od `od` do `do` (pozitivno ako je `do` kasnije); null ako datum nedostaje.
export const danaIzmedu = (od, doDatuma) => (od && doDatuma ? Math.round((ms(doDatuma) - ms(od)) / 86400000) : null);

const imaRok = (p) => !!p.rokZavrsetka && !Number.isNaN(ms(p.rokZavrsetka));

// Aktivni projekt čiji je rok prošao — kratak oblik za nadzornu ploču.
export function kasneProjekti(projekti, danas) {
  return (projekti || [])
    .filter((p) => STATUSI_S_ROKOM.includes(p.status) && imaRok(p) && p.rokZavrsetka < danas)
    .map((p) => ({ projekt: p, danaKasni: danaIzmedu(p.rokZavrsetka, danas) }))
    .sort((a, b) => b.danaKasni - a.danaKasni);
}

// Isporuke kupcu po projektu: otpremnice kupcu (ne kooperantu) i CMR-ovi. Izvan CMR-a primatelj je kupac projekta
// (CMR prema kooperantu se ne broji). Vraća Map(projektId → { broj, zadnja }).
function isporukePoProjektu(projekti, otpremnice, cmr) {
  const kupacPoProjektu = new Map((projekti || []).map((p) => [p.id, p.kupacId]));
  const m = new Map();
  const dodaj = (projektId, datum) => {
    if (!projektId || !kupacPoProjektu.has(projektId)) return;
    const t = m.get(projektId) || { broj: 0, zadnja: null };
    t.broj += 1;
    if (datum && (!t.zadnja || datum > t.zadnja)) t.zadnja = datum;
    m.set(projektId, t);
  };
  (otpremnice || []).forEach((o) => { if (o.vrsta !== "kooperant") dodaj(o.projektId, o.datum); });
  (cmr || []).forEach((c) => {
    const ids = new Set([c.projektId, ...(Array.isArray(c.projektIds) ? c.projektIds : [])].filter(Boolean));
    ids.forEach((id) => { if (!c.kupacId || !kupacPoProjektu.get(id) || c.kupacId === kupacPoProjektu.get(id)) dodaj(id, c.datum); });
  });
  return m;
}

// Potpuna analiza za karticu "Rokovi i statusi":
//  kasne     — aktivni projekti s prošlim rokom (najviše dana kasni prvi), svaki s brojkama i prijedlogom
//  bezRoka   — aktivni projekti bez upisanog roka
//  cekaObracun — projekti u statusu Završen (posao gotov, čeka konačni obračun), najdulje čekaju prvi
export function analizaRokova({ projekti, radniNalozi, otpremnice, cmr, danas }) {
  const isporuke = isporukePoProjektu(projekti, otpremnice, cmr);
  const naloziPoProjektu = new Map();
  (radniNalozi || []).forEach((r) => { if (!naloziPoProjektu.has(r.projektId)) naloziPoProjektu.set(r.projektId, []); naloziPoProjektu.get(r.projektId).push(r); });

  const redak = (p) => {
    const nalozi = naloziPoProjektu.get(p.id) || [];
    const zavrseno = nalozi.filter((r) => r.status === "Završen").length;
    const isp = isporuke.get(p.id) || { broj: 0, zadnja: null };
    const sviZavrseni = nalozi.length > 0 && zavrseno === nalozi.length;
    let prijedlog = null;
    let napomena = "";
    if (sviZavrseni && isp.broj > 0) {
      prijedlog = { status: "Završen", tekst: `Svi radni nalozi su završeni i isporuka je zabilježena${isp.zadnja ? ` (zadnja ${isp.zadnja.slice(8, 10)}.${isp.zadnja.slice(5, 7)}.)` : ""} — ako je posao gotov, a čeka se obračun, označite Završen.` };
    } else if (sviZavrseni) {
      napomena = "Svi radni nalozi su završeni, a isporuka nije zabilježena (otpremnica/CMR).";
    } else if (!nalozi.length) {
      napomena = "Nema radnih naloga.";
    } else {
      napomena = `Završeno ${zavrseno} od ${nalozi.length} radnih naloga.`;
    }
    // Najkasniji datum završetka OTVORENIH naloga u budućnosti — razuman prijedlog novog roka.
    const buduci = nalozi.filter((r) => r.status !== "Završen" && r.datumZavrsetka && r.datumZavrsetka >= danas).map((r) => r.datumZavrsetka).sort();
    return {
      projekt: p,
      danaKasni: imaRok(p) ? Math.max(0, danaIzmedu(p.rokZavrsetka, danas)) : null,
      nalozi: { ukupno: nalozi.length, zavrseno },
      isporuka: isp,
      prijedlog,
      napomena,
      predlozeniRok: buduci.length ? buduci[buduci.length - 1] : null,
    };
  };

  const aktivni = (projekti || []).filter((p) => STATUSI_S_ROKOM.includes(p.status));
  const kasne = aktivni.filter((p) => imaRok(p) && p.rokZavrsetka < danas).map(redak).sort((a, b) => b.danaKasni - a.danaKasni);
  const bezRoka = aktivni.filter((p) => !imaRok(p)).map(redak);
  const cekaObracun = (projekti || []).filter((p) => p.status === "Završen").map((p) => ({
    projekt: p,
    zavrsenDatum: p.zavrsenDatum || null,
    danaOdZavrsetka: p.zavrsenDatum ? Math.max(0, danaIzmedu(p.zavrsenDatum, danas)) : null,
    vrijednost: Number(p.vrijednost) || 0,
  })).sort((a, b) => (b.danaOdZavrsetka ?? -1) - (a.danaOdZavrsetka ?? -1));
  return { kasne, bezRoka, cekaObracun, ukupnoCekaObracun: cekaObracun.reduce((a, r) => a + r.vrijednost, 0) };
}

// Zapis o promjeni roka (povijest na projektu): tko, kada, s kojeg na koji datum i zašto.
export function zapisPromjeneRoka({ stariRok, noviRok, razlog, napomena, izmijenioId, danas, id }) {
  return { id, datum: danas, stariRok: stariRok || "", noviRok, razlog: razlog || "", napomena: (napomena || "").trim(), izmijenioId: izmijenioId || "" };
}

export const dodajPromjenuRoka = (projekt, zapis) => [...(Array.isArray(projekt?.promjeneRoka) ? projekt.promjeneRoka : []), zapis];

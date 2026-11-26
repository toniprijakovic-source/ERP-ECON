// Direktorski pregled: jedno mjesto za najveće aktivne projekte i iznimke koje traže pažnju direktora.
// Sve su čiste funkcije nad podacima (projekti, radni nalozi, otpremnice, CMR, narudžbenice, izdatnice, podloge, ponude) —
// aplikacija samo PRIKAZUJE i upozorava, ništa se ne mijenja samo od sebe. Pregled ne računa novce troška (trošak sati i
// materijala još nije pouzdan): za svaki projekt pokazuje vrijednost, rok, napredak naloga, sate naspram plana, materijal,
// isporuku i obračun (podloge za fakturu), a semafor se vodi iznimkama opisanim u PRAGOVI.
import { STATUSI_S_ROKOM, danaIzmedu, analizaRokova } from "./rokoviProjekata.js";
import { otpremniceZaObracun } from "./podlogeZaFakturu.js";

// Pragovi semafora i iznimaka — jedno mjesto, da se ista pravila vide u prikazu, PDF-u i testovima.
export const PRAGOVI = {
  satiZuto: 110,          // sati ≥ 110 % plana = žuto
  satiCrveno: 130,        // sati ≥ 130 % plana = crveno
  minPlanSati: 20,        // usporedba sati/plan ima smisla tek od ovolikog plana
  danaDoRokaZuto: 7,      // rok u idućih 7 dana, a manje od 80 % naloga gotovo = žuto
  nalogaPostoZuto: 80,
  satiBezMaterijala: 8,   // projekt s toliko utrošenih sati, a bez ijedne izdatnice, ide u iznimke
  danaOdgovoraPonude: 21, // poslana ponuda bez odgovora duže od ovoga
  danaBezPodloge: 7,      // otpremnica kupcu bez podloge za fakturu starija od ovoga
  danaCekaObracun: 30,    // projekt "Završen" koji čeka obračun duže od ovoga
};

const RAZINE = { crveno: 0, zuto: 1, info: 2 };
const broj = (v) => Number(v) || 0;
const zaokr1 = (n) => Math.round(n * 10) / 10;
const sati1 = (n) => zaokr1(Number(n) || 0).toLocaleString("hr-HR");
// Hrvatska množina: 1 / 2–4 / 5+ (11–14 su uvijek "5+").
const mn = (n, jedan, dva, pet) => { const k = n % 100; if (k >= 11 && k <= 14) return pet; const z = n % 10; return z === 1 ? jedan : z >= 2 && z <= 4 ? dva : pet; };
const ddmm = (iso) => (iso ? `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.` : "");

const naloziPoProjektu = (radniNalozi) => {
  const m = new Map();
  (radniNalozi || []).forEach((r) => { if (!m.has(r.projektId)) m.set(r.projektId, []); m.get(r.projektId).push(r); });
  return m;
};

// Narudžbenice (osim nacrta) koje imaju ijednu stavku za projekt, i izdatnice za projekt.
function materijalPoProjektu(narudzbenice, izdatnice) {
  const nar = new Map();
  (narudzbenice || []).forEach((n) => {
    if (n.status === "Nacrt") return;
    new Set((n.stavke || []).map((s) => s.projektId).filter(Boolean)).forEach((id) => nar.set(id, (nar.get(id) || 0) + 1));
  });
  const izd = new Map();
  (izdatnice || []).forEach((i) => { if (i.projektId) izd.set(i.projektId, (izd.get(i.projektId) || 0) + 1); });
  return { nar, izd };
}

// Zbroj podloga za fakturu po projektu (iznos koji je već pripremljen za obračun).
function podlogePoProjektu(podloge) {
  const m = new Map();
  (podloge || []).forEach((p) => { if (p.projektId) m.set(p.projektId, (m.get(p.projektId) || 0) + broj(p.zbroj)); });
  return m;
}

// Semafor jednog aktivnog projekta + razlozi (kratki tekstovi, najvažniji prvi).
function semaforProjekta({ danaDoRoka, imaRok, nalozi, sati, imaVoditelja }) {
  const crveni = [];
  const zuti = [];
  if (imaRok && danaDoRoka < 0) crveni.push(`kasni ${-danaDoRoka} d`);
  if (sati.posto != null && sati.plan >= PRAGOVI.minPlanSati) {
    if (sati.posto >= PRAGOVI.satiCrveno && !(nalozi.ukupno > 0 && nalozi.zavrseno === nalozi.ukupno)) crveni.push(`sati ${Math.round(sati.posto)} % plana`);
    else if (sati.posto >= PRAGOVI.satiZuto) zuti.push(`sati ${Math.round(sati.posto)} % plana`);
  }
  if (imaRok && danaDoRoka >= 0 && danaDoRoka <= PRAGOVI.danaDoRokaZuto && nalozi.posto != null && nalozi.posto < PRAGOVI.nalogaPostoZuto) zuti.push(`rok za ${danaDoRoka} d, gotovo ${nalozi.posto} % naloga`);
  if (!imaRok) zuti.push("nema roka");
  if (!imaVoditelja) zuti.push("nema voditelja");
  const razlozi = [...crveni, ...zuti];
  return { semafor: crveni.length ? "crveno" : zuti.length ? "zuto" : "zeleno", razlozi };
}

export function direktorskiPregled({ projekti = [], radniNalozi = [], otpremnice = [], cmr = [], narudzbenice = [], izdatnice = [], podlogeZaFakturu = [], ponude = [], kupci = [], zaposlenici = [], danas, isporuceno = () => ({ posto: 0 }) }) {
  const nalozi = naloziPoProjektu(radniNalozi);
  const { nar, izd } = materijalPoProjektu(narudzbenice, izdatnice);
  const podloge = podlogePoProjektu(podlogeZaFakturu);
  const imeKupca = new Map(kupci.map((k) => [k.id, k.naziv]));
  const imeZap = new Map(zaposlenici.map((z) => [z.id, `${z.prezime || ""} ${z.ime || ""}`.trim()]));
  const rokovi = analizaRokova({ projekti, radniNalozi, otpremnice, cmr, danas });
  const prijedlogZavrsen = new Map(rokovi.kasne.filter((r) => r.prijedlog).map((r) => [r.projekt.id, r.prijedlog.tekst]));

  const aktivni = projekti.filter((p) => STATUSI_S_ROKOM.includes(p.status));

  const redovi = aktivni.map((p) => {
    const n = nalozi.get(p.id) || [];
    const zavrseno = n.filter((r) => r.status === "Završen").length;
    const naloziInfo = { ukupno: n.length, zavrseno, posto: n.length ? Math.round((zavrseno / n.length) * 100) : null };
    const plan = n.reduce((a, r) => a + broj(r.planiranoSatiPrvo ?? r.planiranoSati), 0);
    const ostvareno = n.reduce((a, r) => a + broj(r.utrosenoSati), 0);
    const satiInfo = { plan: zaokr1(plan), ostvareno: zaokr1(ostvareno), posto: plan > 0 ? (ostvareno / plan) * 100 : null };
    const isp = isporuceno(p) || { posto: 0 };
    const vrijednost = broj(isp.vrijednostNarudzbe) || broj(p.vrijednost);
    const podlogeIznos = podloge.get(p.id) || 0;
    const imaRok = !!p.rokZavrsetka;
    const danaDoRoka = imaRok ? danaIzmedu(danas, p.rokZavrsetka) : null;
    const { semafor, razlozi } = semaforProjekta({ danaDoRoka, imaRok, nalozi: naloziInfo, sati: satiInfo, imaVoditelja: !!p.voditeljId });
    return {
      projekt: p,
      kupac: imeKupca.get(p.kupacId) || "",
      voditelj: p.voditeljId ? imeZap.get(p.voditeljId) || "" : "",
      status: p.status,
      vrijednost,
      rok: p.rokZavrsetka || null,
      danaDoRoka,
      nalozi: naloziInfo,
      sati: satiInfo,
      materijal: { narudzbenica: nar.get(p.id) || 0, izdatnica: izd.get(p.id) || 0 },
      isporuceno: { posto: Math.round(broj(isp.posto)), izvor: isp.izvor || "", upozorenje: !!isp.upozorenje },
      podloge: { iznos: Math.round(podlogeIznos * 100) / 100, posto: vrijednost > 0 ? Math.min(100, Math.round((podlogeIznos / vrijednost) * 100)) : null },
      semafor,
      razlozi,
      prijedlogZavrsen: prijedlogZavrsen.get(p.id) || null,
    };
  }).sort((a, b) => (b.vrijednost - a.vrijednost) || String(a.projekt.sifra).localeCompare(String(b.projekt.sifra), "hr", { numeric: true }));

  // ---- Iznimke ----
  const iznimke = [];
  const dodaj = (i) => iznimke.push({ stavke: [], iznos: 0, projektId: null, ...i });

  redovi.filter((r) => r.danaDoRoka != null && r.danaDoRoka < 0).forEach((r) => {
    dodaj({
      vrsta: "kasni", razina: "crveno", projektId: r.projekt.id, iznos: r.vrijednost,
      naslov: `${r.projekt.sifra} kasni ${-r.danaDoRoka} d (rok ${ddmm(r.rok)})`,
      tekst: r.prijedlogZavrsen || (r.nalozi.ukupno ? `Završeno ${r.nalozi.zavrseno} od ${r.nalozi.ukupno} radnih naloga.` : "Nema radnih naloga."),
    });
  });

  redovi.filter((r) => r.sati.posto != null && r.sati.plan >= PRAGOVI.minPlanSati && r.sati.posto >= PRAGOVI.satiZuto).forEach((r) => {
    const gotovo = r.nalozi.ukupno > 0 && r.nalozi.zavrseno === r.nalozi.ukupno;
    dodaj({
      vrsta: "sati", razina: r.sati.posto >= PRAGOVI.satiCrveno && !gotovo ? "crveno" : "zuto", projektId: r.projekt.id, iznos: r.vrijednost,
      naslov: `${r.projekt.sifra}: sati ${Math.round(r.sati.posto)} % plana`,
      tekst: `Upisano ${sati1(r.sati.ostvareno)} h naspram ${sati1(r.sati.plan)} h planiranih${gotovo ? " (svi nalozi su završeni)" : `, završeno ${r.nalozi.zavrseno} od ${r.nalozi.ukupno} naloga`}.`,
    });
  });

  const bezVoditelja = redovi.filter((r) => !r.projekt.voditeljId);
  if (bezVoditelja.length) dodaj({ vrsta: "bezVoditelja", razina: "zuto", naslov: `${bezVoditelja.length} ${mn(bezVoditelja.length, "aktivni projekt", "aktivna projekta", "aktivnih projekata")} bez voditelja`, tekst: "Projekt bez voditelja nema vlasnika za rok i nabavu.", stavke: bezVoditelja.map((r) => ({ projektId: r.projekt.id, tekst: `${r.projekt.sifra} ${r.projekt.naziv}` })) });

  const bezRoka = redovi.filter((r) => !r.rok);
  if (bezRoka.length) dodaj({ vrsta: "bezRoka", razina: "zuto", naslov: `${bezRoka.length} ${mn(bezRoka.length, "aktivni projekt", "aktivna projekta", "aktivnih projekata")} bez roka`, tekst: "Bez roka projekt ne ulazi u upozorenja o kašnjenju.", stavke: bezRoka.map((r) => ({ projektId: r.projekt.id, tekst: `${r.projekt.sifra} ${r.projekt.naziv}` })) });

  const bezMaterijala = redovi.filter((r) => r.sati.ostvareno >= PRAGOVI.satiBezMaterijala && r.materijal.izdatnica === 0);
  if (bezMaterijala.length) {
    dodaj({
      vrsta: "bezMaterijala", razina: "zuto",
      naslov: `${bezMaterijala.length} ${mn(bezMaterijala.length, "projekt", "projekta", "projekata")} u radu bez ijedne izdatnice materijala`,
      tekst: "Projekt ima upisane sate, a materijal nije izdan sa skladišta — trošak materijala po projektu nije vidljiv.",
      stavke: bezMaterijala.map((r) => ({ projektId: r.projekt.id, tekst: `${r.projekt.sifra} ${r.projekt.naziv} — ${sati1(r.sati.ostvareno)} h` })),
    });
  }

  rokovi.cekaObracun.filter((r) => r.danaOdZavrsetka != null && r.danaOdZavrsetka > PRAGOVI.danaCekaObracun).forEach((r) => {
    dodaj({
      vrsta: "cekaObracun", razina: "zuto", projektId: r.projekt.id, iznos: r.vrijednost,
      naslov: `${r.projekt.sifra} čeka konačni obračun ${r.danaOdZavrsetka} d`,
      tekst: `Posao je završen ${ddmm(r.zavrsenDatum)}, a konačni obračun još nije gotov.`,
    });
  });

  // Otpremnice kupcu bez podloge za fakturu (stariji od praga): isporučeno, a još nije pripremljeno za naplatu. Broji se i otpremnica
  // koja je samo djelomično u podlozi (dio stavki odznačen), a ne broji ona ručno označena kao fakturirana izvan aplikacije.
  const zaObracun = new Set(otpremniceZaObracun(otpremnice, podlogeZaFakturu).map((o) => o.id));
  const projektPoId = new Map(projekti.map((p) => [p.id, p]));
  const granicaPodloge = dodajDane(danas, -PRAGOVI.danaBezPodloge);
  const bezPodloge = new Map();
  (otpremnice || []).forEach((o) => {
    if (!zaObracun.has(o.id) || !o.datum || o.datum > granicaPodloge) return;
    const p = projektPoId.get(o.projektId);
    if (!p || ["Otkazan", "Ponuda"].includes(p.status)) return;
    const t = bezPodloge.get(p.id) || { projekt: p, broj: 0, najstarija: o.datum };
    t.broj += 1;
    if (o.datum < t.najstarija) t.najstarija = o.datum;
    bezPodloge.set(p.id, t);
  });
  if (bezPodloge.size) {
    const popis = [...bezPodloge.values()].sort((a, b) => a.najstarija.localeCompare(b.najstarija));
    const ukupnoOtp = popis.reduce((a, t) => a + t.broj, 0);
    dodaj({
      vrsta: "bezPodloge", razina: "zuto",
      naslov: `${ukupnoOtp} ${mn(ukupnoOtp, "otpremnica", "otpremnice", "otpremnica")} kupcima (${popis.length} ${mn(popis.length, "projekt", "projekta", "projekata")}) bez podloge za fakturu`,
      tekst: `Isporuka je zabilježena prije više od ${PRAGOVI.danaBezPodloge} dana, a podloga za fakturu nije izrađena.`,
      stavke: popis.map((t) => ({ projektId: t.projekt.id, tekst: `${t.projekt.sifra} ${t.projekt.naziv} — ${t.broj} ${mn(t.broj, "otpremnica", "otpremnice", "otpremnica")}, najstarija ${ddmm(t.najstarija)}` })),
    });
  }

  const granicaPonude = dodajDane(danas, -PRAGOVI.danaOdgovoraPonude);
  const staraPonuda = (ponude || []).filter((p) => p.status === "Poslana" && p.datum && p.datum <= granicaPonude).sort((a, b) => a.datum.localeCompare(b.datum));
  if (staraPonuda.length) {
    dodaj({
      vrsta: "ponude", razina: "info",
      naslov: `${staraPonuda.length} ${mn(staraPonuda.length, "poslana ponuda", "poslane ponude", "poslanih ponuda")} bez odgovora duže od ${PRAGOVI.danaOdgovoraPonude} dana`,
      tekst: "Vrijedi nazvati kupca ili ponudu zatvoriti.",
      stavke: staraPonuda.map((p) => ({ projektId: null, tekst: `${p.broj} ${p.naziv || ""} — ${imeKupca.get(p.kupacId) || ""}, poslana ${ddmm(p.datum)}`.replace(/\s+—\s+,/, ",").trim() })),
    });
  }

  iznimke.sort((a, b) => (RAZINE[a.razina] - RAZINE[b.razina]) || (b.iznos - a.iznos));

  // ---- Zbirni pokazatelji ----
  const zaIsporuku = redovi.reduce((a, r) => a + (r.vrijednost > 0 ? r.vrijednost * (1 - Math.min(100, r.isporuceno.posto) / 100) : 0), 0);
  const kpi = {
    aktivni: { broj: redovi.length, vrijednost: Math.round(redovi.reduce((a, r) => a + r.vrijednost, 0)) },
    kasne: { broj: redovi.filter((r) => r.danaDoRoka != null && r.danaDoRoka < 0).length },
    cekaObracun: { broj: rokovi.cekaObracun.length, vrijednost: Math.round(rokovi.ukupnoCekaObracun) },
    zaIsporuku: { vrijednost: Math.round(zaIsporuku) },
    ponude: { poslane: (ponude || []).filter((p) => p.status === "Poslana").length },
    semafor: { crveno: redovi.filter((r) => r.semafor === "crveno").length, zuto: redovi.filter((r) => r.semafor === "zuto").length, zeleno: redovi.filter((r) => r.semafor === "zeleno").length },
  };

  return { kpi, redovi, iznimke };
}

// Datum ± dana (ISO), bez vremenskih zona.
function dodajDane(iso, dana) {
  const [g, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(g, m - 1, d + dana)).toISOString().slice(0, 10);
}

export const OPIS_SEMAFORA = [
  ["crveno", `kasni s rokom ili su sati ≥ ${PRAGOVI.satiCrveno} % plana (a nalozi nisu svi završeni)`],
  ["zuto", `sati ≥ ${PRAGOVI.satiZuto} % plana, rok za ≤ ${PRAGOVI.danaDoRokaZuto} dana uz manje od ${PRAGOVI.nalogaPostoZuto} % završenih naloga, nema roka ili voditelja`],
  ["zeleno", "nema nijednog od gornjih upozorenja"],
];

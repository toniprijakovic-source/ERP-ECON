// Stanje servera (most na ECON-R550): pravila upozorenja i zadaci u zvoncu. Čista logika bez baze, da se može isprobati testom.
// Izvještaj šalje most (most/lib/stanje.js) svake minute; "kontakt" je zadnji put kad je most pitao za zadatke (vidi most-veza.js).
// Upozorenje postaje zadatak odabranoj osobi (zvonce, kao zadatak za naručivanje potrošnog materijala) i samo se zatvara kad uzrok nestane.

const MOST_SUTI_MIN = 15;          // most se nije javio duže od ovoga → upozorenje
const KOPIJA_STARA_H = 2;          // zadnja uspjela kopija starija od ovoga → upozorenje (kopija se radi svaki sat)
const OBNOVA_STARA_DANA = 35;      // zadnja uspjela probna obnova starija od ovoga → upozorenje (radi se jednom mjesečno)
const MIN_SLOBODNO_GB = 10;        // disk s manje slobodnog prostora (ili ispod MIN_SLOBODNO_UDIO) → upozorenje
const MIN_SLOBODNO_UDIO = 0.05;
const VRSTE_UPOZORENJA = ["most", "pogon", "kopija", "obnova", "prostor"];

const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const vrijemeHR = (v) => new Date(v).toLocaleString("hr-HR", { timeZone: "Europe/Zagreb", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const sati = (h) => (h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} dana`);

// kontakt: ISO vrijeme zadnjeg javljanja mosta (null = most se još nikad nije javio — novi poslužitelj, nema upozorenja).
// izvjestaj: zadnji izvještaj mosta (oblik u most/lib/stanje.js). sada: Date ili broj (ms).
// Vraća popis { kljuc, tekst } — najviše jedno upozorenje po vrsti.
function izracunajUpozorenja({ kontakt, izvjestaj, sada = Date.now() }) {
  const t = typeof sada === "number" ? sada : sada.getTime();
  const out = [];
  const zadnjiKontakt = ms(kontakt);
  if (zadnjiKontakt != null && t - zadnjiKontakt > MOST_SUTI_MIN * 60000) {
    // Dok most šuti, njegov stari izvještaj ne govori ništa o kopijama i disku — javlja se samo ovo.
    out.push({ kljuc: "most", tekst: `Most na serveru ECON-R550 ne javlja se od ${vrijemeHR(zadnjiKontakt)}. XRechnung, fotografije na Z: i kopije se ne prate. Provjeri je li server upaljen i radi li zadatak "ERP Econ - Most".` });
    return out;
  }
  if (!izvjestaj || typeof izvjestaj !== "object") return out;

  const loši = (izvjestaj.pogoni || []).filter((p) => p && p.ok === false);
  if (loši.length) out.push({ kljuc: "pogon", tekst: `Na serveru nije spojen pogon ${loši.map((p) => p.slovo).join(", ")} — most ne može spremati u mape projekata. (${loši.map((p) => p.opis).filter(Boolean).join("; ").slice(0, 200)})` });

  const k = izvjestaj.kopije;
  if (k && k.podeseno) {
    const zadnja = ms(k.zadnja?.vrijeme);
    const greska = k.greska && ms(k.greska.vrijeme) != null && (zadnja == null || ms(k.greska.vrijeme) > zadnja) ? ` Zadnja greška: ${String(k.greska.poruka || "").slice(0, 200)}` : "";
    if (k.dostupna === false) out.push({ kljuc: "kopija", tekst: `Mapa sigurnosnih kopija nije dostupna mostu (${k.mapa || "?"}).` });
    else if (zadnja == null) out.push({ kljuc: "kopija", tekst: `U mapi sigurnosnih kopija nema zapisa o uspjeloj kopiji.${greska}` });
    else if (t - zadnja > KOPIJA_STARA_H * 3600000) out.push({ kljuc: "kopija", tekst: `Zadnja uspjela sigurnosna kopija je od ${vrijemeHR(zadnja)} (prije ${sati((t - zadnja) / 3600000)}). Kopija se radi svaki sat — provjeri zadatak "ERP Econ - Kopije (sef)".${greska}` });

    const o = k.obnova;
    if (o && o.ok === false) out.push({ kljuc: "obnova", tekst: `Probna obnova kopije NIJE uspjela (${vrijemeHR(o.vrijeme)}): ${String(o.greska || "").slice(0, 250)}` });
    else if (o && o.ok && ms(o.vrijeme) != null && t - ms(o.vrijeme) > OBNOVA_STARA_DANA * 86400000) out.push({ kljuc: "obnova", tekst: `Zadnja uspjela probna obnova kopije je od ${vrijemeHR(o.vrijeme)} — trebala bi se raditi svaki mjesec.` });
  }

  const tijesno = (izvjestaj.diskovi || []).filter((d) => d && Number.isFinite(d.slobodnoGB) && Number.isFinite(d.ukupnoGB) && d.ukupnoGB > 0 && (d.slobodnoGB < MIN_SLOBODNO_GB || d.slobodnoGB / d.ukupnoGB < MIN_SLOBODNO_UDIO));
  if (tijesno.length) out.push({ kljuc: "prostor", tekst: `Na serveru ponestaje prostora: ${tijesno.map((d) => `${d.oznaka} slobodno ${d.slobodnoGB} GB od ${d.ukupnoGB} GB`).join("; ")}.` });
  return out;
}

const PONOVI_NAKON_RUCNOG_H = 24;  // osoba je sama zatvorila zadatak, a uzrok je i dalje tu → novi zadatak tek nakon ovoga
const CUVAJ_ZATVORENE_DANA = 30;   // zatvoreni zadaci upozorenja stariji od ovoga brišu se s popisa

// Usklađuje zadatke (slobodniZadaci) s trenutnim upozorenjima: novo upozorenje → zadatak odabranoj osobi (ako je određena),
// upozorenje koje je nestalo → zadatak se zatvara (izvršio "sustav"). Postojeći otvoreni zadatak iste vrste ostaje kakav jest.
// Ako je osoba zadatak sama označila izvršenim, a uzrok je ostao, novi zadatak dolazi tek nakon PONOVI_NAKON_RUCNOG_H sati.
// Vraća { zadaci, promijenjeno } — nova lista samo kad se nešto promijenilo.
function uskladiZadatke(zadaci, upozorenja, primateljId, sada = new Date().toISOString()) {
  const lista = Array.isArray(zadaci) ? zadaci : [];
  const t = Date.parse(sada);
  const aktivne = new Set(upozorenja.map((u) => u.kljuc));
  let promijenjeno = false;
  const nova = [];
  for (const z of lista) {
    if (z && z.serverUpozorenje && z.izvrseno && t - (ms(z.datumIzvrsenja) ?? t) > CUVAJ_ZATVORENE_DANA * 86400000) { promijenjeno = true; continue; }
    if (!z || !z.serverUpozorenje || z.izvrseno || aktivne.has(z.serverUpozorenje)) { nova.push(z); continue; }
    promijenjeno = true;
    nova.push({ ...z, izvrseno: true, izvrsioId: "sustav", datumIzvrsenja: sada, dodjelaVidjena: true });
  }
  if (primateljId) {
    for (const u of upozorenja) {
      if (nova.some((z) => z && z.serverUpozorenje === u.kljuc && !z.izvrseno)) continue;
      if (nova.some((z) => z && z.serverUpozorenje === u.kljuc && z.izvrseno && z.izvrsioId !== "sustav" && t - (ms(z.datumIzvrsenja) ?? 0) < PONOVI_NAKON_RUCNOG_H * 3600000)) continue;
      nova.push({
        id: uid("sz"), naziv: `Server: ${u.tekst}`, dodijeljenoId: primateljId, planiraniDatum: null, izvrseno: false, izvrsioId: null, datumIzvrsenja: null,
        kreiraoId: "sustav", zadaoId: "sustav", zadanoDatum: sada, dodjelaVidjena: false, serverUpozorenje: u.kljuc,
      });
      promijenjeno = true;
    }
  }
  return { zadaci: promijenjeno ? nova : lista, promijenjeno };
}

module.exports = { izracunajUpozorenja, uskladiZadatke, MOST_SUTI_MIN, KOPIJA_STARA_H, OBNOVA_STARA_DANA, MIN_SLOBODNO_GB, MIN_SLOBODNO_UDIO, VRSTE_UPOZORENJA, PONOVI_NAKON_RUCNOG_H, CUVAJ_ZATVORENE_DANA };

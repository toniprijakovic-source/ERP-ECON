// Fotografije montaže po oznaci pozicije: čiste funkcije za uvoz oznaka (lijepljenje iz Excela/Worda), sažetak za karticu projekta,
// raspored QR naljepnica po stranicama i adresu koju QR kod otvara. Čišćenje oznake MORA odgovarati backend/montaza.js (mapaOznake):
// poslužitelj je mjerodavan, ovdje služi samo za pregled prije učitavanja (isti primjeri su u oba testa).

export const NAJ_OZNAKA = 40;
const REZERVIRANA = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
export const ocistiOznaku = (s) => String(s ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAJ_OZNAKA);
// Oblik za naziv mape/datoteke i QR vezu: samo slova, brojevi, točka, crtica i podcrta; bez rubnih separatora; rezervirana imena Windowsa dobivaju "_".
export const mapaOznake = (s) => {
  const m = ocistiOznaku(s).replace(/[^A-Za-z0-9čćžšđČĆŽŠĐ._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  return REZERVIRANA.test(m) ? `${m}_` : m;
};

// Prirodni poredak oznaka: A-1.OG, A-2.OG, … A-10.OG, B-3.OG
export const usporediOznake = (a, b) => String(a.oznaka ?? a).localeCompare(String(b.oznaka ?? b), "hr", { numeric: true, sensitivity: "base" });

// Tekst zalijepljen iz Excela/Worda → oznake. Jedan redak = jedna oznaka; u retku s tabulatorima (stupci) uzima se prva ćelija koja nije prazna
// ni samo redni broj ("1." ili "12"). Zalijepljen jedan redak sa zarezima/točka-zarezima ("A-1, A-2") dijeli se na oznake.
// postojece = popis već učitanih pozicija ({ mapa }); duplikati i nedopušteno se vraćaju u "preskoceno" s razlogom.
export function parsirajOznake(tekst, postojece = []) {
  const redovi = String(tekst ?? "").split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  let ulaz = redovi.map((r) => {
    if (!r.includes("\t")) return r;
    const celije = r.split("\t").map((c) => c.trim()).filter(Boolean);
    return celije.find((c) => !/^\d+[.)]?$/.test(c)) ?? "";
  });
  if (ulaz.length === 1 && /[,;]/.test(ulaz[0])) ulaz = ulaz[0].split(/[,;]/);
  const vidjene = new Set((postojece || []).map((p) => String(p.mapa).toLowerCase()));
  const nove = [], preskoceno = [];
  for (const sirova of ulaz) {
    const oznaka = ocistiOznaku(sirova), mapa = mapaOznake(sirova);
    if (!oznaka) continue;
    if (!mapa) { preskoceno.push({ oznaka, razlog: "nedopuštena oznaka" }); continue; }
    if (vidjene.has(mapa.toLowerCase())) { preskoceno.push({ oznaka, razlog: "već postoji" }); continue; }
    vidjene.add(mapa.toLowerCase());
    nove.push({ oznaka, mapa });
  }
  return { nove, preskoceno };
}

// Pozicije s brojem slika i stanjem: "montirano" (zeleno), "slike" (ima slike, nije označeno montirano), "prazno" (ništa još). Uz to zbrojevi za naslov kartice.
export function sazetakPozicija(pozicije, slike) {
  const poMapi = new Map();
  for (const s of slike || []) {
    const t = poMapi.get(s.mapa) || { broj: 0, zadnja: "" };
    t.broj += 1;
    if (!t.zadnja || String(s.kreirano) > t.zadnja) t.zadnja = String(s.kreirano);
    poMapi.set(s.mapa, t);
  }
  const redovi = [...(pozicije || [])].map((p) => {
    const t = poMapi.get(p.mapa) || { broj: 0, zadnja: "" };
    return { ...p, brojSlika: t.broj, zadnjaSlika: t.zadnja, stanje: p.montirano ? "montirano" : t.broj > 0 ? "slike" : "prazno" };
  }).sort(usporediOznake);
  return {
    redovi,
    ukupno: redovi.length,
    montirano: redovi.filter((r) => r.stanje === "montirano").length,
    sSlikama: redovi.filter((r) => r.brojSlika > 0).length,
    bezSlika: redovi.filter((r) => r.brojSlika === 0),
    montiranoBezSlika: redovi.filter((r) => r.montirano && r.brojSlika === 0),
  };
}

// Raspored naljepnica po A4 stranicama (dva stupca): redom po oznaci, poStranici naljepnica na stranici.
export function rasporediNaljepnice(veze, poStranici = 18) {
  const sortirano = [...(veze || [])].sort(usporediOznake);
  const stranice = [];
  for (let i = 0; i < sortirano.length; i += poStranici) stranice.push(sortirano.slice(i, i + poStranici));
  return stranice;
}

export const adresaMontaze = (origin, pathname, token) => `${origin}${pathname || "/"}?montaza=${encodeURIComponent(token)}`;
export const tokenMontazeIzUpita = (search) => new URLSearchParams(search || "").get("montaza") || "";

// Hrvatski blagdani i neradni dani (Zakon o blagdanima, spomendanima i neradnim danima u RH, NN 110/19 i kasnije izmjene, čl. 1):
// 1.1. Nova godina, 6.1. Bogojavljenje, Uskrs (nedjelja) i Uskrsni ponedjeljak, 1.5. Praznik rada, 30.5. Dan državnosti, Tijelovo (Uskrs + 60 dana),
// 22.6. Dan antifašističke borbe, 5.8. Dan pobjede i domovinske zahvalnosti, 15.8. Velika Gospa, 1.11. Svi sveti,
// 18.11. Dan sjećanja na žrtve Domovinskog rata, 25.12. Božić, 26.12. Sveti Stjepan.
// 25.6. (Dan neovisnosti) i 8.10. su od 2020. samo spomendani — NISU neradni dani. Blagdan koji padne u nedjelju ne prenosi se na drugi dan.
// Popis se u ERP-u vodi u ključu "praznici" ({ id: "prz-GGGG-N", datum: "GGGG-MM-DD", naziv }); evidencija, obračun plaća i plan proizvodnje
// čitaju samo datume, pa za novu godinu treba dodati njezine praznike (Postavke obračuna plaća → Neradni dani → "Dodaj zakonske praznike").

// Uskrs (gregorijanski): Meeus/Jones/Butcher algoritam. Vraća { mjesec (1–12), dan }.
export const uskrs = (godina) => {
  const a = godina % 19, b = Math.floor(godina / 100), c = godina % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mjesec = Math.floor((h + l - 7 * m + 114) / 31), dan = ((h + l - 7 * m + 114) % 31) + 1;
  return { mjesec, dan };
};

const iso = (godina, mjesec, dan) => `${godina}-${String(mjesec).padStart(2, "0")}-${String(dan).padStart(2, "0")}`;
// ISO datum + broj dana (UTC, pa bez pomaka zbog ljetnog računanja vremena)
const dodajDane = (datumISO, dana) => new Date(Date.parse(`${datumISO}T00:00:00Z`) + dana * 86400000).toISOString().slice(0, 10);

// Svi zakonski neradni dani u godini, po datumu: [{ datum, naziv }]
export const hrvatskiPraznici = (godina) => {
  const g = Number(godina);
  const u = iso(g, uskrs(g).mjesec, uskrs(g).dan);
  return [
    { datum: iso(g, 1, 1), naziv: "Nova godina" },
    { datum: iso(g, 1, 6), naziv: "Bogojavljenje" },
    { datum: u, naziv: "Uskrs" },
    { datum: dodajDane(u, 1), naziv: "Uskrsni ponedjeljak" },
    { datum: iso(g, 5, 1), naziv: "Praznik rada" },
    { datum: iso(g, 5, 30), naziv: "Dan državnosti" },
    { datum: dodajDane(u, 60), naziv: "Tijelovo" },
    { datum: iso(g, 6, 22), naziv: "Dan antifašističke borbe" },
    { datum: iso(g, 8, 5), naziv: "Dan pobjede i domovinske zahvalnosti" },
    { datum: iso(g, 8, 15), naziv: "Velika Gospa" },
    { datum: iso(g, 11, 1), naziv: "Svi sveti" },
    { datum: iso(g, 11, 18), naziv: "Dan sjećanja na žrtve Domovinskog rata" },
    { datum: iso(g, 12, 25), naziv: "Božić" },
    { datum: iso(g, 12, 26), naziv: "Sveti Stjepan" },
  ].sort((x, y) => x.datum.localeCompare(y.datum));
};

// Praznici godine koji još nisu u popisu (usporedba po datumu), s novim id-evima prz-GGGG-N (N nastavlja najveći postojeći za tu godinu).
export const praznikaZaDodati = (postojeci, godina) => {
  const popis = Array.isArray(postojeci) ? postojeci : [];
  const imaDatum = new Set(popis.map((p) => p?.datum));
  const prefiks = `prz-${godina}-`;
  let n = popis.map((p) => (typeof p?.id === "string" && p.id.startsWith(prefiks) ? parseInt(p.id.slice(prefiks.length), 10) : 0)).filter((x) => Number.isFinite(x)).reduce((a, b) => Math.max(a, b), 0);
  return hrvatskiPraznici(godina).filter((p) => !imaDatum.has(p.datum)).map((p) => ({ id: `${prefiks}${++n}`, datum: p.datum, naziv: p.naziv }));
};

// Zapisi u popisu iz te godine koji NISU na zakonskom popisu (npr. upisan 25.6. kao Dan državnosti) — samo upozorenje, ništa se ne briše.
export const praznikaIzvanZakona = (postojeci, godina) => {
  const zakonski = new Set(hrvatskiPraznici(godina).map((p) => p.datum));
  return (Array.isArray(postojeci) ? postojeci : []).filter((p) => typeof p?.datum === "string" && p.datum.startsWith(`${godina}-`) && !zakonski.has(p.datum));
};

// Ima li popis ijedan praznik u toj godini? (nema = godina nije postavljena)
export const imaPraznikeGodine = (postojeci, godina) => (Array.isArray(postojeci) ? postojeci : []).some((p) => typeof p?.datum === "string" && p.datum.startsWith(`${godina}-`));

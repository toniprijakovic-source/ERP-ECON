// Brojevi dokumenata koji sadrže godinu (PON-2026-001, LAS-2026-001, NAR-2026-001, IZD-2026-001, FAK-2026-0001, upit 26-059).
// Godina se uzima iz datuma, a ne iz koda: s 1.1. brojevi sami počinju iznova od 001 jer za novi prefiks još nema nijednog broja.
// (Poslužitelj već prihvaća bilo koju četveroznamenkastu godinu: /^(NAR-\d{4}-)(\d+)()$/ i sl.)

export const godinaBroja = (datum = new Date()) => {
  const d = datum instanceof Date ? datum : new Date(datum);
  return Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
};

// prefiksGodine("PON") → "PON-2027-" (godina iz datuma, zadano danas)
export const prefiksGodine = (oznaka, datum = new Date()) => `${oznaka}-${godinaBroja(datum)}-`;

// Generator sljedećeg broja dokumenta (npr. "NAR-2026-101") koji gleda postojeće brojeve umjesto nasumičnog broja — sprječava duplikate
export const sljedeciBroj = (lista, polje, prefiks, sirina = 3) => {
  const brojevi = (lista || []).map((x) => x?.[polje]).filter((b) => b && b.startsWith(prefiks)).map((b) => parseInt(b.slice(prefiks.length), 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 0) + 1;
  return `${prefiks}${String(sljedeci).padStart(sirina, "0")}`;
};

// Upit nabave: "GG-NNN" (npr. "26-059"). Numeriranje 2026. nastavlja ranije papirnate/Excel upite od 58 (prvi u aplikaciji je 26-059);
// svaka sljedeća godina kreće od 001.
const POCETNI_BROJ_UPITA = { 26: 58 };
export const sljedeciBrojUpita = (upiti, datum = new Date()) => {
  const god = String(godinaBroja(datum)).slice(-2);
  const brojevi = (upiti || []).filter((u) => u?.broj && u.broj.startsWith(`${god}-`)).map((u) => parseInt(u.broj.split("-")[1], 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : (POCETNI_BROJ_UPITA[Number(god)] ?? 0)) + 1;
  return `${god}-${String(sljedeci).padStart(3, "0")}`;
};

// Cijena ponude: satnice rada samo za jednu ponudu i popust. Čiste funkcije bez ovisnosti o aplikaciji (provjere: ponudaCijena.test.js).

// Satnice rada koje vrijede za ponudu: zadani Cjenik rada, a satnice upisane samo na ponudi (ponuda.satniceRada, po ključu operacije)
// imaju prednost. Prazna ili nebrojčana vrijednost se ignorira (operacija ostaje na zadanoj satnici iz cjenika).
export const cjenikZaPonudu = (ponuda, cjenikRada) => {
  const rezultat = { ...(cjenikRada || {}) };
  for (const [kljuc, v] of Object.entries(ponuda?.satniceRada || {})) {
    if (v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) rezultat[kljuc] = n;
  }
  return rezultat;
};

// Operacije kojima je na ponudi upisana vlastita satnica (različita od cjenika ili izričito postavljena).
export const prilagodjeneSatnice = (ponuda) => Object.entries(ponuda?.satniceRada || {})
  .filter(([, v]) => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0)
  .map(([kljuc]) => kljuc);

// Postotak popusta ponude: 0–100 (neispravan unos = bez popusta).
export const postotakPopustaPonude = (ponuda) => {
  const n = Number(ponuda?.postotakPopusta);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
};

// Popust na iznos (cijena ponude prije popusta): { postotak, iznos, nakon }.
export const primijeniPopust = (iznos, ponuda) => {
  const prije = Number(iznos) || 0;
  const postotak = postotakPopustaPonude(ponuda);
  const popust = prije * (postotak / 100);
  return { postotak, iznos: popust, nakon: prije - popust };
};

// Postotak za prikaz u ispisu (zarez kao decimalni znak: 7,5).
export const tekstPostotka = (p) => String(Math.round((Number(p) || 0) * 100) / 100).replace(".", ",");

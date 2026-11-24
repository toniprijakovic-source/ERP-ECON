// Fotografije utovara: čiste pomoćne funkcije (dimenzije, grupiranje za karticu projekta, adresa QR veze) i sažimanje slike u pregledniku.
// Sažimanje je jedini dio koji treba preglednik (canvas); ostalo se testira u utovarFotografije.test.js.

export const NAJVISE_STRANA_SLIKE = 1600; // px, duža strana sažete slike
export const NAJVISE_STRANA_SLICICE = 240;
export const NAJVECA_SLIKA_BAJTOVA = 2_800_000; // poslužitelj prima do 3 MB; ostavlja se malo mjesta
export const KVALITETA_SLIKE = 0.72;
export const KVALITETA_SLICICE = 0.6;

// Nove dimenzije tako da duža strana nije veća od maxStrana (nikad se ne povećava).
export function skalirajDimenzije(sirina, visina, maxStrana) {
  const s = Number(sirina) || 0, v = Number(visina) || 0;
  if (s <= 0 || v <= 0) return { sirina: 0, visina: 0 };
  const faktor = Math.min(1, maxStrana / Math.max(s, v));
  return { sirina: Math.max(1, Math.round(s * faktor)), visina: Math.max(1, Math.round(v * faktor)) };
}

// Adresa koju QR kod otvara na mobitelu (origin + putanja aplikacije + ?utovar=<token>).
export const adresaUtovara = (origin, pathname, token) => `${origin}${pathname || "/"}?utovar=${encodeURIComponent(token)}`;
export const tokenIzUpita = (search) => new URLSearchParams(search || "").get("utovar") || "";

// Stanje jedne slike prema mostu: "spremljeno" (na Z:), "greska" (most javio grešku, pokušava ponovno), "ceka" (most je još nije preuzeo).
export const stanjeSlike = (s) => (s?.spremljenoZ ? "spremljeno" : s?.greskaZ ? "greska" : "ceka");
export const NAZIV_STANJA = { spremljeno: "na Z:", ceka: "čeka most", greska: "greška pri spremanju" };

// Skupine po datumu utovara (najnoviji prvi), unutar njih po otpremnici; svaka skupina ima zbroj stanja i prvu grešku mosta.
export function grupirajPoDatumu(slike) {
  const poDatumu = new Map();
  for (const s of slike || []) {
    if (!poDatumu.has(s.datum)) poDatumu.set(s.datum, new Map());
    const po = poDatumu.get(s.datum);
    if (!po.has(s.otpremnica)) po.set(s.otpremnica, []);
    po.get(s.otpremnica).push(s);
  }
  return [...poDatumu.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([datum, otp]) => {
    const otpremnice = [...otp.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), "hr", { numeric: true })).map(([broj, popis]) => ({ broj, slike: [...popis].sort((a, b) => a.redni - b.redni) }));
    const sve = otpremnice.flatMap((o) => o.slike);
    const spremljeno = sve.filter((s) => stanjeSlike(s) === "spremljeno").length;
    const greske = sve.filter((s) => stanjeSlike(s) === "greska");
    return { datum, otpremnice, ukupno: sve.length, spremljeno, ceka: sve.length - spremljeno - greske.length, greske: greske.length, prvaGreska: greske[0]?.greskaZ || "", stanje: spremljeno === sve.length ? "spremljeno" : greske.length ? "greska" : "ceka" };
  });
}

const uBase64 = (buf) => {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
};
const platno = (izvor, sirina, visina) => {
  const c = document.createElement("canvas");
  c.width = sirina; c.height = visina;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, sirina, visina);
  ctx.drawImage(izvor, 0, 0, sirina, visina);
  return c;
};
const uJpeg = (c, kvaliteta) => new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Slika se nije mogla obraditi."))), "image/jpeg", kvaliteta));
async function ucitajSliku(datoteka) {
  // imageOrientation "from-image" okreće sliku prema EXIF oznaci mobitela (inače bi okomite fotografije ležale na boku)
  if (typeof createImageBitmap === "function") {
    try { const bmp = await createImageBitmap(datoteka, { imageOrientation: "from-image" }); return { izvor: bmp, sirina: bmp.width, visina: bmp.height, zatvori: () => bmp.close?.() }; } catch { /* starije verzije preglednika: sljedeći način */ }
  }
  const url = URL.createObjectURL(datoteka);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("Datoteka nije slika.")); i.src = url; });
    return { izvor: img, sirina: img.naturalWidth, visina: img.naturalHeight, zatvori: () => {} };
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

// Sažima fotografiju s mobitela: JPEG do 1600 px (i sličica 240 px), oboje kao base64 za slanje. Prevelika slika (rijetko) se dodatno smanjuje.
export async function sazmiSliku(datoteka) {
  const { izvor, sirina, visina, zatvori } = await ucitajSliku(datoteka);
  try {
    let strana = NAJVISE_STRANA_SLIKE, kvaliteta = KVALITETA_SLIKE, blob = null;
    for (let pokusaj = 0; pokusaj < 4; pokusaj++) {
      const d = skalirajDimenzije(sirina, visina, strana);
      blob = await uJpeg(platno(izvor, d.sirina, d.visina), kvaliteta);
      if (blob.size <= NAJVECA_SLIKA_BAJTOVA) break;
      strana = Math.round(strana * 0.8); kvaliteta = Math.max(0.5, kvaliteta - 0.07);
    }
    if (blob.size > NAJVECA_SLIKA_BAJTOVA) throw new Error("Slika je prevelika.");
    const ds = skalirajDimenzije(sirina, visina, NAJVISE_STRANA_SLICICE);
    const mala = await uJpeg(platno(izvor, ds.sirina, ds.visina), KVALITETA_SLICICE);
    return { slika: uBase64(await blob.arrayBuffer()), slicica: uBase64(await mala.arrayBuffer()), velicina: blob.size };
  } finally { zatvori(); }
}

// Fotografije utovara: slike koje su radnici snimili mobitelom (QR kod s otpremnice → ERP) sprema u mapu projekta na Z:
//   <mapa projekta>\Fotografije - Utovar\<datum utovara>\utovar_<datum>_<otpremnica>_<nn>.jpg
// Sigurnosna pravila: samo JPEG (provjera potpisa), samo naziv i datum u dopuštenom obliku (nema putanja ni ..), pisanje samo unutar mape projekta,
// postojeća datoteka se nikad ne prepisuje (ista slika = već spremljeno, drukčiji sadržaj = _v2). U probnom načinu ništa ne ide na Z:.
import fs from "node:fs";
import path from "node:path";
import { Greska } from "./pretvori.js";
import { nadjiMapuProjekta } from "./mapa.js";

export const MAPA_UTOVARA = "Fotografije - Utovar";
const NAZIV_OBLIK = /^utovar_\d{4}-\d{2}-\d{2}_[A-Za-z0-9_-]{1,40}_\d{2,3}\.jpg$/;
const DATUM_OBLIK = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const jeJpeg = (b) => Buffer.isBuffer(b) && b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const sigurnaSifra = (s) => String(s || "projekt").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "projekt";

// slika = { sifra, mapa, datum, naziv } iz ERP-a; bajtovi = sadržaj JPEG-a. Vraća { putanja, vecPostojala }.
export function spremiUtovarSliku(slika, bajtovi, okolina) {
  if (!NAZIV_OBLIK.test(String(slika?.naziv || ""))) throw new Greska(`Neispravan naziv datoteke: ${String(slika?.naziv).slice(0, 80)}`);
  if (!DATUM_OBLIK.test(String(slika?.datum || ""))) throw new Greska(`Neispravan datum utovara: ${String(slika?.datum).slice(0, 20)}`);
  if (!jeJpeg(bajtovi)) throw new Greska("Sadržaj nije JPEG slika.");
  if (!String(slika?.sifra || "").trim()) throw new Greska("Slika nema šifru projekta.");
  const mapaUtovara = String(okolina.postavke?.mapaUtovara || MAPA_UTOVARA);
  // Probno: ništa se ne piše na Z:, nego u proba-izlaz; mapu projekta ne treba tražiti.
  const mapaProjekta = okolina.probno ? path.join(okolina.probnoIzlaz, "utovar", sigurnaSifra(slika.sifra)) : nadjiMapuProjekta(okolina.korijen, slika.sifra, slika.mapa);
  const mapaDatuma = path.join(mapaProjekta, mapaUtovara, slika.datum);
  const relativno = path.relative(mapaProjekta, mapaDatuma);
  if (relativno.startsWith("..") || path.isAbsolute(relativno)) throw new Greska("Odredišna mapa nije unutar mape projekta.");
  fs.mkdirSync(mapaDatuma, { recursive: true });
  const osnova = slika.naziv.slice(0, -4);
  for (let v = 1; v <= 20; v++) {
    const putanja = path.join(mapaDatuma, v === 1 ? slika.naziv : `${osnova}_v${v}.jpg`);
    try {
      fs.writeFileSync(putanja, bajtovi, { flag: "wx" });
      return { putanja, vecPostojala: false };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (fs.statSync(putanja).size === bajtovi.length && fs.readFileSync(putanja).equals(bajtovi)) return { putanja, vecPostojala: true }; // ista slika već je tu (ponovljen pokušaj)
    }
  }
  throw new Greska(`U mapi ${mapaDatuma} već postoji previše različitih datoteka s nazivom ${slika.naziv}.`);
}

// Jedan krug: preuzmi slike koje čekaju, spremi ih i javi ERP-u rezultat (spremljeno ili greška). Greška jedne slike ne zaustavlja ostale.
// api(metoda, ruta, tijelo) i bajtovi(ruta) su poziv prema ERP-u. Vraća broj slika koje su bile u redu.
export async function obradiUtovar(api, bajtovi, okolina, log = () => {}) {
  const { slike } = await api("GET", "/api/most/utovar/cekaju");
  for (const s of slike || []) {
    let rezultat;
    try {
      const sadrzaj = await bajtovi(`/api/most/utovar/slika/${encodeURIComponent(s.id)}`);
      const r = spremiUtovarSliku(s, sadrzaj, okolina);
      if (okolina.probno) {
        log(`Utovar ${s.sifra} ${s.datum}: ${s.naziv} → ${r.putanja} [PROBNO — ništa nije spremljeno na Z:]`);
        rezultat = { status: "greska", poruka: "Probni način mosta: slika je spremljena samo u mapu proba-izlaz, ne na Z:." };
      } else {
        log(`Utovar ${s.sifra} ${s.datum}: ${s.naziv} → ${r.putanja}${r.vecPostojala ? " (već postojala)" : ""}`);
        rezultat = { status: "spremljeno", putanja: r.putanja };
      }
    } catch (e) {
      const poruka = e instanceof Greska ? e.message : `Neočekivana greška: ${e.message}`;
      log(`Utovar ${s.sifra} ${s.datum}: ${s.naziv} → GREŠKA: ${poruka}`);
      rezultat = { status: "greska", poruka };
    }
    await api("POST", `/api/most/utovar/slika/${encodeURIComponent(s.id)}/rezultat`, rezultat);
  }
  return (slike || []).length;
}

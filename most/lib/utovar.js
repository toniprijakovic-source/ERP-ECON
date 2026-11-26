// Fotografije koje radnici snimaju mobitelom (QR kod → ERP) most sprema u mapu projekta na Z:
//   utovar:  <mapa projekta>\Fotografije - Utovar\<datum utovara>\utovar_<datum>_<otpremnica>_<nn>.jpg
//   montaža: <mapa projekta>\Fotografije - Montaža\<oznaka pozicije>\<datum>_<oznaka>_<nn>.jpg
//   (projekti s novom strukturom mapa: unutar "05 Isporuka" odnosno "06 Montaža", vidi RODITELJ_FOTOGRAFIJA)
// Sigurnosna pravila: samo JPEG (provjera potpisa), samo naziv, datum i oznaka u dopuštenom obliku (nema putanja ni ..), pisanje samo unutar mape projekta,
// mapa projekta se nikad ne stvara sama, postojeća datoteka se nikad ne prepisuje (ista slika = već spremljeno, drukčiji sadržaj = _v2). U probnom načinu ništa ne ide na Z:.
import fs from "node:fs";
import path from "node:path";
import { Greska } from "./pretvori.js";
import { nadjiMapuProjekta } from "./mapa.js";

export const MAPA_UTOVARA = "Fotografije - Utovar";
export const MAPA_MONTAZE = "Fotografije - Montaža";
const NAZIV_UTOVARA = /^utovar_\d{4}-\d{2}-\d{2}_[A-Za-z0-9_-]{1,40}_\d{2,3}\.jpg$/;
const OZNAKA = /^[A-Za-z0-9čćžšđČĆŽŠĐ][A-Za-z0-9čćžšđČĆŽŠĐ._-]{0,39}$/; // isti oblik kao "mapa" pozicije u ERP-u (backend/montaza.js)
const REZERVIRANA = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const DATUM_OBLIK = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const jeJpeg = (b) => Buffer.isBuffer(b) && b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const sigurnaSifra = (s) => String(s || "projekt").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "projekt";

// Projekti s novom strukturom mapa (lib/dokumenti.js) drže fotografije u svojoj fazi: utovar u "05 Isporuka", montažu u "06 Montaža".
// Ako u korijenu projekta već postoji stara mapa fotografija (projekt prije nove strukture), slike idu i dalje tamo.
export const RODITELJ_FOTOGRAFIJA = { utovar: "05 Isporuka", montaza: "06 Montaža" };
const mapaFotografija = (mapaProjekta, glavnaMapa, roditelj) => {
  if (!roditelj || fs.existsSync(path.join(mapaProjekta, glavnaMapa)) || !fs.existsSync(path.join(mapaProjekta, roditelj))) return path.join(mapaProjekta, glavnaMapa);
  return path.join(mapaProjekta, roditelj, glavnaMapa);
};

// Zajednički dio: provjera, mapa projekta, pisanje bez prepisivanja. podmapa = naziv mape unutar glavne mape (datum ili oznaka).
function spremi(slika, bajtovi, okolina, glavnaMapa, podmapa, roditelj = "") {
  if (!jeJpeg(bajtovi)) throw new Greska("Sadržaj nije JPEG slika.");
  if (!String(slika?.sifra || "").trim()) throw new Greska("Slika nema šifru projekta.");
  // Probno: ništa se ne piše na Z:, nego u proba-izlaz; mapu projekta ne treba tražiti.
  const mapaProjekta = okolina.probno ? path.join(okolina.probnoIzlaz, "foto", sigurnaSifra(slika.sifra)) : nadjiMapuProjekta(okolina.korijen, slika.sifra, slika.mapa);
  const mapaOdredista = path.join(mapaFotografija(mapaProjekta, glavnaMapa, roditelj), podmapa);
  const relativno = path.relative(mapaProjekta, mapaOdredista);
  if (relativno.startsWith("..") || path.isAbsolute(relativno)) throw new Greska("Odredišna mapa nije unutar mape projekta.");
  fs.mkdirSync(mapaOdredista, { recursive: true });
  const osnova = slika.naziv.slice(0, -4);
  for (let v = 1; v <= 20; v++) {
    const putanja = path.join(mapaOdredista, v === 1 ? slika.naziv : `${osnova}_v${v}.jpg`);
    try {
      fs.writeFileSync(putanja, bajtovi, { flag: "wx" });
      return { putanja, vecPostojala: false };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (fs.statSync(putanja).size === bajtovi.length && fs.readFileSync(putanja).equals(bajtovi)) return { putanja, vecPostojala: true }; // ista slika već je tu (ponovljen pokušaj)
    }
  }
  throw new Greska(`U mapi ${mapaOdredista} već postoji previše različitih datoteka s nazivom ${slika.naziv}.`);
}

// Utovar: slika = { sifra, mapa, datum, naziv } iz ERP-a. Vraća { putanja, vecPostojala }.
export function spremiUtovarSliku(slika, bajtovi, okolina) {
  if (!NAZIV_UTOVARA.test(String(slika?.naziv || ""))) throw new Greska(`Neispravan naziv datoteke: ${String(slika?.naziv).slice(0, 80)}`);
  if (!DATUM_OBLIK.test(String(slika?.datum || ""))) throw new Greska(`Neispravan datum utovara: ${String(slika?.datum).slice(0, 20)}`);
  return spremi(slika, bajtovi, okolina, String(okolina.postavke?.mapaUtovara || MAPA_UTOVARA), slika.datum, RODITELJ_FOTOGRAFIJA.utovar);
}

// Montaža: slika = { sifra, mapa, pozicija, datum, naziv }; mapa slika ide u podmapu s oznakom pozicije (npr. J-3.OG).
export function spremiMontaznuSliku(slika, bajtovi, okolina) {
  const poz = String(slika?.pozicija || "");
  if (!OZNAKA.test(poz) || /[.]$/.test(poz) || REZERVIRANA.test(poz)) throw new Greska(`Neispravna oznaka pozicije: ${poz.slice(0, 60)}`);
  if (!DATUM_OBLIK.test(String(slika?.datum || ""))) throw new Greska(`Neispravan datum: ${String(slika?.datum).slice(0, 20)}`);
  const naziv = String(slika?.naziv || "");
  if (!/^[^\\/:*?"<>|]{1,120}\.jpg$/.test(naziv) || !naziv.startsWith(`${slika.datum}_${poz}_`) || !/_\d{2,3}\.jpg$/.test(naziv)) throw new Greska(`Neispravan naziv datoteke: ${naziv.slice(0, 80)}`);
  return spremi(slika, bajtovi, okolina, String(okolina.postavke?.mapaMontaze || MAPA_MONTAZE), poz, RODITELJ_FOTOGRAFIJA.montaza);
}

// Jedan krug: preuzmi slike koje čekaju, spremi ih i javi ERP-u rezultat (spremljeno ili greška). Greška jedne slike ne zaustavlja ostale.
async function obradiRed(api, bajtovi, okolina, log, o) {
  const { slike } = await api("GET", o.cekaju);
  for (const s of slike || []) {
    let rezultat;
    try {
      const sadrzaj = await bajtovi(`${o.slika}/${encodeURIComponent(s.id)}`);
      const r = o.spremi(s, sadrzaj, okolina);
      if (okolina.probno) {
        log(`${o.opis(s)} → ${r.putanja} [PROBNO — ništa nije spremljeno na Z:]`);
        rezultat = { status: "greska", poruka: "Probni način mosta: slika je spremljena samo u mapu proba-izlaz, ne na Z:." };
      } else {
        log(`${o.opis(s)} → ${r.putanja}${r.vecPostojala ? " (već postojala)" : ""}`);
        rezultat = { status: "spremljeno", putanja: r.putanja };
      }
    } catch (e) {
      const poruka = e instanceof Greska ? e.message : `Neočekivana greška: ${e.message}`;
      log(`${o.opis(s)} → GREŠKA: ${poruka}`);
      rezultat = { status: "greska", poruka };
    }
    await api("POST", `${o.slika}/${encodeURIComponent(s.id)}/rezultat`, rezultat);
  }
  return (slike || []).length;
}

// api(metoda, ruta, tijelo) i bajtovi(ruta) su pozivi prema ERP-u. Vraćaju broj slika koje su bile u redu.
export const obradiUtovar = (api, bajtovi, okolina, log = () => {}) => obradiRed(api, bajtovi, okolina, log, {
  cekaju: "/api/most/utovar/cekaju", slika: "/api/most/utovar/slika", spremi: spremiUtovarSliku, opis: (s) => `Utovar ${s.sifra} ${s.datum}: ${s.naziv}`,
});
export const obradiMontazu = (api, bajtovi, okolina, log = () => {}) => obradiRed(api, bajtovi, okolina, log, {
  cekaju: "/api/most/montaza/cekaju", slika: "/api/most/montaza/slika", spremi: spremiMontaznuSliku, opis: (s) => `Montaža ${s.sifra} ${s.pozicija}: ${s.naziv}`,
});

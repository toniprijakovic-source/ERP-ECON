// Nesukladnosti (ISO 9001): most sprema PDF obrasca i slike u <mapa nesukladnosti>\<godina>\<NN-GG RN …>\
//   npr. Z:\Econ_ISO\ISO9001-ISO14001\5 Zapisi\P4,5,6 Upravljanje nesukladnostima, popravne\2026\46-26 RN 170-313\Nesukladnosti i popravne radnje 46-26.pdf
// Korijenska mapa se nikad ne stvara sama (mora postojati); mapa godine i nesukladnosti se stvaraju. PDF se ZAMJENJUJE novijim (isti zapis iz ERP-a),
// slike se nikad ne prepisuju (_v2). Samo PDF/JPEG/PNG s ispravnim potpisom i nazivi u dogovorenom obliku. U probnom načinu ništa ne ide na Z:.
import fs from "node:fs";
import path from "node:path";
import { Greska } from "./pretvori.js";

export const ZADANA_MAPA_NESUKLADNOSTI = "Z:/Econ_ISO/ISO9001-ISO14001/5 Zapisi/P4,5,6 Upravljanje nesukladnostima, popravne";
const MAPA = /^\d{2,3}-\d{2}( [^\\/:*?"<>|\u0000-\u001F]{1,70})?$/;
const NAZIV_PDF = /^Nesukladnosti i popravne radnje \d{2,3}-\d{2}\.pdf$/;
const NAZIV_SLIKE = /^\d{2,3}-\d{2}_\d{2,3}\.(jpg|png)$/;
const vrsta = (b) => (!Buffer.isBuffer(b) || b.length < 8 ? null : b.slice(0, 5).toString() === "%PDF-" ? "pdf"
  : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg" : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? "png" : null);

// d = { vrsta: "pdf"|"slika", godina, mapa, naziv } iz ERP-a. Vraća { putanja, vecPostojala }.
export function spremiDatotekuNesukladnosti(d, bajtovi, okolina) {
  const godina = Number(d?.godina);
  if (!Number.isInteger(godina) || godina < 2000 || godina > 2100) throw new Greska(`Neispravna godina: ${String(d?.godina).slice(0, 10)}`);
  const mapa = String(d?.mapa || "");
  if (!MAPA.test(mapa) || /[. ]$/.test(mapa) || mapa.includes("..")) throw new Greska(`Neispravan naziv mape nesukladnosti: ${mapa.slice(0, 80)}`);
  const naziv = String(d?.naziv || "");
  const jePdf = d?.vrsta === "pdf";
  if (jePdf ? !NAZIV_PDF.test(naziv) : !NAZIV_SLIKE.test(naziv)) throw new Greska(`Neispravan naziv datoteke: ${naziv.slice(0, 80)}`);
  const brojDio = mapa.split(" ")[0]; // "46-26"
  if (jePdf ? naziv !== `Nesukladnosti i popravne radnje ${brojDio}.pdf` : !naziv.startsWith(`${brojDio}_`)) throw new Greska("Naziv datoteke ne odgovara broju nesukladnosti.");
  const v = vrsta(bajtovi);
  if (jePdf ? v !== "pdf" : v !== naziv.slice(-3)) throw new Greska(jePdf ? "Sadržaj nije PDF." : "Sadržaj nije slika navedene vrste.");
  const korijen = okolina.probno ? path.join(okolina.probnoIzlaz, "nesukladnosti") : path.normalize(String(okolina.korijenNesukladnosti || ZADANA_MAPA_NESUKLADNOSTI));
  if (okolina.probno) fs.mkdirSync(korijen, { recursive: true });
  if (!fs.existsSync(korijen)) throw new Greska(`Mapa nesukladnosti nije dostupna: ${korijen} (je li Z: spojen?)`);
  const odrediste = path.join(korijen, String(godina), mapa);
  const rel = path.relative(korijen, odrediste);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Greska("Odredišna mapa nije unutar mape nesukladnosti.");
  fs.mkdirSync(odrediste, { recursive: true });
  if (jePdf) { // zamjena: prvo privremena datoteka, pa preimenovanje preko stare (PDF otvoren u pregledniku → greška, most pokuša ponovno kasnije)
    const putanja = path.join(odrediste, naziv);
    if (fs.existsSync(putanja) && fs.readFileSync(putanja).equals(bajtovi)) return { putanja, vecPostojala: true };
    const privremena = path.join(odrediste, `.${naziv}.${process.pid}.tmp`);
    fs.writeFileSync(privremena, bajtovi);
    try { fs.renameSync(privremena, putanja); } catch (e) { try { fs.unlinkSync(privremena); } catch { /* ostaje */ } throw new Greska(`PDF se ne može zamijeniti (je li otvoren?): ${putanja}`); }
    return { putanja, vecPostojala: false };
  }
  const osnova = naziv.slice(0, -4), nast = naziv.slice(-4);
  for (let n = 1; n <= 20; n++) {
    const putanja = path.join(odrediste, n === 1 ? naziv : `${osnova}_v${n}${nast}`);
    try { fs.writeFileSync(putanja, bajtovi, { flag: "wx" }); return { putanja, vecPostojala: false }; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (fs.statSync(putanja).size === bajtovi.length && fs.readFileSync(putanja).equals(bajtovi)) return { putanja, vecPostojala: true };
    }
  }
  throw new Greska(`U mapi ${odrediste} već postoji previše različitih datoteka s nazivom ${naziv}.`);
}

// Jedan krug: preuzmi što čeka (PDF-ovi i slike), spremi i javi rezultat. Greška jedne datoteke ne zaustavlja ostale.
export async function obradiNesukladnosti(api, bajtovi, okolina, log = () => {}) {
  const { datoteke } = await api("GET", "/api/most/nesukladnosti/cekaju");
  for (const d of datoteke || []) {
    let rezultat;
    const opis = `Nesukladnost ${d.mapa}: ${d.naziv}`;
    try {
      const sadrzaj = await bajtovi(`/api/most/nesukladnosti/datoteka/${d.vrsta === "pdf" ? "pdf" : "slika"}/${encodeURIComponent(d.id)}`);
      const r = spremiDatotekuNesukladnosti(d, sadrzaj, okolina);
      if (okolina.probno) { log(`${opis} → ${r.putanja} [PROBNO — ništa nije spremljeno na Z:]`); rezultat = { status: "greska", poruka: "Probni način mosta: datoteka je spremljena samo u mapu proba-izlaz, ne na Z:." }; }
      else { log(`${opis} → ${r.putanja}${r.vecPostojala ? " (već postojala)" : ""}`); rezultat = { status: "spremljeno", putanja: r.putanja, verzija: d.verzija }; }
    } catch (e) {
      const poruka = e instanceof Greska ? e.message : `Neočekivana greška: ${e.message}`;
      log(`${opis} → GREŠKA: ${poruka}`);
      rezultat = { status: "greska", poruka };
    }
    await api("POST", `/api/most/nesukladnosti/rezultat/${d.vrsta === "pdf" ? "pdf" : "slika"}/${encodeURIComponent(d.id)}`, rezultat);
  }
  return (datoteke || []).length;
}

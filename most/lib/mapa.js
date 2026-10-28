// Pronalazak mape projekta na Z: i najnovijeg Konplastovog XML računa u njezinoj mapi Fakture.
import fs from "node:fs";
import path from "node:path";
import { Greska, procitajKonplast } from "./pretvori.js";

const izbjegni = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Mapa projekta: ručno upisana putanja iz ERP-a ("Mapa projekta") ako postoji, inače mapa u korijenu čije ime počinje šifrom
// projekta (npr. "RN 170-208_B&O F-O2_Quartier ...").
export function nadjiMapuProjekta(korijen, sifra, zadanaMapa) {
  if (zadanaMapa) {
    const p = path.normalize(zadanaMapa);
    if (!fs.existsSync(p)) throw new Greska(`Mapa projekta iz ERP-a ne postoji ili nije dostupna na ovom računalu: ${p}`);
    return p;
  }
  if (!fs.existsSync(korijen)) throw new Greska(`Korijenska mapa projekata nije dostupna: ${korijen} (je li Z: spojen?)`);
  const re = new RegExp(`^${izbjegni(sifra)}(?:[_ ]|$)`, "i");
  const pogodci = fs.readdirSync(korijen, { withFileTypes: true }).filter((d) => d.isDirectory() && re.test(d.name));
  if (!pogodci.length) throw new Greska(`U ${korijen} nema mape čije ime počinje s "${sifra}".`);
  if (pogodci.length > 1) throw new Greska(`Za šifru "${sifra}" postoji više mapa (${pogodci.map((d) => d.name).join("; ")}). U ERP-u upiši "Mapa projekta" na projektu.`);
  return path.join(korijen, pogodci[0].name);
}

// Mape izlaznih računa u mapi projekta: svaka čije ime je jedno od zadanih (postavke.json → mapeRacuna, npr. Fakture, Rechnungen,
// Rechnung) ili počinje njime uz razmak/_/- (npr. "Fakture 2026"). Mape poput "Računi plaćeni preko B&O" nisu na popisu pa se ne gledaju.
export function nadjiMapeRacuna(mapaProjekta, imena) {
  const osnove = imena.map((i) => i.toLowerCase());
  const mape = fs.readdirSync(mapaProjekta, { withFileTypes: true })
    .filter((e) => e.isDirectory() && osnove.some((o) => { const n = e.name.toLowerCase(); return n === o || (n.startsWith(o) && /[\s_-]/.test(n[o.length])); }))
    .map((e) => path.join(mapaProjekta, e.name));
  if (!mape.length) throw new Greska(`U mapi projekta nema mape računa (traži se: ${imena.join(", ")}): ${mapaProjekta}`);
  return mape;
}

// Svi XML računi ispod zadanih mapa (do 4 razine), osim izlaznih mapa "XRechnung*". Najnoviji je onaj s najkasnijim datumom računa.
// Svaki zapis pamti i mapu računa (mapaRacuna) u kojoj je pronađen — uz nju stoji kumulativ.json.
export function nadjiRacune(mapeRacuna) {
  const rezultat = [];
  for (const mapaRacuna of mapeRacuna) {
    const obidi = (dir, dubina) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (dubina < 4 && !/^xrechnung/i.test(e.name)) obidi(p, dubina + 1); continue; }
        if (!/\.xml$/i.test(e.name)) continue;
        try {
          const r = procitajKonplast(fs.readFileSync(p, "utf8"));
          if (r.broj && r.datum && r.linije.length) rezultat.push({ putanja: p, mapaRacuna, broj: r.broj, datum: r.datum, vrijeme: r.vrijeme, mtime: fs.statSync(p).mtimeMs });
        } catch { /* nije račun — preskoči */ }
      }
    };
    obidi(mapaRacuna, 0);
  }
  return rezultat.sort((a, b) => `${b.datum}${b.vrijeme}`.localeCompare(`${a.datum}${a.vrijeme}`) || b.mtime - a.mtime);
}

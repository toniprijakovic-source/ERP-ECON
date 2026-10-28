// Zadaci iz ERP-a za postavke kumulativa jednog projekta: čitanje i spremanje kumulativ.json u mapu računa projekta.
// kumulativ.json stoji uz račune (u mapi računa u kojoj je najnoviji XML račun, ili gdje već postoji) — most ga i sam nadopunjuje.
import fs from "node:fs";
import path from "node:path";
import { Greska } from "./pretvori.js";
import { nadjiMapuProjekta, nadjiMapeRacuna, nadjiRacune } from "./mapa.js";
import { provjeriKumulativ } from "./kumulativ.js";

function nadjiMjesto(z, okolina) {
  const mapaProjekta = nadjiMapuProjekta(okolina.korijen, z.sifra, z.mapa);
  const mape = nadjiMapeRacuna(mapaProjekta, okolina.postavke.mapeRacuna || ["Fakture"]);
  const racuni = nadjiRacune(mape);
  const postojeca = mape.find((m) => fs.existsSync(path.join(m, "kumulativ.json")));
  return { mapaProjekta, mape, racuni, mapa: postojeca || racuni[0]?.mapaRacuna || mape[0], postoji: !!postojeca };
}

export async function citajKumulativ(z, okolina) {
  const m = nadjiMjesto(z, okolina);
  const datoteka = path.join(m.mapa, "kumulativ.json");
  let kumulativ = null;
  if (m.postoji) {
    try { kumulativ = JSON.parse(fs.readFileSync(datoteka, "utf8")); } catch (e) { throw new Greska(`kumulativ.json nije ispravan JSON (${datoteka}): ${e.message}`); }
  }
  const zadnji = m.racuni[0] ? { broj: m.racuni[0].broj, datum: m.racuni[0].datum } : null;
  return {
    status: "Gotovo", kumulativ, mapaKumulativa: m.mapa, zadnjiRacun: zadnji,
    poruke: [m.postoji ? `Učitano: ${path.relative(m.mapaProjekta, datoteka)}` : `Za ovaj projekt još nema kumulativ.json (bit će spremljen u ${path.relative(m.mapaProjekta, m.mapa)}).`],
  };
}

export async function spremiKumulativ(z, okolina) {
  let cfg;
  try { cfg = provjeriKumulativ({ projekt: z.sifra, ...z.kumulativ }); } catch (e) { throw new Greska(e.message); }
  const m = nadjiMjesto(z, okolina);
  // U probnom načinu ništa se ne piše u mape projekta — datoteka ide u probnu mapu.
  const cilj = okolina.probno ? path.join(okolina.probnoIzlaz, z.sifra.replace(/\s+/g, "-")) : m.mapa;
  fs.mkdirSync(cilj, { recursive: true });
  const datoteka = path.join(cilj, "kumulativ.json");
  const poruke = [];
  if (fs.existsSync(datoteka)) {
    const oznaka = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const kopija = `${datoteka}.bak-${oznaka}`;
    fs.copyFileSync(datoteka, kopija);
    poruke.push(`Dosadašnja datoteka je sačuvana kao ${path.basename(kopija)}.`);
  }
  fs.writeFileSync(datoteka, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  poruke.push(`Kumulativ spremljen: ${datoteka}${okolina.probno ? " (probni način)" : ""}`);
  return { status: "Gotovo", kumulativ: cfg, mapaKumulativa: cilj, poruke };
}

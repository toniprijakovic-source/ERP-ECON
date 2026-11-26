// Izvještaj mosta o serveru za ERP (Direktorski pregled → Stanje servera): pogon Z:, korijeni projekata, sigurnosne kopije
// (zadnja kopija, zadnja greška, probna obnova) i slobodan prostor. Most ga šalje svake minute (POST /api/most/stanje), a ERP
// iz njega javlja upozorenja u zvonce (backend/stanje-servera.js). Sve se samo ČITA — most ovdje ništa ne mijenja.
// Mapa kopija: MAPA_KOPIJA u .env (npr. Z:/ECON_ERP/Kopije) — ista mapa kao BACKUP_MAPA programa za kopije (backup-sef.js).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERZIJA_MOSTA = "2026-11-27";

const citajJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const gb = (bajtova) => Math.round((bajtova / 1e9) * 10) / 10;

// Slobodan i ukupan prostor diska na kojem je putanja (null ako se ne može pročitati).
export function prostor(putanja, statfs = fs.statfsSync) {
  try {
    const s = statfs(putanja);
    return { slobodnoGB: gb(Number(s.bavail) * Number(s.bsize)), ukupnoGB: gb(Number(s.blocks) * Number(s.bsize)) };
  } catch { return null; }
}

// Zadnja greška iz zapisnika kopija (redak "[vrijeme] GREŠKA: …" koji piše backup-sef.js) — čita se samo kraj datoteke.
export function zadnjaGreskaKopije(zapisnik) {
  let tekst;
  try {
    const fd = fs.openSync(zapisnik, "r");
    try {
      const velicina = fs.fstatSync(fd).size;
      const duljina = Math.min(velicina, 64 * 1024);
      const buf = Buffer.alloc(duljina);
      fs.readSync(fd, buf, 0, duljina, velicina - duljina);
      tekst = buf.toString("utf8");
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  const redovi = tekst.split(/\r?\n/).filter((r) => /^\[[^\]]+\] GREŠKA: /.test(r));
  if (!redovi.length) return null;
  const m = /^\[([^\]]+)\] GREŠKA: (.*)$/.exec(redovi[redovi.length - 1]);
  return { vrijeme: m[1], poruka: m[2].slice(0, 400) };
}

// Stanje kopija iz mape kopija: zadnja-kopija.json i probna-obnova.json (piše ih backup-sef.js / probna-obnova.js) i zapisnik.log.
export function stanjeKopija(mapa) {
  if (!mapa) return { podeseno: false };
  if (!fs.existsSync(mapa)) return { podeseno: true, mapa, dostupna: false };
  const z = citajJson(path.join(mapa, "zadnja-kopija.json"));
  const o = citajJson(path.join(mapa, "probna-obnova.json"));
  return {
    podeseno: true, mapa, dostupna: true,
    zadnja: z ? { vrijeme: z.vrijeme, naziv: z.naziv, velicinaKB: z.velicinaKB, kljuceva: z.kljuceva, tablice: z.tablice, dnevna: z.dnevna, mjesecna: z.mjesecna, poruke: z.poruke } : null,
    greska: zadnjaGreskaKopije(path.join(mapa, "zapisnik.log")),
    obnova: o ? { ok: o.ok, vrijeme: o.vrijeme, kopija: o.kopija, trajanjeMs: o.trajanjeMs, kljuceva: o.kljuceva, tablice: o.tablice, poruke: o.poruke, greska: o.greska } : null,
  };
}

// Cijeli izvještaj. pogoni: [{ slovo, ok, opis }] (stanje spajanja pogona iz most.js); korijeni: popis korijena projekata.
export function prikupiStanje({ korijeni = [], mapaKopija = "", pogoni = [], pokrenut, probno = false, statfs } = {}) {
  const kop = stanjeKopija(mapaKopija);
  // Prostor po disku: korijen svake putanje (Z:\, D:\ …), bez ponavljanja.
  const diskovi = [];
  for (const p of [...korijeni.filter((k) => fs.existsSync(k)).slice(0, 1), ...(kop.dostupna ? [mapaKopija] : [])]) {
    const oznaka = path.parse(path.resolve(p)).root.replace(/\\$/, "");
    if (diskovi.some((d) => d.oznaka === oznaka)) continue;
    const pr = prostor(p, statfs);
    if (pr) diskovi.push({ oznaka, ...pr });
  }
  return {
    verzija: VERZIJA_MOSTA, racunalo: os.hostname(), pokrenut, probno, sat: new Date().toISOString(), // sat servera: ERP iz njega računa pomak
    pogoni, korijeni: korijeni.map((k) => ({ putanja: k, postoji: fs.existsSync(k) })), diskovi, kopije: kop,
  };
}

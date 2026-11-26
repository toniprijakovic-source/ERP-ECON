// Izvještaj mosta o serveru (lib/stanje.js) i automatska mapa projekta (lib/mape-projekata.js) — na privremenoj mapi, bez ERP-a i bez Z:.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stanjeKopija, zadnjaGreskaKopije, prikupiStanje, prostor, VERZIJA_MOSTA } from "../lib/stanje.js";
import { pronadjiMape, uskladiMapeProjekata } from "../lib/mape-projekata.js";

let neuspjeh = 0;
const provjeri = (uvjet, opis) => { console.log(`${uvjet ? "OK " : "NE!"} ${opis}`); if (!uvjet) neuspjeh++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "econ-stanje-"));
const zapisi = (rel, sadrzaj) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, sadrzaj); return p; };

try {
  // ---- kopije ----
  provjeri(stanjeKopija("").podeseno === false, "mapa kopija nije podešena → podeseno: false");
  const nema = stanjeKopija(path.join(dir, "nema"));
  provjeri(nema.podeseno && nema.dostupna === false, "nepostojeća mapa kopija → dostupna: false");
  const kop = path.join(dir, "Kopije");
  fs.mkdirSync(kop);
  let s = stanjeKopija(kop);
  provjeri(s.dostupna && s.zadnja === null && s.greska === null && s.obnova === null, "prazna mapa kopija: nema zadnje kopije, greške ni obnove");
  zapisi("Kopije/zadnja-kopija.json", JSON.stringify({ ok: true, vrijeme: "2026-11-26T08:15:01.000Z", naziv: "backup-2026-11-26_091501.sef", velicinaKB: 231.4, kljuceva: 49, tablice: { login_log: 600 }, dnevna: false, mjesecna: false, poruke: [], obrisanoSatnih: 1 }));
  zapisi("Kopije/probna-obnova.json", JSON.stringify({ ok: true, vrijeme: "2026-11-26T08:15:09.000Z", kopija: "backup-2026-11-26_072301.sef", trajanjeMs: 5200, kljuceva: 49, tablice: { login_log: 590 }, poruke: [], greska: "" }));
  zapisi("Kopije/zapisnik.log", [
    "[2026-11-26T06:15:01.000Z] backup-x.sef | 230 KB šifrirano | 49 ključeva",
    "[2026-11-26T07:15:00.000Z] GREŠKA: Connection terminated unexpectedly",
    "[2026-11-26T08:15:01.000Z] backup-y.sef | 231 KB šifrirano | 49 ključeva",
    "    UPOZORENJE: prethodna kopija je stara 2.0 h",
  ].join("\r\n") + "\r\n");
  s = stanjeKopija(kop);
  provjeri(s.zadnja?.naziv === "backup-2026-11-26_091501.sef" && s.zadnja.kljuceva === 49 && !("obrisanoSatnih" in s.zadnja), "zadnja kopija iz zadnja-kopija.json (samo potrebna polja)");
  provjeri(s.obnova?.ok === true && s.obnova.kopija === "backup-2026-11-26_072301.sef", "probna obnova iz probna-obnova.json");
  provjeri(s.greska?.vrijeme === "2026-11-26T07:15:00.000Z" && s.greska.poruka === "Connection terminated unexpectedly", "zadnja greška iz zapisnika (CRLF)");
  provjeri(zadnjaGreskaKopije(path.join(dir, "nema.log")) === null, "nema zapisnika → nema greške");
  // dugi zapisnik: čita se samo kraj, greška na kraju se nađe
  zapisi("Kopije2/zapisnik.log", "x".repeat(200 * 1024) + "\n[2026-11-26T09:15:00.000Z] GREŠKA: zadnja\n");
  provjeri(zadnjaGreskaKopije(path.join(dir, "Kopije2", "zapisnik.log"))?.poruka === "zadnja", "veliki zapisnik: greška s kraja");
  zapisi("Kopije/zadnja-kopija.json", "{ pokvareno");
  provjeri(stanjeKopija(kop).zadnja === null, "pokvaren zadnja-kopija.json → kao da je nema (ne ruši most)");

  // ---- prostor i cijeli izvještaj ----
  provjeri(prostor(dir) && prostor(dir).ukupnoGB > 0, "prostor diska se čita (statfs)");
  provjeri(prostor(dir, () => { throw new Error("x"); }) === null, "greška statfs → null");
  const korijenProj = path.join(dir, "Projekti");
  fs.mkdirSync(korijenProj);
  const iz = prikupiStanje({ korijeni: [korijenProj, path.join(dir, "Nema")], mapaKopija: kop, pogoni: [{ slovo: "Z:", ok: true, opis: "Pogon Z: je dostupan." }], pokrenut: "2026-11-26T06:00:00.000Z", probno: false });
  provjeri(iz.verzija === VERZIJA_MOSTA && iz.racunalo === os.hostname() && iz.pokrenut === "2026-11-26T06:00:00.000Z", "izvještaj: verzija, računalo, vrijeme pokretanja");
  provjeri(iz.korijeni.map((k) => k.postoji).join(",") === "true,false", "izvještaj: koji korijeni projekata postoje");
  provjeri(iz.diskovi.length === 1 && iz.diskovi[0].oznaka === path.parse(dir).root.replace(/\\$/, ""), "izvještaj: jedan disk (korijen i kopije na istom disku)");
  provjeri(iz.kopije.podeseno && iz.pogoni[0].slovo === "Z:", "izvještaj: kopije i pogoni");
  provjeri(Math.abs(Date.parse(iz.sat) - Date.now()) < 5000, "izvještaj nosi sat servera (za pomak sata u ERP-u)");

  // ---- mape projekata ----
  fs.mkdirSync(path.join(korijenProj, "RN 170-901_Kupac_Opis"));
  fs.mkdirSync(path.join(korijenProj, "RN 170-9010_Drugi"));
  fs.mkdirSync(path.join(korijenProj, "RN 170-902_A"));
  fs.mkdirSync(path.join(korijenProj, "RN 170-902_B"));
  const projekti = [{ id: "p1", sifra: "RN 170-901" }, { id: "p2", sifra: "RN 170-902" }, { id: "p3", sifra: "RN 170-903" }, { id: "p4", sifra: "" }];
  let r = pronadjiMape(projekti, [path.join(dir, "Nema"), korijenProj]);
  provjeri(r.pronadjene.length === 1 && r.pronadjene[0].projektId === "p1" && r.pronadjene[0].mapa === path.join(korijenProj, "RN 170-901_Kupac_Opis"), "pronađena točno mapa RN 170-901 (ne RN 170-9010)");
  provjeri(r.nepronadjene.map((x) => x.projektId).join(",") === "p2,p3" && /više mapa/.test(r.nepronadjene[0].razlog) && r.nepronadjene[1].razlog === 'Nema mape čije ime počinje s "RN 170-903" (traženo u projektima tekuće i dvije prethodne godine).', "dvije mape iste šifre i nepostojeća mapa → nepronađeno s razlogom; bez šifre se preskače");
  provjeri(pronadjiMape(projekti, [path.join(dir, "Nema")]) === null, "nijedan korijen nije dostupan → null (ERP-u se ništa ne javlja)");

  const pozivi = [];
  const lazniApi = async (metoda, ruta, tijelo) => {
    pozivi.push({ metoda, ruta, tijelo });
    if (ruta === "/api/most/projekti-bez-mape") return { projekti };
    if (ruta === "/api/most/projekti/mapa") return { ok: true, upisano: tijelo.pronadjene.map((x) => ({ projektId: x.projektId, sifra: "RN 170-901", mapa: x.mapa })) };
    throw new Error("neočekivana ruta");
  };
  const zapisnik = [];
  let u = await uskladiMapeProjekata(lazniApi, { korijen: [korijenProj], probno: false }, (...a) => zapisnik.push(a.join(" ")));
  const poslano = pozivi.find((x) => x.ruta === "/api/most/projekti/mapa")?.tijelo;
  provjeri(poslano?.pronadjene.length === 1 && !("sifra" in poslano.pronadjene[0]) && poslano.nepronadjene.length === 2, "ERP-u se šalju pronađene (id + mapa) i nepronađene (s razlogom)");
  provjeri(u.upisano.length === 1 && zapisnik.some((z) => z.startsWith("Mapa projekta upisana u ERP: RN 170-901")), "upisana mapa ide u zapisnik mosta");
  pozivi.length = 0;
  u = await uskladiMapeProjekata(lazniApi, { korijen: [korijenProj], probno: true }, (...a) => zapisnik.push(a.join(" ")));
  provjeri(!pozivi.some((x) => x.metoda === "POST") && zapisnik.some((z) => z.startsWith("[PROBNO]")), "probni način: ništa se ne upisuje u ERP");
  pozivi.length = 0;
  u = await uskladiMapeProjekata(lazniApi, { korijen: [path.join(dir, "Nema")], probno: false }, () => {});
  provjeri(u.nedostupno === true && !pozivi.some((x) => x.metoda === "POST"), "korijen nedostupan (Z: nije spojen): ništa se ne javlja");
  u = await uskladiMapeProjekata(async () => ({ projekti: [] }), { korijen: [korijenProj], probno: false }, () => {});
  provjeri(u.upisano.length === 0, "nema projekata bez mape: ništa se ne radi");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(neuspjeh ? `\n${neuspjeh} provjera NIJE prošlo.` : "\nSve provjere stanja i mapa projekata prošle.");
process.exit(neuspjeh ? 1 : 0);

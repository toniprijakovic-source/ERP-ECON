// Provjera prije preseljenja mosta na server: pokreće se JEDNOM pod računom pod kojim će most raditi (npr. ECON\svc-erp),
// preko instaliraj-zadatke-na-serveru.ps1 -Sto provjera. Ništa trajno ne mijenja:
//   - spaja pogone iz MAPIRAJ_POGONE (samo za ovu sesiju), čita korijene projekata i mapu nesukladnosti;
//   - u jednoj projektnoj mapi i u mapi nesukladnosti stvori pa odmah obriše privremenu mapu/datoteku (~erp-most-provjera-…);
//   - postojeću datoteku koju je stvorio netko drugi samo OTVORI za pisanje i zatvori (ništa ne upisuje, sadržaj i datum ostaju);
//   - pokrene priloženu Javu (java -version) i provjeri vezu s ERP-om (javna ruta /api/vrijeme; NE preuzima zadatke).
// Ispis ide na ekran i u provjera-prava.txt. Izlazni kod 0 = sve u redu, 1 = ima problema.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { korijeniProjekata } from "./lib/mapa.js";
import { procitajMapiranja, osigurajPogone, opisPogona } from "./lib/pogoni.js";
import { ZADANA_MAPA_NESUKLADNOSTI } from "./lib/nesukladnosti.js";

const mapaMosta = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(mapaMosta, ".env")); } catch { /* bez .env: zadane vrijednosti */ }
const postavke = JSON.parse(fs.readFileSync(path.join(mapaMosta, "postavke.json"), "utf8"));
const API = (process.env.ERP_API_URL || "").replace(/\/$/, "");

const redovi = [];
let problema = 0;
const ispis = (t) => { redovi.push(t); console.log(t); };
const stavka = (ok, tekst, kriticno = true) => {
  if (!ok && kriticno) problema++;
  ispis(`${ok ? "[OK]        " : kriticno ? "[PROBLEM]   " : "[UPOZORENJE]"} ${tekst}`);
};
const oznaka = `~erp-most-provjera-${crypto.randomBytes(4).toString("hex")}`;
const greska = (e) => `${e.code || ""} ${e.message}`.trim().slice(0, 200);

ispis(`Provjera prava za most — ${new Date().toLocaleString("hr-HR")}`);
ispis(`Račun: ${process.env.USERDOMAIN || "?"}\\${process.env.USERNAME || "?"} | Node ${process.version} | mapa mosta: ${mapaMosta}`);
ispis(`MOST_PROBNO=${process.env.MOST_PROBNO ?? "(nije zadano)"}`);
ispis("");

// 1. Pogoni
let mapiranja = [];
try { mapiranja = procitajMapiranja(process.env.MAPIRAJ_POGONE); stavka(true, `MAPIRAJ_POGONE: ${mapiranja.length ? mapiranja.map((m) => `${m.slovo}=${m.cilj}`).join(" ; ") : "(prazno — pogoni moraju već postojati)"}`); }
catch (e) { stavka(false, e.message); }
for (const r of osigurajPogone(mapiranja)) stavka(r.stanje !== "greska", opisPogona(r));

// 2. Korijeni projekata (čitanje)
const korijeni = korijeniProjekata(process.env.KORIJEN_PROJEKTI);
let projektnaMapa = null;
let dostupnih = 0;
for (const k of korijeni) {
  if (!fs.existsSync(k)) { ispis(`             (ne postoji, preskačem: ${k})`); continue; }
  try {
    const mape = fs.readdirSync(k, { withFileTypes: true }).filter((d) => d.isDirectory() && /^RN /i.test(d.name));
    dostupnih++;
    stavka(true, `čitanje: ${k} (${mape.length} projektnih mapa)`);
    if (!projektnaMapa && mape.length) projektnaMapa = path.join(k, mape[0].name);
  } catch (e) { stavka(false, `čitanje: ${k} — ${greska(e)}`); }
}
stavka(dostupnih > 0, `barem jedan korijen projekata je dostupan (${korijeni.join(" ; ")})`);

// 3. Stvaranje i brisanje u projektnoj mapi (kao "Fotografije - Utovar\<datum>")
const probajStvoriti = (mapa, opis) => {
  const dir = path.join(mapa, oznaka);
  try {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "proba.txt"), "privremena datoteka provjere mosta — briše se odmah\r\n");
    fs.rmSync(dir, { recursive: true, force: true });
    stavka(!fs.existsSync(dir), `stvaranje i brisanje mape/datoteke: ${opis}`);
  } catch (e) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ostaje za ručno brisanje */ }
    stavka(false, `stvaranje i brisanje mape/datoteke: ${opis} — ${greska(e)}${fs.existsSync(dir) ? ` (OSTALO ZA RUČNO BRISANJE: ${dir})` : ""}`);
  }
};
if (projektnaMapa) probajStvoriti(projektnaMapa, projektnaMapa); else stavka(false, "nema projektne mape za probu pisanja");

// 4. Mapa nesukladnosti
const korijenNes = path.normalize(String(process.env.KORIJEN_NESUKLADNOSTI || postavke.mapaNesukladnosti || ZADANA_MAPA_NESUKLADNOSTI));
if (fs.existsSync(korijenNes)) { stavka(true, `mapa nesukladnosti postoji: ${korijenNes}`); probajStvoriti(korijenNes, "mapa nesukladnosti"); }
else stavka(false, `mapa nesukladnosti nije dostupna: ${korijenNes}`);

// 5. Postojeća datoteka koju je stvorio netko drugi (most na računalu vlasnika): treba pravo izmjene (PDF nesukladnosti se zamjenjuje,
//    kumulativ.json se prepisuje, XRechnung premješta datoteke). Samo otvaranje za pisanje — ništa se ne upisuje.
const nadjiDatoteku = (pocetak, dubina, uzorak) => {
  let nadjeno = null;
  const obidi = (dir, d) => {
    if (nadjeno || d > dubina) return;
    let ulazi = [];
    try { ulazi = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ulazi) { if (nadjeno) return; if (e.isFile() && uzorak.test(e.name)) nadjeno = path.join(dir, e.name); }
    for (const e of ulazi) if (e.isDirectory() && !e.name.startsWith("~erp-most-provjera")) obidi(path.join(dir, e.name), d + 1);
  };
  obidi(pocetak, 0);
  return nadjeno;
};
const kandidati = [];
if (fs.existsSync(korijenNes)) kandidati.push(() => nadjiDatoteku(korijenNes, 3, /^Nesukladnosti i popravne radnje .*\.pdf$/i));
for (const k of korijeni.filter((x) => fs.existsSync(x))) {
  let mape = [];
  try { mape = fs.readdirSync(k, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(k, d.name)); } catch { /* preskoči */ }
  for (const m of mape) kandidati.push(() => (fs.existsSync(path.join(m, "Fotografije - Utovar")) ? nadjiDatoteku(path.join(m, "Fotografije - Utovar"), 2, /^utovar_.*\.jpg$/i) : null));
}
let postojeca = null;
for (const k of kandidati) { postojeca = k(); if (postojeca) break; }
if (postojeca) {
  try { const fd = fs.openSync(postojeca, "r+"); fs.closeSync(fd); stavka(true, `pravo izmjene postojeće datoteke: ${postojeca}`); }
  catch (e) { stavka(false, `pravo izmjene postojeće datoteke: ${postojeca} — ${greska(e)} (računu treba pravo Modify na projektne mape i mapu nesukladnosti)`); }
} else stavka(false, "pravo izmjene postojeće datoteke: nije pronađena datoteka za probu (PDF nesukladnosti ili fotografija utovara)", false);

// 6. Java (XRechnung provjera)
const alatiJava = path.join(mapaMosta, "alati", "java");
const jdk = fs.existsSync(alatiJava) ? fs.readdirSync(alatiJava).find((d) => fs.existsSync(path.join(alatiJava, d, "bin", "java.exe"))) : null;
const java = process.env.JAVA_EXE || (jdk ? path.join(alatiJava, jdk, "bin", "java.exe") : "java");
const j = spawnSync(java, ["-version"], { encoding: "utf8", timeout: 60_000, windowsHide: true });
stavka(j.status === 0, `Java se pokreće: ${java}${j.status === 0 ? ` (${String(j.stderr || j.stdout).split(/\r?\n/)[0]})` : ` — ${j.error ? greska(j.error) : `izlazni kod ${j.status}`}`}`);

// 7. Veza s ERP-om (javna ruta, bez tokena; zadaci se NE preuzimaju)
try {
  const r = await fetch(`${API}/api/vrijeme`, { signal: AbortSignal.timeout(30_000) });
  const t = await r.json().catch(() => ({}));
  stavka(r.ok, `veza s ERP-om: ${API}/api/vrijeme → HTTP ${r.status}${t.verzija ? ` (verzija ${t.verzija})` : ""}`);
} catch (e) { stavka(false, `veza s ERP-om: ${API || "(ERP_API_URL nije zadan)"} — ${greska(e)}`); }
stavka((process.env.MOST_TOKEN || "").length >= 24, "MOST_TOKEN je popunjen (najmanje 24 znaka; vrijednost se ne ispisuje)");

ispis("");
ispis(problema ? `REZULTAT: ${problema} problem(a) — most NE premještati dok se ne riješi.` : "REZULTAT: sve provjere prošle.");
try { fs.writeFileSync(path.join(mapaMosta, "provjera-prava.txt"), `﻿${redovi.join("\r\n")}\r\n`, "utf8"); } catch { /* ispis na ekranu je dovoljan */ }
// Bez process.exit(): na Windowsima izlaz dok se zatvara HTTP veza (fetch) ruši Node (UV_HANDLE_CLOSING); proces završi sam.
process.exitCode = problema ? 1 : 0;

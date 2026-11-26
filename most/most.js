// ECON most: povezuje ERP (na internetu) s mapom Fakture na Z:. Samo se JAVLJA ERP-u (izlazna veza), ne otvara nikakav ulaz.
// Svakih nekoliko sekundi pita ERP ima li zadataka "Kreiraj XRechnung", obradi ih lokalno i vrati rezultat.
// Pokretanje: node most.js   (postavke u .env, vidi .env.example)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Greska } from "./lib/pretvori.js";
import { obradi } from "./lib/obradi.js";
import { citajKumulativ, spremiKumulativ } from "./lib/kumulativ-zadaci.js";
import { popisXRechnunga, obrisiXRechnung } from "./lib/xrechnung-popis.js";
import { korijeniProjekata } from "./lib/mapa.js";
import { obradiUtovar, obradiMontazu } from "./lib/utovar.js";
import { obradiNesukladnosti } from "./lib/nesukladnosti.js";
import { procitajMapiranja, osigurajPogone, opisPogona } from "./lib/pogoni.js";
import { prikupiStanje } from "./lib/stanje.js";
import { uskladiMapeProjekata } from "./lib/mape-projekata.js";

const mapaMosta = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(mapaMosta, ".env")); } catch { /* .env nije obavezan ako su varijable već postavljene */ }

const API = (process.env.ERP_API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.MOST_TOKEN || "";
if (!API || TOKEN.length < 24) { console.error("Postavi ERP_API_URL i MOST_TOKEN (najmanje 24 znaka) u most/.env — vidi .env.example."); process.exit(1); }

const nadjiJavu = () => {
  if (process.env.JAVA_EXE) return process.env.JAVA_EXE;
  const dir = path.join(mapaMosta, "alati", "java");
  const jdk = fs.existsSync(dir) ? fs.readdirSync(dir).find((d) => fs.existsSync(path.join(dir, d, "bin", "java.exe"))) : null;
  return jdk ? path.join(dir, jdk, "bin", "java.exe") : "java";
};
const okolina = {
  korijen: korijeniProjekata(process.env.KORIJEN_PROJEKTI), // popis korijena: tekuća godina i dvije prethodne (vidi lib/mapa.js)
  probno: process.env.MOST_PROBNO === "1",
  probnoIzlaz: path.join(mapaMosta, "proba-izlaz"),
  primjeri: path.join(mapaMosta, "primjeri"),
  java: nadjiJavu(),
  jar: path.join(mapaMosta, "alati", "validator.jar"),
  konfig: path.join(mapaMosta, "alati", "konfig"),
  postavke: JSON.parse(fs.readFileSync(path.join(mapaMosta, "postavke.json"), "utf8")),
};
// Mapa nesukladnosti (ISO zapisi): KORIJEN_NESUKLADNOSTI iz .env ili postavke.json → mapaNesukladnosti (mora postojati; most stvara samo podmape godine i nesukladnosti).
okolina.korijenNesukladnosti = process.env.KORIJEN_NESUKLADNOSTI || okolina.postavke.mapaNesukladnosti || "";
// Mapa sigurnosnih kopija (ista kao BACKUP_MAPA programa za kopije) — most iz nje samo čita stanje kopija za ERP (Stanje servera).
const mapaKopija = process.env.MAPA_KOPIJA || okolina.postavke.mapaKopija || "";
const pokrenut = new Date().toISOString();

// Ispis ide na konzolu i u most-zapisnik.log (UTF-8; pri 1 MB se stari zapisnik premjesti u .old).
const datotekaZapisnika = path.join(mapaMosta, "most-zapisnik.log");
const log = (...a) => {
  const redak = `${new Date().toLocaleString("hr-HR")} ${a.join(" ")}`;
  console.log(redak);
  try {
    if (fs.existsSync(datotekaZapisnika) && fs.statSync(datotekaZapisnika).size > 1_000_000) fs.renameSync(datotekaZapisnika, `${datotekaZapisnika}.old`);
    fs.appendFileSync(datotekaZapisnika, `${redak}\n`, "utf8");
  } catch { /* zapisnik nije kritičan */ }
};
async function api(metoda, ruta, tijelo) {
  const res = await fetch(`${API}${ruta}`, { method: metoda, headers: { "Content-Type": "application/json", "X-Most-Token": TOKEN }, body: tijelo ? JSON.stringify(tijelo) : undefined });
  if (!res.ok) throw new Error(`${metoda} ${ruta} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Preuzimanje datoteke (fotografije utovara) kao bajtovi.
async function apiBajtovi(ruta) {
  const res = await fetch(`${API}${ruta}`, { headers: { "X-Most-Token": TOKEN } });
  if (!res.ok) throw new Error(`GET ${ruta} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function obradiZadatak(z) {
  const vrsta = z.vrsta || "xrechnung";
  log(`Zadatak ${z.id.slice(0, 8)}: ${z.sifra} (${vrsta})${okolina.probno ? " [PROBNO — ništa se ne piše na Z:]" : ""}`);
  let rezultat;
  try {
    rezultat = vrsta === "kumulativ-citaj" ? await citajKumulativ(z, okolina)
      : vrsta === "kumulativ-spremi" ? await spremiKumulativ(z, okolina)
      : vrsta === "xrechnung-popis" ? await popisXRechnunga(z, okolina)
      : vrsta === "xrechnung-obrisi" ? await obrisiXRechnung(z, okolina)
      : await obradi(z, okolina);
  } catch (e) {
    if (!(e instanceof Greska)) console.error(e);
    rezultat = { status: "Greška", poruke: [e instanceof Greska ? e.message : `Neočekivana greška: ${e.message}`] };
  }
  log(`  → ${rezultat.status}${rezultat.validacija ? ` (provjera: ${rezultat.validacija.ocjena})` : ""}`);
  await api("POST", `/api/most/zadaci/${z.id}/rezultat`, rezultat);
}

// Na serveru (servisni račun bez spojenih pogona) most sam spaja Z: za svoju sesiju — vidi lib/pogoni.js i MAPIRAJ_POGONE u .env.
// Provjera najviše jednom u minuti; u zapisnik ide samo promjena stanja.
let mapiranja = [];
try { mapiranja = procitajMapiranja(process.env.MAPIRAJ_POGONE); } catch (e) { log(e.message); process.exit(1); }
const stanjePogona = new Map();
let zadnjaProvjeraPogona = 0;
const provjeriPogone = () => {
  if (!mapiranja.length || Date.now() - zadnjaProvjeraPogona < 60_000) return;
  zadnjaProvjeraPogona = Date.now();
  for (const r of osigurajPogone(mapiranja)) {
    const opis = opisPogona(r);
    if (stanjePogona.get(r.slovo)?.opis !== opis) log(opis);
    stanjePogona.set(r.slovo, { opis, ok: r.stanje !== "greska" });
  }
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(signal, () => { log(`Primljen signal ${signal} — most staje.`); process.exit(0); });
log(`ECON most pokrenut. ERP: ${API} | Korijen: ${okolina.korijen.join(" ; ")} | Java: ${okolina.java}${mapaKopija ? ` | Kopije: ${mapaKopija}` : ""}${okolina.probno ? " | PROBNI NAČIN" : ""}${mapiranja.length ? ` | Pogoni: ${mapiranja.map((m) => `${m.slovo}=${m.cilj}`).join(" ; ")}` : ""}`);
let greskaPrijavljena = false;
let greskaUtovaraPrijavljena = false;
// Izvještaj o serveru svake minute i traženje mapa projekata svakih 10 minuta (greška se u zapisnik upisuje jednom, do oporavka).
let zadnjeStanje = 0, zadnjeMape = 0;
let greskaStanja = false, greskaMapa = false;
for (;;) {
  provjeriPogone();
  try {
    const { zadaci } = await api("GET", "/api/most/zadaci");
    greskaPrijavljena = false;
    for (const z of zadaci) await obradiZadatak(z);
  } catch (e) {
    if (!greskaPrijavljena) log("Veza s ERP-om nije uspjela:", e.message);
    greskaPrijavljena = true;
  }
  // Fotografije utovara i montaže (mobitel → ERP → mapa projekta na Z:): zasebno od zadataka, da greška jednog ne zaustavi drugo.
  try {
    await obradiUtovar(api, apiBajtovi, okolina, log);
    await obradiMontazu(api, apiBajtovi, okolina, log);
    await obradiNesukladnosti(api, apiBajtovi, okolina, log);
    greskaUtovaraPrijavljena = false;
  } catch (e) {
    if (!greskaUtovaraPrijavljena && !greskaPrijavljena) log("Fotografije (utovar/montaža): veza s ERP-om nije uspjela:", e.message);
    greskaUtovaraPrijavljena = true;
  }
  if (Date.now() - zadnjeStanje >= 60_000) {
    zadnjeStanje = Date.now();
    try {
      const pogoni = [...stanjePogona.entries()].map(([slovo, x]) => ({ slovo, ok: x.ok, opis: x.opis }));
      await api("POST", "/api/most/stanje", prikupiStanje({ korijeni: okolina.korijen, mapaKopija, pogoni, pokrenut, probno: okolina.probno }));
      greskaStanja = false;
    } catch (e) {
      if (!greskaStanja && !greskaPrijavljena) log("Izvještaj o serveru: slanje ERP-u nije uspjelo:", e.message);
      greskaStanja = true;
    }
  }
  if (Date.now() - zadnjeMape >= 10 * 60_000) {
    zadnjeMape = Date.now();
    try {
      await uskladiMapeProjekata(api, okolina, log);
      greskaMapa = false;
    } catch (e) {
      if (!greskaMapa && !greskaPrijavljena) log("Mape projekata: nije uspjelo:", e.message);
      greskaMapa = true;
    }
  }
  await new Promise((r) => setTimeout(r, 5000));
}

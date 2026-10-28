// ECON most: povezuje ERP (na internetu) s mapom Fakture na Z:. Samo se JAVLJA ERP-u (izlazna veza), ne otvara nikakav ulaz.
// Svakih nekoliko sekundi pita ERP ima li zadataka "Kreiraj XRechnung", obradi ih lokalno i vrati rezultat.
// Pokretanje: node most.js   (postavke u .env, vidi .env.example)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Greska } from "./lib/pretvori.js";
import { obradi } from "./lib/obradi.js";

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
  korijen: process.env.KORIJEN_PROJEKTI || "Z:\\ECON_2026\\ECON_2026\\Econ_2026_Projekti",
  probno: process.env.MOST_PROBNO === "1",
  probnoIzlaz: path.join(mapaMosta, "proba-izlaz"),
  primjeri: path.join(mapaMosta, "primjeri"),
  java: nadjiJavu(),
  jar: path.join(mapaMosta, "alati", "validator.jar"),
  konfig: path.join(mapaMosta, "alati", "konfig"),
  postavke: JSON.parse(fs.readFileSync(path.join(mapaMosta, "postavke.json"), "utf8")),
};

const log = (...a) => console.log(new Date().toLocaleTimeString("hr-HR"), ...a);
async function api(metoda, ruta, tijelo) {
  const res = await fetch(`${API}${ruta}`, { method: metoda, headers: { "Content-Type": "application/json", "X-Most-Token": TOKEN }, body: tijelo ? JSON.stringify(tijelo) : undefined });
  if (!res.ok) throw new Error(`${metoda} ${ruta} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function obradiZadatak(z) {
  log(`Zadatak ${z.id.slice(0, 8)}: ${z.sifra}${okolina.probno ? " [PROBNO — ništa se ne piše na Z:]" : ""}`);
  let rezultat;
  try {
    rezultat = await obradi(z, okolina);
  } catch (e) {
    if (!(e instanceof Greska)) console.error(e);
    rezultat = { status: "Greška", poruke: [e instanceof Greska ? e.message : `Neočekivana greška: ${e.message}`] };
  }
  log(`  → ${rezultat.status}${rezultat.validacija ? ` (provjera: ${rezultat.validacija.ocjena})` : ""}`);
  await api("POST", `/api/most/zadaci/${z.id}/rezultat`, rezultat);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(signal, () => { log(`Primljen signal ${signal} — most staje.`); process.exit(0); });
log(`ECON most pokrenut. ERP: ${API} | Korijen: ${okolina.korijen} | Java: ${okolina.java}${okolina.probno ? " | PROBNI NAČIN" : ""}`);
let greskaPrijavljena = false;
for (;;) {
  try {
    const { zadaci } = await api("GET", "/api/most/zadaci");
    greskaPrijavljena = false;
    for (const z of zadaci) await obradiZadatak(z);
  } catch (e) {
    if (!greskaPrijavljena) log("Veza s ERP-om nije uspjela:", e.message);
    greskaPrijavljena = true;
  }
  await new Promise((r) => setTimeout(r, 5000));
}

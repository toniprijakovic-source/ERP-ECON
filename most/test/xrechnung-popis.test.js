// Popis izrađenih XRechnunga i njihovo "brisanje" (premještanje u _obrisano + uklanjanje iz kumulativa ako je zadnji u nizu).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { obradi } from "../lib/obradi.js";
import { popisXRechnunga, obrisiXRechnung } from "../lib/xrechnung-popis.js";
import { Greska } from "../lib/pretvori.js";

const mapa = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let neuspjeh = 0;
const provjeri = (uvjet, opis) => { console.log(`${uvjet ? "OK " : "NE!"} ${opis}`); if (!uvjet) neuspjeh++; };

const korijen = fs.mkdtempSync(path.join(os.tmpdir(), "econ-popis-"));
try {
  const projekt = path.join(korijen, "RN 666-1_Test", "Rechnungen");
  fs.mkdirSync(projekt, { recursive: true });
  fs.copyFileSync(path.join(mapa, "primjeri", "konplast-107-1-8.xml"), path.join(projekt, "1_26-107-1-8.xml"));
  const cfg = JSON.parse(fs.readFileSync(path.join(mapa, "primjeri", "kumulativ-RN-170-288.json"), "utf8"));
  fs.writeFileSync(path.join(projekt, "kumulativ.json"), JSON.stringify(cfg, null, 2));

  const java = fs.readdirSync(path.join(mapa, "alati", "java")).map((d) => path.join(mapa, "alati", "java", d, "bin", "java.exe")).find((p) => fs.existsSync(p));
  const okolina = { korijen, probno: false, probnoIzlaz: path.join(korijen, "_proba"), primjeri: path.join(mapa, "primjeri"), java, jar: path.join(mapa, "alati", "validator.jar"), konfig: path.join(mapa, "alati", "konfig"), postavke: JSON.parse(fs.readFileSync(path.join(mapa, "postavke.json"), "utf8")) };
  const z = { sifra: "RN 666-1", mapa: "", eAdresa: "platzhalter@example.com", referenca: "", racunBroj: "107/1/8" };

  await obradi({ ...z, racunBroj: "" }, okolina);
  const xr = path.join(projekt, "XRechnung");
  // Datoteke koje NE pripadaju računu 107/1/8 (granica broja, tuđa datoteka) — moraju ostati netaknute
  fs.writeFileSync(path.join(xr, "XRechnung_1107-1-8_Ansicht.pdf"), "x");
  fs.writeFileSync(path.join(xr, "moja-biljeska.txt"), "x");

  const p = await popisXRechnunga(z, okolina);
  const x = p.xrechnungi[0];
  provjeri(p.xrechnungi.length === 1 && x.broj === "107/1/8" && x.valjan && x.zaPlatiti === 104692, `Popis: 1 XRechnung, 107/1/8, valjan, za platiti 104.692,00 (${p.xrechnungi.length})`);
  provjeri(x.eAdresa === "platzhalter@example.com" && /B&O/.test(x.kupac), "Popis pokazuje kupca i e-adresu iz XML-a");
  provjeri(["XRechnung_107-1-8.xml", "XRechnung_107-1-8_Ansicht.pdf", "Zahlungsspezifikation_107-1-8.pdf", "Pruefbericht_107-1-8.html"].every((n) => x.datoteke.includes(n)) && !x.datoteke.includes("XRechnung_1107-1-8_Ansicht.pdf") && !x.datoteke.includes("moja-biljeska.txt"), `Datoteke računa: 4 vlastite, bez tuđih (${x.datoteke.join(", ")})`);

  // Probni način ništa ne dira
  const probno = await obrisiXRechnung(z, { ...okolina, probno: true });
  provjeri(probno.poruke.some((m) => /PROBNO/.test(m)) && fs.existsSync(path.join(xr, "XRechnung_107-1-8.xml")), "Probni način: ništa nije premješteno");

  // Pravo brisanje
  const r = await obrisiXRechnung(z, okolina);
  provjeri(!fs.existsSync(path.join(xr, "XRechnung_107-1-8.xml")) && !fs.existsSync(path.join(xr, "Zahlungsspezifikation_107-1-8.pdf")), "Brisanje: datoteke računa više nisu u mapi XRechnung");
  const obrisano = path.join(xr, "_obrisano");
  const podmapa = fs.readdirSync(obrisano)[0];
  provjeri(fs.readdirSync(path.join(obrisano, podmapa)).length === 4, `Brisanje: 4 datoteke premještene u _obrisano/${podmapa} (ne brišu se trajno)`);
  provjeri(fs.existsSync(path.join(xr, "XRechnung_1107-1-8_Ansicht.pdf")) && fs.existsSync(path.join(xr, "moja-biljeska.txt")), "Brisanje: tuđe datoteke u mapi su netaknute");
  const kum = JSON.parse(fs.readFileSync(path.join(projekt, "kumulativ.json"), "utf8"));
  provjeri(kum.racuni.length === 1 && kum.racuni[0].vrsta === "aconto" && fs.readdirSync(projekt).some((n) => n.startsWith("kumulativ.json.bak-")), "Brisanje: račun uklonjen iz niza kumulativa uz sigurnosnu kopiju");
  provjeri((await popisXRechnunga(z, okolina)).xrechnungi.length === 0, "Nakon brisanja popis je prazan (_obrisano se ne broji)");

  // Ponovna izrada nakon brisanja radi kao prvi put
  const nova = await obradi({ ...z, racunBroj: "" }, okolina);
  provjeri(nova.status === "Valjano" && nova.sazetak.zaPlatiti === 104692, "Ponovna izrada nakon brisanja: Valjano, za platiti 104.692,00");

  // Račun koji nije zadnji u nizu ostaje u kumulativu
  const k2 = JSON.parse(fs.readFileSync(path.join(projekt, "kumulativ.json"), "utf8"));
  k2.racuni.push({ oznaka: "R3", vrsta: "racun", broj: "999/1/8", datum: "2026-12-01", iznos: 1, kumulativ: 150000 });
  fs.writeFileSync(path.join(projekt, "kumulativ.json"), JSON.stringify(k2, null, 2));
  const r2 = await obrisiXRechnung(z, okolina);
  provjeri(r2.poruke.some((m) => /nije zadnji/.test(m)) && JSON.parse(fs.readFileSync(path.join(projekt, "kumulativ.json"), "utf8")).racuni.some((r) => r.broj === "107/1/8"), "Nije zadnji u nizu: ostaje u kumulativ.json, korisnik je obaviješten");

  try { await obrisiXRechnung({ ...z, racunBroj: "5/5/5" }, okolina); provjeri(false, "Nepostojeći račun: trebalo je odbiti"); } catch (e) { provjeri(e instanceof Greska && /nije pronađen/.test(e.message), "Nepostojeći račun: jasna poruka"); }
} finally {
  fs.rmSync(korijen, { recursive: true, force: true });
}
if (neuspjeh) { console.error(`${neuspjeh} provjera nije prošlo.`); process.exit(1); }
console.log("Sve provjere su prošle.");

// Postavljanje kumulativa iz ERP-a: provjera podataka, čitanje i spremanje kumulativ.json u mapu računa, sigurnosna kopija.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { provjeriKumulativ } from "../lib/kumulativ.js";
import { citajKumulativ, spremiKumulativ } from "../lib/kumulativ-zadaci.js";
import { Greska, procitajKonplast, izradi } from "../lib/pretvori.js";

const mapa = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let neuspjeh = 0;
const provjeri = (uvjet, opis) => { console.log(`${uvjet ? "OK " : "NE!"} ${opis}`); if (!uvjet) neuspjeh++; };
const baci = (f, re, opis) => { try { f(); provjeri(false, `${opis}: trebalo je odbiti`); } catch (e) { provjeri(re.test(e.message), `${opis}: odbijeno (${e.message.slice(0, 70)})`); } };

// Podaci kakve šalje obrazac: sve kao tekst, hrvatski zapis brojeva
const obrazac = {
  gesamtauftrag: "176.411,76", vorauszahlung: "52923,53", pozicija: "Balkonanlage",
  racuni: [{ vrsta: "aconto", broj: "6/1/3", datum: "2026-07-10", iznos: "52.923,53" }],
  isporuka: { ulica: "General-Patton-Straße 7-11", posta: "83646", grad: "Bad Tölz", drzava: "de" },
};
const cfg = provjeriKumulativ(obrazac);
provjeri(cfg.gesamtauftrag === 176411.76 && cfg.vorauszahlung === 52923.53 && cfg.racuni[0].iznos === 52923.53, "Brojevi: 176.411,76 / 52923,53 / 52.923,53 pročitani ispravno");
provjeri(cfg.racuni[0].oznaka === "R1" && cfg.isporuka.drzava === "DE", "Oznake R1.. dodijeljene, država velikim slovima");
baci(() => provjeriKumulativ({ ...obrazac, gesamtauftrag: "abc" }), /nije broj/, "Ugovor nije broj");
baci(() => provjeriKumulativ({ ...obrazac, vorauszahlung: "200000" }), /Avans ne smije/, "Avans veći od ugovora");
baci(() => provjeriKumulativ({ ...obrazac, racuni: [{ vrsta: "racun", broj: "1", datum: "10.07.2026", iznos: "1", kumulativ: "1" }] }), /GGGG-MM-DD/, "Krivi oblik datuma");
baci(() => provjeriKumulativ({ ...obrazac, racuni: [{ vrsta: "racun", broj: "1", datum: "2026-01-01", iznos: "10", kumulativ: "100" }, { vrsta: "racun", broj: "2", datum: "2026-02-01", iznos: "10", kumulativ: "50" }] }), /ne smije biti manji/, "Kumulativ koji pada");
baci(() => provjeriKumulativ({ ...obrazac, racuni: [obrazac.racuni[0], obrazac.racuni[0]] }), /više puta/, "Dupli broj računa");

// Projekt na "Z:" (privremeni korijen) s jednim Konplast računom u mapi Rechnungen
const korijen = fs.mkdtempSync(path.join(os.tmpdir(), "econ-kum-"));
try {
  const xmlTekst = fs.readFileSync(path.join(mapa, "primjeri", "konplast-107-1-8.xml"), "utf8");
  fs.mkdirSync(path.join(korijen, "RN 777-1_Test", "Rechnungen"), { recursive: true });
  fs.writeFileSync(path.join(korijen, "RN 777-1_Test", "Rechnungen", "1.xml"), xmlTekst);
  const okolina = { korijen, probno: false, probnoIzlaz: path.join(korijen, "_proba"), postavke: JSON.parse(fs.readFileSync(path.join(mapa, "postavke.json"), "utf8")) };
  const z = { sifra: "RN 777-1", mapa: "" };
  const datoteka = path.join(korijen, "RN 777-1_Test", "Rechnungen", "kumulativ.json");

  const r0 = await citajKumulativ(z, okolina);
  provjeri(r0.kumulativ === null && r0.zadnjiRacun?.broj === "107/1/8" && path.basename(r0.mapaKumulativa) === "Rechnungen", "Čitanje bez datoteke: null, zadnji račun 107/1/8, mapa Rechnungen");

  const r1 = await spremiKumulativ({ ...z, kumulativ: obrazac }, okolina);
  provjeri(r1.status === "Gotovo" && fs.existsSync(datoteka), "Spremanje: kumulativ.json nastaje u mapi računa");
  const spremljeno = JSON.parse(fs.readFileSync(datoteka, "utf8"));
  provjeri(spremljeno.projekt === "RN 777-1" && spremljeno.gesamtauftrag === 176411.76, "Spremljena datoteka ima čiste brojeve i šifru projekta");

  // Izrada računa s tako spremljenim kumulativom daje iznos iz PDF-a kupcu
  const ishod = await izradi(procitajKonplast(xmlTekst), { prodavatelj: okolina.postavke.prodavatelj, eAdresa: "platzhalter@example.com", referenca: "", sifra: "RN 777-1", kumulativ: spremljeno });
  provjeri(ishod.sazetak.zaPlatiti === 104692, "Račun 107/1/8 s tim kumulativom: za platiti 104.692,00");

  const r2 = await spremiKumulativ({ ...z, kumulativ: { ...obrazac, pozicija: "Nova pozicija" } }, okolina);
  const kopije = fs.readdirSync(path.dirname(datoteka)).filter((n) => n.startsWith("kumulativ.json.bak-"));
  provjeri(kopije.length === 1 && r2.poruke.some((p) => /sačuvana/.test(p)), "Ponovno spremanje: stara datoteka sačuvana kao .bak-");
  const r3 = await citajKumulativ(z, okolina);
  provjeri(r3.kumulativ?.pozicija === "Nova pozicija", "Čitanje nakon spremanja vraća novu datoteku");

  // Probni način ne dira mape projekta
  const probno = { ...okolina, probno: true };
  const pocetniSadrzaj = fs.readFileSync(datoteka, "utf8");
  await spremiKumulativ({ ...z, kumulativ: { ...obrazac, pozicija: "PROBA" } }, probno);
  provjeri(fs.readFileSync(datoteka, "utf8") === pocetniSadrzaj && fs.existsSync(path.join(korijen, "_proba", "RN-777-1", "kumulativ.json")), "Probni način: mapa projekta netaknuta, datoteka u probnoj mapi");

  try { await spremiKumulativ({ ...z, kumulativ: { ...obrazac, vorauszahlung: "999999" } }, okolina); provjeri(false, "Neispravni podaci: trebalo je odbiti"); }
  catch (e) { provjeri(e instanceof Greska, "Neispravni podaci prema mostu: Greška s porukom"); }
} finally {
  fs.rmSync(korijen, { recursive: true, force: true });
}
if (neuspjeh) { console.error(`${neuspjeh} provjera nije prošlo.`); process.exit(1); }
console.log("Sve provjere su prošle.");

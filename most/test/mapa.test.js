// Traženje mapa računa i najnovijeg XML računa: Fakture, Rechnungen, Rechnung, "Fakture 2026"; ostale mape se ne gledaju.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nadjiMapuProjekta, nadjiMapeRacuna, nadjiRacune, korijeniProjekata } from "../lib/mapa.js";

const mapa = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const postavke = JSON.parse(fs.readFileSync(path.join(mapa, "postavke.json"), "utf8"));
const uzorak = fs.readFileSync(path.join(mapa, "primjeri", "konplast-13-1-8.xml"), "utf8");
// isti račun s drugim brojem i datumom (da se vidi koji je "najnoviji")
const racun = (broj, datum) => uzorak.replace("<cbc:ID>13/1/8</cbc:ID>", `<cbc:ID>${broj}</cbc:ID>`).replace("<cbc:IssueDate>2026-02-11</cbc:IssueDate>", `<cbc:IssueDate>${datum}</cbc:IssueDate>`);

let neuspjeh = 0;
const provjeri = (uvjet, opis) => { console.log(`${uvjet ? "OK " : "NE!"} ${opis}`); if (!uvjet) neuspjeh++; };
const korijen = fs.mkdtempSync(path.join(os.tmpdir(), "econ-mapa-"));
const zapisi = (rel, sadrzaj) => { const p = path.join(korijen, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, sadrzaj); };

try {
  // projekt A: samo "Rechnungen"
  zapisi("RN 801-1_Samo Rechnungen/Rechnungen/Rechnung Nr. 5/5.xml", racun("5/1/8", "2026-03-01"));
  // projekt B: "Fakture" i "Rechnungen" istodobno, noviji je u Rechnungen; "Računi plaćeni preko B&O" se ne smije gledati
  zapisi("RN 802-1_Obje mape/Fakture/Novo/Rechnung Nr. 1/1.xml", racun("1/1/8", "2026-01-10"));
  zapisi("RN 802-1_Obje mape/Rechnungen/Rechnung Nr. 2/2.xml", racun("2/1/8", "2026-02-20"));
  zapisi("RN 802-1_Obje mape/Računi plaćeni preko B&O/9.xml", racun("9/1/8", "2026-12-31"));
  zapisi("RN 802-1_Obje mape/Fakture/Novo/Rechnung Nr. 1/XRechnung/izlaz.xml", racun("8/1/8", "2026-12-30"));
  // projekt C: "Fakture 2026" i "Rechnung"
  zapisi("RN 803-1_Godina/Fakture 2026/a.xml", racun("7/1/8", "2026-04-01"));
  zapisi("RN 803-1_Godina/Rechnung/b.xml", racun("6/1/8", "2026-03-15"));
  // projekt D: nema mape računa
  zapisi("RN 804-1_Bez mape/Nacrti/x.txt", "x");

  const imena = postavke.mapeRacuna;
  const pA = nadjiMapuProjekta(korijen, "RN 801-1", "");
  provjeri(nadjiRacune(nadjiMapeRacuna(pA, imena))[0]?.broj === "5/1/8", "Rechnungen: račun 5/1/8 pronađen");

  const pB = nadjiMapuProjekta(korijen, "RN 802-1", "");
  const mapeB = nadjiMapeRacuna(pB, imena).map((m) => path.basename(m)).sort();
  provjeri(mapeB.join("|") === "Fakture|Rechnungen", `Obje mape pronađene, "Računi plaćeni preko B&O" izostavljena (${mapeB.join(", ")})`);
  const racuniB = nadjiRacune(nadjiMapeRacuna(pB, imena));
  provjeri(racuniB.map((r) => r.broj).join(",") === "2/1/8,1/1/8", `Najnoviji je 2/1/8 iz Rechnungen; izlazna mapa XRechnung i B&O mapa preskočene (${racuniB.map((r) => r.broj).join(",")})`);
  provjeri(path.basename(racuniB[0].mapaRacuna) === "Rechnungen", "Zapis pamti mapu računa u kojoj je pronađen");

  const pC = nadjiMapuProjekta(korijen, "RN 803-1", "");
  provjeri(nadjiMapeRacuna(pC, imena).map((m) => path.basename(m)).sort().join("|") === "Fakture 2026|Rechnung", "Fakture 2026 i Rechnung pronađene");
  provjeri(nadjiRacune(nadjiMapeRacuna(pC, imena))[0].broj === "7/1/8", "Najnoviji iz više mapa: 7/1/8");

  const pD = nadjiMapuProjekta(korijen, "RN 804-1", "");
  try { nadjiMapeRacuna(pD, imena); provjeri(false, "Projekt bez mape računa: trebalo je odbiti"); } catch (e) { provjeri(/nema mape računa/.test(e.message), `Projekt bez mape računa: jasna poruka (${e.message.slice(0, 50)}…)`); }

  // Prijelaz na novu godinu: korijeni po godinama (Z:/ECON_{godina}/ECON_{godina}/Econ_{godina}_Projekti)
  const popis = (p, god) => korijeniProjekata(p, new Date(god, 0, 4)).map((k) => k.replace(/\\/g, "/"));
  provjeri(popis(undefined, 2027).join("|") === "Z:/ECON_2027/ECON_2027/Econ_2027_Projekti|Z:/ECON_2026/ECON_2026/Econ_2026_Projekti|Z:/ECON_2025/ECON_2025/Econ_2025_Projekti", "Zadano: 2027, 2026, 2025 (tekuća pa dvije prethodne)");
  provjeri(popis("", 2026)[0] === "Z:/ECON_2026/ECON_2026/Econ_2026_Projekti", "Prazna postavka = zadana putanja s tekućom godinom");
  provjeri(popis("D:/srv/Projekti", 2027).join("|") === "D:/srv/Projekti", "Putanja bez {godina} ostaje jedan korijen (stara postavka radi i dalje)");
  provjeri(popis("D:/a/{godina}; E:/b ;;D:/a/{godina}", 2027).join("|") === "D:/a/2027|D:/a/2026|D:/a/2025|E:/b", "Više putanja odvojenih s ';', bez duplikata i praznih");

  const k26 = path.join(korijen, "ECON_2026", "Econ_2026_Projekti"), k27 = path.join(korijen, "ECON_2027", "Econ_2027_Projekti");
  zapisi("ECON_2026/Econ_2026_Projekti/RN 810-1_Iz 2026/Fakture/x.txt", "x");
  zapisi("ECON_2026/Econ_2026_Projekti/RN 812-1_U obje godine/Fakture/x.txt", "x");
  // siječanj 2027.: mapa ECON_2027 još ne postoji → projekt iz 2026. se i dalje nalazi
  const sijecanj = [k27, k26];
  provjeri(nadjiMapuProjekta(sijecanj, "RN 810-1", "") === path.join(k26, "RN 810-1_Iz 2026"), "Mapa 2027. ne postoji: projekt iz 2026. pronađen");
  zapisi("ECON_2027/Econ_2027_Projekti/RN 811-1_Novi 2027/Fakture/x.txt", "x");
  zapisi("ECON_2027/Econ_2027_Projekti/RN 812-1_U obje godine/Fakture/x.txt", "x");
  provjeri(nadjiMapuProjekta(sijecanj, "RN 811-1", "") === path.join(k27, "RN 811-1_Novi 2027"), "Novi projekt u mapi 2027. pronađen");
  provjeri(nadjiMapuProjekta(sijecanj, "RN 810-1", "") === path.join(k26, "RN 810-1_Iz 2026"), "Stari projekt i dalje u mapi 2026.");
  provjeri(nadjiMapuProjekta(sijecanj, "RN 812-1", "") === path.join(k27, "RN 812-1_U obje godine"), "Ista šifra u obje godine: pobjeđuje tekuća godina (prvi korijen)");
  try { nadjiMapuProjekta(sijecanj, "RN 999-9", ""); provjeri(false, "Nepostojeća šifra: trebalo je odbiti"); } catch (e) { provjeri(/nema mape čije ime počinje s "RN 999-9"/.test(e.message) && e.message.includes("ECON_2027") && e.message.includes("ECON_2026"), "Nepostojeća šifra: poruka navodi sve pretražene korijene"); }
  try { nadjiMapuProjekta([path.join(korijen, "nema1"), path.join(korijen, "nema2")], "RN 810-1", ""); provjeri(false, "Nijedan korijen: trebalo je odbiti"); } catch (e) { provjeri(/nije dostupna/.test(e.message) && e.message.includes("nema1") && e.message.includes("nema2"), "Nijedan korijen ne postoji: poruka 'nije dostupna' s oba puta"); }
  zapisi("ECON_2027/Econ_2027_Projekti/RN 813-1_A/x.txt", "x");
  zapisi("ECON_2027/Econ_2027_Projekti/RN 813-1_B/x.txt", "x");
  try { nadjiMapuProjekta(sijecanj, "RN 813-1", ""); provjeri(false, "Dvije mape iste šifre: trebalo je odbiti"); } catch (e) { provjeri(/postoji više mapa/.test(e.message), "Dvije mape iste šifre u jednoj godini: i dalje greška"); }
} finally {
  fs.rmSync(korijen, { recursive: true, force: true });
}
if (neuspjeh) { console.error(`${neuspjeh} provjera nije prošlo.`); process.exit(1); }
console.log("Sve provjere su prošle.");

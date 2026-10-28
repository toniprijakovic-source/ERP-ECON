// Traženje mapa računa i najnovijeg XML računa: Fakture, Rechnungen, Rechnung, "Fakture 2026"; ostale mape se ne gledaju.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nadjiMapuProjekta, nadjiMapeRacuna, nadjiRacune } from "../lib/mapa.js";

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
} finally {
  fs.rmSync(korijen, { recursive: true, force: true });
}
if (neuspjeh) { console.error(`${neuspjeh} provjera nije prošlo.`); process.exit(1); }
console.log("Sve provjere su prošle.");

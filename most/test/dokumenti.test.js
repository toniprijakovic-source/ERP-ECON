// Mape projekata (lib/dokumenti.js): struktura novih projekata, traženje mape (usluge 40-04, preimenovana mapa, "07 Fakture"),
// praćenje promjena (laser, revizije nacrta, mape odobravanja) i fotografije u novoj strukturi — na privremenoj mapi, bez ERP-a i bez Z:.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stvoriStrukturu, uskladiStrukturu, pregledajMapu, usporedi, pratiDokumente, nazivNoveMape, sigurnoIme, kupacKratko, osnovaNaziva, PREDLOSCI, vrstaPredloska } from "../lib/dokumenti.js";
import { nadjiMapuProjekta, nadjiMapeRacuna } from "../lib/mapa.js";
import { spremiUtovarSliku, spremiMontaznuSliku } from "../lib/utovar.js";

let neuspjeh = 0;
const provjeri = (uvjet, opis, detalj) => { console.log(`${uvjet ? "OK " : "NE!"} ${opis}${!uvjet && detalj !== undefined ? `  → ${JSON.stringify(detalj)}` : ""}`); if (!uvjet) neuspjeh++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "econ-dokumenti-"));
const korijen = path.join(dir, "Econ_2026_Projekti");
const korijenStari = path.join(dir, "Econ_2025_Projekti");
fs.mkdirSync(korijen); fs.mkdirSync(korijenStari);
const korijeni = [korijen, korijenStari];
const STARO = Date.now() - 10 * 60_000; // datoteke "smirene" (starije od 2 min)
const zapisi = (p, sadrzaj = "x", mtime = STARO) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, sadrzaj); fs.utimesSync(p, new Date(mtime), new Date(mtime)); return p; };
const postoji = (p) => fs.existsSync(p);

try {
  // ---------------- nazivi ----------------
  provjeri(sigurnoIme('A<b>:c"d/e\\f|g?h*i. ') === "A-b--c-d-e-f-g-h-i", "sigurnoIme uklanja nedopuštene znakove i točku na kraju", sigurnoIme('A<b>:c"d/e\\f|g?h*i. '));
  provjeri(kupacKratko("STEELMONT d.o.o.") === "Steelmont" && kupacKratko("Bekehrti GmbH") === "Bekehrti", "kratko ime kupca");
  provjeri(nazivNoveMape({ sifra: "RN 170-999", naziv: "IAB_Geländer km1" }) === "RN 170-999_IAB_Geländer km1", "naziv mape običnog projekta");
  provjeri(nazivNoveMape({ sifra: "RN 40-04-7", naziv: "Usluga rezanja", kupac: "STEELMONT d.o.o." }) === "07-Steelmont-Usluga rezanja", "naziv mape usluge: NN-Kupac-opis", nazivNoveMape({ sifra: "RN 40-04-7", naziv: "Usluga rezanja", kupac: "STEELMONT d.o.o." }));
  provjeri(nazivNoveMape({ sifra: "RN 40-04-53", naziv: "1_InoxMont - usluga", kupac: "InoxMont VS d.o.o." }) === "53-1_InoxMont - usluga", "usluga: kupac se ne ponavlja ako je već u nazivu");
  provjeri(vrstaPredloska("RN 180-77") === "kupaonice" && vrstaPredloska("Rn 40-04-51") === "usluge" && vrstaPredloska("RN 170-333") === "standard", "vrsta predloška po šifri");

  // ---------------- struktura: obični projekt ----------------
  const p1 = { id: "proj-1", sifra: "RN 170-999", naziv: "Probni projekt", kupac: "Kupac d.o.o.", mapa: "" };
  let r = stvoriStrukturu(p1, korijeni, { probno: true, erpUrl: "https://erp.test" });
  provjeri(r.novaMapa && !postoji(r.mapa) && r.stvoreno.length === PREDLOSCI.standard.length + 1, "probni način: ništa se ne stvara, ali javlja što bi napravio", r);
  r = stvoriStrukturu(p1, korijeni, { erpUrl: "https://erp.test" });
  const m1 = path.join(korijen, "RN 170-999_Probni projekt");
  provjeri(r.novaMapa && r.mapa === m1 && postoji(path.join(m1, "02 Nacrti", "Za proizvodnju", "Stare revizije")) && postoji(path.join(m1, "02 Nacrti", "Laser za limove")) && postoji(path.join(m1, "09 Slike")), "nova mapa u korijenu tekuće godine sa svim podmapama", r);
  const url = fs.readFileSync(path.join(m1, "Otvori u ERP-u.url"), "utf8");
  provjeri(url.includes("URL=https://erp.test/?projekt=proj-1"), "prečac Otvori u ERP-u.url pokazuje na projekt", url);
  r = stvoriStrukturu(p1, korijeni, { erpUrl: "https://erp.test" });
  provjeri(!r.novaMapa && r.mapa === m1 && r.stvoreno.length === 0, "drugi put: postojeća mapa, ništa novo", r);
  fs.rmSync(path.join(m1, "09 Slike"), { recursive: true });
  r = stvoriStrukturu(p1, korijeni, {});
  provjeri(r.stvoreno.length === 1 && r.stvoreno[0] === "09 Slike", "obrisana podmapa se ponovno doda (samo kad most ponovno dobije projekt)", r);

  // ručno otvorena mapa sa starim podmapama: ništa se ne preimenuje, dodaju se samo podmape koje fale
  const rucna = path.join(korijen, "RN 170-998_Rucno otvoren");
  zapisi(path.join(rucna, "Nacrti", "crtez.pdf"));
  r = stvoriStrukturu({ id: "proj-2", sifra: "RN 170-998", naziv: "Drugi naziv", mapa: "" }, korijeni, {});
  provjeri(!r.novaMapa && r.mapa === rucna && postoji(path.join(rucna, "Nacrti", "crtez.pdf")) && postoji(path.join(rucna, "01 Narudžba")), "ručno otvorena mapa: zadržana, dodane standardne podmape", r);

  // upisana mapa koja ne postoji → greška, ništa se ne stvara
  let greska = null;
  try { stvoriStrukturu({ id: "proj-3", sifra: "RN 170-997", naziv: "X", mapa: path.join(dir, "nema", "mape") }, korijeni, {}); } catch (e) { greska = e.message; }
  provjeri(/ne postoji/.test(greska || "") && !postoji(path.join(korijen, "RN 170-997_X")), "ručno upisana nepostojeća mapa → greška, nova mapa se ne stvara", greska);

  // korijen tekuće godine ne postoji (npr. 1.1.) → greška
  greska = null;
  try { stvoriStrukturu({ id: "proj-4", sifra: "RN 170-996", naziv: "Y" }, [path.join(dir, "Econ_2027_Projekti"), korijen], {}); } catch (e) { greska = e.message; }
  provjeri(/tekuće godine ne postoji/.test(greska || ""), "korijen tekuće godine ne postoji → greška (most čeka)", greska);

  // ---------------- struktura: kupaonice i usluge ----------------
  r = stvoriStrukturu({ id: "proj-5", sifra: "RN 180-77", naziv: "B&O_Grafing (500-90)" }, korijeni, {});
  provjeri(postoji(path.join(r.mapa, "02 Nacrti", "Za proizvodnju", "Spojni profili")) && postoji(path.join(r.mapa, "02 Nacrti", "Šablone")) && !postoji(path.join(r.mapa, "06 Montaža")), "RN 180: nacrti po dijelovima kupaonice, bez 06 Montaža", r);
  r = stvoriStrukturu({ id: "proj-6", sifra: "RN 40-04-53", naziv: "Usluga rezanja", kupac: "STEELMONT d.o.o." }, korijeni, {});
  provjeri(r.mapa === path.join(korijen, "RN 40-04_Usluge radione", "53-Steelmont-Usluga rezanja") && postoji(path.join(r.mapa, "Laser za profile")) && postoji(path.join(r.mapa, "Fotografije - Utovar")), "usluga 40-04: podmapa NN-Kupac-opis u zbirnoj mapi (zbirna stvorena)", r);
  fs.mkdirSync(path.join(korijen, "RN 40-04_Usluge radione", "45-AC-Group"));
  provjeri(nadjiMapuProjekta(korijeni, "RN 40-04-45", "") === path.join(korijen, "RN 40-04_Usluge radione", "45-AC-Group"), "postojeći posao 45-AC-Group nađen po šifri RN 40-04-45");
  provjeri(nadjiMapuProjekta(korijeni, "Rn 40-04-053", "") === path.join(korijen, "RN 40-04_Usluge radione", "53-Steelmont-Usluga rezanja"), "šifra usluge bez obzira na velika slova i vodeće nule");

  // ---------------- traženje mape ----------------
  const preimenovana = path.join(korijen, "RN 170-995_Novo ime");
  fs.mkdirSync(preimenovana);
  provjeri(nadjiMapuProjekta(korijeni, "RN 170-995", path.join(korijen, "RN 170-995_Staro ime")) === preimenovana, "upisana mapa preimenovana → nađena po šifri");
  fs.mkdirSync(path.join(m1, "07 Fakture", "2026"), { recursive: true });
  provjeri(nadjiMapeRacuna(m1, ["Fakture", "Rechnungen"]).some((m) => m.endsWith("07 Fakture")), "mapa računa \"07 Fakture\" prepoznata");

  // ---------------- praćenje: pregled i usporedba ----------------
  provjeri(osnovaNaziva("Poz-12 rev.B.pdf").baza === osnovaNaziva("Poz-12_revA.pdf").baza && osnovaNaziva("Plan Index C.pdf").rev === "C", "osnova naziva bez oznake revizije");
  const laser = path.join(m1, "02 Nacrti", "Laser za limove");
  const zaPro = path.join(m1, "02 Nacrti", "Za proizvodnju");
  const odKupca = path.join(m1, "02 Nacrti", "Od kupca");
  zapisi(path.join(laser, "8 mm", "poz1.dxf"));
  zapisi(path.join(zaPro, "Poz-12_revA.pdf"));
  zapisi(path.join(zaPro, "Poz-13.pdf"));
  zapisi(path.join(odKupca, "Plan Index A.pdf"));
  zapisi(path.join(m1, "01 Narudžba", "Bestellung.pdf"));
  zapisi(path.join(laser, "Thumbs.db"));
  let pregled = pregledajMapu(m1);
  provjeri(pregled.podmape.find((x) => x.naziv === "02 Nacrti/Za proizvodnju")?.datoteka === 2 && pregled.podmape.find((x) => x.naziv === "01 Narudžba")?.datoteka === 1 && pregled.podmape.some((x) => x.naziv === "03 Nabava" && x.datoteka === 0), "sažetak: prva razina i podmape nacrta, prazne mape s 0", pregled.podmape);
  provjeri(!Object.keys(pregled.pracene).some((k) => /Thumbs/.test(k)) && Object.keys(pregled.pracene).length === 4, "prate se samo datoteke u praćenim mapama (bez Thumbs.db)", Object.keys(pregled.pracene));
  const baza = usporedi({ datoteke: {}, odobrenja: pregled.odobrenja }, pregled).stanje;

  // promjene: laser nova + izmijenjena, revizija u Za proizvodnju (stara u Stare revizije), nova revizija od kupca, mapa odobravanja, datoteka u kopiranju
  zapisi(path.join(laser, "8 mm", "poz2.dxf"));
  zapisi(path.join(laser, "8 mm", "poz1.dxf"), "promijenjeno", STARO + 1000);
  zapisi(path.join(laser, "poz3.dxf"), "x", Date.now()); // upravo se kopira
  fs.renameSync(path.join(zaPro, "Poz-12_revA.pdf"), path.join(zaPro, "Stare revizije", "Poz-12_revA.pdf"));
  zapisi(path.join(zaPro, "Poz-12_revB.pdf"));
  zapisi(path.join(odKupca, "Plan Index B.pdf"));
  fs.mkdirSync(path.join(m1, "02 Nacrti", "Za odobrenje", "Poslano 26.11.2026"), { recursive: true });
  pregled = pregledajMapu(m1);
  let u = usporedi(baza, pregled);
  const dl = u.dogadaji.find((d) => d.vrsta === "laser");
  provjeri(dl && dl.faza === "D" && dl.podrucje === "02 Nacrti/Laser za limove" && dl.dodano.join() === "8 mm/poz2.dxf" && dl.izmijenjeno.join() === "8 mm/poz1.dxf", "laser: nova i izmijenjena datoteka, faza D", dl);
  provjeri(!JSON.stringify(u.dogadaji).includes("poz3"), "datoteka mlađa od 2 min se još ne javlja");
  const dp = u.dogadaji.find((d) => d.vrsta === "nacrti" && d.gdje === "proizvodnja");
  provjeri(dp && dp.revizije.length === 1 && dp.revizije[0].naziv === "Poz-12_revB.pdf" && dp.revizije[0].prije === "Poz-12_revA.pdf", "Za proizvodnju: nova revizija prepoznata (stara premještena u Stare revizije)", dp);
  const dk = u.dogadaji.find((d) => d.vrsta === "nacrti" && d.gdje === "kupac");
  provjeri(dk && dk.revizije[0]?.naziv === "Plan Index B.pdf" && dk.revizije[0]?.prije === "Plan Index A.pdf", "Od kupca: nova revizija uz staru (Index A → B)", dk);
  provjeri(u.dogadaji.some((d) => d.vrsta === "odobrenje" && d.mape[0] === "02 Nacrti/Za odobrenje/Poslano 26.11.2026"), "nova mapa odobravanja s datumom");
  provjeri(!u.dogadaji.some((d) => d.vrsta === "stare"), "premještanje u Stare revizije samo ne stvara zaseban događaj");
  // sljedeći pregled, kad se kopiranje smiri: javlja se samo poz3
  zapisi(path.join(laser, "poz3.dxf"), "x", STARO + 5000);
  u = usporedi(u.stanje, pregledajMapu(m1));
  provjeri(u.dogadaji.length === 1 && u.dogadaji[0].dodano.join() === "poz3.dxf", "smirena datoteka javljena u sljedećem pregledu, ništa drugo", u.dogadaji);
  fs.rmSync(path.join(laser, "poz3.dxf"));
  u = usporedi(u.stanje, pregledajMapu(m1));
  provjeri(u.dogadaji.length === 1 && u.dogadaji[0].obrisano.join() === "poz3.dxf", "obrisana datoteka", u.dogadaji);

  // stari projekt (bez nove strukture): mape odobravanja u "Nacrti/Za Freigabe" se prate, ostalo ne
  const stari = path.join(korijenStari, "RN 170-170_Stari");
  zapisi(path.join(stari, "Nacrti", "Za Freigabe", "Poslano 18.12.2024", "a.pdf"));
  const bStari = usporedi({ datoteke: {}, odobrenja: [] }, pregledajMapu(stari)).stanje;
  bStari.odobrenja = pregledajMapu(stari).odobrenja;
  fs.mkdirSync(path.join(stari, "Nacrti", "Za Freigabe", "FREIGABE 14.01.2025"));
  zapisi(path.join(stari, "Nacrti", "novi.pdf"));
  u = usporedi(bStari, pregledajMapu(stari));
  provjeri(u.dogadaji.length === 1 && u.dogadaji[0].vrsta === "odobrenje" && u.dogadaji[0].mape[0].endsWith("FREIGABE 14.01.2025"), "stari projekt: samo nova mapa odobravanja", u.dogadaji);

  // ---------------- pratiDokumente i uskladiStrukturu s lažnim ERP-om ----------------
  const datotekaStanja = path.join(dir, "dokumenti-stanje.json");
  const poslano = [];
  let api = async (metoda, ruta, tijelo) => {
    if (ruta === "/api/most/projekti-za-pracenje") return { projekti: [{ id: "proj-1", sifra: "RN 170-999", mapa: m1 }, { id: "proj-7", sifra: "RN 170-995", mapa: path.join(korijen, "RN 170-995_Staro ime") }, { id: "proj-8", sifra: "RN 170-111", mapa: "" }] };
    if (ruta === "/api/most/dokumenti") { poslano.push(tijelo); return { ok: true, sifre: {} }; }
    throw new Error(`neočekivano ${ruta}`);
  };
  const okolina = { korijen: korijeni, probno: false };
  await pratiDokumente(api, okolina, () => {}, { datotekaStanja });
  provjeri(poslano.length === 1 && poslano[0].dogadaji.length === 0 && poslano[0].projekti.length === 3, "prvi krug: samo sažeci (bez obavijesti), stanje zapamćeno", poslano[0]);
  provjeri(poslano[0].projekti.find((x) => x.projektId === "proj-8")?.greska && poslano[0].ispravljeneMape[0]?.nova === preimenovana, "projekt bez mape javljen s greškom; preimenovana mapa javljena kao ispravak", poslano[0]);
  zapisi(path.join(laser, "poz4.dxf"));
  api = async (metoda, ruta) => { if (ruta === "/api/most/projekti-za-pracenje") return { projekti: [{ id: "proj-1", sifra: "RN 170-999", mapa: m1 }] }; throw new Error("ERP nije dostupan"); };
  let pao = false;
  try { await pratiDokumente(api, okolina, () => {}, { datotekaStanja }); } catch { pao = true; }
  provjeri(pao, "ERP nije primio događaje → greška");
  api = async (metoda, ruta, tijelo) => { if (ruta === "/api/most/projekti-za-pracenje") return { projekti: [{ id: "proj-1", sifra: "RN 170-999", mapa: m1 }] }; poslano.push(tijelo); return { ok: true }; };
  await pratiDokumente(api, okolina, () => {}, { datotekaStanja });
  provjeri(poslano.at(-1).dogadaji.length === 1 && poslano.at(-1).dogadaji[0].dodano.join() === "poz4.dxf" && poslano.at(-1).dogadaji[0].projektId === "proj-1", "stanje se ne sprema dok ERP ne primi → promjena javljena u sljedećem krugu", poslano.at(-1));
  await pratiDokumente(api, okolina, () => {}, { datotekaStanja });
  provjeri(poslano.at(-1).dogadaji.length === 0, "isto stanje → nema novih obavijesti");
  await pratiDokumente(api, { ...okolina, probno: true }, () => {}, { datotekaStanja });
  provjeri(poslano.length === 3, "probni način ništa ne šalje", poslano.length);

  const javljeno = [];
  api = async (metoda, ruta, tijelo) => {
    if (ruta === "/api/most/projekti-za-strukturu") return { projekti: [{ id: "proj-9", sifra: "RN 170-994", naziv: "Iz ERP-a", kupac: "", mapa: "" }, { id: "proj-10", sifra: "RN 170-993", naziv: "Greska", mapa: path.join(dir, "nema") }] };
    if (ruta === "/api/most/projekti/struktura") { javljeno.push(tijelo); return { ok: true }; }
    throw new Error(ruta);
  };
  await uskladiStrukturu(api, okolina, () => {}, "https://erp.test");
  const rz = javljeno[0]?.rezultati || [];
  provjeri(rz.find((x) => x.projektId === "proj-9")?.mapa === path.join(korijen, "RN 170-994_Iz ERP-a") && rz.find((x) => x.projektId === "proj-10")?.greska, "uskladiStrukturu: rezultat i greška po projektu javljeni ERP-u", rz);

  // ---------------- fotografije u novoj strukturi ----------------
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const ok = { korijen: korijeni, probno: false, postavke: {} };
  let s = spremiUtovarSliku({ sifra: "RN 170-999", mapa: m1, datum: "2026-11-27", naziv: "utovar_2026-11-27_OTP-1_01.jpg" }, jpeg, ok);
  provjeri(s.putanja === path.join(m1, "05 Isporuka", "Fotografije - Utovar", "2026-11-27", "utovar_2026-11-27_OTP-1_01.jpg"), "utovar u novoj strukturi ide u 05 Isporuka", s.putanja);
  s = spremiMontaznuSliku({ sifra: "RN 170-999", mapa: m1, pozicija: "A-1", datum: "2026-11-27", naziv: "2026-11-27_A-1_01.jpg" }, jpeg, ok);
  provjeri(s.putanja.startsWith(path.join(m1, "06 Montaža", "Fotografije - Montaža", "A-1")), "montaža u novoj strukturi ide u 06 Montaža", s.putanja);
  fs.mkdirSync(path.join(rucna, "Fotografije - Utovar"));
  fs.mkdirSync(path.join(rucna, "05 Isporuka"), { recursive: true });
  s = spremiUtovarSliku({ sifra: "RN 170-998", mapa: rucna, datum: "2026-11-27", naziv: "utovar_2026-11-27_OTP-2_01.jpg" }, jpeg, ok);
  provjeri(s.putanja.startsWith(path.join(rucna, "Fotografije - Utovar")), "projekt sa starom mapom fotografija: slike ostaju tamo", s.putanja);
} catch (e) {
  console.error(e);
  neuspjeh++;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(neuspjeh ? `\n${neuspjeh} provjera nije prošlo.` : "\nSve provjere mapa projekata prošle.");
process.exit(neuspjeh ? 1 : 0);

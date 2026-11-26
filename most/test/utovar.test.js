// Spremanje fotografija utovara na Z: — mapa projekta po šifri ili iz ERP-a, podmapa po datumu, nikad prepisivanje, sigurnosna pravila, probni način.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spremiUtovarSliku, spremiMontaznuSliku, obradiUtovar, obradiMontazu, MAPA_UTOVARA, MAPA_MONTAZE } from "../lib/utovar.js";
import { Greska } from "../lib/pretvori.js";

let neuspjeh = 0;
const provjeri = (uvjet, opis) => { console.log(`${uvjet ? "OK " : "NE!"} ${opis}`); if (!uvjet) neuspjeh++; };
const baza = fs.mkdtempSync(path.join(os.tmpdir(), "econ-utovar-"));
const korijen = path.join(baza, "projekti");
const proba = path.join(baza, "proba-izlaz");
fs.mkdirSync(path.join(korijen, "RN 99-01_Test konstrukcija"), { recursive: true });
fs.mkdirSync(path.join(korijen, "RN 99-02_Prva"), { recursive: true });
fs.mkdirSync(path.join(korijen, "RN 99-02_Druga"), { recursive: true });
const eksplicitna = path.join(baza, "drugdje", "RN 99-03_Ručno upisana");
fs.mkdirSync(eksplicitna, { recursive: true });
const okolina = { korijen: [korijen], probno: false, probnoIzlaz: proba, postavke: {} };
const JPEG = (s) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(s)]);
const slika = (o = {}) => ({ sifra: "RN 99-01", mapa: "", datum: "2026-11-24", naziv: "utovar_2026-11-24_OTP-24-11-1-26_01.jpg", ...o });
const baci = (fn) => { try { fn(); return null; } catch (e) { return e; } };

try {
  let r = spremiUtovarSliku(slika(), JPEG("a"), okolina);
  const ocekivana = path.join(korijen, "RN 99-01_Test konstrukcija", MAPA_UTOVARA, "2026-11-24", "utovar_2026-11-24_OTP-24-11-1-26_01.jpg");
  provjeri(r.putanja === ocekivana && fs.existsSync(ocekivana) && !r.vecPostojala, "slika ide u <mapa projekta>\\Fotografije - Utovar\\<datum>\\ s nazivom iz ERP-a");
  provjeri(MAPA_UTOVARA === "Fotografije - Utovar", "naziv mape je 'Fotografije - Utovar'");

  r = spremiUtovarSliku(slika(), JPEG("a"), okolina);
  provjeri(r.vecPostojala === true && r.putanja === ocekivana, "ista slika ponovno (ponovljen pokušaj) = već postoji, bez duplikata");
  provjeri(fs.readdirSync(path.dirname(ocekivana)).length === 1, "u mapi datuma je i dalje jedna datoteka");

  r = spremiUtovarSliku(slika(), JPEG("drukcija"), okolina);
  provjeri(r.putanja.endsWith("_01_v2.jpg") && fs.readFileSync(ocekivana).equals(JPEG("a")), "drukčija slika istog naziva ne prepisuje original nego dobiva _v2");

  r = spremiUtovarSliku(slika({ naziv: "utovar_2026-11-24_OTP-24-11-1-26_02.jpg", datum: "2026-11-25" }), JPEG("b"), okolina);
  provjeri(r.putanja.includes(path.join(MAPA_UTOVARA, "2026-11-25")), "drugi datum = nova podmapa");

  let e = baci(() => spremiUtovarSliku(slika({ sifra: "RN 99-02", naziv: "utovar_2026-11-24_X_01.jpg" }), JPEG("c"), okolina));
  provjeri(e instanceof Greska && /više mapa/.test(e.message), "dvije mape iste šifre → greška (treba upisati 'Mapa projekta' u ERP-u)");
  r = spremiUtovarSliku(slika({ sifra: "RN 99-03", mapa: eksplicitna, naziv: "utovar_2026-11-24_X_01.jpg" }), JPEG("c"), okolina);
  provjeri(r.putanja.startsWith(eksplicitna), "mapa upisana u ERP-u ima prednost pred traženjem po šifri");
  e = baci(() => spremiUtovarSliku(slika({ sifra: "RN 99-77", naziv: "utovar_2026-11-24_X_01.jpg" }), JPEG("c"), okolina));
  provjeri(e instanceof Greska && /nema mape/.test(e.message), "nema mape projekta → greška, ništa se ne stvara");
  provjeri(!fs.existsSync(path.join(korijen, "RN 99-77")) && fs.readdirSync(korijen).length === 3, "mapa projekta se nikad ne stvara sama");
  // Upisana mapa koja ne postoji traži se po šifri (preimenovana mapa); greška je tek kad ni po šifri nema mape.
  e = baci(() => spremiUtovarSliku(slika({ sifra: "RN 99-78", mapa: path.join(baza, "nema-je") }), JPEG("c"), okolina));
  provjeri(e instanceof Greska && /ne postoji/.test(e.message), "mapa iz ERP-a koja ne postoji (ni po šifri) → greška");

  // sigurnosna pravila
  provjeri(baci(() => spremiUtovarSliku(slika({ naziv: "../../x.jpg" }), JPEG("c"), okolina)) instanceof Greska, "naziv s putanjom se odbija");
  provjeri(baci(() => spremiUtovarSliku(slika({ naziv: "utovar_2026-11-24_a_01.exe" }), JPEG("c"), okolina)) instanceof Greska, "naziv koji nije .jpg se odbija");
  provjeri(baci(() => spremiUtovarSliku(slika({ naziv: "bilo-sto.jpg" }), JPEG("c"), okolina)) instanceof Greska, "naziv izvan dogovorenog oblika se odbija");
  provjeri(baci(() => spremiUtovarSliku(slika({ datum: "../.." }), JPEG("c"), okolina)) instanceof Greska, "datum s putanjom se odbija");
  provjeri(baci(() => spremiUtovarSliku(slika({ datum: "2026-13-40" }), JPEG("c"), okolina)) instanceof Greska, "nemoguć datum se odbija");
  provjeri(baci(() => spremiUtovarSliku(slika(), Buffer.from("<html>nije slika</html>"), okolina)) instanceof Greska, "sadržaj koji nije JPEG se odbija");
  provjeri(baci(() => spremiUtovarSliku(slika({ sifra: "" }), JPEG("c"), okolina)) instanceof Greska, "bez šifre projekta se odbija");
  provjeri(fs.readdirSync(path.join(korijen, "RN 99-01_Test konstrukcija")).join() === MAPA_UTOVARA, "odbijene slike ne ostavljaju tragove");

  // probni način: piše samo u proba-izlaz
  r = spremiUtovarSliku(slika({ sifra: "RN 99-55", naziv: "utovar_2026-11-24_P_01.jpg" }), JPEG("p"), { ...okolina, probno: true });
  provjeri(r.putanja.startsWith(proba) && fs.existsSync(r.putanja) && !fs.existsSync(path.join(korijen, "RN 99-55")), "probni način piše u proba-izlaz, ne u mapu projekata");

  // obradiUtovar: preuzimanje, spremanje i javljanje rezultata
  const javljeno = [];
  const poziva = [];
  const red = [
    { id: "s1", sifra: "RN 99-01", mapa: "", datum: "2026-11-26", naziv: "utovar_2026-11-26_OTP-1-26_01.jpg" },
    { id: "s2", sifra: "RN 99-77", mapa: "", datum: "2026-11-26", naziv: "utovar_2026-11-26_OTP-1-26_02.jpg" },
    { id: "s3", sifra: "RN 99-01", mapa: "", datum: "2026-11-26", naziv: "utovar_2026-11-26_OTP-1-26_03.jpg" },
  ];
  const api = async (metoda, ruta, tijelo) => { poziva.push(`${metoda} ${ruta}`); if (metoda === "GET") return { slike: red }; javljeno.push({ ruta, tijelo }); return { ok: true }; };
  const bajtovi = async (ruta) => { if (ruta.endsWith("/s3")) return Buffer.from("nije jpeg"); return JPEG(ruta); };
  const n = await obradiUtovar(api, bajtovi, okolina);
  provjeri(n === 3 && javljeno.length === 3, "svaka slika iz reda dobiva rezultat");
  const rez = (id) => javljeno.find((x) => x.ruta.includes(`/${id}/rezultat`))?.tijelo;
  provjeri(rez("s1")?.status === "spremljeno" && rez("s1").putanja.includes(path.join(MAPA_UTOVARA, "2026-11-26")) && fs.existsSync(rez("s1").putanja), "uspjeh: javlja 'spremljeno' s putanjom");
  provjeri(rez("s2")?.status === "greska" && /nema mape/.test(rez("s2").poruka), "mapa ne postoji: javlja grešku s razlogom");
  provjeri(rez("s3")?.status === "greska" && /JPEG/.test(rez("s3").poruka), "oštećena slika: javlja grešku, ostale slike nisu zaustavljene");

  javljeno.length = 0;
  await obradiUtovar(api, bajtovi, { ...okolina, probno: true });
  provjeri(javljeno.every((x) => x.tijelo.status === "greska") && /Probni/.test(javljeno[0].tijelo.poruka), "probni način nikad ne javlja 'spremljeno' (ERP ne smije misliti da je slika na Z:)");

  // ===== Montaža: mapa po oznaci pozicije =====
  provjeri(MAPA_MONTAZE === "Fotografije - Montaža", "naziv mape montaže je 'Fotografije - Montaža'");
  const mont = (o = {}) => ({ sifra: "RN 99-01", mapa: "", pozicija: "J-3.OG", datum: "2026-11-24", naziv: "2026-11-24_J-3.OG_01.jpg", ...o });
  r = spremiMontaznuSliku(mont(), JPEG("m1"), okolina);
  const mOcekivana = path.join(korijen, "RN 99-01_Test konstrukcija", MAPA_MONTAZE, "J-3.OG", "2026-11-24_J-3.OG_01.jpg");
  provjeri(r.putanja === mOcekivana && fs.existsSync(mOcekivana) && !r.vecPostojala, "montaža: slika ide u <mapa projekta>/Fotografije - Montaža/<oznaka>/<datum>_<oznaka>_<nn>.jpg");
  r = spremiMontaznuSliku(mont(), JPEG("m1"), okolina);
  provjeri(r.vecPostojala === true && fs.readdirSync(path.dirname(mOcekivana)).length === 1, "montaža: ista slika ponovno = već postoji, bez duplikata");
  r = spremiMontaznuSliku(mont(), JPEG("druga"), okolina);
  provjeri(r.putanja.endsWith("_01_v2.jpg") && fs.readFileSync(mOcekivana).equals(JPEG("m1")), "montaža: drukčija slika istog naziva ne prepisuje original (_v2)");
  r = spremiMontaznuSliku(mont({ pozicija: "A-1.OG", naziv: "2026-11-25_A-1.OG_02.jpg", datum: "2026-11-25" }), JPEG("m2"), okolina);
  provjeri(r.putanja.includes(path.join(MAPA_MONTAZE, "A-1.OG")) && r.putanja.endsWith("2026-11-25_A-1.OG_02.jpg"), "montaža: druga pozicija = vlastita mapa (stvara se ako ne postoji)");
  e = baci(() => spremiMontaznuSliku(mont({ sifra: "RN 99-77", naziv: "2026-11-24_J-3.OG_01.jpg" }), JPEG("m"), okolina));
  provjeri(e instanceof Greska && /nema mape/.test(e.message) && !fs.existsSync(path.join(korijen, "RN 99-77")), "montaža: nema mape projekta → greška, ništa se ne stvara");
  for (const [opis, o] of [
    ["oznaka s putanjom", { pozicija: "../x", naziv: "2026-11-24_../x_01.jpg" }],
    ["oznaka s kosom crtom", { pozicija: "a/b", naziv: "2026-11-24_a/b_01.jpg" }],
    ["rezervirano ime Windowsa", { pozicija: "CON", naziv: "2026-11-24_CON_01.jpg" }],
    ["oznaka završava točkom", { pozicija: "J-3.", naziv: "2026-11-24_J-3._01.jpg" }],
    ["prazna oznaka", { pozicija: "", naziv: "2026-11-24__01.jpg" }],
    ["naziv ne odgovara oznaci", { naziv: "2026-11-24_A-1.OG_01.jpg" }],
    ["naziv ne odgovara datumu", { naziv: "2026-11-23_J-3.OG_01.jpg" }],
    ["naziv s putanjom", { naziv: "..\\2026-11-24_J-3.OG_01.jpg" }],
    ["naziv bez rednog broja", { naziv: "2026-11-24_J-3.OG_x.jpg" }],
    ["naziv koji nije .jpg", { naziv: "2026-11-24_J-3.OG_01.exe" }],
    ["nemoguć datum", { datum: "2026-13-40", naziv: "2026-13-40_J-3.OG_01.jpg" }],
  ]) provjeri(baci(() => spremiMontaznuSliku(mont(o), JPEG("m"), okolina)) instanceof Greska, "montaža: odbija se — " + opis);
  provjeri(baci(() => spremiMontaznuSliku(mont(), Buffer.from("<html>nije slika</html>"), okolina)) instanceof Greska, "montaža: sadržaj koji nije JPEG se odbija");
  r = spremiMontaznuSliku(mont({ sifra: "RN 99-55", naziv: "2026-11-24_J-3.OG_09.jpg" }), JPEG("p"), { ...okolina, probno: true });
  provjeri(r.putanja.startsWith(proba) && !fs.existsSync(path.join(korijen, "RN 99-55")), "montaža: probni način piše u proba-izlaz");
  r = spremiMontaznuSliku(mont({ sifra: "RN 99-03", mapa: eksplicitna, naziv: "2026-11-24_J-3.OG_05.jpg" }), JPEG("c"), okolina);
  provjeri(r.putanja.startsWith(path.join(eksplicitna, MAPA_MONTAZE, "J-3.OG")), "montaža: mapa upisana u ERP-u ima prednost");

  const javljenoM = [];
  const redM = [
    { id: "m1", sifra: "RN 99-01", mapa: "", pozicija: "B-3.OG", datum: "2026-11-26", naziv: "2026-11-26_B-3.OG_01.jpg" },
    { id: "m2", sifra: "RN 99-77", mapa: "", pozicija: "B-3.OG", datum: "2026-11-26", naziv: "2026-11-26_B-3.OG_02.jpg" },
    { id: "m3", sifra: "RN 99-01", mapa: "", pozicija: "B-3.OG", datum: "2026-11-26", naziv: "2026-11-26_B-3.OG_03.jpg" },
  ];
  const apiM = async (metoda, ruta, tijelo) => { if (metoda === "GET") return { slike: ruta.includes("/montaza/") ? redM : [] }; javljenoM.push({ ruta, tijelo }); return { ok: true }; };
  const bajtoviM = async (ruta) => (ruta.endsWith("/m3") ? Buffer.from("nije jpeg") : JPEG(ruta));
  const nM = await obradiMontazu(apiM, bajtoviM, okolina);
  const rezM = (id) => javljenoM.find((x) => x.ruta.includes("/" + id + "/rezultat"))?.tijelo;
  provjeri(nM === 3 && javljenoM.length === 3 && javljenoM.every((x) => x.ruta.startsWith("/api/most/montaza/slika/")), "montaža: svaka slika iz reda dobiva rezultat na ispravnoj ruti");
  provjeri(rezM("m1")?.status === "spremljeno" && fs.existsSync(rezM("m1").putanja) && rezM("m1").putanja.includes(path.join(MAPA_MONTAZE, "B-3.OG")), "montaža: uspjeh javlja 'spremljeno' s putanjom");
  provjeri(rezM("m2")?.status === "greska" && /nema mape/.test(rezM("m2").poruka), "montaža: nema mape projekta → greška s razlogom");
  provjeri(rezM("m3")?.status === "greska" && /JPEG/.test(rezM("m3").poruka), "montaža: oštećena slika → greška, ostale nisu zaustavljene");
  javljenoM.length = 0;
  await obradiMontazu(apiM, bajtoviM, { ...okolina, probno: true });
  provjeri(javljenoM.every((x) => x.tijelo.status === "greska") && /Probni/.test(javljenoM[0].tijelo.poruka), "montaža: probni način nikad ne javlja 'spremljeno'");
} catch (e) {
  console.error(e);
  neuspjeh++;
} finally {
  fs.rmSync(baza, { recursive: true, force: true });
}
console.log(neuspjeh ? `\n${neuspjeh} provjera nije prošlo.` : "\nSve provjere su prošle.");
process.exit(neuspjeh ? 1 : 0);

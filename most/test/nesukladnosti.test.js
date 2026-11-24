// Spremanje nesukladnosti na Z: — <korijen>\<godina>\<NN-GG RN …>\, PDF se zamjenjuje, slike nikad ne prepisuju, sigurnosna pravila, probni način.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spremiDatotekuNesukladnosti, obradiNesukladnosti } from "../lib/nesukladnosti.js";
import { Greska } from "../lib/pretvori.js";

let neuspjeh = 0;
const provjeri = (uvjet, opis) => { console.log(`${uvjet ? "OK " : "NE!"} ${opis}`); if (!uvjet) neuspjeh++; };
const baza = fs.mkdtempSync(path.join(os.tmpdir(), "econ-ns-"));
const korijen = path.join(baza, "P4,5,6 Upravljanje nesukladnostima, popravne");
fs.mkdirSync(korijen);
const proba = path.join(baza, "proba-izlaz");
const okolina = { korijenNesukladnosti: korijen, probno: false, probnoIzlaz: proba };
const PDF = (s) => Buffer.from(`%PDF-1.4\n${s}\n%%EOF`);
const JPEG = (s) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`izmisljena-slika-${s}`)]);
const PNG = (s) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`izmisljena-png-${s}`)]);
const pdf = (o = {}) => ({ vrsta: "pdf", godina: 2026, mapa: "46-26 RN 170-313", naziv: "Nesukladnosti i popravne radnje 46-26.pdf", ...o });
const slika = (o = {}) => ({ vrsta: "slika", godina: 2026, mapa: "46-26 RN 170-313", naziv: "46-26_01.jpg", ...o });
const baci = (fn) => { try { fn(); return null; } catch (e) { return e; } };

try {
  let r = spremiDatotekuNesukladnosti(pdf(), PDF("v1"), okolina);
  const ocekivani = path.join(korijen, "2026", "46-26 RN 170-313", "Nesukladnosti i popravne radnje 46-26.pdf");
  provjeri(r.putanja === ocekivani && fs.readFileSync(ocekivani).equals(PDF("v1")), "PDF ide u <korijen>\\2026\\46-26 RN 170-313\\ (mapa godine i nesukladnosti se stvaraju)");
  r = spremiDatotekuNesukladnosti(pdf(), PDF("v2"), okolina);
  provjeri(fs.readFileSync(ocekivani).equals(PDF("v2")) && fs.readdirSync(path.dirname(ocekivani)).length === 1, "novija verzija PDF-a ZAMJENJUJE staru (bez privremenih datoteka)");
  r = spremiDatotekuNesukladnosti(pdf(), PDF("v2"), okolina);
  provjeri(r.vecPostojala === true, "ista verzija PDF-a = već postoji");
  r = spremiDatotekuNesukladnosti(slika(), JPEG("a"), okolina);
  provjeri(fs.existsSync(path.join(korijen, "2026", "46-26 RN 170-313", "46-26_01.jpg")) && !r.vecPostojala, "slika ide uz PDF");
  r = spremiDatotekuNesukladnosti(slika(), JPEG("drukcija"), okolina);
  provjeri(r.putanja.endsWith("46-26_01_v2.jpg"), "drukčija slika istog naziva ne prepisuje staru (_v2)");
  r = spremiDatotekuNesukladnosti(slika({ naziv: "46-26_02.png" }), PNG("p"), okolina);
  provjeri(r.putanja.endsWith("46-26_02.png"), "PNG slika (iz starog Worda)");
  r = spremiDatotekuNesukladnosti(pdf({ godina: 2027, mapa: "01-27", naziv: "Nesukladnosti i popravne radnje 01-27.pdf" }), PDF("x"), okolina);
  provjeri(r.putanja.includes(path.join("2027", "01-27")), "nova godina = nova mapa godine; nesukladnost bez projekta = samo broj");

  const losi = [
    ["godina izvan raspona", pdf({ godina: 1999 })], ["mapa s putanjom", pdf({ mapa: "..\\x" })], ["mapa s kosom crtom", pdf({ mapa: "46-26 RN 1/2" })],
    ["mapa završava točkom", pdf({ mapa: "46-26 RN." })], ["mapa bez broja", pdf({ mapa: "RN 170-313" })], ["naziv PDF-a drugog broja", pdf({ naziv: "Nesukladnosti i popravne radnje 47-26.pdf" })],
    ["naziv s putanjom", pdf({ naziv: "..\\Nesukladnosti i popravne radnje 46-26.pdf" })], ["slika drugog broja", slika({ naziv: "47-26_01.jpg" })], ["slika .exe", slika({ naziv: "46-26_01.exe" })],
  ];
  for (const [opis, d] of losi) provjeri(baci(() => spremiDatotekuNesukladnosti(d, d.vrsta === "pdf" ? PDF("z") : JPEG("z"), okolina)) instanceof Greska, `odbija se: ${opis}`);
  provjeri(baci(() => spremiDatotekuNesukladnosti(pdf(), JPEG("nije pdf"), okolina)) instanceof Greska, "odbija se: sadržaj nije PDF");
  provjeri(baci(() => spremiDatotekuNesukladnosti(slika({ naziv: "46-26_03.png" }), JPEG("jpeg kao png"), okolina)) instanceof Greska, "odbija se: JPEG pod nazivom .png");
  const bezKorijena = baci(() => spremiDatotekuNesukladnosti(pdf(), PDF("x"), { ...okolina, korijenNesukladnosti: path.join(baza, "nema") }));
  provjeri(bezKorijena instanceof Greska && /nije dostupna/.test(bezKorijena.message) && !fs.existsSync(path.join(baza, "nema")), "korijenska mapa se nikad ne stvara sama");
  r = spremiDatotekuNesukladnosti(pdf({ mapa: "48-26", naziv: "Nesukladnosti i popravne radnje 48-26.pdf" }), PDF("p"), { ...okolina, probno: true });
  provjeri(r.putanja.startsWith(proba) && !fs.existsSync(path.join(korijen, "2026", "48-26")), "probni način piše u proba-izlaz");

  const javljeno = [];
  const red = [
    { vrsta: "pdf", id: "n1", godina: 2026, mapa: "50-26 RN 1", naziv: "Nesukladnosti i popravne radnje 50-26.pdf", verzija: 3 },
    { vrsta: "slika", id: "s1", godina: 2026, mapa: "50-26 RN 1", naziv: "50-26_01.jpg" },
    { vrsta: "slika", id: "s2", godina: 2026, mapa: "50-26 RN 1", naziv: "50-26_02.jpg" },
  ];
  const api = async (metoda, ruta, tijelo) => { if (metoda === "GET") return { datoteke: red }; javljeno.push({ ruta, tijelo }); return { ok: true }; };
  const bajtovi = async (ruta) => (ruta.endsWith("/n1") ? PDF("n1") : ruta.endsWith("/s2") ? Buffer.from("nije slika") : JPEG(ruta));
  const n = await obradiNesukladnosti(api, bajtovi, okolina);
  const rez = (id) => javljeno.find((x) => x.ruta.endsWith(`/${id}`))?.tijelo;
  provjeri(n === 3 && javljeno.length === 3 && javljeno[0].ruta === "/api/most/nesukladnosti/rezultat/pdf/n1", "svaka datoteka dobiva rezultat na ispravnoj ruti");
  provjeri(rez("n1")?.status === "spremljeno" && rez("n1").verzija === 3 && fs.existsSync(rez("n1").putanja), "PDF: 'spremljeno' s verzijom i putanjom");
  provjeri(rez("s1")?.status === "spremljeno", "slika: 'spremljeno'");
  provjeri(rez("s2")?.status === "greska" && /slika/.test(rez("s2").poruka), "oštećena slika: greška, ostale nisu zaustavljene");
  javljeno.length = 0;
  await obradiNesukladnosti(api, bajtovi, { ...okolina, probno: true });
  provjeri(javljeno.every((x) => x.tijelo.status === "greska") && /Probni/.test(javljeno[0].tijelo.poruka), "probni način nikad ne javlja 'spremljeno'");
} catch (e) {
  console.error(e);
  neuspjeh++;
} finally {
  fs.rmSync(baza, { recursive: true, force: true });
}
console.log(neuspjeh ? `\n${neuspjeh} provjera nije prošlo.` : "\nSve provjere su prošle.");
process.exit(neuspjeh ? 1 : 0);

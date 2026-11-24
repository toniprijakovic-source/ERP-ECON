// Spremanje fotografija utovara na Z: — mapa projekta po šifri ili iz ERP-a, podmapa po datumu, nikad prepisivanje, sigurnosna pravila, probni način.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spremiUtovarSliku, obradiUtovar, MAPA_UTOVARA } from "../lib/utovar.js";
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
  e = baci(() => spremiUtovarSliku(slika({ mapa: path.join(baza, "nema-je") }), JPEG("c"), okolina));
  provjeri(e instanceof Greska && /ne postoji/.test(e.message), "mapa iz ERP-a koja ne postoji → greška");

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
} catch (e) {
  console.error(e);
  neuspjeh++;
} finally {
  fs.rmSync(baza, { recursive: true, force: true });
}
console.log(neuspjeh ? `\n${neuspjeh} provjera nije prošlo.` : "\nSve provjere su prošle.");
process.exit(neuspjeh ? 1 : 0);

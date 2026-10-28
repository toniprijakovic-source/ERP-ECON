// Pretvorba Konplast XML → XRechnung na stvarnom računu 13/1/8 + službena provjera validatorom (ako je Java dostupna).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { procitajKonplast, izradi, Greska } from "../lib/pretvori.js";
import { validirajXml } from "../lib/validator.js";

const mapa = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const xmlTekst = fs.readFileSync(path.join(mapa, "primjeri", "konplast-13-1-8.xml"), "utf8");
const cfg = JSON.parse(fs.readFileSync(path.join(mapa, "primjeri", "kumulativ-RN-170-208.json"), "utf8"));
const postavke = JSON.parse(fs.readFileSync(path.join(mapa, "postavke.json"), "utf8"));
const ctx = { prodavatelj: postavke.prodavatelj, eAdresa: "e-rechnung@example.com", referenca: "10322012-300700-0002", sifra: "RN 170-208" };

let neuspjeh = 0;
const provjeri = (uvjet, opis) => { console.log(`${uvjet ? "OK " : "NE!"} ${opis}`); if (!uvjet) neuspjeh++; };

const racun = procitajKonplast(xmlTekst);
provjeri(racun.broj === "13/1/8" && racun.linije.length === 1 && racun.linije[0].iznos === 34204.05, "Čitanje: račun 13/1/8, jedna stavka 34.204,05");
provjeri(racun.kupac.posta === "83043" && racun.kupac.grad === "Bad Aibling", "Čitanje: poštanski broj i grad kupca razdvojeni");

// 1) Abschlag s kumulativom
const abschlag = await izradi(racun, { ...ctx, kumulativ: { ...cfg, racuni: cfg.racuni.filter((r) => r.broj !== "13/1/8") } });
provjeri(abschlag.sazetak.zaPlatiti === 24165.31, "Abschlag: za platiti 24.165,31");
provjeri(abschlag.kontrole.every((k) => k.ok), "Abschlag: sve vlastite kontrole prolaze");
provjeri(abschlag.xml.includes('<cbc:PayableAmount currencyID="EUR">24165.31</cbc:PayableAmount>') && abschlag.xml.includes("<cbc:PrepaidAmount currencyID=\"EUR\">10038.74"), "Abschlag: PayableAmount i PrepaidAmount u XML-u");
provjeri(abschlag.xml.includes("<cbc:ID>K</cbc:ID>") && !abschlag.xml.includes("HRDE814925276") && abschlag.xml.includes("DE814925276"), "PDV oznaka K i ispravan PDV broj kupca");

// 1b) RN 170-288: 1. Abschlagsrechnung s A-Konto avansom (30 %); PDF koji je otišao kupcu ima za platiti 104.692,00
const racun288 = procitajKonplast(fs.readFileSync(path.join(mapa, "primjeri", "konplast-107-1-8.xml"), "utf8"));
const cfg288 = JSON.parse(fs.readFileSync(path.join(mapa, "primjeri", "kumulativ-RN-170-288.json"), "utf8"));
const ctx288 = { ...ctx, referenca: "", sifra: "RN 170-288", kumulativ: cfg288 };
const abschlag288 = await izradi(racun288, ctx288);
provjeri(abschlag288.sazetak.zaPlatiti === 104692 && abschlag288.sazetak.avans === 44868, "RN 170-288: za platiti 104.692,00, odbijeni avans 44.868,00 (kao u PDF-u kupcu)");
provjeri(abschlag288.xml.includes("<cbc:BuyerReference>10326001-308900-0001</cbc:BuyerReference>"), "RN 170-288: referenca kupca iz \"Auftragsnummer\"");

// 2) Običan račun (bez kumulativa): iznos za platiti je Konplastov
const obican = await izradi(racun, { ...ctx, kumulativ: null });
provjeri(obican.sazetak.zaPlatiti === 34204.05 && !obican.xml.includes("PrepaidAmount"), "Običan račun: za platiti 34.204,05, bez odbitka avansa");

// 3) Odbijanja
const odbij = async (promjena, ocekivano, opis) => {
  try { await izradi({ ...racun, ...promjena }, { ...ctx, kumulativ: null }); provjeri(false, `${opis}: trebalo je odbiti`); }
  catch (e) { provjeri(e instanceof Greska && ocekivano.test(e.message), `${opis}: odbijeno (${e.message.slice(0, 60)})`); }
};
await odbij({ kupac: { ...racun.kupac, drzava: "HR" } }, /Hrvatskoj/, "Kupac u Hrvatskoj");
await odbij({ kupac: { ...racun.kupac, drzava: "US" } }, /izvan EU/, "Kupac izvan EU");
await odbij({ linije: racun.linije.map((l) => ({ ...l, porez: "S", postotak: 25 })) }, /PDV/, "Račun s PDV-om");
try { await izradi(racun, { ...ctx, eAdresa: "", kumulativ: null }); provjeri(false, "Bez e-adrese: trebalo je odbiti"); } catch (e) { provjeri(/e-adres/.test(e.message), "Bez e-adrese: odbijeno"); }

// 4) Službena provjera (preskače se ako nema Jave u mapi alati)
const java = fs.readdirSync(path.join(mapa, "alati", "java")).map((d) => path.join(mapa, "alati", "java", d, "bin", "java.exe")).find((p) => fs.existsSync(p));
if (java) {
  for (const [naziv, ishod] of [["Abschlag", abschlag], ["Abschlag 288", abschlag288], ["Običan", obican]]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "econ-test-"));
    const xmlP = path.join(tmp, `XRechnung_test_${naziv.replace(/\s+/g, "-")}.xml`);
    fs.writeFileSync(xmlP, ishod.xml, "utf8");
    const v = await validirajXml({ java, jar: path.join(mapa, "alati", "validator.jar"), konfig: path.join(mapa, "alati", "konfig"), xmlPutanja: xmlP, izlaz: path.join(tmp, "izv") });
    provjeri(v.ocjena === "Valjano", `Službeni validator (${naziv}): ${v.ocjena}${v.greske.length ? " — " + v.greske.map((g) => `${g.id}: ${g.tekst}`).join(" | ") : ""}${v.pogreska ? " — " + v.pogreska : ""}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} else console.log("-- Java nije u most/alati/java — službena provjera preskočena");

if (neuspjeh) { console.error(`${neuspjeh} provjera nije prošlo.`); process.exit(1); }
console.log("Sve provjere su prošle.");

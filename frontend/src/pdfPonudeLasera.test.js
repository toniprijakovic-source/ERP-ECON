// Test PDF-a ponude za laser (privitak e-pošte): definicija dokumenta na hrvatskom i njemačkom i stvarna izrada PDF-a.
import test from "node:test";
import assert from "node:assert/strict";
import { definicijaPdfPonudeLasera, PRIJEVODI_PONUDE_LASERA } from "./pdfPonudeLasera.js";

const tekstovi = (o) => { const out = []; const obidi = (x) => { if (x == null) return; if (typeof x === "string") out.push(x); else if (Array.isArray(x)) x.forEach(obidi); else if (typeof x === "object") Object.values(x).forEach(obidi); }; obidi(o); return out.join(" | "); };

const podaci = (jezik, dodatno = {}) => ({
  ponuda: { broj: "LAS-2026-038", naziv: "Rezanje limova S235 — čšćžđ", napomena: "Rok 5 radnih dana." },
  kupac: { naziv: "Kupac d.o.o.", adresa: "Ulica 1, 42000 Varaždin", oib: "12345678901" },
  tvrtka: { naziv: "ECON d.o.o.", oib: "999", iban: "HR00", sud: "Trgovačkom sudu" },
  L: PRIJEVODI_PONUDE_LASERA[jezik], datumTekst: "24.11.2026.", vrijediDoTekst: "24.12.2026.",
  stavke: [{ opis: "Lim 3 mm, poz. 1", laser: "plocasti", komada: 40, iznosTekst: "120,00 €" }, { opis: "Cijev 40×40", laser: "cijevni", komada: 12, iznosTekst: "80,50 €" }],
  savijanja: [{ opis: "L profil", iznosTekst: "30,00 €" }],
  ostale: [{ opis: "Transport", iznosTekst: "25,00 €" }],
  zbrojevi: [{ tekst: "Savijanje:", iznosTekst: "30,00 €" }, { tekst: "UKUPNO (bez PDV-a):", iznosTekst: "255,50 €", glavni: true }],
  ...dodatno,
});

test("hrvatski: naslov, kupac, stavke s tipom lasera, savijanje, ostale stavke, zbrojevi, napomena, uvjeti", () => {
  const d = definicijaPdfPonudeLasera(podaci("hr"));
  const t = tekstovi(d.content);
  for (const s of ["PONUDA — USLUGA LASERSKOG REZANJA", "Broj: LAS-2026-038", "Kupac d.o.o.", "OIB: 12345678901", "24.12.2026.", "Rezanje limova S235 — čšćžđ", "Stavke rezanja", "Lim 3 mm, poz. 1", "Pločasti", "Cijevni", "120,00 €", "Savijanje", "L profil", "Ostale stavke", "Transport", "UKUPNO (bez PDV-a):", "255,50 €", "Napomena:", "Rok 5 radnih dana.", "Uvjeti plaćanja", "S poštovanjem,", "ECON d.o.o."]) assert.ok(t.includes(s), `nedostaje: ${s}`);
  assert.equal(d.info.title, "PONUDA — USLUGA LASERSKOG REZANJA LAS-2026-038");
  assert.ok(tekstovi(d.footer()).includes("Poduzeće je upisano na Trgovačkom sudu"));
});

test("njemački: prijevodi oznaka (korisnikov opis stavki ostaje kako je upisan)", () => {
  const t = tekstovi(definicijaPdfPonudeLasera(podaci("de")).content);
  for (const s of ["ANGEBOT — LASERSCHNEIDEN", "Nummer: LAS-2026-038", "Auftraggeber:", "Angebot gültig bis:", "Schneidpositionen", "Flachbettlaser", "Rohrlaser", "Abkanten", "Sonstige Positionen", "Mit freundlichen Grüßen,", "Lim 3 mm, poz. 1"]) assert.ok(t.includes(s), `nedostaje: ${s}`);
  assert.ok(!t.includes("Stavke rezanja") && !t.includes("Pločasti"), "hrvatske oznake ne smiju ostati u njemačkom PDF-u");
});

test("bez savijanja, ostalih stavki i napomene te tablice izostaju", () => {
  const t = tekstovi(definicijaPdfPonudeLasera(podaci("hr", { savijanja: [], ostale: [], ponuda: { broj: "LAS-2026-039", naziv: "x", napomena: "" } })).content);
  assert.ok(!t.includes("Ostale stavke") && !t.includes("Napomena:") && !t.includes("L profil"));
});

test("stvarna izrada PDF-a (pdfmake) s hrvatskim slovima", async () => {
  const modul = await import("pdfmake/build/pdfmake.js"); const pdfMake = modul.default || modul; const vfs = (await import("pdfmake/build/vfs_fonts.js")).default;
  if (pdfMake.addVirtualFileSystem) pdfMake.addVirtualFileSystem(vfs); else pdfMake.vfs = vfs;
  for (const jezik of ["hr", "de"]) {
    const buf = Buffer.from(await pdfMake.createPdf(definicijaPdfPonudeLasera(podaci(jezik))).getBuffer());
    assert.equal(buf.slice(0, 5).toString(), "%PDF-");
    assert.ok(buf.length > 5000, `PDF (${jezik}) je premalen: ${buf.length}`);
  }
});

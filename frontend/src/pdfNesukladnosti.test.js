// Test PDF obrasca nesukladnosti: definicija dokumenta (broj, odabrani izvor i mjere, aktivnosti, potpisi, slike) i stvarna izrada PDF-a.
import test from "node:test";
import assert from "node:assert/strict";
import { definicijaPdfNesukladnosti } from "./pdfNesukladnosti.js";

const zapis = {
  oznaka: "46/26", status: "Zatvorena",
  podaci: {
    datum: "2026-11-24", izvor: "reklamacija dobavljaču", potencijalna: false, projektSifra: "RN 170-313", projektNaziv: "Test", opis: "Pukotina na cijevi Ø42,4×3 — čšćžđ",
    evidentirao: "Test Tehnolog", nositelj: "Test Voditelj", uzrok: "Greška materijala", mjere: ["ispravak", "preventivna radnja"],
    aktivnosti: [{ opis: "Zamijeniti cijev", odgovoran: "Kooperant d.o.o.", rok: "2026-11-30", provedeno: "2026-11-28" }],
    nositeljPotvrda: { ime: "Test Voditelj", vrijeme: "2026-11-24T10:15:00Z" }, ocjena: "Učinkovito.", ucinkovito: true, ocijenio: { ime: "Test Suko", vrijeme: "2026-11-29T08:00:00Z" }, napomena: "",
  },
};
const tekstovi = (o) => { const out = []; const obidi = (x) => { if (x == null) return; if (typeof x === "string") out.push(x); else if (Array.isArray(x)) x.forEach(obidi); else if (typeof x === "object") Object.values(x).forEach(obidi); }; obidi(o); return out.join(" | "); };
const oznaceni = (o) => { const out = []; const obidi = (x) => { if (!x || typeof x !== "object") return; if (Array.isArray(x)) return x.forEach(obidi); if (Array.isArray(x.columns) && x.columns[0]?.canvas && x.columns[1]?.text) out.push([x.columns[1].text, x.columns[0].canvas.length > 1]); Object.values(x).forEach(obidi); }; obidi(o); return out; };

test("definicija: zaglavlje, broj, tekstovi i potpisi", () => {
  const d = definicijaPdfNesukladnosti({ zapis, tvrtka: { naziv: "ECON d.o.o." }, izradio: "Test" });
  const t = tekstovi(d.content);
  for (const s of ["NESUKLADNOSTI I POPRAVNE RADNJE", "Br: 46/26", "RN 170-313 — Test", "Pukotina na cijevi", "Popunjava odgovorna osoba - nositelj nesukladnosti", "Popunjava Predstavnik uprave za kvalitetu i okoliš", "Zamijeniti cijev", "Kooperant d.o.o.", "30.11.2026.", "28.11.2026.", "Učinkovito.", "Test Suko — elektronički potvrđeno"]) assert.ok(t.includes(s), `nedostaje: ${s}`);
  assert.equal(d.info.title, "Nesukladnosti i popravne radnje 46/26");
});

test("definicija: označen je samo odabrani izvor, odabrane mjere i 'nesukladnost' (ne potencijalna)", () => {
  const o = Object.fromEntries(oznaceni(definicijaPdfNesukladnosti({ zapis }).content));
  assert.equal(o["reklamacija dobavljaču"], true); assert.equal(o["radni proces"], false); assert.equal(o["reklamacija kupca"], false);
  assert.equal(o["ispravak"], true); assert.equal(o["popravna radnja"], false); assert.equal(o["preventivna radnja"], true);
  assert.equal(o["Opis nesukladnosti"], true); assert.equal(o["Opis potencijalne nesukladnosti"], false);
  assert.equal(o["mjera je učinkovita"], true);
});

test("definicija: prazna nesukladnost (bez aktivnosti, ocjene i slika) ima prazan redak aktivnosti; slike u parovima", () => {
  const d = definicijaPdfNesukladnosti({ zapis: { oznaka: "1/27", status: "Otvorena", podaci: { opis: "x" } } });
  assert.ok(!tekstovi(d.content).includes("SLIKE"));
  const slike = Array.from({ length: 3 }, (_, i) => ({ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", naziv: `01-27_0${i + 1}.png` }));
  const s = definicijaPdfNesukladnosti({ zapis: { oznaka: "1/27", status: "Poništena", podaci: { opis: "x" } }, slike });
  const t = tekstovi(s.content);
  assert.ok(t.includes("SLIKE") && t.includes("01-27_03.png") && t.includes("PONIŠTENA"));
  assert.equal(s.content.filter((c) => c.unbreakable).length, 2, "3 slike = 2 retka");
});

test("stvarna izrada PDF-a (pdfmake) s hrvatskim slovima i slikom", async () => {
  const slike = [{ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", naziv: "46-26_01.png" }];
  const modul = await import("pdfmake/build/pdfmake.js"); const pdfMake = modul.default || modul; const vfs = (await import("pdfmake/build/vfs_fonts.js")).default;
  if (pdfMake.addVirtualFileSystem) pdfMake.addVirtualFileSystem(vfs); else pdfMake.vfs = vfs;
  const b = await pdfMake.createPdf(definicijaPdfNesukladnosti({ zapis, tvrtka: { naziv: "ECON d.o.o." }, slike })).getBuffer();
  const buf = Buffer.from(b);
  assert.equal(buf.slice(0, 5).toString(), "%PDF-");
  assert.ok(buf.length > 3000);
});

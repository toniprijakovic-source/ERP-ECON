// PDF ponude za lasersko rezanje (vektorski tekst) — isti sadržaj kao "Pregled za ispis — Ponuda za laser" u aplikaciji,
// na hrvatskom ili njemačkom, za privitak e-pošte kupcu. Iznosi dolaze već formatirani iz aplikacije (podaciPdfPonudeLasera
// u App.jsx), pa PDF i ispis uvijek pokazuju iste brojeve.
import { ucitajPdfMake } from "./pdfNabave.js";

export const PRIJEVODI_PONUDE_LASERA = {
  hr: {
    naslov: "PONUDA — USLUGA LASERSKOG REZANJA", broj: "Broj", narucitelj: "Naručitelj:", oib: "OIB",
    datumPonude: "Datum ponude:", vrijediDo: "Ponuda vrijedi do:", predmet: "Predmet:",
    stavkeRezanja: "Stavke rezanja", opis: "Opis", tipLasera: "Tip lasera", kom: "Kom.", iznos: "Iznos", cijevni: "Cijevni", plocasti: "Pločasti",
    savijanje: "Savijanje", ostaleStavke: "Ostale stavke",
    savijanjeZbroj: "Savijanje:", ostalo: "Ostalo:", prijePopusta: "Ukupno prije popusta:", popust: "Popust",
    osnovica: "Osnovica:", pdv: "PDV", ukupno: "UKUPNO:", ukupnoBezPdv: "UKUPNO (bez PDV-a):", napomena: "Napomena:",
    uvjeti: "Uvjeti plaćanja i rok isporuke definiraju se ugovorom/narudžbom po prihvaćanju ponude.",
    postovanje: "S poštovanjem,", upisano: "Poduzeće je upisano na", mbs: "MBS", uprava: "Uprava",
  },
  de: {
    naslov: "ANGEBOT — LASERSCHNEIDEN", broj: "Nummer", narucitelj: "Auftraggeber:", oib: "USt-IdNr. (HR)",
    datumPonude: "Angebotsdatum:", vrijediDo: "Angebot gültig bis:", predmet: "Betreff:",
    stavkeRezanja: "Schneidpositionen", opis: "Beschreibung", tipLasera: "Laser", kom: "Stk.", iznos: "Betrag", cijevni: "Rohrlaser", plocasti: "Flachbettlaser",
    savijanje: "Abkanten", ostaleStavke: "Sonstige Positionen",
    savijanjeZbroj: "Abkanten:", ostalo: "Sonstiges:", prijePopusta: "Summe vor Rabatt:", popust: "Rabatt",
    osnovica: "Nettobetrag:", pdv: "MwSt.", ukupno: "GESAMT:", ukupnoBezPdv: "GESAMT (ohne MwSt.):", napomena: "Anmerkung:",
    uvjeti: "Zahlungsbedingungen und Lieferfrist werden nach Annahme des Angebots im Vertrag/der Bestellung festgelegt.",
    postovanje: "Mit freundlichen Grüßen,", upisano: "Das Unternehmen ist eingetragen beim", mbs: "MBS", uprava: "Geschäftsführung",
  },
};

const OKVIR = { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => "#333", vLineColor: () => "#333", paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3 };
const celijaZaglavlja = (text, desno) => ({ text, bold: true, fillColor: "#f0f0f0", fontSize: 8.5, alignment: desno ? "right" : "left" });

// Čista funkcija: definicija dokumenta za pdfmake (testira se bez preglednika).
// stavke = [{ opis, laser: "cijevni"|"plocasti", komada, iznosTekst }], savijanja/ostale = [{ opis, iznosTekst }],
// zbrojevi = [{ tekst, iznosTekst, glavni? }] redom kako se ispisuju (zadnji je UKUPNO).
export function definicijaPdfPonudeLasera({ ponuda, kupac, tvrtka, L, datumTekst, vrijediDoTekst, stavke = [], savijanja = [], ostale = [], zbrojevi = [] }) {
  const t = tvrtka || {};
  const siva = "#555";
  const podnozje = () => ({
    margin: [36, 0, 36, 16],
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.6, lineColor: "#999" }] },
      {
        margin: [0, 4, 0, 0], fontSize: 7, color: "#333", lineHeight: 1.25,
        text: [
          { text: `${L.oib}: `, bold: true }, `${t.oib || ""} | `, { text: "MB: ", bold: true }, `${t.mb || ""} | `, { text: "VAT-ID: ", bold: true }, `${t.vatId || ""} | `,
          { text: "IBAN: ", bold: true }, `${t.iban || ""} | `, { text: "SWIFT: ", bold: true }, `${t.swift || ""} | ${L.upisano} ${t.sud || ""}, `, { text: `${L.mbs}: `, bold: true }, `${t.mbs || ""} | `, { text: `${L.uprava}: `, bold: true }, `${t.uprava || ""}`,
        ],
      },
    ],
  });
  const tablicaIznosa = (naslov, redovi) => ({
    table: { headerRows: 1, dontBreakRows: true, widths: ["*", 90], body: [[celijaZaglavlja(naslov), celijaZaglavlja(L.iznos, true)], ...redovi.map((r) => [{ text: r.opis || "—", fontSize: 9 }, { text: r.iznosTekst, alignment: "right", fontSize: 9 }])] },
    layout: OKVIR, margin: [0, 0, 0, 14],
  });
  const zbrojeviTablica = zbrojevi.map((z) => (z.glavni
    ? [{ text: z.tekst, bold: true, fontSize: 11, margin: [0, 4, 0, 0] }, { text: z.iznosTekst, bold: true, alignment: "right", fontSize: 12, margin: [0, 4, 0, 0] }]
    : [{ text: z.tekst, color: siva }, { text: z.iznosTekst, bold: true, alignment: "right" }]));
  return {
    pageSize: "A4",
    pageMargins: [36, 36, 36, 62],
    defaultStyle: { font: "Roboto", fontSize: 9.5, color: "#111" },
    info: { title: `${L.naslov} ${ponuda.broj}`, author: t.naziv || "" },
    footer: podnozje,
    content: [
      {
        columns: [
          { width: "*", stack: [{ text: L.naslov, bold: true, fontSize: 14 }, { text: `${L.broj}: ${ponuda.broj}`, fontSize: 10.5, margin: [0, 2, 0, 0] }] },
          {
            width: 230, alignment: "right", fontSize: 8.5, lineHeight: 1.3,
            stack: [{ text: t.naziv || "", bold: true, fontSize: 11 }, { text: t.djelatnost || "", color: siva, fontSize: 7.5, margin: [0, 0, 0, 3] }, t.adresa || "", t.telefon || "", t.email || ""],
          },
        ],
        margin: [0, 0, 0, 16],
      },
      {
        columns: [
          { width: "*", stack: [{ text: L.narucitelj, color: siva, fontSize: 9, margin: [0, 0, 0, 2] }, { text: (kupac && kupac.naziv) || "—", bold: true }, (kupac && kupac.adresa) || "", ...(kupac && kupac.oib ? [`${L.oib}: ${kupac.oib}`] : [])], fontSize: 9.5 },
          {
            width: 250,
            table: { body: [[{ text: L.datumPonude, color: siva }, { text: datumTekst, bold: true }], [{ text: L.vrijediDo, color: siva }, { text: vrijediDoTekst, bold: true }], [{ text: L.predmet, color: siva }, { text: ponuda.naziv || "", bold: true }]] },
            layout: "noBorders", fontSize: 9.5,
          },
        ],
        margin: [0, 0, 0, 14],
      },
      { text: L.stavkeRezanja, bold: true, margin: [0, 0, 0, 5] },
      {
        table: {
          headerRows: 1, dontBreakRows: true, widths: ["*", 85, 45, 90],
          body: [
            [celijaZaglavlja(L.opis), celijaZaglavlja(L.tipLasera), celijaZaglavlja(L.kom, true), celijaZaglavlja(L.iznos, true)],
            ...stavke.map((s) => [{ text: s.opis || "—", fontSize: 9 }, { text: s.laser === "cijevni" ? L.cijevni : L.plocasti, fontSize: 9 }, { text: String(s.komada ?? ""), alignment: "right", fontSize: 9 }, { text: s.iznosTekst, alignment: "right", fontSize: 9 }]),
          ],
        },
        layout: OKVIR, margin: [0, 0, 0, 14],
      },
      ...(savijanja.length ? [tablicaIznosa(L.savijanje, savijanja)] : []),
      ...(ostale.length ? [tablicaIznosa(L.ostaleStavke, ostale)] : []),
      { columns: [{ width: "*", text: "" }, { width: 260, table: { widths: ["*", "auto"], body: zbrojeviTablica }, layout: "noBorders" }], margin: [0, 0, 0, 18], unbreakable: true },
      ...(ponuda.napomena ? [{ stack: [{ text: L.napomena, bold: true }, { text: ponuda.napomena, margin: [0, 2, 0, 0] }], fontSize: 9.5, margin: [0, 0, 0, 14] }] : []),
      {
        unbreakable: true, fontSize: 9.5,
        stack: [{ text: L.uvjeti }, { text: L.postovanje, margin: [0, 10, 0, 0] }, { text: t.naziv || "", bold: true, margin: [0, 6, 0, 0] }],
      },
    ],
  };
}

export async function napraviPdfPonudeLasera(podaci) {
  const pdfMake = await ucitajPdfMake();
  const buffer = await pdfMake.createPdf(definicijaPdfPonudeLasera(podaci)).getBuffer();
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

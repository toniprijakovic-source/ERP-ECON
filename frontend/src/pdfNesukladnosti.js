// PDF obrasca "NESUKLADNOSTI I POPRAVNE RADNJE" (ISO 9001) — isti raspored kao dosadašnji Word obrazac: 1) opis i izvor, tko je evidentirao;
// 2) "Popunjava odgovorna osoba - nositelj nesukladnosti": uzrok, mjera, aktivnosti; 3) "Popunjava Predstavnik uprave za kvalitetu i okoliš": ocjena učinkovitosti;
// napomena i slike. "Potpis" je elektronički: ime prijavljene osobe i vrijeme potvrde u ERP-u. Ovaj PDF most sprema na Z: (vidi most/lib/nesukladnosti.js).
import { ucitajPdfMake } from "./pdfNabave.js";
import { IZVORI_NS, MJERE_NS, datumHr, vrijemeHr } from "./nesukladnosti.js";

const kvadrat = (oznaceno) => ({
  width: 13,
  canvas: [
    { type: "rect", x: 0, y: 1, w: 10, h: 10, lineWidth: 0.8 },
    ...(oznaceno ? [{ type: "line", x1: 2, y1: 6.5, x2: 4.5, y2: 9.5, lineWidth: 1.4 }, { type: "line", x1: 4.5, y1: 9.5, x2: 8.5, y2: 3, lineWidth: 1.4 }] : []),
  ],
});
const izbor = (naziv, oznaceno) => ({ columns: [kvadrat(oznaceno), { text: naziv, fontSize: 8.5 }], columnGap: 3, width: "auto", margin: [0, 0, 10, 2] });
const potpis = (o) => (o?.ime ? `${o.ime} — elektronički potvrđeno ${vrijemeHr(o.vrijeme)}` : "");
const ZAGLAVLJE_ODJELJKA = (t) => ({ text: t, italics: true, fontSize: 8.5, color: "#444", margin: [0, 8, 0, 3] });

// Čista funkcija: definicija dokumenta za pdfmake (testira se bez preglednika). slike = [{ dataUrl, naziv }].
export function definicijaPdfNesukladnosti({ zapis, tvrtka, slike = [], izradio = "" }) {
  const p = zapis.podaci || {};
  const t = tvrtka || {};
  const projekt = [p.projektSifra, p.projektNaziv].filter(Boolean).join(" — ");
  const aktivnosti = (p.aktivnosti || []).length ? p.aktivnosti : [{ opis: "", odgovoran: "", rok: "", provedeno: "" }];
  const okvir = { hLineWidth: () => 0.7, vLineWidth: () => 0.7, hLineColor: () => "#333", vLineColor: () => "#333", paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 4, paddingBottom: () => 4 };
  const parovi = [];
  for (let i = 0; i < slike.length; i += 2) parovi.push(slike.slice(i, i + 2));
  return {
    pageSize: "A4",
    pageMargins: [36, 36, 36, 46],
    defaultStyle: { font: "Roboto", fontSize: 9.5, color: "#111" },
    info: { title: `Nesukladnosti i popravne radnje ${zapis.oznaka}` },
    footer: (str, uk) => ({ columns: [{ text: `${t.naziv || "ECON d.o.o."} · Nesukladnost ${zapis.oznaka} · izrađeno u ERP-u${izradio ? ` (${izradio})` : ""}`, fontSize: 7.5, color: "#666" }, { text: `stranica ${str}/${uk}`, alignment: "right", fontSize: 7.5, color: "#666" }], margin: [36, 14, 36, 0] }),
    content: [
      { table: { widths: [110, "*", 90], body: [[{ text: t.naziv || "ECON d.o.o.", bold: true, fontSize: 11 }, { text: "NESUKLADNOSTI I POPRAVNE RADNJE", bold: true, fontSize: 12, alignment: "center" }, { text: `Br: ${zapis.oznaka}`, bold: true, fontSize: 12, alignment: "right" }]] }, layout: okvir, margin: [0, 0, 0, 8] },
      {
        table: {
          widths: ["*", "*", "*"],
          body: [
            [{ colSpan: 3, stack: [
              { columns: [izbor("Opis nesukladnosti", !p.potencijalna), izbor("Opis potencijalne nesukladnosti", !!p.potencijalna)], margin: [0, 0, 0, 4] },
              ...(projekt ? [{ text: projekt, bold: true, margin: [0, 0, 0, 2] }] : []),
              { text: p.opis || " ", lineHeight: 1.2 },
            ] }, {}, {}],
            [{ colSpan: 3, columns: IZVORI_NS.map((x) => izbor(x, p.izvor === x)), columnGap: 0 }, {}, {}],
            [{ text: [{ text: "Evidentirao: ", color: "#555" }, p.evidentirao || ""] }, { text: [{ text: "Datum: ", color: "#555" }, datumHr(p.datum)] }, { text: [{ text: "Potpis: ", color: "#555" }, { text: "unos u ERP-u", fontSize: 8, color: "#555" }] }],
          ],
        },
        layout: okvir,
      },
      ZAGLAVLJE_ODJELJKA("Popunjava odgovorna osoba - nositelj nesukladnosti"),
      {
        table: {
          widths: ["*", 110, 70, 70],
          body: [
            [{ text: "Uzrok:", color: "#555" }, { colSpan: 3, text: p.uzrok || " " }, {}, {}],
            [{ text: "Poduzeti mjeru:", color: "#555" }, { colSpan: 3, columns: MJERE_NS.map((m) => izbor(m, (p.mjere || []).includes(m))) }, {}, {}],
            [{ text: "Mjera će se provesti kroz sljedeće aktivnosti:", bold: true, fontSize: 8.5 }, { text: "Odgovoran", bold: true, fontSize: 8.5 }, { text: "Planirani rok", bold: true, fontSize: 8.5 }, { text: "Stvarna provedba", bold: true, fontSize: 8.5 }],
            ...aktivnosti.map((a) => [{ text: a.opis || " " }, { text: a.odgovoran || "" }, { text: datumHr(a.rok) }, { text: datumHr(a.provedeno) }]),
            [{ colSpan: 2, text: [{ text: "Ime i prezime: ", color: "#555" }, p.nositelj || ""] }, {}, { colSpan: 2, text: [{ text: "Potvrda: ", color: "#555" }, { text: potpis(p.nositeljPotvrda) || " ", fontSize: 8 }] }, {}],
          ],
        },
        layout: okvir,
      },
      ZAGLAVLJE_ODJELJKA("Popunjava Predstavnik uprave za kvalitetu i okoliš"),
      {
        table: {
          widths: ["*", "*"],
          body: [
            [{ colSpan: 2, stack: [{ text: "Preispitivanje i ocjena učinkovitosti poduzete mjere:", color: "#555", margin: [0, 0, 0, 3] }, { text: p.ocjena || " " }, ...(p.ucinkovito === true || p.ucinkovito === false ? [{ columns: [izbor("mjera je učinkovita", p.ucinkovito === true), izbor("mjera nije učinkovita", p.ucinkovito === false)], margin: [0, 4, 0, 0] }] : [])] }, {}],
            [{ text: [{ text: "Ime i prezime: ", color: "#555" }, p.ocijenio?.ime || ""] }, { text: [{ text: "Potvrda: ", color: "#555" }, { text: potpis(p.ocijenio) || " ", fontSize: 8 }] }],
          ],
        },
        layout: okvir,
      },
      { text: "NAPOMENA", bold: true, margin: [0, 10, 0, 2] },
      { text: p.napomena || " ", margin: [0, 0, 0, 6] },
      ...(zapis.status === "Poništena" ? [{ text: "Ova nesukladnost je PONIŠTENA.", bold: true, color: "#9A2E1B", margin: [0, 0, 0, 6] }] : []),
      ...(slike.length ? [{ text: "SLIKE", bold: true, margin: [0, 6, 0, 4] }] : []),
      ...parovi.map((par) => ({ columns: par.map((s) => ({ stack: [{ image: s.dataUrl, fit: [250, 220] }, { text: s.naziv || "", fontSize: 7.5, color: "#666", margin: [0, 2, 0, 0] }] })), columnGap: 12, margin: [0, 0, 0, 10], unbreakable: true })),
    ],
  };
}

// Izrada PDF-a u pregledniku (pdfmake se učitava tek ovdje). Vraća Uint8Array.
export async function napraviPdfNesukladnosti(argumenti) {
  const pdfMake = await ucitajPdfMake();
  return pdfMake.createPdf(definicijaPdfNesukladnosti(argumenti)).getBuffer();
}

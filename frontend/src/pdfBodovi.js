// PDF "Popis zaposlenih - BODOVI" (radiona / ured) za ručne korekcije na papiru i PDF "Povijest korekcija".
// Podatke računa App.jsx (popisBodovaPodaci, popis korekcija s poslužitelja); ovdje je samo izgled. Brojevi i datumi dolaze već
// formatirani gdje je to potrebno, da PDF i prikaz u aplikaciji uvijek pokazuju isto.
import { ucitajPdfMake } from "./pdfNabave.js";

const hr = (v, d = 2) => (Number(v) || 0).toLocaleString("hr-HR", { minimumFractionDigits: d, maximumFractionDigits: d });
const OKVIR = "#555";
const tablicaS = (razmak) => ({
  hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => OKVIR, vLineColor: () => OKVIR,
  paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => razmak, paddingBottom: () => razmak,
});
const naslovTvrtke = (t) => ({
  stack: [
    { text: t.naziv || "ECON d.o.o.", bold: true, fontSize: 11 },
    ...(t.adresa ? [{ text: t.adresa, fontSize: 9 }] : []),
  ],
  margin: [0, 0, 0, 10],
});
const podnozje = (lijevo) => (stranica, brojStranica) => ({
  margin: [36, 0, 36, 0], fontSize: 7.5, color: "#555",
  columns: [{ width: "*", text: lijevo }, { width: 60, text: `${stranica} / ${brojStranica}`, alignment: "right" }],
});

// vrsta: "radiona" (satnica sa stažem) ili "ured" (plaća i plaća sa stažem). Stupci "Novo BOD" i "Napomena" ostaju prazni za ručni upis.
export async function napraviPdfPopisaBodova({ vrsta, mjesecTekst, redovi, radniDani, fond, bod, tvrtka, izradio, izradeno }) {
  const pdfMake = await ucitajPdfMake();
  const jeUred = vrsta === "ured";
  const t = tvrtka || {};
  const zag = (tekst) => ({ text: tekst, bold: true, fontSize: 8.5, alignment: "center", fillColor: "#f0f0f0" });
  const zaglavlje = jeUred
    ? ["R-br.", "Prezime i ime", "Postojeće BOD", "Plaća", "Plaća (sa stažem)", "Novo BOD", "Napomena"]
    : ["R-br.", "Prezime i ime", "Postojeće BOD", "Satnica (sa stažem)", "Novo BOD", "Napomena"];
  // pdfmake: fiksna širina je širina sadržaja, razmak (4 + 4) dolazi povrh nje; "*" popunjava ostatak.
  const sirine = jeUred ? [24, "*", 52, 58, 74, 52, 95] : [24, "*", 60, 80, 60, 115];
  const NOVI = "#E2F0D9";
  const tijelo = redovi.map((r, i) => {
    const ime = { text: [{ text: r.ime }, ...(r.pola ? [{ text: "  (pola RV)", fontSize: 7.5, color: "#666" }] : [])], fontSize: 9.5, ...(r.novi ? { fillColor: NOVI } : {}) };
    const prazno = { text: " ", fontSize: 9.5 };
    return jeUred
      ? [{ text: `${i + 1}.`, alignment: "center", fontSize: 9.5 }, ime, { text: String(r.bodovi), alignment: "center", fontSize: 9.5 }, { text: hr(r.placa), alignment: "right", fontSize: 9.5 }, { text: hr(r.placaSaStazom), alignment: "right", fontSize: 9.5 }, prazno, prazno]
      : [{ text: `${i + 1}.`, alignment: "center", fontSize: 9.5 }, ime, { text: String(r.bodovi), alignment: "center", fontSize: 9.5 }, { text: hr(r.satnicaSaStazom), alignment: "right", fontSize: 9.5 }, prazno, prazno];
  });
  const imaNovih = redovi.some((r) => r.novi);
  const dd = {
    pageSize: "A4",
    pageMargins: [36, 32, 36, 40],
    defaultStyle: { font: "Roboto", fontSize: 9.5, color: "#111" },
    info: { title: `Popis zaposlenih - BODOVI ${mjesecTekst} (${jeUred ? "ured" : "radiona"})`, author: t.naziv || "" },
    footer: podnozje(`Popis zaposlenih – BODOVI – ${jeUred ? "ured" : "radiona"} · ${mjesecTekst} · izrađeno ${izradeno}${izradio ? `, ${izradio}` : ""}`),
    content: [
      naslovTvrtke(t),
      { columns: [{ width: "*", text: "Popis zaposlenih - BODOVI", bold: true, fontSize: 14 }, { width: "auto", text: `${mjesecTekst}${jeUred ? " · ured" : " · radiona"}`, bold: true, fontSize: 14 }] },
      { margin: [0, 4, 0, 8], fontSize: 9.5, columns: [{ width: "auto", text: [{ text: "radnih dana  " }, { text: String(radniDani), bold: true }] }, { width: "auto", margin: [28, 0, 0, 0], text: [{ text: "BOD = " }, { text: `${(Number(bod) || 0).toLocaleString("hr-HR", { maximumFractionDigits: 4 })} €`, bold: true }] }, { width: "auto", margin: [28, 0, 0, 0], text: [{ text: "fond sati  " }, { text: String(fond), bold: true }] }] },
      { table: { headerRows: 1, dontBreakRows: true, widths: sirine, body: [zaglavlje.map(zag), ...tijelo] }, layout: tablicaS(3.5) },
      {
        unbreakable: true, margin: [0, 10, 0, 0],
        stack: [
          ...(imaNovih ? [{ columns: [{ width: 12, canvas: [{ type: "rect", x: 0, y: 1, w: 10, h: 8, color: NOVI, lineWidth: 0.5, lineColor: OKVIR }] }, { width: "*", text: "novi", fontSize: 8.5 }] }] : []),
          { margin: [0, 22, 0, 0], fontSize: 9, columns: [{ width: "*", text: "Datum: ________________" }, { width: "auto", text: "Potpis: ______________________________" }] },
        ],
      },
    ],
  };
  const buffer = await pdfMake.createPdf(dd).getBuffer();
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

// Povijest korekcija (A4 položeno). redovi: { vrijeme, zaposlenik, naziv, staro, novo, razlika, razlog, korisnik } — već formatirano.
export async function napraviPdfKorekcija({ redovi, filtarTekst, tvrtka, izradio, izradeno }) {
  const pdfMake = await ucitajPdfMake();
  const t = tvrtka || {};
  const zag = (tekst) => ({ text: tekst, bold: true, fontSize: 8.5, fillColor: "#f0f0f0" });
  const c = (tekst, opcije = {}) => ({ text: tekst || "", fontSize: 8.5, ...opcije });
  const dd = {
    pageSize: "A4", pageOrientation: "landscape",
    pageMargins: [36, 32, 36, 40],
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#111" },
    info: { title: "Povijest korekcija bodova i plaća", author: t.naziv || "" },
    footer: podnozje(`Povijest korekcija bodova i plaća · izrađeno ${izradeno}${izradio ? `, ${izradio}` : ""}`),
    content: [
      naslovTvrtke(t),
      { text: "Povijest korekcija bodova i plaća", bold: true, fontSize: 14 },
      { text: filtarTekst || "Svi zapisi", fontSize: 9, color: "#555", margin: [0, 2, 0, 8] },
      {
        table: {
          headerRows: 1, dontBreakRows: true, widths: [66, 96, 120, 70, 70, 40, "*", 66],
          body: [
            ["Datum i vrijeme", "Zaposlenik", "Što je promijenjeno", "Staro", "Novo", "Razlika", "Razlog", "Promijenio"].map(zag),
            ...(redovi.length ? redovi.map((r) => [c(r.vrijeme), c(r.zaposlenik, { bold: true }), c(r.naziv), c(r.staro), c(r.novo, { bold: true }), c(r.razlika, { alignment: "right" }), c(r.razlog), c(r.korisnik)])
              : [[{ text: "Nema zapisa za odabrani filtar.", colSpan: 8, alignment: "center", fontSize: 9, color: "#666" }, {}, {}, {}, {}, {}, {}, {}]]),
          ],
        },
        layout: tablicaS(3),
      },
    ],
  };
  const buffer = await pdfMake.createPdf(dd).getBuffer();
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

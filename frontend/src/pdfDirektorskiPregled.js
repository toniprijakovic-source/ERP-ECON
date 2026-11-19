// PDF "Direktorski pregled" (A4 položeno) — tjedni ispis za direktora: zbirni pokazatelji, aktivni projekti sa semaforom i iznimke.
// Podatke računa direktorskiPregled.js (isti kao prikaz u aplikaciji); ovdje je samo izgled.
import { ucitajPdfMake } from "./pdfNabave.js";
import { OPIS_SEMAFORA } from "./direktorskiPregled.js";

const hr = (v, d = 0) => (Number(v) || 0).toLocaleString("hr-HR", { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (v) => `${hr(v)} €`;
const datum = (iso) => (iso ? `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.${String(iso).slice(0, 4)}.` : "—");
const OKVIR = "#777";
const BOJE = { crveno: "#F4C7C3", zuto: "#FCE8B2", zeleno: "#CFE8CF", info: "#DCE6F2" };
const NAZIV_RAZINE = { crveno: "Crveno", zuto: "Žuto", zeleno: "U redu", info: "Info" };
const tablica = (razmak) => ({
  hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => OKVIR, vLineColor: () => OKVIR,
  paddingLeft: () => 3.5, paddingRight: () => 3.5, paddingTop: () => razmak, paddingBottom: () => razmak,
});

export async function napraviPdfDirektorskogPregleda({ pregled, danas, tvrtka, izradio, izradeno }) {
  const pdfMake = await ucitajPdfMake();
  const t = tvrtka || {};
  const { kpi, redovi, iznimke } = pregled;
  const zag = (tekst, o = {}) => ({ text: tekst, bold: true, fontSize: 8, fillColor: "#eeeeee", ...o });
  const c = (tekst, o = {}) => ({ text: tekst == null ? "" : String(tekst), fontSize: 8, ...o });

  const kpiTekst = [
    ["Aktivni projekti", `${kpi.aktivni.broj} (${eur(kpi.aktivni.vrijednost)})`],
    ["Kasne s rokom", String(kpi.kasne.broj)],
    ["Još za isporučiti", eur(kpi.zaIsporuku.vrijednost)],
    ["Čeka obračun", `${kpi.cekaObracun.broj} (${eur(kpi.cekaObracun.vrijednost)})`],
    ["Poslane ponude", String(kpi.ponude.poslane)],
  ];
  const kpiRed = {
    margin: [0, 6, 0, 8],
    columns: kpiTekst.map(([naslov, vrijednost]) => ({ width: "*", stack: [{ text: naslov, fontSize: 7.5, color: "#555" }, { text: vrijednost, bold: true, fontSize: 11 }] })),
  };

  const projektiTijelo = redovi.map((r) => [
    { stack: [{ text: r.projekt.sifra, bold: true, fontSize: 8 }, { text: r.projekt.naziv, fontSize: 7.5 }, ...(r.kupac ? [{ text: r.kupac, fontSize: 7, color: "#666" }] : [])] },
    c(r.vrijednost > 0 ? eur(r.vrijednost) : "—", { alignment: "right" }),
    c(r.rok ? `${datum(r.rok)}${r.danaDoRoka != null ? (r.danaDoRoka < 0 ? ` (kasni ${-r.danaDoRoka} d)` : ` (za ${r.danaDoRoka} d)`) : ""}` : "—"),
    c(r.nalozi.ukupno ? `${r.nalozi.zavrseno}/${r.nalozi.ukupno}` : "—", { alignment: "center" }),
    c(r.sati.plan > 0 ? `${hr(r.sati.ostvareno)} / ${hr(r.sati.plan)} h (${Math.round(r.sati.posto)} %)` : r.sati.ostvareno > 0 ? `${hr(r.sati.ostvareno)} h (bez plana)` : "—"),
    c(`${r.materijal.izdatnica} izd. / ${r.materijal.narudzbenica} nar.`),
    c(`${r.isporuceno.posto} %`, { alignment: "center" }),
    c(r.podloge.iznos > 0 ? `${eur(r.podloge.iznos)}${r.podloge.posto != null ? ` (${r.podloge.posto} %)` : ""}` : "—"),
    { stack: [{ text: NAZIV_RAZINE[r.semafor], bold: true, fontSize: 8 }, ...(r.razlozi.length ? [{ text: r.razlozi.join("; "), fontSize: 7 }] : [])], fillColor: BOJE[r.semafor] },
  ]);

  const iznimkeTijelo = iznimke.map((i) => [
    { text: NAZIV_RAZINE[i.razina], bold: true, fontSize: 8, fillColor: BOJE[i.razina], alignment: "center" },
    {
      stack: [
        { text: i.naslov, bold: true, fontSize: 8.5 },
        { text: i.tekst, fontSize: 8, color: "#333" },
        ...(i.stavke.length ? [{ ul: i.stavke.slice(0, 12).map((s) => ({ text: s.tekst, fontSize: 7.5 })).concat(i.stavke.length > 12 ? [{ text: `… i još ${i.stavke.length - 12}`, fontSize: 7.5, italics: true }] : []), margin: [6, 2, 0, 0] }] : []),
      ],
    },
  ]);

  const dd = {
    pageSize: "A4", pageOrientation: "landscape",
    pageMargins: [30, 28, 30, 36],
    defaultStyle: { font: "Roboto", fontSize: 8, color: "#111" },
    info: { title: `Direktorski pregled ${datum(danas)}`, author: t.naziv || "" },
    footer: (stranica, ukupno) => ({
      margin: [30, 0, 30, 0], fontSize: 7.5, color: "#555",
      columns: [{ width: "*", text: `Direktorski pregled · stanje ${datum(danas)} · izrađeno ${izradeno}${izradio ? `, ${izradio}` : ""}` }, { width: 60, text: `${stranica} / ${ukupno}`, alignment: "right" }],
    }),
    content: [
      { columns: [{ width: "*", stack: [{ text: t.naziv || "ECON d.o.o.", bold: true, fontSize: 10 }] }, { width: "auto", text: `Stanje na dan ${datum(danas)}`, fontSize: 9, color: "#444" }] },
      { text: "Direktorski pregled", bold: true, fontSize: 15, margin: [0, 4, 0, 0] },
      kpiRed,
      { text: `Aktivni projekti (${redovi.length}) — po vrijednosti`, bold: true, fontSize: 10, margin: [0, 2, 0, 4] },
      redovi.length
        ? { table: { headerRows: 1, dontBreakRows: true, widths: [150, 52, 78, 36, 92, 66, 38, 74, "*"], body: [[zag("Projekt"), zag("Vrijednost", { alignment: "right" }), zag("Rok"), zag("Nalozi", { alignment: "center" }), zag("Sati / plan"), zag("Materijal"), zag("Isporuč.", { alignment: "center" }), zag("Podloge"), zag("Status")], ...projektiTijelo] }, layout: tablica(2.5) }
        : { text: "Nema aktivnih projekata.", fontSize: 9, color: "#666" },
      { text: OPIS_SEMAFORA.map(([boja, opis]) => `${NAZIV_RAZINE[boja]}: ${opis}`).join(" · "), fontSize: 7, color: "#666", margin: [0, 4, 0, 0] },
      { text: `Iznimke koje traže pažnju (${iznimke.length})`, bold: true, fontSize: 10, margin: [0, 12, 0, 4] },
      iznimke.length
        ? { table: { headerRows: 0, dontBreakRows: true, widths: [44, "*"], body: iznimkeTijelo }, layout: tablica(3) }
        : { text: "Nema iznimki.", fontSize: 9, color: "#666" },
    ],
  };
  const buffer = await pdfMake.createPdf(dd).getBuffer();
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

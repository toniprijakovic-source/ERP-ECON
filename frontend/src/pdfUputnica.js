// PDF obrasca RA-1 — Uputnica za utvrđivanje zdravstvene sposobnosti radnika: jedna A4 stranica po uputnici (više uputnica = jedan PDF za ispis).
// Raspored prati dosadašnji Word obrazac. Sve je smješteno apsolutno; koordinate su u pikselima obrasca pri 150 dpi (1240 px = A4, vidi pt()).
// Kućice se crtaju (Roboto nema znakove ☒ ☐), a dugi tekstovi se sami smanjuju da stanu u svoj redak. Podaci dolaze iz spremljene uputnice
// (broj, datum, vrsta, polja), pa se stara uputnica uvijek ispiše jednaka.
import { ucitajPdfMake } from "./pdfNabave.js";
import { KUCICE, TERETI, datumHr } from "./zastitaNaRadu.js";

const PX = 595.28 / 1240;
const pt = (px) => Math.round(px * PX * 100) / 100;
const CRNO = "#000", CRVENO = "#C00000";

// Veličina slova koja stane u zadanu širinu (procjena prosječne širine znaka Robota), ne manja od najmanje.
const stane = (tekst, sirinaPx, fs, bold = false, najmanje = 6) => {
  const ukupno = String(tekst || "").length * (bold ? 0.52 : 0.47);
  let f = fs;
  while (f > najmanje && ukupno * f > pt(sirinaPx)) f -= 0.25;
  return f;
};
// Tekst s lijevim rubom na x i sredinom retka na y (px). Visina retka Robota ≈ 1.17 · veličina, sredina malih slova ≈ 0.66 · veličina od vrha.
const T = (x, y, tekst, { fs = 10, bold = false, italics = false, color = CRNO, sirina, najmanje, poravnanje } = {}) => {
  if (!String(tekst ?? "").trim()) return null; // prazno polje ostaje samo crta
  const velicina = sirina ? stane(tekst, sirina, fs, bold, najmanje) : fs;
  const cvor = { text: String(tekst ?? ""), fontSize: velicina, bold, italics, color, ...(poravnanje ? { alignment: poravnanje } : {}) };
  return {
    absolutePosition: { x: pt(x), y: pt(y) - 0.66 * velicina },
    ...(sirina ? { columns: [{ ...cvor, width: pt(sirina) }] } : cvor),
  };
};
// Tekst koji smije u dva retka (razmak redaka kao na obrascu, 35 px): veličina se smanjuje dok ne stane u dva retka.
const Tdva = (x, y, tekst, sirina, { fs = 10.5, bold = false, najmanje = 7, razmak = 35 } = {}) => {
  if (!String(tekst ?? "").trim()) return null;
  const znakova = String(tekst).length, sirinaZnaka = bold ? 0.52 : 0.47;
  let f = fs;
  while (f > najmanje && znakova * f * sirinaZnaka > 2 * pt(sirina) * 0.92) f -= 0.25;
  const jedanRedak = znakova * f * sirinaZnaka <= pt(sirina);
  return { absolutePosition: { x: pt(x), y: pt(y) - 0.66 * f }, columns: [{ text: String(tekst), width: pt(sirina), fontSize: f, bold, lineHeight: jedanRedak ? 1 : pt(razmak) / (1.17 * f) }] };
};
// Oznaka s malom bilješkom (¹ ² ³ ⁴ nema u Robotu): "Strojevi, alati, aparati" + mala 1 + ":".
const Tbiljeska = (x, y, prije, broj, poslije, opts = {}) => {
  const fs = opts.fs || 10;
  return { absolutePosition: { x: pt(x), y: pt(y) - 0.66 * fs }, columnGap: 0, columns: [{ text: prije, width: "auto", fontSize: fs, bold: !!opts.bold }, { text: broj, width: "auto", fontSize: fs * 0.62, bold: !!opts.bold }, { text: poslije, width: "auto", fontSize: fs, bold: !!opts.bold }] };
};
// Bilješka ispod obrasca: mala brojka + tekst.
const Tbilj = (x, y, broj, tekst, fs) => ({ absolutePosition: { x: pt(x), y: pt(y) - 0.66 * fs }, columnGap: 0, columns: [{ text: broj, width: "auto", fontSize: fs * 0.62 }, { text: tekst, width: "auto", fontSize: fs, margin: [1.5, 0, 0, 0] }] });
const crta = (x1, y, x2, w = 0.6) => ({ type: "line", x1: pt(x1), y1: pt(y), x2: pt(x2), y2: pt(y), lineWidth: w, lineColor: CRNO });
const okvir = (x1, y1, x2, y2) => ({ type: "rect", x: pt(x1), y: pt(y1), w: pt(x2 - x1), h: pt(y2 - y1), lineWidth: 0.8, lineColor: CRNO });
const kucica = (x, y, oznaceno) => {
  const s = pt(21), l = pt(x), t = pt(y) - s / 2;
  return [
    { type: "rect", x: l, y: t, w: s, h: s, lineWidth: 0.7, lineColor: CRNO },
    ...(oznaceno ? [{ type: "line", x1: l + 1.7, y1: t + 1.7, x2: l + s - 1.7, y2: t + s - 1.7, lineWidth: 0.9, lineColor: CRNO }, { type: "line", x1: l + s - 1.7, y1: t + 1.7, x2: l + 1.7, y2: t + s - 1.7, lineWidth: 0.9, lineColor: CRNO }] : []),
  ];
};

// Gdje stoje kućice: [skupina, y retka, [[ključ, lijevi rub kućice (px)], …]] — kao na obrascu; naziv uz kućicu dolazi iz KUCICE.
const REDOVI_KUCICA = [
  ["mjestoRada", 1112, [["zatvoreno", 241], ["otvoreno", 402], ["visina", 566], ["jama", 680], ["voda", 773], ["podVodom", 861], ["mokro", 1001]]],
  ["organizacija", 1146, [["smjene", 241], ["nocni", 388], ["terenski", 512], ["sam", 660], ["grupa", 780], ["stranke", 940]]],
  ["organizacija", 1181, [["traka", 241], ["brzi", 388], ["ritam", 565], ["monotonija", 727]]],
  ["polozaj", 1216, [["stojeci", 241], ["sagibanje", 372], ["podvlacenje", 563], ["sjedeci", 705], ["zakretanje", 840], ["balansiranje", 1008]]],
  ["polozaj", 1252, [["pokret", 241], ["klecanje", 358], ["ljestve", 462], ["kombinirano", 670], ["cucanje", 812], ["stepenice", 913]]],
  ["vazno", 1324, [["vidDaljina", 241], ["vidBlizina", 402], ["boje", 565], ["sluh", 782], ["govor", 978]]],
  ["uvjeti", 1358, [["visokaTemp", 241], ["visokaVlaznost", 458], ["niskaTemp", 635], ["buka", 841], ["vibracijeStroja", 949]]],
  ["uvjeti", 1394, [["vibracijePoda", 241], ["atmTlak", 414], ["ozljede", 681]]],
  ["uvjeti", 1429, [["ionizirajuca", 241], ["neionizirajuca", 487], ["prasina", 781]]],
];
// Tereti: [ključ, lijevi rub kućice, početak crte za kg, kraj crte, položaj oznake "kg"] u pikselima, y retka 1288.
const REDAK_TERETA = [["dizanje", 241, 355, 463, 473], ["prenosenje", 521, 681, 812, 818], ["guranje", 862, 1022, 1141, 1154]];
const NAZIV_KUCICE = Object.fromEntries(KUCICE.flatMap((s) => s.opcije.map(([k, naziv]) => [`${s.key}.${k}`, naziv])));
const NAZIV_TERETA = { dizanje: "diz. tereta", prenosenje: "prenoš. tereta", guranje: "guranje tereta" };

const stranica = (u) => {
  const p = u.polja || {};
  const pr = p.posljednjiPregled;
  const lica = [], crte = [], tekstovi = [];
  // okviri
  crte.push(okvir(45, 60, 463, 209), okvir(987, 41, 1134, 80));
  // zaglavlje: poslodavac, oznaka obrasca, broj, datum, OIB poslodavca
  tekstovi.push(T(60, 83, p.poslodavac?.naziv, { fs: 12.5, bold: true, sirina: 390 }), T(60, 137, p.poslodavac?.adresa1, { fs: 12, sirina: 390 }), T(60, 190, p.poslodavac?.adresa2, { fs: 12, sirina: 390 }));
  tekstovi.push(T(193, 221, "(poslodavac)", { fs: 8, italics: true }), T(987, 60, "Obrazac RA-1", { fs: 9, bold: true, sirina: 147, poravnanje: "center" }));
  tekstovi.push(T(677, 95, "Broj:", { fs: 10.5, italics: true, bold: true }), T(840, 95, u.broj, { fs: 11.5, bold: true, sirina: 290 }), T(677, 131, "Datum:", { fs: 10.5, italics: true, bold: true }), T(840, 131, datumHr(u.datum), { fs: 11.5, bold: true, sirina: 290 }));
  crte.push(crta(827, 115, 1137), crta(827, 150, 1137));
  const oib = String(p.poslodavac?.oib || "").padEnd(11, " ");
  const sirinaOib = (1135 - 745) / 11;
  for (let i = 0; i < 11; i++) {
    crte.push(okvir(745 + i * sirinaOib, 172, 745 + (i + 1) * sirinaOib, 202));
    if (oib[i].trim()) tekstovi.push(T(745 + i * sirinaOib, 187, oib[i], { fs: 11.5, bold: true, sirina: sirinaOib, poravnanje: "center" }));
  }
  // naslov
  tekstovi.push(T(228, 237, "UPUTNICA", { fs: 21, bold: true, italics: true, sirina: 800, poravnanje: "center" }), T(228, 268, "za utvrđivanje zdravstvene sposobnosti radnika", { fs: 11, bold: true, italics: true, sirina: 800, poravnanje: "center" }));
  // osobni podaci
  tekstovi.push(T(46, 337, "Ime i prezime:"), T(208, 337, `${p.ime || ""} ${p.prezime || ""}`.trim(), { fs: 12, bold: true, italics: true, sirina: 440 }), T(667, 337, ","), T(697, 337, p.imeRoditelja, { fs: 12, bold: true, italics: true, sirina: 480 }), T(926, 363, "(ime oca – majke)", { fs: 8, italics: true }));
  crte.push(crta(198, 352, 655), crta(683, 352, 1182));
  tekstovi.push(T(46, 375, "Datum i mjesto rođenja:"), T(297, 375, `${datumHr(p.datumRodjenja)} ${p.mjestoRodjenja || ""}`.trim(), { sirina: 380 }), T(697, 375, "OIB:"), T(760, 375, p.oib, { sirina: 420 }));
  crte.push(crta(197, 395, 683), crta(750, 395, 1186));
  tekstovi.push(T(46, 411, "Zanimanje:"), T(179, 411, p.zanimanje, { sirina: 380 }), T(578, 411, "Školska sprema:"), T(773, 411, p.skolskaSprema, { sirina: 410 }));
  crte.push(crta(160, 431, 566), crta(750, 431, 1186));
  tekstovi.push(T(46, 447, "Poslovi za koje se utvrđuje zdravstvena sposobnost:"), T(559, 447, p.posloviNaziv, { fs: 11, bold: true, color: CRVENO, sirina: 620 }));
  crte.push(crta(549, 466, 1186));
  tekstovi.push(T(46, 482, "1) Poslovi su prema članku"), T(323, 482, p.clanak, { sirina: 70 }), T(385, 482, "točka"), T(460, 482, p.tocke, { fs: 9.5, bold: true, sirina: 305, najmanje: 5.5 }), T(781, 479, "Pravilnika o poslovima s posebnim uvjetima rada.", { fs: 7.5, bold: true }));
  crte.push(crta(298, 502, 375), crta(452, 502, 770));
  tekstovi.push(T(46, 516, "2) Poslovi prema drugim zakonima, propisima ili kolektivnom ugovorom", { fs: 9.5, bold: true }), T(46, 556, p.drugiPropis, { fs: 9.5, sirina: 660 }), T(115, 583, "(navesti zakon, propis ili kolektivni ugovor)", { fs: 8, italics: true }));
  crte.push(crta(35, 572, 710));
  tekstovi.push(T(46, 622, "3) Poslovi su prema propisima o mirovinskom osiguranju utvrđeni kao poslovi na kojima se staž"), T(72, 658, "osiguranja računa s povećanim trajanjem."), T(480, 658, p.povecaniStaz, { fs: 9.5, sirina: 700 }));
  // staž, vrsta pregleda
  tekstovi.push(T(46, 693, "Ukupni radni staž:"), T(240, 693, p.ukupniStaz, { sirina: 45 }), T(297, 693, "Radni staž na poslovima za koje se utvrđuje zdravstvena sposobnost:", { fs: 9.5 }), T(972, 693, p.stazNaPoslovima, { sirina: 214 }));
  crte.push(crta(240, 713, 285), crta(962, 713, 1186));
  tekstovi.push(T(46, 729, "Zdravstveni pregled:"));
  [["prethodni", 306, 342], ["periodicki", 505, 541], ["izvanredni", 697, 733]].forEach(([vrsta, kx, lx]) => { lica.push(...kucica(kx, 729, u.vrsta === vrsta)); tekstovi.push(T(lx, 729, { prethodni: "prethodni", periodicki: "periodički", izvanredni: "izvanredni" }[vrsta])); });
  // posljednji pregled
  tekstovi.push(T(46, 764, "Posljednji zdravstveni pregled je učinjen"), T(447, 764, pr ? datumHr(pr.datum) : "", { sirina: 128 }), T(587, 764, "prema članku"), T(760, 764, pr?.clanak, { sirina: 66 }), T(838, 764, "točki"), T(901, 764, pr?.tocke, { fs: 8, sirina: 285, najmanje: 5.5 }));
  crte.push(crta(445, 785, 576), crta(730, 785, 826), crta(901, 785, 1186));
  tekstovi.push(T(46, 800, "Pravilnika o poslovima s posebnim uvjetima rada, ili"), T(570, 800, pr?.drugiPropis, { fs: 9.5, sirina: 610 }), T(148, 875, "(navesti zakon, propis ili kolektivni ugovor iz članka 2. stavka 1. podstavka 2. ili 3. Pravilnika)", { fs: 8, italics: true }));
  crte.push(crta(563, 820, 1186), crta(35, 856, 1186));
  tekstovi.push(T(46, 905, "s ocjenom zdravstvene sposobnosti"), T(392, 905, pr?.ocjena, { sirina: 790, najmanje: 6.5 }));
  crte.push(crta(385, 925, 1186));
  // opis poslova, strojevi, predmet rada
  tekstovi.push(T(46, 942, "Kratak opis poslova:"), Tdva(280, 942, p.kratakOpis, 900, { fs: 10.5, bold: true }));
  crte.push(crta(268, 962, 1186), crta(35, 997, 1186));
  tekstovi.push(Tbiljeska(46, 1012, "Strojevi, alati, aparati", "1", ":"), T(282, 1012, p.strojevi, { fs: 10, sirina: 900, najmanje: 6.5 }), Tbiljeska(46, 1053, "Predmet rada", "2", ":"), T(282, 1053, p.predmetRada, { fs: 10, sirina: 900, najmanje: 6.5 }));
  crte.push(crta(268, 1037, 1186), crta(268, 1070, 1186));
  // kućice
  tekstovi.push(T(46, 1112, "Mjesto rada:", { fs: 10.5, bold: true }), T(46, 1148, "Organizacija rada:", { fs: 10.5, bold: true }), T(46, 1218, "Položaj tijela i", { fs: 10.5, bold: true }), Tbiljeska(46, 1254, "aktivnosti", "3", " :", { fs: 10.5, bold: true }), Tbiljeska(46, 1324, "U poslu je važan", "4", ":", { fs: 10.5, bold: true }), T(46, 1360, "Uvjeti rada:", { fs: 10.5, bold: true }));
  // naziv uz kućicu smije zauzeti prostor do sljedeće kućice (Roboto je širi od slova na izvornom obrascu pa se po potrebi smanji)
  REDOVI_KUCICA.forEach(([skupina, y, opcije]) => opcije.forEach(([kljuc, x], i) => {
    lica.push(...kucica(x, y, (p[skupina] || []).includes(kljuc)));
    const iduca = opcije[i + 1]?.[1] ?? 1232;
    tekstovi.push(T(x + 27, y, NAZIV_KUCICE[`${skupina}.${kljuc}`], { fs: 9.5, sirina: iduca - x - 32, najmanje: 7 }));
  }));
  REDAK_TERETA.forEach(([kljuc, x, k1, k2, kgX]) => {
    const t = p.tereti?.[kljuc] || {};
    lica.push(...kucica(x, 1288, !!t.oznaceno));
    tekstovi.push(T(x + 27, 1288, NAZIV_TERETA[kljuc], { fs: 9.5 }), T(kgX, 1288, "kg", { fs: 9.5 }));
    if (t.oznaceno && t.kg !== "" && t.kg != null) tekstovi.push(T(k1 + 10, 1288, `>${t.kg}`, { fs: 9.5, sirina: k2 - k1 - 12 }));
    crte.push(crta(k1, 1308, k2));
  });
  // kemijske tvari, biološke štetnosti, bilješke, potpis
  tekstovi.push(T(46, 1466, "Kemijske tvari:", { fs: 10.5, bold: true }), T(252, 1466, p.kemijskeTvari, { sirina: 930 }), T(46, 1503, "Biološke štetnosti:", { fs: 10.5, bold: true }), T(252, 1503, p.biolosteStetnosti, { sirina: 930 }));
  crte.push(crta(210, 1486, 1186), crta(210, 1522, 1186));
  tekstovi.push(
    Tbilj(46, 1534, "1", "upisuju se strojevi, alati i aparati kojima radnik rukuje ili poslužuje", 7.2),
    Tbilj(46, 1563, "2", "upisuju se radne tvari s kojima radnik rukuje ili dolazi u dodir", 7.2),
    Tbilj(46, 1593, "3", "zaokružuje se odgovarajući položaj tijela i aktivnosti koje se svakodnevno javljaju", 7.2),
    Tbilj(46, 1623, "4", "zaokružuje se funkcija bez koje se predviđeni posao ne može obaviti", 7.2),
    T(707, 1593, "M.P.", { fs: 9, bold: true }), T(945, 1638, "(potpis odgovorne osobe)", { fs: 8, italics: true }),
  );
  crte.push(crta(783, 1610, 1186));
  return [{ canvas: [...lica, ...crte], absolutePosition: { x: 0, y: 0 } }, ...tekstovi.filter(Boolean)];
};

// uputnice: popis spremljenih uputnica { broj, datum, vrsta, polja }. Vraća Uint8Array s PDF-om (jedna stranica po uputnici).
export async function napraviPdfUputnica(uputnice) {
  const pdfMake = await ucitajPdfMake();
  const content = [];
  uputnice.forEach((u, i) => {
    // razmak od 1 pt samo prisiljava novu stranicu; sve ostalo je apsolutno smješteno na tu stranicu
    if (i > 0) content.push({ text: " ", fontSize: 1, pageBreak: "before" });
    content.push(...stranica(u));
  });
  const dd = {
    pageSize: "A4",
    pageMargins: [0, 0, 0, 0],
    defaultStyle: { font: "Roboto", fontSize: 10, color: CRNO },
    info: { title: uputnice.length === 1 ? `Uputnica RA-1 ${uputnice[0].broj}` : `Uputnice RA-1 (${uputnice.length})`, author: uputnice[0]?.polja?.poslodavac?.naziv || "" },
    content,
  };
  const buffer = await pdfMake.createPdf(dd).getBuffer();
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

// PDF "Projekcija prihoda i troškova" za upravu (A4 položeno): naslovnica, sažetak s grafom, pregled po mjesecima sa
// strukturom troškova, prihod po projektima, kupci / rizici / potencijal / pretpostavke. Grafovi su vektorski (SVG).
// Podatke računa izracunProjekcije u App.jsx; ovdje je samo izgled.

let pdfMakePromise = null;
const ucitajPdfMake = () => {
  if (!pdfMakePromise) {
    pdfMakePromise = (async () => {
      const modul = await import("pdfmake/build/pdfmake");
      const vfs = (await import("pdfmake/build/vfs_fonts")).default;
      const pdfMake = modul.default || modul;
      if (pdfMake.addVirtualFileSystem) pdfMake.addVirtualFileSystem(vfs);
      else pdfMake.vfs = vfs;
      return pdfMake;
    })();
  }
  return pdfMakePromise;
};

const C = {
  ink: "#1A1D21", soft: "#5B6470", faint: "#8A9198", line: "#E3E6EA", surface: "#F3F4F6", dark: "#14181C",
  accent: "#F5B700", steel: "#2E5E7A", steelLight: "#A9C3D3", green: "#256B45", rust: "#B8442C", cost: "#C3C9D0", costDark: "#7D8792",
};
const SIRINA = 761; // širina sadržaja (A4 položeno, margine 40)
const eur = (v) => `${Math.round(Number(v) || 0).toLocaleString("hr-HR")} €`;
const pct = (v) => (v == null || !isFinite(v) ? "—" : `${Math.round(v) < 0 ? "−" : ""}${Math.abs(Math.round(v))} %`);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tis = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString("hr-HR", { maximumFractionDigits: 1 })} mil.`;
  if (a >= 1000) return `${Math.round(v / 1000).toLocaleString("hr-HR")} tis.`;
  return `${Math.round(v)}`;
};
const lijepiKorak = (raspon, koraka = 4) => {
  const grubo = raspon / koraka || 1;
  const red = Math.pow(10, Math.floor(Math.log10(grubo)));
  const n = grubo / red;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * red;
};

// Graf po mjesecima: stupac prihoda (ostvareno + projekcija), stupac troškova, linija kumulativnog rezultata.
function grafMjeseci(redovi, kratkiMjesec, w = 470, h = 250) {
  const L = 52, R = 14, T = 14, B = 34;
  const pw = w - L - R, ph = h - T - B;
  let kum = 0;
  const kumulativ = redovi.map((r) => (kum += r.rezultat));
  const maks = Math.max(1, ...redovi.map((r) => Math.max(r.prihod, r.troskovi)), ...kumulativ);
  const min = Math.min(0, ...kumulativ);
  const korak = lijepiKorak(maks - min);
  const gore = Math.ceil(maks / korak) * korak, dolje = Math.floor(min / korak) * korak;
  const y = (v) => T + ph - ((v - dolje) / (gore - dolje)) * ph;
  const n = redovi.length, gw = pw / n, bw = Math.min(30, gw * 0.3);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let v = dolje; v <= gore + 0.001; v += korak) {
    s += `<line x1="${L}" y1="${y(v)}" x2="${w - R}" y2="${y(v)}" stroke="${v === 0 ? C.faint : C.line}" stroke-width="${v === 0 ? 0.8 : 0.6}"/>`;
    s += `<text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" font-family="Roboto" font-size="7.5" fill="${C.faint}">${esc(tis(v))}</text>`;
  }
  redovi.forEach((r, i) => {
    const cx = L + gw * i + gw / 2;
    const x1 = cx - bw - 2, x2 = cx + 2;
    const yO = y(r.prihodOstvareno), yP = y(r.prihodOstvareno + r.prihodProjekcija), y0 = y(0);
    if (r.prihodOstvareno > 0) s += `<rect x="${x1}" y="${yO}" width="${bw}" height="${Math.max(0, y0 - yO)}" fill="${C.steel}"/>`;
    if (r.prihodProjekcija > 0) s += `<rect x="${x1}" y="${yP}" width="${bw}" height="${Math.max(0, yO - yP)}" fill="${C.steelLight}"/>`;
    s += `<rect x="${x2}" y="${y(r.troskovi)}" width="${bw}" height="${Math.max(0, y0 - y(r.troskovi))}" fill="${C.cost}"/>`;
    const oznaka = esc(kratkiMjesec(r.mjesec));
    s += `<text x="${cx}" y="${h - B + 13}" text-anchor="middle" font-family="Roboto" font-size="8.5" fill="${C.ink}">${oznaka}</text>`;
    if (i === 0 || r.mjesec.endsWith("-01")) s += `<text x="${cx}" y="${h - B + 24}" text-anchor="middle" font-family="Roboto" font-size="7" fill="${C.faint}">${r.mjesec.slice(0, 4)}</text>`;
  });
  const tocke = kumulativ.map((v, i) => [L + gw * i + gw / 2, y(v)]);
  if (tocke.length > 1) s += `<polyline points="${tocke.map((t) => t.join(",")).join(" ")}" fill="none" stroke="${C.green}" stroke-width="2"/>`;
  tocke.forEach(([px, py]) => { s += `<circle cx="${px}" cy="${py}" r="3" fill="#FFFFFF" stroke="${C.green}" stroke-width="1.6"/>`; });
  return `${s}</svg>`;
}

// Vodoravna traka udjela (npr. struktura troškova).
function trakaUdjela(dijelovi, w = SIRINA, h = 16) {
  const ukupno = dijelovi.reduce((a, d) => a + Math.max(0, d.iznos), 0) || 1;
  let x = 0, s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  dijelovi.forEach((d) => { const dw = (Math.max(0, d.iznos) / ukupno) * w; if (dw > 0) s += `<rect x="${x}" y="0" width="${dw}" height="${h}" fill="${d.boja}"/>`; x += dw; });
  return `${s}</svg>`;
}

const kvadratic = (boja, oblik = "kvadrat") => ({
  width: 14,
  canvas: oblik === "linija"
    ? [{ type: "line", x1: 0, y1: 5, x2: 11, y2: 5, lineWidth: 2, lineColor: boja }, { type: "ellipse", x: 5.5, y: 5, r1: 2.4, r2: 2.4, color: "#FFFFFF", lineColor: boja, lineWidth: 1.4 }]
    : [{ type: "rect", x: 0, y: 1, w: 9, h: 9, color: boja }],
});
const legenda = (stavke) => ({ columns: stavke.map(([boja, tekst, oblik]) => ({ width: "auto", columns: [kvadratic(boja, oblik), { text: tekst, fontSize: 8, color: C.soft, width: "auto" }], columnGap: 2, margin: [0, 0, 14, 0] })), margin: [0, 4, 0, 0] });

const naslov = (tekst, podnaslov) => ({
  stack: [
    { text: tekst, fontSize: 20, bold: true, color: C.ink },
    ...(podnaslov ? [{ text: podnaslov, fontSize: 10, color: C.soft, margin: [0, 2, 0, 0] }] : []),
    { canvas: [{ type: "rect", x: 0, y: 6, w: 44, h: 3.5, color: C.accent }] },
  ],
  margin: [0, 0, 0, 14],
});

const tablicaLayout = (ukupnoRed = false) => ({
  hLineWidth: (i, node) => (i === 0 || i === 1 ? 0 : ukupnoRed && i === node.table.body.length - 1 ? 1.2 : i === node.table.body.length ? 0 : 0.5),
  vLineWidth: () => 0,
  hLineColor: (i, node) => (ukupnoRed && i === node.table.body.length - 1 ? C.ink : C.line),
  fillColor: (i, node) => (i === 0 ? C.dark : ukupnoRed && i === node.table.body.length - 1 ? C.surface : null),
  paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 5, paddingBottom: () => 5,
});
const zag = (tekst, desno = false) => ({ text: tekst, bold: true, fontSize: 8, color: "#FFFFFF", alignment: desno ? "right" : "left" });
const br = (v, opcije = {}) => ({ text: typeof v === "string" ? v : eur(v), alignment: "right", fontSize: opcije.fs || 8.5, bold: !!opcije.bold, color: opcije.boja || C.ink, noWrap: true });

export async function napraviPdfProjekcije({ rez, logo, tvrtka, razdoblje, danas, izradio, trosakSata, materijalPostotak, fiksniMjesecno, nazivMjeseca, kratkiMjesec, fmtDate }) {
  const pdfMake = await ucitajPdfMake();
  const u = rez.ukupno;
  const imeTvrtke = tvrtka?.naziv || "ECON d.o.o.";
  const kratko = (m) => kratkiMjesec(m);
  let kum = 0;

  // ---------- zaključci ----------
  const najjaci = [...rez.redovi].sort((a, b) => b.prihod - a.prihod)[0];
  const top3 = rez.kupci.slice(0, 3);
  const udioTop3 = u.prihod > 0 ? (top3.reduce((a, k) => a + k.iznos, 0) / u.prihod) * 100 : 0;
  const kasniIznos = rez.upozorenja.kasni.reduce((a, k) => a + k.iznos, 0);
  const ponudeIznos = rez.ponude.reduce((a, p) => a + p.iznos, 0);
  const zakljucci = [
    `Prihod u razdoblju: ${eur(u.prihod)}${u.prihodOstvareno > 0 ? ` — ${eur(u.prihodOstvareno)} već je isporučeno, ${eur(u.prihodProjekcija)} je projekcija prema rokovima isporuke.` : " prema rokovima isporuke."}`,
    `Procijenjeni troškovi ${eur(u.troskovi)} daju rezultat ${eur(u.rezultat)}${u.marza != null ? ` (marža ${pct(u.marza)})` : ""}.`,
    ...(najjaci && najjaci.prihod > 0 && rez.redovi.length > 1 ? [`Najjači mjesec je ${nazivMjeseca(najjaci.mjesec)} s prihodom od ${eur(najjaci.prihod)}.`] : []),
    ...(top3.length ? [`${top3.length === 1 ? "Najveći kupac" : `${top3.length} najveća kupca`} (${top3.map((k) => k.naziv).join(", ")}) ${top3.length === 1 ? "čini" : "čine"} ${pct(udioTop3)} prihoda razdoblja.`] : []),
    `Plan proizvodnje predviđa ${Math.round(u.sati).toLocaleString("hr-HR")} sati rada u razdoblju.`,
    ...(rez.upozorenja.kasni.length ? [`${rez.upozorenja.kasni.length === 1 ? "Jedan projekt kasni" : `${rez.upozorenja.kasni.length} projekta kasne`} s isporukom (${eur(kasniIznos)} u tekućem mjesecu).`] : []),
    ...(rez.ponude.length ? [`Poslane ponude (${eur(ponudeIznos)}) nisu uključene u projekciju — prikazane su kao potencijal.`] : []),
  ];

  // ---------- 1. naslovnica ----------
  const naslovnica = [
    logo ? { image: logo, width: 210, margin: [0, 6, 0, 0] } : { text: "ECON", fontSize: 40, bold: true, color: C.steel },
    { text: "Projekcija prihoda i troškova", fontSize: 34, bold: true, color: C.ink, margin: [0, 86, 0, 6] },
    { text: razdoblje.charAt(0).toUpperCase() + razdoblje.slice(1), fontSize: 18, color: C.soft },
    { canvas: [{ type: "rect", x: 0, y: 14, w: 64, h: 5, color: C.accent }] },
    { text: `Pripremljeno za upravu · ${imeTvrtke}`, fontSize: 10.5, color: C.soft, margin: [0, 22, 0, 0] },
    {
      absolutePosition: { x: 40, y: 595.28 - 160 },
      columns: [
        ["Prihod u razdoblju", eur(u.prihod), u.prihodOstvareno > 0 ? `ostvareno ${eur(u.prihodOstvareno)}` : "projekcija"],
        ["Troškovi", eur(u.troskovi), `rad ${eur(u.rad)} · materijal ${eur(u.materijal)}`],
        ["Rezultat", eur(u.rezultat), u.marza != null ? `marža ${pct(u.marza)}` : ""],
      ].map(([oznaka, vrijednost, ispod], i) => ({
        width: 240,
        stack: [
          { text: oznaka.toUpperCase(), fontSize: 8.5, color: "#AEB6BD", characterSpacing: 0.8 },
          { text: vrijednost, fontSize: 26, bold: true, color: i === 2 ? (u.rezultat >= 0 ? "#7FD3A0" : "#F2A08F") : "#FFFFFF", margin: [0, 4, 0, 2] },
          { text: ispod, fontSize: 8.5, color: "#AEB6BD" },
        ],
      })),
      columnGap: 16,
    },
    {
      absolutePosition: { x: 40, y: 595.28 - 72 }, // unutar tamne trake i iznad donje margine, inače prelazi na sljedeću stranicu
      columns: [
        { text: `Izradio: ${izradio || "—"} · ${fmtDate(danas)} · stanje podataka na dan izrade`, fontSize: 8, color: "#8A9198" },
        { text: "Povjerljivo — samo za internu upotrebu", fontSize: 8, color: "#8A9198", alignment: "right" },
      ],
      width: SIRINA,
    },
  ];

  // ---------- 2. sažetak ----------
  const plocica = (oznaka, vrijednost, ispod, boja = C.ink) => ({
    stack: [
      { canvas: [{ type: "rect", x: 0, y: 0, w: 26, h: 3, color: C.accent }] },
      { text: oznaka.toUpperCase(), fontSize: 7.5, color: C.soft, characterSpacing: 0.6, margin: [0, 7, 0, 0] },
      { text: vrijednost, fontSize: 19, bold: true, color: boja, margin: [0, 3, 0, 2] },
      { text: ispod, fontSize: 7.5, color: C.faint },
    ],
    fillColor: C.surface, margin: [10, 9, 10, 10],
  });
  const sazetak = [
    naslov("Sažetak", `${razdoblje.charAt(0).toUpperCase() + razdoblje.slice(1)} · stanje na dan ${fmtDate(danas)}`),
    {
      table: {
        widths: ["*", "*", "*", "*"],
        body: [[
          plocica("Prihod", eur(u.prihod), u.prihodOstvareno > 0 ? `ostvareno ${eur(u.prihodOstvareno)} · projekcija ${eur(u.prihodProjekcija)}` : "projekcija prema rokovima isporuke"),
          plocica("Troškovi", eur(u.troskovi), `rad ${eur(u.rad)} · materijal ${eur(u.materijal)}`),
          plocica("Rezultat", eur(u.rezultat), u.fiksni > 0 ? `uključeni fiksni troškovi ${eur(u.fiksni)}` : "prije fiksnih troškova", u.rezultat >= 0 ? C.green : C.rust),
          plocica("Marža", pct(u.marza), `${Math.round(u.sati).toLocaleString("hr-HR")} sati rada u razdoblju`),
        ]],
      },
      layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 || i === 4 ? 0 : 8), vLineColor: () => "#FFFFFF", paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
      margin: [0, 0, 0, 18],
    },
    {
      columns: [
        {
          width: 480,
          stack: [
            { text: "Prihod i troškovi po mjesecima", fontSize: 11, bold: true, color: C.ink, margin: [0, 0, 0, 6] },
            { svg: grafMjeseci(rez.redovi, kratko, 480, 250), width: 480 },
            legenda([[C.steel, "Prihod — ostvareno"], [C.steelLight, "Prihod — projekcija"], [C.cost, "Troškovi"], [C.green, "Kumulativni rezultat", "linija"]]),
          ],
        },
        {
          width: "*",
          stack: [
            { text: "Ključni zaključci", fontSize: 11, bold: true, color: C.ink, margin: [0, 0, 0, 8] },
            ...zakljucci.map((z) => ({ columns: [{ width: 8, canvas: [{ type: "rect", x: 0, y: 4, w: 5, h: 5, color: C.accent }] }, { width: "*", text: z, fontSize: 9, color: C.ink, lineHeight: 1.25 }], columnGap: 4, margin: [0, 0, 0, 7] })),
          ],
        },
      ],
      columnGap: 26,
    },
  ];

  // ---------- 3. po mjesecima ----------
  const mjesecniRedovi = rez.redovi.map((r, i) => {
    kum += r.rezultat;
    const pozadina = i % 2 ? "#FAFBFC" : null;
    const status = { text: r.vrsta, fontSize: 7.5, color: r.vrsta === "projekcija" ? C.steel : C.soft, bold: r.vrsta === "projekcija" };
    return [
      { text: nazivMjeseca(r.mjesec), fontSize: 8.5, bold: true, color: C.ink }, status,
      br(r.prihod, { bold: true }), br(`${Math.round(r.sati).toLocaleString("hr-HR")} h`), br(r.rad), br(r.materijal), br(r.ostalo), br(r.fiksni), br(r.troskovi),
      br(r.rezultat, { bold: true, boja: r.rezultat >= 0 ? C.green : C.rust }), br(pct(r.marza)), br(kum, { boja: kum >= 0 ? C.ink : C.rust }),
    ].map((c) => ({ ...c, fillColor: pozadina }));
  });
  const strukturaTroskova = [
    { naziv: "Rad", iznos: u.rad, boja: C.steel },
    { naziv: "Materijal", iznos: u.materijal, boja: C.steelLight },
    { naziv: "Transport i vanjski", iznos: u.ostalo, boja: C.costDark },
    { naziv: "Fiksni troškovi", iznos: u.fiksni, boja: C.cost },
  ].filter((d) => d.iznos > 0.5);
  const poMjesecima = [
    naslov("Pregled po mjesecima", "Ostvareno = isporučeno kupcu do danas; projekcija = preostalo prema rokovima isporuke"),
    {
      table: {
        headerRows: 1,
        widths: [70, 52, "*", 50, "*", "*", "*", "*", "*", "*", 40, "*"],
        body: [
          [zag("Mjesec"), zag("Status"), zag("Prihod", true), zag("Sati", true), zag("Rad", true), zag("Materijal", true), zag("Transport i vanjski", true), zag("Fiksni", true), zag("Troškovi", true), zag("Rezultat", true), zag("Marža", true), zag("Kumulativno", true)],
          ...mjesecniRedovi,
          [{ text: "Ukupno", bold: true, fontSize: 8.5 }, { text: "" }, br(u.prihod, { bold: true }), br(`${Math.round(u.sati).toLocaleString("hr-HR")} h`, { bold: true }), br(u.rad, { bold: true }), br(u.materijal, { bold: true }), br(u.ostalo, { bold: true }), br(u.fiksni, { bold: true }), br(u.troskovi, { bold: true }), br(u.rezultat, { bold: true, boja: u.rezultat >= 0 ? C.green : C.rust }), br(pct(u.marza), { bold: true }), br("")],
        ],
      },
      layout: tablicaLayout(true),
      margin: [0, 0, 0, 22],
    },
    ...(strukturaTroskova.length ? [
      { text: "Struktura troškova u razdoblju", fontSize: 11, bold: true, color: C.ink, margin: [0, 0, 0, 8] },
      { svg: trakaUdjela(strukturaTroskova, SIRINA, 16), width: SIRINA },
      {
        columns: strukturaTroskova.map((d) => ({
          width: "auto",
          columns: [kvadratic(d.boja), { stack: [{ text: d.naziv, fontSize: 8.5, color: C.ink, bold: true }, { text: `${eur(d.iznos)} · ${pct((d.iznos / (u.troskovi || 1)) * 100)}`, fontSize: 8, color: C.soft }], width: "auto" }],
          columnGap: 3, margin: [0, 0, 26, 0],
        })),
        margin: [0, 8, 0, 0],
      },
    ] : []),
  ];

  // ---------- 4. po projektima ----------
  const prikazMjeseci = rez.mjeseci.length <= 6;
  const sUgovorenim = rez.mjeseci.length <= 3; // kod 4–6 mjeseci izostavljaju se Ugovoreno i Isporučeno da stanu iznosi po mjesecima
  const projekti = rez.projekti.filter((r) => r.preostalo > 0.5 || r.uRazdoblju > 0.5);
  const NAJVISE = 24;
  const prikazani = projekti.slice(0, NAJVISE), ostali = projekti.slice(NAJVISE);
  const celijaProjekta = (r) => ({ stack: [{ text: r.sifra, bold: true, fontSize: 8.5, color: C.ink }, { text: r.naziv, fontSize: 7, color: C.soft }] });
  const redProjekta = (r, i) => [
    celijaProjekta(r), { text: r.kupac || "—", fontSize: 7.5, color: C.soft },
    ...(sUgovorenim || !prikazMjeseci ? [br(r.ugovoreno, { fs: 8 }), br(r.isporuceno, { fs: 8 })] : []), br(r.preostalo, { fs: 8, bold: true }),
    ...(prikazMjeseci ? rez.mjeseci.map((m) => br(r.poMjesecima[m] ? eur(r.poMjesecima[m]) : "—", { fs: 8, boja: r.poMjesecima[m] ? C.ink : C.faint })) : [br(r.uRazdoblju, { fs: 8, bold: true })]),
    br(r.izvanRazdoblja ? eur(r.izvanRazdoblja) : "—", { fs: 8, boja: r.izvanRazdoblja ? C.soft : C.faint }),
    { text: `${r.rok ? fmtDate(r.rok) : "—"}${r.kasni ? (r.rokKasni !== r.rok ? "\ndio kasni" : "\nkasni") : ""}${r.rucno ? "\nručni raspored" : ""}`, fontSize: 7.5, color: r.kasni ? C.rust : C.soft, bold: r.kasni },
  ].map((c) => ({ ...c, fillColor: i % 2 ? "#FAFBFC" : null }));
  const zbrojKol = (lista, f) => lista.reduce((a, r) => a + f(r), 0);
  const poProjektima = [
    naslov("Prihod po projektima", `Preostalo za isporuku po mjesecima${prikazMjeseci ? "" : " (ukupno u razdoblju)"} · „Kasnije“ = nakon kraja razdoblja`),
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        // širine sadržaja (bez razmaka 2 × 4 pt po stupcu) tako da tablica stane u 761 pt
        widths: sUgovorenim ? [130, 140, 50, 50, 52, ...rez.mjeseci.map(() => "*"), 44, 52]
          : prikazMjeseci ? [120, 110, 52, ...rez.mjeseci.map(() => "*"), 44, 52]
          : [160, 168, 56, 56, 58, "*", 48, 58],
        body: [
          [zag("Projekt"), zag("Kupac"), ...(sUgovorenim || !prikazMjeseci ? [zag("Ugovoreno", true), zag("Isporučeno", true)] : []), zag("Preostalo", true), ...(prikazMjeseci ? rez.mjeseci.map((m) => zag(`${kratko(m)} ${m.slice(2, 4)}`, true)) : [zag("U razdoblju", true)]), zag("Kasnije", true), zag("Rok")],
          ...prikazani.map(redProjekta),
          ...(ostali.length ? [[{ text: `Ostali projekti (${ostali.length})`, fontSize: 8, italics: true, color: C.soft }, { text: "" }, ...(sUgovorenim || !prikazMjeseci ? [br(zbrojKol(ostali, (r) => r.ugovoreno), { fs: 8 }), br(zbrojKol(ostali, (r) => r.isporuceno), { fs: 8 })] : []), br(zbrojKol(ostali, (r) => r.preostalo), { fs: 8 }),
            ...(prikazMjeseci ? rez.mjeseci.map((m) => br(zbrojKol(ostali, (r) => r.poMjesecima[m] || 0), { fs: 8 })) : [br(zbrojKol(ostali, (r) => r.uRazdoblju), { fs: 8 })]), br(zbrojKol(ostali, (r) => r.izvanRazdoblja), { fs: 8 }), { text: "" }]] : []),
          [{ text: "Ukupno", bold: true, fontSize: 8.5 }, { text: "" }, ...(sUgovorenim || !prikazMjeseci ? [br(zbrojKol(projekti, (r) => r.ugovoreno), { fs: 8, bold: true }), br(zbrojKol(projekti, (r) => r.isporuceno), { fs: 8, bold: true })] : []), br(zbrojKol(projekti, (r) => r.preostalo), { fs: 8, bold: true }),
            ...(prikazMjeseci ? rez.mjeseci.map((m) => br(zbrojKol(projekti, (r) => r.poMjesecima[m] || 0), { fs: 8, bold: true })) : [br(zbrojKol(projekti, (r) => r.uRazdoblju), { fs: 8, bold: true })]), br(zbrojKol(projekti, (r) => r.izvanRazdoblja), { fs: 8, bold: true }), { text: "" }],
        ],
      },
      layout: { ...tablicaLayout(true), paddingLeft: () => 4, paddingRight: () => 4 },
    },
    { text: "Projicirani prihod projekta = ugovoreno (narudžbe kupca; bez narudžbe vrijednost projekta; kupaonice masa × €/kg) minus isporučeno, raspoređeno na rok projekta, rok dodatne narudžbe ili raspored isporuka. Projekti s prošlim rokom prikazani su u tekućem mjesecu.", fontSize: 7.5, color: C.faint, margin: [0, 8, 0, 0] },
  ];

  // ---------- 5. kupci, rizici, potencijal, pretpostavke ----------
  const kupci = rez.kupci.slice(0, 10);
  const maksKupac = Math.max(1, ...kupci.map((k) => k.iznos));
  const ukupnoKupci = rez.kupci.reduce((a, k) => a + k.iznos, 0) || 1;
  const blokKupci = {
    stack: [
      { text: "Najveći kupci u razdoblju", fontSize: 11, bold: true, color: C.ink, margin: [0, 0, 0, 8] },
      kupci.length ? {
        table: {
          widths: [118, 96, 64, 28],
          body: kupci.map((k) => [
            { text: k.naziv, fontSize: 8.5, color: C.ink },
            { canvas: [{ type: "rect", x: 0, y: 2, w: Math.max(2, (k.iznos / maksKupac) * 92), h: 9, color: C.steel }] },
            br(k.iznos, { fs: 8.5 }),
            br(pct((k.iznos / ukupnoKupci) * 100), { fs: 8, boja: C.soft }),
          ]),
        },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 0, paddingRight: () => 6 },
      } : { text: "Nema prihoda u razdoblju.", fontSize: 9, color: C.soft },
    ],
  };
  const lista = (stavke, boja = C.ink) => ({ ul: stavke.map((t) => ({ text: t, fontSize: 8.5, color: boja, margin: [0, 0, 0, 3] })), markerColor: C.accent, margin: [0, 0, 0, 10] });
  const u2 = rez.upozorenja;
  const rizici = [
    ...u2.kasni.map((k) => `${k.sifra} ${k.naziv} — ${k.dio ? "rok dijela posla" : "rok"} ${fmtDate(k.rok)} je prošao, ${eur(k.iznos)} još nije isporučeno.`),
    ...(u2.bezVrijednosti.length ? [`Aktivni projekti bez upisane vrijednosti (nisu u prihodu): ${u2.bezVrijednosti.map((k) => k.sifra).join(", ")}.`] : []),
    ...(u2.bezCijeneIsporuka.length ? [`Projekti s isporukama bez cijena (isporučeno se ne zna, preostala je cijela vrijednost): ${u2.bezCijeneIsporuka.map((k) => k.sifra).join(", ")}.`] : []),
  ];
  const blokDesno = {
    stack: [
      { text: "Rizici", fontSize: 11, bold: true, color: C.ink, margin: [0, 0, 0, 6] },
      rizici.length ? lista(rizici) : { text: "Nema projekata koji kasne ni projekata bez vrijednosti.", fontSize: 8.5, color: C.soft, margin: [0, 0, 0, 10] },
      { text: "Potencijal — poslane ponude (nisu u projekciji)", fontSize: 11, bold: true, color: C.ink, margin: [0, 4, 0, 6] },
      rez.ponude.length ? {
        table: {
          widths: [62, "*", 70],
          body: [
            [zag("Ponuda"), zag("Kupac / posao"), zag("Iznos", true)],
            ...rez.ponude.slice(0, 8).map((p) => [{ text: p.broj, fontSize: 8, color: C.ink }, { text: `${p.kupac}${p.naziv ? ` — ${p.naziv}` : ""}`, fontSize: 7.5, color: C.soft }, br(p.iznos, { fs: 8 })]),
            [{ text: "Ukupno", bold: true, fontSize: 8 }, { text: "" }, br(ponudeIznos, { fs: 8, bold: true })],
          ],
        },
        layout: tablicaLayout(true), margin: [0, 0, 0, 12],
      } : { text: "Nema poslanih ponuda na čekanju.", fontSize: 8.5, color: C.soft, margin: [0, 0, 0, 12] },
      { text: "Pretpostavke", fontSize: 11, bold: true, color: C.ink, margin: [0, 0, 0, 6] },
      lista([
        `Prihod se priznaje isporukom kupcu; ostvareno su otpremnice do ${fmtDate(danas)}, a projekcija preostalo prema rokovima isporuke.`,
        `Trošak rada: ${trosakSata ? `${trosakSata.toLocaleString("hr-HR")} €/h` : "nije upisan (0 €)"} × sati; prošli dani prema prisutnosti radione, budući prema planu proizvodnje.`,
        `Materijal: udio iz kalkulacije ponude projekta; projekti bez ponude ${materijalPostotak.toLocaleString("hr-HR")} % prihoda. Prošli mjeseci prema zaprimljenim narudžbenicama.`,
        ...(fiksniMjesecno ? [`Fiksni troškovi: ${eur(fiksniMjesecno)} mjesečno.`] : ["Fiksni troškovi (režije, uprava) nisu uključeni."]),
        "Iznosi su bez PDV-a.",
      ], C.soft),
    ],
  };
  const zadnja = [naslov("Kupci, rizici i pretpostavke"), { columns: [{ width: 340, ...blokKupci }, { width: "*", ...blokDesno }], columnGap: 30 }];

  const sadrzaj = [
    ...naslovnica,
    { text: "", pageBreak: "after" },
    ...sazetak,
    { text: "", pageBreak: "after" },
    ...poMjesecima,
    { text: "", pageBreak: "after" },
    ...poProjektima,
    { text: "", pageBreak: "after" },
    ...zadnja,
  ];

  const dd = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [40, 60, 40, 44],
    info: { title: `Projekcija prihoda i troškova — ${razdoblje}`, author: imeTvrtke, subject: "Projekcija za upravu" },
    defaultStyle: { font: "Roboto", fontSize: 9, color: C.ink },
    background: (stranica, velicina) => (stranica === 1
      ? { canvas: [{ type: "rect", x: 0, y: velicina.height - 190, w: velicina.width, h: 190, color: C.dark }, { type: "rect", x: 0, y: velicina.height - 190, w: velicina.width, h: 4, color: C.accent }] }
      : null),
    header: (stranica) => (stranica === 1 ? null : {
      margin: [40, 22, 40, 0],
      stack: [
        {
          columns: [
            logo ? { image: logo, width: 62 } : { text: "ECON", bold: true, color: C.steel },
            { text: `Projekcija prihoda i troškova · ${razdoblje}`, alignment: "right", fontSize: 8.5, color: C.soft, margin: [0, 4, 0, 0] },
          ],
        },
        { canvas: [{ type: "line", x1: 0, y1: 8, x2: SIRINA, y2: 8, lineWidth: 0.6, lineColor: C.line }] },
      ],
    }),
    footer: (stranica, ukupno) => (stranica === 1 ? null : {
      margin: [40, 12, 40, 0],
      columns: [
        { text: `${imeTvrtke} · Povjerljivo — samo za internu upotrebu · stanje ${fmtDate(danas)}`, fontSize: 7.5, color: C.faint },
        { text: `${stranica} / ${ukupno}`, alignment: "right", fontSize: 7.5, color: C.faint },
      ],
    }),
    content: sadrzaj,
  };
  const buffer = await pdfMake.createPdf(dd).getBuffer();
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

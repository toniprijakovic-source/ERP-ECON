// Čitanje izvještaja knjigovodstva (.xls/.xlsx) za projekciju prihoda i troškova:
//  - "Račun dobiti i gubitka" (stavke A–N: prihod, direktni materijal, usluge podizvođača, trošak razdoblja, direktni rad,
//    rad DE, raspored troškova, transport, rezultat I, OTP troškovi i prihod, rezultat II) i razdoblje iz "Bruto bilance";
//  - "Satnica proizvodnje" (sati proizvodnje, direktni rad po satu, puna satnica).
// Biblioteka xlsx učitava se tek kad se izvještaj odabere. Vraća samo brojeve — ništa se ne sprema ovdje.

const tekst = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const broj = (c) => (c && typeof c.v === "number" ? c.v : null);

// Redovi lista kao nizovi ćelija (samo popunjene).
const redoviLista = (XLSX, ws) => {
  if (!ws || !ws["!ref"]) return [];
  const r = XLSX.utils.decode_range(ws["!ref"]);
  const out = [];
  for (let R = r.s.r; R <= r.e.r; R++) {
    const red = [];
    for (let C = r.s.c; C <= r.e.c; C++) {
      const c = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (c && c.v !== undefined && c.v !== "") red.push({ C, v: c.v, broj: broj(c), tekst: tekst(c.w ?? c.v) });
    }
    if (red.length) out.push(red);
  }
  return out;
};

const DATUM = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/g;
const isoIz = (d, m, g) => `${g}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const brojMjeseci = (od, doD) => {
  const [g1, m1] = od.split("-").map(Number), [g2, m2] = doD.split("-").map(Number);
  return Math.max(1, (g2 - g1) * 12 + (m2 - m1) + 1);
};

// Stavke računa dobiti i gubitka: oznaka (A, B…) u prvom stupcu, naziv u trećem, iznos u prvom brojčanom stupcu iza naziva.
const PRAVILA_RDG = [
  ["prihod", (s, n) => s === "A" || /^\(\+\)\s*PRIHOD/i.test(n)],
  ["materijal", (s, n) => /DIREKTNI MATERIJAL/i.test(n)],
  ["podizvodaci", (s, n) => /PODIZVO/i.test(n)],
  ["trosakRazdoblja", (s, n) => /TRO[ŠS]AK RAZDOBLJA/i.test(n)],
  ["direktniRad", (s, n) => /^\(-\)\s*Direktni rad/i.test(n)],
  ["radDE", (s, n) => /Rad DE/i.test(n)],
  ["rasporedDirektni", (s, n) => /RASPORED TRO[ŠS]KOVA POSLOVANJA/i.test(n)],
  ["rasporedUsluga", (s, n) => /RASPORED TRO[ŠS]KOVA-?\s*USLUG/i.test(n)],
  ["transport", (s, n) => /transporta/i.test(n)],
  ["rezultat1", (s, n) => /REZULTAT I\b(?!I)/i.test(n)],
  ["otpTroskovi", (s, n) => /OTP TRO[ŠS]KOVI/i.test(n)],
  ["otpPrihod", (s, n) => /OTP PRIHOD/i.test(n)],
  ["rasporedIndirektni", (s, n) => /RASPORED TRO[ŠS]KOVA\s*-\s*indirektni/i.test(n)],
  ["rasporedOpci", (s, n) => /RASPORED OSTALIH OP/i.test(n)],
  ["rezultat2", (s, n) => /REZULTAT II/i.test(n)],
];
// Dodatni redovi ispod (tablice plaća, OTP, nedovršena) — samo za prikaz.
const PRAVILA_DODATNO = [
  ["placeUkupno", /^Pla[ćc]e ukupno/i],
  ["indirektniRad", /^Indirektni rad/i],
  ["administracija", /Administracija/i],
  ["otpBezRada", /^OTP$/i],
  ["nedovrsena", /Proizvodnja u tijeku/i],
];

function procitajRdg(XLSX, wb) {
  const ime = wb.SheetNames.find((n) => /ra[čc]un dobiti/i.test(n) && !/tro[šs]k/i.test(n)) || wb.SheetNames.find((n) => /ra[čc]un dobiti/i.test(n));
  if (!ime) return null;
  const redovi = redoviLista(XLSX, wb.Sheets[ime]);
  const stavke = {}, dodatno = {};
  let naslovDatum = null;
  redovi.forEach((red) => {
    const nazivCel = red.find((c) => typeof c.v === "string" && c.tekst.length > 2 && !/^[A-N]$/.test(c.tekst) && !/^\d+$/.test(c.tekst));
    if (!nazivCel) return;
    const naziv = nazivCel.tekst;
    const oznaka = red.find((c) => c.C < nazivCel.C && /^[A-N]$/.test(c.tekst))?.tekst || "";
    const iznos = red.find((c) => c.C > nazivCel.C && c.broj != null)?.broj;
    if (/Ra[čc]un dobiti i gubitka/i.test(naziv)) { const m = [...naziv.matchAll(DATUM)].pop(); if (m) naslovDatum = isoIz(m[1], m[2], m[3]); }
    if (iznos == null) return;
    const pravilo = PRAVILA_RDG.find(([k, f]) => stavke[k] == null && f(oznaka, naziv));
    if (pravilo && (oznaka || /^\(|REZULTAT|OTP|RASPORED/i.test(naziv))) { stavke[pravilo[0]] = iznos; return; }
    const d = PRAVILA_DODATNO.find(([k, re]) => dodatno[k] == null && re.test(naziv));
    if (d) dodatno[d[0]] = iznos;
  });
  return { list: ime, stavke, dodatno, naslovDatum };
}

function procitajRazdoblje(XLSX, wb, naslovDatum) {
  for (const ime of wb.SheetNames) {
    for (const red of redoviLista(XLSX, wb.Sheets[ime]).slice(0, 15)) {
      for (const c of red) {
        const d = [...c.tekst.matchAll(DATUM)];
        if (d.length >= 2 && /-|–/.test(c.tekst)) return { od: isoIz(d[0][1], d[0][2], d[0][3]), do: isoIz(d[1][1], d[1][2], d[1][3]) };
      }
    }
  }
  if (naslovDatum) return { od: `${naslovDatum.slice(0, 4)}-01-01`, do: naslovDatum };
  return null;
}

function procitajSatnicu(XLSX, wb) {
  const ime = wb.SheetNames.find((n) => /satnic/i.test(n));
  if (!ime) return null;
  const s = {};
  redoviLista(XLSX, wb.Sheets[ime]).forEach((red) => {
    const naziv = red.find((c) => typeof c.v === "string")?.tekst || "";
    const brojevi = red.filter((c) => c.broj != null).map((c) => c.broj);
    if (!brojevi.length) return;
    if (/^h$/i.test(naziv) && s.sati == null) s.sati = brojevi[0];
    else if (/^Direktni rad/i.test(naziv) && s.direktnoPoSatu == null) s.direktnoPoSatu = brojevi[brojevi.length - 1];
    else if (/^Satnica proizvodnje/i.test(naziv) && s.punaSatnica == null) s.punaSatnica = brojevi[brojevi.length - 1];
  });
  return s.sati || s.direktnoPoSatu || s.punaSatnica ? s : null;
}

// datoteke: FileList / niz File objekata. Vraća { izvjestaj?, satnica?, greske[] }.
export async function procitajIzvjestajeKnjigovodstva(datoteke) {
  const XLSX = await import("xlsx");
  const rez = { greske: [], datoteke: [] };
  for (const f of datoteke) {
    try {
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
      const rdg = procitajRdg(XLSX, wb);
      const sat = procitajSatnicu(XLSX, wb);
      if (rdg && rdg.stavke.prihod > 0) {
        const razdoblje = procitajRazdoblje(XLSX, wb, rdg.naslovDatum);
        if (!razdoblje) { rez.greske.push(`${f.name}: razdoblje izvještaja nije pronađeno.`); continue; }
        rez.izvjestaj = { datoteka: f.name, ...razdoblje, mjeseci: brojMjeseci(razdoblje.od, razdoblje.do), stavke: rdg.stavke, dodatno: rdg.dodatno };
        rez.datoteke.push(f.name);
      } else if (sat) {
        rez.satnica = { datoteka: f.name, ...sat };
        rez.datoteke.push(f.name);
      } else rez.greske.push(`${f.name}: nije prepoznat ni račun dobiti i gubitka ni satnica proizvodnje.`);
    } catch (e) {
      rez.greske.push(`${f.name}: datoteka se ne može pročitati (${e.message}).`);
    }
  }
  return rez;
}

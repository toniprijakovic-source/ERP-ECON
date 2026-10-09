// PDF upita za materijal (vektorski tekst) i poruka e-pošte (.eml) s priloženim PDF-om za slanje dobavljačima.
// pdfmake je velik pa se učitava tek kad se PDF stvarno izrađuje (zasebni dio aplikacije).

const CRLF = "\r\n";

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

// Isti sadržaj kao ispis upita u aplikaciji (zaglavlje tvrtke, tablica stavki, opći zahtjevi, certifikati, podnožje na svakoj stranici).
export async function napraviPdfUpitaMaterijala({ broj, datum, izradioIme, stavke, tvrtka, formatDimenzije, fmtDatum }) {
  const pdfMake = await ucitajPdfMake();
  const t = tvrtka || {};
  const siva = "#555";
  const kvadrat = (oznaceno) => ({
    width: 14,
    canvas: [
      { type: "rect", x: 0, y: 1, w: 11, h: 11, lineWidth: 0.8 },
      ...(oznaceno ? [{ type: "line", x1: 2, y1: 7, x2: 5, y2: 10, lineWidth: 1.5 }, { type: "line", x1: 5, y1: 10, x2: 9.5, y2: 3, lineWidth: 1.5 }] : []),
    ],
  });
  const zaglavljeCelije = ["R. br.", "Kom:", "Dimenzije: [mm]", "Vrsta materijala/ Norma kvalitete:", "Kvaliteta materijala:", "Zahtijevane norme isporuke:", "Dodatni zahtjevi:"]
    .map((x) => ({ text: x, bold: true, fillColor: "#f0f0f0", fontSize: 8 }));
  const redovi = (stavke || []).map((s, i) => [`${i + 1}.`, String(s.kolicina ?? ""), formatDimenzije(s), s.vrstaMaterijala || "", s.kvaliteta || "", s.normaIsporuke || "", s.dodatniZahtjevi || ""].map((x) => ({ text: x, fontSize: 8.5 })));
  const podnozje = () => ({
    margin: [36, 0, 36, 16],
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.6, lineColor: "#999" }] },
      {
        margin: [0, 4, 0, 0], fontSize: 7, color: "#333", lineHeight: 1.25,
        text: [
          { text: "OIB: ", bold: true }, `${t.oib || ""} | `, { text: "MB: ", bold: true }, `${t.mb || ""} | `, { text: "VAT-ID: ", bold: true }, `${t.vatId || ""} | `, { text: "Žiro račun: ", bold: true }, `${t.ziroRacun || ""}\n`,
          { text: "IBAN: ", bold: true }, `${t.iban || ""} | `, { text: "SWIFT: ", bold: true }, `${t.swift || ""} | Poduzeće je upisano na ${t.sud || ""}, `, { text: "MBS: ", bold: true }, `${t.mbs || ""} | `, { text: "Temeljni kapital: ", bold: true }, `${t.temeljniKapital || ""} | `, { text: "Uprava: ", bold: true }, `${t.uprava || ""}`,
        ],
      },
    ],
  });
  const dd = {
    pageSize: "A4",
    pageMargins: [36, 36, 36, 62],
    defaultStyle: { font: "Roboto", fontSize: 9.5, color: "#111" },
    info: { title: `Upit ${broj}`, author: t.naziv || "" },
    footer: podnozje,
    content: [
      {
        columns: [
          { width: "*", text: "NARUDŽBA / UPIT\nZA NABAVU OSNOVNOG\nMATERIJALA", bold: true, fontSize: 13, lineHeight: 1.2 },
          {
            width: 220, alignment: "right", fontSize: 8.5, lineHeight: 1.3,
            stack: [{ text: t.naziv || "", bold: true, fontSize: 11 }, { text: t.djelatnost || "", color: siva, fontSize: 8, margin: [0, 0, 0, 3] }, t.adresa || "", t.telefon || "", t.email || "", t.web || ""].filter((x) => x !== ""),
          },
        ],
        margin: [0, 0, 0, 14],
      },
      { columns: [kvadrat(true), { width: 60, text: "Upit", margin: [3, 0, 0, 0] }, kvadrat(false), { width: "*", text: "Narudžba", margin: [3, 0, 0, 0] }], columnGap: 2, margin: [0, 0, 0, 12] },
      {
        table: { body: [["Datum:", { text: fmtDatum(datum), bold: true }], ["Izradio:", { text: izradioIme || "", bold: true }], ["Upit/Narudžba broj:", { text: String(broj), bold: true }]].map(([a, b]) => [{ text: a, color: siva }, b]) },
        layout: "noBorders", margin: [0, 0, 0, 14],
      },
      {
        table: { headerRows: 1, widths: [26, 32, 56, "*", 58, 66, "*"], body: [zaglavljeCelije, ...redovi] },
        layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => "#333", vLineColor: () => "#333", paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3 },
        margin: [0, 0, 0, 14],
      },
      { text: "Opći zahtjevi:", bold: true, margin: [0, 0, 0, 3] },
      {
        ol: [
          "Svaki nabavljeni materijal ili dio mora biti popraćen sa primjerkom uvjerenja o kvaliteti ili certifikatom usklađenosti po tehničkim specifikacijama ili općim normama.",
          "Na svim uvjerenjima o kvaliteti ili certifikatima usklađenosti moraju biti navedene zahtijevane norme, te sve šarže materijala moraju biti usklađene s uvjerenjima.",
          "Kontrola se vrši prilikom preuzimanja robe.",
        ],
        margin: [0, 0, 0, 12], fontSize: 9,
      },
      { text: "Certifikati i izvještaji:", bold: true, margin: [0, 0, 0, 3] },
      { text: "Za materijale kvalitete S235/S275 JR /J0 dostaviti ateste materijala 2.2", bold: true, fontSize: 9 },
      { text: "Za materijale kvalitete S235/S275 J2 i više razrede kvalitete dostaviti ateste materijala 3.1.", bold: true, fontSize: 9 },
      { text: "Za vijke je potrebno isporučiti izjavu o svojstvima.", fontSize: 9 },
      { text: "Sve materijale za konstrukcije isporučiti sa vidljivom oznakom šarže.", bold: true, fontSize: 9, margin: [0, 0, 0, 14] },
      { text: "Molimo Vas da nas po primitku narudžbe izvijestite.", fontSize: 9 },
      { text: "Za eventualne potrebne informacije stojimo Vam na raspolaganju!", fontSize: 9 },
      { text: "S poštovanjem,", margin: [0, 8, 0, 0], fontSize: 9 },
      { text: t.naziv || "", bold: true, margin: [0, 6, 0, 0], fontSize: 9 },
      { text: izradioIme || "", fontSize: 9 },
    ],
  };
  const buffer = await pdfMake.createPdf(dd).getBuffer();
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

const utf8 = (s) => new TextEncoder().encode(s);
const base64 = (bajtovi) => {
  let bin = "";
  const korak = 0x8000;
  for (let i = 0; i < bajtovi.length; i += korak) bin += String.fromCharCode.apply(null, bajtovi.subarray(i, i + korak));
  return btoa(bin);
};
const base64Redci = (bajtovi) => (base64(bajtovi).match(/.{1,76}/g) || []).join(CRLF);

// Naslov s dijakriticima u zaglavlju e-pošte (RFC 2047), po znakovima da se UTF-8 niz ne razreže.
const kodirajNaslov = (naslov) => {
  if (/^[\x20-\x7e]*$/.test(naslov)) return naslov;
  const dijelovi = [];
  let trenutni = "";
  for (const znak of naslov) {
    if (utf8(trenutni + znak).length > 33) { dijelovi.push(trenutni); trenutni = ""; }
    trenutni += znak;
  }
  if (trenutni) dijelovi.push(trenutni);
  return dijelovi.map((d) => `=?UTF-8?B?${base64(utf8(d))}?=`).join(CRLF + " ");
};

// Poruka koju Outlook otvara kao NEPOSLANU skicu (X-Unsent: 1) s primateljima, naslovom, tekstom i priloženim PDF-om.
export function napraviEml({ primatelji = [], skriveni = [], naslov, tekst, pdf, imePdfa }) {
  const granica = `----=_Part_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const sigurnoIme = String(imePdfa).replace(/[^A-Za-z0-9._-]+/g, "_");
  const zaglavlje = [
    "X-Unsent: 1",
    ...(primatelji.length ? [`To: ${primatelji.join(", ")}`] : []),
    ...(skriveni.length ? [`Bcc: ${skriveni.join(", ")}`] : []),
    `Subject: ${kodirajNaslov(naslov)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${granica}"`,
  ].join(CRLF);
  const tijelo = [
    `--${granica}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Redci(utf8(tekst.replace(/\r?\n/g, CRLF))),
    `--${granica}`,
    `Content-Type: application/pdf; name="${sigurnoIme}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${sigurnoIme}"`,
    "",
    base64Redci(pdf),
    `--${granica}--`,
    "",
  ].join(CRLF);
  return new Blob([zaglavlje + CRLF + CRLF + tijelo], { type: "message/rfc822" });
}

export function preuzmiDatoteku(blob, imeDatoteke) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = imeDatoteke;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const IZJAVA_ODRICANJA = `-----------------------------------------------------------------------------------------
IZJAVA O ODRICANJU OD ODGOVORNOSTI:
Ova elektronička poruka i njeni prilozi mogu sadržavati povlaštene informacije i/ili povjerljive informacije. Molimo Vas da poruku ne čitate ako niste njen naznačeni primatelj. Ako ste ovu poruku primili greškom, molimo Vas da o tome obavijestite pošiljatelja i da izvornu poruku i njene privitke uništite bez čitanja ili bilo kakvog pohranjivanja. Svaka neovlaštena upotreba, distribucija, reprodukcija ili priopćavanje ove poruke zabranjena je. ECON d.o.o. ne preuzima odgovornost za  sadržaj ove poruke, odnosno za posljedice radnji koje bi proizašle iz proslijeđenih informacija, a niti stajališta izražena u ovoj poruci ne odražavaju nužno službena stajališta ECON d.o.o.. S obzirom na nepostojanje potpune sigurnosti e-mail komunikacije, ECON d.o.o. ne preuzima odgovornost za eventualnu štetu nastalu uslijed zaraženosti e-mail poruke virusom ili drugim štetnim programom, neovlaštene interferencije, pogrešne ili zakašnjele dostave poruke uslijed tehničkih problema.

DISCLAIMER:
This e-mail message and its attachments may contain privileged and/or confidential information. Please do not read the message if You are not its designated recipient. If You have received this message by mistake, please inform its sender and destroy the original message and its attachments without reading or storing of any kind. Any unauthorized use, distribution, reproduction or publication of this message is forbidden. ECON d.o.o. is neither responsible for the contents of this message, nor for the consequences arising from actions based on the forwarded information, nor do opinions contained within this message necessarily reflect the official opinions of  ECON d.o.o. Considering the lack of complete security of e-mail communication, ECON d.o.o. is not responsible for the potential damage created due to infection of an e-mail message with a virus or other malicious program, unauthorized interference, erroneous or delayed delivery of the message due to technical problem`;

// Potpis e-pošte prilagođen osobi koja šalje: ime i prezime, GSM (zaposlenik.telefon) i e-mail osobe, a ostalo iz postavki tvrtke.
export function potpisEmail(posiljatelj, tvrtka) {
  const t = tvrtka || {};
  const adresa = String(t.adresa || "").split(/\s*,\s*/).filter(Boolean).join(" | ");
  const web = t.web ? (/^https?:\/\//i.test(t.web) ? t.web : `http://${t.web}`) : "";
  const email = (posiljatelj && posiljatelj.email) || t.email || "";
  const redci = [
    "Srdačan pozdrav! / Mit freundlichen Grüßen / Best regards",
    "",
    posiljatelj ? `${posiljatelj.ime || ""} ${posiljatelj.prezime || ""}`.trim() : "",
    "",
    t.naziv || "",
    adresa,
    t.telefon ? `Tel: ${t.telefon}` : "",
    t.faks ? `Fax: ${t.faks}` : "",
    posiljatelj && posiljatelj.telefon ? `GSM: ${posiljatelj.telefon}` : "",
    email ? `E-mail: ${email}` : "",
    web,
  ];
  // prazan redak ostaje samo ako je razmak između dijelova potpisa (ne uklanjaju se redci s podacima koji nedostaju)
  const tekst = redci.filter((r, i) => r !== "" || i === 1 || i === 3).join("\n");
  return `${tekst}\n\n${IZJAVA_ODRICANJA}`;
}

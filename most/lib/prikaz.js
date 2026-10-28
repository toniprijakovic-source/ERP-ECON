// Čitljiv PDF prikaz XRechnunga ("Rechnungsansicht"): isti podaci kao u XML-u, složeni kao račun — za provjeru prije slanja.
// Ulaz je tekst GOTOVOG XRechnung XML-a (UBL), pa prikaz pokazuje točno ono što primatelj dobiva. Nije pravni dokument; mjerodavan je XML.
import { XMLParser } from "fast-xml-parser";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, parseTagValue: false, trimValues: true });
const niz = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const tekst = (v) => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));
const iznosDe = (v) => `${Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const kolicinaDe = (v) => Number(v).toLocaleString("de-DE", { maximumFractionDigits: 4 });
const datumDe = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso.split("-").reverse().join(".") : iso || "");
const JEDINICE = { LS: "psch.", C62: "Stk.", H87: "Stk.", KGM: "kg", MTR: "m", MTK: "m²", HUR: "Std.", LTR: "l", TNE: "t", DAY: "Tag" };
const VRSTE = { 380: "Rechnung", 384: "Korrekturrechnung", 381: "Gutschrift", 326: "Teilrechnung", 389: "Selbst ausgestellte Rechnung" };

// Standardni PDF fontovi znaju samo WinAnsi: č, ć, đ i sl. se zamjenjuju osnovnim slovom, a nepoznati znakovi znakom "?".
const DOPUSTENI = /[ -~ -ÿ€ŠšŽž–—‘’“”•…]/;
export const sigurno = (s) => [...String(s ?? "")].map((c) => {
  if (DOPUSTENI.test(c)) return c;
  const osnovno = c.replace(/đ/g, "dj").replace(/Đ/g, "Dj").normalize("NFD").replace(/[̀-ͯ]/g, "");
  return [...osnovno].every((k) => DOPUSTENI.test(k)) ? osnovno : "?";
}).join("");

function stranka(p) {
  const a = p?.PostalAddress || {};
  return {
    naziv: tekst(p?.PartyLegalEntity?.RegistrationName) || tekst(p?.PartyName?.Name),
    adresa: [tekst(a.StreetName), `${tekst(a.PostalZone)} ${tekst(a.CityName)}`.trim(), tekst(a.Country?.IdentificationCode)].filter(Boolean),
    pdv: tekst(p?.PartyTaxScheme?.CompanyID),
    kontakt: [tekst(p?.Contact?.Name), tekst(p?.Contact?.Telephone), tekst(p?.Contact?.ElectronicMail)].filter(Boolean),
    eAdresa: tekst(p?.EndpointID),
  };
}

export async function napraviPrikazPdf(xmlTekst) {
  const inv = parser.parse(String(xmlTekst).replace(/^﻿/, "")).Invoice;
  if (!inv) throw new Error("Datoteka nije račun (UBL Invoice).");
  const prod = stranka(inv.AccountingSupplierParty?.Party), kup = stranka(inv.AccountingCustomerParty?.Party);
  const isp = inv.Delivery?.DeliveryLocation?.Address || {};
  const placanje = niz(inv.PaymentMeans)[0] || {};
  const ukupno = inv.LegalMonetaryTotal || {};
  const porez = niz(inv.TaxTotal?.TaxSubtotal)[0] || {};
  const prilozi = niz(inv.AdditionalDocumentReference).map((r) => ({ naziv: tekst(r.Attachment?.EmbeddedDocumentBinaryObject?.["@_filename"]), opis: tekst(r.DocumentDescription) })).filter((r) => r.naziv);
  const raniji = niz(inv.BillingReference).map((b) => ({ broj: tekst(b.InvoiceDocumentReference?.ID), datum: tekst(b.InvoiceDocumentReference?.IssueDate) })).filter((r) => r.broj);
  const linije = niz(inv.InvoiceLine).map((l) => ({
    id: tekst(l.ID), naziv: tekst(l.Item?.Name), opis: tekst(l.Item?.Description), kolicina: tekst(l.InvoicedQuantity), jedinica: l.InvoicedQuantity?.["@_unitCode"] || "",
    cijena: tekst(l.Price?.PriceAmount), iznos: tekst(l.LineExtensionAmount), pdv: tekst(l.Item?.ClassifiedTaxCategory?.ID),
  }));

  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const L = 45, R = 550, SIRINA = R - L;
  const crna = rgb(0, 0, 0), siva = rgb(0.93, 0.93, 0.93), tamna = rgb(0.35, 0.35, 0.35);
  let s = pdf.addPage([595, 842]);
  let y = 800;

  const sirinaTeksta = (t, o = {}) => (o.bold ? fb : f).widthOfTextAtSize(sigurno(t), o.size ?? 9);
  const pisi = (t, x, yy, o = {}) => s.drawText(sigurno(t), { x, y: yy, size: o.size ?? 9, font: o.bold ? fb : f, color: o.boja || crna });
  const desno = (t, xr, yy, o = {}) => pisi(t, xr - sirinaTeksta(t, o), yy, o);
  const crta = (yy, d = 0.6) => s.drawLine({ start: { x: L, y: yy }, end: { x: R, y: yy }, thickness: d, color: crna });
  const omotaj = (t, maxW, o = {}) => {
    const redovi = [];
    for (const odlomak of String(t ?? "").split(/\r?\n/).map(sigurno)) {
      let red = "";
      for (const rijec of odlomak.split(/\s+/).filter(Boolean)) {
        const probni = red ? `${red} ${rijec}` : rijec;
        if (red && sirinaTeksta(probni, o) > maxW) { redovi.push(red); red = rijec; } else red = probni;
      }
      redovi.push(red);
    }
    return redovi;
  };
  const trebaMjesta = (visina) => { if (y - visina < 60) { s = pdf.addPage([595, 842]); y = 800; } };
  // Blok teksta s omatanjem; vraća novi y. Svaki redak se prvo provjeri za prijelom na novu stranicu.
  const blok = (t, x, maxW, o = {}) => { const razmak = (o.size ?? 9) + 3; for (const red of omotaj(t, maxW, o)) { trebaMjesta(razmak); pisi(red, x, y, o); y -= razmak; } };
  const naslovOdjeljka = (t) => { trebaMjesta(30); y -= 8; s.drawRectangle({ x: L, y: y - 4, width: SIRINA, height: 15, color: siva }); pisi(t, L + 3, y, { bold: true }); y -= 19; };

  // --- Zaglavlje
  pisi(VRSTE[tekst(inv.InvoiceTypeCode)] || "Rechnung", L, y, { size: 17, bold: true });
  desno(`Nr. ${tekst(inv.ID)}`, R, y, { size: 13, bold: true });
  y -= 15;
  pisi("Lesbare Darstellung der XRechnung (EN 16931 / XRechnung 3.0). Maßgeblich ist die XML-Datei; dieses PDF dient nur der Ansicht.", L, y, { size: 7.5, boja: tamna });
  y -= 22;

  // --- Rechnungssteller / Rechnungsempfänger (dva stupca)
  const stupac = (naslov, st, x) => {
    let yy = y;
    pisi(naslov, x, yy, { bold: true, size: 8, boja: tamna }); yy -= 13;
    pisi(st.naziv, x, yy, { bold: true, size: 10 }); yy -= 12;
    for (const r of st.adresa) { pisi(r, x, yy); yy -= 11; }
    if (st.pdv) { pisi(`USt-IdNr.: ${st.pdv}`, x, yy); yy -= 11; }
    for (const r of st.kontakt) { pisi(r, x, yy); yy -= 11; }
    if (st.eAdresa) { pisi(`E-Mail (Adresse): ${st.eAdresa}`, x, yy, { size: 8, boja: tamna }); yy -= 11; }
    return yy;
  };
  const y1 = stupac("RECHNUNGSSTELLER", prod, L), y2 = stupac("RECHNUNGSEMPFÄNGER", kup, L + 280);
  y = Math.min(y1, y2) - 6;

  // --- Podaci računa
  naslovOdjeljka("Rechnungsdaten");
  const podaci = [
    ["Rechnungsdatum", datumDe(tekst(inv.IssueDate))], ["Zahlungsziel", datumDe(tekst(inv.DueDate))], ["Lieferdatum", datumDe(tekst(inv.Delivery?.ActualDeliveryDate))],
    ["Käuferreferenz", tekst(inv.BuyerReference)], ["Projekt-/Auftragsnummer", tekst(inv.ProjectReference?.ID)],
    ["Lieferadresse", [tekst(isp.StreetName), `${tekst(isp.PostalZone)} ${tekst(isp.CityName)}`.trim(), tekst(isp.Country?.IdentificationCode)].filter(Boolean).join(", ")],
  ].filter(([, v]) => v);
  for (const [k, v] of podaci) { trebaMjesta(14); pisi(k, L + 3, y, { size: 9, boja: tamna }); const redovi = omotaj(v, SIRINA - 175); redovi.forEach((r, i) => { pisi(r, L + 170, y - i * 12, { bold: true }); }); y -= 12 * redovi.length + 2; }

  // --- Stavke
  naslovOdjeljka("Positionen");
  const kolo = { poz: L + 3, ime: L + 24, kol: 345, jed: 352, cijena: 455, iznos: R - 3 };
  pisi("Pos.", kolo.poz, y, { bold: true, size: 8 }); pisi("Bezeichnung", kolo.ime, y, { bold: true, size: 8 }); desno("Menge", kolo.kol, y, { bold: true, size: 8 });
  pisi("Einheit", kolo.jed, y, { bold: true, size: 8 }); desno("Einzelpreis", kolo.cijena, y, { bold: true, size: 8 }); desno("Betrag", kolo.iznos, y, { bold: true, size: 8 });
  y -= 4; crta(y); y -= 12;
  for (const l of linije) {
    const imeRedovi = omotaj(l.naziv, kolo.kol - kolo.ime - 60, { bold: true });
    const opisRedovi = l.opis ? omotaj(l.opis, kolo.kol - kolo.ime - 60, { size: 8 }) : [];
    trebaMjesta(14 + (imeRedovi.length + opisRedovi.length) * 11);
    pisi(l.id, kolo.poz, y); desno(kolicinaDe(l.kolicina), kolo.kol, y); pisi(JEDINICE[l.jedinica] || l.jedinica, kolo.jed, y);
    desno(iznosDe(l.cijena), kolo.cijena, y); desno(iznosDe(l.iznos), kolo.iznos, y, { bold: true });
    imeRedovi.forEach((r) => { pisi(r, kolo.ime, y, { bold: true }); y -= 11; });
    opisRedovi.forEach((r) => { pisi(r, kolo.ime, y, { size: 8, boja: tamna }); y -= 10; });
    y -= 3;
  }
  crta(y + 2);
  y -= 6;

  // --- Zbrojevi
  trebaMjesta(110);
  const red = (k, v, o = {}) => { pisi(k, 330, y, o); desno(v, R - 3, y, o); y -= o.size ? o.size + 5 : 14; };
  const iznosIz = (v) => iznosDe(Number(tekst(v) || 0));
  red("Summe der Positionen", iznosIz(ukupno.LineExtensionAmount));
  red(`Steuerbemessungsgrundlage (${tekst(porez.TaxCategory?.ID) || "-"}, ${tekst(porez.TaxCategory?.Percent) || "0"} %)`, iznosIz(porez.TaxableAmount));
  red("Umsatzsteuer", iznosIz(Array.isArray(inv.TaxTotal) ? inv.TaxTotal[0]?.TaxAmount : inv.TaxTotal?.TaxAmount));
  red("Gesamtbetrag (brutto)", iznosIz(ukupno.TaxInclusiveAmount), { bold: true });
  if (Number(tekst(ukupno.PrepaidAmount) || 0) > 0) red("abzüglich Vorauszahlung / bereits gezahlt", `- ${iznosIz(ukupno.PrepaidAmount)}`);
  crta(y + 8, 1.2); y -= 4;
  red("Zahlbetrag", iznosIz(ukupno.PayableAmount), { bold: true, size: 12 });
  crta(y + 6, 1.2);
  y -= 6;
  const razlogPoreza = tekst(porez.TaxCategory?.TaxExemptionReason);
  if (razlogPoreza) blok(`Steuerbefreiung: ${razlogPoreza}`, L + 3, SIRINA - 6, { size: 8.5 });

  // --- Zahlung
  naslovOdjeljka("Zahlung");
  const racun = placanje.PayeeFinancialAccount || {};
  for (const [k, v] of [["IBAN", tekst(racun.ID)], ["BIC", tekst(racun.FinancialInstitutionBranch?.ID)], ["Verwendungszweck", tekst(placanje.PaymentID)], ["Zahlungsbedingungen", tekst(inv.PaymentTerms?.Note)]].filter(([, v]) => v)) {
    trebaMjesta(14); pisi(k, L + 3, y, { boja: tamna }); pisi(v, L + 170, y, { bold: true }); y -= 13;
  }

  // --- Vorangegangene Rechnungen i napomena
  if (raniji.length) {
    naslovOdjeljka("Vorangegangene Rechnungen (Bezug)");
    for (const r of raniji) { trebaMjesta(13); pisi(`Rechnung Nr. ${r.broj}${r.datum ? ` vom ${datumDe(r.datum)}` : ""}`, L + 3, y); y -= 13; }
  }
  const napomene = niz(inv.Note).map(tekst).filter(Boolean);
  if (napomene.length) { naslovOdjeljka("Bemerkung"); for (const n of napomene) blok(n, L + 3, SIRINA - 6); }
  if (prilozi.length) {
    naslovOdjeljka("Anlagen (in der XML-Datei enthalten; im Anschluss abgebildet)");
    for (const p of prilozi) blok(`${p.naziv}${p.opis ? ` — ${p.opis}` : ""}`, L + 3, SIRINA - 6);
  }

  // Priloženi PDF-ovi (npr. Zahlungsspezifikation s tablicom kumulativa) dodaju se kao sljedeće stranice, da se vidi sve što primatelj dobiva.
  for (const r of niz(inv.AdditionalDocumentReference)) {
    const objekt = r.Attachment?.EmbeddedDocumentBinaryObject;
    if (!objekt || !/pdf/i.test(objekt["@_mimeCode"] || "")) continue;
    try {
      const prilog = await PDFDocument.load(Buffer.from(tekst(objekt).replace(/\s+/g, ""), "base64"));
      (await pdf.copyPages(prilog, prilog.getPageIndices())).forEach((p) => pdf.addPage(p));
    } catch { /* neispravan prilog se u prikazu preskače; XML ostaje mjerodavan */ }
  }
  return pdf.save();
}

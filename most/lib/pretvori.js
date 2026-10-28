// Konplast XML (hrvatski UBL, Fiskalizacija 2.0)  ->  XRechnung 3.0 (UBL 2.1)  [+ tablica kumulativa kao PDF prilog].
// Ništa ne dira na disku: prima tekst XML-a i postavke, vraća XML, PDF i sažetak. Datotekama se bavi most.js.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { izracunaj, r2 } from "./kumulativ.js";

export class Greska extends Error {}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, parseTagValue: false, trimValues: true });
const niz = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const tekst = (v) => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));
const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const bez = (n) => n.toFixed(2);
const iznosDe = (n) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const datumDe = (iso) => iso.split("-").reverse().join(".");
const cijenaTekst = (n) => Number(n).toFixed(4).replace(/0{1,2}$/, "");
const kolicinaTekst = (n) => String(Number(n));

const EU = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"]);
// Konplast za komplet ("KPL") šalje NMP (= broj pari); UN/ECE oznaka za komad je C62, za paušal LS.
const JEDINICE = { NMP: "C62", KPL: "C62" };

// ---------- 1. Čitanje Konplastovog XML-a ----------
export function procitajKonplast(xmlTekst) {
  const cist = String(xmlTekst).replace(/^﻿/, "");
  if (XMLValidator.validate(cist) !== true) throw new Greska("XML nije ispravno oblikovan.");
  const inv = parser.parse(cist).Invoice;
  if (!inv) throw new Greska("Datoteka nije račun (UBL Invoice).");

  const prod = inv.AccountingSupplierParty?.Party || {};
  const kup = inv.AccountingCustomerParty?.Party || {};
  const placanje = niz(inv.PaymentMeans).find((p) => p.PayeeFinancialAccount) || {};
  const prilog = niz(inv.AdditionalDocumentReference).find((r) => r.Attachment?.EmbeddedDocumentBinaryObject);
  const objekt = prilog?.Attachment?.EmbeddedDocumentBinaryObject;

  const kupacAdresa = kup.PostalAddress || {};
  let posta = tekst(kupacAdresa.PostalZone), grad = tekst(kupacAdresa.CityName);
  const spojeno = grad.match(/^\s*(\d{3,6})\s+([^,]+)/);       // Konplast zna upisati "83043 Bad Aibling, Deutschland" u naziv grada
  if (spojeno) { if (!posta) posta = spojeno[1]; grad = spojeno[2].trim(); }

  const linije = niz(inv.InvoiceLine).map((l, i) => ({
    id: tekst(l.ID) || String(i + 1),
    kolicina: Number(tekst(l.InvoicedQuantity)),
    jedinica: l.InvoicedQuantity?.["@_unitCode"] || "C62",
    iznos: r2(Number(tekst(l.LineExtensionAmount))),
    naziv: tekst(l.Item?.Name),
    opis: tekst(l.Item?.Description),
    cijena: Number(tekst(l.Price?.PriceAmount)),
    osnovnaKolicina: Number(tekst(l.Price?.BaseQuantity) || 1),
    porez: tekst(l.Item?.ClassifiedTaxCategory?.ID),
    postotak: Number(tekst(l.Item?.ClassifiedTaxCategory?.Percent) || 0),
    imaPopust: l.AllowanceCharge != null,
  }));

  return {
    broj: tekst(inv.ID), datum: tekst(inv.IssueDate), vrijeme: tekst(inv.IssueTime), dospijece: tekst(inv.DueDate),
    tip: tekst(inv.InvoiceTypeCode) || "380", napomena: tekst(inv.Note), valuta: tekst(inv.DocumentCurrencyCode) || "EUR",
    isporuka: tekst(inv.Delivery?.ActualDeliveryDate),
    imaPopustNaRacunu: inv.AllowanceCharge != null,
    unaprijedPlaceno: tekst(inv.LegalMonetaryTotal?.PrepaidAmount) ? r2(Number(tekst(inv.LegalMonetaryTotal.PrepaidAmount))) : 0,
    zaPlatitiKonplast: tekst(inv.LegalMonetaryTotal?.PayableAmount) ? r2(Number(tekst(inv.LegalMonetaryTotal.PayableAmount))) : null,
    prodavatelj: {
      naziv: tekst(prod.PartyName?.Name), ulica: tekst(prod.PostalAddress?.StreetName), grad: tekst(prod.PostalAddress?.CityName),
      posta: tekst(prod.PostalAddress?.PostalZone), drzava: tekst(prod.PostalAddress?.Country?.IdentificationCode) || "HR",
      pdvId: tekst(prod.PartyTaxScheme?.CompanyID), oib: tekst(prod.PartyLegalEntity?.CompanyID), email: tekst(prod.Contact?.ElectronicMail),
      kontakt: tekst(inv.AccountingSupplierParty?.SellerContact?.Name) || tekst(prod.Contact?.Name),
    },
    kupac: {
      naziv: tekst(kup.PartyName?.Name), ulica: tekst(kupacAdresa.StreetName), grad, posta,
      drzava: tekst(kupacAdresa.Country?.IdentificationCode),
      pdvKandidati: [tekst(kup.PartyLegalEntity?.CompanyID), tekst(kup.PartyTaxScheme?.CompanyID)].filter(Boolean),
    },
    iban: tekst(placanje.PayeeFinancialAccount?.ID),
    linije,
    pdfPrilog: objekt ? { bazaPodataka: tekst(objekt).replace(/\s+/g, ""), mime: objekt["@_mimeCode"] || "application/pdf", naziv: objekt["@_filename"] || "racun.pdf" } : null,
  };
}

// PDV broj kupca: Konplast zna dodati "HR" ispred stranog broja ("HRDE814925276"). Uzima se prvi kandidat koji
// počinje oznakom države kupca (za Grčku "EL").
function pdvKupca(kupac) {
  const drzava = kupac.drzava === "GR" ? "EL" : kupac.drzava;
  for (const k of kupac.pdvKandidati) {
    for (const c of [k, k.replace(/^HR(?=[A-Z]{2})/, "")]) if (new RegExp(`^${drzava}[0-9A-Z]{2,12}$`).test(c)) return c;
  }
  return "";
}

// ---------- 2. PDF "Zahlungsspezifikation" ----------
async function napraviPdf({ k, cfg, racun, razdoblje, projektBr }) {
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const s = pdf.addPage([595, 842]);
  const L = 45, R = 550, crna = rgb(0, 0, 0), siva = rgb(0.93, 0.93, 0.93);
  let y = 790;
  const tk = (t, xx, yy, o = {}) => s.drawText(String(t), { x: xx, y: yy, size: o.size ?? 9, font: o.bold ? fb : f, color: crna });
  const desno = (t, xr, yy, o = {}) => { const w = (o.bold ? fb : f).widthOfTextAtSize(String(t), o.size ?? 9); tk(t, xr - w, yy, o); };
  const crta = (yy, x1 = L, x2 = R, d = 0.6) => s.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: d, color: crna });
  const zaglavlje = (naslov, yy) => { s.drawRectangle({ x: L, y: yy - 4, width: R - L, height: 15, color: siva }); tk(naslov, L + 3, yy, { bold: true }); };

  tk("ZAHLUNGSSPEZIFIKATION", L, y, { size: 15, bold: true });
  y -= 17;
  tk(`Anlage zur Rechnung Nr. ${racun.broj} vom ${datumDe(racun.datum)}  (${cfg.projekt || ""})`, L, y);
  y -= 12;
  tk(`${racun.napomena.split("\n")[0].replace(/^BV:\s*/, "BV: ")}   |   Projekt-Nr.: ${projektBr}`, L, y, { size: 8 });
  y -= 22;

  const cK = 345, cV = 445, cI = R - 4;
  zaglavlje("Gesamtauftrag und anerkannte Leistung (kumuliert)", y);
  desno("Leistung", cK, y, { bold: true }); desno("Vorauszahlung", cV, y, { bold: true }); desno("Betrag", cI, y, { bold: true });
  y -= 17;
  tk("Gesamtauftrag (brutto)", L + 3, y); desno(iznosDe(k.G), cK, y);
  y -= 15;
  tk(`${Math.round((k.V / k.G) * 100)}% Materialvorauszahlung Gesamtauftrag`, L + 3, y); desno(iznosDe(k.V), cI, y);
  y -= 15;
  tk("1 kpl  Metallbau", L + 3, y); desno(iznosDe(k.kumulativ), cK, y); desno(iznosDe(k.avansUkupno), cV, y); desno(iznosDe(k.neto), cI, y);
  y -= 4; crta(y); y -= 13;
  tk("A: Anerkannte Leistung", cV - 120, y, { bold: true }); desno(iznosDe(k.A), cI, y, { bold: true });
  y -= 24;

  zaglavlje("Geleistete Zahlungen", y);
  y -= 17;
  const grupa = (naslov, vrsta) => {
    const redovi = cfg.racuni.filter((q) => q.vrsta === vrsta);
    if (!redovi.length) return;
    tk(naslov, L + 3, y, { bold: true }); y -= 14;
    for (const r of redovi) {
      tk(r.oznaka, L + 12, y); tk(`Nr. ${r.broj} vom ${datumDe(r.datum)}`, L + 40, y); desno(iznosDe(r.iznos), cI, y);
      y -= 14;
    }
    y -= 2;
  };
  grupa("A-Konto Rechnungen:", "aconto");
  grupa("Rechnungen:", "racun");
  crta(y); y -= 13;
  tk("B: Geleistete Zahlungen", cV - 120, y, { bold: true }); desno(iznosDe(k.B), cI, y, { bold: true });
  y -= 6; crta(y, L, R, 1.2); y -= 17;
  tk("Rest zu Zahlen (A-B):", cV - 120, y, { bold: true, size: 11 }); desno(iznosDe(k.rest), cI, y, { bold: true, size: 11 });
  y -= 6; crta(y, L, R, 1.2);
  y -= 36;

  zaglavlje(`Diese Rechnung Nr. ${racun.broj} (Zusammenfassung)`, y);
  y -= 17;
  const aconto = cfg.racuni.find((q) => q.vrsta === "aconto");
  tk("Leistung dieses Abrechnungszeitraums", L + 3, y); desno(iznosDe(razdoblje), cI, y); y -= 14;
  tk(`Anrechnung Vorauszahlung (anteilig${aconto ? `, A-Konto Nr. ${aconto.broj}` : ""})`, L + 3, y); desno(`- ${iznosDe(k.avansOvajRacun)}`, cI, y); y -= 5;
  crta(y); y -= 13;
  tk("Zahlbetrag dieser Rechnung", L + 3, y, { bold: true }); desno(iznosDe(k.zaPlatiti), cI, y, { bold: true });
  y -= 30;
  tk("Die Vorauszahlung wird anteilig nach Leistungsfortschritt verrechnet:", L, y, { size: 8 }); y -= 11;
  tk(`Vorauszahlung x kumulierte Leistung / Gesamtauftrag (max. ${iznosDe(k.V)}).`, L, y, { size: 8 });
  return pdf.save();
}

// ---------- 3. Izrada XRechnunga ----------
// ctx: { prodavatelj: {telefon, bic}, eAdresa, referenca, sifra, kumulativ: cfg|null }
// Vraća { xml, pdfBytes, pdfNaziv, sazetak, kontrole, poruke }.
export async function izradi(racun, ctx) {
  const poruke = [], kontrole = [];
  const ok = (uvjet, opis) => kontrole.push({ ok: !!uvjet, opis });

  if (!racun.linije.length) throw new Greska("Račun nema nijednu stavku.");
  if (racun.imaPopustNaRacunu || racun.linije.some((l) => l.imaPopust)) throw new Greska("Popusti/rabati na računu još nisu podržani.");
  if (racun.valuta !== "EUR") throw new Greska(`Valuta ${racun.valuta} nije podržana (samo EUR).`);
  if (!["380", "384"].includes(racun.tip)) throw new Greska(`Vrsta dokumenta ${racun.tip} nije podržana (samo račun 380).`);
  if (!racun.kupac.drzava || racun.kupac.drzava === "HR") throw new Greska("Kupac je u Hrvatskoj — domaće račune šalje Konplast (eRačun), ne XRechnung.");
  if (!EU.has(racun.kupac.drzava)) throw new Greska(`Kupac je izvan EU (${racun.kupac.drzava}) — ovaj alat podržava samo isporuke u EU.`);
  if (racun.linije.some((l) => !["E", "K"].includes(l.porez) || l.postotak !== 0)) throw new Greska("Račun ima obračunat PDV — podržane su samo isporuke u EU bez PDV-a.");
  const pdvKupac = pdvKupca(racun.kupac);
  if (!pdvKupac) throw new Greska("U XML-u nije pronađen PDV broj kupca (potreban za isporuku u EU).");
  if (!racun.prodavatelj.pdvId) throw new Greska("U XML-u nije pronađen PDV broj prodavatelja.");
  if (!ctx.eAdresa) throw new Greska("Nije upisana e-adresa kupca za račune.");
  for (const l of racun.linije) if (!Number.isFinite(l.kolicina) || !Number.isFinite(l.cijena)) throw new Greska(`Stavka ${l.id}: količina ili cijena nisu brojevi.`);

  const razdoblje = r2(racun.linije.reduce((s, l) => s + l.iznos, 0));
  const projektBr = (racun.napomena.match(/Projekt-Nr\.:\s*(\S+)/) || [])[1] || ctx.sifra;
  const referenca = ctx.referenca || projektBr;
  const abschlag = !!ctx.kumulativ;
  let k = null, cfg = null, pdfBytes = null, pdfNaziv = "", napomena = racun.napomena;

  for (const l of racun.linije) {
    if (Math.abs(r2((l.kolicina * l.cijena) / l.osnovnaKolicina) - l.iznos) > 0.011) poruke.push(`Stavka ${l.id}: količina × cijena (${iznosDe(r2((l.kolicina * l.cijena) / l.osnovnaKolicina))}) ne odgovara iznosu stavke (${iznosDe(l.iznos)}).`);
  }

  if (abschlag) {
    cfg = ctx.kumulativ;
    k = izracunaj(cfg, razdoblje);
    pdfBytes = await napraviPdf({ k, cfg, racun, razdoblje, projektBr });
    pdfNaziv = `Zahlungsspezifikation_${racun.broj.replace(/\//g, "-")}.pdf`;
    const aconto = cfg.racuni.find((q) => q.vrsta === "aconto");
    napomena = [
      racun.napomena.split("\n").map((s) => s.trim()).filter(Boolean).join("; "),
      `${cfg.racuni.filter((q) => q.vrsta === "racun").length + 1}. Abschlagsrechnung`,
      `Leistungsstand kumuliert: ${iznosDe(k.kumulativ)}; bisher abgerechnet: ${iznosDe(k.prethodniKum)}`,
      `Anrechnung der Vorauszahlung${aconto ? ` (A-Konto-Rechnung Nr. ${aconto.broj} vom ${datumDe(aconto.datum)})` : ""} anteilig: ${iznosDe(k.avansOvajRacun)}`,
      "Details siehe Anlage Zahlungsspezifikation.",
    ].join("\n");
  } else if (racun.pdfPrilog) {
    pdfBytes = Buffer.from(racun.pdfPrilog.bazaPodataka, "base64");
    pdfNaziv = racun.pdfPrilog.naziv;
  }
  const prepaid = abschlag ? k.avansOvajRacun : racun.unaprijedPlaceno;
  const zaPlatiti = r2(razdoblje - prepaid);
  if (!abschlag && racun.zaPlatitiKonplast != null && Math.abs(racun.zaPlatitiKonplast - zaPlatiti) > 0.005) poruke.push(`Iznos za platiti (${iznosDe(zaPlatiti)}) razlikuje se od Konplastovog (${iznosDe(racun.zaPlatitiKonplast)}).`);

  const kup = racun.kupac, pr = racun.prodavatelj;
  // Adresa isporuke (BG-15) mora imati grad i poštanski broj (BR-DE-10/11). Ako nije poznata (kumulativ.json → isporuka), uzima se adresa kupca.
  const isp = ctx.kumulativ?.isporuka?.grad && ctx.kumulativ?.isporuka?.posta ? ctx.kumulativ.isporuka : { ulica: kup.ulica, grad: kup.grad, posta: kup.posta, drzava: kup.drzava };
  if (isp.grad === kup.grad && isp.posta === kup.posta && isp.ulica === kup.ulica) poruke.push("Adresa isporuke nije poznata — uzeta je adresa kupca (može se zadati u kumulativ.json → isporuka).");
  const refs = abschlag ? cfg.racuni.map((r) => `\n  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${x(r.broj)}</cbc:ID><cbc:IssueDate>${r.datum}</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>`).join("") : "";
  const prilogXml = pdfBytes ? `
  <cac:AdditionalDocumentReference>
    <cbc:ID>${abschlag ? "Zahlungsspezifikation" : "Rechnung"}</cbc:ID>
    <cbc:DocumentDescription>${x(abschlag ? `Zahlungsspezifikation (kumulierte Abrechnung) zur Rechnung ${racun.broj}` : `Rechnung ${racun.broj} (PDF)`)}</cbc:DocumentDescription>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="${x(abschlag ? "application/pdf" : racun.pdfPrilog.mime)}" filename="${x(pdfNaziv)}">${Buffer.from(pdfBytes).toString("base64")}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>` : "";
  const linijeXml = racun.linije.map((l, i) => `
  <cac:InvoiceLine>
    <cbc:ID>${x(l.id || i + 1)}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${abschlag ? "LS" : x(JEDINICE[l.jedinica] || l.jedinica)}">${kolicinaTekst(l.kolicina)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${bez(l.iznos)}</cbc:LineExtensionAmount>
    <cac:Item>${abschlag ? `
      <cbc:Description>${x(`Leistung dieses Abrechnungszeitraums; Leistungsstand kumuliert ${iznosDe(k.kumulativ)} (siehe Anlage Zahlungsspezifikation)`)}</cbc:Description>` : (l.opis ? `
      <cbc:Description>${x(l.opis)}</cbc:Description>` : "")}
      <cbc:Name>${x(l.naziv || `Position ${l.id}`)}</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>K</cbc:ID><cbc:Percent>0</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${cijenaTekst(l.cijena)}</cbc:PriceAmount>${l.osnovnaKolicina !== 1 ? `<cbc:BaseQuantity unitCode="${abschlag ? "LS" : x(JEDINICE[l.jedinica] || l.jedinica)}">${kolicinaTekst(l.osnovnaKolicina)}</cbc:BaseQuantity>` : ""}</cac:Price>
  </cac:InvoiceLine>`).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${x(racun.broj)}</cbc:ID>
  <cbc:IssueDate>${racun.datum}</cbc:IssueDate>${racun.dospijece ? `
  <cbc:DueDate>${racun.dospijece}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>${racun.tip}</cbc:InvoiceTypeCode>${napomena ? `
  <cbc:Note>${x(napomena)}</cbc:Note>` : ""}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${x(referenca)}</cbc:BuyerReference>${refs}${prilogXml}
  <cac:ProjectReference><cbc:ID>${x(projektBr)}</cbc:ID></cac:ProjectReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cbc:EndpointID schemeID="EM">${x(pr.email)}</cbc:EndpointID>
    <cac:PartyName><cbc:Name>${x(pr.naziv)}</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>${x(pr.ulica)}</cbc:StreetName><cbc:CityName>${x(pr.grad)}</cbc:CityName><cbc:PostalZone>${x(pr.posta)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${x(pr.drzava)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>${x(pr.pdvId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${x(pr.naziv)}</cbc:RegistrationName>${pr.oib ? `<cbc:CompanyID>${x(pr.oib)}</cbc:CompanyID>` : ""}</cac:PartyLegalEntity>
    <cac:Contact><cbc:Name>${x(pr.kontakt || pr.naziv)}</cbc:Name><cbc:Telephone>${x(ctx.prodavatelj.telefon)}</cbc:Telephone><cbc:ElectronicMail>${x(pr.email)}</cbc:ElectronicMail></cac:Contact>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cbc:EndpointID schemeID="EM">${x(ctx.eAdresa)}</cbc:EndpointID>
    <cac:PartyName><cbc:Name>${x(kup.naziv)}</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>${x(kup.ulica)}</cbc:StreetName><cbc:CityName>${x(kup.grad)}</cbc:CityName><cbc:PostalZone>${x(kup.posta)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${x(kup.drzava)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>${x(pdvKupac)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${x(kup.naziv)}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:Delivery>
    <cbc:ActualDeliveryDate>${racun.isporuka || racun.datum}</cbc:ActualDeliveryDate>
    <cac:DeliveryLocation><cac:Address>${isp?.ulica ? `<cbc:StreetName>${x(isp.ulica)}</cbc:StreetName>` : ""}${isp?.grad ? `<cbc:CityName>${x(isp.grad)}</cbc:CityName>` : ""}${isp?.posta ? `<cbc:PostalZone>${x(isp.posta)}</cbc:PostalZone>` : ""}<cac:Country><cbc:IdentificationCode>${x(isp?.drzava || kup.drzava)}</cbc:IdentificationCode></cac:Country></cac:Address></cac:DeliveryLocation>
  </cac:Delivery>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cbc:PaymentID>${x(racun.broj)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount><cbc:ID>${x(racun.iban)}</cbc:ID><cbc:Name>${x(pr.naziv)}</cbc:Name>${ctx.prodavatelj.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${x(ctx.prodavatelj.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ""}</cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:PaymentTerms><cbc:Note>${x(racun.dospijece ? `Zahlungsziel: ${datumDe(racun.dospijece)}, ohne Abzug.` : "Zahlbar ohne Abzug.")}</cbc:Note></cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${bez(razdoblje)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>K</cbc:ID><cbc:Percent>0</cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-EU-IC</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Steuerfreie innergemeinschaftliche Lieferung</cbc:TaxExemptionReason><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${bez(razdoblje)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${bez(razdoblje)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${bez(razdoblje)}</cbc:TaxInclusiveAmount>${prepaid > 0 ? `
    <cbc:PrepaidAmount currencyID="EUR">${bez(prepaid)}</cbc:PrepaidAmount>` : ""}
    <cbc:PayableAmount currencyID="EUR">${bez(zaPlatiti)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${linijeXml}
</Invoice>
`;

  ok(XMLValidator.validate(xml) === true, "XML je ispravno oblikovan");
  ok(r2(zaPlatiti + prepaid) === razdoblje, "Iznos za platiti = zbroj stavki − već plaćeno (BR-CO-16)");
  ok(!abschlag || r2(k.A - k.B) === zaPlatiti, "Tablica kumulativa: A − B jednako je iznosu za platiti u XML-u");
  ok(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctx.eAdresa), "E-adresa kupca ima ispravan oblik");
  ok(!!pdvKupac && !!racun.prodavatelj.pdvId, "PDV brojevi prodavatelja i kupca postoje (isporuka u EU)");
  ok(!!pdfBytes, abschlag ? "Tablica kumulativa je priložena (PDF)" : "PDF računa je priložen");

  const sazetak = {
    racun: racun.broj, datum: racun.datum, kupac: kup.naziv, nacin: abschlag ? "Abschlag (s kumulativom)" : "Običan račun",
    razdoblje, zaPlatiti, ...(abschlag ? { kumulativ: k.kumulativ, avans: k.avansOvajRacun, prijasnjihRacuna: cfg.racuni.length } : {}),
  };
  return { xml, pdfBytes, pdfNaziv, sazetak, kontrole, poruke, kumulativRacun: abschlag ? { broj: racun.broj, datum: racun.datum, iznos: zaPlatiti, kumulativ: k.kumulativ } : null };
}

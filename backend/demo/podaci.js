// Izmišljeni podaci za DEMO instalaciju (DEMO_MODE=1). Generiraju se pri svakom noćnom resetu,
// s datumima izračunatima od "danas", tako da demo uvijek izgleda kao tvrtka usred posla
// (projekti s rokovima u idućim tjednima, evidencija rada za zadnje dane…).
// Nijedan podatak ne pripada stvarnoj osobi ili tvrtki.
// Šifre materijala i popis kvaliteta čitaju se iz frontend/src/App.jsx (isti izvor istine kao
// migracije u backend/), da demo koristi točno ista pravila kao aplikacija.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DEMO_ZAPOSLENIK_ID = "zap-demo";
const DEMO_LOZINKA = "Demo2026!";
const DEMO_POZICIJA_ID = "poz-administrator";

function izAplikacije() {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "App.jsx"), "utf8");
  const izmedju = (a, b) => {
    const i = src.indexOf(a), j = src.indexOf(b, i);
    if (i < 0 || j < 0) throw new Error(`ne mogu pronaći "${a}" u App.jsx`);
    return src.slice(i, j);
  };
  const linija = (pocetak) => { const i = src.indexOf(pocetak); if (i < 0) throw new Error("nema " + pocetak); return src.slice(i, src.indexOf("\n", i)); };
  const kod = `${izmedju("const GRUPE_KVALITETE", "const faktorGustoce")}
${linija("const sifraIzKataloga")}
${linija("const katalogOznakaPuna")}
${izmedju("// <<SKLADISTE-SIFRE", "// SKLADISTE-SIFRE>>")}
return { ZADANE_KVALITETE_MATERIJALA, sifraMaterijala };`;
  return new Function(kod)();
}

// ---------- datumi (Europe/Zagreb) ----------
const zagrebDatum = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const dodajDane = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const danUTjednu = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const jeRadniDan = (iso) => ![0, 6].includes(danUTjednu(iso));
// Lokalno vrijeme u Zagrebu -> ISO (UTC), isti oblik koji sprema kiosk.
function zagrebISO(datum, hh, mm) {
  const kaoUtc = new Date(`${datum}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  const lokalno = new Date(kaoUtc.toLocaleString("en-US", { timeZone: "Europe/Zagreb" }));
  const utc = new Date(kaoUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(kaoUtc.getTime() - (lokalno - utc)).toISOString();
}
// Deterministički "slučajni" brojevi — isti dan daje iste podatke.
function generatorBrojeva(sjeme) {
  let s = sjeme >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function demoPodaci(sada = new Date()) {
  const { ZADANE_KVALITETE_MATERIJALA, sifraMaterijala } = izAplikacije();
  const danas = zagrebDatum(sada);
  const godina = danas.slice(0, 4);
  const yy = godina.slice(2);
  const rnd = generatorBrojeva(Number(danas.replace(/-/g, "")));
  const d = (n) => dodajDane(danas, n);

  // ---------- tvrtka ----------
  const postavkeTvrtke = {
    naziv: "Demo d.o.o.", djelatnost: "Projektiranje, izrada i montaža čeličnih konstrukcija",
    adresa: "Industrijska ulica 1, 10000 Zagreb", telefon: "+385 1 000 0000", faks: "", email: "info@demo.example", web: "demo.example",
    oib: "00000000001", mb: "00000001", vatId: "HR00000000001", ziroRacun: "0000000-0000000001", iban: "HR0000000000000000001", swift: "DEMOHR2X",
    sud: "Trgovačkom sudu u Zagrebu", mbs: "000000001", temeljniKapital: "2.500,00 €", uprava: "Ivan Horvat", pdvStopa: 25,
    cmrStatistickiBroj: "73089098", cmrUvjetIsporuke: "DAP", abZadnjiBroj: "",
  };

  // ---------- pozicije i zaposlenici ----------
  const SVI_MODULI = ["dashboard", "ponude", "projekti", "proizvodnja", "nabava", "skladiste", "kontrola", "otpremnice", "fakturiranje", "partneri", "zaposlenici"];
  const pozicijeZaposlenika = [
    { id: DEMO_POZICIJA_ID, naziv: "Administrator", opis: "Puni pristup svim modulima", moduli: SVI_MODULI, karticeDozvole: {} },
    { id: "poz-direktor", naziv: "Direktor", opis: "Uprava", moduli: SVI_MODULI, karticeDozvole: {} },
    { id: "poz-tehnicki", naziv: "Tehnički ured", opis: "Ponude, projekti i nabava", moduli: ["dashboard", "ponude", "projekti", "nabava", "skladiste", "kontrola", "otpremnice"], karticeDozvole: {} },
    { id: "poz-voditelj", naziv: "Voditelj proizvodnje", opis: "Radni nalozi i plan proizvodnje", moduli: ["dashboard", "proizvodnja", "skladiste", "kontrola"], karticeDozvole: {} },
    { id: "poz-skladistar", naziv: "Skladištar", opis: "Zalihe, zaprimanje i izdavanje", moduli: ["dashboard", "skladiste", "nabava"], karticeDozvole: {} },
    { id: "poz-laser", naziv: "Operater na laseru", opis: "Plan rezanja", moduli: ["proizvodnja"], karticeDozvole: {} },
    { id: "poz-zaposlenik", naziv: "Zaposlenik", opis: "Radionica", moduli: ["dashboard"], karticeDozvole: {} },
    { id: "poz-kooperant", naziv: "Kooperant", opis: "Vanjski izvođači po satu", moduli: ["dashboard"], karticeDozvole: {} },
  ];
  const zap = (id, ime, prezime, pozicijaId, rfidKod, dodatno = {}) => ({
    id, ime, prezime, pozicijaId, email: `${ime}.${prezime}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d") + "@demo.example",
    telefon: `+385 91 000 ${String(100 + Math.floor(rnd() * 899))}`, status: "Aktivan", datumZaposlenja: `${Number(godina) - 1 - Math.floor(rnd() * 8)}-0${1 + Math.floor(rnd() * 8)}-01`,
    kompetencije: [], rfidKod, bodovi: 0, udaljenostKm: Math.round(5 + rnd() * 25), koristiPrehranuUTvrtki: false, satnicaKooperant: 0, fiksniMjesecniIznos: 0,
    naknadaPrijevoz: 0, maticniBroj: "", dodatniStazGodine: 0, radnoVrijeme: "puno", ...dodatno,
  });
  const zaposlenici = [
    { ...zap(DEMO_ZAPOSLENIK_ID, "Korisnik", "Demo", DEMO_POZICIJA_ID, "DEMO01"), email: "demo@demo.example", lozinkaHash: bcrypt.hashSync(DEMO_LOZINKA, 10) },
    zap("zap-d1", "Ivan", "Horvat", "poz-direktor", "IHOR01"),
    zap("zap-d2", "Ana", "Babić", "poz-tehnicki", "ABAB01"),
    zap("zap-d3", "Petra", "Novak", "poz-tehnicki", "PNOV01"),
    zap("zap-d4", "Marko", "Kovačević", "poz-voditelj", "MKOV01", { bodovi: 1400, kompetencije: ["Zavarivanje MAG", "Čitanje nacrta"] }),
    zap("zap-d5", "Josip", "Marić", "poz-skladistar", "JMAR01", { bodovi: 1050 }),
    zap("zap-d6", "Luka", "Jurić", "poz-laser", "LJUR01", { bodovi: 1150, kompetencije: ["Laser za limove", "Laser za profile"] }),
    zap("zap-d7", "Tomislav", "Knežević", "poz-zaposlenik", "TKNE01", { bodovi: 1200, kompetencije: ["Zavarivanje MAG", "Zavarivanje TIG"] }),
    zap("zap-d8", "Stjepan", "Vuković", "poz-zaposlenik", "SVUK01", { bodovi: 1100, kompetencije: ["Bravarski radovi"] }),
    zap("zap-d9", "Nikola", "Pavlović", "poz-zaposlenik", "NPAV01", { bodovi: 1000, kompetencije: ["Brušenje", "Bojanje"] }),
    zap("zap-d10", "Dario", "Božić", "poz-kooperant", "DBOZ01", { satnicaKooperant: 14 }),
  ];
  const radiona = ["zap-d4", "zap-d5", "zap-d6", "zap-d7", "zap-d8", "zap-d9", "zap-d10"];

  // ---------- partneri ----------
  const kupci = [
    { id: "kup-d1", naziv: "Gradnja Primjer d.o.o.", oib: "00000000011", kontaktOsoba: "Maja Perić", telefon: "+385 1 111 0001", email: "nabava@gradnja-primjer.example", adresa: "Savska 10, 10000 Zagreb" },
    { id: "kup-d2", naziv: "Musterbau GmbH", oib: "", kontaktOsoba: "Thomas Muster", telefon: "+49 89 000 0002", email: "einkauf@musterbau.example", adresa: "Musterstraße 1, 80331 München, Deutschland" },
    { id: "kup-d3", naziv: "Hale Sjever d.o.o.", oib: "00000000013", kontaktOsoba: "Goran Šimić", telefon: "+385 42 000 003", email: "ured@hale-sjever.example", adresa: "Zagrebačka 5, 42000 Varaždin" },
    { id: "kup-d4", naziv: "Modul Kupaonice d.o.o.", oib: "00000000014", kontaktOsoba: "Iva Lovrić", telefon: "+385 31 000 004", email: "info@modul-kupaonice.example", adresa: "Vukovarska 20, 31000 Osijek" },
    { id: "kup-d5", naziv: "Lučki terminal Demo d.d.", oib: "00000000015", kontaktOsoba: "Ante Radić", telefon: "+385 21 000 005", email: "tehnika@terminal.example", adresa: "Obala 1, 21000 Split" },
  ];
  const dob = (id, naziv, vrsta, dodatno = {}) => ({ id, naziv, oib: "", kontaktOsoba: "", telefon: "", email: "", adresa: "", prijevoznik: false, vrsta, dodatakIznos: 0, dodatakNapomena: "", ...dodatno });
  const dobavljaci = [
    dob("dob-d1", "Čelik Trgovina d.o.o.", "Metali", { kontaktOsoba: "Krešimir Vidović", telefon: "+385 1 222 0001", email: "prodaja@celik-trgovina.example", adresa: "Slavonska avenija 50, 10000 Zagreb", dodatakIznos: 35, dodatakNapomena: "transport" }),
    dob("dob-d2", "Metal Centar d.o.o.", "Metali", { kontaktOsoba: "Sanja Kralj", telefon: "+385 47 000 002", email: "info@metal-centar.example", adresa: "Industrijska 8, 47000 Karlovac" }),
    dob("dob-d3", "Brzi Prijevoz d.o.o.", "Transport", { prijevoznik: true, kontaktOsoba: "Dejan Matić", telefon: "+385 98 000 003", email: "dispecer@brzi-prijevoz.example", adresa: "Logistička 3, 10370 Dugo Selo" }),
    dob("dob-d4", "Vijci i Alati d.o.o.", "Ostalo", { kontaktOsoba: "Mirela Tomić", telefon: "+385 1 333 0004", email: "narudzbe@vijci-alati.example", adresa: "Radnička 15, 10000 Zagreb" }),
    dob("dob-d5", "Cinčaonica Primjer d.o.o.", "Ostalo", { kontaktOsoba: "Zoran Jukić", telefon: "+385 35 000 005", email: "info@cincaonica.example", adresa: "Industrijska zona bb, 35000 Slavonski Brod" }),
  ];

  // ---------- materijal: kvalitete, katalog, skladište ----------
  const kvaliteteMaterijala = ZADANE_KVALITETE_MATERIJALA.map((k, i) => ({ ...k, kod: k.id === "celik" ? "00" : String(i).padStart(2, "0") }));
  const kat = (id, tip, oznaka, jedinica, vrijednost, broj) => ({ id, tip, oznaka, jedinica, vrijednost, broj });
  const katalogProfila = [
    kat("kat-hea160", "HEA", "HEA 160", "kg/m", 30.4, 1), kat("kat-hea200", "HEA", "HEA 200", "kg/m", 42.3, 2),
    kat("kat-heb200", "HEB", "HEB 200", "kg/m", 61.3, 3), kat("kat-ipe160", "IPE", "IPE 160", "kg/m", 15.8, 4),
    kat("kat-ipe200", "IPE", "IPE 200", "kg/m", 22.4, 5), kat("kat-upn120", "UPN", "UPN 120", "kg/m", 13.4, 6),
    kat("kat-l50", "Kutni jednakokraki", "L 50x5", "kg/m", 3.77, 7),
    kat("kat-kv80", "Kvadratna cijev", "80x80x4", "kg/m", 9.22, 1), kat("kat-kv100", "Kvadratna cijev", "100x100x5", "kg/m", 14.4, 2),
    kat("kat-pr100", "Pravokutna cijev", "100x50x4", "kg/m", 8.59, 3), kat("kat-ok60", "Okrugla cijev", "60,3x3,2", "kg/m", 4.51, 4),
    kat("kat-lim3", "Lim", "Lim 3 mm", "kg/m2", 23.55, 1), kat("kat-lim5", "Lim", "Lim 5 mm", "kg/m2", 39.25, 2),
    kat("kat-lim10", "Lim", "Lim 10 mm", "kg/m2", 78.5, 3), kat("kat-lim15", "Lim", "Lim 15 mm", "kg/m2", 117.75, 4),
    kat("kat-pl50", "Plosnato", "50x8", "kg/m", 3.14, 1),
  ];
  const katPoId = Object.fromEntries(katalogProfila.map((k) => [k.id, k]));
  const matIzKataloga = (id, katId, kvaliteta, komada, { duzinaMM = 6000, sirinaMM = 0, cijenaKg = 1.15, minZaliha = 0, lokacija = "" } = {}) => {
    const k = katPoId[katId];
    const lim = k.jedinica === "kg/m2";
    const masaKom = lim ? (duzinaMM / 1000) * (sirinaMM / 1000) * k.vrijednost : (duzinaMM / 1000) * k.vrijednost;
    return {
      id, sifra: sifraMaterijala(k, kvaliteteMaterijala, kvaliteta), naziv: `${k.tip} ${k.oznaka}`.replace(/^(\w+) \1 /, "$1 "), tip: k.tip,
      dimenzije: lim ? `${duzinaMM}×${sirinaMM} mm` : `${duzinaMM} mm`, jm: "kom", cijena: Math.round(masaKom * cijenaKg * 100) / 100,
      kolicina: komada, minZaliha, lokacija, kgPoM: lim ? 0 : k.vrijednost, kgPoM2: lim ? k.vrijednost : 0, kgPoKom: 0, projektId: null, kvaliteta, katalogId: k.id,
    };
  };
  const materijali = [
    matIzKataloga("mat-d1", "kat-hea200", "S355J2", 14, { duzinaMM: 12000, minZaliha: 4, lokacija: "Hala A / regal 1" }),
    matIzKataloga("mat-d2", "kat-hea160", "S235JR", 9, { minZaliha: 4, lokacija: "Hala A / regal 1" }),
    matIzKataloga("mat-d3", "kat-ipe200", "S235JR", 3, { duzinaMM: 12000, minZaliha: 6, lokacija: "Hala A / regal 2" }),
    matIzKataloga("mat-d4", "kat-kv80", "S235JR", 22, { minZaliha: 10, lokacija: "Hala A / regal 3" }),
    matIzKataloga("mat-d5", "kat-pr100", "S355J2", 16, { minZaliha: 8, lokacija: "Hala A / regal 3" }),
    matIzKataloga("mat-d6", "kat-ok60", "S235JR", 12, { minZaliha: 5, lokacija: "Hala A / regal 4" }),
    matIzKataloga("mat-d7", "kat-lim5", "S235JR", 8, { duzinaMM: 3000, sirinaMM: 1500, cijenaKg: 1.25, minZaliha: 4, lokacija: "Hala B / limovi" }),
    matIzKataloga("mat-d8", "kat-lim10", "S355J2", 2, { duzinaMM: 3000, sirinaMM: 1500, cijenaKg: 1.25, minZaliha: 3, lokacija: "Hala B / limovi" }),
    matIzKataloga("mat-d9", "kat-lim3", "DX51D+Z275", 15, { duzinaMM: 2000, sirinaMM: 1000, cijenaKg: 1.45, minZaliha: 5, lokacija: "Hala B / limovi" }),
    matIzKataloga("mat-d10", "kat-pl50", "S235JR", 30, { minZaliha: 10, lokacija: "Hala A / regal 5" }),
    { id: "mat-d11", sifra: "40900100", naziv: "Vijak M16x60 8.8 pocinčani", tip: "Vijčana roba", dimenzije: "M16x60", jm: "kom", cijena: 0.42, kolicina: 850, minZaliha: 300, lokacija: "Skladište sitnog materijala", kgPoM: 0, kgPoM2: 0, kgPoKom: 0, projektId: null, kvaliteta: "", katalogId: null },
    { id: "mat-d12", sifra: "90900100", naziv: "Temeljna boja RAL 7035", tip: "Boja i premazi", dimenzije: "kanta 25 l", jm: "l", cijena: 6.8, kolicina: 120, minZaliha: 50, lokacija: "Bojaona", kgPoM: 0, kgPoM2: 0, kgPoKom: 0, projektId: null, kvaliteta: "", katalogId: null },
  ];

  // ---------- cjenik, zadaci ----------
  const cjenikRada = { pila: 35, laserProfili: 120, laserLimovi: 110, kutnoSavijanje: 45, strojnaObrada: 50, pripremaPozicija: 35, sklapanjeKonstrukcije: 38, sklapanjeKupaonice: 38, zavarivanje: 42, brusenje: 32, ravnanje: 32, akz: 30 };
  const standardniZadaci = [
    { id: "stz-1", naziv: "Radionička dokumentacija" }, { id: "stz-2", naziv: "Narudžba materijala" },
    { id: "stz-3", naziv: "Lansiranje u proizvodnju" }, { id: "stz-4", naziv: "Kontrola kvalitete i atesti" },
    { id: "stz-5", naziv: "Organizacija prijevoza" },
  ];
  const zadaciProjekta = (pid, gotovo, voditeljId, pocetak) => standardniZadaci.map((t, i) => ({
    id: `zad-${pid}-${i + 1}`, naziv: t.naziv, izvrseno: i < gotovo, izvrsioId: i < gotovo ? voditeljId : null,
    datumIzvrsenja: i < gotovo ? dodajDane(pocetak, 2 + i * 4) : null, planiraniDatum: dodajDane(pocetak, 3 + i * 7), zadaoId: voditeljId,
  }));

  // ---------- ponude i projekti ----------
  const OPERACIJE_KLJUCEVI = Object.keys(cjenikRada);
  const LABEL = { pila: "Pila", laserProfili: "Laser za profile", laserLimovi: "Laser za limove", kutnoSavijanje: "Kutno savijanje", strojnaObrada: "Strojna obrada", pripremaPozicija: "Priprema pozicija za sklapanje", sklapanjeKonstrukcije: "Sklapanje - konstrukcije", sklapanjeKupaonice: "Sklapanje - kupaonice", zavarivanje: "Zavarivanje", brusenje: "Brušenje", ravnanje: "Ravnanje", akz: "Bojanje" };
  const ops = (o) => Object.fromEntries(OPERACIJE_KLJUCEVI.map((k) => [k, o[k] || 0]));
  const stavkaProfil = (id, katId, duzinaM, komada, kvaliteta = "kv-s235jr", cijenaKg = 1.15) => ({ id, nacinMase: "katalog", masaJed: 0, komada, katalogId: katId, dimenzija: duzinaM, sirinaMM: 0, duzinaMM: 0, kvaliteta, cijenaKg });
  const stavkaLim = (id, katId, sirinaMM, duzinaMM, komada, kvaliteta = "kv-s235jr", cijenaKg = 1.25) => ({ id, nacinMase: "katalog", masaJed: 0, komada, katalogId: katId, dimenzija: 0, sirinaMM, duzinaMM, kvaliteta, cijenaKg });
  const masaStavke = (s) => {
    const k = katPoId[s.katalogId];
    return k.jedinica === "kg/m2" ? k.vrijednost * (s.sirinaMM * s.duzinaMM) / 1e6 : k.vrijednost * s.dimenzija;
  };
  const poz = (id, oznaka, naziv, kolicina, stavke, operacije, dodatno = {}) => ({ id, oznaka, naziv, kolicina, stavke, operacije: ops(operacije), brojMontera: 0, planiraniSatiMontaza: 0, stavkeAKZ: [], materijalStavke: [], ostaleStavke: [], ...dodatno });
  // Isti izračun kao izracunPonude() u App.jsx, sveden na ono što demo ponude koriste.
  const izracun = (ponuda) => {
    const sati = Object.fromEntries(OPERACIJE_KLJUCEVI.map((k) => [k, 0]));
    let rad = 0, materijal = 0, akz = 0, ostalo = 0, montazaSati = 0;
    ponuda.pozicije.forEach((p) => {
      OPERACIJE_KLJUCEVI.forEach((k) => { sati[k] += p.operacije[k]; rad += p.operacije[k] * cjenikRada[k]; });
      const masa = p.stavke.reduce((s, st) => s + masaStavke(st) * st.komada, 0);
      materijal += p.stavke.reduce((s, st) => s + masaStavke(st) * st.komada * st.cijenaKg, 0) * p.kolicina;
      akz += p.stavkeAKZ.reduce((s, a) => s + masa * p.kolicina * a.cijenaKg, 0);
      ostalo += p.ostaleStavke.reduce((s, o) => s + o.kolicina * o.cijenaJed, 0);
      montazaSati += p.brojMontera * p.planiraniSatiMontaza * p.kolicina;
    });
    const ukupno = rad + materijal + akz + ostalo + montazaSati * ponuda.satnicaMontaza;
    return { sati, satiMontaze: montazaSati, cijena: ukupno * (1 + ponuda.postotakMarze / 100) };
  };
  const ponuda = (id, broj, naziv, kupacId, datum, status, pozicije, dodatno = {}) => {
    const kupac = kupci.find((k) => k.id === kupacId);
    return {
      id, broj, naziv, kupacId, kontaktOsoba: kupac.kontaktOsoba, kontaktOsobaTitula: "herr", datum, status, napomena: "", projektId: null,
      izradioId: "zap-d2", pozicije, sirovineStavke: [], satnicaMontaza: 38, otpadLimPoTipu: {}, postotakMarze: 15, napomenaNjemacki: "", ...dodatno,
    };
  };

  const ponude = [
    ponuda("pon-d1", `PON-${godina}-001`, "Čelična hala skladišta 24 x 40 m", "kup-d3", d(-75), "Prihvaćena", [
      poz("pp-d1-1", "P1", "Stup HEA 200, L = 7,2 m", 14, [stavkaProfil("st-d1-1", "kat-hea200", 7.2, 1, "kv-s355j2"), stavkaLim("st-d1-2", "kat-lim15", 300, 400, 1, "kv-s355j2")], { pila: 0.3, laserLimovi: 0.2, pripremaPozicija: 0.4, sklapanjeKonstrukcije: 1.5, zavarivanje: 2, brusenje: 0.5, akz: 0.6 }, { stavkeAKZ: [{ id: "akz-d1", tip: "vrucecincano", cijenaKg: 0.55 }] }),
      poz("pp-d1-2", "P2", "Krovni nosač IPE 200, L = 12 m", 7, [stavkaProfil("st-d1-3", "kat-ipe200", 12, 2), stavkaLim("st-d1-4", "kat-lim10", 200, 300, 4)], { pila: 0.5, laserLimovi: 0.3, pripremaPozicija: 0.6, sklapanjeKonstrukcije: 2.5, zavarivanje: 3.5, brusenje: 0.8, akz: 1 }, { stavkeAKZ: [{ id: "akz-d2", tip: "vrucecincano", cijenaKg: 0.55 }], brojMontera: 3, planiraniSatiMontaza: 4 }),
      poz("pp-d1-3", "P3", "Spreg L 50x5", 24, [stavkaProfil("st-d1-5", "kat-l50", 5.8, 1)], { pila: 0.1, pripremaPozicija: 0.1, zavarivanje: 0.2, akz: 0.1 }),
    ]),
    ponuda("pon-d2", `PON-${godina}-002`, "Nadstrešnica parkirališta, 3 modula", "kup-d1", d(-40), "Prihvaćena", [
      poz("pp-d2-1", "P1", "Stup kvadratna cijev 100x100x5", 12, [stavkaProfil("st-d2-1", "kat-kv100", 3.2, 1), stavkaLim("st-d2-2", "kat-lim10", 250, 250, 1)], { pila: 0.2, laserLimovi: 0.1, sklapanjeKonstrukcije: 0.8, zavarivanje: 1, brusenje: 0.3, akz: 0.4 }, { stavkeAKZ: [{ id: "akz-d3", tip: "plastificirano", cijenaKg: 0.9 }] }),
      poz("pp-d2-2", "P2", "Krovna greda 100x50x4", 18, [stavkaProfil("st-d2-3", "kat-pr100", 5.5, 1)], { pila: 0.2, sklapanjeKonstrukcije: 0.5, zavarivanje: 0.6, akz: 0.3 }, { stavkeAKZ: [{ id: "akz-d4", tip: "plastificirano", cijenaKg: 0.9 }], brojMontera: 2, planiraniSatiMontaza: 1.5 }),
    ]),
    ponuda("pon-d3", `PON-${godina}-003`, "Stubište i ograde, poslovna zgrada", "kup-d2", d(-20), "Prihvaćena", [
      poz("pp-d3-1", "P1", "Obrazni nosač stubišta UPN 120", 4, [stavkaProfil("st-d3-1", "kat-upn120", 4.6, 2)], { pila: 0.4, laserProfili: 0.5, sklapanjeKonstrukcije: 3, zavarivanje: 4, brusenje: 1.5, ravnanje: 0.5, akz: 1 }),
      poz("pp-d3-2", "P2", "Gazište, rebrasti lim 5 mm", 64, [stavkaLim("st-d3-2", "kat-lim5", 300, 1100, 1)], { laserLimovi: 0.1, kutnoSavijanje: 0.15, zavarivanje: 0.2, akz: 0.1 }),
      poz("pp-d3-3", "P3", "Ograda, okrugla cijev 60,3", 10, [stavkaProfil("st-d3-3", "kat-ok60", 3, 3), stavkaProfil("st-d3-4", "kat-pl50", 3, 2)], { pila: 0.3, laserProfili: 0.4, zavarivanje: 2, brusenje: 1, akz: 0.5 }),
    ], { napomenaNjemacki: "Lieferung frei Baustelle. Preise netto zzgl. MwSt." }),
    ponuda("pon-d4", `PON-${godina}-004`, "Platforma za opremu, terminal", "kup-d5", d(-6), "Poslana", [
      poz("pp-d4-1", "P1", "Glavni nosač HEB 200", 6, [stavkaProfil("st-d4-1", "kat-heb200", 6, 1, "kv-s355j2")], { pila: 0.3, pripremaPozicija: 0.5, sklapanjeKonstrukcije: 2, zavarivanje: 2.5, akz: 0.8 }, { stavkeAKZ: [{ id: "akz-d5", tip: "vrucecincano", cijenaKg: 0.55 }] }),
      poz("pp-d4-2", "P2", "Podest, lim 5 mm", 12, [stavkaLim("st-d4-2", "kat-lim5", 1000, 2000, 1)], { laserLimovi: 0.3, kutnoSavijanje: 0.3, zavarivanje: 0.5, akz: 0.3 }),
    ]),
    ponuda("pon-d5", `PON-${godina}-005`, "Konzole za cjevovod, 40 kom", "kup-d4", d(-1), "U izradi", [
      poz("pp-d5-1", "P1", "Konzola L 50x5 s pločom", 40, [stavkaProfil("st-d5-1", "kat-l50", 0.6, 2), stavkaLim("st-d5-2", "kat-lim10", 150, 150, 1)], { pila: 0.05, laserLimovi: 0.05, zavarivanje: 0.25, akz: 0.05 }),
    ]),
    ponuda("pon-d6", `PON-${godina}-006`, "Ograda rampe, 25 m", "kup-d1", d(-30), "Odbijena", [
      poz("pp-d6-1", "P1", "Segment ograde 2,5 m", 10, [stavkaProfil("st-d6-1", "kat-ok60", 2.5, 3)], { pila: 0.2, zavarivanje: 1.2, brusenje: 0.4, akz: 0.3 }),
    ]),
  ];
  const ponudaPoId = Object.fromEntries(ponude.map((p) => [p.id, p]));

  const projekti = [];
  const radniNalozi = [];
  // Projekt iz ponude — isti postupak kao "Pretvori u projekt" u aplikaciji (pretvoriUProjekt).
  // napredak: udio naloga (redom) koji su završeni; idući nalog je "U tijeku".
  const projektIzPonude = (pid, ponudaId, sifra, { status, voditeljId, pocetak, trajanje, napredak, zadaciGotovo, mjestoIsporuke }) => {
    const p = ponudaPoId[ponudaId];
    const calc = izracun(p);
    const faze = { ...Object.fromEntries(OPERACIJE_KLJUCEVI.map((k) => [LABEL[k], calc.sati[k]])), "Montaža (teren)": calc.satiMontaze, "Kontrola kvalitete": 0, Ostalo: 0 };
    const kupac = kupci.find((k) => k.id === p.kupacId);
    projekti.push({
      id: pid, sifra, naziv: p.naziv, kupacId: p.kupacId, status, vrijednost: Math.round(calc.cijena), rokPocetka: pocetak, rokZavrsetka: dodajDane(pocetak, trajanje),
      opis: `Kreirano iz ponude ${p.broj}.`, izvorPonudaId: p.id, pozicije: p.pozicije, materijalStavke: [], ostaleStavke: [], voditeljId,
      kontaktOsoba: kupac.kontaktOsoba, kontaktEmail: kupac.email, kontaktTelefon: kupac.telefon, mjestoIsporuke: mjestoIsporuke || kupac.adresa,
      zadaci: zadaciProjekta(pid, zadaciGotovo, voditeljId, pocetak), faze,
    });
    p.projektId = pid;
    const faze2 = OPERACIJE_KLJUCEVI.filter((k) => calc.sati[k] > 0).map((k) => ({ faza: LABEL[k], sati: calc.sati[k] }));
    if (calc.satiMontaze > 0) faze2.push({ faza: "Montaža (teren)", sati: calc.satiMontaze });
    const brojZavrsenih = Math.floor(faze2.length * napredak);
    const korak = Math.max(2, Math.floor(trajanje / Math.max(1, faze2.length)));
    faze2.forEach((f, i) => {
      const zavrsen = i < brojZavrsenih;
      const uTijeku = i === brojZavrsenih && napredak > 0 && napredak < 1;
      const sati = Math.round(f.sati * 100) / 100;
      radniNalozi.push({
        id: `rn-${pid}-${i + 1}`, broj: `${sifra}/${i + 1}`, projektId: pid, naziv: p.naziv, faza: f.faza, zaduzenTim: "",
        status: zavrsen ? "Završen" : uTijeku ? "U tijeku" : "Planiran", planiranoSati: sati,
        utrosenoSati: zavrsen ? Math.round(sati * (0.85 + rnd() * 0.3) * 10) / 10 : uTijeku ? Math.round(sati * 0.4 * 10) / 10 : 0,
        datumPocetka: dodajDane(pocetak, i * korak), datumZavrsetka: dodajDane(pocetak, i * korak + korak + 2), stavke: [], materijalIzdan: zavrsen || uTijeku,
      });
    });
  };
  projektIzPonude("proj-d1", "pon-d1", `${yy}-101`, { status: "Završen", voditeljId: "zap-d4", pocetak: d(-70), trajanje: 55, napredak: 1, zadaciGotovo: 5 });
  projektIzPonude("proj-d2", "pon-d2", `${yy}-102`, { status: "U izradi", voditeljId: "zap-d4", pocetak: d(-30), trajanje: 45, napredak: 0.6, zadaciGotovo: 3 });
  projektIzPonude("proj-d3", "pon-d3", `${yy}-103`, { status: "Odobren", voditeljId: "zap-d3", pocetak: d(-10), trajanje: 40, napredak: 0.2, zadaciGotovo: 1, mjestoIsporuke: "Baustelle Musterplatz 3, 80331 München" });

  // ---------- narudžbe kupaca, otpremnice, fakture ----------
  const narudzbe = [
    { id: "nar-k1", projektId: "proj-d1", kupacId: "kup-d3", broj: "HS-2026-0412", datum: d(-72), napomena: "", stavke: [] },
    { id: "nar-k2", projektId: "proj-d2", kupacId: "kup-d1", broj: "GP-778/26", datum: d(-32), napomena: "", stavke: [] },
    { id: "nar-k3", projektId: "proj-d3", kupacId: "kup-d2", broj: "4500012345", datum: d(-12), napomena: "Bestellung laut Angebot", stavke: [] },
  ];
  const vrijednostProjekta = (id) => projekti.find((p) => p.id === id).vrijednost;
  const fakture = [
    { id: "fak-d1", broj: `FAK-${godina}-0001`, projektId: "proj-d1", kupacId: "kup-d3", datumIzdavanja: d(-35), rokPlacanja: d(-5), status: "Plaćeno", stavke: [{ opis: "Čelična hala — izrada i isporuka konstrukcije (1. situacija)", kolicina: 1, jm: "kom", cijenaJed: Math.round(vrijednostProjekta("proj-d1") * 0.6) }] },
    { id: "fak-d2", broj: `FAK-${godina}-0002`, projektId: "proj-d1", kupacId: "kup-d3", datumIzdavanja: d(-12), rokPlacanja: d(18), status: "Poslano", stavke: [{ opis: "Čelična hala — montaža i okončana situacija", kolicina: 1, jm: "kom", cijenaJed: vrijednostProjekta("proj-d1") - Math.round(vrijednostProjekta("proj-d1") * 0.6) }] },
    { id: "fak-d3", broj: `FAK-${godina}-0003`, projektId: "proj-d2", kupacId: "kup-d1", datumIzdavanja: d(-3), rokPlacanja: d(27), status: "Nacrt", stavke: [{ opis: "Nadstrešnica — avans 30 %", kolicina: 1, jm: "kom", cijenaJed: Math.round(vrijednostProjekta("proj-d2") * 0.3) }] },
  ];

  // ---------- nabava ----------
  const stavkaNar = (materijalId, komada, cijenaPoJed, kvaliteta, projektId = null) => ({ materijalId, nacinUnosa: "komadi", kolicina: komada, duzinaM: 6, sirinaM: 1.25, komada, cijenaPoJed, kvaliteta, projektId });
  const matCijena = (id) => materijali.find((m) => m.id === id).cijena;
  const narudzbenice = [
    { id: "nab-d1", broj: `NAR-${godina}-001`, dobavljacId: "dob-d1", datum: d(-4), rokIsporuke: d(5), status: "Poslano", napomena: "Isporuka na adresu radionice.", izradioId: "zap-d2", stavke: [stavkaNar("mat-d3", 12, matCijena("mat-d3"), "S235JR", "proj-d3"), stavkaNar("mat-d8", 6, matCijena("mat-d8"), "S355J2", "proj-d3")] },
    { id: "nab-d2", broj: `NAR-${godina}-002`, dobavljacId: "dob-d4", datum: d(-1), rokIsporuke: d(3), status: "Nacrt", napomena: "", izradioId: "zap-d5", stavke: [stavkaNar("mat-d11", 500, matCijena("mat-d11"), "")] },
  ];

  // ---------- zadaci ----------
  const slobodni = (id, naziv, dodijeljenoId, zadaoId, planiraniDatum, izvrseno = false) => ({
    id, naziv, dodijeljenoId, planiraniDatum, izvrseno, izvrsioId: izvrseno ? dodijeljenoId : null, datumIzvrsenja: izvrseno ? d(-1) : null,
    kreiraoId: zadaoId, zadaoId, zadanoDatum: `${d(-3)}T08:00:00.000Z`, dodjelaVidjena: true,
  });
  const slobodniZadaci = [
    slobodni("sz-d1", "Pregledati ponudu za platformu terminala prije slanja", DEMO_ZAPOSLENIK_ID, "zap-d1", d(1)),
    slobodni("sz-d2", "Dogovoriti termin cinčanja za projekt nadstrešnice", "zap-d4", DEMO_ZAPOSLENIK_ID, d(2)),
    slobodni("sz-d3", "Inventura vijčane robe", "zap-d5", DEMO_ZAPOSLENIK_ID, d(4)),
    slobodni("sz-d4", "Poslati atestne listove kupcu Hale Sjever", "zap-d3", "zap-d1", d(-2), true),
  ];

  // ---------- evidencija rada (zadnja dva tjedna + danas) ----------
  const evidencijaRada = [];
  for (let n = -14; n <= 0; n++) {
    const datum = d(n);
    if (!jeRadniDan(datum)) continue;
    radiona.forEach((zid, i) => {
      if (n === -7 && i === 2) {
        evidencijaRada.push({ id: `evr-d-${datum}-${zid}`, zaposlenikId: zid, vrijemeDolaska: `${datum}T00:00:00`, vrijemeOdlaska: `${datum}T00:00:00`, vrsta: "godisnji", autoOdjava: false, potvrdenoRacunovodstvo: true, unioRucnoId: "racunovodstvo" });
        return;
      }
      const dolazakMin = 5 * 60 + 50 + Math.floor(rnd() * 15);
      const odlazakMin = 14 * 60 + Math.floor(rnd() * 50) + (rnd() < 0.2 ? 90 : 0);
      evidencijaRada.push({
        id: `evr-d-${datum}-${zid}`, zaposlenikId: zid,
        vrijemeDolaska: zagrebISO(datum, Math.floor(dolazakMin / 60), dolazakMin % 60),
        vrijemeOdlaska: n === 0 ? null : zagrebISO(datum, Math.floor(odlazakMin / 60), odlazakMin % 60),
        vrsta: "rad", autoOdjava: false, potvrdenoRacunovodstvo: n < -1, unioRucnoId: null,
      });
    });
  }

  const postavkePlaca = {
    vrijednostBoda: 1, dodatakStazPoGodini: 0.5, fondSatiMjesec: 174, normaSatiDan: 8, prekovremeniFaktor: 1.5, cijenaKm: 0.1,
    topliObrokIznos: 7, topliObrokMinSati: 6, autoOdjavaSati: 12, obracunskaJedinicaMin: 30, dnevnicaTerenEurDan: 30,
    smjene: [
      { kljuc: "jutarnja", naziv: "Jutarnja", pocetak: "06:00", dodatakPostotak: 0 },
      { kljuc: "popodnevna", naziv: "Popodnevna", pocetak: "14:00", dodatakPostotak: 10 },
    ],
  };
  const praznici = [["01-01", "Nova godina"], ["01-06", "Sveta tri kralja"], ["05-01", "Praznik rada"], ["05-30", "Dan državnosti"], ["06-22", "Dan antifašističke borbe"], ["08-05", "Dan pobjede i domovinske zahvalnosti"], ["08-15", "Velika Gospa"], ["11-01", "Svi sveti"], ["11-18", "Dan sjećanja na žrtve Domovinskog rata"], ["12-25", "Božić"], ["12-26", "Sveti Stjepan"]]
    .map(([md, naziv]) => ({ datum: `${godina}-${md}`, naziv }));

  return {
    postavkeTvrtke, pozicijeZaposlenika, zaposlenici, kupci, dobavljaci, kvaliteteMaterijala, katalogProfila, materijali,
    cjenikRada, standardniZadaci, ponude, projekti, radniNalozi, narudzbe, fakture, narudzbenice, slobodniZadaci,
    evidencijaRada, postavkePlaca, praznici,
  };
}

module.exports = { demoPodaci, DEMO_ZAPOSLENIK_ID, DEMO_LOZINKA, DEMO_POZICIJA_ID };

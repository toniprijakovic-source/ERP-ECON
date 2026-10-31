// Zaštita na radu → Liječnički pregledi (uputnica RA-1): čista logika bez React-a i poslužitelja — OIB, datumi, staž, točke Pravilnika,
// rokovi pregleda, nazivi datoteka i sastavljanje polja uputnice. Ispis (PDF) je u pdfUputnica.js, sučelje u App.jsx, a pravila koja mora
// provesti i poslužitelj (broj uputnice, OIB, odobrenje predloška) su u backend/server.js (isti oblik podataka).

export const VRSTE_PREGLEDA = [
  { key: "prethodni", naziv: "Prethodni", opis: "novi radnik, prije početka rada na tom radnom mjestu" },
  { key: "periodicki", naziv: "Periodički", opis: "redovni pregled koji se ponavlja" },
  { key: "izvanredni", naziv: "Izvanredni", opis: "izvan roka, npr. nakon bolesti, ozljede ili promjene posla" },
];
export const nazivVrste = (key) => VRSTE_PREGLEDA.find((v) => v.key === key)?.naziv || key || "";
export const SKOLSKE_SPREME = ["NSS", "NKV", "KV", "SSS", "VKV", "VŠS", "VSS"];
export const OCJENA_ZADANO = "Sposoban, sposoban za rad u tuzemstvu i inozemstvu.";

// Kućice kao na obrascu RA-1 (isti redoslijed i nazivi). Vrijednosti u predlošku i uputnici su popisi ključeva označenih kućica.
export const KUCICE = [
  { key: "mjestoRada", naziv: "Mjesto rada", opcije: [["zatvoreno", "u zatvorenom"], ["otvoreno", "na otvorenom"], ["visina", "na visini"], ["jama", "u jami"], ["voda", "u vodi"], ["podVodom", "pod vodom"], ["mokro", "u mokrom"]] },
  { key: "organizacija", naziv: "Organizacija rada", opcije: [["smjene", "u smjenama"], ["nocni", "noćni rad"], ["terenski", "terenski rad"], ["sam", "radi sam"], ["grupa", "radi s grupom"], ["stranke", "radi sa strankama"], ["traka", "radi na traci"], ["brzi", "brzi tempo rada"], ["ritam", "ritam određen"], ["monotonija", "monotonija"]] },
  { key: "polozaj", naziv: "Položaj tijela i aktivnosti", opcije: [["stojeci", "rad stojeći"], ["sagibanje", "učestalo sagibanje"], ["podvlacenje", "podvlačenje"], ["sjedeci", "rad sjedeći"], ["zakretanje", "zakretanje trupa"], ["balansiranje", "balansiranje"], ["pokret", "u pokretu"], ["klecanje", "klečanje"], ["ljestve", "uspinjanje ljestvama"], ["kombinirano", "kombinirano"], ["cucanje", "čučanje"], ["stepenice", "uspinjanje stepenicama"]] },
  { key: "vazno", naziv: "U poslu je važan", opcije: [["vidDaljina", "vid na daljinu"], ["vidBlizina", "vid na blizinu"], ["boje", "raspoznavanje boja"], ["sluh", "dobar sluh"], ["govor", "jasan govor"]] },
  { key: "uvjeti", naziv: "Uvjeti rada", opcije: [["visokaTemp", "visoka temperatura"], ["visokaVlaznost", "visoka vlažnost"], ["niskaTemp", "niska temperatura"], ["buka", "buka"], ["vibracijeStroja", "vibracije stroja ili alata"], ["vibracijePoda", "vibracije poda"], ["atmTlak", "povišeni atmosferski tlak"], ["ozljede", "povećana izloženost ozljedama"], ["ionizirajuca", "ionizirajuća zračenja"], ["neionizirajuca", "neionizirajuća zračenja"], ["prasina", "prašina"]] },
];
// Tereti uz položaj tijela: kućica + granica u kg ("diz. tereta >25 kg").
export const TERETI = [["dizanje", "diz. tereta"], ["prenosenje", "prenoš. tereta"], ["guranje", "guranje tereta"]];
export const prazniTereti = () => Object.fromEntries(TERETI.map(([k]) => [k, { oznaceno: false, kg: "" }]));

// ---------- OIB ----------
export const ocistiOib = (v) => String(v ?? "").replace(/\D/g, "");
// Kontrolna znamenka OIB-a (ISO 7064, MOD 11,10).
export const provjeriOib = (oib) => {
  const o = ocistiOib(oib);
  if (o.length !== 11) return false;
  let a = 10;
  for (let i = 0; i < 10; i++) {
    a = (a + Number(o[i])) % 10;
    if (a === 0) a = 10;
    a = (a * 2) % 11;
  }
  let k = 11 - a;
  if (k === 10) k = 0;
  return k === Number(o[10]);
};

// ---------- datumi i staž ----------
const JE_DATUM = /^\d{4}-\d{2}-\d{2}/;
// Uvijek DD.MM.GGGG. (s točkom na kraju), kao na obrascu.
export const datumHr = (iso) => (JE_DATUM.test(String(iso || "")) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}.` : "");
// Pune navršene mjesece između dva datuma (YYYY-MM-DD); 0 ako nedostaje datum ili je kraj prije početka.
export const mjeseciIzmedu = (odISO, doISO) => {
  if (!JE_DATUM.test(String(odISO || "")) || !JE_DATUM.test(String(doISO || ""))) return 0;
  const [y1, m1, d1] = odISO.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = doISO.slice(0, 10).split("-").map(Number);
  let m = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) m--;
  return Math.max(0, m);
};
export const dodajMjesece = (iso, n) => {
  if (!JE_DATUM.test(String(iso || ""))) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const ukupno = (y * 12 + (m - 1)) + Number(n || 0);
  const ny = Math.floor(ukupno / 12), nm = ukupno % 12;
  const zadnjiDan = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, zadnjiDan)).padStart(2, "0")}`;
};
// Staž na obrascu: pune godine ("28 g"); kraće od godine u mjesecima ("7 mj").
export const stazTekst = (mjeseci) => { const m = Math.max(0, Math.floor(Number(mjeseci) || 0)); return m >= 12 ? `${Math.floor(m / 12)} g` : `${m} mj`; };
// Ukupni staž = sav staž prije datuma zaposlenja kod nas + vrijeme od zaposlenja do datuma uputnice. Staž na poslovima za koje se
// utvrđuje sposobnost = od početka rada na tom radnom mjestu (zadano: datum zaposlenja); kod prethodnog pregleda ostaje prazan.
export const izracunajStaz = ({ datumZaposlenja, stazPrijeGodine, stazPrijeMjeseci, datumPocetkaNaRadnomMjestu }, naDatum, vrsta) => {
  const prije = (Number(stazPrijeGodine) || 0) * 12 + (Number(stazPrijeMjeseci) || 0);
  const ukupnoMj = prije + mjeseciIzmedu(datumZaposlenja, naDatum);
  return {
    ukupno: stazTekst(ukupnoMj),
    naPoslovima: vrsta === "prethodni" ? "" : stazTekst(mjeseciIzmedu(datumPocetkaNaRadnomMjestu || datumZaposlenja, naDatum)),
  };
};
// Staž izvan Econa iz Godišnjeg odmora (decimalne godine, npr. 6,5) kao godine + mjeseci.
export const godineUGodineMjesece = (decimalneGodine) => {
  const g = Number(String(decimalneGodine ?? "").replace(",", "."));
  if (!Number.isFinite(g) || g <= 0) return { godine: 0, mjeseci: 0 };
  const ukupnoMj = Math.round(g * 12);
  return { godine: Math.floor(ukupnoMj / 12), mjeseci: ukupnoMj % 12 };
};

// ---------- točke Pravilnika o poslovima s posebnim uvjetima rada ----------
const sortirani = (brojevi) => [...new Set(brojevi)].sort((a, b) => a - b);
const brojeviIz = (tekst) => [...String(tekst || "").matchAll(/\d+/g)].map((m) => Number(m[0]));
// "16., 17., 18. (pp. 18., 19.)" ili "1.,2.,5.,16.,17.,18.(pp 19,23)" → { tocke, podtocke }; tekst izvan zagrada iza točaka (npr.
// "+ bojanje temeljnom bojom") nema brojeva pa ne smeta, a svaka zagrada "(pp …)" dodaje podtočke.
export const parsirajTocke = (tekst) => {
  const s = String(tekst || "");
  const podtocke = [...s.matchAll(/\(\s*pp\.?\s*([^)]*)\)/gi)].flatMap((m) => brojeviIz(m[1]));
  const glavni = s.replace(/\([^)]*\)/g, " ");
  return { tocke: sortirani(brojeviIz(glavni)), podtocke: sortirani(podtocke) };
};
// Radnik s više poslova: točke i podtočke svih poslova spajaju se u jedan popis bez ponavljanja, poredan po broju.
export const spojiTocke = (popis) => ({ tocke: sortirani((popis || []).flatMap((p) => p?.tocke || [])), podtocke: sortirani((popis || []).flatMap((p) => p?.podtocke || [])) });
// Kao na dosadašnjim uputnicama: "1.,2.,5.,16.,17.,18.(pp 19,23,24,41)".
export const formatirajTocke = ({ tocke = [], podtocke = [] } = {}) => `${tocke.map((t) => `${t}.`).join(",")}${podtocke.length ? `(pp ${podtocke.join(",")})` : ""}`;

// ---------- radna mjesta iz Procjene rizika 2025 (METRO-ING d.o.o., 27.06.2025.) ----------
// Šifre, nazivi i točke čl. 3. Pravilnika (poglavlje F.6, str. 185–186) preuzeti su iz specifikacije. Sadržaj kućica i opisa (listovi C.4
// "Podaci za poslove") za većinu poslova tek treba upisati prema Procjeni — za Montera i Bravara postoji nacrt iz dosadašnjih uputnica.
// Svi predlošci počinju neodobreni; uputnica se može izdati tek nakon što ih odgovorna osoba odobri.
export const IZVOR_PROCJENE = "Procjena rizika 2025 (METRO-ING d.o.o., 27.06.2025.)";
const RADNA_MJESTA_PROCJENE = [
  ["0101", "Direktor", "Uprava", null], ["0102", "Pomoćnik direktora", "Uprava", null],
  ["0201", "Tehnički administrator", "Administracija", null], ["0202", "Računovodstveno-knjigovodstveni referent", "Administracija", null],
  ["0203", "Računovodstveno-administrativni referent", "Administracija", null], ["0204", "Stručnjak zaštite na radu", "Administracija", null],
  ["0205", "Rukovodilac RJ Njemačka", "Administracija", null],
  ["0301", "Voditelj proizvodnje", "Proizvodnja", "17., 18. (pp. 18., 19.)"], ["0302", "Tehnolog", "Proizvodnja", "17., 18. (pp. 18., 19.)"],
  ["0303", "Projekt manager", "Proizvodnja", "17., 18. (pp. 18., 19.)"], ["0304", "Zavarivač", "Proizvodnja", "16., 18. (pp. 18., 19., 23., 24., 41.)"],
  ["0305", "Bravar/strojobravar", "Proizvodnja", "1., 16., 17., 18. (pp. 18., 19., 23., 24., 41.) + bojanje temeljnom bojom (pp 50.)"],
  ["0306", "Učenik na naukovanju – bravar/strojobravar", "Proizvodnja", null],
  ["0307", "Pomoćni bravar", "Proizvodnja", "16., 17., 18. (pp. 18., 19., 23., 24., 41.) + bojanje temeljnom bojom (pp 50.)"],
  ["0308", "Rukovatelj mosnom dizalicom", "Proizvodnja", "5., 18. (pp. 18.)"], ["0309", "Rukovatelj portalnom dizalicom", "Proizvodnja", "2., 5., 18. (pp. 18.)"],
  ["0310", "Rukovatelj viličarom", "Proizvodnja", "2., 16., 18. (pp. 18., 19.)"],
  ["0401", "Monter", "Montaža", "16., 17., 18. (pp 18., 19.)"], ["0402", "Rukovatelj samohodnom/hidrauličnom platformom", "Montaža", "2., 5., 17., 18. (pp. 18.)"],
  ["0403", "Rukovatelj hidrauličnom dizalicom", "Montaža", "5., 18. (pp. 18.)"], ["0404", "Rukovatelj toranjskom dizalicom", "Montaža", "5., 18. (pp. 18.)"],
  ["0501", "Rukovatelj opasnim kemikalijama", "Prostor za bojanje", "18. (pp. 43., 48., 50.)"],
];
const NACRT_BRAVARIJA = {
  kratakOpis: "Izrada i montaža građevinske bravarije i limarije te fasade",
  mjestoRada: ["zatvoreno", "otvoreno", "visina"], organizacija: ["terenski", "ritam"], polozaj: ["ljestve"],
  tereti: { dizanje: { oznaceno: true, kg: 25 }, prenosenje: { oznaceno: true, kg: 25 }, guranje: { oznaceno: true, kg: 25 } },
  vazno: ["vidDaljina", "vidBlizina", "sluh"], uvjeti: [],
};
const NACRTI_SADRZAJA = {
  "0401": { ...NACRT_BRAVARIJA, strojevi: "Vibracijska bušilica, električna pila za željezo, pila za keramiku, strojevi i alati za obradu metala.",
    napomenaProvjere: "Nacrt iz dosadašnjih uputnica. Za provjeru prije odobrenja: na starim uputnicama točke su 1.,2.,5.,16.,17.,18.(pp 19) (vjerojatno zbog dodatnih poslova — platforma, bravarski radovi), u Procjeni buka u pogonu ima ocjenu „Ne zadovoljava“ a kućica „buka“ nije označena, a kao biološka štetnost u Procjeni stoji COVID-19 dok na uputnicama piše „/“." },
  "0305": { ...NACRT_BRAVARIJA, strojevi: "strojevi i alati za obradu metala.",
    napomenaProvjere: "Nacrt iz dosadašnje uputnice za bravara. Sadržaj kućica provjeriti prema listu C.4 Procjene rizika." },
};
export const prazanPredlozak = () => ({
  sifra: "", naziv: "", proces: "", posebniUvjeti: true, clanak: "3.", tocke: [], podtocke: [], drugiPropis: "", povecaniStaz: "",
  kratakOpis: "", strojevi: "", predmetRada: "", mjestoRada: [], organizacija: [], polozaj: [], tereti: prazniTereti(), vazno: [], uvjeti: [],
  kemijskeTvari: "/", biolosteStetnosti: "/", rokPeriodickogMjeseci: "", izvor: IZVOR_PROCJENE, napomenaProvjere: "", odobreno: null,
});
// Stabilni id-evi (rm-<šifra>) — ponovni uvoz ne stvara duplikate, a poslužitelj ionako ne prepisuje postojeće.
export const predlosciIzProcjene = () => RADNA_MJESTA_PROCJENE.map(([sifra, naziv, proces, tockeTekst]) => ({
  ...prazanPredlozak(), ...(NACRTI_SADRZAJA[sifra] || {}), id: `rm-${sifra}`, sifra, naziv, proces,
  posebniUvjeti: !!tockeTekst, clanak: tockeTekst ? "3." : "", ...parsirajTocke(tockeTekst),
}));

// ---------- pregledi, rokovi ----------
// Zadnji pregled radnika s upisanim rezultatom (ocjena) — iz njega periodička i izvanredna uputnica preuzimaju blok "posljednji pregled".
export const zadnjiPregled = (pregledi, zaposlenikId) => (pregledi || [])
  .filter((p) => p.zaposlenikId === zaposlenikId && p.datumPregleda && String(p.ocjena || "").trim())
  .sort((a, b) => String(b.datumPregleda).localeCompare(String(a.datumPregleda)) || String(b.unesenoU || "").localeCompare(String(a.unesenoU || "")))[0] || null;
// Datum sljedećeg pregleda: ono što je liječnik napisao, inače datum pregleda + rok radnog mjesta (ili zadani rok iz postavki).
export const sljedeciPregled = (pregled, radnoMjesto, zadaniRokMjeseci) => {
  if (!pregled) return "";
  if (pregled.datumSljedeceg) return pregled.datumSljedeceg;
  const rok = Number(radnoMjesto?.rokPeriodickogMjeseci) || Number(zadaniRokMjeseci) || 0;
  return pregled.datumPregleda && rok ? dodajMjesece(pregled.datumPregleda, rok) : "";
};
const utcDan = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
const danaIzmedu = (odISO, doISO) => Math.round((utcDan(doISO) - utcDan(odISO)) / 86400000);
// "nema" = nema podataka o roku, "isteklo", "uskoro" (u idućih `dana` dana), "uredu".
export const statusRoka = (rokISO, danasISO, dana = 30) => {
  if (!JE_DATUM.test(String(rokISO || ""))) return "nema";
  const d = danaIzmedu(danasISO, rokISO);
  return d < 0 ? "isteklo" : d <= dana ? "uskoro" : "uredu";
};

// ---------- brojevi i nazivi datoteka ----------
export const brojUputnice = (redniBroj, godina) => `${redniBroj}/${godina}`;
// Prikaz sljedećeg broja u sučelju (poslužitelj ga dodjeljuje samo, pod zaključavanjem): najveći broj te godine (uključujući poništene
// uputnice — broj se nikad ne ponavlja) ili početni broj iz postavki, + 1. Prva godina bez ijednog upisa traži početni broj.
export const sljedeciRedniBroj = (uputnice, postavke, godina) => {
  const brojevi = (uputnice || []).filter((u) => Number(u.godina) === Number(godina)).map((u) => Number(u.redniBroj) || 0);
  const pocetni = Number(postavke?.pocetniBrojevi?.[godina]) || 0;
  return Math.max(pocetni, ...brojevi, 0) + 1;
};
// Dok aplikacija nije izdala nijednu uputnicu, a zadnji ručno izdani broj nije upisan, broj bi krenuo od 1 i ponovio već izdane brojeve.
// Od druge godine nadalje (kad već postoje uputnice) brojanje samo kreće ispočetka.
export const trebaPocetniBroj = (uputnice, postavke) => (uputnice || []).length === 0 && Object.keys(postavke?.pocetniBrojevi || {}).length === 0;
export const bezDijakritika = (s) => String(s || "").replace(/đ/g, "d").replace(/Đ/g, "D").normalize("NFD").replace(/[̀-ͯ]/g, "");
export const nazivDatotekeUputnice = (u) => `RA-1_${String(u.broj || "").replace("/", "-")}_${bezDijakritika(u.polja?.prezime || u.polja?.imePrezime || "radnik").replace(/[^A-Za-z0-9]+/g, "")}_${u.vrsta || ""}.pdf`;

// ---------- sastavljanje polja uputnice ----------
export const NEDOSTAJUCI_PODACI = [["oib", "OIB"], ["datumRodjenja", "datum rođenja"], ["mjestoRodjenja", "mjesto rođenja"], ["imeRoditelja", "ime oca/majke"], ["zanimanje", "zanimanje"], ["skolskaSprema", "školska sprema"], ["radnoMjestoId", "radno mjesto"]];
export const nedostajuciPodaci = (radnik) => NEDOSTAJUCI_PODACI.filter(([k]) => !String(radnik?.[k] ?? "").trim()).map(([, naziv]) => naziv);

const kopijaKucica = (popis) => [...(popis || [])];
// Polja uputnice kakva se ispisuju (snimka). Poslužitelj ih sprema kako su poslana, pa se stara uputnica uvijek ispiše jednaka.
export function izradiPoljaUputnice({ zaposlenik, radnik, radnoMjesto, dodatnaRadnaMjesta = [], vrsta, datum, posljednjiPregled, tvrtka, nazivPoslodavca }) {
  const r = radnik || {};
  const rm = radnoMjesto || {};
  const t = tvrtka || {};
  const staz = izracunajStaz({ datumZaposlenja: zaposlenik?.datumZaposlenja, stazPrijeGodine: r.stazPrijeGodine, stazPrijeMjeseci: r.stazPrijeMjeseci, datumPocetkaNaRadnomMjestu: r.datumPocetkaNaRadnomMjestu }, datum, vrsta);
  const posebni = [rm, ...dodatnaRadnaMjesta].filter((p) => p && p.posebniUvjeti !== false && ((p.tocke || []).length || (p.podtocke || []).length));
  const adresa = String(t.adresa || "").split(/\s*,\s*/).filter(Boolean);
  const prosli = vrsta === "prethodni" ? null : posljednjiPregled || null;
  return {
    poslodavac: { naziv: nazivPoslodavca || t.naziv || "", adresa1: adresa[0] || "", adresa2: adresa.slice(1).join(", "), oib: ocistiOib(t.oib) },
    ime: zaposlenik?.ime || "", prezime: zaposlenik?.prezime || "", imeRoditelja: r.imeRoditelja || "",
    datumRodjenja: r.datumRodjenja || "", mjestoRodjenja: r.mjestoRodjenja || "", oib: ocistiOib(r.oib),
    zanimanje: r.zanimanje || "", skolskaSprema: r.skolskaSprema || "",
    posloviNaziv: rm.naziv || "",
    clanak: posebni.length ? (rm.clanak || "3.") : "", tocke: posebni.length ? formatirajTocke(spojiTocke(posebni)) : "",
    drugiPropis: rm.drugiPropis || "", povecaniStaz: rm.povecaniStaz || "",
    ukupniStaz: staz.ukupno, stazNaPoslovima: staz.naPoslovima,
    posljednjiPregled: prosli ? { datum: prosli.datumPregleda || "", clanak: prosli.clanak || "", tocke: prosli.tocke || "", drugiPropis: prosli.drugiPropis || "", ocjena: prosli.ocjena || "" } : null,
    kratakOpis: rm.kratakOpis || "", strojevi: rm.strojevi || "", predmetRada: rm.predmetRada || "",
    mjestoRada: kopijaKucica(rm.mjestoRada), organizacija: kopijaKucica(rm.organizacija), polozaj: kopijaKucica(rm.polozaj),
    tereti: JSON.parse(JSON.stringify({ ...prazniTereti(), ...(rm.tereti || {}) })),
    vazno: kopijaKucica(rm.vazno), uvjeti: kopijaKucica(rm.uvjeti),
    kemijskeTvari: rm.kemijskeTvari ?? "/", biolosteStetnosti: rm.biolosteStetnosti ?? "/",
  };
}
export const imePrezime = (polja) => `${polja?.ime || ""} ${polja?.prezime || ""}`.trim();

// Što mora biti ispunjeno prije spremanja uputnice (poslužitelj provjerava isto).
export const provjeriUputnicu = ({ polja, vrsta, datum }) => {
  const g = [];
  if (!VRSTE_PREGLEDA.some((v) => v.key === vrsta)) g.push("Odaberi vrstu pregleda.");
  if (!imePrezime(polja)) g.push("Nedostaje ime i prezime.");
  if (!provjeriOib(polja?.oib)) g.push("OIB radnika nije ispravan (11 znamenki s ispravnom kontrolnom znamenkom).");
  if (!JE_DATUM.test(String(polja?.datumRodjenja || ""))) g.push("Nedostaje datum rođenja.");
  if (!String(polja?.posloviNaziv || "").trim()) g.push("Nedostaje radno mjesto (poslovi za koje se utvrđuje sposobnost).");
  if (!JE_DATUM.test(String(datum || ""))) g.push("Nedostaje datum uputnice.");
  return g;
};

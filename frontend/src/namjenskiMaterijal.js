// Namjenski materijal (od 25.11.2026): materijal naručen ZA PROJEKT ide na projekt već pri zaprimanju — "Primi robu" za stavku s
// projektom odmah radi izdatnicu na taj projekt (po cijeni s narudžbenice), pa trošak projekta više ne ovisi o tome je li netko kasnije
// izdao materijal. Na slobodnom stanju skladišta ostaje samo materijal naručen za skladište. Višak skladištar vraća povratom izdatnice.
// Svaka stavka upita i narudžbenice zato mora imati odredište: projekt ili skladište. Čiste funkcije, testirano u namjenskiMaterijal.test.js.

const zaokruzi = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const EPS = 0.0005;

// Vrijednost u izborniku "Za projekt" kad je izričito odabrano skladište (stavka tada ima zaSkladiste: true i nema projektId).
export const ODREDISTE_SKLADISTE = "__skladiste";

// Odredište stavke: id projekta (namjenski materijal), ODREDISTE_SKLADISTE (izričito za skladište) ili "" (nije odabrano).
export function odredisteStavke(s) {
  if (s?.projektId) return s.projektId;
  if (s?.zaSkladiste) return ODREDISTE_SKLADISTE;
  return "";
}
// Postavlja odredište iz vrijednosti izbornika.
export function postaviOdrediste(s, vrijednost) {
  if (vrijednost === ODREDISTE_SKLADISTE) return { ...s, projektId: null, zaSkladiste: true };
  if (vrijednost) return { ...s, projektId: vrijednost, zaSkladiste: false };
  return { ...s, projektId: null, zaSkladiste: false };
}

// Projekti spomenuti u tekstu ("RN150-43", "Za projekt RN 170-307", "RN 170-321 i RN 170-322", raspon "RN 180-71-74").
const normSifra = (s) => String(s || "").toLowerCase().replace(/^\s*rn\s*/i, "").replace(/\s+/g, "");
export function projektiIzTeksta(tekst, projekti) {
  const poSifri = new Map((projekti || []).map((p) => [normSifra(p.sifra), p]));
  const out = [];
  const dodaj = (p) => { if (p && !out.includes(p)) out.push(p); };
  const re = /(\d{1,3})\s*-\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?/g;
  let m;
  while ((m = re.exec(String(tekst || "")))) {
    const puna = m[3] ? poSifri.get(`${m[1]}-${m[2]}-${m[3]}`) : null;
    if (puna) { dodaj(puna); continue; }
    if (m[3] && Number(m[3]) > Number(m[2]) && Number(m[3]) - Number(m[2]) < 10) {
      for (let k = Number(m[2]); k <= Number(m[3]); k++) dodaj(poSifri.get(`${m[1]}-${k}`));
      continue;
    }
    dodaj(poSifri.get(`${m[1]}-${m[2]}`));
  }
  return out;
}
// Projekt prepoznat iz teksta samo ako je točno jedan (više projekata = treba odluka).
export function prepoznajProjekt(tekst, projekti) {
  const p = projektiIzTeksta(tekst, projekti);
  return p.length === 1 ? p[0] : null;
}

// Odredište stavke upita za narudžbenicu: izričito odabrano; inače projekt iz kojeg je upit nastao; inače JEDAN projekt prepoznat iz
// "Dodatnih zahtjeva". null = nije poznato (narudžbenica se ne smije generirati dok se ne odabere).
export function odredisteIzUpita(stavka, upit, projekti) {
  const o = odredisteStavke(stavka);
  if (o === ODREDISTE_SKLADISTE) return { projektId: null, zaSkladiste: true };
  if (o) return { projektId: o, zaSkladiste: false };
  if (upit?.izvorProjektaId && (projekti || []).some((p) => p.id === upit.izvorProjektaId)) return { projektId: upit.izvorProjektaId, zaSkladiste: false };
  const p = prepoznajProjekt(stavka?.dodatniZahtjevi, projekti);
  return p ? { projektId: p.id, zaSkladiste: false } : null;
}

// Stavke kojima nedostaje odredište (indeksi). Stavke s ručnim nazivom (vijci, usluge) mogu biti "skladište / opći trošak".
export const stavkeBezOdredista = (stavke) => (stavke || []).map((s, i) => (odredisteStavke(s) ? -1 : i)).filter((i) => i >= 0);

// Jedinična cijena (po jedinici materijala) za izdatnicu namjenskog materijala: naručeni iznos (iz upita) / primljena količina;
// inače cijena s retka narudžbenice; inače cijena na skladištu.
export function jedinicnaCijena({ narucenoIznos, kolicina, cijenaRetka, cijenaSkladista }) {
  if (narucenoIznos != null && Number(kolicina) > 0) return Math.round((Number(narucenoIznos) / Number(kolicina)) * 10000) / 10000;
  if (cijenaRetka != null && cijenaRetka !== "" && Number.isFinite(Number(cijenaRetka))) return Number(cijenaRetka);
  return Number(cijenaSkladista) || 0;
}

// Izdatnice pri zaprimanju: po jedna za svaki projekt. stavke = [{ projektId, materijal: {id, sifra, naziv, jm}, kolicina, cijena,
// dimenzije, lotovi: [{ maticniId, broj, kolicina }] }]. Stanje skladišta se NE mijenja (namjenski materijal nije ni ušao na slobodno stanje),
// pa povrat viška kasnije normalno vraća na skladište. brojevi(i) daje broj i-te nove izdatnice (poslužitelj ga ionako provjerava).
export function izdatniceZaprimanja({ narudzbenica, stavke, datum, brojevi, uid }) {
  const poProjektu = new Map();
  (stavke || []).filter((s) => s.projektId && Number(s.kolicina) > EPS).forEach((s) => poProjektu.set(s.projektId, [...(poProjektu.get(s.projektId) || []), s]));
  return [...poProjektu].map(([projektId, ss], i) => ({
    id: uid("izd"), broj: brojevi(i), datum, projektId, izdaoId: null, status: "Izdano",
    izvor: "zaprimanje", narudzbenicaId: narudzbenica.id,
    napomena: `Namjenski materijal — izdano automatski pri zaprimanju narudžbenice ${narudzbenica.broj}${narudzbenica.otpremnicaDobavljaca ? ` (otpremnica ${narudzbenica.otpremnicaDobavljaca})` : ""}.`,
    stavke: ss.map((s) => ({
      id: uid("izds"), materijalId: s.materijal.id, sifra: s.materijal.sifra || "", naziv: s.materijal.naziv || "", jm: s.materijal.jm || "",
      dimenzije: s.dimenzije || "", kolicinaIzdano: zaokruzi(s.kolicina), kolicinaVraceno: null, cijena: Number(s.cijena) || 0,
      matBrojevi: (s.lotovi || []).filter((a) => Number(a.kolicina) > EPS).map((a) => ({ maticniId: a.maticniId, broj: a.broj ?? null, kolicina: zaokruzi(a.kolicina) })),
    })),
  }));
}

// --- Zaprimanje: stvarno isporučena količina (od 27.11.2026) ---
// Pri "Primi robu" upisuje se stvarno isporučeno po stavci. Količine stavke su u jedinici stavke: komadi za komadnu stavku (dužina/lim/komadi),
// inače količina stavke. Na stavci se vodi zbirno: primljeno (jedinica stavke), naProjektu (jedinica stavke, dio koji je otišao na projekt)
// i naSkladiste (jedinica MATERIJALA — koliko je dodano na slobodno stanje; po tome brisanje narudžbenice vraća stanje).
// Manjak: narudžbenica ostaje "Djelomično primljeno" dok ostatak ne stigne. Višak na stavci za projekt: korisnik bira projekt ili skladište.
const KOMADNI_UNOS = ["duzina", "lim", "komadi"];
export const jeKomadnaStavka = (s) => KOMADNI_UNOS.includes(s?.nacinUnosa) && Number(s?.komada) > 0;
export const narucenoStavke = (s) => zaokruzi(jeKomadnaStavka(s) ? Number(s.komada) : Number(s?.kolicina) || 0);
// Stara zaprimljena narudžbenica (status Primljeno, bez polja primljeno) = primljeno sve naručeno.
export const primljenoStavke = (s, status) => (s?.primljeno != null ? zaokruzi(s.primljeno) : status === "Primljeno" ? narucenoStavke(s) : 0);
export const preostaloStavke = (s, status) => Math.max(0, zaokruzi(narucenoStavke(s) - primljenoStavke(s, status)));
// Je li s narudžbenice išta zaprimljeno (stanje, matični brojevi, izdatnice) — za brisanje narudžbenice.
export const imaZaprimanja = (n) => n?.status === "Primljeno" || (n?.stavke || []).some((s) => Number(s.primljeno) > EPS);
// Udio naručenog iznosa stavke koji je trošak projekta: zaprimljeno na projekt / naručeno (višak na projekt > 1).
export function udioNaProjektu(s, status) {
  const nar = narucenoStavke(s);
  if (s?.naProjektu != null) return nar > EPS ? Number(s.naProjektu) / nar : 0;
  if (s?.primljeno != null) return nar > EPS ? Number(s.primljeno) / nar : 0;
  return status === "Primljeno" ? 1 : 0;
}
// Raspodjela isporučene količine stavke { naProjekt, naSkladiste } (jedinica stavke). Stavka za skladište: sve na skladište.
// Stavka za projekt: do preostale naručene količine na projekt; višak prema izboru visak ("projekt" | "skladiste"). null = višak bez izbora.
export function raspodjelaIsporuke({ isporuceno, preostalo, zaProjekt, visak }) {
  const d = Math.max(0, zaokruzi(isporuceno));
  if (!zaProjekt) return { naProjekt: 0, naSkladiste: d };
  const v = zaokruzi(d - Math.max(0, Number(preostalo) || 0));
  if (v <= EPS || visak === "projekt") return { naProjekt: d, naSkladiste: 0 };
  if (visak === "skladiste") return { naProjekt: zaokruzi(d - v), naSkladiste: v };
  return null;
}
// Status nakon zaprimanja: sve stavke primljene barem koliko je naručeno → Primljeno; inače ostatak čeka (Djelomično primljeno).
export const statusNakonZaprimanja = (stavke) => ((stavke || []).every((s) => primljenoStavke(s, "") >= narucenoStavke(s) - EPS) ? "Primljeno" : "Djelomično primljeno");
// Prvih `kolicina` iz matičnih brojeva redom ([{ id, kolicina }]) — dio isporuke koji ide na projekt; ostatak lotova ostaje na stanju.
export function uzmiIzLotova(lotovi, kolicina) {
  let ostalo = zaokruzi(kolicina);
  const out = [];
  (lotovi || []).forEach((l) => {
    if (ostalo <= EPS) return;
    const k = zaokruzi(Math.min(Number(l.kolicina) || 0, ostalo));
    if (k <= EPS) return;
    out.push({ ...l, kolicina: k });
    ostalo = zaokruzi(ostalo - k);
  });
  return out;
}

// Ručne stavke narudžbenice s projektom (vijci, usluge, drvo… — ne idu na skladište) kao trošak projekta od dana zaprimanja.
// cijeneStavki(n) vraća naručene iznose po stavkama (naruceneCijeneNarudzbenice u aplikaciji). Djelomično primljeno: trošak razmjerno
// zaprimljenom na projekt (udioNaProjektu).
export function troskoviRucnihStavki(narudzbenice, projektId, cijeneStavki) {
  const out = [];
  (narudzbenice || []).filter((n) => n.status === "Primljeno" || n.status === "Djelomično primljeno").forEach((n) => {
    const stavke = n.stavke || [];
    if (!stavke.some((s) => s.projektId === projektId && !s.materijalId && !s.katalogId)) return;
    const nc = cijeneStavki(n) || [];
    stavke.forEach((s, i) => {
      if (s.projektId !== projektId || s.materijalId || s.katalogId) return;
      const iznos = (nc[i]?.iznos != null ? Number(nc[i].iznos) : (Number(s.cijenaPoJed) || 0) * (Number(s.kolicina) || 0)) * udioNaProjektu(s, n.status);
      if (!(iznos > 0)) return;
      out.push({ id: `nar-${n.id}-${i}`, datum: n.zaprimljeno || n.datum, dobavljacId: n.dobavljacId || null, opis: `${s.rucniNaziv || "Stavka"} (${n.broj})`, iznos: Math.round(iznos * 100) / 100, izNarudzbenice: true });
    });
  });
  return out;
}

// --- Programi rezanja (laser) ---
// Koliko materijala je projekt već dobio kao namjenski (izdatnice koje NISU nastale iz programa rezanja), a još ga nije "potrošio" neki
// drugi program tog projekta. nalogProjekt: Map radniNalogId → projektId. izuzmiStavkuId: stavka programa koja se upravo računa.
export function namjenskoRaspolozivo({ izdatnice, programi, nalogProjekt, projektId, materijalId, izuzmiStavkuId = null }) {
  if (!projektId || !materijalId) return 0;
  let izdano = 0;
  (izdatnice || []).forEach((iz) => {
    if (iz.projektId !== projektId || iz.izvor === "program") return;
    (iz.stavke || []).forEach((st) => { if (st.materijalId === materijalId) izdano += (Number(st.kolicinaIzdano) || 0) - (Number(st.kolicinaVraceno) || 0); });
  });
  let potroseno = 0;
  (programi || []).forEach((p) => {
    if (nalogProjekt.get(p.radniNalogId) !== projektId) return;
    (p.stavkeMaterijala || []).forEach((s) => {
      if (s.id === izuzmiStavkuId || s.materijalId !== materijalId) return;
      const iz = Number(s.izNamjenskog) || 0;
      potroseno += s.finalizirano ? Math.min(iz, Number(s.stvarnoKolicina) || 0) : iz;
    });
  });
  return Math.max(0, zaokruzi(izdano - potroseno));
}
// Planirana količina programa: dio iz namjenskog materijala projekta (stanje se ne dira) i dio sa slobodnog stanja (skida se odmah).
export function planProgramaMaterijala(planirano, raspolozivoNamjensko) {
  const p = Math.max(0, Number(planirano) || 0);
  const izNamjenskog = zaokruzi(Math.min(p, Math.max(0, Number(raspolozivoNamjensko) || 0)));
  return { izNamjenskog, saStanja: zaokruzi(p - izNamjenskog) };
}
// Unos stvarno utrošenog: namjenski dio se troši prvi; ostatak je sa slobodnog stanja → izdatnica na projekt (trošak). promjenaStanja > 0
// vraća neiskorišteno sa stanja natrag, < 0 skida dodatno.
export function finalizacijaPrograma({ planirano, izNamjenskog = 0, stvarno }) {
  const st = Math.max(0, Number(stvarno) || 0);
  const iz = Math.max(0, Number(izNamjenskog) || 0);
  const uzetoNamjensko = zaokruzi(Math.min(iz, st));
  const saStanja = zaokruzi(st - uzetoNamjensko);
  const vecSkinuto = zaokruzi((Number(planirano) || 0) - iz);
  return { uzetoNamjensko, saStanja, promjenaStanja: zaokruzi(vecSkinuto - saStanja) };
}

// --- Ručno smanjenje stanja na skladištu: uvijek s razlogom ---
export const RAZLOZI_SMANJENJA = [
  { key: "projekt", naziv: "Utrošeno na projekt (ide u trošak projekta)" },
  { key: "inventura", naziv: "Inventurni manjak" },
  { key: "otpis", naziv: "Otpis / škart" },
  { key: "greska", naziv: "Ispravak pogrešnog unosa" },
];
export function zapisKorekcije({ staro, novo, razlog, projektId = null, napomena = "", zaposlenikId = null, datum }) {
  return { datum, staro: zaokruzi(staro), novo: zaokruzi(novo), razlika: zaokruzi(novo - staro), razlog, ...(projektId ? { projektId } : {}), ...(napomena ? { napomena } : {}), zaposlenikId };
}

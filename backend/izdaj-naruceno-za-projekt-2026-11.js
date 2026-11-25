// Jednokratno (25.11.2026): materijal naručen ZA PROJEKT, zaprimljen na skladište, a nikad izdan na taj projekt, izdaje se izdatnicom.
// Projekt se uzima sa stavke narudžbenice (projektId) ili — kod narudžbenica iz upita nabave — iz teksta stavke upita
// ("Dodatni zahtjevi", npr. "RN150-43", "Za projekt RN 170-307") odnosno iz upita kreiranog iz projekta (izvorProjektaId).
//
// Pravila:
// - Zahtjev = (projekt, materijal, narudžbenica, količina) zaprimljene stavke koja ima matični broj. Stavke bez skladišta (ručni naziv) i
//   narudžbenice "Primljeno" bez zaprimanja (nema matičnog broja) se preskaču.
// - Već pokriveno: izdatnice tog projekta za taj materijal i laserski programi rezanja (preko radnog naloga projekta) — troše se na
//   zahtjeve od najstarijeg zaprimanja.
// - Trenutno stanje materijala raspodjeljuje se na preostale zahtjeve od NAJNOVIJEG zaprimanja: taj dio se skida sa stanja; ostatak je
//   ranije već skinut sa stanja bez izdatnice (ručna ispravka stanja) pa se izdaje SAMO KAO TROŠAK (stanje se ne mijenja).
// - Aktivni projekti: "naknadno izdano"; Arhiviran/Završen/Otkazan: "naknadno izdano (utrošeno)". Zahtjev za više projekata ide prvom
//   projektu (napomena navodi sve) — osim ako je među njima aktivan projekt: tada se preskače (treba odluka kojem).
// - Matični brojevi: najprije lotovi s narudžbenice zahtjeva, zatim ostali lotovi materijala (FIFO); izdaje se najviše koliko pokrivaju lotovi.
// - Materijal s više dužina/formata gubi sa popisa dimenzija samo komade koji se stvarno skidaju sa stanja.
//
// Pokretanje (mapa backend):
//   node izdaj-naruceno-za-projekt-2026-11.js                         — samo ispis (živa baza, ništa se ne sprema)
//   node izdaj-naruceno-za-projekt-2026-11.js --datoteka=<kopija.json> — samo ispis iz lokalne kopije (bez baze)
//   node izdaj-naruceno-za-projekt-2026-11.js provedi                 — sprema (uz snimku prije izmjene u ERP-Backupovi)
const fs = require("fs");
const path = require("path");
const { redoviIzDimenzija, kljucFormata, kljucFormataIzTeksta, potrosnjaPoMaticnim, preostaloMaticnog, sljedeciBroj, opisDuzine } = require("./izdaj-zaostale-rezervacije-2026-11");

const EPS = 0.0005;
const zaokruzi = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const prirodno = (a, b) => String(a).localeCompare(String(b), "hr", { numeric: true });
const ZATVORENI = new Set(["Arhiviran", "Otkazan", "Završen"]);
// Ručno utvrđene iznimke (25.11.): U 50x25 za RN 170-319 izdan je 12.10. na RN 170-318 (IZD-2026-006).
const PRESKOCI = [{ projekt: "RN 170-319", sifra: "10011201", razlog: "izdano na RN 170-318 (IZD-2026-006)" }];

const norm = (s) => String(s || "").toLowerCase().replace(/^\s*rn\s*/i, "").replace(/\s+/g, "");
function projektiIzTeksta(tekst, poSifri) {
  const out = [];
  const re = /(\d{1,3})\s*-\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?/g;
  let m;
  while ((m = re.exec(String(tekst || "")))) {
    const puna = m[3] ? poSifri.get(`${m[1]}-${m[2]}-${m[3]}`) : null;
    if (puna) { if (!out.includes(puna)) out.push(puna); continue; }
    if (m[3] && Number(m[3]) > Number(m[2]) && Number(m[3]) - Number(m[2]) < 10) { // raspon "180-71-74"
      for (let k = Number(m[2]); k <= Number(m[3]); k++) { const x = poSifri.get(`${m[1]}-${k}`); if (x && !out.includes(x)) out.push(x); }
      continue;
    }
    const x = poSifri.get(`${m[1]}-${m[2]}`);
    if (x && !out.includes(x)) out.push(x);
  }
  return out;
}
const kolicinaStavke = (s, m) => {
  const komadna = ["duzina", "lim", "komadi"].includes(s.nacinUnosa);
  if (m?.jm === "kom" && (komadna || !s.nacinUnosa)) return Number(komadna ? s.komada : (s.komada ?? s.kolicina)) || Number(s.kolicina) || 0;
  if (s.nacinUnosa === "duzina" && m?.kgPoM > 0) return (Number(s.duzinaM) || 0) * (Number(s.komada) || 0) * m.kgPoM;
  if (s.nacinUnosa === "lim" && m?.kgPoM2 > 0) return (Number(s.duzinaM) || 0) * (Number(s.sirinaM) || 0) * (Number(s.komada) || 0) * m.kgPoM2;
  if (s.nacinUnosa === "komadi" && m?.kgPoKom > 0) return (Number(s.komada) || 0) * m.kgPoKom;
  return Number(s.kolicina) || 0;
};

// Čista funkcija. stanje: { projekti, materijali, izdatnice, rezervacije, maticnaKnjiga, narudzbenice, upitiNabave, programiRezanja, radniNalozi }.
// Vraća { materijali, izdatnice, rezervacije, izvjestaj: [{ projekt, broj, zatvoren, stavke, upozorenja }], preskoceno: [...] } — ulaz se ne mijenja.
function izdajNarucenoZaProjekt(stanje, { danas, preskoci = PRESKOCI }) {
  const projekti = stanje.projekti || [];
  const projById = new Map(projekti.map((p) => [p.id, p]));
  const poSifri = new Map(projekti.map((p) => [norm(p.sifra), p]));
  const upiti = new Map((stanje.upitiNabave || []).map((u) => [u.id, u]));
  const naloziProjekt = new Map((stanje.radniNalozi || []).map((n) => [n.id, n.projektId]));
  const knjiga = stanje.maticnaKnjiga || [];
  let materijali = stanje.materijali.map((m) => ({ ...m }));
  const matById = () => new Map(materijali.map((m) => [m.id, m]));
  const rezervacije = (stanje.rezervacije || []).map((r) => ({ ...r }));
  const izdatnice = [...(stanje.izdatnice || [])];
  const preskoceno = [];

  // 1) zahtjevi
  const mapa = matById();
  const zahtjevi = new Map();
  for (const n of stanje.narudzbenice || []) {
    if (n.status !== "Primljeno") continue;
    const u = upiti.get(n.izvorUpitaId);
    (n.stavke || []).forEach((s, i) => {
      let proj = []; let izvor = "";
      if (s.projektId) { proj = [projById.get(s.projektId)].filter(Boolean); izvor = "projekt na stavci"; }
      else {
        const su = n.stavkeUpita && n.stavkeUpita.length === (n.stavke || []).length ? n.stavkeUpita[i] : null;
        proj = projektiIzTeksta(su?.dodatniZahtjevi, poSifri);
        if (proj.length) izvor = `upit ${u?.broj || "?"}: "${String(su.dodatniZahtjevi).trim()}"`;
        else if (u?.izvorProjektaId && projById.get(u.izvorProjektaId)) { proj = [projById.get(u.izvorProjektaId)]; izvor = `upit ${u.broj} iz projekta`; }
      }
      if (!proj.length || !s.materijalId) return;
      const m = mapa.get(s.materijalId);
      if (!m) return;
      if (!knjiga.some((z) => z.narudzbenicaId === n.id && z.materijalId === s.materijalId)) return; // nije zaprimljeno kroz "Primi robu"
      const kljuc = `${proj.map((p) => p.id).join("+")}|${s.materijalId}|${n.id}`;
      const z = zahtjevi.get(kljuc) || { proj, mid: s.materijalId, narId: n.id, nar: n.broj, datum: n.zaprimljeno || n.datum || "", izvor, kol: 0 };
      z.kol = zaokruzi(z.kol + kolicinaStavke(s, m));
      zahtjevi.set(kljuc, z);
    });
  }
  const zah = [...zahtjevi.values()];

  // 2) već pokriveno izdatnicama i programima rezanja (od najstarijeg zahtjeva)
  const pokriveno = new Map();
  const dodaj = (pid, mid, kol) => { if (!pid) return; const k = `${pid}|${mid}`; pokriveno.set(k, zaokruzi((pokriveno.get(k) || 0) + kol)); };
  for (const iz of izdatnice) for (const s of iz.stavke || []) dodaj(iz.projektId, s.materijalId, (Number(s.kolicinaIzdano) || 0) - (Number(s.kolicinaVraceno) || 0));
  for (const pr of stanje.programiRezanja || []) for (const s of pr.stavkeMaterijala || []) dodaj(naloziProjekt.get(pr.radniNalogId), s.materijalId, s.finalizirano ? Number(s.stvarnoKolicina) || 0 : Number(s.planiranoKolicina) || 0);
  for (const z of [...zah].sort((a, b) => a.datum.localeCompare(b.datum) || prirodno(a.nar, b.nar))) {
    let ost = z.kol;
    for (const p of z.proj) {
      const k = `${p.id}|${z.mid}`;
      const uzmi = Math.min(pokriveno.get(k) || 0, ost);
      if (uzmi > EPS) { pokriveno.set(k, zaokruzi(pokriveno.get(k) - uzmi)); ost = zaokruzi(ost - uzmi); }
    }
    z.ostalo = ost;
  }
  // 3) iznimke i zahtjevi za više projekata
  const otvoreni = [];
  for (const z of zah.filter((x) => x.ostalo > EPS)) {
    const m = mapa.get(z.mid);
    const izn = preskoci.find((p) => z.proj.some((x) => x.sifra === p.projekt) && m.sifra === p.sifra);
    if (izn) { preskoceno.push({ ...z, razlog: izn.razlog }); continue; }
    if (z.proj.length > 1 && z.proj.some((p) => !ZATVORENI.has(p.status))) { preskoceno.push({ ...z, razlog: `naručeno za više projekata (${z.proj.map((p) => p.sifra).join(", ")}) — treba odluka kojem` }); continue; }
    otvoreni.push(z);
  }
  // 4) trenutno stanje na zahtjeve od najnovijeg zaprimanja
  const poMat = new Map();
  for (const z of otvoreni) poMat.set(z.mid, [...(poMat.get(z.mid) || []), z]);
  for (const [mid, arr] of poMat) {
    let st = Math.max(0, Number(mapa.get(mid).kolicina) || 0);
    arr.sort((a, b) => b.datum.localeCompare(a.datum) || prirodno(b.nar, a.nar));
    for (const z of arr) { z.naStanju = zaokruzi(Math.min(st, z.ostalo)); st = zaokruzi(st - z.naStanju); }
  }

  // 5) matični brojevi: najprije SVAKI zahtjev dobiva lotove sa svoje narudžbenice, tek onda se manjak puni ostalim lotovima (FIFO, stariji
  //    zahtjevi prvi) — inače bi jedan projekt pojeo lotove drugoga. Izdaje se cijela neizdana količina; dio bez matičnog broja se javlja.
  const potrosnja = potrosnjaPoMaticnim(izdatnice);
  const lotoviMat = new Map();
  const lotovi = (mid) => { if (!lotoviMat.has(mid)) lotoviMat.set(mid, knjiga.filter((x) => x.materijalId === mid).sort((a, b) => (Number(a.broj) || 0) - (Number(b.broj) || 0))); return lotoviMat.get(mid); };
  const uzmiIzLota = (z, lot) => {
    const uzmi = Math.min(preostaloMaticnog(lot, potrosnja), z.nedostaje);
    if (uzmi <= EPS) return;
    potrosnja.set(lot.id, (potrosnja.get(lot.id) || 0) + uzmi);
    z.alok.push({ maticniId: lot.id, broj: lot.broj, kolicina: zaokruzi(uzmi) });
    z.nedostaje = zaokruzi(z.nedostaje - uzmi);
  };
  for (const z of otvoreni) { z.alok = []; z.nedostaje = z.ostalo; lotovi(z.mid).filter((x) => x.narudzbenicaId === z.narId).forEach((lot) => uzmiIzLota(z, lot)); }
  for (const z of [...otvoreni].sort((a, b) => a.datum.localeCompare(b.datum) || prirodno(a.nar, b.nar))) lotovi(z.mid).forEach((lot) => { if (z.nedostaje > EPS) uzmiIzLota(z, lot); });

  // 6) izdatnice po projektu (zahtjev za više zatvorenih projekata → prvi)
  const prefiks = `IZD-${String(danas).slice(0, 4)}-`;
  const poProjektu = new Map();
  for (const z of otvoreni) { const p = z.proj[0]; poProjektu.set(p.id, [...(poProjektu.get(p.id) || []), z]); }
  const izvjestaj = [];
  for (const [pid, zz] of [...poProjektu].sort((a, b) => (ZATVORENI.has(projById.get(a[0]).status) - ZATVORENI.has(projById.get(b[0]).status)) || prirodno(projById.get(a[0]).sifra, projById.get(b[0]).sifra))) {
    const p = projById.get(pid);
    const zatvoren = ZATVORENI.has(p.status);
    const stavke = [];
    const upozorenja = [];
    const samoTrosak = [];
    const poMaterijalu = new Map();
    zz.forEach((z) => poMaterijalu.set(z.mid, [...(poMaterijalu.get(z.mid) || []), z]));
    for (const [mid, lista] of poMaterijalu) {
      const mat = materijali.find((m) => m.id === mid);
      const ime = `${mat.sifra || ""} ${mat.naziv}`.trim();
      const matBrojevi = [];
      const zaFormat = []; // dijelovi lotova koji se skidaju sa stanja: { maticniId, kolicina }
      let ukupno = 0; let saStanja = 0; let bezMaticnog = 0;
      for (const z of lista) {
        // dio zahtjeva koji je još na stanju skida se sa stanja (format = dimenzija prvih dodijeljenih lotova)
        let stanjeDio = Math.min(z.naStanju, Math.max(0, zaokruzi((Number(mat.kolicina) || 0) - saStanja)));
        saStanja = zaokruzi(saStanja + stanjeDio);
        for (const a of z.alok) {
          const postojeci = matBrojevi.find((x) => x.maticniId === a.maticniId);
          if (postojeci) postojeci.kolicina = zaokruzi(postojeci.kolicina + a.kolicina); else matBrojevi.push({ ...a });
          const fDio = Math.min(a.kolicina, stanjeDio);
          if (fDio > EPS) { zaFormat.push({ maticniId: a.maticniId, kolicina: zaokruzi(fDio) }); stanjeDio = zaokruzi(stanjeDio - fDio); }
        }
        if (stanjeDio > EPS) zaFormat.push({ maticniId: null, kolicina: stanjeDio }); // na stanju, ali bez matičnog broja — format nepoznat
        if (z.nedostaje > EPS) { bezMaticnog = zaokruzi(bezMaticnog + z.nedostaje); upozorenja.push(`${ime} (${z.nar}): ${z.nedostaje} od ${z.ostalo} nema slobodnog matičnog broja — izdaje se bez njega.`); }
        ukupno = zaokruzi(ukupno + z.ostalo);
      }
      if (!(ukupno > EPS)) continue;
      const trosakBezStanja = zaokruzi(ukupno - saStanja);
      if (trosakBezStanja > EPS) samoTrosak.push(`${mat.naziv} ${trosakBezStanja} ${mat.jm}`);
      // formati: samo komadi koji se skidaju sa stanja
      const jeLim = /\d\s*[×x]\s*\d+(?:[.,]\d+)?\s*mm/.test(mat.dimenzije || "");
      const redovi = mat.jm === "kom" && saStanja > EPS ? redoviIzDimenzija(mat.dimenzije, mat.kolicina, jeLim) : null;
      let novaDimenzije = mat.dimenzije;
      let izdanoRedovi = null;
      if (redovi && redovi.length > 1) {
        const tekuci = redovi.map((r) => ({ ...r, komada: Number(r.komada) || 0 }));
        const izd = new Map();
        let uspjeh = true;
        for (const a of zaFormat) {
          const lot = knjiga.find((x) => x.id === a.maticniId);
          const kljuc = kljucFormataIzTeksta(lot?.dimenzije);
          let ost = a.kolicina;
          if (kljuc) {
            for (const r of tekuci) {
              if (ost <= EPS) break;
              if (kljucFormata(r.duzinaMM, r.sirinaMM) !== kljuc || r.komada <= EPS) continue;
              const uzmi = Math.min(r.komada, ost);
              r.komada = zaokruzi(r.komada - uzmi); ost = zaokruzi(ost - uzmi);
              const kk = `${r.duzinaMM}|${r.sirinaMM}`;
              izd.set(kk, { duzinaMM: Number(r.duzinaMM), sirinaMM: r.sirinaMM ? Number(r.sirinaMM) : null, komada: zaokruzi((izd.get(kk)?.komada || 0) + uzmi) });
            }
          }
          if (ost > EPS) uspjeh = false;
        }
        if (uspjeh) {
          // stanje ide na 0, a popis je imao više komada nego stanja (npr. program rezanja skinuo stanje bez popisa) — popis se prazni
          const nakon = zaokruzi((Number(mat.kolicina) || 0) - saStanja) <= EPS ? [] : tekuci.filter((r) => r.komada > EPS);
          novaDimenzije = nakon.map((r) => `${opisDuzine(r)}${nakon.length > 1 ? ` × ${r.komada}` : ""}`).join("; ");
          izdanoRedovi = [...izd.values()];
        } else if (zaokruzi((Number(mat.kolicina) || 0) - saStanja) <= EPS) {
          novaDimenzije = ""; // izdano je cijelo stanje — popis formata ostaje prazan (kao kad se sve izda po formatima)
        } else upozorenja.push(`${ime}: format izdanih komada nije pronađen u popisu dimenzija (“${mat.dimenzije}”) — dimenzije nisu mijenjane, provjeri ručno.`);
      } else if (redovi && redovi.length === 1 && zaokruzi((Number(mat.kolicina) || 0) - saStanja) <= EPS && /×\s*\d+(?:[.,]\d+)?\s*$/.test(mat.dimenzije || "")) {
        novaDimenzije = opisDuzine(redovi[0]); // jedan format s brojem komada, a stanje ide na 0 — ostaje samo format
      }
      stavke.push({
        id: uid("izds"), materijalId: mat.id, sifra: mat.sifra, naziv: mat.naziv, jm: mat.jm,
        dimenzije: izdanoRedovi ? izdanoRedovi.map((r) => `${opisDuzine(r)} × ${r.komada}`).join("; ") : (mat.dimenzije || ""),
        ...(izdanoRedovi ? { izdanoRedovi } : {}),
        kolicinaIzdano: ukupno, kolicinaVraceno: null, cijena: Number(mat.cijena) || 0, matBrojevi,
        ...(trosakBezStanja > EPS ? { bezSkidanjaStanja: trosakBezStanja } : {}),
        _narudzbenice: [...new Set(lista.map((z) => z.nar))], _izvor: [...new Set(lista.map((z) => z.izvor))], _projekti: lista[0].proj.map((x) => x.sifra),
      });
      materijali = materijali.map((m) => (m.id === mat.id ? { ...m, kolicina: zaokruzi(m.kolicina - saStanja), dimenzije: novaDimenzije } : m));
      // rezervacije projekta za taj materijal (ako postoje) troše se izdanim
      let zaSkinuti = ukupno;
      for (const r of rezervacije.filter((x) => x.projektId === pid && x.materijalId === mid)) {
        if (zaSkinuti <= EPS) break;
        const uzmi = Math.min(Number(r.kolicina), zaSkinuti);
        r.kolicina = zaokruzi(r.kolicina - uzmi); zaSkinuti = zaokruzi(zaSkinuti - uzmi);
      }
    }
    let broj = null;
    if (stavke.length) {
      broj = sljedeciBroj(izdatnice, prefiks);
      const narudzbenice = [...new Set(stavke.flatMap((s) => s._narudzbenice))].sort(prirodno).join(", ");
      const vise = [...new Set(stavke.filter((s) => s._projekti.length > 1).map((s) => s._projekti.join(" i ")))];
      const napomena = [
        `Naknadno izdano ${danas}: materijal naručen za projekt (${narudzbenice}), zaprimljen, a nije bio izdan${zatvoren ? " — projekt zatvoren, utrošeno" : ""}.`,
        vise.length ? `Naručeno za ${vise.join("; ")} — izdano na ovaj projekt.` : "",
        samoTrosak.length ? `Samo trošak (ranije već skinuto sa stanja bez izdatnice, stanje se ne mijenja): ${samoTrosak.join(", ")}.` : "",
      ].filter(Boolean).join(" ");
      izdatnice.push({
        id: uid("izd"), broj, datum: danas, projektId: p.id, izdaoId: null, status: "Izdano",
        stavke: stavke.map(({ _narudzbenice, _izvor, _projekti, ...s }) => s), napomena,
      });
    }
    izvjestaj.push({ projekt: p, broj, zatvoren, stavke, upozorenja });
  }
  return { materijali, izdatnice, rezervacije: rezervacije.filter((r) => Number(r.kolicina) > EPS), izvjestaj, preskoceno };
}
module.exports = { izdajNarucenoZaProjekt, projektiIzTeksta };

const ispisi = (stanje, r) => {
  for (const i of r.izvjestaj) {
    console.log(`\n== ${i.projekt.sifra} ${i.projekt.naziv.trim()} [${i.projekt.status}] → ${i.broj || "(ništa za izdati)"}`);
    i.stavke.forEach((s) => console.log(`   ${String(s.sifra).padEnd(9)} ${String(s.naziv).padEnd(34)} ${String(s.kolicinaIzdano).padStart(5)} ${s.jm}${s.bezSkidanjaStanja ? ` (od toga samo trošak ${s.bezSkidanjaStanja})` : ""}  ≈${Math.round(s.kolicinaIzdano * s.cijena)} €  mat.br.: ${s.matBrojevi.map((a) => `${a.broj}×${a.kolicina}`).join(", ")}  [${s._narudzbenice.join(", ")}]${s.izdanoRedovi ? `  {${s.dimenzije}}` : ""}`));
    i.upozorenja.forEach((u) => console.log(`   ! ${u}`));
  }
  console.log("\nPreskočeno:");
  r.preskoceno.forEach((z) => console.log(`   ${z.proj.map((p) => p.sifra).join("+")} | ${z.nar} | ${(stanje.materijali.find((m) => m.id === z.mid) || {}).naziv} ${z.ostalo} — ${z.razlog}`));
  const nove = r.izdatnice.slice(stanje.izdatnice.length);
  console.log(`\nNove izdatnice: ${nove.length} (${nove.map((i) => i.broj).join(", ")}). Stavki: ${nove.reduce((a, i) => a + i.stavke.length, 0)}. Rezervacije: ${(stanje.rezervacije || []).length} → ${r.rezervacije.length}.`);
  const promjene = r.materijali.filter((m) => { const s = stanje.materijali.find((x) => x.id === m.id); return s && (s.kolicina !== m.kolicina || s.dimenzije !== m.dimenzije); });
  promjene.forEach((m) => { const s = stanje.materijali.find((x) => x.id === m.id); console.log(`   stanje ${String(m.sifra).padEnd(9)} ${String(m.naziv).padEnd(34)} ${s.kolicina} → ${m.kolicina}${s.dimenzije !== m.dimenzije ? `   dimenzije: “${s.dimenzije}” → “${m.dimenzije}”` : ""}`); });
  if (r.materijali.some((m) => Number(m.kolicina) < -EPS && (stanje.materijali.find((x) => x.id === m.id)?.kolicina ?? 0) >= 0)) throw new Error("Neko stanje bi postalo negativno — prekid.");
  if (r.materijali.length !== stanje.materijali.length) throw new Error("Broj materijala se ne poklapa — prekid.");
};

if (require.main === module) {
  const arg = (naziv) => { const a = process.argv.find((x) => x.startsWith(`--${naziv}=`)); return a ? a.slice(naziv.length + 3) : ""; };
  const danas = new Date().toISOString().slice(0, 10);
  const KLJUCEVI = ["materijali", "izdatnice", "rezervacije", "projekti", "maticnaKnjiga", "narudzbenice", "upitiNabave", "programiRezanja", "radniNalozi"];
  if (arg("datoteka")) {
    const p = JSON.parse(fs.readFileSync(arg("datoteka"), "utf8")).podaci;
    const stanje = Object.fromEntries(KLJUCEVI.map((k) => [k, p[k] || []]));
    ispisi(stanje, izdajNarucenoZaProjekt(stanje, { danas }));
    console.log("(lokalna kopija — ništa nije spremljeno)");
  } else {
    require("dotenv").config({ path: path.join(__dirname, ".env") });
    const { Pool } = require("pg");
    const provedi = process.argv.includes("provedi");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined });
    (async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const citaj = async (k, zakljucaj) => (await c.query(`SELECT value FROM app_data WHERE key=$1${zakljucaj ? " FOR UPDATE" : ""}`, [k])).rows[0]?.value || [];
        const stanje = {};
        for (const k of KLJUCEVI) stanje[k] = await citaj(k, ["materijali", "izdatnice", "rezervacije"].includes(k));
        const r = izdajNarucenoZaProjekt(stanje, { danas });
        ispisi(stanje, r);
        if (provedi) {
          const mapa = path.join(__dirname, "..", "..", "ERP-Backupovi");
          fs.mkdirSync(mapa, { recursive: true });
          const snimka = path.join(mapa, `naruceno-za-projekt-prije-izdavanja-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
          fs.writeFileSync(snimka, JSON.stringify({ materijali: stanje.materijali, izdatnice: stanje.izdatnice, rezervacije: stanje.rezervacije }));
          const provjera = JSON.parse(fs.readFileSync(snimka, "utf8"));
          if (provjera.materijali.length !== stanje.materijali.length || provjera.izdatnice.length !== stanje.izdatnice.length || provjera.rezervacije.length !== stanje.rezervacije.length) throw new Error("Snimka nije ispravna — prekid.");
          for (const [k, v] of [["materijali", r.materijali], ["izdatnice", r.izdatnice], ["rezervacije", r.rezervacije]]) await c.query("UPDATE app_data SET value=$1, updated_at=now() WHERE key=$2", [JSON.stringify(v), k]);
          await c.query("COMMIT");
          console.log(`Spremljeno. Snimka prije izmjene: ${snimka}`);
        } else { await c.query("ROLLBACK"); console.log("(samo pregled — ništa nije spremljeno)"); }
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("GREŠKA:", e.message); process.exitCode = 1; } finally { c.release(); await pool.end(); }
    })();
  }
}

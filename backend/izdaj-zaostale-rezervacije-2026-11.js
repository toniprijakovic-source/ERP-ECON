// Jednokratno (19.11.2026): rezervirani, a nikad izdani materijal ARHIVIRANIH projekata izdaje se izdatnicom ("utrošeno").
// Isto što radi gumb "Izdaj (utrošeno)" u Skladište → Izdatnice → Za izdavanje, samo za više projekata odjednom, uz snimku prije izmjene.
//
// Pravila (iste posljedice kao izdatnica u aplikaciji): stanje materijala se umanjuje, rezervacija se troši, izdatnica na stavci pamti
// matične brojeve (najprije lotovi s narudžbenice na kojoj je rezervacija nastala, FIFO unutar njih), a materijal s više dužina/formata
// gubi izdane komade iz popisa dimenzija (format se prepoznaje po dimenziji matičnog broja).
// ZAŠTITA: izdaje se samo količina pokrivena matičnim brojevima (preostalo u lotovima) — višak (npr. rezervacije udvostručene dvostrukim
// zaprimanjem) se NE izdaje, rezervacija ostaje, a razlika se ispisuje u izvještaju.
//
// Pokretanje (mapa backend):
//   node izdaj-zaostale-rezervacije-2026-11.js --projekti="RN 170-324,RN 170-325"          — samo ispis (ništa se ne sprema)
//   node izdaj-zaostale-rezervacije-2026-11.js --projekti="..." provedi                      — sprema (uz snimku prije izmjene)
// Radi u jednoj transakciji na zaključanim zapisima materijali, izdatnice i rezervacije. Projekti moraju biti navedeni izričito i Arhiviran.
const fs = require("fs");
const path = require("path");

const EPS = 0.0005;
const zaokruzi = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const prirodno = (a, b) => String(a).localeCompare(String(b), "hr", { numeric: true });

// --- iste pomoćne funkcije kao u frontend/src/App.jsx (redoviIzDimenzija, kljucFormata*, netoPoMaticnim, preostaloMaticnog) ---
const redoviIzDimenzija = (dimenzije, kolicina, jeLim) => {
  const dijelovi = String(dimenzije || "").split(";").map((x) => x.trim()).filter(Boolean);
  if (!dijelovi.length) return null;
  const redovi = [];
  for (const d of dijelovi) {
    const m = d.match(/^(\d+(?:[.,]\d+)?)(?:\s*×\s*(\d+(?:[.,]\d+)?))?\s*mm(?:\s*×\s*(\d+(?:[.,]\d+)?))?$/);
    if (!m || (jeLim && !m[2]) || (!jeLim && m[2])) return null;
    redovi.push({ duzinaMM: m[1].replace(",", "."), sirinaMM: m[2] ? m[2].replace(",", ".") : "", komada: m[3] ? m[3].replace(",", ".") : null });
  }
  const poznato = redovi.reduce((a, r) => a + (r.komada != null ? Number(r.komada) : 0), 0);
  const nepoznati = redovi.filter((r) => r.komada == null);
  nepoznati.forEach((r) => { r.komada = nepoznati.length === 1 ? String(Math.max(0, Math.round(((Number(kolicina) || 0) - poznato) * 1000) / 1000)) : "1"; });
  return redovi;
};
const kljucFormata = (duzina, sirina) => {
  const d = Number(String(duzina ?? "").replace(",", ".")) || 0, s = Number(String(sirina ?? "").replace(",", ".")) || 0;
  return s ? `${Math.max(d, s)}x${Math.min(d, s)}` : d ? `${d}` : "";
};
const kljucFormataIzTeksta = (tekst) => { const m = String(tekst || "").match(/(\d+(?:[.,]\d+)?)(?:\s*[×x]\s*(\d+(?:[.,]\d+)?))?\s*mm/i); return m ? kljucFormata(m[1], m[2]) : ""; };
const netoPoMaticnim = (st) => {
  const alok = (st.matBrojevi || []).map((a) => ({ ...a }));
  let vraceno = Number(st.kolicinaVraceno) || 0;
  for (let i = alok.length - 1; i >= 0 && vraceno > 0; i--) {
    const v = Math.min(alok[i].kolicina, vraceno);
    alok[i].kolicina = zaokruzi(alok[i].kolicina - v);
    vraceno -= v;
  }
  return alok.filter((a) => a.kolicina > EPS);
};
const potrosnjaPoMaticnim = (izdatnice) => {
  const m = new Map();
  (izdatnice || []).forEach((i) => (i.stavke || []).forEach((st) => netoPoMaticnim(st).forEach((a) => { if (a.maticniId) m.set(a.maticniId, (m.get(a.maticniId) || 0) + a.kolicina); })));
  return m;
};
const preostaloMaticnog = (z, potrosnja) => zaokruzi((Number(z.kolicinaPrimljeno) || 0) - (potrosnja.get(z.id) || 0));
const sljedeciBroj = (lista, prefiks, sirina = 3) => {
  const brojevi = (lista || []).map((x) => x?.broj).filter((b) => b && b.startsWith(prefiks)).map((b) => parseInt(b.slice(prefiks.length), 10)).filter((n) => !isNaN(n));
  return `${prefiks}${String((brojevi.length ? Math.max(...brojevi) : 0) + 1).padStart(sirina, "0")}`;
};
const opisDuzine = (r) => `${r.sirinaMM ? `${r.duzinaMM}×${r.sirinaMM}` : r.duzinaMM} mm`;

// Čista funkcija (testira se bez baze). stanje: { projekti, rezervacije, materijali, izdatnice, maticnaKnjiga }; opcije: { sifre: Set, danas: "GGGG-MM-DD" }.
// Vraća { materijali, rezervacije, izdatnice, izvjestaj: [{ projekt, broj, stavke: [...], upozorenja: [...] }] } — ulaz se ne mijenja.
function izdajZaostale(stanje, { sifre, danas }) {
  const { projekti, maticnaKnjiga = [] } = stanje;
  if (!sifre || !sifre.size) throw new Error("Navedi projekte (--projekti=\"RN …,RN …\").");
  const ciljni = [...sifre].map((s) => {
    const p = projekti.find((x) => x.sifra === s);
    if (!p) throw new Error(`Nepoznat projekt: ${s}`);
    if (p.status !== "Arhiviran") throw new Error(`${s} nije Arhiviran (status ${p.status}) — samo arhivirani projekti.`);
    return p;
  }).sort((a, b) => prirodno(a.sifra, b.sifra));
  let materijali = stanje.materijali.map((m) => ({ ...m }));
  const rezervacije = stanje.rezervacije.map((r) => ({ ...r }));
  const izdatnice = [...stanje.izdatnice];
  const potrosnja = potrosnjaPoMaticnim(izdatnice);
  const prefiks = `IZD-${String(danas).slice(0, 4)}-`;
  const izvjestaj = [];

  for (const p of ciljni) {
    const rez = rezervacije.filter((r) => r.projektId === p.id && Number(r.kolicina) > 0);
    const upozorenja = [];
    const stavke = [];
    if (rez.some((r) => Array.isArray(r.po) && r.po.length)) throw new Error(`${p.sifra}: rezervacija s razradom po dužinama nije podržana ovom skriptom — izdaj ručno u aplikaciji.`);
    const poMaterijalu = new Map();
    rez.forEach((r) => poMaterijalu.set(r.materijalId, [...(poMaterijalu.get(r.materijalId) || []), r]));
    for (const [materijalId, rr] of poMaterijalu) {
      const mat = materijali.find((m) => m.id === materijalId);
      if (!mat) { upozorenja.push(`Materijal ${materijalId} više ne postoji — rezervacija ostaje.`); continue; }
      const ime = `${mat.sifra || ""} ${mat.naziv}`.trim();
      const rezervirano = zaokruzi(rr.reduce((a, r) => a + Number(r.kolicina), 0));
      // lotovi: prvo oni s narudžbenice(a) rezervacije, a ako ih nema — svi lotovi materijala; FIFO po matičnom broju
      const naruzbenice = new Set(rr.map((r) => r.narudzbenicaId).filter(Boolean));
      const svi = maticnaKnjiga.filter((z) => z.materijalId === mat.id).sort((a, b) => (Number(a.broj) || 0) - (Number(b.broj) || 0));
      const prvi = svi.filter((z) => naruzbenice.has(z.narudzbenicaId));
      const lotovi = prvi.length ? prvi : svi;
      const pokriveno = zaokruzi(lotovi.reduce((a, z) => a + Math.max(0, preostaloMaticnog(z, potrosnja)), 0));
      const izdati = zaokruzi(Math.min(rezervirano, Number(mat.kolicina) || 0, pokriveno));
      if (izdati < rezervirano - EPS) upozorenja.push(`${ime}: rezervirano ${rezervirano}, izdano ${izdati} — ${zaokruzi(rezervirano - izdati)} nije pokriveno matičnim brojem (stanje ${zaokruzi(mat.kolicina)}, u lotovima ${pokriveno}); moguće dvostruko zaprimanje. Ostatak rezervacije ostaje.`);
      if (!(izdati > EPS)) continue;
      // raspored po lotovima (FIFO) — potrošnja se odmah bilježi (više stavki istog materijala)
      const matBrojevi = [];
      let ostalo = izdati;
      for (const z of lotovi) {
        if (ostalo <= EPS) break;
        const uzmi = Math.min(preostaloMaticnog(z, potrosnja), ostalo);
        if (uzmi <= EPS) continue;
        potrosnja.set(z.id, (potrosnja.get(z.id) || 0) + uzmi);
        matBrojevi.push({ maticniId: z.id, broj: z.broj, kolicina: zaokruzi(uzmi) });
        ostalo -= uzmi;
      }
      // materijal s više dužina/formata: izdani komadi se oduzimaju od svojeg formata (format = dimenzija matičnog broja)
      const jeLim = /\d\s*[×x]\s*\d+(?:[.,]\d+)?\s*mm/.test(mat.dimenzije || "");
      const redovi = mat.jm === "kom" ? redoviIzDimenzija(mat.dimenzije, mat.kolicina, jeLim) : null;
      let novaDimenzije = mat.dimenzije;
      let izdanoRedovi = null;
      if (redovi && redovi.length > 1) {
        const tekuci = redovi.map((r) => ({ ...r, komada: Number(r.komada) || 0 }));
        const izd = new Map();
        let uspjeh = true;
        for (const a of matBrojevi) {
          const lot = maticnaKnjiga.find((z) => z.id === a.maticniId);
          const kljuc = kljucFormataIzTeksta(lot?.dimenzije);
          let ost = a.kolicina;
          if (kljuc) {
            for (const r of tekuci) {
              if (ost <= EPS) break;
              if (kljucFormata(r.duzinaMM, r.sirinaMM) !== kljuc || r.komada <= EPS) continue;
              const uzmi = Math.min(r.komada, ost);
              r.komada = zaokruzi(r.komada - uzmi);
              ost = zaokruzi(ost - uzmi);
              const kk = `${r.duzinaMM}|${r.sirinaMM}`;
              izd.set(kk, { duzinaMM: Number(r.duzinaMM), sirinaMM: r.sirinaMM ? Number(r.sirinaMM) : null, komada: zaokruzi((izd.get(kk)?.komada || 0) + uzmi) });
            }
          }
          if (ost > EPS) uspjeh = false;
        }
        if (uspjeh) {
          const nakon = tekuci.filter((r) => r.komada > EPS);
          novaDimenzije = nakon.map((r) => `${opisDuzine(r)}${nakon.length > 1 ? ` × ${r.komada}` : ""}`).join("; ");
          izdanoRedovi = [...izd.values()];
        } else upozorenja.push(`${ime}: format izdanih komada nije pronađen u popisu dimenzija (“${mat.dimenzije}”) — dimenzije nisu mijenjane, provjeri ručno.`);
      }
      stavke.push({
        id: uid("izds"), materijalId: mat.id, sifra: mat.sifra, naziv: mat.naziv, jm: mat.jm,
        dimenzije: izdanoRedovi ? izdanoRedovi.map((r) => `${opisDuzine(r)} × ${r.komada}`).join("; ") : (mat.dimenzije || ""),
        ...(izdanoRedovi ? { izdanoRedovi } : {}),
        kolicinaIzdano: izdati, kolicinaVraceno: null, cijena: Number(mat.cijena) || 0, matBrojevi,
      });
      materijali = materijali.map((m) => (m.id === mat.id ? { ...m, kolicina: zaokruzi(m.kolicina - izdati), dimenzije: novaDimenzije } : m));
      // potrošnja rezervacija projekta za taj materijal (redom)
      let zaSkinuti = izdati;
      for (const r of rr) {
        if (zaSkinuti <= EPS) break;
        const uzmi = Math.min(Number(r.kolicina), zaSkinuti);
        r.kolicina = zaokruzi(r.kolicina - uzmi);
        zaSkinuti = zaokruzi(zaSkinuti - uzmi);
      }
    }
    let broj = null;
    if (stavke.length) {
      broj = sljedeciBroj(izdatnice, prefiks);
      izdatnice.push({
        id: uid("izd"), broj, datum: danas, projektId: p.id, izdaoId: null, status: "Izdano", stavke,
        napomena: `Naknadno izdano: rezervirani materijal arhiviranog projekta (utrošeno), ${danas}.`,
      });
    }
    izvjestaj.push({ projekt: p, broj, stavke, upozorenja });
  }
  return { materijali, rezervacije: rezervacije.filter((r) => Number(r.kolicina) > EPS), izdatnice, izvjestaj };
}
module.exports = { izdajZaostale };

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
  const { Pool } = require("pg");
  const arg = (naziv) => { const a = process.argv.find((x) => x.startsWith(`--${naziv}=`)); return a ? a.slice(naziv.length + 3) : ""; };
  const provedi = process.argv.includes("provedi");
  const sifre = new Set(arg("projekti").split(",").map((s) => s.trim()).filter(Boolean));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined });
  (async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const citaj = async (k, zakljucaj) => (await c.query(`SELECT value FROM app_data WHERE key=$1${zakljucaj ? " FOR UPDATE" : ""}`, [k])).rows[0].value;
      const stanje = {
        materijali: await citaj("materijali", true), izdatnice: await citaj("izdatnice", true), rezervacije: await citaj("rezervacije", true),
        projekti: await citaj("projekti"), maticnaKnjiga: await citaj("maticnaKnjiga"),
      };
      const danas = new Date().toISOString().slice(0, 10);
      const r = izdajZaostale(stanje, { sifre, danas });
      for (const i of r.izvjestaj) {
        console.log(`\n== ${i.projekt.sifra} ${i.projekt.naziv} → ${i.broj || "(ništa za izdati)"}`);
        i.stavke.forEach((s) => console.log(`   ${String(s.sifra).padEnd(9)} ${String(s.naziv).padEnd(32)} ${String(s.kolicinaIzdano).padStart(4)} ${s.jm}  matični: ${s.matBrojevi.map((a) => `${a.broj}×${a.kolicina}`).join(", ")}${s.izdanoRedovi ? `  [${s.dimenzije}]` : ""}`));
        i.upozorenja.forEach((u) => console.log(`   ! ${u}`));
      }
      const novihIzd = r.izdatnice.length - stanje.izdatnice.length;
      console.log(`\nNove izdatnice: ${novihIzd}. Rezervacije: ${stanje.rezervacije.length} → ${r.rezervacije.length}. Materijali (broj artikala): ${stanje.materijali.length} → ${r.materijali.length}.`);
      const promjene = r.materijali.filter((m) => { const s = stanje.materijali.find((x) => x.id === m.id); return s && (s.kolicina !== m.kolicina || s.dimenzije !== m.dimenzije); });
      promjene.forEach((m) => { const s = stanje.materijali.find((x) => x.id === m.id); console.log(`   stanje ${String(m.sifra).padEnd(9)} ${String(m.naziv).padEnd(32)} ${s.kolicina} → ${m.kolicina}${s.dimenzije !== m.dimenzije ? `   dimenzije: “${s.dimenzije}” → “${m.dimenzije}”` : ""}`); });
      if (r.materijali.length !== stanje.materijali.length) throw new Error("Broj materijala se ne poklapa — prekid.");
      if (provedi) {
        const mapa = path.join(__dirname, "..", "..", "ERP-Backupovi");
        fs.mkdirSync(mapa, { recursive: true });
        const snimka = path.join(mapa, `zaostale-rezervacije-prije-izdavanja-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
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

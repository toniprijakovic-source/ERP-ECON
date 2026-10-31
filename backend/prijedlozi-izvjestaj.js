// Pregled prijedloga korisnika za ponedjeljni izvještaj. SAMO ČITA iz baze (SELECT) — ništa ne mijenja u bazi ni u aplikaciji.
//   node prijedlozi-izvjestaj.js           ispiše JSON: prijedlozi koji još nisu bili u izvještaju + sažetak stanja
//   node prijedlozi-izvjestaj.js --sve     ispiše sve prijedloge
//   node prijedlozi-izvjestaj.js --oznaci  zapiše da su svi trenutni prijedlozi uključeni u izvještaj (pokreće se nakon što je izvještaj spremljen)
// Što je već bilo u izvještaju pamti se u ../../prijedlozi-izvjestaji/stanje.json (izvan repozitorija), uz same izvještaje.
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const MAPA = path.join(__dirname, "..", "..", "prijedlozi-izvjestaji");
const STANJE = path.join(MAPA, "stanje.json");
const MODULI = { dashboard: "Nadzorna ploča", ponude: "Ponude", projekti: "Projekti", proizvodnja: "Proizvodnja", nabava: "Nabava", transporti: "Transporti", skladiste: "Skladište", kontrola: "Kontrola kvalitete", otpremnice: "Otpremnice i CMR", fakturiranje: "Financije", partneri: "Kupci i dobavljači", evidencijasati: "Evidencija sati", zaposlenici: "Zaposlenici", zastita: "Zaštita na radu" };
const sve = process.argv.includes("--sve");
const oznaci = process.argv.includes("--oznaci");

const citajStanje = () => { try { return JSON.parse(fs.readFileSync(STANJE, "utf8")); } catch { return { zadnjiIzvjestaj: null, vidjeniIds: [] }; } };

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined });
  try {
    const citaj = async (kljuc) => (await pool.query("SELECT value FROM app_data WHERE key = $1", [kljuc])).rows[0]?.value;
    const [prijedlozi, zaposlenici, pozicije, zadaci] = await Promise.all(["prijedlozi", "zaposlenici", "pozicijeZaposlenika", "slobodniZadaci"].map(citaj));
    const stanje = citajStanje();
    const vidjeni = new Set(stanje.vidjeniIds || []);
    const kljucPostoji = Array.isArray(prijedlozi);
    const poId = new Map((zaposlenici || []).map((z) => [z.id, z]));
    const nazivPozicije = (id) => (pozicije || []).find((p) => p.id === id)?.naziv || "";
    const svi = (kljucPostoji ? prijedlozi : []).map((p) => {
      const autor = poId.get(p.kreiraoId);
      return {
        id: p.id, datum: p.datum, autor: autor ? `${autor.ime} ${autor.prezime}` : "nepoznato", pozicijaAutora: autor ? nazivPozicije(autor.pozicijaId) : "",
        modul: p.modul || "", modulNaziv: MODULI[p.modul] || "Općenito", tekst: p.tekst, status: p.status, odgovor: p.odgovor || "", odgovorDatum: p.odgovorDatum || null,
        novo: !vidjeni.has(p.id),
      };
    }).sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
    const poStatusu = {};
    svi.forEach((p) => { poStatusu[p.status] = (poStatusu[p.status] || 0) + 1; });
    const prije14 = Date.now() - 14 * 24 * 3600 * 1000;
    const upitnik = (zadaci || []).find((z) => String(z.id).startsWith("sz-upitnik-lijecnicki-"));
    const rezultat = {
      stvoreno: new Date().toISOString(), kljucPostoji, ukupno: svi.length, poStatusu, zadnjiIzvjestaj: stanje.zadnjiIzvjestaj,
      noviPrijedlozi: svi.filter((p) => sve || p.novo),
      starijiNeobradjeni: svi.filter((p) => !p.novo && p.status === "Novo" && Date.parse(p.datum) < prije14).map((p) => ({ id: p.id, datum: p.datum, autor: p.autor, tekst: p.tekst.slice(0, 160) })),
      upitnikLijecnickiPregledi: upitnik ? { zadatak: upitnik.naziv, odgovoreno: Object.values(upitnik.upitnik?.odgovori || {}).filter((v) => String(v || "").trim()).length, ukupnoPitanja: (upitnik.upitnik?.pitanja || []).length, zavrsen: !!upitnik.izvrseno } : null,
    };
    if (oznaci) {
      fs.mkdirSync(MAPA, { recursive: true });
      fs.writeFileSync(STANJE, JSON.stringify({ zadnjiIzvjestaj: rezultat.stvoreno, vidjeniIds: svi.map((p) => p.id) }, null, 2));
      console.log(`Zapisano u ${STANJE}: ${svi.length} prijedloga je uključeno u izvještaj.`);
    } else {
      console.log(JSON.stringify(rezultat, null, 2));
    }
  } finally { await pool.end(); }
})().catch((e) => { console.error("GREŠKA:", e.message); process.exit(1); });

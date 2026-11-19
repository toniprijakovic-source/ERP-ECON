// Tjedni pregled skladišta za ponedjeljni podsjetnik. SAMO ČITA iz baze (SELECT) — ništa ne mijenja u bazi ni u aplikaciji.
//   node skladiste-izvjestaj.js     ispiše JSON: što čeka izdavanje, projekti u izradi bez izdanog materijala, zaostale rezervacije na
//                                   zatvorenim projektima i pokazatelji aktivnosti (izdatnice i zaprimanja u zadnjih 7 dana).
// Logika popisa je ista kao odjeljak "Za izdavanje" u aplikaciji (frontend/src/izdavanjeRezervirano.js).
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const path = require("path");
const { pathToFileURL } = require("url");
const { Pool } = require("pg");

const pretvori = (iso, dana) => new Date(new Date(iso + "T00:00:00Z").getTime() - dana * 24 * 3600 * 1000).toISOString().slice(0, 10);

(async () => {
  const { pregledZaIzdavanje } = await import(pathToFileURL(path.join(__dirname, "..", "frontend", "src", "izdavanjeRezervirano.js")).href);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined });
  try {
    const citaj = async (kljuc) => (await pool.query("SELECT value FROM app_data WHERE key = $1", [kljuc])).rows[0]?.value || [];
    const [projekti, rezervacije, izdatnice, materijali, zaposlenici, knjiga, radniNalozi, satiPoNalogu] = await Promise.all(["projekti", "rezervacije", "izdatnice", "materijali", "zaposlenici", "maticnaKnjiga", "radniNalozi", "satiPoNalogu"].map(citaj));
    // sati upisani na naloge po projektu (ukupno, prvi i zadnji dan upisa) — proizvodnja je "krenula" kad voditelj upiše sate na nalog projekta
    const projektNaloga = new Map(radniNalozi.map((n) => [n.id, n.projektId]));
    const satiPoProjektu = new Map();
    satiPoNalogu.forEach((s) => {
      const pid = projektNaloga.get(s.radniNalogId);
      if (!pid || !(Number(s.sati) > 0)) return;
      const t = satiPoProjektu.get(pid) || { sati: 0, prviUpis: s.datum, zadnjiUpis: s.datum };
      t.sati += Number(s.sati);
      if (s.datum && (!t.prviUpis || s.datum < t.prviUpis)) t.prviUpis = s.datum;
      if (s.datum && (!t.zadnjiUpis || s.datum > t.zadnjiUpis)) t.zadnjiUpis = s.datum;
      satiPoProjektu.set(pid, t);
    });
    const proizvodnja = (pr) => { const t = satiPoProjektu.get(pr.id); return t ? { sati: Math.round(t.sati * 10) / 10, prviUpis: t.prviUpis, zadnjiUpis: t.zadnjiUpis } : { sati: 0, prviUpis: null, zadnjiUpis: null }; };
    const danas = new Date().toISOString().slice(0, 10);
    const prag = pretvori(danas, 7);
    const p = pregledZaIzdavanje({ projekti, rezervacije, izdatnice, materijali });
    const voditelj = (pr) => { const z = zaposlenici.find((x) => x.id === pr.voditeljId); return z ? `${z.ime} ${z.prezime}` : ""; };
    const stavka = (s) => ({ naziv: s.naziv, kolicina: s.kolicina, jm: s.jm, naStanju: s.naStanju, manjak: s.manjak });
    // izdatnice s napomenom "Naknadno izdano…" nastale su jednokratnim izdavanjem zaostalih rezervacija (19.11.2026.), ne radom skladišta — ne računaju se u aktivnost
    const redovne = izdatnice.filter((i) => !String(i.napomena || "").startsWith("Naknadno izdano"));
    const datumiIzdatnica = redovne.map((i) => i.datum).filter(Boolean).sort();
    console.log(JSON.stringify({
      datum: danas,
      aktivnost: {
        izdatnicaUkupno: redovne.length,
        izdatnicaZadnjih7Dana: redovne.filter((i) => i.datum >= prag).length,
        zadnjaIzdatnica: datumiIzdatnica[datumiIzdatnica.length - 1] || null,
        zaprimanjaZadnjih7Dana: knjiga.filter((z) => z.izvor === "zaprimanje" && z.datum >= prag).length,
        zadnjeZaprimanje: knjiga.filter((z) => z.izvor === "zaprimanje").map((z) => z.datum).sort().pop() || null,
      },
      // PROIZVODNJA KRENULA, A MATERIJAL NIJE IZDAN: voditelj je upisao sate na naloge projekta (Odobren / U izradi), a za projekt nema nijedne izdatnice.
      // Najhitnije; rezervirano = true znači da materijal već čeka izdavanje (gumb "Izdaj rezervirano"). Najviše sati prvo.
      proizvodnjaKrenula: projekti
        .filter((pr) => ["Odobren", "U izradi"].includes(pr.status) && !izdatnice.some((i) => i.projektId === pr.id) && proizvodnja(pr).sati >= 1)
        .map((pr) => ({ projekt: pr.sifra, naziv: pr.naziv, status: pr.status, voditelj: voditelj(pr), ...proizvodnja(pr), rezervirano: rezervacije.some((r) => r.projektId === pr.id && Number(r.kolicina) > 0) }))
        .sort((a, b) => b.sati - a.sati),
      zaIzdati: p.zaIzdati.map((x) => ({ projekt: x.projekt.sifra, naziv: x.projekt.naziv, status: x.projekt.status, voditelj: voditelj(x.projekt), manjak: x.manjak, ...proizvodnja(x.projekt), stavke: x.stavke.map(stavka) })),
      bezMaterijala: p.bezMaterijala.map((x) => ({ projekt: x.projekt.sifra, naziv: x.projekt.naziv, status: x.projekt.status, voditelj: voditelj(x.projekt), ...proizvodnja(x.projekt) })),
      zatvoreni: p.zatvoreni.map((x) => ({ projekt: x.projekt.sifra, naziv: x.projekt.naziv, status: x.projekt.status, stavke: x.stavke.map(stavka) })),
    }, null, 2));
  } finally { await pool.end(); }
})().catch((e) => { console.error("GREŠKA:", e.message); process.exit(1); });

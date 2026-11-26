// Mjesečna PROBNA OBNOVA sigurnosne kopije: dokazuje da se .sef kopija stvarno može vratiti u bazu, a ne samo dešifrirati.
// Pokreće je backup-sef.js sam, jednom mjesečno (prvo pokretanje u mjesecu; nakon neuspjeha ponovno sutradan), na najnovijoj
// mjesečnoj kopiji. Postupak:
//   1. dešifrira kopiju (lozinka BACKUP_SIFRA);
//   2. u bazi otvori transakciju i napravi PRIVREMENE tablice istog oblika kao prave (CREATE TEMP TABLE … LIKE … INCLUDING ALL:
//      isti stupci, ograničenja i jedinstveni indeksi — npr. popis dopuštenih ključeva app_data);
//   3. u njih upiše sve iz kopije (app_data i tablice) i pročita natrag te usporedi sa sadržajem kopije;
//   4. ROLLBACK — privremene tablice nestaju. PRAVE TABLICE SE NE DIRAJU: privremenu tablicu vidi samo ova veza, nitko drugi.
// Rezultat ide u probna-obnova.json (most ga javlja ERP-u: Direktorski pregled → Stanje servera) i u zapisnik.log.
// Ručno: node probna-obnova.js                 → kao automatski (najnovija mjesečna kopija, zapisuje rezultat)
//        node probna-obnova.js "kopija.sef"    → samo provjeri zadanu kopiju i ispiše rezultat (ništa ne zapisuje)
const fs = require("fs");
const path = require("path");
const { otpakiraj } = require("./lib/sef");

const DATOTEKA_STANJA = "probna-obnova.json";
const PONOVI_NAKON_NEUSPJEHA_H = 20;
const RASTAVI_NAZIV = /^backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.sef$/;

// Usporedba neovisna o redoslijedu ključeva objekta (jsonb ih u bazi preslaže).
const kanonski = (v) => (Array.isArray(v) ? `[${v.map(kanonski).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${kanonski(v[k])}`).join(",")}}`
  : JSON.stringify(v));

// klijent: pg klijent (pool.connect()). paket: dešifrirana kopija ({ podaci, tablice }). tablice: popis tablica (fiksan, iz backup-sef.js).
// Vraća { kljuceva, tablice: { naziv: redaka }, poruke }. Baca grešku s razumljivom porukom ako se kopija ne bi dala vratiti.
async function provjeriObnovu(klijent, paket, tablice) {
  const poruke = [];
  if (!paket || !paket.podaci || typeof paket.podaci !== "object") throw new Error("kopija nema podatke (app_data)");
  await klijent.query("BEGIN");
  try {
    // app_data: isti stupci i ograničenja (npr. CHECK s popisom dopuštenih ključeva) kao prava tablica.
    await klijent.query("CREATE TEMP TABLE probna_app_data (LIKE app_data INCLUDING ALL) ON COMMIT DROP");
    await klijent.query("INSERT INTO probna_app_data (key, value, updated_at) SELECT key, value, now() FROM jsonb_each($1::jsonb)", [JSON.stringify(paket.podaci)]);
    const kljucevi = Object.keys(paket.podaci);
    const natrag = (await klijent.query("SELECT key, value FROM probna_app_data")).rows;
    if (natrag.length !== kljucevi.length) throw new Error(`u bazu je vraćeno ${natrag.length} od ${kljucevi.length} ključeva`);
    const razlicito = natrag.filter((r) => !(r.key in paket.podaci) || kanonski(r.value) !== kanonski(paket.podaci[r.key])).map((r) => r.key);
    if (razlicito.length) throw new Error(`sadržaj se nakon vraćanja ne poklapa s kopijom: ${razlicito.join(", ")}`);

    const brojevi = {};
    for (const t of tablice) { // popis je fiksan (nikad iz datoteke), pa nema umetanja SQL-a preko naziva tablice
      const redovi = Array.isArray(paket.tablice?.[t]) ? paket.tablice[t] : [];
      const postoji = (await klijent.query("SELECT to_regclass($1) AS naziv", [`public.${t}`])).rows[0]?.naziv;
      if (!postoji) {
        if (redovi.length) throw new Error(`tablica ${t} ne postoji u bazi, a kopija ima ${redovi.length} redaka`);
        poruke.push(`Tablica ${t} ne postoji u bazi (u kopiji nema redaka).`);
        brojevi[t] = 0;
        continue;
      }
      await klijent.query(`CREATE TEMP TABLE probna_${t} (LIKE public.${t} INCLUDING ALL) ON COMMIT DROP`);
      if (redovi.length) {
        const stupci = new Set((await klijent.query("SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped", [`probna_${t}`])).rows.map((r) => r.attname));
        const visak = Object.keys(redovi[0]).filter((k) => !stupci.has(k));
        if (visak.length) throw new Error(`tablica ${t}: kopija ima stupce kojih u bazi više nema (${visak.join(", ")}) — ti podaci se ne bi vratili`);
        await klijent.query(`INSERT INTO probna_${t} SELECT * FROM json_populate_recordset(null::probna_${t}, $1::json)`, [JSON.stringify(redovi)]);
      }
      const vraceni = (await klijent.query(`SELECT coalesce(json_agg(row_to_json(x)), '[]'::json) AS redovi FROM probna_${t} x`)).rows[0].redovi;
      if (vraceni.length !== redovi.length) throw new Error(`tablica ${t}: vraćeno ${vraceni.length} od ${redovi.length} redaka`);
      // Stupac dodan u tablicu nakon kopije dobije NULL — uspoređuju se samo stupci koje kopija ima.
      const kljuceviReda = redovi.length ? Object.keys(redovi[0]) : [];
      const samo = (r) => Object.fromEntries(kljuceviReda.map((k) => [k, r[k] === undefined ? null : r[k]]));
      const a = vraceni.map((r) => kanonski(samo(r))).sort();
      const b = redovi.map((r) => kanonski(samo(r))).sort();
      if (a.some((x, i) => x !== b[i])) throw new Error(`tablica ${t}: sadržaj se nakon vraćanja ne poklapa s kopijom`);
      brojevi[t] = redovi.length;
    }

    // Samo obavijest: ključevi koji su u bazi, a nema ih u kopiji (npr. nastali nakon izrade kopije).
    const uBazi = (await klijent.query("SELECT key FROM app_data")).rows.map((r) => r.key).filter((k) => !(k in paket.podaci));
    if (uBazi.length) poruke.push(`U bazi su i ključevi kojih nema u kopiji (nastali nakon kopije?): ${uBazi.join(", ")}`);
    return { kljuceva: kljucevi.length, tablice: brojevi, poruke };
  } finally {
    await klijent.query("ROLLBACK").catch(() => {}); // privremene tablice nestaju; prave tablice nisu ni dirane
  }
}

const datumIzNaziva = (naziv) => { const m = RASTAVI_NAZIV.exec(naziv); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; };
// Najnovija mjesečna kopija (ako je mjesečnih još nema: najnovija satna).
function kopijaZaProvjeru(mapa) {
  for (const razina of ["Mjesecne", "Satne"]) {
    const dir = path.join(mapa, razina);
    if (!fs.existsSync(dir)) continue;
    const popis = fs.readdirSync(dir).filter((f) => RASTAVI_NAZIV.test(f)).sort();
    if (popis.length) return path.join(dir, popis[popis.length - 1]);
  }
  return null;
}

function procitajStanje(mapa) {
  try { return JSON.parse(fs.readFileSync(path.join(mapa, DATOTEKA_STANJA), "utf8")); } catch { return null; }
}
// Treba li sada probna obnova: nikad nije rađena; zadnja uspjela je iz prošlog mjeseca; zadnja nije uspjela, a od nje je prošlo 20 h.
function trebaProbnaObnova(stanje, sada = new Date()) {
  if (!stanje || !stanje.vrijeme) return true;
  const t = new Date(stanje.vrijeme);
  if (Number.isNaN(t.getTime())) return true;
  if (stanje.ok) return t.getFullYear() !== sada.getFullYear() || t.getMonth() !== sada.getMonth();
  return sada.getTime() - t.getTime() > PONOVI_NAKON_NEUSPJEHA_H * 3600000;
}

function zapisiAtomski(put, sadrzaj) {
  fs.writeFileSync(`${put}.tmp`, sadrzaj);
  fs.renameSync(`${put}.tmp`, put);
}

// Automatski postupak (iz backup-sef.js ili ručno bez argumenta): provjeri najnoviju mjesečnu kopiju i zapiši rezultat. Nikad ne baca grešku.
async function napraviProbnuObnovu({ pool, mapa, sifra, tablice, sada = new Date(), dodajUZapisnik = () => {} }) {
  const pocetak = Date.now();
  const kopija = kopijaZaProvjeru(mapa);
  let rezultat;
  try {
    if (!kopija) throw new Error("u mapi kopija nema nijedne kopije");
    const paket = otpakiraj(fs.readFileSync(kopija), sifra);
    const klijent = await pool.connect();
    try {
      const r = await provjeriObnovu(klijent, paket, tablice);
      rezultat = { ok: true, vrijeme: sada.toISOString(), kopija: path.basename(kopija), kopijaOd: paket.datum || null, trajanjeMs: Date.now() - pocetak, ...r, greska: "" };
    } finally {
      klijent.release();
    }
  } catch (e) {
    rezultat = { ok: false, vrijeme: sada.toISOString(), kopija: kopija ? path.basename(kopija) : "", trajanjeMs: Date.now() - pocetak, kljuceva: null, tablice: {}, poruke: [], greska: e.message };
  }
  try { zapisiAtomski(path.join(mapa, DATOTEKA_STANJA), JSON.stringify(rezultat, null, 2)); } catch { /* stanje se ne može zapisati — zapisnik ipak pokušava */ }
  dodajUZapisnik(mapa, rezultat.ok
    ? `[${rezultat.vrijeme}] PROBNA OBNOVA uspjela: ${rezultat.kopija} | ${rezultat.kljuceva} ključeva | ${Object.entries(rezultat.tablice).map(([t, n]) => `${t}: ${n}`).join(", ")} | ${rezultat.trajanjeMs} ms${rezultat.poruke.map((p) => `\n    ${p}`).join("")}`
    : `[${rezultat.vrijeme}] PROBNA OBNOVA NIJE USPJELA: ${rezultat.kopija || "(nema kopije)"} — ${rezultat.greska}`);
  return rezultat;
}

module.exports = { provjeriObnovu, napraviProbnuObnovu, trebaProbnaObnova, procitajStanje, kopijaZaProvjeru, kanonski, datumIzNaziva, DATOTEKA_STANJA };

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
  const { Pool } = require("pg");
  const { TABLICE, MAPA_ZADANO, dodajUZapisnik } = require("./backup-sef");
  const sifra = process.env.BACKUP_SIFRA;
  if (!sifra) { console.error("BACKUP_SIFRA nije postavljen u .env."); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL nije postavljen u .env."); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("supabase") ? { rejectUnauthorized: false } : undefined });
  const datoteka = process.argv[2];
  const posao = datoteka
    ? (async () => {
      const paket = otpakiraj(fs.readFileSync(datoteka), sifra);
      const klijent = await pool.connect();
      try { return { ok: true, kopija: path.basename(datoteka), ...(await provjeriObnovu(klijent, paket, TABLICE)) }; } finally { klijent.release(); }
    })()
    : napraviProbnuObnovu({ pool, mapa: process.env.BACKUP_MAPA || MAPA_ZADANO, sifra, tablice: TABLICE, dodajUZapisnik });
  posao
    .then((r) => {
      if (!r.ok) { console.error(`Probna obnova NIJE uspjela (${r.kopija}): ${r.greska}`); process.exitCode = 2; return; }
      console.log(`Probna obnova uspjela: ${r.kopija} — ${r.kljuceva} ključeva; ${Object.entries(r.tablice).map(([t, n]) => `${t}: ${n}`).join(", ")}`);
      r.poruke.forEach((p) => console.log(`  ${p}`));
      console.log("Prave tablice nisu dirane (sve je bilo u privremenim tablicama koje su nestale).");
    })
    .catch((e) => { console.error("Probna obnova NIJE uspjela:", e.message); process.exitCode = 2; })
    .finally(() => pool.end().catch(() => {}));
}

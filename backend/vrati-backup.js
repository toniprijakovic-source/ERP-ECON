// Vraća .sef kopiju u bazu — za STVARNU nuždu (baza izgubljena ili oštećena), ne za svakodnevnu upotrebu.
// Za ispravak pojedine pogreške služi gumb "Vrati backup" u samoj aplikaciji (stare .json kopije), ne ova skripta.
//
// PO ZADANOM RADI SAMO PROBNO: ispiše što je u kopiji i što je sada u bazi, a ništa ne upiše.
// Stvarni upis traži --izvrsi I upisivanje naziva baze kao potvrdu. Sve se upisuje u jednoj transakciji: ako išta ne uspije,
// vraća se natrag i baza ostaje kakva je bila.
//   node vrati-backup.js "putanja\do\backup-....sef"                    probno
//   node vrati-backup.js "putanja\do\backup-....sef" --izvrsi           stvarno vraćanje ključeva iz app_data
//   ... --izvrsi --tablice                      uz to vraća i tablice (korekcije_bodova, aktivnost_dan, login_log), ali samo one koje su u bazi PRAZNE
//   ... --izvrsi --preskoci-neuspjele           ne odustaje cijeli postupak zbog ključa koji baza odbije (npr. CHECK ograničenje), nego ga prijavi
// Odredišna baza je ona iz DATABASE_URL u .env — provjeri poslužitelj i naziv koje skripta ispiše prije potvrde!
// VAŽNO prije stvarnog vraćanja: zaustavi poslužitelj (Render) ili odjavi sve. Preglednik koji je otvoren od prije svojim spremanjem
// može prepisati vraćene podatke (aplikacija sprema cijele popise).
const path = require("path");
const readline = require("readline");
const { ucitajKopiju } = require("./provjeri-backup");
const { TABLICE } = require("./backup-sef");

const TABLICE_S_BROJACEM = new Set(["korekcije_bodova", "login_log"]); // imaju BIGSERIAL stupac id (slijed se nastavlja iza vraćenih redaka)
const opis = (v) => (Array.isArray(v) ? `${v.length} zapisa` : v && typeof v === "object" ? `objekt (${Object.keys(v).length} polja)` : typeof v);

async function vrati({ pool, paket, izvrsi = false, tablice = false, preskociNeuspjele = false, pitaj, log = console.log }) {
  const baza = (await pool.query("SELECT current_database() AS baza")).rows[0].baza;
  const trenutno = (await pool.query("SELECT key, jsonb_typeof(value) AS tip, CASE WHEN jsonb_typeof(value) = 'array' THEN jsonb_array_length(value) END AS broj FROM app_data ORDER BY key")).rows;
  const uBazi = new Map(trenutno.map((x) => [x.key, x]));
  const kljucevi = Object.keys(paket.podaci);
  const tabl = paket.tablice || {};

  log(`Kopija od ${paket.datum}: ${kljucevi.length} ključeva.`);
  log(`Odredišna baza: "${baza}" — sada u app_data ima ${trenutno.length} ključeva.\n`);
  log("ključ".padEnd(26) + "u kopiji".padEnd(24) + "sada u bazi");
  for (const k of kljucevi) {
    const b = uBazi.get(k);
    log(k.padEnd(26) + opis(paket.podaci[k]).padEnd(24) + (b ? (b.broj != null ? `${b.broj} zapisa` : b.tip) : "(nema)"));
  }
  const samoUBazi = trenutno.map((x) => x.key).filter((k) => !(k in paket.podaci));
  if (samoUBazi.length) log(`\nU bazi su i ključevi kojih NEMA u kopiji (ostaju netaknuti): ${samoUBazi.join(", ")}`);
  log("\nTablice u kopiji: " + TABLICE.map((t) => `${t}: ${(tabl[t] || []).length} redaka`).join(", ") + (tablice ? "" : "   (bez --tablice se ne vraćaju)"));

  if (!izvrsi) {
    log("\nPROBNI NAČIN: ništa nije upisano. Za stvarno vraćanje dodaj --izvrsi (i prije toga zaustavi poslužitelj ili odjavi sve).");
    return { izvrseno: false, odustao: false, napisani: [], neuspjeli: [], tablice: {} };
  }

  log(`\nOVO ĆE PREPISATI ${kljucevi.length} ključeva u bazi "${baza}" podacima iz kopije od ${paket.datum}.`);
  const odgovor = await pitaj(`Za potvrdu upiši naziv baze (${baza}): `);
  if (String(odgovor).trim() !== baza) {
    log("Naziv se ne poklapa: odustajem, ništa nije upisano.");
    return { izvrseno: false, odustao: true, napisani: [], neuspjeli: [], tablice: {} };
  }

  const klijent = await pool.connect();
  const napisani = [], neuspjeli = [], tablicaRezultat = {};
  try {
    await klijent.query("BEGIN");
    for (const kljuc of kljucevi) {
      await klijent.query("SAVEPOINT kljuc");
      try {
        await klijent.query(
          `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [kljuc, JSON.stringify(paket.podaci[kljuc])]
        );
        await klijent.query("RELEASE SAVEPOINT kljuc");
        napisani.push(kljuc);
      } catch (e) {
        await klijent.query("ROLLBACK TO SAVEPOINT kljuc");
        neuspjeli.push({ kljuc, poruka: e.message });
        if (!preskociNeuspjele) throw new Error(`Baza je odbila ključ "${kljuc}": ${e.message}`);
      }
    }
    if (tablice) {
      for (const t of TABLICE) { // popis je fiksan (nikad iz datoteke), pa nema umetanja SQL-a preko naziva tablice
        const redovi = Array.isArray(tabl[t]) ? tabl[t] : [];
        if (!redovi.length) { tablicaRezultat[t] = "u kopiji nema redaka"; continue; }
        const n = (await klijent.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
        if (n > 0) { tablicaRezultat[t] = `preskočeno: u bazi već ima ${n} redaka (da se ne dupliraju)`; continue; }
        await klijent.query(`INSERT INTO ${t} SELECT * FROM json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(redovi)]);
        if (TABLICE_S_BROJACEM.has(t)) await klijent.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), (SELECT max(id) FROM ${t}))`);
        tablicaRezultat[t] = `vraćeno ${redovi.length} redaka`;
      }
    }
    await klijent.query("COMMIT");
  } catch (e) {
    await klijent.query("ROLLBACK").catch(() => {});
    log(`\nGREŠKA: ${e.message}\nSve je vraćeno natrag: baza je ostala točno onakva kakva je bila.`);
    if (neuspjeli.length) log("Zbog ključa koji baza odbija vidi uputu (npr. proširiti CHECK ograničenje app_data_key_check) ili ponovi s --preskoci-neuspjele.");
    return { izvrseno: false, odustao: false, greska: e.message, napisani: [], neuspjeli, tablice: {} };
  } finally {
    klijent.release();
  }

  log(`\nGOTOVO: upisano ${napisani.length} od ${kljucevi.length} ključeva.`);
  if (neuspjeli.length) log(`NIJE upisano (${neuspjeli.length}): ${neuspjeli.map((x) => `${x.kljuc} [${x.poruka}]`).join("; ")}`);
  Object.entries(tablicaRezultat).forEach(([t, r]) => log(`   ${t}: ${r}`));
  log("Svi korisnici neka ponovno učitaju ERP (osvježiti stranicu) prije rada.");
  return { izvrseno: true, odustao: false, napisani, neuspjeli, tablice: tablicaRezultat };
}

module.exports = { vrati };

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
  const { Pool } = require("pg");
  const argumenti = process.argv.slice(2);
  const datoteka = argumenti.find((a) => !a.startsWith("--"));
  if (!datoteka) { console.error('Upotreba: node vrati-backup.js "putanja\\do\\backup-....sef" [--izvrsi] [--tablice] [--preskoci-neuspjele]'); process.exit(1); }
  if (!process.env.BACKUP_SIFRA) { console.error("BACKUP_SIFRA nije postavljen u .env."); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL nije postavljen u .env."); process.exit(1); }
  let paket;
  try { paket = ucitajKopiju(datoteka, process.env.BACKUP_SIFRA); } catch (e) { console.error("Kopija se ne može otvoriti:", e.message); process.exit(1); }
  const adresa = new URL(process.env.DATABASE_URL);
  console.log(`Poslužitelj baze: ${adresa.hostname}:${adresa.port || 5432}\n`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("supabase") ? { rejectUnauthorized: false } : undefined });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pitaj = (upit) => new Promise((resolve) => rl.question(upit, resolve));
  vrati({
    pool, paket, pitaj,
    izvrsi: argumenti.includes("--izvrsi"),
    tablice: argumenti.includes("--tablice"),
    preskociNeuspjele: argumenti.includes("--preskoci-neuspjele"),
  })
    .then((r) => { if (r.greska || (r.neuspjeli && r.neuspjeli.length)) process.exitCode = 2; })
    .catch((e) => { console.error("Greška:", e.message); process.exitCode = 1; })
    .finally(() => { rl.close(); pool.end().catch(() => {}); });
}

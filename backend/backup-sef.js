// Sigurnosna kopija "sef": sve podatke iz baze sprema ŠIFRIRANO (AES-256-GCM, lozinka iz BACKUP_SIFRA u .env).
// Razlike prema backup-lokalno.js (ona i dalje radi neovisno o ovoj, dok se ne dogovori prelazak):
//   • ključeve iz app_data uzima SAMA iz baze, pa ne treba ručno održavati popis — novi ključ je u kopiji već pri
//     sljedećem pokretanju (stari popis je npr. propustio xrechnungPostavke);
//   • uz app_data kopira i tablice koje stara nije dirala: korekcije_bodova (povijest ispravaka bodova i plaća),
//     aktivnost_dan i login_log;
//   • čuva u tri razine: Satne (svako pokretanje, 30 dana), Dnevne (prvo pokretanje u danu, 365 dana),
//     Mjesecne (prvo pokretanje u mjesecu, trajno — nikad se ne brišu same);
//   • nakon upisa kopiju odmah dešifrira i provjeri (neispravna kopija se briše i skripta javlja grešku);
//   • piše zapisnik.log i zadnja-kopija.json (samo vrijeme i brojke, bez podataka) za nadzor.
// Isključivo ČITA iz baze. Pokretanje: node backup-sef.js  (Planer zadataka svaki sat).
// Postavke u .env: DATABASE_URL, BACKUP_SIFRA (najmanje 16 znakova), BACKUP_MAPA (kamo se sprema).
const path = require("path");
const fs = require("fs");
const { pakiraj, otpakiraj } = require("./lib/sef");

const MAPA_ZADANO = "C:\\Users\\Econ\\Desktop\\ERP _ECON\\ERP-Backupovi-Sef";
const CUVANJE_DANA = { Satne: 30, Dnevne: 365 }; // Mjesecne se ne brišu
const UPOZORENJE_STARE_KOPIJE_H = 3;
const TABLICE = ["korekcije_bodova", "aktivnost_dan", "login_log"]; // fiksni popis — nikad se ne uzima iz vanjskog unosa

const p2 = (n) => String(n).padStart(2, "0");
const nazivDatoteke = (d) => `backup-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.sef`;
const RASTAVI_NAZIV = /^backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.sef$/;
function datumIzNaziva(naziv) {
  const m = RASTAVI_NAZIV.exec(naziv);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}
const popisKopija = (mapa) => fs.readdirSync(mapa).filter((f) => RASTAVI_NAZIV.test(f)).sort();

// Je li ovo pokretanje prvo u novom danu/mjesecu, gledajući najnoviju postojeću satnu kopiju (a ne sat računala koji
// pokreće zadatak) — tako ni propušteno ili zakašnjelo pokretanje ne pokvari razvrstavanje.
function jePrvoOtkad(mapaSatne, sada, kljuc) {
  const popis = popisKopija(mapaSatne);
  if (!popis.length) return true;
  return kljuc(datumIzNaziva(popis[popis.length - 1])) !== kljuc(sada);
}
const kljucDana = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const kljucMjeseca = (d) => `${d.getFullYear()}-${d.getMonth()}`;

// Briše kopije starije od zadanog broja dana — po datumu iz NAZIVA (ne po vremenu izmjene datoteke, koje se kopiranjem mijenja).
function obrisiStarije(mapa, dana, sada) {
  const granica = sada.getTime() - dana * 24 * 3600 * 1000;
  let obrisano = 0;
  for (const f of popisKopija(mapa)) {
    if (datumIzNaziva(f).getTime() < granica) { fs.unlinkSync(path.join(mapa, f)); obrisano++; }
  }
  return obrisano;
}

function zapisiAtomski(put, sadrzaj) {
  const privremeno = `${put}.tmp`;
  fs.writeFileSync(privremeno, sadrzaj);
  fs.renameSync(privremeno, put);
}

function dodajUZapisnik(mapa, redak) {
  const put = path.join(mapa, "zapisnik.log");
  try { if (fs.existsSync(put) && fs.statSync(put).size > 5 * 1024 * 1024) fs.renameSync(put, `${put}.old`); } catch { /* zapisnik nikad ne smije srušiti kopiju */ }
  try { fs.appendFileSync(put, redak + "\n", "utf8"); } catch { /* isto */ }
}

// pool: objekt s query() (pg Pool). Vraća sažetak napravljene kopije. Baca grešku ako kopija nije ispravna.
async function napraviKopiju({ pool, mapa = MAPA_ZADANO, sifra, sada = new Date() }) {
  const satne = path.join(mapa, "Satne"), dnevne = path.join(mapa, "Dnevne"), mjesecne = path.join(mapa, "Mjesecne");
  [satne, dnevne, mjesecne].forEach((m) => fs.mkdirSync(m, { recursive: true }));
  const poruke = [];

  const prethodne = popisKopija(satne);
  if (prethodne.length) {
    const sati = (sada.getTime() - datumIzNaziva(prethodne[prethodne.length - 1]).getTime()) / 3600000;
    if (sati > UPOZORENJE_STARE_KOPIJE_H) poruke.push(`UPOZORENJE: prethodna kopija je stara ${sati.toFixed(1)} h — provjeri radi li planer zadataka i je li računalo bilo upaljeno.`);
  }
  const uDnevne = jePrvoOtkad(satne, sada, kljucDana);
  const uMjesecne = jePrvoOtkad(satne, sada, kljucMjeseca);

  // Sve iz app_data, bez ikakvog popisa ključeva.
  const r = await pool.query("SELECT key, value, updated_at FROM app_data ORDER BY key");
  const podaci = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  const zadnjaIzmjena = Object.fromEntries(r.rows.map((x) => [x.key, x.updated_at]));
  // Tablice se uzimaju kao JSON koji sastavlja sama baza (json_agg/row_to_json), ne preko pg upravljačkog programa: tako datumi,
  // vremena i brojevi ostaju točno onakvi kakvi jesu (upravljački program bi npr. "date" pretvorio u lokalnu ponoć pa pri
  // vraćanju pomaknuo dan unatrag).
  const tablice = {};
  for (const t of TABLICE) tablice[t] = (await pool.query(`SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) AS redovi FROM ${t} t`)).rows[0].redovi;

  const paket = { __erp_backup_sef: true, verzija: 1, datum: sada.toISOString(), podaci, zadnjaIzmjena, tablice };
  const naziv = nazivDatoteke(sada);
  const put = path.join(satne, naziv);
  zapisiAtomski(put, pakiraj(paket, sifra));

  // Provjera odmah nakon upisa: datoteka se mora dešifrirati i imati iste ključeve i iste brojeve redaka kao što smo upisali.
  try {
    const provjera = otpakiraj(fs.readFileSync(put), sifra);
    if (Object.keys(provjera.podaci).length !== Object.keys(podaci).length) throw new Error("broj ključeva u kopiji se ne poklapa");
    for (const t of TABLICE) if (provjera.tablice[t].length !== tablice[t].length) throw new Error(`broj redaka tablice ${t} se ne poklapa`);
  } catch (e) {
    fs.unlinkSync(put);
    throw new Error(`Kopija je odmah nakon upisa provjerena i NIJE ispravna (obrisana): ${e.message}`);
  }

  if (uDnevne) fs.copyFileSync(put, path.join(dnevne, naziv));
  if (uMjesecne) fs.copyFileSync(put, path.join(mjesecne, naziv));
  const obrisanoSatnih = obrisiStarije(satne, CUVANJE_DANA.Satne, sada);
  const obrisanoDnevnih = obrisiStarije(dnevne, CUVANJE_DANA.Dnevne, sada);

  const velicinaKB = Math.round(fs.statSync(put).size / 102.4) / 10;
  const sazetak = {
    ok: true, vrijeme: sada.toISOString(), naziv, velicinaKB, kljuceva: Object.keys(podaci).length,
    tablice: Object.fromEntries(TABLICE.map((t) => [t, tablice[t].length])), dnevna: uDnevne, mjesecna: uMjesecne, obrisanoSatnih, obrisanoDnevnih, poruke,
  };
  zapisiAtomski(path.join(mapa, "zadnja-kopija.json"), JSON.stringify(sazetak, null, 2));
  dodajUZapisnik(mapa, `[${sada.toISOString()}] ${naziv} | ${velicinaKB} KB šifrirano | ${sazetak.kljuceva} ključeva | ${TABLICE.map((t) => `${t}: ${tablice[t].length}`).join(", ")}`
    + `${uDnevne ? " | +Dnevne" : ""}${uMjesecne ? " | +Mjesecne" : ""}${obrisanoSatnih || obrisanoDnevnih ? ` | obrisano starih: ${obrisanoSatnih} satnih, ${obrisanoDnevnih} dnevnih` : ""}`
    + poruke.map((x) => `\n    ${x}`).join(""));
  return sazetak;
}

module.exports = { napraviKopiju, jePrvoOtkad, obrisiStarije, nazivDatoteke, datumIzNaziva, kljucDana, kljucMjeseca, TABLICE };

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
  const { Pool } = require("pg");
  const mapa = process.env.BACKUP_MAPA || MAPA_ZADANO;
  const sifra = process.env.BACKUP_SIFRA;
  if (!sifra) {
    console.error("BACKUP_SIFRA nije postavljen u .env — kopija bi ostala nešifrirana, pa radije ne radim ništa.");
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  napraviKopiju({ pool, mapa, sifra })
    .then((s) => {
      console.log(`[${s.vrijeme}] Kopija spremljena: ${s.naziv} (${s.velicinaKB} KB šifrirano, ${s.kljuceva} ključeva + ${TABLICE.length} tablice)${s.dnevna ? " +Dnevne" : ""}${s.mjesecna ? " +Mjesecne" : ""}`);
      s.poruke.forEach((p) => console.warn(p));
    })
    .catch((e) => {
      console.error("Greška kod izrade kopije:", e.message);
      try { fs.mkdirSync(mapa, { recursive: true }); dodajUZapisnik(mapa, `[${new Date().toISOString()}] GREŠKA: ${e.message}`); } catch { /* nema kamo zapisati */ }
      process.exitCode = 1;
    })
    .finally(() => pool.end().catch(() => {}));
}

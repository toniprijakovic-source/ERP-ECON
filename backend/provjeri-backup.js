// Provjerava jednu .sef kopiju: dešifrira je SAMO U MEMORIJI (na disk se ne zapisuje ništa), ispisuje što u njoj piše i staje.
// Ne dira bazu. Služi da se PRIJE nužde vidi da se kopija može otvoriti s lozinkom koju imamo.
//   node provjeri-backup.js "putanja\do\backup-....sef"       (lozinka se čita iz BACKUP_SIFRA u .env, ne upisuje se u naredbu)
const fs = require("fs");
const path = require("path");
const { otpakiraj } = require("./lib/sef");

// Dešifrira (i razvije gzip) i provjeri oblik; vraća cijeli paket (podaci + tablice). Baca grešku s razumljivom porukom.
function ucitajKopiju(putanja, sifra) {
  const paket = otpakiraj(fs.readFileSync(putanja), sifra);
  if (!paket || paket.__erp_backup_sef !== true || !paket.podaci || typeof paket.podaci !== "object") {
    throw new Error("Datoteka se dešifrirala, ali nema oblik kopije koju pravi backup-sef.js.");
  }
  return paket;
}

const opisVrijednosti = (v) => (Array.isArray(v) ? `${v.length} zapisa` : v && typeof v === "object" ? `objekt (${Object.keys(v).length} polja)` : typeof v);

function sazetak(paket) {
  return {
    datum: paket.datum,
    verzija: paket.verzija,
    kljuceva: Object.keys(paket.podaci).length,
    kljucevi: Object.fromEntries(Object.entries(paket.podaci).map(([k, v]) => [k, opisVrijednosti(v)])),
    tablice: Object.fromEntries(Object.entries(paket.tablice || {}).map(([t, redovi]) => [t, Array.isArray(redovi) ? redovi.length : 0])),
  };
}

module.exports = { ucitajKopiju, sazetak };

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
  const datoteka = process.argv[2];
  if (!datoteka) { console.error('Upotreba: node provjeri-backup.js "putanja\\do\\backup-....sef"'); process.exit(1); }
  if (!process.env.BACKUP_SIFRA) { console.error("BACKUP_SIFRA nije postavljen u .env."); process.exit(1); }
  try {
    const s = sazetak(ucitajKopiju(datoteka, process.env.BACKUP_SIFRA));
    console.log(`Datoteka: ${datoteka}`);
    console.log(`Napravljena: ${s.datum} (format sef v${s.verzija})`);
    console.log(`Ključeva u kopiji: ${s.kljuceva}`);
    Object.entries(s.kljucevi).forEach(([k, v]) => console.log(`   ${k.padEnd(24)} ${v}`));
    console.log("Tablice:");
    Object.entries(s.tablice).forEach(([t, n]) => console.log(`   ${t.padEnd(24)} ${n} redaka`));
    console.log("\nProvjera uspjela: lozinka je ispravna, a datoteka nije oštećena ni izmijenjena.");
  } catch (e) {
    console.error("Provjera NIJE uspjela:", e.message);
    process.exit(1);
  }
}

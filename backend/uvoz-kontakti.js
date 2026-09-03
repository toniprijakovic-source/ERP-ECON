// Uvozi kupci-dobavljaci-kontakti.xlsx u bazu.
// "Kupci" list -> kupci. "Dobavljači" + "Transport" + "Vijčana roba" + "INOX" -> dobavljaci
// (spojeno i deduplicirano po nazivu tvrtke, jer su sve četiri liste kategorije dobavljača/usluga).
// Više redaka iste tvrtke (više imenovanih kontakata) spaja se u JEDAN zapis — model
// aplikacije ima samo jedno polje "kontaktOsoba" pa se svi kontakti nabrajaju unutar njega
// zajedno s njihovim telefonom/mailom, a "telefon"/"email" polja nose opći broj/mail tvrtke.
require("dotenv").config();
const XLSX = require("xlsx");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

const XLSX_PATH = "C:/Users/Econ/Desktop/ERP _ECON/kupci-dobavljaci-kontakti.xlsx";

function ocisti(v) {
  return (v === undefined || v === null) ? "" : String(v).trim();
}

function grupirajPoTvrtki(retci) {
  const mapa = new Map();
  for (const r of retci) {
    const naziv = ocisti(r["Tvrtka"]);
    if (!naziv) continue;
    if (!mapa.has(naziv)) mapa.set(naziv, { naziv, telefonTvrtke: "", emailTvrtke: "", web: "", kontakti: [] });
    const zapis = mapa.get(naziv);
    if (!zapis.telefonTvrtke) zapis.telefonTvrtke = ocisti(r["Kontakt tvrtke"]);
    if (!zapis.emailTvrtke) zapis.emailTvrtke = ocisti(r["Email tvrtke"]);
    if (!zapis.web) zapis.web = ocisti(r["Web stranica tvrtke"]);
    const ime = ocisti(r["Kontakt osoba"]);
    const mob = ocisti(r["Mobilni"]);
    const mail = ocisti(r["Email osobe"]);
    if (ime || mob || mail) {
      const kljuc = `${ime}|${mob}|${mail}`;
      if (!zapis.kontakti.some((k) => k.kljuc === kljuc)) zapis.kontakti.push({ kljuc, ime, mob, mail });
    }
  }
  return [...mapa.values()];
}

function uKontaktOsoba(zapis) {
  const dijelovi = zapis.kontakti.map((k) => {
    const detalji = [k.mob, k.mail].filter(Boolean).join(", ");
    return detalji ? `${k.ime || "(bez imena)"}: ${detalji}` : (k.ime || "");
  }).filter(Boolean);
  if (zapis.web) dijelovi.push(`Web: ${zapis.web}`);
  return dijelovi.join("; ");
}

(async () => {
  const wb = XLSX.readFile(XLSX_PATH);
  const listaj = (ime) => XLSX.utils.sheet_to_json(wb.Sheets[ime], { defval: "" });

  const kupciRetci = listaj("Kupci");
  const dobavljaciRetci = [...listaj("Dobavljači"), ...listaj("Transport"), ...listaj("Vijčana roba"), ...listaj("INOX")];

  const noviKupci = grupirajPoTvrtki(kupciRetci).map((z, i) => ({
    id: `kup-uvoz-${i + 1}`, naziv: z.naziv, oib: "",
    kontaktOsoba: uKontaktOsoba(z), telefon: z.telefonTvrtke, email: z.emailTvrtke, adresa: "",
  }));
  const noviDobavljaci = grupirajPoTvrtki(dobavljaciRetci).map((z, i) => ({
    id: `dob-uvoz-${i + 1}`, naziv: z.naziv, oib: "",
    kontaktOsoba: uKontaktOsoba(z), telefon: z.telefonTvrtke, email: z.emailTvrtke,
  }));

  const kupci = (await pool.query("SELECT value FROM app_data WHERE key='kupci'")).rows[0].value;
  const dobavljaci = (await pool.query("SELECT value FROM app_data WHERE key='dobavljaci'")).rows[0].value;

  const postojeciKupci = new Set(kupci.map((k) => k.naziv));
  const postojeciDobav = new Set(dobavljaci.map((k) => k.naziv));
  const kupciZaDodati = noviKupci.filter((k) => !postojeciKupci.has(k.naziv));
  const dobavZaDodati = noviDobavljaci.filter((k) => !postojeciDobav.has(k.naziv));

  await pool.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'kupci'", [JSON.stringify([...kupci, ...kupciZaDodati])]);
  await pool.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'dobavljaci'", [JSON.stringify([...dobavljaci, ...dobavZaDodati])]);

  console.log(`Kupci: ${kupciRetci.length} redaka -> ${noviKupci.length} tvrtki -> ${kupciZaDodati.length} dodano (ukupno sad ${kupci.length + kupciZaDodati.length})`);
  console.log(`Dobavljači: ${dobavljaciRetci.length} redaka -> ${noviDobavljaci.length} tvrtki -> ${dobavZaDodati.length} dodano (ukupno sad ${dobavljaci.length + dobavZaDodati.length})`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

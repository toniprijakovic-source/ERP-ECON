// Jednokratna ugradnja novih ključeva "upitiTransporta" i "narudzbeTransporta" (modul Transporti) — proširuje CHECK ogradu na app_data.key.
// Početno stanje: prazni popisi.
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

(async () => {
  await pool.query(`
    ALTER TABLE app_data DROP CONSTRAINT IF EXISTS app_data_key_check;
    ALTER TABLE app_data ADD CONSTRAINT app_data_key_check CHECK (key IN (
      'kupci','dobavljaci','materijali','projekti','narudzbenice','ponude',
      'radniNalozi','fakture','cjenikRada','katalogProfila','pozicijeZaposlenika',
      'zaposlenici','standardniZadaci','programiRezanja','kapacitetiDana',
      'postavkeTvrtke','upitiNabave','radniCentri','evidencijaRada',
      'narudzbe','otpremnice','podlogeZaFakturu','normativi',
      'postavkePlaca','praznici','kvaliteteMaterijala','ponudeLasera','doplaciPlaca',
      'satiPoNalogu','izdatnice','cmr','slobodniZadaci','planProizvodnje','nedovrsenaProizvodnja','rezervacije','maticnaKnjiga','upitiTransporta','narudzbeTransporta'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena sa 'upitiTransporta' i 'narudzbeTransporta'.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

// Jednokratna ugradnja novog ključa "nedovrsenaProizvodnja" (Financije → Nedovršena proizvodnja:
// trošak sata, ručni postoci isporuke po mjesecu, zaključani mjesečni izvještaji) — proširuje
// CHECK ogradu na app_data.key. Nema backfilla: prazan objekt je ispravno početno stanje.
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
      'satiPoNalogu','izdatnice','cmr','slobodniZadaci','planProizvodnje','nedovrsenaProizvodnja'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena sa 'nedovrsenaProizvodnja'.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

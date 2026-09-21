// Jednokratna ugradnja novog ključa "izdatnice" (izdatnice materijala sa skladišta na projekt,
// s praćenjem povrata ostatka — vidi IzdatnicaModal/IzdatnicaPrintModal u App.jsx) — proširuje
// CHECK ogradu na app_data.key. Nema backfilla: izdatnice su potpuno nov koncept, nema starih
// podataka za migrirati.
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
      'satiPoNalogu','izdatnice'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena sa 'izdatnice'.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

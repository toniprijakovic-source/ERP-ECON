// Jednokratna ugradnja novog ključa "doplaciPlaca" (ručni mjesečni dodaci/odbici plaći po
// zaposleniku — stimulacija, kredit, usteg prehrane) — proširuje CHECK ogradu na app_data.key.
// Red za ključ ne treba unaprijed umetati: backend ga kreira sam čim se prvi dodatak spremi.
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
      'postavkePlaca','praznici','kvaliteteMaterijala','ponudeLasera','doplaciPlaca'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena s 'doplaciPlaca'.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

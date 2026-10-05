// Jednokratna ugradnja novog ključa "planProizvodnje" (postavke Plana proizvodnje: najviše ljudi
// po nalogu, mogućnost 2. smjene po stroju, trajanje bojanja/cinčanja, rezerve prije isporuke) —
// proširuje CHECK ogradu na app_data.key. Nema backfilla: postavke imaju zadane vrijednosti u kodu.
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
      'satiPoNalogu','izdatnice','cmr','slobodniZadaci','planProizvodnje'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena sa 'planProizvodnje'.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

// Jednokratna ugradnja novog ključa "ponudeLasera" (ponude za uslugu laserskog rezanja) —
// proširuje CHECK ogradu na app_data.key. Sam red za ključ ne treba unaprijed umetati: backend
// ga kreira sam (INSERT ... ON CONFLICT) čim se prva ponuda spremi, a GET /api/data već vraća
// prazan niz za ključeve koji još ne postoje.
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
      'postavkePlaca','praznici','kvaliteteMaterijala','ponudeLasera'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena s 'ponudeLasera'.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

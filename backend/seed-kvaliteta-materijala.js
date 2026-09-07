// Jednokratna ugradnja novog ključa "kvaliteteMaterijala" (korisnički uređivane vrste materijala
// s gustoćom kg/dm3, zamjenjuju dosadašnju hardkodiranu listu u frontendu):
//   1. Proširuje CHECK ogradu na app_data.key tablici.
//   2. Ubacuje zadane 4 kvalitete (iste vrijednosti kao dosadašnja hardkodirana lista) ako
//      ključ još ne postoji.
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

const ZADANE_KVALITETE = [
  { id: "celik", naziv: "Konstrukcijski čelik (S235 / S275 / S355)", gustoca: 7.85 },
  { id: "inox304", naziv: "Nehrđajući čelik – Inox 304", gustoca: 7.9 },
  { id: "inox316", naziv: "Nehrđajući čelik – Inox 316", gustoca: 8.0 },
  { id: "alu", naziv: "Aluminij (EN AW-6082)", gustoca: 2.7 },
];

(async () => {
  await pool.query(`
    ALTER TABLE app_data DROP CONSTRAINT IF EXISTS app_data_key_check;
    ALTER TABLE app_data ADD CONSTRAINT app_data_key_check CHECK (key IN (
      'kupci','dobavljaci','materijali','projekti','narudzbenice','ponude',
      'radniNalozi','fakture','cjenikRada','katalogProfila','pozicijeZaposlenika',
      'zaposlenici','standardniZadaci','programiRezanja','kapacitetiDana',
      'postavkeTvrtke','upitiNabave','radniCentri','evidencijaRada',
      'narudzbe','otpremnice','podlogeZaFakturu','normativi',
      'postavkePlaca','praznici','kvaliteteMaterijala'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena s 'kvaliteteMaterijala'.");

  const postojece = await pool.query("SELECT value FROM app_data WHERE key = 'kvaliteteMaterijala'");
  if (postojece.rows.length > 0) {
    console.log("Ključ 'kvaliteteMaterijala' već postoji — seed preskočen.");
  } else {
    await pool.query(`INSERT INTO app_data (key, value, updated_at) VALUES ('kvaliteteMaterijala', $1, now())`, [JSON.stringify(ZADANE_KVALITETE)]);
    console.log(`Zadane kvalitete materijala ubačene (${ZADANE_KVALITETE.length}).`);
  }

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

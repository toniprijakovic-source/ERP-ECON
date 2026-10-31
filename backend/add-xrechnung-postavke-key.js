// Jednokratna ugradnja ključa "xrechnungPostavke" (Financije → XRechnung: e-adresa kupca i referenca po projektu)
// — proširuje CHECK ogradu na app_data.key. Bez ovoga baza ODBIJA spremanje tog ključa (PUT /api/data/xrechnungPostavke
// vraća 500, a aplikacija pogrešku ne prikazuje), pa se upisane e-adrese gube pri sljedećem učitavanju.
// Početno stanje: ništa se ne upisuje (ključ nastaje pri prvom spremanju iz aplikacije).
// Pokretanje: node add-xrechnung-postavke-key.js        (mijenja se samo ograda; podaci se ne diraju)
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
      'satiPoNalogu','izdatnice','cmr','slobodniZadaci','planProizvodnje','nedovrsenaProizvodnja','rezervacije','maticnaKnjiga','upitiTransporta','narudzbeTransporta','godisnjiOdmor','xrechnungPostavke'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena sa 'xrechnungPostavke'.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

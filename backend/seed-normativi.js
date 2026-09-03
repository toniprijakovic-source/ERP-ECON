// Jednokratna ugradnja novog ključa "normativi" (tipski projekti po normativu — kupaonice):
//   1. Proširuje CHECK ogradu na app_data.key tablici (schema.sql sam po sebi ne mijenja
//      već postojeću tablicu jer koristi CREATE TABLE IF NOT EXISTS).
//   2. Ubacuje zadani (placeholder) normativ ako "normativi" ključ još ne postoji.
//
// Postoci raspodjele preuzeti su iz referentne specifikacije, ali "sklapanje" je u cijelosti
// preslikano na "sklapanjeKupaonice" (0% na "sklapanjeKonstrukcije") jer je ovaj normativ
// namijenjen isključivo tipskim kupaonicama — korisnik treba unijeti stvarne ugovorene
// cijene/učinke/postotke prije upotrebe (postavke > Uredi normativ).
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

const ZADANI_NORMATIV = {
  naziv: "Kupaonice — dugoročni ugovor",
  grupe: [
    {
      kljuc: "pod",
      naziv: "Pod (podna konstrukcija)",
      cijenaKg: 3.2,
      ucinakKgH: 45,
      raspodjela: {
        pila: 5, laserProfili: 5, laserLimovi: 15, kutnoSavijanje: 10,
        strojnaObrada: 3, pripremaPozicija: 7, sklapanjeKonstrukcije: 0, sklapanjeKupaonice: 15,
        zavarivanje: 25, brusenje: 8, ravnanje: 4, akz: 3,
      },
    },
    {
      kljuc: "komplet",
      naziv: "Komplet (stranice + krov + spojni profili)",
      cijenaKg: 3.6,
      ucinakKgH: 38,
      raspodjela: {
        pila: 8, laserProfili: 12, laserLimovi: 8, kutnoSavijanje: 7,
        strojnaObrada: 3, pripremaPozicija: 8, sklapanjeKonstrukcije: 0, sklapanjeKupaonice: 20,
        zavarivanje: 22, brusenje: 7, ravnanje: 3, akz: 2,
      },
    },
  ],
};

(async () => {
  await pool.query(`
    ALTER TABLE app_data DROP CONSTRAINT IF EXISTS app_data_key_check;
    ALTER TABLE app_data ADD CONSTRAINT app_data_key_check CHECK (key IN (
      'kupci','dobavljaci','materijali','projekti','narudzbenice','ponude',
      'radniNalozi','fakture','cjenikRada','katalogProfila','pozicijeZaposlenika',
      'zaposlenici','standardniZadaci','programiRezanja','kapacitetiDana',
      'postavkeTvrtke','upitiNabave','radniCentri','evidencijaRada',
      'narudzbe','otpremnice','podlogeZaFakturu','normativi'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena s 'normativi'.");

  const postojeci = await pool.query("SELECT value FROM app_data WHERE key = 'normativi'");
  if (postojeci.rows.length > 0) {
    console.log("Ključ 'normativi' već postoji u bazi — seed preskočen.");
  } else {
    await pool.query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ('normativi', $1, now())`,
      [JSON.stringify(ZADANI_NORMATIV)]
    );
    console.log("Zadani normativ ubačen (placeholder vrijednosti — uredi u aplikaciji prije upotrebe).");
  }

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

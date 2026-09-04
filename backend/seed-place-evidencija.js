// Jednokratna ugradnja novih ključeva "postavkePlaca" i "praznici" (evidencija rada i
// obračun neto plaća):
//   1. Proširuje CHECK ogradu na app_data.key tablici (schema.sql sam po sebi ne mijenja
//      već postojeću tablicu jer koristi CREATE TABLE IF NOT EXISTS).
//   2. Ubacuje zadane postavke plaća i popis hrvatskih praznika za 2026. ako ključevi
//      još ne postoje.
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

const ZADANE_POSTAVKE = {
  vrijednostBoda: 14.5,
  dodatakStazPoGodini: 1,
  radnihDanaMjesec: 20,
  fondSatiMjesec: 174,
  normaSatiDan: 8,
  prekovremeniFaktor: 1.5,
  cijenaKm: 0.3,
  topliObrokIznos: 4,
  topliObrokMinSati: 6,
  granicaPrijaveSat: "08:00",
  autoOdjavaSati: 12,
  obracunskaJedinicaMin: 30,
  smjene: [
    { kljuc: "jutarnja", naziv: "Jutarnja", pocetak: "06:00", dodatakPostotak: 0 },
    { kljuc: "popodnevna", naziv: "Popodnevna", pocetak: "14:00", dodatakPostotak: 20 },
  ],
};

const PRAZNICI_2026 = [
  { datum: "2026-01-01", naziv: "Nova godina" },
  { datum: "2026-01-06", naziv: "Bogojavljenje" },
  { datum: "2026-04-05", naziv: "Uskrs" },
  { datum: "2026-04-06", naziv: "Uskrsni ponedjeljak" },
  { datum: "2026-05-01", naziv: "Praznik rada" },
  { datum: "2026-06-04", naziv: "Tijelovo" },
  { datum: "2026-06-22", naziv: "Dan antifašističke borbe" },
  { datum: "2026-06-25", naziv: "Dan državnosti" },
  { datum: "2026-08-05", naziv: "Dan pobjede i domovinske zahvalnosti" },
  { datum: "2026-08-15", naziv: "Velika Gospa" },
  { datum: "2026-11-01", naziv: "Svi sveti" },
  { datum: "2026-11-18", naziv: "Dan sjećanja na žrtve Domovinskog rata" },
  { datum: "2026-12-25", naziv: "Božić" },
  { datum: "2026-12-26", naziv: "Sveti Stjepan" },
].map((p, i) => ({ id: `prz-2026-${i + 1}`, ...p }));

(async () => {
  await pool.query(`
    ALTER TABLE app_data DROP CONSTRAINT IF EXISTS app_data_key_check;
    ALTER TABLE app_data ADD CONSTRAINT app_data_key_check CHECK (key IN (
      'kupci','dobavljaci','materijali','projekti','narudzbenice','ponude',
      'radniNalozi','fakture','cjenikRada','katalogProfila','pozicijeZaposlenika',
      'zaposlenici','standardniZadaci','programiRezanja','kapacitetiDana',
      'postavkeTvrtke','upitiNabave','radniCentri','evidencijaRada',
      'narudzbe','otpremnice','podlogeZaFakturu','normativi',
      'postavkePlaca','praznici'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena s 'postavkePlaca' i 'praznici'.");

  const postojecePostavke = await pool.query("SELECT value FROM app_data WHERE key = 'postavkePlaca'");
  if (postojecePostavke.rows.length > 0) {
    console.log("Ključ 'postavkePlaca' već postoji — seed preskočen.");
  } else {
    await pool.query(`INSERT INTO app_data (key, value, updated_at) VALUES ('postavkePlaca', $1, now())`, [JSON.stringify(ZADANE_POSTAVKE)]);
    console.log("Zadane postavke plaća ubačene.");
  }

  const postojeciPraznici = await pool.query("SELECT value FROM app_data WHERE key = 'praznici'");
  if (postojeciPraznici.rows.length > 0) {
    console.log("Ključ 'praznici' već postoji — seed preskočen.");
  } else {
    await pool.query(`INSERT INTO app_data (key, value, updated_at) VALUES ('praznici', $1, now())`, [JSON.stringify(PRAZNICI_2026)]);
    console.log(`Praznici za 2026. ubačeni (${PRAZNICI_2026.length}).`);
  }

  // Zaposlenici: dodaj nova polja s razumnim zadanim vrijednostima ako ih nemaju.
  const zr = await pool.query("SELECT value FROM app_data WHERE key = 'zaposlenici'");
  const zaposlenici = zr.rows[0]?.value || [];
  let dopunjeno = 0;
  const noviZaposlenici = zaposlenici.map((z) => {
    if (z.bodovi !== undefined) return z;
    dopunjeno++;
    return { ...z, bodovi: 0, udaljenostKm: 0, koristiPrehranuUTvrtki: false };
  });
  if (dopunjeno > 0) {
    await pool.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'zaposlenici'", [JSON.stringify(noviZaposlenici)]);
    console.log(`Zaposlenici: ${dopunjeno} zapisa dopunjeno s bodovi/udaljenostKm/koristiPrehranuUTvrtki = 0/0/false (uredi stvarne vrijednosti ručno).`);
  } else {
    console.log("Zaposlenici: nema zapisa za dopuniti.");
  }

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

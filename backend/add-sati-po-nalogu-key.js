// Jednokratna ugradnja novog ključa "satiPoNalogu" (dnevni log sati po radnom nalogu, po
// zaposleniku — vidi SatiPoNalozimaTab u App.jsx) — proširuje CHECK ogradu na app_data.key i
// radi backfill postojećih radnih naloga: za svaki nalog s utrosenoSati > 0 kreira JEDAN
// povijesni redak (zaposlenikId: null) da zbroj ne bude izgubljen kad utrosenoSati postane
// izveden (zbroj dnevnih unosa) umjesto ručno upisan broj.
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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
      'satiPoNalogu'
    ));
  `);
  console.log("CHECK ograda na app_data.key proširena sa 'satiPoNalogu'.");

  const postojeci = await pool.query("SELECT value FROM app_data WHERE key = 'satiPoNalogu'");
  if (postojeci.rows.length > 0) {
    console.log("Ključ 'satiPoNalogu' već postoji — preskačem backfill da ne dupliciram povijesne retke.");
    await pool.end();
    return;
  }

  const r = await pool.query("SELECT value FROM app_data WHERE key = 'radniNalozi'");
  const radniNalozi = r.rows[0]?.value || [];
  const danas = new Date().toISOString().slice(0, 10);
  const satiPoNalogu = radniNalozi
    .filter((n) => (Number(n.utrosenoSati) || 0) > 0)
    .map((n) => ({
      id: uid("spn"), datum: n.datumPocetka || danas, zaposlenikId: null, radniNalogId: n.id,
      sati: Number(n.utrosenoSati), napomena: "Povijesni unos (migrirano iz ranijeg ručnog polja)",
    }));

  await pool.query(
    `INSERT INTO app_data (key, value, updated_at) VALUES ('satiPoNalogu', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(satiPoNalogu)]
  );
  console.log(`Backfill gotov: ${satiPoNalogu.length} povijesnih redaka (od ${radniNalozi.length} radnih naloga ukupno).`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

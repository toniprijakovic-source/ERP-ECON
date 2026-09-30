// Jednokratna migracija: stavke ponuda za laser (ponudeLasera) su dosad imale JEDAN set dimenzija
// (duzinaMM/sirinaMM/debljinaMM/komada/kvaliteta/kgPoM/cijenaMaterijalaEurKg) izravno na stavci.
// Sada stavka može imati VIŠE formata (različite dimenzije lima/profila) u polju `formati`, dok
// opis/tipLasera/rezanjeMin/pripremaMin ostaju zajednički za cijelu stavku. Ovo pretvara postojeće
// stavke u stavku s JEDNIM formatom (identičnim starim vrijednostima), bez gubitka podataka.
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query("SELECT value FROM app_data WHERE key = 'ponudeLasera' FOR UPDATE");
    const ponude = res.rows[0]?.value || [];
    let brojStavki = 0;
    const nove = ponude.map((p) => ({
      ...p,
      stavke: (p.stavke || []).map((s) => {
        if (s.formati) return s;
        brojStavki++;
        const { duzinaMM, sirinaMM, debljinaMM, komada, kvaliteta, kgPoM, cijenaMaterijalaEurKg, ...ostalo } = s;
        return {
          ...ostalo,
          formati: [{ id: uid("frm"), duzinaMM, sirinaMM, debljinaMM, komada, kvaliteta, kgPoM, cijenaMaterijalaEurKg }],
        };
      }),
    }));
    await client.query(
      `UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'ponudeLasera'`,
      [JSON.stringify(nove)]
    );
    await client.query("COMMIT");
    console.log(`Migrirano ${brojStavki} stavki u ${ponude.length} ponuda za laser.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})();

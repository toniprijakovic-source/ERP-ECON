// Jednokratno: proširuje popis kvaliteta materijala (grupe Konstrukcijski čelik / Pocinčani limovi /
// Nehrđajući čelik / Aluminij, oznake i gustoće). Zadani popis čita se iz frontend/src/App.jsx
// (ZADANE_KVALITETE_MATERIJALA) da postoji samo jedan izvor.
// Postojeći zapisi spajaju se po id-u (id-evi koje koriste ponude ostaju isti, mijenja se naziv,
// grupa, oznaka i gustoća); ručno dodane kvalitete ostaju (grupa "Ostalo").
// Bez argumenta samo ispisuje promjene; "provedi" sprema.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

function zadanaIzAplikacije() {
  const src = fs.readFileSync(path.join(__dirname, "..", "frontend", "src", "App.jsx"), "utf8");
  const a = src.indexOf("const GRUPE_KVALITETE");
  const b = src.indexOf("const faktorGustoce");
  if (a < 0 || b < 0) throw new Error("ne mogu pronaći zadani popis u App.jsx");
  return new Function(`${src.slice(a, b)}; return ZADANE_KVALITETE_MATERIJALA;`)();
}

(async () => {
  const provedi = process.argv[2] === "provedi";
  const zadane = zadanaIzAplikacije();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const trenutno = (await client.query("SELECT value FROM app_data WHERE key = 'kvaliteteMaterijala' FOR UPDATE")).rows[0]?.value || [];
    const poId = new Map(trenutno.map((k) => [k.id, k]));
    const rezultat = zadane.map((z) => {
      const staro = poId.get(z.id);
      if (staro) {
        const promjene = ["grupa", "naziv", "oznaka", "gustoca"].filter((k) => (staro[k] ?? "") !== z[k]);
        console.log(`  ažurirano ${z.id}${promjene.length ? ` (${promjene.map((k) => `${k}: ${JSON.stringify(staro[k])} → ${JSON.stringify(z[k])}`).join("; ")})` : " (bez promjene)"}`);
      } else console.log(`  novo ${z.id}: ${z.grupa} / ${z.naziv} (${z.gustoca})`);
      return z;
    });
    const zadaneIds = new Set(zadane.map((z) => z.id));
    const ostale = trenutno.filter((k) => !zadaneIds.has(k.id)).map((k) => ({ grupa: "Ostalo", oznaka: "", ...k }));
    ostale.forEach((k) => console.log(`  zadržano (ručno dodano) ${k.id}: ${k.naziv}`));
    const novi = [...rezultat, ...ostale];
    console.log(`\nukupno ${trenutno.length} → ${novi.length} kvaliteta`);
    if (provedi) {
      fs.writeFileSync(path.join(__dirname, "..", "..", `kvalitete-prije-migracije.json`), JSON.stringify(trenutno, null, 1));
      await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'kvaliteteMaterijala'", [JSON.stringify(novi)]);
      await client.query("COMMIT");
      console.log("spremljeno (staro stanje: kvalitete-prije-migracije.json u mapi iznad repozitorija)");
    } else {
      await client.query("ROLLBACK");
      console.log("(samo pregled — ništa nije spremljeno)");
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("GREŠKA:", e.message);
  } finally {
    client.release();
    await pool.end();
  }
})();

// Jednokratna migracija podataka nakon promjene u OPERACIJE (App.jsx):
//   - "Sklapanje" (key: sklapanje) razdvojeno u "Sklapanje - konstrukcije" i
//     "Sklapanje - kupaonice" (novi ključevi sklapanjeKonstrukcije/sklapanjeKupaonice)
//   - "Antikorozivna zaštita" preimenovano u "Bojanje" (ključ akz ostaje isti,
//     mijenja se samo tekst gdje god je spremljen kao izraz — faza, radni centar, kompetencija)
//
// Postojeći sati/cijena za "sklapanje" prebacuju se u cijelosti pod
// "sklapanjeKonstrukcije" (a "sklapanjeKupaonice" kreće od 0/iste cijene) jer ne
// postoji način da automatski znamo koji dio povijesnih podataka je bio za
// kupaonice — po potrebi ručno prerasporedi pojedine ponude/naloge nakon ovoga.
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

async function ucitaj(key) {
  const r = await pool.query("SELECT value FROM app_data WHERE key = $1", [key]);
  return r.rows[0]?.value ?? null;
}
async function spremi(key, value) {
  await pool.query(
    `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

(async () => {
  // 1. Cjenik rada — prenesi cijenu sklapanja na oba nova ključa
  const cjenikRada = await ucitaj("cjenikRada");
  if (cjenikRada && "sklapanje" in cjenikRada) {
    const { sklapanje, ...ostalo } = cjenikRada;
    const novi = { ...ostalo, sklapanjeKonstrukcije: sklapanje, sklapanjeKupaonice: sklapanje };
    await spremi("cjenikRada", novi);
    console.log(`cjenikRada: sklapanje (${sklapanje} €/h) -> sklapanjeKonstrukcije i sklapanjeKupaonice`);
  }

  // 2. Ponude — svaka pozicija ima operacije.sklapanje (sati)
  const ponude = await ucitaj("ponude");
  if (ponude) {
    let izmijenjenoPoz = 0;
    const nove = ponude.map((p) => ({
      ...p,
      pozicije: (p.pozicije || []).map((poz) => {
        if (!poz.operacije || !("sklapanje" in poz.operacije)) return poz;
        izmijenjenoPoz++;
        const { sklapanje, ...ostaleOp } = poz.operacije;
        return { ...poz, operacije: { ...ostaleOp, sklapanjeKonstrukcije: sklapanje, sklapanjeKupaonice: 0 } };
      }),
    }));
    await spremi("ponude", nove);
    console.log(`ponude: ${izmijenjenoPoz} pozicija migrirano (sati sklapanja -> sklapanjeKonstrukcije, sklapanjeKupaonice=0)`);
  }

  // 3. Radni nalozi — faza je tekstualna oznaka
  const radniNalozi = await ucitaj("radniNalozi");
  if (radniNalozi) {
    let br = 0;
    const novi = radniNalozi.map((n) => {
      if (n.faza === "Sklapanje") { br++; return { ...n, faza: "Sklapanje - konstrukcije" }; }
      if (n.faza === "Antikorozivna zaštita") { br++; return { ...n, faza: "Bojanje" }; }
      return n;
    });
    await spremi("radniNalozi", novi);
    console.log(`radniNalozi: ${br} naloga ažurirano (faza)`);
  }

  // 4. Radni centri — preimenuj postojeće, dodaj novi za kupaonice
  const radniCentri = await ucitaj("radniCentri");
  if (radniCentri) {
    let noviCentri = radniCentri.map((c) => {
      if (c.naziv === "Antikorozivna zaštita") return { ...c, naziv: "Bojanje" };
      if (c.naziv === "Sklapanje") return { ...c, naziv: "Sklapanje - konstrukcije" };
      return c;
    });
    const staviSklapanje = radniCentri.find((c) => c.naziv === "Sklapanje");
    if (staviSklapanje && !noviCentri.some((c) => c.naziv === "Sklapanje - kupaonice")) {
      noviCentri = [...noviCentri, { id: `centar-${Date.now().toString(36)}`, naziv: "Sklapanje - kupaonice", kapacitetSatiPoDanu: staviSklapanje.kapacitetSatiPoDanu }];
    }
    await spremi("radniCentri", noviCentri);
    console.log(`radniCentri: preimenovano + dodan "Sklapanje - kupaonice" (ukupno ${noviCentri.length} centara)`);
  }

  // 5. Zaposlenici — kompetencije (niz stringova)
  const zaposlenici = await ucitaj("zaposlenici");
  if (zaposlenici) {
    let br = 0;
    const novi = zaposlenici.map((z) => {
      if (!Array.isArray(z.kompetencije) || z.kompetencije.length === 0) return z;
      let promijenjeno = false;
      const nove = new Set();
      z.kompetencije.forEach((k) => {
        if (k === "Sklapanje") { nove.add("Sklapanje - konstrukcije"); nove.add("Sklapanje - kupaonice"); promijenjeno = true; }
        else if (k === "Antikorozivna zaštita") { nove.add("Bojanje"); promijenjeno = true; }
        else nove.add(k);
      });
      if (promijenjeno) br++;
      return promijenjeno ? { ...z, kompetencije: [...nove] } : z;
    });
    await spremi("zaposlenici", novi);
    console.log(`zaposlenici: ${br} zaposlenika ažurirano (kompetencije)`);
  }

  console.log("Migracija završena.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

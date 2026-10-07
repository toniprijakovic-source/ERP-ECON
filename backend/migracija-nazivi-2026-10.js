// Jednokratno: nazivi vrsta materijala SHS/RHS/CHS/Okrugla šipka/Kvadratna šipka/Plosnat zamjenjuju se hrvatskim nazivima
// (Kvadratna cijev, Pravokutna cijev, Okrugla cijev, Okruglo, Kvadratno, Plosnato) u katalogu, na skladištu, upitima,
// narudžbenicama i izdatnicama. Mijenjaju se samo tekstualne vrijednosti (ne ključevi ni id-evi).
// Bez argumenta samo ispisuje promjene; "provedi" sprema (uz snimku prethodnog stanja u mapi iznad repozitorija).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const KLJUCEVI = ["katalogProfila", "materijali", "narudzbenice", "upitiNabave", "izdatnice"];
const ZAMJENE = [[/\bSHS\b/g, "Kvadratna cijev"], [/\bRHS\b/g, "Pravokutna cijev"], [/\bCHS\b/g, "Okrugla cijev"], [/Okrugla šipka/g, "Okruglo"], [/Kvadratna šipka/g, "Kvadratno"], [/\bPlosnat\b/g, "Plosnato"]];
let broj = 0;
const primijeni = (v) => {
  if (typeof v === "string") { let n = v; for (const [re, z] of ZAMJENE) n = n.replace(re, z); if (n !== v) broj++; return n; }
  if (Array.isArray(v)) return v.map(primijeni);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, primijeni(x)]));
  return v;
};

(async () => {
  const provedi = process.argv[2] === "provedi";
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const snimka = {};
    const nove = {};
    for (const k of KLJUCEVI) {
      const r = await c.query("SELECT value FROM app_data WHERE key=$1 FOR UPDATE", [k]);
      if (!r.rows[0]) continue;
      snimka[k] = r.rows[0].value;
      broj = 0;
      nove[k] = primijeni(r.rows[0].value);
      console.log(`${k}: promijenjeno ${broj} tekstova`);
    }
    const uzorak = (nove.materijali || []).map((m) => `${m.sifra}  ${m.naziv}`).slice(0, 20);
    console.log("\nSkladište nakon promjene:\n" + uzorak.join("\n"));
    console.log("Katalog (primjer):", JSON.stringify((nove.katalogProfila || []).filter((x) => /cijev|Okruglo|Kvadratno|Plosnato/.test(x.tip)).slice(0, 3)));
    if (provedi) {
      const datoteka = path.join(__dirname, "..", "..", "nazivi-prije-migracije.json");
      fs.writeFileSync(datoteka, JSON.stringify(snimka));
      for (const k of Object.keys(nove)) await c.query("UPDATE app_data SET value=$1, updated_at=now() WHERE key=$2", [JSON.stringify(nove[k]), k]);
      await c.query("COMMIT");
      console.log(`\nspremljeno; snimka: ${datoteka}`);
    } else { await c.query("ROLLBACK"); console.log("\n(samo pregled)"); }
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("GREŠKA:", e.message); } finally { c.release(); await pool.end(); }
})();

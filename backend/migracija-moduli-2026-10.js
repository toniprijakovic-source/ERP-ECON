// Jednokratni prijenos prava pozicija na novu podjelu modula (2026-10):
//   "Projekti i ponude"         → "Projekti" (projekti) + "Ponude" (ponude)
//   "Otpremnice i fakturiranje" → "Otpremnice i CMR" (otpremnice) + "Financije" (fakturiranje)
// Bez argumenta samo ISPISUJE što bi se promijenilo (ništa ne sprema).
//   korak1 — dodaje module Ponude / Otpremnice i CMR svima koji su imali odgovarajuće kartice i
//            zatvara nove kartice Financija (Nedovršena proizvodnja, Analiza projekata) svima osim
//            glavnog administratora i direktora. Stari kod nove ključeve zanemaruje, pa se korak
//            smije pokrenuti prije objave nove verzije — nitko ne gubi postojeći pristup.
//   korak2 — miče modul Financije svima osim glavnog administratora i direktora.
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});
const FINANCIJE_SMIJU = new Set(["poz-administrator", "poz-direktor"]);
const pristup = (p, modul, kartica) => p.karticeDozvole?.[modul]?.[kartica]?.pristup !== false;

function korak1(p) {
  const moduli = [...(p.moduli || [])];
  const kd = JSON.parse(JSON.stringify(p.karticeDozvole || {}));
  const prenesi = (izModula, uModul, kartice) => {
    const stare = Object.fromEntries(kartice.filter((k) => kd[izModula]?.[k]).map((k) => [k, kd[izModula][k]]));
    if (Object.keys(stare).length) kd[uModul] = { ...(kd[uModul] || {}), ...stare };
  };
  if (moduli.includes("projekti") && !moduli.includes("ponude") && (pristup(p, "projekti", "ponude") || pristup(p, "projekti", "laser"))) {
    moduli.push("ponude");
    prenesi("projekti", "ponude", ["ponude", "laser"]);
  }
  if (moduli.includes("fakturiranje") && !moduli.includes("otpremnice") && (pristup(p, "fakturiranje", "otpremnice") || pristup(p, "fakturiranje", "cmr"))) {
    moduli.push("otpremnice");
    prenesi("fakturiranje", "otpremnice", ["otpremnice", "cmr"]);
  }
  if (moduli.includes("fakturiranje") && !FINANCIJE_SMIJU.has(p.id)) {
    kd.fakturiranje = { ...(kd.fakturiranje || {}), nedovrsena: { pristup: false, izmjene: false }, analiza: { pristup: false, izmjene: false } };
  }
  return { ...p, moduli, ...(Object.keys(kd).length ? { karticeDozvole: kd } : {}) };
}

function korak2(p) {
  if (FINANCIJE_SMIJU.has(p.id) || !(p.moduli || []).includes("fakturiranje")) return p;
  const { fakturiranje, ...ostale } = p.karticeDozvole || {};
  return { ...p, moduli: p.moduli.filter((m) => m !== "fakturiranje"), karticeDozvole: ostale };
}

(async () => {
  const mod = process.argv[2] || "pregled";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pozicije = (await client.query("SELECT value FROM app_data WHERE key = 'pozicijeZaposlenika' FOR UPDATE")).rows[0].value;
    const zaposlenici = (await client.query("SELECT value FROM app_data WHERE key = 'zaposlenici'")).rows[0].value;
    const aktivnih = (id) => zaposlenici.filter((z) => z.pozicijaId === id && z.status === "Aktivan").length;
    const nakon1 = pozicije.map(korak1);
    const nakon2 = nakon1.map(korak2);
    for (let i = 0; i < pozicije.length; i++) {
      const prije = pozicije[i].moduli || [];
      const dodano = (nakon1[i].moduli || []).filter((m) => !prije.includes(m));
      const maknuto = (nakon1[i].moduli || []).filter((m) => !(nakon2[i].moduli || []).includes(m));
      if (!dodano.length && !maknuto.length && JSON.stringify(nakon1[i]) === JSON.stringify(pozicije[i])) continue;
      console.log(`${pozicije[i].naziv} (${aktivnih(pozicije[i].id)} akt.): korak1 +[${dodano.join(", ")}]${nakon1[i].karticeDozvole?.fakturiranje?.nedovrsena ? " (nove kartice Financija zatvorene)" : ""} | korak2 −[${maknuto.join(", ")}]`);
    }
    if (mod === "korak1" || mod === "korak2") {
      const novo = mod === "korak1" ? nakon1 : pozicije.map(korak2);
      await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'pozicijeZaposlenika'", [JSON.stringify(novo)]);
      await client.query("COMMIT");
      console.log(`\n${mod} spremljen.`);
    } else {
      await client.query("ROLLBACK");
      console.log("\n(samo pregled — ništa nije spremljeno)");
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("GREŠKA:", e.message);
  } finally {
    client.release();
    await pool.end();
  }
})();

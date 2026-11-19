// Jednokratno (uz objavu statusa "Arhiviran"): svi dosadašnji projekti sa statusom "Završen" postaju "Arhiviran".
// Do sada je "Završen" značio i "posao gotov" i "selio u Završene projekte", pa su svi ti projekti zapravo arhivirani. Novi
// "Završen" znači: posao je gotov, ali čeka konačni obračun — projekt ostaje u popisu Projekti i vidi se u kartici
// "Rokovi i statusi". Ništa drugo se ne mijenja (zavrsenDatum, nalozi i oznake za "Vrati u aktivne" ostaju).
//
// Pokretanje (mapa backend):
//   node migracija-arhiviran-2026-11.js                          — samo ispis (ništa se ne sprema)
//   node migracija-arhiviran-2026-11.js --ostavi="RN 170-288,RN 170-307"   — ispis; navedeni ostaju "Završen" (čekaju obračun)
//   node migracija-arhiviran-2026-11.js provedi [--ostavi=...]   — sprema (uz snimku popisa projekata prije izmjene)
// Radi na zaključanom zapisu 'projekti' u jednoj transakciji. Objaviti tek nakon što je backend s novim statusom živ.
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Pool } = require("pg");

const arg = (naziv) => { const a = process.argv.find((x) => x.startsWith(`--${naziv}=`)); return a ? a.slice(naziv.length + 3) : ""; };
const provedi = process.argv.includes("provedi");
const ostavi = new Set(arg("ostavi").split(",").map((s) => s.trim()).filter(Boolean));

// Čista funkcija (testira se bez baze): novi popis projekata + popis promjena.
function arhiviraj(projekti, ostaviSifre = new Set()) {
  const promjene = [];
  const novi = projekti.map((p) => {
    if (p.status !== "Završen" || ostaviSifre.has(p.sifra)) return p;
    promjene.push({ sifra: p.sifra, naziv: p.naziv, zavrsenDatum: p.zavrsenDatum || null });
    return { ...p, status: "Arhiviran", arhiviranDatum: p.zavrsenDatum || null };
  });
  return { novi, promjene };
}
module.exports = { arhiviraj };

if (require.main === module) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined });
  (async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const projekti = (await c.query("SELECT value FROM app_data WHERE key='projekti' FOR UPDATE")).rows[0].value;
      const nepoznate = [...ostavi].filter((s) => !projekti.some((p) => p.sifra === s));
      if (nepoznate.length) throw new Error(`Nepoznata šifra u --ostavi: ${nepoznate.join(", ")}`);
      const { novi, promjene } = arhiviraj(projekti, ostavi);
      promjene.sort((a, b) => String(a.zavrsenDatum || "").localeCompare(String(b.zavrsenDatum || "")) || String(a.sifra).localeCompare(String(b.sifra), "hr", { numeric: true }));
      promjene.forEach((p) => console.log(`${String(p.sifra).padEnd(12)} ${String(p.naziv).slice(0, 50).padEnd(50)} završen ${p.zavrsenDatum || "—"}`));
      const ostaje = projekti.filter((p) => p.status === "Završen" && ostavi.has(p.sifra));
      console.log(`\nPostaje Arhiviran: ${promjene.length}. Ostaje Završen (čeka obračun): ${ostaje.length}${ostaje.length ? " — " + ostaje.map((p) => p.sifra).join(", ") : ""}. Ukupno projekata: ${projekti.length} (broj se ne mijenja).`);
      if (novi.length !== projekti.length) throw new Error("Broj projekata se ne poklapa — prekid.");
      if (provedi) {
        const mapa = path.join(__dirname, "..", "..", "ERP-Backupovi");
        fs.mkdirSync(mapa, { recursive: true });
        const snimka = path.join(mapa, `projekti-prije-arhiviranja-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
        fs.writeFileSync(snimka, JSON.stringify(projekti));
        const provjera = JSON.parse(fs.readFileSync(snimka, "utf8"));
        if (provjera.length !== projekti.length) throw new Error("Snimka nije ispravna — prekid.");
        await c.query("UPDATE app_data SET value=$1, updated_at=now() WHERE key='projekti'", [JSON.stringify(novi)]);
        await c.query("COMMIT");
        console.log(`Spremljeno. Snimka prije izmjene: ${snimka}`);
      } else { await c.query("ROLLBACK"); console.log("(samo pregled — ništa nije spremljeno)"); }
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("GREŠKA:", e.message); process.exitCode = 1; } finally { c.release(); await pool.end(); }
  })();
}

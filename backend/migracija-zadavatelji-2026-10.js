// Jednokratno: stariji zadaci projekata (dodijeljeni prije nego se bilježi tko ih je zadao) dobivaju kao zadavatelja
// voditelja projekta — da se prikazuju u kartici "Dodijeljeni" (otvoreni) odnosno u "Završeni" (izvršeni) kod voditelja.
// Preskaču se zadaci koje je voditelj dodijelio sam sebi. Da zbog toga ne stignu lažne obavijesti ("nova dodjela",
// "zadatak završen"), dodjela i završetak označavaju se kao viđeni (završetak datumom izvršenja, pa stariji nestaju iz
// "Završenih" nakon 30 dana). Bez argumenta samo ispisuje; "provedi" sprema (uz snimku projekata iznad repozitorija).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const provedi = process.argv[2] === "provedi";
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const projekti = (await c.query("SELECT value FROM app_data WHERE key='projekti' FOR UPDATE")).rows[0].value;
    const zaposlenici = (await c.query("SELECT value FROM app_data WHERE key='zaposlenici'")).rows[0].value;
    const ime = (id) => { const z = zaposlenici.find((x) => x.id === id); return z ? `${z.prezime} ${z.ime}` : id; };
    let otvoreni = 0, zavrseni = 0;
    const novi = projekti.map((p) => {
      if (!p.voditeljId || !Array.isArray(p.zadaci)) return p;
      let promijenjen = false;
      const zadaci = p.zadaci.map((z) => {
        if (!z.dodijeljenoId || z.zadaoId || z.dodijeljenoId === p.voditeljId) return z;
        promijenjen = true;
        const n = { ...z, zadaoId: p.voditeljId, dodjelaVidjena: true };
        if (z.izvrseno) {
          zavrseni++;
          if (!z.zavrsetakVidjenZadao) { n.zavrsetakVidjenZadao = true; n.zavrsetakVidjenDatum = z.datumIzvrsenja || new Date().toISOString().slice(0, 10); }
        } else otvoreni++;
        console.log(`${p.sifra}  ${z.izvrseno ? "izvršen " : "otvoren "} ${String(z.naziv).slice(0, 55).padEnd(55)}  ${ime(z.dodijeljenoId)}  <-  ${ime(p.voditeljId)}`);
        return n;
      });
      return promijenjen ? { ...p, zadaci } : p;
    });
    console.log(`\notvorenih: ${otvoreni}, izvršenih: ${zavrseni}`);
    if (provedi) {
      fs.writeFileSync(path.join(__dirname, "..", "..", "zadaci-prije-migracije.json"), JSON.stringify(projekti));
      await c.query("UPDATE app_data SET value=$1, updated_at=now() WHERE key='projekti'", [JSON.stringify(novi)]);
      await c.query("COMMIT");
      console.log("spremljeno");
    } else { await c.query("ROLLBACK"); console.log("(samo pregled)"); }
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("GREŠKA:", e.message); } finally { c.release(); await pool.end(); }
})();

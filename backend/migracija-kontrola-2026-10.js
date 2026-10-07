// Jednokratno: ugradnja modula Kontrola kvalitete.
// 1) Pozicije Glavni administrator, Administrator, Voditelj projekta i Tehnolog dobivaju modul "kontrola".
// 2) Za materijal koji je već na skladištu otvara se po jedan matični broj (od 3700; količina = trenutno stanje, šarža iz
//    zadnjeg zaprimanja ako je upisana) — atest i vrstu atesta dopunjuje se ručno u Kontroli kvalitete.
// Prethodno treba pokrenuti add-maticna-knjiga-key.js. Bez argumenta samo ispisuje; "provedi" sprema.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const POZICIJE = ["poz-administrator", "poz-mu5z57ev-s8qf", "poz-voditelj-projekta", "poz-tehnolog"];
const POCETAK = 3700;
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

(async () => {
  const provedi = process.argv[2] === "provedi";
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const dohvati = async (k) => (await c.query("SELECT value FROM app_data WHERE key=$1 FOR UPDATE", [k])).rows[0]?.value;
    const pozicije = await dohvati("pozicijeZaposlenika");
    const materijali = (await dohvati("materijali")) || [];
    const narudzbenice = (await dohvati("narudzbenice")) || [];
    const knjiga = (await dohvati("maticnaKnjiga")) || [];
    const snimka = { pozicijeZaposlenika: pozicije, maticnaKnjiga: knjiga };

    const novePozicije = pozicije.map((p) => {
      if (!POZICIJE.includes(p.id) || (p.moduli || []).includes("kontrola")) return p;
      console.log(`pozicija "${p.naziv}": dodan modul kontrola`);
      return { ...p, moduli: [...(p.moduli || []), "kontrola"] };
    });
    POZICIJE.forEach((id) => { if (!pozicije.some((p) => p.id === id)) console.log(`UPOZORENJE: pozicija ${id} ne postoji`); });

    let iduci = Math.max(POCETAK - 1, ...knjiga.map((z) => Number(z.broj) || 0)) + 1;
    const noveKnjiga = [...knjiga];
    materijali.filter((m) => Number(m.kolicina) > 0 && !knjiga.some((z) => z.materijalId === m.id)).forEach((m) => {
      const zadnja = narudzbenice.filter((n) => n.status === "Primljeno" && (n.stavke || []).some((s) => s.materijalId === m.id)).sort((a, b) => (b.zaprimljeno || b.datum || "").localeCompare(a.zaprimljeno || a.datum || ""))[0];
      const st = zadnja?.stavke.find((s) => s.materijalId === m.id);
      const zapis = {
        id: uid("mb"), broj: iduci++, materijalId: m.id, sifra: m.sifra || "", naziv: m.naziv || "", kvaliteta: m.kvaliteta || "", sarza: st?.sarza || "",
        atestBroj: "", atestVrsta: "", datum: zadnja?.zaprimljeno || zadnja?.datum || new Date().toISOString().slice(0, 10),
        dobavljacId: zadnja?.dobavljacId || "", narudzbenicaId: zadnja?.id || "", narudzbenicaBroj: zadnja?.broj || "",
        kolicinaPrimljeno: Math.round(Number(m.kolicina) * 1000) / 1000, jm: m.jm || "", napomena: "Zaliha zatečena pri uvođenju matične knjige", izvor: "migracija",
      };
      noveKnjiga.push(zapis);
      console.log(`${zapis.broj}  ${m.sifra}  ${m.naziv}  ${m.kolicina} ${m.jm}  ${m.kvaliteta || "-"}  šarža: ${zapis.sarza || "-"}`);
    });
    console.log(`\nnovih matičnih brojeva: ${noveKnjiga.length - knjiga.length}`);

    if (provedi) {
      fs.writeFileSync(path.join(__dirname, "..", "..", "kontrola-prije-migracije.json"), JSON.stringify(snimka));
      await c.query("UPDATE app_data SET value=$1, updated_at=now() WHERE key='pozicijeZaposlenika'", [JSON.stringify(novePozicije)]);
      await c.query(`INSERT INTO app_data (key, value, updated_at) VALUES ('maticnaKnjiga', $1, now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [JSON.stringify(noveKnjiga)]);
      await c.query("COMMIT");
      console.log("spremljeno");
    } else { await c.query("ROLLBACK"); console.log("(samo pregled)"); }
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("GREŠKA:", e.message); } finally { c.release(); await pool.end(); }
})();

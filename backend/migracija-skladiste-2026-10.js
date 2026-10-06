// Jednokratna migracija skladišta (2026-10): šifrarnik od 8 znamenki GG-NNNN-QQ, spajanje duplikata
// i prijenos stare oznake "za projekt" u rezervacije.
//  1) kvalitete dobivaju kôd QQ (celik = 00, ostale redom 01…)
//  2) kataloški artikli dobivaju trajni broj NNNN unutar vrste GG
//  3) svaki materijal dobiva novu šifru (stara ostaje u staraSifra); isti artikl + ista kvaliteta se spajaju
//     u jednu stavku (zbroj količina), a sve veze (naloge, izdatnice, narudžbenice, ponude, projekte)
//     preusmjeravaju na preživjelu stavku. Prazna kvaliteta i "S235" postaju S235JR.
//  4) materijal s količinom > 0 koji je imao oznaku projekta postaje rezervacija za taj projekt
// Bez argumenta samo ISPISUJE što bi se promijenilo; "provedi" sprema (uz snimku starog stanja).
// Pomoćne funkcije čitaju se iz frontend/src/App.jsx (blok SKLADISTE-SIFRE) — jedan izvor istine.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

function pomocneFunkcije() {
  const src = fs.readFileSync(path.join(__dirname, "..", "frontend", "src", "App.jsx"), "utf8");
  const blok = src.slice(src.indexOf("// <<SKLADISTE-SIFRE"), src.indexOf("// SKLADISTE-SIFRE>>"));
  const linija = (pocetak) => { const i = src.indexOf(pocetak); if (i < 0) throw new Error("nema " + pocetak); return src.slice(i, src.indexOf("\n", i)); };
  const kod = `${linija("const sifraIzKataloga")}\n${linija("const katalogOznakaPuna")}\n${blok}\nreturn { VRSTA_MATERIJALA_KOD, vrstaKod, kodKvalitete, sifraMaterijala, sljedecaSifraIzvanKataloga, sljedeciBrojKataloga, katalogOznakaPuna, sifraIzKataloga };`;
  return new Function(kod)();
}
const REF_KLJUCEVI = ["radniNalozi", "narudzbenice", "izdatnice", "ponude", "projekti"];
const jeS235 = (k) => ["", "s235", "s235jr"].includes(String(k || "").trim().toLowerCase());

(async () => {
  const provedi = process.argv[2] === "provedi";
  const f = pomocneFunkcije();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const uzmi = async (k) => (await client.query("SELECT value FROM app_data WHERE key = $1 FOR UPDATE", [k])).rows[0]?.value;
    const katalog = JSON.parse(JSON.stringify(await uzmi("katalogProfila")));
    const kvalitete = JSON.parse(JSON.stringify(await uzmi("kvaliteteMaterijala")));
    const materijali = await uzmi("materijali");
    const rezervacijeStare = (await uzmi("rezervacije")) || [];
    const refs = {};
    for (const k of REF_KLJUCEVI) refs[k] = JSON.parse(JSON.stringify(await uzmi(k)));
    const snimka = { katalogProfila: await uzmi("katalogProfila"), kvaliteteMaterijala: await uzmi("kvaliteteMaterijala"), materijali, rezervacije: rezervacijeStare, ...Object.fromEntries(REF_KLJUCEVI.map((k) => [k, null])) };

    // 1) kodovi kvaliteta
    const zauzetiKodovi = new Set(kvalitete.map((k) => k.kod).filter(Boolean));
    let brojacKoda = 0;
    kvalitete.forEach((k) => {
      if (k.kod) return;
      if (k.id === "celik") { k.kod = "00"; zauzetiKodovi.add("00"); return; }
      do { brojacKoda++; } while (zauzetiKodovi.has(String(brojacKoda).padStart(2, "0")));
      k.kod = String(brojacKoda).padStart(2, "0");
      zauzetiKodovi.add(k.kod);
    });
    console.log(`kvalitete: kodovi ${kvalitete.map((k) => `${k.kod}=${k.oznaka || k.id}`).join(", ")}\n`);

    // 2) brojevi kataloških artikala (po vrsti, redom kako su u katalogu)
    const brojacVrsta = {};
    katalog.forEach((k) => { if (k.broj) { const gg = f.vrstaKod(k.tip); brojacVrsta[gg] = Math.max(brojacVrsta[gg] || 0, k.broj); } });
    katalog.forEach((k) => { if (!k.broj) { const gg = f.vrstaKod(k.tip); brojacVrsta[gg] = (brojacVrsta[gg] || 0) + 1; k.broj = brojacVrsta[gg]; } });
    console.log(`katalog: ${katalog.length} artikala numerirano; po vrstama: ${Object.entries(brojacVrsta).map(([g, n]) => `${g}:${n}`).join(", ")}\n`);

    // 3) materijali
    const poNazivu = new Map(katalog.map((k) => [f.katalogOznakaPuna(k), k]));
    const poStaroj = new Map(katalog.map((k) => [f.sifraIzKataloga(k), k]));
    const kvPoOznaci = new Map(kvalitete.filter((k) => k.oznaka).map((k) => [k.oznaka.toLowerCase(), k]));
    const novi = materijali.map((m) => {
      let kat = poNazivu.get(m.naziv) || poStaroj.get(m.sifra) || null;
      if (!kat) { const u = /^U\s*(\d+)x(\d+)$/i.exec(String(m.naziv).trim()); if (u) kat = poNazivu.get(`UPN ${u[1]}`) || null; }
      let kval = String(m.kvaliteta || "").trim();
      let napomena = "";
      if (jeS235(kval)) kval = "S235JR";
      else if (/^poc/i.test(kval)) { kval = "DX51D+Z275"; napomena = "kvaliteta „" + m.kvaliteta + "“ → DX51D+Z275 (provjeri)"; }
      else if (!kvPoOznaci.has(kval.toLowerCase())) napomena = `nepoznata kvaliteta „${kval}“ → kôd 99`;
      const sifra = kat ? f.sifraMaterijala(kat, kvalitete, kval) : null;
      return { stari: m, kat, kval, sifra, napomena };
    });
    // artikli izvan kataloga: sljedeći slobodni brojevi (vrsta po nazivu)
    const dodijeljene = [];
    novi.forEach((n) => {
      if (n.sifra) return;
      const tip = Object.keys(f.VRSTA_MATERIJALA_KOD).find((t) => String(n.stari.naziv).toLowerCase().startsWith(t.toLowerCase())) || n.stari.tip || "Ostalo";
      n.sifra = f.sljedecaSifraIzvanKataloga(tip, [...dodijeljene.map((s) => ({ sifra: s })), ...materijali.filter((m) => /^\d{8}$/.test(m.sifra))], kvalitete, n.kval);
      dodijeljene.push(n.sifra);
      n.napomena = (n.napomena ? n.napomena + "; " : "") + "izvan kataloga (tip " + tip + ")";
    });

    // spajanje po novoj šifri
    const grupe = new Map();
    novi.forEach((n) => { if (!grupe.has(n.sifra)) grupe.set(n.sifra, []); grupe.get(n.sifra).push(n); });
    const preusmjeri = new Map(); // stari id -> preživjeli id
    const rezultat = [];
    const rezervacije = [...rezervacijeStare];
    for (const [sifra, clanovi] of grupe) {
      const glavni = [...clanovi].sort((a, b) => (Number(b.stari.kolicina) || 0) - (Number(a.stari.kolicina) || 0))[0];
      const ukupno = clanovi.reduce((s, c) => s + (Number(c.stari.kolicina) || 0), 0);
      const prviNeprazno = (polje, nula = false) => clanovi.map((c) => c.stari[polje]).find((v) => (nula ? Number(v) > 0 : v !== undefined && v !== null && v !== ""));
      const spojen = {
        ...glavni.stari, sifra, staraSifra: [...new Set(clanovi.map((c) => c.stari.staraSifra || c.stari.sifra).filter((x) => x && x !== sifra))].join(", ") || undefined,
        katalogId: glavni.kat?.id || glavni.stari.katalogId || null, kvaliteta: glavni.kval,
        kolicina: Math.round(ukupno * 1000) / 1000,
        cijena: Number(glavni.stari.cijena) > 0 ? glavni.stari.cijena : (prviNeprazno("cijena", true) ?? glavni.stari.cijena),
        minZaliha: Math.max(...clanovi.map((c) => Number(c.stari.minZaliha) || 0)),
        lokacija: prviNeprazno("lokacija") || "", projektId: null,
        kgPoM: Number(prviNeprazno("kgPoM", true)) || 0, kgPoM2: Number(prviNeprazno("kgPoM2", true)) || 0, kgPoKom: Number(prviNeprazno("kgPoKom", true)) || 0,
      };
      if (spojen.staraSifra === undefined) delete spojen.staraSifra;
      clanovi.forEach((c) => { if (c.stari.id !== glavni.stari.id) preusmjeri.set(c.stari.id, glavni.stari.id); });
      clanovi.forEach((c) => {
        if (c.stari.projektId && Number(c.stari.kolicina) > 0) rezervacije.push({ id: `rez-mig-${c.stari.id}`, materijalId: glavni.stari.id, projektId: c.stari.projektId, kolicina: Number(c.stari.kolicina), datum: new Date().toISOString().slice(0, 10), izvor: "migracija", napomena: "" });
      });
      rezultat.push(spojen);
      const opis = clanovi.map((c) => `${c.stari.sifra} [${c.stari.kvaliteta || "—"}] ${c.stari.kolicina} ${c.stari.jm}${c.stari.projektId ? ` (proj ${c.stari.projektId.slice(-6)})` : ""}`).join("  +  ");
      console.log(`${sifra.replace(/^(\d{2})(\d{4})(\d{2})$/, "$1-$2-$3")}  ${glavni.stari.naziv} · ${glavni.kval || "bez kvalitete"}${clanovi.length > 1 ? `  ← SPAJANJE ${clanovi.length}→1 (${spojen.kolicina} ${spojen.jm})` : ""}\n    ${opis}${clanovi.some((c) => c.napomena) ? `\n    ⚠ ${[...new Set(clanovi.map((c) => c.napomena).filter(Boolean))].join("; ")}` : ""}`);
    }

    // veze na preusmjerene materijale
    let promijenjeniRef = 0;
    const hodaj = (o) => {
      if (Array.isArray(o)) o.forEach(hodaj);
      else if (o && typeof o === "object") {
        if (typeof o.materijalId === "string" && preusmjeri.has(o.materijalId)) { o.materijalId = preusmjeri.get(o.materijalId); promijenjeniRef++; }
        Object.values(o).forEach(hodaj);
      }
    };
    REF_KLJUCEVI.forEach((k) => hodaj(refs[k]));

    // provjera: zbroj količina po jedinici isti prije i poslije
    const zbroj = (lista) => lista.reduce((m, x) => ({ ...m, [x.jm]: Math.round(((m[x.jm] || 0) + (Number(x.kolicina) || 0)) * 1000) / 1000 }), {});
    console.log(`\nmaterijala: ${materijali.length} → ${rezultat.length} | spojeno uklonjenih: ${preusmjeri.size} | preusmjerenih veza: ${promijenjeniRef}`);
    console.log("zbroj stanja po jedinici prije:", JSON.stringify(zbroj(materijali)), "| poslije:", JSON.stringify(zbroj(rezultat)));
    console.log(`rezervacije: ${rezervacijeStare.length} → ${rezervacije.length}${rezervacije.slice(rezervacijeStare.length).map((r) => `\n    + ${r.materijalId.slice(-6)} → projekt ${r.projektId.slice(-6)}: ${r.kolicina}`).join("")}`);

    if (provedi) {
      const sacuvaj = { ...snimka, radniNalozi: await uzmi("radniNalozi"), narudzbenice: await uzmi("narudzbenice"), izdatnice: await uzmi("izdatnice"), ponude: await uzmi("ponude"), projekti: await uzmi("projekti") };
      fs.writeFileSync(path.join(__dirname, "..", "..", "skladiste-prije-migracije.json"), JSON.stringify(sacuvaj));
      const spremi = (k, v) => client.query("INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [k, JSON.stringify(v)]);
      await spremi("kvaliteteMaterijala", kvalitete);
      await spremi("katalogProfila", katalog);
      await spremi("materijali", rezultat);
      await spremi("rezervacije", rezervacije);
      for (const k of REF_KLJUCEVI) await spremi(k, refs[k]);
      await client.query("COMMIT");
      console.log("\nSPREMLJENO (snimka starog stanja: skladiste-prije-migracije.json u mapi iznad repozitorija)");
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

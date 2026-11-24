// Jednokratni uvoz nesukladnosti iz starog Word obrasca ("Nesukladnosti i popravne radnje 2026.docx") u tablice nesukladnosti i nesukladnosti_slike.
// Brojevi su redoslijed u dokumentu (1., 2., … — kao "Nesukladnost 06-26"), uvezeni zapisi su označeni (uvoz) i NE idu na Z: dok se u ERP-u ne klikne "Spremi na Z:".
//   node uvoz-nesukladnosti-word.js "<putanja .docx>" [--godina 2026] [--suko "Ime Prezime"] [--upis]
// Bez --upis samo čita Word i bazu (projekti, zaposlenici, dobavljači) i ispiše sažetak. Upis je jedna transakcija i odbija se ako za tu godinu već postoji ijedna nesukladnost.
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { nazivMapeZ, oznakaMape, IZVORI, MJERE } = require("./nesukladnosti");

const argumenti = process.argv.slice(2);
const datoteka = argumenti.find((a) => !a.startsWith("--") && /\.docx$/i.test(a));
const vrijednost = (ime) => { const i = argumenti.indexOf(ime); return i >= 0 ? argumenti[i + 1] : undefined; };
const GODINA = Number(vrijednost("--godina") || 2026);
const SUKO = vrijednost("--suko") || "";
const UPIS = argumenti.includes("--upis");
if (!datoteka || !fs.existsSync(datoteka)) { console.error("Navedi postojeću .docx datoteku."); process.exit(1); }

// ---------- čitanje .docx ----------
function raspakiraj(docx) {
  const mapa = fs.mkdtempSync(path.join(os.tmpdir(), "uvoz-ns-"));
  const zip = path.join(mapa, "d.zip");
  fs.copyFileSync(docx, zip);
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${path.join(mapa, "x").replace(/'/g, "''")}' -Force`], { stdio: "ignore" });
  return path.join(mapa, "x");
}
const dekod = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tekstOdlomka = (xml) => dekod([...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[1] !== undefined ? m[1] : " ")).join("")).replace(/\s+/g, " ").trim();
const odlomci = (xml) => [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => tekstOdlomka(m[0])).filter(Boolean);
const kvacice = (xml) => [...xml.matchAll(/<w:ffData>([\s\S]*?)<\/w:ffData>/g)].filter((m) => m[1].includes("<w:checkBox")).map((m) => {
  const c = m[1].match(/<w:checked(?: w:val="([^"]*)")?\s*\/>/);
  if (c) return c[1] === undefined || c[1] === "1" || c[1] === "true";
  return /<w:default w:val="(1|true)"\s*\/>/.test(m[1]);
});
// Elementi tijela redom: tablice (s ugniježđenima) i odlomci.
function elementiTijela(xml) {
  const tijelo = xml.slice(xml.indexOf("<w:body>") + 8);
  const out = [];
  let i = 0;
  while (i < tijelo.length) {
    const t = tijelo.indexOf("<w:tbl>", i);
    const p = [tijelo.indexOf("<w:p ", i), tijelo.indexOf("<w:p>", i)].filter((x) => x >= 0).reduce((a, b) => Math.min(a, b), Infinity);
    if (t >= 0 && t < p) {
      const re = /<w:tbl>|<\/w:tbl>/g; re.lastIndex = t; let dub = 0, kraj = -1, m;
      while ((m = re.exec(tijelo))) { if (m[0] === "<w:tbl>") dub++; else if (--dub === 0) { kraj = m.index + 8; break; } }
      out.push({ vrsta: "tbl", xml: tijelo.slice(t, kraj) }); i = kraj;
    } else if (p < Infinity) {
      const kraj = tijelo.indexOf("</w:p>", p) + 6;
      out.push({ vrsta: "p", xml: tijelo.slice(p, kraj) }); i = kraj;
    } else break;
  }
  return out;
}
const redovi = (tbl) => [...tbl.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) => ({ xml: r[0], celije: [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => ({ xml: c[0], tekst: odlomci(c[0]).join("\n"), odlomci: odlomci(c[0]) })) }));
const datumIz = (s) => { const m = String(s || "").match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
const nakon = (s, oznaka) => String(s || "").replace(new RegExp(`^\\s*${oznaka}\\s*:?\\s*`, "i"), "").trim();

function procitajWord(mapa) {
  const xml = fs.readFileSync(path.join(mapa, "word", "document.xml"), "utf8");
  const rels = fs.readFileSync(path.join(mapa, "word", "_rels", "document.xml.rels"), "utf8");
  const slikaZaRid = Object.fromEntries([...rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const zapisi = [];
  let z = null;
  for (const e of elementiTijela(xml)) {
    const tekst = e.vrsta === "tbl" ? odlomci(e.xml).join(" ") : tekstOdlomka(e.xml);
    if (e.vrsta === "tbl" && /Opis nesukladnosti/.test(tekst)) { z = { t1: e.xml, t2: null, t3: null, napomena: [], uNapomeni: false, slike: [] }; zapisi.push(z); }
    else if (z && e.vrsta === "tbl" && /Uzrok:/.test(tekst) && !z.t2) z.t2 = e.xml;
    else if (z && e.vrsta === "tbl" && /Preispitivanje i ocjena/.test(tekst) && !z.t3) z.t3 = e.xml;
    else if (z && e.vrsta === "p" && /^NAPOMEN/i.test(tekst)) z.uNapomeni = true;
    else if (z && e.vrsta === "p" && z.uNapomeni && tekst && !/^Popunjava/.test(tekst)) z.napomena.push(tekst);
    if (z) for (const m of e.xml.matchAll(/r:embed="([^"]+)"/g)) if (slikaZaRid[m[1]] && !z.slike.includes(slikaZaRid[m[1]])) z.slike.push(slikaZaRid[m[1]]);
  }
  return zapisi.map((z, i) => {
    const r1 = redovi(z.t1), k1 = kvacice(z.t1);
    const prvi = r1[0]?.celije[0]?.odlomci || [];
    const bezOznaka = prvi.filter((o) => !/^Opis nesukladnosti/.test(o));
    const projektLinija = bezOznaka[0] && /^RN\s*\d/i.test(bezOznaka[0]) ? bezOznaka[0] : "";
    const opis = (projektLinija ? bezOznaka.slice(1) : bezOznaka).join("\n").trim();
    const izvorIdx = k1.slice(2, 9).findIndex(Boolean);
    const ev = r1.find((r) => /Evidentirao/.test(r.celije[0]?.tekst || ""));
    const r2 = z.t2 ? redovi(z.t2) : [], k2 = z.t2 ? kvacice(z.t2) : [];
    const uzrok = nakon(r2.find((r) => /^Uzrok/.test(r.celije[0]?.tekst || ""))?.celije.slice(1).map((c) => c.tekst).join(" ") || "", "");
    const zaglavlje = r2.findIndex((r) => /Mjera će se provesti/i.test(r.celije[0]?.tekst || ""));
    const potpisRed = r2.findIndex((r) => /^Ime i prezime/.test(r.celije[0]?.tekst || ""));
    const aktivnosti = (zaglavlje >= 0 ? r2.slice(zaglavlje + 1, potpisRed >= 0 ? potpisRed : undefined) : []).map((r) => ({ opis: r.celije[0]?.tekst || "", odgovoran: r.celije[1]?.tekst || "", rok: datumIz(r.celije[2]?.tekst), provedeno: datumIz(r.celije[3]?.tekst) })).filter((a) => a.opis || a.odgovoran);
    const nos = potpisRed >= 0 ? r2[potpisRed].celije : [];
    const r3 = z.t3 ? redovi(z.t3) : [];
    const ocjena = r3[1]?.celije.map((c) => c.tekst).join(" ").trim() || "";
    const sukoRed = r3[2]?.celije || [];
    return {
      broj: i + 1, potencijalna: !!k1[1] && !k1[0], izvor: IZVORI[izvorIdx] || "ostalo", projektLinija, opis,
      evidentirao: nakon(ev?.celije[0]?.tekst, "Evidentirao"), datum: datumIz(ev?.celije[1]?.tekst),
      uzrok, mjere: MJERE.filter((_, j) => k2[j]), aktivnosti,
      nositelj: nakon(nos[0]?.tekst, "Ime i prezime"), nositeljDatum: datumIz(nos[1]?.tekst),
      ocjena, sukoIme: (sukoRed[0]?.tekst || "").replace(/^Ime i prezime:?/i, "").trim(), sukoDatum: datumIz(sukoRed[1]?.tekst),
      napomena: z.napomena.join("\n"), slike: z.slike.map((s) => path.join(mapa, "word", s)),
    };
  });
}

// ---------- povezivanje s podacima ERP-a ----------
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();
const jezgraTvrtke = (s) => norm(s).replace(/\b(d\.?o\.?o\.?|gmbh|co\.?|kg|s\.?r\.?o\.?|ltd)\b/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function poveziSve(zapisi, { projekti, zaposlenici, dobavljaci }) {
  const osoba = (ime) => { const n = norm(ime); if (!n) return null; return zaposlenici.find((z) => norm(`${z.ime} ${z.prezime}`) === n || norm(`${z.prezime} ${z.ime}`) === n) || null; };
  return zapisi.map((z) => {
    const m = `${z.projektLinija} ${z.opis}`.match(/RN\s*(\d{2,3})\s*-\s*(\d{1,4})/i);
    const projekt = m ? projekti.find((p) => norm(p.sifra) === norm(`RN ${m[1]}-${m[2]}`)) : null;
    const ev = osoba(z.evidentirao), nos = osoba(z.nositelj);
    const odgovorni = z.aktivnosti.map((a) => jezgraTvrtke(a.odgovoran)).join(" | ");
    const dob = dobavljaci.find((d) => { const j = jezgraTvrtke(d.naziv); return j.length >= 4 && !/^econ\b/.test(j) && (odgovorni.includes(j) || (z.izvor === "reklamacija dobavljaču" && norm(z.uzrok + " " + z.opis).includes(j))); }) || null;
    const datum = z.datum && z.datum.startsWith(String(GODINA)) ? z.datum : (z.nositeljDatum || `${GODINA}-01-01`);
    const status = z.sukoDatum ? "Zatvorena" : z.nositeljDatum ? "Čeka ocjenu" : (z.uzrok || z.aktivnosti.length) ? "Mjere u tijeku" : "Otvorena";
    const podaci = {
      datum, potencijalna: z.potencijalna, izvor: z.izvor, projektId: projekt?.id || "", projektSifra: projekt?.sifra || "", projektNaziv: projekt?.naziv || "",
      dobavljacId: dob?.id || "", opis: projekt ? z.opis : [z.projektLinija, z.opis].filter(Boolean).join("\n"),
      evidentiraoId: ev?.id || "", evidentirao: ev ? `${ev.ime} ${ev.prezime}` : z.evidentirao, nositeljId: nos?.id || "", nositelj: nos ? `${nos.ime} ${nos.prezime}` : z.nositelj,
      uzrok: z.uzrok, mjere: z.mjere, aktivnosti: z.aktivnosti.map((a, i) => ({ id: `u${z.broj}a${i + 1}`, ...a })),
      napomena: z.napomena, ocjena: z.ocjena, // i nedovršena ocjena (bez datuma) ostaje da je SUKO dovrši ucinkovito: z.sukoDatum ? true : null,
      nositeljPotvrda: z.nositeljDatum ? { id: nos?.id || "", ime: nos ? `${nos.ime} ${nos.prezime}` : z.nositelj, vrijeme: `${z.nositeljDatum}T12:00:00.000Z` } : null,
      ocijenio: z.sukoDatum ? { id: osoba(z.sukoIme)?.id || "", ime: z.sukoIme, vrijeme: `${z.sukoDatum}T12:00:00.000Z` } : null,
      uvezenoIzWorda: path.basename(datoteka),
    };
    return { ...z, projekt, ev, nos, dob, status, podaci };
  });
}

(async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined });
  const mapa = raspakiraj(datoteka);
  try {
    const sirovi = procitajWord(mapa);
    const kljuc = async (k) => (await pool.query("SELECT value FROM app_data WHERE key = $1", [k])).rows[0]?.value || [];
    const [projekti, zaposlenici, dobavljaci] = await Promise.all([kljuc("projekti"), kljuc("zaposlenici"), kljuc("dobavljaci")]);
    const zapisi = poveziSve(sirovi, { projekti, zaposlenici, dobavljaci });
    const kratko = (s, n) => String(s || "").replace(/\s+/g, " ").slice(0, n).padEnd(n);
    console.log(`Word: ${path.basename(datoteka)} → ${zapisi.length} nesukladnosti za ${GODINA}.\n`);
    for (const z of zapisi) console.log(`${String(z.broj).padStart(2)}/${String(GODINA).slice(-2)} ${z.podaci.datum} ${kratko(z.projekt?.sifra || (z.projektLinija ? "?" + z.projektLinija : "—"), 13)} ${kratko(z.izvor, 22)} ${kratko(z.status, 14)} akt:${z.aktivnosti.length} sl:${z.slike.length} ev:${kratko(z.podaci.evidentirao + (z.ev ? "" : "*"), 22)} nos:${kratko(z.podaci.nositelj + (z.nos || !z.nositelj ? "" : "*"), 18)} dob:${kratko(z.dob?.naziv || "", 16)} | ${kratko(z.opis, 50)}`);
    const detalj = vrijednost("--detalj");
    if (detalj) for (const b of detalj.split(",").map(Number)) { const z = zapisi.find((x) => x.broj === b); console.log(`
--- ${b}:`, JSON.stringify({ evidentirao: z.evidentirao, datum: z.datum, nositelj: z.nositelj, nositeljDatum: z.nositeljDatum, sukoIme: z.sukoIme, sukoDatum: z.sukoDatum, ocjena: z.ocjena.slice(0, 90), mjere: z.mjere, izvor: z.izvor, potencijalna: z.potencijalna, aktivnosti: z.aktivnosti.slice(0, 2), napomena: z.napomena.slice(0, 80) }, null, 1)); }
    const st = {}; zapisi.forEach((z) => { st[z.status] = (st[z.status] || 0) + 1; });
    console.log(`\nStatusi: ${JSON.stringify(st)} · slika ukupno: ${zapisi.reduce((a, z) => a + z.slike.length, 0)} · bez projekta: ${zapisi.filter((z) => !z.projekt).length} · (* = ime nije pronađeno među zaposlenicima, ostaje kao tekst)`);
    const suko = SUKO ? zaposlenici.find((z) => norm(`${z.ime} ${z.prezime}`) === norm(SUKO)) : null;
    if (SUKO) console.log(`SUKO: ${suko ? `${suko.ime} ${suko.prezime} (${suko.id})` : `"${SUKO}" NIJE pronađen`}`);
    const postoji = (await pool.query("SELECT to_regclass('nesukladnosti') AS t")).rows[0].t;
    if (!postoji) { console.log("\nTablica nesukladnosti još ne postoji (stvara je poslužitelj nakon objave) — upis nije moguć."); return; }
    const vec = Number((await pool.query("SELECT count(*)::int AS n FROM nesukladnosti WHERE godina = $1", [GODINA])).rows[0].n);
    console.log(`U bazi već postoji ${vec} nesukladnosti za ${GODINA}.`);
    if (!UPIS) { console.log("\nProbni način: ništa nije upisano (dodaj --upis)."); return; }
    if (vec > 0) throw new Error(`Za ${GODINA}. već postoje nesukladnosti — uvoz se ne izvodi (da se brojevi ne preklope).`);
    const klijent = await pool.connect();
    let slika = 0;
    try {
      await klijent.query("BEGIN");
      for (const z of zapisi) {
        const id = `ns-uvoz-${GODINA}-${String(z.broj).padStart(2, "0")}`;
        const kreirano = `${z.podaci.datum}T12:00:00.000Z`;
        await klijent.query("INSERT INTO nesukladnosti (id, godina, broj, podaci, status, verzija, kreirano, izmijenjeno, kreirao_id, izmijenio_id, uvoz, z_ukljuceno, z_mapa) VALUES ($1,$2,$3,$4,$5,1,$6,$6,NULL,NULL,true,false,$7)",
          [id, GODINA, z.broj, JSON.stringify(z.podaci), z.status, kreirano, nazivMapeZ(GODINA, z.broj, z.podaci.projektSifra)]);
        let redni = 0;
        for (const s of z.slike) {
          const b = fs.readFileSync(s);
          const vrsta = b[0] === 0xff && b[1] === 0xd8 ? "jpg" : b[0] === 0x89 && b[1] === 0x50 ? "png" : null;
          if (!vrsta || b.length > 4_000_000) { console.log(`  preskočena slika ${path.basename(s)} (${vrsta || "nepoznata vrsta"}, ${Math.round(b.length / 1024)} KB)`); continue; }
          redni += 1; slika += 1;
          await klijent.query("INSERT INTO nesukladnosti_slike (id, ns_id, redni, naziv, vrsta, slika, slicica, kreirano) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7)", [crypto.randomUUID(), id, redni, `${oznakaMape(GODINA, z.broj)}_${String(redni).padStart(2, "0")}.${vrsta}`, vrsta, b, kreirano]);
        }
      }
      if (suko) await klijent.query("INSERT INTO nesukladnosti_postavke (kljuc, vrijednost) VALUES ('sukoId', $1) ON CONFLICT (kljuc) DO UPDATE SET vrijednost = EXCLUDED.vrijednost", [suko.id]);
      await klijent.query("COMMIT");
    } catch (e) { await klijent.query("ROLLBACK").catch(() => {}); throw e; } finally { klijent.release(); }
    const n = (await pool.query("SELECT count(*)::int AS n, max(broj) AS m FROM nesukladnosti WHERE godina = $1", [GODINA])).rows[0];
    console.log(`\nUPISANO: ${n.n} nesukladnosti (zadnji broj ${n.m}), ${slika} slika${suko ? `, SUKO = ${suko.ime} ${suko.prezime}` : ""}. Sljedeća nova dobiva broj ${Number(n.m) + 1}/${String(GODINA).slice(-2)}.`);
  } finally {
    fs.rmSync(path.dirname(mapa), { recursive: true, force: true });
    await pool.end();
  }
})().catch((e) => { console.error("GREŠKA:", e.message); process.exit(1); });

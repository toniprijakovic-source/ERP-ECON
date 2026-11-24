// Nesukladnosti i popravne radnje (ISO 9001, obrazac "NESUKLADNOSTI I POPRAVNE RADNJE"): kartica Kontrola kvalitete → Nesukladnosti.
//  • jedan zapis = jedan obrazac: 1) opis, izvor, projekt, tko je evidentirao; 2) nositelj: uzrok, vrsta mjere, aktivnosti (odgovoran, planirani rok, stvarna provedba);
//    3) predstavnik uprave za kvalitetu i okoliš (SUKO): ocjena učinkovitosti i zatvaranje. "Potpis" = prijavljena osoba + vrijeme.
//  • broj NN/GG dodjeljuje poslužitelj (po godini datuma, redom); zapisi su u SQL tablici nesukladnosti (polja u jsonb "podaci"), slike u nesukladnosti_slike,
//    zadnji PDF obrasca (izrađuje ga preglednik) u nesukladnosti_pdf — ništa od toga nije u app_data (više ljudi uređuje; zastarjeli preglednik ne smije prepisati tuđe)
//  • most sprema PDF i slike u <mapa nesukladnosti>\<godina>\<NN-GG RN …>\ (PDF se zamjenjuje novijim, slike se nikad ne prepisuju)
//  • podsjetnici = zadaci iz sustava (zvonce i "moji zadaci"): nositelju kad je nesukladnost dodijeljena i kad rok aktivnosti prođe, SUKO-u kad čeka ocjenu
const crypto = require("crypto");

const STATUSI = ["Otvorena", "Mjere u tijeku", "Čeka ocjenu", "Zatvorena", "Poništena"];
const ZAVRSNI = ["Zatvorena", "Poništena"];
const IZVORI = ["reklamacija kupca", "radni proces", "analiza poslovodstva", "ostalo", "interni audit", "inspekcijski nalaz", "reklamacija dobavljaču"];
const MJERE = ["ispravak", "popravna radnja", "preventivna radnja"];
const MAX_SLIKA_BAJTOVA = 4_000_000;
const MAX_SLICICA = 120_000;
const MAX_PDF = 25 * 1024 * 1024;
const MAX_SLIKA_PO_NS = 40;
const ID_OBLIK = /^[A-Za-z0-9_-]{1,80}$/;
const DATUM = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const greska = (status, poruka) => Object.assign(new Error(poruka), { httpStatus: status });
const tekst = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const datum = (v) => (DATUM.test(String(v || "")) ? String(v) : "");
const zagrebDatum = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Zagreb" });
const oznakaBroja = (godina, broj) => `${broj}/${String(godina).slice(-2)}`;
const oznakaMape = (godina, broj) => `${String(broj).padStart(2, "0")}-${String(godina).slice(-2)}`;
// Naziv podmape na Z: (stalan od nastanka zapisa): "46-26 RN 170-313"; znakovi koje Windows ne dopušta se uklanjaju.
const nazivMapeZ = (godina, broj, sifra) => `${oznakaMape(godina, broj)}${sifra ? ` ${sifra}` : ""}`.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80);
const nazivPdf = (godina, broj) => `Nesukladnosti i popravne radnje ${oznakaMape(godina, broj)}.pdf`;
const vrstaSlike = (b) => (Buffer.isBuffer(b) && b.length > 8 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg"
  : Buffer.isBuffer(b) && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? "png" : null);
const dekodirajSliku = (v, max) => {
  if (typeof v !== "string" || v.length < 8 || v.length > Math.ceil(max * 1.4) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  const b = Buffer.from(v, "base64");
  return b.length <= max && vrstaSlike(b) ? b : null;
};

// Polja obrasca iz preglednika → dopušteni oblik. Odjeljak 3 (ocjena SUKO-a) i potpisi se NIKAD ne uzimaju iz ulaza: postavljaju ih radnje na poslužitelju.
function ocistiPodatke(u, prije = {}) {
  const a = (Array.isArray(u?.aktivnosti) ? u.aktivnosti : []).slice(0, 30).map((x) => ({
    id: ID_OBLIK.test(String(x?.id || "")) ? String(x.id) : crypto.randomUUID().slice(0, 12),
    opis: tekst(x?.opis, 500), odgovoran: tekst(x?.odgovoran, 120), rok: datum(x?.rok), provedeno: datum(x?.provedeno),
  })).filter((x) => x.opis || x.odgovoran || x.rok || x.provedeno);
  return {
    datum: datum(u?.datum) || prije.datum || zagrebDatum(),
    potencijalna: !!u?.potencijalna,
    izvor: IZVORI.includes(u?.izvor) ? u.izvor : "radni proces",
    projektId: ID_OBLIK.test(String(u?.projektId || "")) ? String(u.projektId) : "",
    dobavljacId: ID_OBLIK.test(String(u?.dobavljacId || "")) ? String(u.dobavljacId) : "",
    opis: tekst(u?.opis, 4000),
    evidentiraoId: ID_OBLIK.test(String(u?.evidentiraoId || "")) ? String(u.evidentiraoId) : "",
    evidentirao: tekst(u?.evidentirao, 120),
    nositeljId: ID_OBLIK.test(String(u?.nositeljId || "")) ? String(u.nositeljId) : "",
    uzrok: tekst(u?.uzrok, 2000),
    mjere: (Array.isArray(u?.mjere) ? u.mjere : []).filter((m, i, s) => MJERE.includes(m) && s.indexOf(m) === i),
    aktivnosti: a,
    napomena: tekst(u?.napomena, 2000),
    ocjena: tekst(prije.ocjena, 2000),
    ucinkovito: prije.ucinkovito ?? null,
    nositeljPotvrda: prije.nositeljPotvrda || null,
    ocijenio: prije.ocijenio || null,
  };
}
// Status iz sadržaja (osim kad ga je postavila radnja: čeka ocjenu, zatvorena, poništena).
const statusIzSadrzaja = (p, trenutni) => (["Čeka ocjenu", ...ZAVRSNI].includes(trenutni) ? trenutni : (p.uzrok || p.aktivnosti.length ? "Mjere u tijeku" : "Otvorena"));

// Željeni podsjetnici (zadaci sustava) za sve nesukladnosti; ključ zadatka sadrži sve što, kad se promijeni, opravdava novi podsjetnik.
function zeljeniZadaci(zapisi, sukoId, danas, ime) {
  const out = [];
  for (const z of zapisi) {
    const p = z.podaci || {};
    const oznaka = `Nesukladnost ${oznakaBroja(z.godina, z.broj)}${p.projektSifra ? ` (${p.projektSifra})` : ""}`;
    if (ZAVRSNI.includes(z.status)) continue;
    if (z.status === "Čeka ocjenu") {
      if (sukoId) out.push({ kljuc: `ns:${z.id}:ocjena:${p.nositeljPotvrda?.vrijeme || ""}`, nsId: z.id, dodijeljenoId: sukoId, naziv: `${oznaka}: ocijeni učinkovitost mjera i zatvori (Kontrola kvalitete → Nesukladnosti)`, rok: null });
      continue;
    }
    if (!p.nositeljId) continue;
    if (z.status === "Otvorena" && p.nositeljId !== z.kreirao_id) out.push({ kljuc: `ns:${z.id}:nositelj:${p.nositeljId}`, nsId: z.id, dodijeljenoId: p.nositeljId, naziv: `${oznaka}: ti si nositelj — upiši uzrok i mjere (Kontrola kvalitete → Nesukladnosti)`, rok: null });
    for (const a of p.aktivnosti || []) {
      if (a.rok && !a.provedeno && a.rok < danas) out.push({ kljuc: `ns:${z.id}:akt:${a.id}:${a.rok}`, nsId: z.id, dodijeljenoId: p.nositeljId, naziv: `${oznaka}: rok aktivnosti je prošao (${a.rok.split("-").reverse().join(".")}.) — »${a.opis || "aktivnost"}«${a.odgovoran ? `, odgovoran: ${a.odgovoran}` : ""}`, rok: a.rok });
    }
  }
  return out;
}
// Usklađivanje popisa zadataka: dodaj željene koji nikad nisu postojali, zatvori otvorene koji više nisu potrebni. Ručno završen zadatak se ne vraća.
function uskladiZadatke(zadaci, zeljeni, sada, noviId) {
  const postojeci = Array.isArray(zadaci) ? zadaci : [];
  const zeljeniKljucevi = new Set(zeljeni.map((z) => z.kljuc));
  let promjena = false;
  const zatvoreni = postojeci.map((z) => {
    if (!z.nesukladnostKljuc || z.izvrseno || zeljeniKljucevi.has(z.nesukladnostKljuc)) return z;
    promjena = true;
    return { ...z, izvrseno: true, izvrsioId: "sustav", datumIzvrsenja: sada, dodjelaVidjena: true };
  });
  const novi = zeljeni.filter((z) => !postojeci.some((x) => x.nesukladnostKljuc === z.kljuc)).map((z) => ({
    id: noviId(), naziv: z.naziv, dodijeljenoId: z.dodijeljenoId, planiraniDatum: z.rok || null, izvrseno: false, izvrsioId: null, datumIzvrsenja: null,
    kreiraoId: "sustav", zadaoId: "sustav", zadanoDatum: sada, dodjelaVidjena: false, nesukladnostKljuc: z.kljuc, nesukladnostId: z.nsId,
  }));
  return { zadaci: [...zatvoreni, ...novi], promjena: promjena || novi.length > 0 };
}

const SQL = {
  popis: "SELECT id, godina, broj, podaci, status, verzija, kreirano, izmijenjeno, kreirao_id, z_ukljuceno, z_mapa, pdf_verzija, pdf_z_verzija, z_putanja, z_greska, uvoz, (SELECT count(*) FROM nesukladnosti_slike s WHERE s.ns_id = nesukladnosti.id) AS slika FROM nesukladnosti WHERE godina = $1 ORDER BY broj DESC",
  godine: "SELECT DISTINCT godina FROM nesukladnosti ORDER BY godina DESC",
  jedan: "SELECT id, godina, broj, podaci, status, verzija, kreirano, izmijenjeno, kreirao_id, z_ukljuceno, z_mapa, pdf_verzija, pdf_z_verzija, z_putanja, z_greska, uvoz FROM nesukladnosti WHERE id = $1",
  sljedeci: "SELECT COALESCE(MAX(broj), 0) + 1 AS sljedeci FROM nesukladnosti WHERE godina = $1",
  unos: "INSERT INTO nesukladnosti (id, godina, broj, podaci, status, kreirao_id, izmijenio_id, z_mapa) VALUES ($1,$2,$3,$4,$5,$6,$6,$7)",
  izmjena: "UPDATE nesukladnosti SET podaci = $2, status = $3, verzija = verzija + 1, izmijenjeno = now(), izmijenio_id = $4 WHERE id = $1 AND verzija = $5",
  // Uvezene iz starog Worda ne šalju podsjetnike dok ih netko u ERP-u ne spremi (inače bi stigli deseci zadataka za stare rokove).
  zaPodsjetnike: "SELECT id, godina, broj, podaci, status, kreirao_id FROM nesukladnosti WHERE status NOT IN ('Zatvorena', 'Poništena') AND NOT (uvoz AND verzija = 1)",
  slike: "SELECT id, ns_id, redni, naziv, vrsta, kreirano, spremljeno_z, z_greska, (slicica IS NOT NULL) AS ima_slicicu FROM nesukladnosti_slike WHERE ns_id = $1 ORDER BY redni",
  slika: "SELECT id, ns_id, vrsta, slika, slicica, spremljeno_z, kreirano FROM nesukladnosti_slike WHERE id = $1",
  slikaBroj: "SELECT COUNT(*) AS n FROM nesukladnosti_slike WHERE ns_id = $1",
  slikaSljedeci: "SELECT COALESCE(MAX(redni), 0) + 1 AS sljedeci FROM nesukladnosti_slike WHERE ns_id = $1",
  slikaPoZahtjevu: "SELECT id, naziv FROM nesukladnosti_slike WHERE zahtjev_id = $1",
  slikaUnos: "INSERT INTO nesukladnosti_slike (id, ns_id, redni, naziv, vrsta, slika, slicica, kreirao_id, zahtjev_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
  slikaObrisi: "DELETE FROM nesukladnosti_slike WHERE id = $1",
  pdfSpremi: "INSERT INTO nesukladnosti_pdf (ns_id, pdf, kreirano) VALUES ($1, $2, now()) ON CONFLICT (ns_id) DO UPDATE SET pdf = EXCLUDED.pdf, kreirano = now()",
  pdfVerzija: "UPDATE nesukladnosti SET pdf_verzija = pdf_verzija + 1 WHERE id = $1",
  pdfCitaj: "SELECT pdf FROM nesukladnosti_pdf WHERE ns_id = $1",
  ukljuciZ: "UPDATE nesukladnosti SET z_ukljuceno = true WHERE id = $1",
  mostPdf: "SELECT id, godina, broj, z_mapa, pdf_verzija FROM nesukladnosti WHERE z_ukljuceno AND pdf_verzija > pdf_z_verzija AND (z_pokusaj IS NULL OR z_pokusaj < now() - interval '10 minutes') ORDER BY izmijenjeno LIMIT 10",
  mostSlike: "SELECT s.id, s.naziv, s.vrsta, n.godina, n.z_mapa FROM nesukladnosti_slike s JOIN nesukladnosti n ON n.id = s.ns_id WHERE n.z_ukljuceno AND s.spremljeno_z IS NULL AND (s.z_pokusaj IS NULL OR s.z_pokusaj < now() - interval '10 minutes') ORDER BY s.kreirano LIMIT 20",
  mostPdfGotovo: "UPDATE nesukladnosti SET pdf_z_verzija = GREATEST(pdf_z_verzija, $2), z_putanja = $3, z_greska = '', z_pokusaj = now() WHERE id = $1",
  mostPdfGreska: "UPDATE nesukladnosti SET z_greska = $2, z_pokusaj = now() WHERE id = $1",
  mostSlikaGotovo: "UPDATE nesukladnosti_slike SET spremljeno_z = now(), z_putanja = $2, z_greska = '', z_pokusaj = now() WHERE id = $1",
  mostSlikaGreska: "UPDATE nesukladnosti_slike SET z_greska = $2, z_pokusaj = now() WHERE id = $1",
  postavka: "SELECT vrijednost FROM nesukladnosti_postavke WHERE kljuc = $1",
  postavkaSpremi: "INSERT INTO nesukladnosti_postavke (kljuc, vrijednost) VALUES ($1, $2) ON CONFLICT (kljuc) DO UPDATE SET vrijednost = EXCLUDED.vrijednost",
};

function registrirajNesukladnosti(app, d) {
  const express = require("express");
  const { pool, autentikacija, ucitajPozicijuZaposlenika, dozvolaZaKarticu, ucitajKljuc, mostAutentikacija } = d;

  const pripremi = async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS nesukladnosti (
        id text PRIMARY KEY, godina integer NOT NULL, broj integer NOT NULL, podaci jsonb NOT NULL, status text NOT NULL DEFAULT 'Otvorena',
        verzija integer NOT NULL DEFAULT 1, kreirano timestamptz NOT NULL DEFAULT now(), izmijenjeno timestamptz NOT NULL DEFAULT now(), kreirao_id text, izmijenio_id text,
        uvoz boolean NOT NULL DEFAULT false, z_ukljuceno boolean NOT NULL DEFAULT true, z_mapa text NOT NULL DEFAULT '',
        pdf_verzija integer NOT NULL DEFAULT 0, pdf_z_verzija integer NOT NULL DEFAULT 0, z_putanja text NOT NULL DEFAULT '', z_greska text NOT NULL DEFAULT '', z_pokusaj timestamptz)`);
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_nesukladnosti_broj ON nesukladnosti (godina, broj)");
      await pool.query(`CREATE TABLE IF NOT EXISTS nesukladnosti_slike (
        id text PRIMARY KEY, ns_id text NOT NULL, redni integer NOT NULL, naziv text NOT NULL, vrsta text NOT NULL DEFAULT 'jpg', slika bytea NOT NULL, slicica bytea,
        kreirano timestamptz NOT NULL DEFAULT now(), kreirao_id text, zahtjev_id text, spremljeno_z timestamptz, z_putanja text NOT NULL DEFAULT '', z_greska text NOT NULL DEFAULT '', z_pokusaj timestamptz)`);
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_nesukladnosti_slike_redni ON nesukladnosti_slike (ns_id, redni)");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_nesukladnosti_slike_zahtjev ON nesukladnosti_slike (zahtjev_id) WHERE zahtjev_id IS NOT NULL");
      await pool.query("CREATE TABLE IF NOT EXISTS nesukladnosti_pdf (ns_id text PRIMARY KEY, pdf bytea NOT NULL, kreirano timestamptz NOT NULL DEFAULT now())");
      await pool.query("CREATE TABLE IF NOT EXISTS nesukladnosti_postavke (kljuc text PRIMARY KEY, vrijednost text NOT NULL DEFAULT '')");
      for (const t of ["nesukladnosti", "nesukladnosti_slike", "nesukladnosti_pdf", "nesukladnosti_postavke"]) {
        await pool.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
        await pool.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON ${t} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON ${t} FROM authenticated; END IF; END $$`);
      }
      await dodajVoditeljuProizvodnje().catch((e) => console.error("Nesukladnosti — pozicija voditelja proizvodnje:", e.message));
      const krug = () => uskladiPodsjetnike().catch((e) => console.error("Podsjetnici nesukladnosti:", e.message));
      setTimeout(krug, 20_000).unref();
      setInterval(krug, 60 * 60 * 1000).unref();
    } catch (e) {
      console.error("Greška kod pripreme tablica nesukladnosti:", e);
    }
  };

  // Jednokratno (oznaka u nesukladnosti_postavke): voditelj proizvodnje bilježi nesukladnosti, pa njegova pozicija dobiva modul Kontrola kvalitete
  // SAMO s karticom Nesukladnosti (Matična knjiga i Ugrađeni materijal isključeni). Ako admin to poslije promijeni, ne vraća se.
  const dodajVoditeljuProizvodnje = async () => {
    if ((await pool.query(SQL.postavka, ["migracijaVoditeljProizvodnje"])).rows[0]) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pozicije = (await client.query("SELECT value FROM app_data WHERE key = 'pozicijeZaposlenika' FOR UPDATE")).rows[0]?.value;
      const vp = Array.isArray(pozicije) ? pozicije.find((p) => p.id === "poz-voditelj-proizvodnje") : null;
      if (vp && !(vp.moduli || []).includes("kontrola")) {
        const nove = pozicije.map((p) => (p.id !== vp.id ? p : {
          ...p, moduli: [...(p.moduli || []), "kontrola"],
          karticeDozvole: { ...(p.karticeDozvole || {}), kontrola: { maticna: { pristup: false, izmjene: false }, ugradeni: { pristup: false, izmjene: false } } },
        }));
        await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'pozicijeZaposlenika'", [JSON.stringify(nove)]);
        console.log("Nesukladnosti: pozicija Voditelj proizvodnje dobila je karticu Kontrola kvalitete → Nesukladnosti.");
      }
      await client.query(SQL.postavkaSpremi, ["migracijaVoditeljProizvodnje", new Date().toISOString()]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  };

  const obradi = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
      console.error("Greška nesukladnosti:", e);
      res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
    }
  };
  const sukoId = async () => (await pool.query(SQL.postavka, ["sukoId"])).rows[0]?.vrijednost || "";
  // Ovlasti: kartica kontrola.nesukladnosti (pristup = čitanje, izmjene = unos i uređivanje odjeljaka 1–2); SUKO i glavni administrator = ocjena i zatvaranje.
  const ovlasti = async (req) => {
    const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
    const moduli = pozicija?.moduli?.length ? pozicija.moduli : ["dashboard"];
    const dz = dozvolaZaKarticu(pozicija, "kontrola", "nesukladnosti");
    const kartica = moduli.includes("kontrola") && dz.pristup;
    const suko = await sukoId();
    const jeSuko = (!!suko && suko === req.zaposlenikId) || pozicija?.id === "poz-administrator";
    return { citanje: kartica || jeSuko, izmjene: (kartica && dz.izmjene) || jeSuko, jeSuko, sukoId: suko };
  };
  const trazi = async (req, vrsta) => { const o = await ovlasti(req); if (!o[vrsta]) throw greska(403, vrsta === "citanje" ? "Vaša pozicija nema pristup nesukladnostima." : "Vaša pozicija nema ovlaštenje za unos nesukladnosti."); return o; };
  const zaposlenikIme = async (id) => { const z = ((await ucitajKljuc("zaposlenici")) || []).find((x) => x.id === id); return z ? `${z.ime} ${z.prezime}`.trim() : ""; };
  const javni = (r) => ({ id: r.id, godina: Number(r.godina), broj: Number(r.broj), oznaka: oznakaBroja(r.godina, r.broj), podaci: r.podaci, status: r.status, verzija: Number(r.verzija), kreirano: r.kreirano, izmijenjeno: r.izmijenjeno, kreiraoId: r.kreirao_id || "", uvoz: !!r.uvoz, z: { ukljuceno: !!r.z_ukljuceno, mapa: r.z_mapa, pdfVerzija: Number(r.pdf_verzija) || 0, pdfNaZ: Number(r.pdf_z_verzija) || 0, putanja: r.z_putanja || "", greska: r.z_greska || "" }, ...(r.slika !== undefined ? { brojSlika: Number(r.slika) || 0 } : {}) });
  const ucitaj = async (id) => { if (!ID_OBLIK.test(String(id))) throw greska(400, "Neispravna nesukladnost."); const r = (await pool.query(SQL.jedan, [id])).rows[0]; if (!r) throw greska(404, "Nesukladnost nije pronađena."); return r; };
  // Projekt (šifra) se upisuje i u podatke da popis i podsjetnici ne ovise o učitavanju projekata.
  const dopuniProjekt = async (p) => { const pr = p.projektId ? ((await ucitajKljuc("projekti")) || []).find((x) => x.id === p.projektId) : null; return { ...p, projektId: pr ? pr.id : "", projektSifra: pr?.sifra || "", projektNaziv: pr?.naziv || "" }; };

  // Podsjetnici (zadaci iz sustava) — nakon svake izmjene i jednom na sat (rokovi prolaze i bez izmjene).
  const uskladiPodsjetnike = async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const zapisi = (await client.query(SQL.zaPodsjetnike)).rows;
      const suko = (await client.query(SQL.postavka, ["sukoId"])).rows[0]?.vrijednost || "";
      const zadaci = (await client.query("SELECT value FROM app_data WHERE key = $1 FOR UPDATE", ["slobodniZadaci"])).rows[0]?.value;
      if (!Array.isArray(zadaci)) { await client.query("ROLLBACK"); return; }
      const r = uskladiZadatke(zadaci, zeljeniZadaci(zapisi, suko, zagrebDatum()), new Date().toISOString(), () => `sz-ns-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
      if (r.promjena) await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'slobodniZadaci'", [JSON.stringify(r.zadaci)]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  };
  const podsjetnici = () => uskladiPodsjetnike().catch((e) => console.error("Podsjetnici nesukladnosti:", e.message));

  // ---------------- Popis, zapis, postavke ----------------
  app.get("/api/nesukladnosti", autentikacija, obradi(async (req, res) => {
    const o = await trazi(req, "citanje");
    const godina = Number(req.query.godina) || Number(zagrebDatum().slice(0, 4));
    const [r, g] = await Promise.all([pool.query(SQL.popis, [godina]), pool.query(SQL.godine)]);
    res.json({ godina, godine: g.rows.map((x) => Number(x.godina)), zapisi: r.rows.map(javni), ovlasti: { izmjene: o.izmjene, jeSuko: o.jeSuko }, sukoId: o.sukoId });
  }));
  app.get("/api/nesukladnosti/postavke", autentikacija, obradi(async (req, res) => { const o = await trazi(req, "citanje"); res.json({ sukoId: o.sukoId, jeSuko: o.jeSuko }); }));
  app.put("/api/nesukladnosti/postavke", autentikacija, obradi(async (req, res) => {
    const o = await ovlasti(req);
    if (!o.jeSuko) throw greska(403, "Predstavnika uprave (SUKO) mijenja glavni administrator ili sadašnji SUKO.");
    const id = String(req.body?.sukoId || "");
    if (id && !((await ucitajKljuc("zaposlenici")) || []).some((z) => z.id === id)) throw greska(400, "Zaposlenik nije pronađen.");
    await pool.query(SQL.postavkaSpremi, ["sukoId", id]);
    podsjetnici();
    res.json({ ok: true, sukoId: id });
  }));
  app.get("/api/nesukladnosti/:id", autentikacija, obradi(async (req, res) => {
    await trazi(req, "citanje");
    const r = await ucitaj(req.params.id);
    const s = await pool.query(SQL.slike, [r.id]);
    res.json({ zapis: javni(r), slike: s.rows.map((x) => ({ id: x.id, redni: Number(x.redni), naziv: x.naziv, vrsta: x.vrsta, kreirano: x.kreirano, naZ: !!x.spremljeno_z, greskaZ: x.z_greska || "", imaSlicicu: !!x.ima_slicicu })) });
  }));

  app.post("/api/nesukladnosti", autentikacija, obradi(async (req, res) => {
    await trazi(req, "izmjene");
    let p = await dopuniProjekt(ocistiPodatke(req.body?.podaci));
    if (!p.opis) throw greska(400, "Upiši opis nesukladnosti.");
    if (!p.evidentiraoId && !p.evidentirao) { p.evidentiraoId = req.zaposlenikId; }
    if (p.evidentiraoId && !p.evidentirao) p.evidentirao = await zaposlenikIme(p.evidentiraoId);
    p.nositelj = p.nositeljId ? await zaposlenikIme(p.nositeljId) : "";
    const godina = Number(p.datum.slice(0, 4));
    for (let pokusaj = 0; pokusaj < 4; pokusaj++) {
      const broj = Number((await pool.query(SQL.sljedeci, [godina])).rows[0]?.sljedeci || 1);
      const id = `ns-${crypto.randomUUID()}`;
      try {
        await pool.query(SQL.unos, [id, godina, broj, JSON.stringify(p), statusIzSadrzaja(p, "Otvorena"), req.zaposlenikId, nazivMapeZ(godina, broj, p.projektSifra)]);
        podsjetnici();
        return res.json({ ok: true, zapis: javni(await ucitaj(id)) });
      } catch (e) { if (pokusaj === 3 || !/duplicate key|unique/i.test(String(e?.message))) throw e; }
    }
  }));

  // Izmjena + radnje. verzija = verzija koju je preglednik učitao; ako je netko u međuvremenu spremio, odgovor je 409 (ništa se ne prepisuje).
  app.put("/api/nesukladnosti/:id", autentikacija, obradi(async (req, res) => {
    const o = await trazi(req, "izmjene");
    const r = await ucitaj(req.params.id);
    if (Number(req.body?.verzija) !== Number(r.verzija)) throw greska(409, "Netko je u međuvremenu spremio ovu nesukladnost — zatvori je i otvori ponovno pa ponovi izmjenu.");
    const akcija = String(req.body?.akcija || "spremi");
    const prije = r.podaci || {};
    let status = r.status;
    if (ZAVRSNI.includes(status) && akcija !== "ponovno_otvori") throw greska(409, `Nesukladnost je ${status.toLowerCase()} — izmjene nisu moguće (SUKO je može ponovno otvoriti).`);
    if (status === "Čeka ocjenu" && !o.jeSuko && !["spremi"].includes(akcija)) throw greska(409, "Nesukladnost čeka ocjenu SUKO-a.");
    let p = await dopuniProjekt(ocistiPodatke(req.body?.podaci || prije, prije));
    p.evidentirao = p.evidentirao || (p.evidentiraoId ? await zaposlenikIme(p.evidentiraoId) : "");
    p.nositelj = p.nositeljId ? await zaposlenikIme(p.nositeljId) : "";
    const ja = { id: req.zaposlenikId, ime: await zaposlenikIme(req.zaposlenikId), vrijeme: new Date().toISOString() };
    const suko = (opis) => { if (!o.jeSuko) throw greska(403, `${opis} smije samo predstavnik uprave za kvalitetu i okoliš (SUKO).`); };
    if (!p.opis) throw greska(400, "Upiši opis nesukladnosti.");
    if (akcija === "na_ocjenu") {
      if (!p.uzrok || !p.mjere.length || !p.aktivnosti.length) throw greska(400, "Za slanje na ocjenu upiši uzrok, odaberi vrstu mjere i dodaj barem jednu aktivnost.");
      p.nositeljPotvrda = ja; status = "Čeka ocjenu";
    } else if (akcija === "zatvori") {
      suko("Zatvaranje"); const ocj = tekst(req.body?.ocjena, 2000); if (!ocj) throw greska(400, "Upiši ocjenu učinkovitosti poduzete mjere.");
      p.ocjena = ocj; p.ucinkovito = true; p.ocijenio = ja; status = "Zatvorena";
    } else if (akcija === "neucinkovito") {
      suko("Ocjenu"); const ocj = tekst(req.body?.ocjena, 2000); if (!ocj) throw greska(400, "Upiši zašto mjera nije učinkovita.");
      p.ocjena = ocj; p.ucinkovito = false; p.ocijenio = ja; p.nositeljPotvrda = null; status = "Mjere u tijeku";
    } else if (akcija === "ponovno_otvori") {
      suko("Ponovno otvaranje"); if (!ZAVRSNI.includes(r.status)) throw greska(409, "Nesukladnost nije zatvorena.");
      p = { ...ocistiPodatke(prije, prije), projektId: prije.projektId || "", projektSifra: prije.projektSifra || "", projektNaziv: prije.projektNaziv || "", evidentirao: prije.evidentirao || "", nositelj: prije.nositelj || "", nositeljPotvrda: null }; status = "Mjere u tijeku";
    } else if (akcija === "ponisti") {
      suko("Poništavanje"); status = "Poništena"; p.ocijenio = ja; p.ocjena = tekst(req.body?.ocjena, 2000) || p.ocjena;
    } else if (akcija !== "spremi") throw greska(400, "Nepoznata radnja.");
    if (akcija === "spremi") status = statusIzSadrzaja(p, status);
    const u = await pool.query(SQL.izmjena, [r.id, JSON.stringify(p), status, req.zaposlenikId, r.verzija]);
    if (!u.rowCount) throw greska(409, "Netko je u međuvremenu spremio ovu nesukladnost — zatvori je i otvori ponovno pa ponovi izmjenu.");
    podsjetnici();
    res.json({ ok: true, zapis: javni(await ucitaj(r.id)) });
  }));

  // ---------------- Slike ----------------
  app.post("/api/nesukladnosti/:id/slika", autentikacija, obradi(async (req, res) => {
    await trazi(req, "izmjene");
    const r = await ucitaj(req.params.id);
    if (ZAVRSNI.includes(r.status)) throw greska(409, "Nesukladnost je zatvorena.");
    const slika = dekodirajSliku(req.body?.slika, MAX_SLIKA_BAJTOVA);
    const slicica = req.body?.slicica ? dekodirajSliku(req.body.slicica, MAX_SLICICA) : null;
    if (!slika) throw greska(400, "Slika nije ispravna (JPEG ili PNG, najviše 4 MB).");
    const zahtjevId = ID_OBLIK.test(String(req.body?.zahtjevId || "")) ? String(req.body.zahtjevId) : null;
    if (zahtjevId) { const p = (await pool.query(SQL.slikaPoZahtjevu, [zahtjevId])).rows[0]; if (p) return res.json({ ok: true, id: p.id, naziv: p.naziv, ponovljeno: true }); }
    if (Number((await pool.query(SQL.slikaBroj, [r.id])).rows[0]?.n || 0) >= MAX_SLIKA_PO_NS) throw greska(409, `Nesukladnost već ima ${MAX_SLIKA_PO_NS} slika.`);
    const vrsta = vrstaSlike(slika);
    for (let pokusaj = 0; pokusaj < 4; pokusaj++) {
      const redni = Number((await pool.query(SQL.slikaSljedeci, [r.id])).rows[0]?.sljedeci || 1);
      const id = crypto.randomUUID();
      const naziv = `${oznakaMape(r.godina, r.broj)}_${String(redni).padStart(2, "0")}.${vrsta}`;
      try {
        await pool.query(SQL.slikaUnos, [id, r.id, redni, naziv, vrsta, slika, slicica, req.zaposlenikId, zahtjevId]);
        return res.json({ ok: true, id, naziv });
      } catch (e) { if (pokusaj === 3 || !/duplicate key|unique/i.test(String(e?.message))) throw e; }
    }
  }));
  app.get("/api/nesukladnosti/slika/:sid", autentikacija, obradi(async (req, res) => {
    await trazi(req, "citanje");
    if (!ID_OBLIK.test(req.params.sid)) throw greska(400, "Neispravna slika.");
    const s = (await pool.query(SQL.slika, [req.params.sid])).rows[0];
    if (!s) throw greska(404, "Slika nije pronađena.");
    const mala = req.query.original !== "1" && s.slicica;
    res.set({ "Content-Type": mala || s.vrsta !== "png" ? "image/jpeg" : "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.send(mala ? s.slicica : s.slika);
  }));
  app.delete("/api/nesukladnosti/:id/slika/:sid", autentikacija, obradi(async (req, res) => {
    await trazi(req, "izmjene");
    const r = await ucitaj(req.params.id);
    if (ZAVRSNI.includes(r.status)) throw greska(409, "Nesukladnost je zatvorena.");
    if (!ID_OBLIK.test(req.params.sid)) throw greska(400, "Neispravna slika.");
    const s = (await pool.query(SQL.slika, [req.params.sid])).rows[0];
    if (!s || s.ns_id !== r.id) throw greska(404, "Slika nije pronađena.");
    await pool.query(SQL.slikaObrisi, [s.id]);
    res.json({ ok: true });
  }));

  // ---------------- PDF obrasca (izrađuje ga preglednik; ovdje se čuva zadnji i šalje mostu) ----------------
  app.put("/api/nesukladnosti/:id/pdf", autentikacija, express.raw({ type: "application/pdf", limit: MAX_PDF }), obradi(async (req, res) => {
    await trazi(req, "izmjene");
    const r = await ucitaj(req.params.id);
    const b = req.body;
    if (!Buffer.isBuffer(b) || b.length < 100 || b.slice(0, 5).toString() !== "%PDF-") throw greska(400, "Datoteka nije PDF.");
    await pool.query(SQL.pdfSpremi, [r.id, b]);
    await pool.query(SQL.pdfVerzija, [r.id]);
    if (req.query.naZ === "1") await pool.query(SQL.ukljuciZ, [r.id]);
    res.json({ ok: true });
  }));
  app.get("/api/nesukladnosti/:id/pdf", autentikacija, obradi(async (req, res) => {
    await trazi(req, "citanje");
    const r = await ucitaj(req.params.id);
    const p = (await pool.query(SQL.pdfCitaj, [r.id])).rows[0];
    if (!p) throw greska(404, "PDF još nije izrađen.");
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nazivPdf(r.godina, r.broj)}"` });
    res.send(p.pdf);
  }));

  // ---------------- Most: PDF i slike u <mapa nesukladnosti>\<godina>\<NN-GG …>\ ----------------
  app.get("/api/most/nesukladnosti/cekaju", mostAutentikacija, obradi(async (req, res) => {
    const [p, s] = await Promise.all([pool.query(SQL.mostPdf), pool.query(SQL.mostSlike)]);
    res.json({
      datoteke: [
        ...p.rows.map((x) => ({ vrsta: "pdf", id: x.id, godina: Number(x.godina), mapa: x.z_mapa, naziv: nazivPdf(x.godina, x.broj), verzija: Number(x.pdf_verzija) })),
        ...s.rows.map((x) => ({ vrsta: "slika", id: x.id, godina: Number(x.godina), mapa: x.z_mapa, naziv: x.naziv })),
      ],
    });
  }));
  app.get("/api/most/nesukladnosti/datoteka/:vrsta/:id", mostAutentikacija, obradi(async (req, res) => {
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna datoteka.");
    if (req.params.vrsta === "pdf") {
      const p = (await pool.query(SQL.pdfCitaj, [req.params.id])).rows[0];
      if (!p) throw greska(404, "PDF nije pronađen.");
      res.set("Content-Type", "application/pdf"); return res.send(p.pdf);
    }
    const s = (await pool.query(SQL.slika, [req.params.id])).rows[0];
    if (!s) throw greska(404, "Slika nije pronađena.");
    res.set("Content-Type", s.vrsta === "png" ? "image/png" : "image/jpeg"); res.send(s.slika);
  }));
  app.post("/api/most/nesukladnosti/rezultat/:vrsta/:id", mostAutentikacija, obradi(async (req, res) => {
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna datoteka.");
    const b = req.body || {};
    const ok = b.status === "spremljeno";
    const r = req.params.vrsta === "pdf"
      ? (ok ? await pool.query(SQL.mostPdfGotovo, [req.params.id, Number(b.verzija) || 0, tekst(b.putanja, 500)]) : await pool.query(SQL.mostPdfGreska, [req.params.id, tekst(b.poruka, 300) || "Nepoznata greška."]))
      : (ok ? await pool.query(SQL.mostSlikaGotovo, [req.params.id, tekst(b.putanja, 500)]) : await pool.query(SQL.mostSlikaGreska, [req.params.id, tekst(b.poruka, 300) || "Nepoznata greška."]));
    if (!r.rowCount) throw greska(404, "Datoteka nije pronađena.");
    res.json({ ok: true });
  }));

  return { pripremi, uskladiPodsjetnike };
}

module.exports = { registrirajNesukladnosti, ocistiPodatke, statusIzSadrzaja, zeljeniZadaci, uskladiZadatke, nazivMapeZ, nazivPdf, oznakaBroja, oznakaMape, vrstaSlike, IZVORI, MJERE, STATUSI };

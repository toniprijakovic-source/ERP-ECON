// Veza s mostom na serveru ECON-R550 (most/most.js): trajni red zadataka, stanje servera s upozorenjima i automatska "Mapa projekta".
//
// RED ZADATAKA (XRechnung, kumulativ, popis i brisanje XRechnunga): ERP je na internetu i ne vidi Z:, pa "Kreiraj XRechnung" samo upiše
// zadatak; most svakih par sekundi pita ima li zadataka (GET /api/most/zadaci), obradi ih na serveru i vrati rezultat. Most se prijavljuje
// tajnom MOST_TOKEN (zaglavlje X-Most-Token) i samo se javlja ovamo — ništa se ne otvara prema vani. Od 2026-11 red je u tablici
// most_zadaci (prije u memoriji): objava ili restart poslužitelja više ne briše zadatke koji čekaju ni rezultate.
//
// STANJE SERVERA: most svake minute pošalje izvještaj (pogon Z:, sigurnosne kopije, probna obnova, slobodan prostor — most/lib/stanje.js).
// Poslužitelj pamti izvještaj i zadnji kontakt mosta (tablica most_stanje) i svakih nekoliko minuta provjerava upozorenja
// (stanje-servera.js): upozorenje postaje zadatak u zvoncu odabrane osobe i samo se zatvara kad uzrok nestane. Pregled je u
// Direktorski pregled → Stanje servera.
//
// MAPA PROJEKTA: most svakih 10 minuta uzme projekte bez upisane mape i potraži mapu po šifri (most/lib/mapa.js); pronađenu putanju
// poslužitelj upiše SAMO ako je polje i dalje prazno (ručno upisana mapa se nikad ne mijenja).
const crypto = require("crypto");
const { izracunajUpozorenja, uskladiZadatke, MOST_SUTI_MIN } = require("./stanje-servera");

const XR_STATUSI_ZAVRSNI = ["Valjano", "Nevaljano", "Greška", "Gotovo"];
// Vrste zadataka: izrada XRechnunga te čitanje/spremanje postavki kumulativa (kumulativ.json u mapi računa projekta).
const XR_VRSTE = ["xrechnung", "kumulativ-citaj", "kumulativ-spremi", "xrechnung-popis", "xrechnung-obrisi"];
const OBRADA_ISTEK_MIN = 10;   // zadatak koji most nije završio u ovoliko minuta (npr. prekinut rad) ne ostaje vječno "u obradi"
const CEKANJE_ISTEK_H = 24;    // zadatak koji čeka dulje od ovoga (most nije radio) više se ne izvršava — korisnik ga zada ponovno
const CUVAJ_ZADATKE_DANA = 90;
const IZVJESTAJ_VRIJEDI_MIN = MOST_SUTI_MIN; // stariji izvještaj (npr. stari most bez izvještaja) se ne koristi za upozorenja

const tekst = (v, max) => String(v ?? "").slice(0, max);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const broj = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// Postavke kumulativa (ugovor, avans, prijašnji računi) — poslužitelj samo ograničava oblik i duljine; brojeve i smislenost provjerava most.
const xrIznos = (v) => (typeof v === "number" && Number.isFinite(v) ? v : tekst(v, 30));
const xrKumulativ = (v) => {
  if (!v || typeof v !== "object") return null;
  const isp = v.isporuka && typeof v.isporuka === "object" ? { ulica: tekst(v.isporuka.ulica, 100), posta: tekst(v.isporuka.posta, 12), grad: tekst(v.isporuka.grad, 60), drzava: tekst(v.isporuka.drzava, 2) } : undefined;
  return {
    ...(v._napomena ? { _napomena: tekst(v._napomena, 500) } : {}), ...(v.projekt ? { projekt: tekst(v.projekt, 60) } : {}), ...(v.pozicija ? { pozicija: tekst(v.pozicija, 60) } : {}),
    gesamtauftrag: xrIznos(v.gesamtauftrag), vorauszahlung: xrIznos(v.vorauszahlung),
    racuni: (Array.isArray(v.racuni) ? v.racuni.slice(0, 40) : []).map((r) => ({ oznaka: tekst(r?.oznaka, 10), vrsta: r?.vrsta === "aconto" ? "aconto" : "racun", broj: tekst(r?.broj, 40), datum: tekst(r?.datum, 10), iznos: xrIznos(r?.iznos), ...(r?.kumulativ != null ? { kumulativ: xrIznos(r.kumulativ) } : {}) })),
    ...(isp ? { isporuka: isp } : {}),
  };
};

// Rezultat koji most vrati (oblik u most/most.js, lib/obradi.js, lib/kumulativ-zadaci.js, lib/xrechnung-popis.js) — samo dopuštena polja i duljine.
function rezultatMosta(b) {
  const popis = (v, max, duljina) => (Array.isArray(v) ? v.slice(0, max).map((s) => tekst(s, duljina)) : []);
  const pravila = (v) => (Array.isArray(v) ? v.slice(0, 30).map((g) => ({ id: tekst(g?.id, 60), tekst: tekst(g?.tekst, 400) })) : []);
  return {
    poruke: popis(b.poruke, 20, 500),
    sazetak: b.sazetak && typeof b.sazetak === "object" ? Object.fromEntries(Object.entries(b.sazetak).slice(0, 20).map(([k, v]) => [tekst(k, 40), typeof v === "number" ? v : tekst(v, 200)])) : null,
    kontrole: Array.isArray(b.kontrole) ? b.kontrole.slice(0, 20).map((k) => ({ ok: !!k?.ok, opis: tekst(k?.opis, 300) })) : [],
    validacija: b.validacija ? { ocjena: tekst(b.validacija.ocjena, 30), greske: pravila(b.validacija.greske), upozorenja: pravila(b.validacija.upozorenja) } : null,
    datoteke: Array.isArray(b.datoteke) ? b.datoteke.slice(0, 10).map((d) => ({ naziv: tekst(d?.naziv, 200), putanja: tekst(d?.putanja, 500) })) : [],
    izlaznaMapa: tekst(b.izlaznaMapa, 500), probno: !!b.probno,
    kumulativ: xrKumulativ(b.kumulativ), mapaKumulativa: tekst(b.mapaKumulativa, 500),
    xrechnungi: Array.isArray(b.xrechnungi) ? b.xrechnungi.slice(0, 50).map((x) => ({
      broj: tekst(x?.broj, 40), datum: tekst(x?.datum, 10), kupac: tekst(x?.kupac, 160), eAdresa: tekst(x?.eAdresa, 254),
      zaPlatiti: Number(x?.zaPlatiti) || 0, valjan: !!x?.valjan, mapa: tekst(x?.mapa, 500), promijenjeno: tekst(x?.promijenjeno, 30),
      datoteke: Array.isArray(x?.datoteke) ? x.datoteke.slice(0, 12).map((d) => tekst(d, 200)) : [],
    })) : null,
    zadnjiRacun: b.zadnjiRacun && typeof b.zadnjiRacun === "object" ? { broj: tekst(b.zadnjiRacun.broj, 40), datum: tekst(b.zadnjiRacun.datum, 10) } : null,
  };
}

// Izvještaj mosta o serveru (most/lib/stanje.js) — samo dopuštena polja i duljine (spremljeno se prikazuje u ERP-u).
function izvjestajMosta(b) {
  const v = (x) => tekst(x, 40);
  const disk = (d) => (d && typeof d === "object" ? { oznaka: tekst(d.oznaka, 20), slobodnoGB: broj(d.slobodnoGB), ukupnoGB: broj(d.ukupnoGB) } : null);
  const k = b.kopije && typeof b.kopije === "object" ? b.kopije : null;
  const z = k?.zadnja && typeof k.zadnja === "object" ? k.zadnja : null;
  const o = k?.obnova && typeof k.obnova === "object" ? k.obnova : null;
  return {
    verzija: tekst(b.verzija, 40), racunalo: tekst(b.racunalo, 60), pokrenut: v(b.pokrenut), probno: !!b.probno, sat: v(b.sat),
    pogoni: Array.isArray(b.pogoni) ? b.pogoni.slice(0, 10).map((p) => ({ slovo: tekst(p?.slovo, 4), ok: !!p?.ok, opis: tekst(p?.opis, 300) })) : [],
    korijeni: Array.isArray(b.korijeni) ? b.korijeni.slice(0, 10).map((x) => ({ putanja: tekst(x?.putanja, 300), postoji: !!x?.postoji })) : [],
    diskovi: Array.isArray(b.diskovi) ? b.diskovi.slice(0, 6).map(disk).filter(Boolean) : [],
    kopije: k ? {
      podeseno: !!k.podeseno, mapa: tekst(k.mapa, 300), dostupna: k.dostupna !== false,
      zadnja: z ? { vrijeme: v(z.vrijeme), naziv: tekst(z.naziv, 80), velicinaKB: broj(z.velicinaKB), kljuceva: broj(z.kljuceva), dnevna: !!z.dnevna, mjesecna: !!z.mjesecna, tablice: z.tablice && typeof z.tablice === "object" ? Object.fromEntries(Object.entries(z.tablice).slice(0, 20).map(([t, n]) => [tekst(t, 40), broj(n)])) : {}, poruke: Array.isArray(z.poruke) ? z.poruke.slice(0, 5).map((p) => tekst(p, 300)) : [] } : null,
      greska: k.greska && typeof k.greska === "object" ? { vrijeme: v(k.greska.vrijeme), poruka: tekst(k.greska.poruka, 400) } : null,
      obnova: o ? { ok: !!o.ok, vrijeme: v(o.vrijeme), kopija: tekst(o.kopija, 80), trajanjeMs: broj(o.trajanjeMs), kljuceva: broj(o.kljuceva), tablice: o.tablice && typeof o.tablice === "object" ? Object.fromEntries(Object.entries(o.tablice).slice(0, 20).map(([t, n]) => [tekst(t, 40), broj(n)])) : {}, poruke: Array.isArray(o.poruke) ? o.poruke.slice(0, 10).map((p) => tekst(p, 300)) : [], greska: tekst(o.greska, 500) } : null,
    } : { podeseno: false },
  };
}

function registrirajMost(app, d) {
  const { pool, autentikacija, ucitajPozicijuZaposlenika, izracunajDozvoljeneKljuceve, dozvolaZaKarticu, ucitajKljuc, mostAutentikacija } = d;
  let mostZadnjiPut = null;      // zadnji GET /api/most/zadaci (u memoriji; "povezan" = unutar 30 s)
  let zadnjiUpisKontakta = 0;    // kontakt se u bazu upisuje najviše jednom u minuti (za upozorenje i nakon restarta poslužitelja)
  let zadnjaProvjeraNaIzvjestaj = 0;

  const obradi = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { console.error("Greška veze s mostom:", req.method, req.path, e); res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." }); }
  };
  const spremiStanje = (kljuc, vrijednost) => pool.query(
    `INSERT INTO most_stanje (kljuc, vrijednost, azurirano) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (kljuc) DO UPDATE SET vrijednost = EXCLUDED.vrijednost, azurirano = now()`, [kljuc, JSON.stringify(vrijednost)]);
  const ucitajStanje = async () => Object.fromEntries((await pool.query("SELECT kljuc, vrijednost, azurirano FROM most_stanje")).rows.map((r) => [r.kljuc, { vrijednost: r.vrijednost, azurirano: iso(r.azurirano) }]));
  const zadnjiKontakt = (st) => {
    const izBaze = Date.parse(st.kontakt?.vrijednost?.zadnjiPut || "");
    const t = Math.max(mostZadnjiPut || 0, Number.isFinite(izBaze) ? izBaze : 0);
    return t ? new Date(t).toISOString() : null;
  };
  const svjeziIzvjestaj = (st, sada) => (st.izvjestaj && sada - Date.parse(st.izvjestaj.azurirano) < IZVJESTAJ_VRIJEDI_MIN * 60000 ? st.izvjestaj.vrijednost : null);

  const pripremi = async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS most_zadaci (
        id text PRIMARY KEY, vrsta text NOT NULL, projekt_id text, status text NOT NULL, podaci jsonb NOT NULL DEFAULT '{}',
        kreirao text, kreirao_ime text NOT NULL DEFAULT '', kreirano timestamptz NOT NULL DEFAULT now(),
        preuzeto timestamptz, zavrseno timestamptz, rezultat jsonb)`);
      await pool.query("CREATE INDEX IF NOT EXISTS idx_most_zadaci_kreirano ON most_zadaci (kreirano DESC)");
      await pool.query(`CREATE TABLE IF NOT EXISTS most_stanje (
        kljuc text PRIMARY KEY, vrijednost jsonb NOT NULL DEFAULT '{}', azurirano timestamptz NOT NULL DEFAULT now())`);
      for (const t of ["most_zadaci", "most_stanje"]) {
        await pool.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
        await pool.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON ${t} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON ${t} FROM authenticated; END IF; END $$`);
      }
      const ocisti = () => pool.query(`DELETE FROM most_zadaci WHERE kreirano < now() - interval '${CUVAJ_ZADATKE_DANA} days'`).catch(() => {});
      await ocisti();
      setInterval(ocisti, 24 * 60 * 60 * 1000);
      // Prva provjera upozorenja tek nakon nekoliko minuta: nakon objave most se treba stići javiti novom poslužitelju.
      setTimeout(() => { provjeriUpozorenja(); setInterval(provjeriUpozorenja, 5 * 60 * 1000); }, 3 * 60 * 1000);
    } catch (e) {
      console.error("Greška kod pripreme tablica mosta:", e);
    }
  };

  // ---------------- Upozorenja → zadaci u zvoncu ----------------
  let provjeraUTijeku = false;
  const provjeriUpozorenja = async () => {
    if (provjeraUTijeku) return;
    provjeraUTijeku = true;
    try {
      const sada = Date.now();
      const st = await ucitajStanje();
      const upozorenja = izracunajUpozorenja({ kontakt: zadnjiKontakt(st), izvjestaj: svjeziIzvjestaj(st, sada), sada });
      const zaposlenici = (await ucitajKljuc("zaposlenici")) || [];
      const trazeni = st.postavke?.vrijednost?.primateljId || null;
      const primateljId = trazeni && zaposlenici.some((z) => z.id === trazeni) ? trazeni : null;
      const sadaIso = new Date(sada).toISOString();
      // Brza provjera bez zaključavanja: u većini prolaza nema promjene pa se popis zadataka ne dira.
      if (!uskladiZadatke((await ucitajKljuc("slobodniZadaci")) || [], upozorenja, primateljId, sadaIso).promijenjeno) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const zadaci = (await client.query("SELECT value FROM app_data WHERE key = 'slobodniZadaci' FOR UPDATE")).rows[0]?.value || [];
        const u = uskladiZadatke(zadaci, upozorenja, primateljId, sadaIso);
        if (u.promijenjeno) {
          await client.query(
            `INSERT INTO app_data (key, value, updated_at) VALUES ('slobodniZadaci', $1, now())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(u.zadaci)]);
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      console.error("Greška kod provjere stanja servera:", e);
    } finally {
      provjeraUTijeku = false;
    }
  };

  // ---------------- Red zadataka: aplikacija (kartica Financije → XRechnung) ----------------
  const xrDozvola = async (req) => izracunajDozvoljeneKljuceve(await ucitajPozicijuZaposlenika(req.zaposlenikId));
  const izRetka = (r) => {
    const p = r.podaci || {};
    return { id: r.id, vrsta: r.vrsta, racunBroj: p.racunBroj || "", projektId: r.projekt_id, sifra: p.sifra || "", naziv: p.naziv || "", eAdresa: p.eAdresa || "", referenca: p.referenca || "", status: r.status, kreiraoIme: r.kreirao_ime || "", kreirano: iso(r.kreirano), zavrseno: iso(r.zavrseno), rezultat: r.rezultat || null };
  };
  let zadnjeIstekanje = 0;
  const istekni = async () => {
    if (Date.now() - zadnjeIstekanje < 30000) return; // najviše dvaput u minuti (most pita svakih 5 s)
    zadnjeIstekanje = Date.now();
    await pool.query(`UPDATE most_zadaci SET status = 'Greška', zavrseno = now(), rezultat = $1::jsonb WHERE status = 'Obrada' AND preuzeto < now() - interval '${OBRADA_ISTEK_MIN} minutes'`,
      [JSON.stringify({ poruke: [`Most nije javio rezultat u ${OBRADA_ISTEK_MIN} minuta. Pokušaj ponovno.`] })]);
    await pool.query(`UPDATE most_zadaci SET status = 'Greška', zavrseno = now(), rezultat = $1::jsonb WHERE status = 'Čeka' AND kreirano < now() - interval '${CEKANJE_ISTEK_H} hours'`,
      [JSON.stringify({ poruke: [`Most nije preuzeo zadatak u ${CEKANJE_ISTEK_H} sata (server ili most nije radio). Zadaj ga ponovno.`] })]);
  };
  const stanjeMosta = () => ({ povezan: !!mostZadnjiPut && Date.now() - mostZadnjiPut < 30000, zadnjiPut: mostZadnjiPut ? new Date(mostZadnjiPut).toISOString() : null });

  app.get("/api/xrechnung/zadaci", autentikacija, obradi(async (req, res) => {
    const { citljivo } = await xrDozvola(req);
    if (!citljivo.has("xrechnungPostavke")) return res.status(403).json({ error: "Vaša pozicija nema pristup kartici XRechnung." });
    await istekni();
    const r = await pool.query("SELECT id, vrsta, projekt_id, status, podaci, kreirao_ime, kreirano, zavrseno, rezultat FROM most_zadaci ORDER BY kreirano DESC LIMIT 30");
    res.json({ zadaci: r.rows.map(izRetka), most: stanjeMosta() });
  }));

  app.post("/api/xrechnung/zadaci", autentikacija, obradi(async (req, res) => {
    const { pisivo } = await xrDozvola(req);
    if (!pisivo.has("xrechnungPostavke")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za izradu XRechnunga." });
    const { projektId, eAdresa, referenca, racunBroj } = req.body || {};
    const vrsta = XR_VRSTE.includes(req.body?.vrsta) ? req.body.vrsta : "xrechnung";
    const [projekti, zaposlenici] = await Promise.all([ucitajKljuc("projekti"), ucitajKljuc("zaposlenici")]);
    const projekt = (projekti || []).find((p) => p.id === projektId);
    if (!projekt) return res.status(404).json({ error: "Projekt nije pronađen." });
    const email = String(eAdresa || "").trim();
    if (vrsta === "xrechnung" && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return res.status(400).json({ error: "E-adresa kupca nije ispravna." });
    const kumulativ = vrsta === "kumulativ-spremi" ? xrKumulativ(req.body?.kumulativ) : null;
    if (vrsta === "kumulativ-spremi" && !kumulativ) return res.status(400).json({ error: "Nedostaju podaci o kumulativu." });
    if (vrsta === "xrechnung-obrisi" && !String(racunBroj || "").trim()) return res.status(400).json({ error: "Nije zadan broj računa." });
    await istekni();
    const ja = (zaposlenici || []).find((z) => z.id === req.zaposlenikId);
    const id = crypto.randomUUID();
    const podaci = {
      sifra: tekst(projekt.sifra, 60), naziv: tekst(projekt.naziv, 160), mapa: tekst(projekt.mapa, 400),
      eAdresa: vrsta === "xrechnung" ? email : "", referenca: tekst(referenca, 100).trim(), racunBroj: tekst(racunBroj, 40).trim(), kumulativ,
    };
    // Popis izrađenih XRechnunga samo čita pa ne blokira (i ne blokira ga) druge zadatke istog projekta; ostali zadaci istog projekta idu jedan po jedan.
    const r = await pool.query(
      `INSERT INTO most_zadaci (id, vrsta, projekt_id, status, podaci, kreirao, kreirao_ime)
       SELECT $1::text, $2::text, $3::text, 'Čeka', $4::jsonb, $5::text, $6::text
       WHERE $7::boolean OR NOT EXISTS (SELECT 1 FROM most_zadaci WHERE projekt_id = $3 AND vrsta <> 'xrechnung-popis' AND status IN ('Čeka', 'Obrada'))
       RETURNING kreirano`,
      [id, vrsta, projektId, JSON.stringify(podaci), req.zaposlenikId, ja ? `${ja.ime} ${ja.prezime}` : "", vrsta === "xrechnung-popis"]);
    if (!r.rowCount) return res.status(409).json({ error: "Za ovaj projekt već postoji zadatak koji čeka ili se obrađuje." });
    res.json({ ok: true, zadatak: izRetka({ id, vrsta, projekt_id: projektId, status: "Čeka", podaci, kreirao_ime: ja ? `${ja.ime} ${ja.prezime}` : "", kreirano: r.rows[0]?.kreirano || new Date(), zavrseno: null, rezultat: null }) });
  }));

  app.delete("/api/xrechnung/zadaci/:id", autentikacija, obradi(async (req, res) => {
    const { pisivo } = await xrDozvola(req);
    if (!pisivo.has("xrechnungPostavke")) return res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za izradu XRechnunga." });
    const r = await pool.query("UPDATE most_zadaci SET status = 'Otkazano', zavrseno = now() WHERE id = $1 AND status = 'Čeka'", [req.params.id]);
    if (r.rowCount) return res.json({ ok: true });
    const postoji = (await pool.query("SELECT status FROM most_zadaci WHERE id = $1", [req.params.id])).rows.length;
    if (!postoji) return res.status(404).json({ error: "Zadatak nije pronađen." });
    res.status(409).json({ error: "Zadatak se već obrađuje ili je završen." });
  }));

  // ---------------- Red zadataka: most ----------------
  // Dohvaća i preuzima zadatke koji čekaju, najstariji prvi (svaki poziv je i "otkucaj" da je most živ).
  app.get("/api/most/zadaci", mostAutentikacija, obradi(async (req, res) => {
    mostZadnjiPut = Date.now();
    if (mostZadnjiPut - zadnjiUpisKontakta > 60000) {
      zadnjiUpisKontakta = mostZadnjiPut;
      spremiStanje("kontakt", { zadnjiPut: new Date(mostZadnjiPut).toISOString() }).catch((e) => console.error("Greška kod upisa kontakta mosta:", e.message));
    }
    await istekni();
    const r = await pool.query("UPDATE most_zadaci SET status = 'Obrada', preuzeto = now() WHERE status = 'Čeka' RETURNING id, vrsta, podaci, kreirano");
    const zadaci = r.rows.sort((a, b) => new Date(a.kreirano) - new Date(b.kreirano)).map((z) => {
      const p = z.podaci || {};
      return { id: z.id, vrsta: z.vrsta, sifra: p.sifra || "", naziv: p.naziv || "", mapa: p.mapa || "", eAdresa: p.eAdresa || "", referenca: p.referenca || "", racunBroj: p.racunBroj || "", kumulativ: p.kumulativ || null };
    });
    res.json({ zadaci });
  }));

  app.post("/api/most/zadaci/:id/rezultat", mostAutentikacija, obradi(async (req, res) => {
    const b = req.body || {};
    const status = XR_STATUSI_ZAVRSNI.includes(b.status) ? b.status : "Greška";
    const r = await pool.query("UPDATE most_zadaci SET status = $2, zavrseno = now(), rezultat = $3::jsonb WHERE id = $1", [req.params.id, status, JSON.stringify(rezultatMosta(b))]);
    if (!r.rowCount) return res.status(404).json({ error: "Zadatak nije pronađen." });
    res.json({ ok: true });
  }));

  // ---------------- Stanje servera: izvještaj mosta ----------------
  app.post("/api/most/stanje", mostAutentikacija, obradi(async (req, res) => {
    const izvjestaj = izvjestajMosta(req.body || {});
    // Pomak sata servera prema satu ERP-a (sekunde, + = server žuri). Vremena kopija i datoteka na serveru idu po satu servera.
    const satServera = Date.parse(izvjestaj.sat || "");
    izvjestaj.pomakSataS = Number.isFinite(satServera) ? Math.round((satServera - Date.now()) / 1000) : null;
    await spremiStanje("izvjestaj", izvjestaj);
    res.json({ ok: true });
    if (Date.now() - zadnjaProvjeraNaIzvjestaj > 60000) { zadnjaProvjeraNaIzvjestaj = Date.now(); provjeriUpozorenja(); }
  }));

  // ---------------- Mapa projekta ----------------
  // Projekti kojima "Mapa projekta" nije upisana (arhivirani se ne gledaju).
  app.get("/api/most/projekti-bez-mape", mostAutentikacija, obradi(async (req, res) => {
    const projekti = (await ucitajKljuc("projekti")) || [];
    res.json({ projekti: projekti.filter((p) => p && String(p.sifra || "").trim() && !String(p.mapa || "").trim() && p.status !== "Arhiviran").map((p) => ({ id: p.id, sifra: String(p.sifra).trim() })) });
  }));
  // Most javlja pronađene mape (i za koje projekte mapu nije našao, s razlogom). Upisuje se samo u projekt kojem je mapa i dalje prazna.
  app.post("/api/most/projekti/mapa", mostAutentikacija, obradi(async (req, res) => {
    const b = req.body || {};
    const PUTANJA = /^(?:[A-Za-z]:[\\/]|\\\\[^\\])/;
    const pronadjene = (Array.isArray(b.pronadjene) ? b.pronadjene.slice(0, 300) : []).map((x) => ({ projektId: tekst(x?.projektId, 80), mapa: tekst(x?.mapa, 400).trim() })).filter((x) => x.projektId && PUTANJA.test(x.mapa));
    const nepronadjene = (Array.isArray(b.nepronadjene) ? b.nepronadjene.slice(0, 300) : []).map((x) => ({ projektId: tekst(x?.projektId, 80), sifra: tekst(x?.sifra, 60), razlog: tekst(x?.razlog, 300) }));
    const sada = new Date().toISOString();
    const upisane = [];
    if (pronadjene.length) {
      const poId = new Map(pronadjene.map((x) => [x.projektId, x.mapa]));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const projekti = (await client.query("SELECT value FROM app_data WHERE key = 'projekti' FOR UPDATE")).rows[0]?.value || [];
        const nova = projekti.map((p) => {
          if (!p || !poId.has(p.id) || String(p.mapa || "").trim()) return p;
          upisane.push({ projektId: p.id, sifra: tekst(p.sifra, 60), naziv: tekst(p.naziv, 160), mapa: poId.get(p.id), vrijeme: sada });
          return { ...p, mapa: poId.get(p.id) };
        });
        if (upisane.length) await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'projekti'", [JSON.stringify(nova)]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
    await spremiStanje("mape", { vrijeme: sada, provjereno: pronadjene.length + nepronadjene.length, nepronadjene });
    if (upisane.length) {
      const prije = (await ucitajStanje()).mapeUpisane?.vrijednost;
      await spremiStanje("mapeUpisane", [...upisane, ...(Array.isArray(prije) ? prije : [])].slice(0, 50));
    }
    res.json({ ok: true, upisano: upisane.map((u) => ({ projektId: u.projektId, sifra: u.sifra, mapa: u.mapa })) });
  }));

  // ---------------- Stanje servera: pregled u aplikaciji (Direktorski pregled → Stanje servera) ----------------
  const ovlast = async (req, res, izmjene) => {
    const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
    const moduli = pozicija?.moduli?.length ? pozicija.moduli : ["dashboard"];
    const dz = dozvolaZaKarticu(pozicija, "direktor", "server");
    if (!moduli.includes("direktor") || !dz.pristup || (izmjene && !dz.izmjene)) { res.status(403).json({ error: "Vaša pozicija nema pristup stanju servera." }); return false; }
    return true;
  };
  app.get("/api/server/stanje", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, false))) return;
    const sada = Date.now();
    const st = await ucitajStanje();
    const kontakt = zadnjiKontakt(st);
    const svjezi = svjeziIzvjestaj(st, sada);
    const zadaci = (await pool.query("SELECT status, count(*)::int AS n FROM most_zadaci WHERE kreirano > now() - interval '24 hours' GROUP BY status")).rows;
    res.json({
      sada: new Date(sada).toISOString(),
      most: { ...stanjeMosta(), zadnjiKontakt: kontakt },
      izvjestaj: st.izvjestaj?.vrijednost || null, izvjestajPrimljen: st.izvjestaj?.azurirano || null, izvjestajSvjez: !!svjezi,
      upozorenja: izracunajUpozorenja({ kontakt, izvjestaj: svjezi, sada }),
      postavke: { primateljId: st.postavke?.vrijednost?.primateljId || null },
      mape: st.mape?.vrijednost || null, mapeUpisane: Array.isArray(st.mapeUpisane?.vrijednost) ? st.mapeUpisane.vrijednost : [],
      zadaci24h: Object.fromEntries(zadaci.map((z) => [z.status, Number(z.n)])),
    });
  }));
  app.put("/api/server/postavke", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, true))) return;
    const id = req.body?.primateljId ? tekst(req.body.primateljId, 80) : null;
    if (id && !((await ucitajKljuc("zaposlenici")) || []).some((z) => z.id === id)) return res.status(400).json({ error: "Zaposlenik nije pronađen." });
    await spremiStanje("postavke", { primateljId: id });
    res.json({ ok: true, postavke: { primateljId: id } });
    provjeriUpozorenja();
  }));

  return { pripremi, provjeriUpozorenja };
}

module.exports = { registrirajMost, rezultatMosta, izvjestajMosta, xrKumulativ, XR_VRSTE };

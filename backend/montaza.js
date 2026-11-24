// Fotografije montaže po oznaci pozicije (npr. 52 balkona na RN 170-298: A-1.OG … J-7.OG): popis oznaka se učita u projekt, ERP izradi QR naljepnice,
// monter skenira naljepnicu na balkonu, otvori mu se stranica (bez prijave) za slikanje TOG balkona i označavanje "montirano"; slike su u ERP-u i na Z:
//   <mapa projekta>\Fotografije - Montaža\<oznaka>\<datum>_<oznaka>_<nn>.jpg   (sprema most, vidi most/lib/utovar.js)
//  • pozicije i status "montirano" = tablica montaza_pozicije, slike = montaza_slike (obje se stvaraju pri pokretanju, kao utovar_slike). Nije u app_data:
//    status mijenja monter preko javne rute, a zastarjeli preglednik ne smije cijelim popisom projekta prepisati tuđu promjenu
//  • veza (QR) = potpisani token "<id projekta>~<mapa>~<potpis>" (HMAC iz JWT_SECRET, ne sprema se): daje samo slikanje i status te jedne pozicije. Ne istječe
//    po vremenu (naljepnice stoje na gradilištu mjesecima), ali prestaje vrijediti kad pozicija ili projekt nestanu ili se projekt arhivira
//  • "montirano" se može označiti tek kad pozicija ima barem jednu sliku (slike završenog balkona); s mobitela se može poništiti još pola sata
const crypto = require("crypto");
const { dekodiraj, zagrebDatum, MAX_SLIKA, MAX_SLICICA, BRISANJE_VLASTITE_MIN } = require("./utovar");

const MAX_PO_POZICIJI = 30;
const MAX_POZICIJA_PO_PROJEKTU = 500;
const NAJ_OZNAKA = 40;
const ID_OBLIK = /^[A-Za-z0-9_-]{1,80}$/;
const MAPA_OBLIK = /^[A-Za-z0-9čćžšđČĆŽŠĐ][A-Za-z0-9čćžšđČĆŽŠĐ._-]{0,39}$/;
const REZERVIRANA = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i; // Windows ne dopušta ta imena mapa

// Oznaka kako je upisana (razmaci se sažimaju, bez kontrolnih znakova) i njezin "sigurni" oblik za naziv mape/datoteke i za QR vezu.
// Isti postupak postoji u frontend/src/montazaOznake.js (pregled uvoza); poslužitelj je mjerodavan, a oba testa koriste iste primjere.
const ocistiOznaku = (s) => String(s ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAJ_OZNAKA);
const mapaOznake = (s) => {
  const m = ocistiOznaku(s).replace(/[^A-Za-z0-9čćžšđČĆŽŠĐ._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  return REZERVIRANA.test(m) ? `${m}_` : m;
};
const nazivSlike = (datum, mapa, redni) => `${datum}_${mapa}_${String(redni).padStart(2, "0")}.jpg`;

const SQL = {
  pozUnos: "INSERT INTO montaza_pozicije (projekt_id, mapa, oznaka, poredak) VALUES ($1,$2,$3,$4) ON CONFLICT (projekt_id, mapa) DO NOTHING",
  pozMax: "SELECT COALESCE(MAX(poredak), 0) AS m FROM montaza_pozicije WHERE projekt_id = $1",
  pozPopis: "SELECT mapa, oznaka, poredak, montirano FROM montaza_pozicije WHERE projekt_id = $1 ORDER BY poredak, oznaka",
  pozJedna: "SELECT mapa, oznaka, montirano FROM montaza_pozicije WHERE projekt_id = $1 AND mapa = $2",
  pozObrisi: "DELETE FROM montaza_pozicije WHERE projekt_id = $1 AND mapa = $2",
  pozMontirano: "UPDATE montaza_pozicije SET montirano = now() WHERE projekt_id = $1 AND mapa = $2",
  pozNemontirano: "UPDATE montaza_pozicije SET montirano = NULL WHERE projekt_id = $1 AND mapa = $2",
  slikaUnos: "INSERT INTO montaza_slike (id, projekt_id, projekt_sifra, mapa, oznaka, datum, redni, naziv, velicina, slika, slicica, zahtjev_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
  slikaSljedeci: "SELECT COALESCE(MAX(redni), 0) + 1 AS sljedeci FROM montaza_slike WHERE projekt_id = $1 AND mapa = $2 AND datum = $3",
  slikaBroj: "SELECT COUNT(*) AS n FROM montaza_slike WHERE projekt_id = $1 AND mapa = $2",
  slikaPoZahtjevu: "SELECT id, redni, naziv FROM montaza_slike WHERE zahtjev_id = $1",
  slikaJedna: "SELECT id, projekt_id, mapa, kreirano, spremljeno_z, slika, slicica FROM montaza_slike WHERE id = $1",
  slikaPopis: "SELECT id, mapa, oznaka, datum, redni, naziv, kreirano, velicina, spremljeno_z, z_putanja, z_greska, (slika IS NOT NULL) AS ima_original FROM montaza_slike WHERE projekt_id = $1 ORDER BY mapa, datum, redni",
  slikaObrisi: "DELETE FROM montaza_slike WHERE id = $1",
  mostCekaju: "SELECT id, projekt_sifra, projekt_id, mapa, datum, naziv, velicina FROM montaza_slike WHERE spremljeno_z IS NULL AND slika IS NOT NULL AND (z_pokusaj IS NULL OR z_pokusaj < now() - interval '10 minutes') ORDER BY kreirano LIMIT 20",
  mostSpremljeno: "UPDATE montaza_slike SET spremljeno_z = now(), z_putanja = $2, z_greska = '', z_pokusaj = now() WHERE id = $1",
  mostGreska: "UPDATE montaza_slike SET z_greska = $2, z_pokusaj = now() WHERE id = $1",
  ocisti: "UPDATE montaza_slike SET slika = NULL WHERE slika IS NOT NULL AND spremljeno_z IS NOT NULL AND spremljeno_z < now() - interval '14 days'",
};

const greska = (status, poruka) => Object.assign(new Error(poruka), { httpStatus: status });
const tekst = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);

const kljucPotpisa = (tajna) => crypto.createHash("sha256").update(`montaza-veza|${tajna}`).digest();
const potpisi = (tajna, projektId, mapa) => crypto.createHmac("sha256", kljucPotpisa(tajna)).update(`montaza:${projektId}:${mapa}`).digest("base64url").slice(0, 32);
const napraviToken = (tajna, projektId, mapa) => `${projektId}~${mapa}~${potpisi(tajna, projektId, mapa)}`;
// Vraća { projektId, mapa } ako je potpis ispravan, inače null.
const provjeriToken = (tajna, token) => {
  const s = String(token || "");
  if (s.length > 160) return null;
  const dijelovi = s.split("~");
  if (dijelovi.length !== 3) return null;
  const [projektId, mapa, potpis] = dijelovi;
  if (!ID_OBLIK.test(projektId) || !MAPA_OBLIK.test(mapa)) return null;
  const dan = Buffer.from(potpis), tocan = Buffer.from(potpisi(tajna, projektId, mapa));
  if (dan.length !== tocan.length || !crypto.timingSafeEqual(dan, tocan)) return null;
  return { projektId, mapa };
};

function registrirajMontazu(app, d) {
  const { pool, autentikacija, ucitajPozicijuZaposlenika, izracunajDozvoljeneKljuceve, ucitajKljuc, mostAutentikacija, klijentIp, brojac, tajna } = d;

  const pripremi = async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS montaza_pozicije (
        projekt_id text NOT NULL, mapa text NOT NULL, oznaka text NOT NULL, poredak integer NOT NULL DEFAULT 0,
        kreirano timestamptz NOT NULL DEFAULT now(), montirano timestamptz, PRIMARY KEY (projekt_id, mapa))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS montaza_slike (
        id text PRIMARY KEY, projekt_id text NOT NULL, projekt_sifra text NOT NULL DEFAULT '', mapa text NOT NULL, oznaka text NOT NULL DEFAULT '',
        datum text NOT NULL, redni integer NOT NULL, naziv text NOT NULL, kreirano timestamptz NOT NULL DEFAULT now(), velicina integer NOT NULL DEFAULT 0,
        slika bytea, slicica bytea NOT NULL, zahtjev_id text,
        spremljeno_z timestamptz, z_putanja text NOT NULL DEFAULT '', z_greska text NOT NULL DEFAULT '', z_pokusaj timestamptz)`);
      await pool.query("CREATE INDEX IF NOT EXISTS idx_montaza_slike_projekt ON montaza_slike (projekt_id, mapa)");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_montaza_slike_redni ON montaza_slike (projekt_id, mapa, datum, redni)");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_montaza_slike_zahtjev ON montaza_slike (zahtjev_id) WHERE zahtjev_id IS NOT NULL");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_montaza_slike_cekaju ON montaza_slike (kreirano) WHERE spremljeno_z IS NULL");
      for (const t of ["montaza_pozicije", "montaza_slike"]) {
        await pool.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
        await pool.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON ${t} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON ${t} FROM authenticated; END IF; END $$`);
      }
      const ocisti = () => pool.query(SQL.ocisti).catch(() => {});
      await ocisti();
      setInterval(ocisti, 6 * 60 * 60 * 1000).unref();
    } catch (e) {
      console.error("Greška kod pripreme tablica montaže:", e);
    }
  };

  const obradi = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
      console.error("Greška fotografija montaže:", e);
      res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
    }
  };
  const ograniciIp = (req, res) => {
    const ip = klijentIp(req);
    if (brojac.blokiran(ip)) { res.status(429).json({ error: "Previše zahtjeva s ovog uređaja — pokušaj ponovno za nekoliko minuta." }); return false; }
    brojac.zabiljezi(ip);
    return true;
  };
  const dozvole = async (req) => izracunajDozvoljeneKljuceve(await ucitajPozicijuZaposlenika(req.zaposlenikId));
  const trebaCitati = async (req) => { if (!(await dozvole(req)).citljivo.has("projekti")) throw greska(403, "Vaša pozicija nema pristup projektima."); };
  const trebaPisati = async (req) => { if (!(await dozvole(req)).pisivo.has("projekti")) throw greska(403, "Vaša pozicija nema ovlaštenje za mijenjanje projekata."); };
  const projektPoId = async (id) => ((await ucitajKljuc("projekti")) || []).find((p) => p.id === id) || null;
  const jeStarije = (vrijeme, minuta) => Date.now() - new Date(vrijeme).getTime() > minuta * 60000;

  // Pozicija iza javne veze (samo ono što stranica na mobitelu smije pokazati).
  const kontekst = async (token) => {
    const t = provjeriToken(tajna, token);
    if (!t) throw greska(404, "Veza nije ispravna.");
    const projekt = await projektPoId(t.projektId);
    if (!projekt) throw greska(404, "Projekt nije pronađen.");
    if (projekt.status === "Arhiviran") throw greska(410, "Projekt je arhiviran — slikanje više nije moguće.");
    const poz = (await pool.query(SQL.pozJedna, [t.projektId, t.mapa])).rows[0];
    if (!poz) throw greska(404, "Pozicija više ne postoji u projektu.");
    return { projekt, poz, t };
  };

  // ---------------- Javno (QR s naljepnice, bez prijave) ----------------
  const stanjePozicije = async (projektId, mapa, poz) => {
    const n = Number((await pool.query(SQL.slikaBroj, [projektId, mapa])).rows[0]?.n || 0);
    return { vecDodano: n, najvise: MAX_PO_POZICIJI, montirano: poz.montirano ? new Date(poz.montirano).toISOString() : null };
  };
  app.get("/api/montaza/veza/:token", obradi(async (req, res) => {
    if (!ograniciIp(req, res)) return;
    const { projekt, poz, t } = await kontekst(req.params.token);
    res.json({ projekt: { sifra: projekt.sifra, naziv: projekt.naziv }, oznaka: poz.oznaka, ...(await stanjePozicije(t.projektId, t.mapa, poz)), danas: zagrebDatum() });
  }));

  app.post("/api/montaza/veza/:token/slika", obradi(async (req, res) => {
    if (!ograniciIp(req, res)) return;
    const { projekt, poz, t } = await kontekst(req.params.token);
    const slika = dekodiraj(req.body?.slika, MAX_SLIKA), slicica = dekodiraj(req.body?.slicica, MAX_SLICICA);
    if (!slika || !slicica) throw greska(400, "Slika nije ispravna (očekuje se JPEG, najviše 3 MB).");
    const zahtjevId = ID_OBLIK.test(String(req.body?.zahtjevId || "")) ? String(req.body.zahtjevId) : null;
    if (zahtjevId) {
      const postojeca = (await pool.query(SQL.slikaPoZahtjevu, [zahtjevId])).rows[0];
      if (postojeca) return res.json({ ok: true, id: postojeca.id, naziv: postojeca.naziv, ponovljeno: true });
    }
    if (Number((await pool.query(SQL.slikaBroj, [t.projektId, t.mapa])).rows[0]?.n || 0) >= MAX_PO_POZICIJI) throw greska(409, `Za ovu poziciju već ima ${MAX_PO_POZICIJI} slika.`);
    const datum = zagrebDatum();
    for (let pokusaj = 0; pokusaj < 4; pokusaj++) {
      const redni = Number((await pool.query(SQL.slikaSljedeci, [t.projektId, t.mapa, datum])).rows[0]?.sljedeci || 1);
      const id = crypto.randomUUID();
      const naziv = nazivSlike(datum, t.mapa, redni);
      try {
        await pool.query(SQL.slikaUnos, [id, t.projektId, tekst(projekt.sifra, 60), t.mapa, tekst(poz.oznaka, NAJ_OZNAKA), datum, redni, naziv, slika.length, slika, slicica, zahtjevId]);
        return res.json({ ok: true, id, naziv });
      } catch (e) {
        if (pokusaj === 3 || !/duplicate key|unique/i.test(String(e?.message))) throw e;
      }
    }
  }));

  app.delete("/api/montaza/veza/:token/slika/:id", obradi(async (req, res) => {
    if (!ograniciIp(req, res)) return;
    const { t } = await kontekst(req.params.token);
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna slika.");
    const red = (await pool.query(SQL.slikaJedna, [req.params.id])).rows[0];
    if (!red || red.projekt_id !== t.projektId || red.mapa !== t.mapa) throw greska(404, "Slika nije pronađena.");
    if (red.spremljeno_z) throw greska(409, "Slika je već spremljena u mapu projekta — ukloni je u ERP-u.");
    if (jeStarije(red.kreirano, BRISANJE_VLASTITE_MIN)) throw greska(409, "Slika se s mobitela može ukloniti samo prvih pola sata — ukloni je u ERP-u.");
    await pool.query(SQL.slikaObrisi, [req.params.id]);
    res.json({ ok: true });
  }));

  // Monter označi poziciju montiranom (traži barem jednu sliku) ili to poništi (samo pola sata nakon označavanja).
  app.post("/api/montaza/veza/:token/montirano", obradi(async (req, res) => {
    if (!ograniciIp(req, res)) return;
    const { poz, t } = await kontekst(req.params.token);
    if (req.body?.montirano === false) {
      if (!poz.montirano) return res.json({ ok: true, montirano: null });
      if (jeStarije(poz.montirano, BRISANJE_VLASTITE_MIN)) throw greska(409, "Označeno je prije više od pola sata — poništavanje je moguće u ERP-u.");
      await pool.query(SQL.pozNemontirano, [t.projektId, t.mapa]);
      return res.json({ ok: true, montirano: null });
    }
    if (poz.montirano) return res.json({ ok: true, montirano: new Date(poz.montirano).toISOString() });
    if (Number((await pool.query(SQL.slikaBroj, [t.projektId, t.mapa])).rows[0]?.n || 0) < 1) throw greska(409, "Prvo slikaj završeni balkon — montirano se može označiti tek uz barem jednu sliku.");
    await pool.query(SQL.pozMontirano, [t.projektId, t.mapa]);
    const nova = (await pool.query(SQL.pozJedna, [t.projektId, t.mapa])).rows[0];
    res.json({ ok: true, montirano: nova?.montirano ? new Date(nova.montirano).toISOString() : new Date().toISOString() });
  }));

  // ---------------- Prijavljeni korisnici (kartica Montaža u detalju projekta) ----------------
  const slikaJavna = (r) => ({ id: r.id, mapa: r.mapa, oznaka: r.oznaka, datum: r.datum, redni: Number(r.redni), naziv: r.naziv, kreirano: r.kreirano, velicina: Number(r.velicina) || 0, spremljenoZ: r.spremljeno_z || null, putanjaZ: r.z_putanja || "", greskaZ: r.z_greska || "", imaOriginal: !!r.ima_original });
  app.get("/api/montaza/projekt/:id", autentikacija, obradi(async (req, res) => {
    await trebaCitati(req);
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravan projekt.");
    const [poz, slike] = await Promise.all([pool.query(SQL.pozPopis, [req.params.id]), pool.query(SQL.slikaPopis, [req.params.id])]);
    res.json({ pozicije: poz.rows.map((r) => ({ mapa: r.mapa, oznaka: r.oznaka, poredak: Number(r.poredak) || 0, montirano: r.montirano ? new Date(r.montirano).toISOString() : null })), slike: slike.rows.map(slikaJavna) });
  }));

  // Učitavanje oznaka (lijepljenje iz Excela): nove se dodaju, postojeće i duplikati se preskaču (usporedba po "sigurnom" obliku, bez razlike velikih i malih slova).
  app.put("/api/montaza/projekt/:id/pozicije", autentikacija, obradi(async (req, res) => {
    await trebaPisati(req);
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravan projekt.");
    if (!(await projektPoId(req.params.id))) throw greska(404, "Projekt nije pronađen.");
    const ulaz = Array.isArray(req.body?.oznake) ? req.body.oznake : null;
    if (!ulaz || !ulaz.length) throw greska(400, "Nema oznaka za učitavanje.");
    if (ulaz.length > MAX_POZICIJA_PO_PROJEKTU) throw greska(400, `Najviše ${MAX_POZICIJA_PO_PROJEKTU} oznaka odjednom.`);
    const postojece = (await pool.query(SQL.pozPopis, [req.params.id])).rows;
    if (postojece.length + ulaz.length > MAX_POZICIJA_PO_PROJEKTU * 2) throw greska(400, "Projekt već ima previše pozicija.");
    const vidjene = new Set(postojece.map((r) => String(r.mapa).toLowerCase()));
    let poredak = Number((await pool.query(SQL.pozMax, [req.params.id])).rows[0]?.m || 0);
    const dodano = [], preskoceno = [];
    for (const sirova of ulaz) {
      const oznaka = ocistiOznaku(sirova), mapa = mapaOznake(sirova);
      if (!oznaka) continue;
      if (!mapa || !MAPA_OBLIK.test(mapa)) { preskoceno.push({ oznaka, razlog: "nedopuštena oznaka" }); continue; }
      if (vidjene.has(mapa.toLowerCase())) { preskoceno.push({ oznaka, razlog: "već postoji" }); continue; }
      vidjene.add(mapa.toLowerCase());
      await pool.query(SQL.pozUnos, [req.params.id, mapa, oznaka, ++poredak]);
      dodano.push({ oznaka, mapa });
    }
    res.json({ ok: true, dodano: dodano.length, preskoceno });
  }));

  app.delete("/api/montaza/projekt/:id/pozicija/:mapa", autentikacija, obradi(async (req, res) => {
    await trebaPisati(req);
    if (!ID_OBLIK.test(req.params.id) || !MAPA_OBLIK.test(req.params.mapa)) throw greska(400, "Neispravna pozicija.");
    const poz = (await pool.query(SQL.pozJedna, [req.params.id, req.params.mapa])).rows[0];
    if (!poz) throw greska(404, "Pozicija nije pronađena.");
    if (poz.montirano) throw greska(409, "Pozicija je označena kao montirana — prvo poništi montažu.");
    if (Number((await pool.query(SQL.slikaBroj, [req.params.id, req.params.mapa])).rows[0]?.n || 0) > 0) throw greska(409, "Pozicija ima fotografije — prvo ukloni fotografije.");
    await pool.query(SQL.pozObrisi, [req.params.id, req.params.mapa]);
    res.json({ ok: true });
  }));

  app.post("/api/montaza/projekt/:id/pozicija/:mapa/montirano", autentikacija, obradi(async (req, res) => {
    await trebaPisati(req);
    if (!ID_OBLIK.test(req.params.id) || !MAPA_OBLIK.test(req.params.mapa)) throw greska(400, "Neispravna pozicija.");
    const poz = (await pool.query(SQL.pozJedna, [req.params.id, req.params.mapa])).rows[0];
    if (!poz) throw greska(404, "Pozicija nije pronađena.");
    if (req.body?.montirano === false) await pool.query(SQL.pozNemontirano, [req.params.id, req.params.mapa]);
    else if (!poz.montirano) await pool.query(SQL.pozMontirano, [req.params.id, req.params.mapa]);
    const nova = (await pool.query(SQL.pozJedna, [req.params.id, req.params.mapa])).rows[0];
    res.json({ ok: true, montirano: nova?.montirano ? new Date(nova.montirano).toISOString() : null });
  }));

  // Veze za ispis QR naljepnica (tko smije mijenjati projekte): oznaka, mapa i token svake pozicije.
  app.get("/api/montaza/projekt/:id/veze", autentikacija, obradi(async (req, res) => {
    await trebaPisati(req);
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravan projekt.");
    const poz = (await pool.query(SQL.pozPopis, [req.params.id])).rows;
    res.json({ veze: poz.map((r) => ({ oznaka: r.oznaka, mapa: r.mapa, token: napraviToken(tajna, req.params.id, r.mapa) })) });
  }));

  app.get("/api/montaza/slika/:id", autentikacija, obradi(async (req, res) => {
    await trebaCitati(req);
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna slika.");
    const red = (await pool.query(SQL.slikaJedna, [req.params.id])).rows[0];
    if (!red) throw greska(404, "Slika nije pronađena.");
    const original = req.query.original === "1";
    if (original && !red.slika) throw greska(404, "Original je uklonjen iz ERP-a (nalazi se u mapi projekta na Z:).");
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.send(original ? red.slika : red.slicica);
  }));
  app.delete("/api/montaza/slika/:id", autentikacija, obradi(async (req, res) => {
    await trebaPisati(req);
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna slika.");
    const r = await pool.query(SQL.slikaObrisi, [req.params.id]);
    if (!r.rowCount) throw greska(404, "Slika nije pronađena.");
    res.json({ ok: true });
  }));

  // ---------------- Most (X-Most-Token): preuzimanje i potvrda spremanja na Z: ----------------
  app.get("/api/most/montaza/cekaju", mostAutentikacija, obradi(async (req, res) => {
    const r = await pool.query(SQL.mostCekaju);
    const projekti = r.rows.length ? await ucitajKljuc("projekti") : [];
    res.json({ slike: r.rows.map((x) => ({ id: x.id, sifra: x.projekt_sifra, mapa: tekst((projekti || []).find((p) => p.id === x.projekt_id)?.mapa, 400), pozicija: x.mapa, datum: x.datum, naziv: x.naziv, velicina: Number(x.velicina) || 0 })) });
  }));
  app.get("/api/most/montaza/slika/:id", mostAutentikacija, obradi(async (req, res) => {
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna slika.");
    const red = (await pool.query(SQL.slikaJedna, [req.params.id])).rows[0];
    if (!red || !red.slika) throw greska(404, "Slika nije pronađena.");
    res.set({ "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff" });
    res.send(red.slika);
  }));
  app.post("/api/most/montaza/slika/:id/rezultat", mostAutentikacija, obradi(async (req, res) => {
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna slika.");
    const b = req.body || {};
    const r = b.status === "spremljeno" ? await pool.query(SQL.mostSpremljeno, [req.params.id, tekst(b.putanja, 500)]) : await pool.query(SQL.mostGreska, [req.params.id, tekst(b.poruka, 300) || "Nepoznata greška."]);
    if (!r.rowCount) throw greska(404, "Slika nije pronađena.");
    res.json({ ok: true });
  }));

  return { pripremi };
}

module.exports = { registrirajMontazu, napraviToken, provjeriToken, ocistiOznaku, mapaOznake, nazivSlike, MAX_PO_POZICIJI, MAPA_OBLIK };

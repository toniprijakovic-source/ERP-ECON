// Fotografije utovara: QR kod na otpremnici otvara na mobitelu stranicu (bez prijave) za slikanje utovara; slike se vežu uz projekt i datum utovara,
// vide se u kartici projekta, a most ih zatim sprema na Z: u <mapa projekta>\Fotografije - Utovar\<datum>\ (vidi most/lib/utovar.js).
//  • veza (QR) = potpisani token "<id otpremnice>.<potpis>" (HMAC iz JWT_SECRET): daje samo dodavanje slika uz tu jednu otpremnicu, ne i pregled ičega drugog;
//    vrijedi VEZA_DANA dana od datuma otpremnice, pa se zaboravljeni papir ne može koristiti zauvijek
//  • slike = tablica utovar_slike (stvara se pri pokretanju kao potrosni_dnevnik): sažeti original (do ~3 MB, JPEG) + mala sličica; original se briše
//    ZADRZI_ORIGINAL_DANA dana nakon što ga most spremi na Z:, sličica ostaje (baza ne smije rasti bez granice)
//  • javne rute su ograničene: samo JPEG (provjera potpisa), najviše MAX_PO_OTPREMNICI slika, brojač zahtjeva po IP adresi
const crypto = require("crypto");

const VEZA_DANA = 14;
const MAX_PO_OTPREMNICI = 60;
const MAX_SLIKA = 3_000_000; // bajtova, nakon dekodiranja
const MAX_SLICICA = 80_000;
const ZADRZI_ORIGINAL_DANA = 14;
const BRISANJE_VLASTITE_MIN = 30; // pogrešno snimljenu sliku s mobitela može se ukloniti još pola sata
const ID_OBLIK = /^[A-Za-z0-9_-]{1,80}$/;
const DATUM_OBLIK = /^\d{4}-\d{2}-\d{2}$/;

const SQL = {
  unos: "INSERT INTO utovar_slike (id, otpremnica_id, otpremnica_broj, projekt_id, projekt_sifra, datum, redni, naziv, velicina, slika, slicica, zahtjev_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
  sljedeci: "SELECT COALESCE(MAX(redni), 0) + 1 AS sljedeci FROM utovar_slike WHERE otpremnica_id = $1 AND datum = $2",
  broj: "SELECT COUNT(*) AS n FROM utovar_slike WHERE otpremnica_id = $1",
  poZahtjevu: "SELECT id, redni, naziv FROM utovar_slike WHERE zahtjev_id = $1",
  jedna: "SELECT id, otpremnica_id, projekt_id, kreirano, spremljeno_z, slika, slicica FROM utovar_slike WHERE id = $1",
  popisProjekta: "SELECT id, otpremnica_id, otpremnica_broj, datum, redni, naziv, kreirano, velicina, spremljeno_z, z_putanja, z_greska, (slika IS NOT NULL) AS ima_original FROM utovar_slike WHERE projekt_id = $1 ORDER BY datum DESC, otpremnica_broj, redni",
  obrisi: "DELETE FROM utovar_slike WHERE id = $1",
  mostCekaju: "SELECT id, projekt_id, projekt_sifra, otpremnica_broj, datum, naziv, velicina FROM utovar_slike WHERE spremljeno_z IS NULL AND slika IS NOT NULL AND (z_pokusaj IS NULL OR z_pokusaj < now() - interval '10 minutes') ORDER BY kreirano LIMIT 20",
  mostSpremljeno: "UPDATE utovar_slike SET spremljeno_z = now(), z_putanja = $2, z_greska = '', z_pokusaj = now() WHERE id = $1",
  mostGreska: "UPDATE utovar_slike SET z_greska = $2, z_pokusaj = now() WHERE id = $1",
  ocisti: `UPDATE utovar_slike SET slika = NULL WHERE slika IS NOT NULL AND spremljeno_z IS NOT NULL AND spremljeno_z < now() - interval '${ZADRZI_ORIGINAL_DANA} days'`,
};

const greska = (status, poruka) => Object.assign(new Error(poruka), { httpStatus: status });
const tekst = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const zagrebDatum = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Zagreb" });
// Dio naziva datoteke iz broja otpremnice: "OTP-30-10-2/26" → "OTP-30-10-2-26" (samo znakovi sigurni za naziv datoteke).
const sigurnoUNaziv = (s) => String(s || "otpremnica").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "otpremnica";
const nazivDatoteke = (datum, otpremnicaBroj, redni) => `utovar_${datum}_${sigurnoUNaziv(otpremnicaBroj)}_${String(redni).padStart(2, "0")}.jpg`;
const jeJpeg = (b) => Buffer.isBuffer(b) && b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const dekodiraj = (v, max) => {
  if (typeof v !== "string" || v.length < 8) return null;
  if (v.length > Math.ceil(max * 1.4) + 8) return null; // prevelik base64 odbacuje se prije dekodiranja
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  const b = Buffer.from(v, "base64");
  return b.length <= max && jeJpeg(b) ? b : null;
};

const kljucPotpisa = (tajna) => crypto.createHash("sha256").update(`utovar-veza|${tajna}`).digest();
const potpisi = (tajna, id) => crypto.createHmac("sha256", kljucPotpisa(tajna)).update(`utovar:${id}`).digest("base64url").slice(0, 32);
const napraviToken = (tajna, otpremnicaId) => `${otpremnicaId}.${potpisi(tajna, otpremnicaId)}`;
// Vraća id otpremnice ako je potpis ispravan, inače null.
const provjeriToken = (tajna, token) => {
  const s = String(token || "");
  const i = s.lastIndexOf(".");
  if (i < 1 || s.length > 140) return null;
  const id = s.slice(0, i), dan = Buffer.from(s.slice(i + 1)), tocan = Buffer.from(potpisi(tajna, id));
  if (!ID_OBLIK.test(id) || dan.length !== tocan.length || !crypto.timingSafeEqual(dan, tocan)) return null;
  return id;
};
// Veza vrijedi od datuma otpremnice do VEZA_DANA dana poslije (i dan unaprijed, kad se otpremnica izdaje dan ranije).
const vezaVrijedi = (datumOtpremnice, sada = new Date()) => {
  if (!DATUM_OBLIK.test(String(datumOtpremnice || ""))) return false;
  const danas = zagrebDatum(sada);
  const pomak = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  return danas >= pomak(datumOtpremnice, -1) && danas <= pomak(datumOtpremnice, VEZA_DANA);
};

function registrirajUtovar(app, d) {
  const { pool, autentikacija, ucitajPozicijuZaposlenika, izracunajDozvoljeneKljuceve, ucitajKljuc, mostAutentikacija, klijentIp, brojac, tajna } = d;

  const pripremi = async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS utovar_slike (
        id text PRIMARY KEY, otpremnica_id text NOT NULL, otpremnica_broj text NOT NULL DEFAULT '', projekt_id text NOT NULL, projekt_sifra text NOT NULL DEFAULT '',
        datum text NOT NULL, redni integer NOT NULL, naziv text NOT NULL, kreirano timestamptz NOT NULL DEFAULT now(), velicina integer NOT NULL DEFAULT 0,
        slika bytea, slicica bytea NOT NULL, zahtjev_id text,
        spremljeno_z timestamptz, z_putanja text NOT NULL DEFAULT '', z_greska text NOT NULL DEFAULT '', z_pokusaj timestamptz)`);
      await pool.query("CREATE INDEX IF NOT EXISTS idx_utovar_slike_projekt ON utovar_slike (projekt_id, datum DESC)");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_utovar_slike_redni ON utovar_slike (otpremnica_id, datum, redni)");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_utovar_slike_zahtjev ON utovar_slike (zahtjev_id) WHERE zahtjev_id IS NOT NULL");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_utovar_slike_cekaju ON utovar_slike (kreirano) WHERE spremljeno_z IS NULL");
      await pool.query("ALTER TABLE utovar_slike ENABLE ROW LEVEL SECURITY");
      await pool.query("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON utovar_slike FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON utovar_slike FROM authenticated; END IF; END $$");
      const ocisti = () => pool.query(SQL.ocisti).catch(() => {});
      await ocisti();
      setInterval(ocisti, 6 * 60 * 60 * 1000).unref();
    } catch (e) {
      console.error("Greška kod pripreme tablice fotografija utovara:", e);
    }
  };

  const obradi = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
      console.error("Greška fotografija utovara:", e);
      res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
    }
  };
  // Otpremnica i projekt iza javne veze (samo ono što stranica smije pokazati).
  const kontekst = async (token) => {
    const id = provjeriToken(tajna, token);
    if (!id) throw greska(404, "Veza nije ispravna.");
    const otpremnice = await ucitajKljuc("otpremnice");
    const otp = (otpremnice || []).find((o) => o.id === id);
    if (!otp) throw greska(404, "Otpremnica nije pronađena.");
    if (!vezaVrijedi(otp.datum)) throw greska(410, "Veza je istekla — otvori fotografije iz ERP-a ili ispiši novu otpremnicu.");
    const [projekti, kupci, dobavljaci] = await Promise.all([ucitajKljuc("projekti"), ucitajKljuc("kupci"), ucitajKljuc("dobavljaci")]);
    const projekt = (projekti || []).find((p) => p.id === otp.projektId);
    if (!projekt) throw greska(404, "Projekt otpremnice nije pronađen.");
    const primatelj = otp.vrsta === "kooperant" ? (dobavljaci || []).find((x) => x.id === otp.dobavljacId) : (kupci || []).find((x) => x.id === otp.kupacId);
    return { otp, projekt, primatelj: primatelj?.naziv || "" };
  };
  const ograniciIp = (req, res) => {
    const ip = klijentIp(req);
    if (brojac.blokiran(ip)) { res.status(429).json({ error: "Previše zahtjeva s ovog uređaja — pokušaj ponovno za nekoliko minuta." }); return false; }
    brojac.zabiljezi(ip);
    return true;
  };

  // ---------------- Javno (QR s otpremnice, bez prijave) ----------------
  app.get("/api/utovar/veza/:token", obradi(async (req, res) => {
    if (!ograniciIp(req, res)) return;
    const { otp, projekt, primatelj } = await kontekst(req.params.token);
    const n = Number((await pool.query(SQL.broj, [otp.id])).rows[0]?.n || 0);
    res.json({ otpremnica: { broj: otp.broj, datum: otp.datum, vrsta: otp.vrsta === "kooperant" ? "kooperant" : "kupac" }, projekt: { sifra: projekt.sifra, naziv: projekt.naziv }, primatelj, vecDodano: n, najvise: MAX_PO_OTPREMNICI, danas: zagrebDatum() });
  }));

  app.post("/api/utovar/veza/:token/slika", obradi(async (req, res) => {
    if (!ograniciIp(req, res)) return;
    const { otp, projekt } = await kontekst(req.params.token);
    const slika = dekodiraj(req.body?.slika, MAX_SLIKA), slicica = dekodiraj(req.body?.slicica, MAX_SLICICA);
    if (!slika || !slicica) throw greska(400, "Slika nije ispravna (očekuje se JPEG, najviše 3 MB).");
    const zahtjevId = ID_OBLIK.test(String(req.body?.zahtjevId || "")) ? String(req.body.zahtjevId) : null;
    if (zahtjevId) { // ponovno slanje iste slike (npr. slaba veza) ne stvara duplikat
      const postojeca = (await pool.query(SQL.poZahtjevu, [zahtjevId])).rows[0];
      if (postojeca) return res.json({ ok: true, id: postojeca.id, naziv: postojeca.naziv, ponovljeno: true });
    }
    if (Number((await pool.query(SQL.broj, [otp.id])).rows[0]?.n || 0) >= MAX_PO_OTPREMNICI) throw greska(409, `Za ovu otpremnicu već ima ${MAX_PO_OTPREMNICI} slika.`);
    const datum = zagrebDatum();
    for (let pokusaj = 0; pokusaj < 4; pokusaj++) { // dva mobitela istodobno mogu dobiti isti redni broj — jedinstveni indeks to odbija pa se pokuša ponovno
      const redni = Number((await pool.query(SQL.sljedeci, [otp.id, datum])).rows[0]?.sljedeci || 1);
      const id = crypto.randomUUID();
      const naziv = nazivDatoteke(datum, otp.broj, redni);
      try {
        await pool.query(SQL.unos, [id, otp.id, tekst(otp.broj, 40), projekt.id, tekst(projekt.sifra, 60), datum, redni, naziv, slika.length, slika, slicica, zahtjevId]);
        return res.json({ ok: true, id, naziv });
      } catch (e) {
        if (pokusaj === 3 || !/duplicate key|unique/i.test(String(e?.message))) throw e;
      }
    }
  }));

  // Uklanjanje vlastite pogrešne slike s mobitela: samo pola sata nakon snimanja i samo dok je most nije spremio na Z:.
  app.delete("/api/utovar/veza/:token/slika/:id", obradi(async (req, res) => {
    if (!ograniciIp(req, res)) return;
    const { otp } = await kontekst(req.params.token);
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna slika.");
    const red = (await pool.query(SQL.jedna, [req.params.id])).rows[0];
    if (!red || red.otpremnica_id !== otp.id) throw greska(404, "Slika nije pronađena.");
    if (red.spremljeno_z) throw greska(409, "Slika je već spremljena u mapu projekta — ukloni je u ERP-u.");
    if (Date.now() - new Date(red.kreirano).getTime() > BRISANJE_VLASTITE_MIN * 60000) throw greska(409, "Slika se s mobitela može ukloniti samo prvih pola sata — ukloni je u ERP-u.");
    await pool.query(SQL.obrisi, [req.params.id]);
    res.json({ ok: true });
  }));

  // ---------------- Prijavljeni korisnici ----------------
  const dozvole = async (req) => izracunajDozvoljeneKljuceve(await ucitajPozicijuZaposlenika(req.zaposlenikId));
  // Veza za QR kod na otpremnici (tko smije čitati otpremnice). Ne traži da otpremnica već postoji u bazi (ispis odmah nakon izdavanja); upload provjerava postojanje.
  app.get("/api/utovar/veza-za/:otpremnicaId", autentikacija, obradi(async (req, res) => {
    if (!(await dozvole(req)).citljivo.has("otpremnice")) throw greska(403, "Vaša pozicija nema ovlaštenje za otpremnice.");
    if (!ID_OBLIK.test(req.params.otpremnicaId)) throw greska(400, "Neispravna otpremnica.");
    res.json({ token: napraviToken(tajna, req.params.otpremnicaId) });
  }));

  const slikaJavna = (r) => ({ id: r.id, otpremnicaId: r.otpremnica_id, otpremnica: r.otpremnica_broj, datum: r.datum, redni: Number(r.redni), naziv: r.naziv, kreirano: r.kreirano, velicina: Number(r.velicina) || 0, spremljenoZ: r.spremljeno_z || null, putanjaZ: r.z_putanja || "", greskaZ: r.z_greska || "", imaOriginal: !!r.ima_original });
  app.get("/api/utovar/projekt/:projektId", autentikacija, obradi(async (req, res) => {
    if (!(await dozvole(req)).citljivo.has("otpremnice")) throw greska(403, "Vaša pozicija nema pristup otpremnicama.");
    if (!ID_OBLIK.test(req.params.projektId)) throw greska(400, "Neispravan projekt.");
    const r = await pool.query(SQL.popisProjekta, [req.params.projektId]);
    res.json({ slike: r.rows.map(slikaJavna) });
  }));
  // Sličica ili original (?original=1) kao JPEG; <img> ne može slati zaglavlje Authorization, pa ga preglednik dohvaća kao blob.
  app.get("/api/utovar/slika/:id", autentikacija, obradi(async (req, res) => {
    if (!(await dozvole(req)).citljivo.has("otpremnice")) throw greska(403, "Vaša pozicija nema pristup otpremnicama.");
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna slika.");
    const red = (await pool.query(SQL.jedna, [req.params.id])).rows[0];
    if (!red) throw greska(404, "Slika nije pronađena.");
    const trazeniOriginal = req.query.original === "1";
    if (trazeniOriginal && !red.slika) throw greska(404, "Original je uklonjen iz ERP-a (nalazi se u mapi projekta na Z:).");
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.send(trazeniOriginal ? red.slika : red.slicica);
  }));
  app.delete("/api/utovar/slika/:id", autentikacija, obradi(async (req, res) => {
    if (!(await dozvole(req)).pisivo.has("otpremnice")) throw greska(403, "Vaša pozicija nema ovlaštenje za mijenjanje otpremnica.");
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna slika.");
    const r = await pool.query(SQL.obrisi, [req.params.id]);
    if (!r.rowCount) throw greska(404, "Slika nije pronađena.");
    res.json({ ok: true });
  }));

  // ---------------- Most (X-Most-Token): preuzimanje i potvrda spremanja na Z: ----------------
  app.get("/api/most/utovar/cekaju", mostAutentikacija, obradi(async (req, res) => {
    const r = await pool.query(SQL.mostCekaju);
    const projekti = r.rows.length ? await ucitajKljuc("projekti") : [];
    res.json({ slike: r.rows.map((x) => ({ id: x.id, sifra: x.projekt_sifra, mapa: tekst((projekti || []).find((p) => p.id === x.projekt_id)?.mapa, 400), otpremnica: x.otpremnica_broj, datum: x.datum, naziv: x.naziv, velicina: Number(x.velicina) || 0 })) });
  }));
  app.get("/api/most/utovar/slika/:id", mostAutentikacija, obradi(async (req, res) => {
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna slika.");
    const red = (await pool.query(SQL.jedna, [req.params.id])).rows[0];
    if (!red || !red.slika) throw greska(404, "Slika nije pronađena.");
    res.set({ "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff" });
    res.send(red.slika);
  }));
  app.post("/api/most/utovar/slika/:id/rezultat", mostAutentikacija, obradi(async (req, res) => {
    if (!ID_OBLIK.test(req.params.id)) throw greska(400, "Neispravna slika.");
    const b = req.body || {};
    const r = b.status === "spremljeno" ? await pool.query(SQL.mostSpremljeno, [req.params.id, tekst(b.putanja, 500)]) : await pool.query(SQL.mostGreska, [req.params.id, tekst(b.poruka, 300) || "Nepoznata greška."]);
    if (!r.rowCount) throw greska(404, "Slika nije pronađena.");
    res.json({ ok: true });
  }));

  return { pripremi };
}

module.exports = { registrirajUtovar, napraviToken, provjeriToken, vezaVrijedi, nazivDatoteke, sigurnoUNaziv, dekodiraj, jeJpeg, zagrebDatum, VEZA_DANA, MAX_PO_OTPREMNICI, ZADRZI_ORIGINAL_DANA, MAX_SLIKA, MAX_SLICICA, BRISANJE_VLASTITE_MIN };

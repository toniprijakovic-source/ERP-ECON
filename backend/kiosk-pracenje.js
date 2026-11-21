// Praćenje kioska: zasloni za evidenciju radnog vremena (?kiosk=1) i za potrošni materijal (?kiosk=potrosni) svakih 5 minuta šalju "ping" (GET /api/kiosk/ping?id=…&vrsta=…).
// Poslužitelj pamti zadnji signal po uređaju (tablica kiosk_signal, stvara se pri pokretanju kao potrosni_dnevnik), a kartica Evidencija rada prikazuje je li kiosk živ
// i upozorava kad radnim danom šuti. Ping ostaje lagan: odgovara odmah, a zapis ide nakon odgovora i nikad ne ruši zahtjev.
// Uređaj dolazi na popis tek nakon MIN_SIGNALA signala (≈ 10 min otvorene stranice) — posjetitelj koji samo otvori početnu stranicu prije prijave ne ulazi na popis.
const ID_UREDAJA = /^[A-Za-z0-9_-]{6,40}$/;
const VRSTE = ["evidencija", "potrosni"];
const MAX_UREDAJA = 30; // tvrda granica broja redaka (ping je bez prijave — nasumični id-evi ne smiju puniti bazu)
const MIN_SIGNALA = 3;
const RAZMAK_UPISA_MS = Number(process.env.KIOSK_RAZMAK_UPISA_MS ?? 2 * 60 * 1000); // najviše jedan zapis po uređaju u tom razmaku (test: 0)
const tekst = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);

// Kratki opis uređaja iz User-Agent zaglavlja (npr. "Android tablet · Chrome"); samo pomoć za prepoznavanje, ne sigurnosna provjera.
function opisUredaja(ua) {
  const s = String(ua || "");
  if (!s) return "nepoznat uređaj";
  const sustav = /Android/i.test(s) ? (/Mobile/i.test(s) ? "Android mobitel" : "Android tablet")
    : /iPad/i.test(s) ? "iPad" : /iPhone/i.test(s) ? "iPhone"
    : /Windows/i.test(s) ? "Windows" : /Macintosh|Mac OS/i.test(s) ? "Mac" : /CrOS/i.test(s) ? "Chromebook" : /Linux/i.test(s) ? "Linux" : "uređaj";
  const preglednik = /Edg\//i.test(s) ? "Edge" : /OPR\/|Opera/i.test(s) ? "Opera" : /Firefox|FxiOS/i.test(s) ? "Firefox" : /SamsungBrowser/i.test(s) ? "Samsung Internet"
    : /Chrome|CriOS/i.test(s) ? "Chrome" : /Safari/i.test(s) ? "Safari" : "preglednik";
  return `${sustav} · ${preglednik}`;
}

function registrirajPracenjeKioska(app, d) {
  const { pool, autentikacija, ucitajPozicijuZaposlenika, dozvolaZaKarticu } = d;
  const zadnjiUpis = new Map(); // id → vrijeme zadnjeg zapisa (razmak između zapisa)

  const pripremi = async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS kiosk_signal (
        id text PRIMARY KEY, vrsta text NOT NULL DEFAULT 'evidencija', uredaj text NOT NULL DEFAULT '', naziv text NOT NULL DEFAULT '',
        prvi timestamptz NOT NULL DEFAULT now(), zadnji timestamptz NOT NULL DEFAULT now(), signala integer NOT NULL DEFAULT 1)`);
      await pool.query("ALTER TABLE kiosk_signal ENABLE ROW LEVEL SECURITY");
      await pool.query("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON kiosk_signal FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON kiosk_signal FROM authenticated; END IF; END $$");
      const ocisti = () => pool.query("DELETE FROM kiosk_signal WHERE (signala < 3 AND zadnji < now() - interval '2 days') OR zadnji < now() - interval '180 days'").catch(() => {});
      await ocisti();
      setInterval(ocisti, 6 * 60 * 60 * 1000);
    } catch (e) {
      console.error("Greška kod pripreme tablice kioska:", e);
    }
  };

  const zabiljezi = async (req) => {
    const id = String(req.query?.id || "");
    if (!ID_UREDAJA.test(id)) return; // ping bez oznake uređaja (npr. vanjski nadzor dostupnosti) samo drži poslužitelj budnim
    const vrsta = VRSTE.includes(req.query.vrsta) ? req.query.vrsta : "evidencija";
    const sada = Date.now();
    const prosli = zadnjiUpis.get(id);
    if (prosli !== undefined && sada - prosli < RAZMAK_UPISA_MS) return;
    if (zadnjiUpis.size > 500) zadnjiUpis.clear();
    zadnjiUpis.set(id, sada);
    const postojeci = (await pool.query("SELECT id FROM kiosk_signal")).rows;
    if (!postojeci.some((x) => x.id === id) && postojeci.length >= MAX_UREDAJA) return;
    await pool.query(
      `INSERT INTO kiosk_signal (id, vrsta, uredaj) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET zadnji = now(), signala = kiosk_signal.signala + 1, vrsta = EXCLUDED.vrsta, uredaj = EXCLUDED.uredaj`,
      [id, vrsta, opisUredaja(req.headers["user-agent"])]
    );
  };
  // Lagana ruta (drži besplatni Render poslužitelj budnim): odgovara odmah, zapis ide poslije odgovora.
  app.get("/api/kiosk/ping", (req, res) => {
    res.json({ ok: true });
    zabiljezi(req).catch(() => {});
  });

  // ---------------- Pregled za prijavljene (kartica Evidencija rada) ----------------
  const ovlast = async (req, res, izmjene) => {
    const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
    const moduli = pozicija?.moduli?.length ? pozicija.moduli : ["dashboard"];
    const dz = dozvolaZaKarticu(pozicija, "evidencijasati", "evidencija");
    if (!moduli.includes("evidencijasati") || !dz.pristup || (izmjene && !dz.izmjene)) { res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za kioske." }); return false; }
    return true;
  };
  const obradi = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { console.error("Greška praćenja kioska:", e); res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." }); }
  };
  app.get("/api/kiosk/uredaji", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, false))) return;
    const r = await pool.query("SELECT id, vrsta, uredaj, naziv, prvi, zadnji, signala FROM kiosk_signal WHERE signala >= $1 ORDER BY zadnji DESC", [MIN_SIGNALA]);
    res.json({ sada: new Date().toISOString(), uredaji: r.rows.map((x) => ({ id: x.id, vrsta: x.vrsta, uredaj: x.uredaj, naziv: x.naziv || "", prvi: x.prvi, zadnji: x.zadnji, signala: Number(x.signala) })) });
  }));
  app.put("/api/kiosk/uredaji/:id/naziv", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, true))) return;
    if (!ID_UREDAJA.test(req.params.id)) return res.status(400).json({ error: "Neispravna oznaka uređaja." });
    const r = await pool.query("UPDATE kiosk_signal SET naziv = $2 WHERE id = $1", [req.params.id, tekst(req.body?.naziv, 40)]);
    if (!r.rowCount) return res.status(404).json({ error: "Uređaj nije pronađen." });
    res.json({ ok: true });
  }));
  // Uklanjanje starog uređaja (npr. zamijenjen tablet) — inače bi njegova tišina stalno upozoravala. Ako je kiosk ipak još živ, sam se vrati na popis nakon 3 signala.
  app.delete("/api/kiosk/uredaji/:id", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, true))) return;
    if (!ID_UREDAJA.test(req.params.id)) return res.status(400).json({ error: "Neispravna oznaka uređaja." });
    const r = await pool.query("DELETE FROM kiosk_signal WHERE id = $1", [req.params.id]);
    zadnjiUpis.delete(req.params.id);
    if (!r.rowCount) return res.status(404).json({ error: "Uređaj nije pronađen." });
    res.json({ ok: true });
  }));

  return { pripremi };
}

module.exports = { registrirajPracenjeKioska, opisUredaja, MIN_SIGNALA };

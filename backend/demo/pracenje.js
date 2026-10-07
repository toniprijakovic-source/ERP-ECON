// Praćenje posjeta DEMO verziji (samo DEMO_MODE=1): tko se i kada prijavio, s koje približne
// lokacije (prema IP adresi), s kojeg uređaja, koliko je vremena aktivno proveo i koje je module
// otvorio. Posjete su u zasebnoj tablici demo_posjete koju noćni reset NE briše.
//
// Izvještaj: GET /api/demo/izvjestaj?kljuc=<DEMO_IZVJESTAJ_KLJUC> (HTML), &format=csv za Excel.
// Bez postavljene varijable DEMO_IZVJESTAJ_KLJUC izvještaj ne postoji (404).
//
// Lokacija se određuje LOKALNO iz baze IP raspona (paket geoip-lite, podaci MaxMind GeoLite) —
// IP adrese ne napuštaju server. Približna je (grad ili samo država); za mobilne mreže često
// pokazuje grad operatera, a ne posjetitelja.
const crypto = require("crypto");
const net = require("net");

const HEARTBEAT_MAX_SEKUNDI = 45; // preglednik javlja aktivnost svakih 30 s; dulja stanka se ne broji
const ZONA = "Europe/Zagreb";

async function pripremiTablicu(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS demo_posjete (
    id              BIGSERIAL PRIMARY KEY,
    sesija          TEXT UNIQUE NOT NULL,
    pocetak         TIMESTAMPTZ NOT NULL DEFAULT now(),
    zadnje          TIMESTAMPTZ NOT NULL DEFAULT now(),
    aktivno_sekundi INT NOT NULL DEFAULT 0,
    ip              TEXT,
    grad            TEXT,
    regija          TEXT,
    drzava          TEXT,
    mreza           TEXT,
    uredjaj         TEXT,
    moduli          JSONB NOT NULL DEFAULT '[]'::jsonb
  )`);
}

const ipKlijenta = (req) => ocistiIp(String(req.headers["x-forwarded-for"] || "").split(",")[0]) || ocistiIp(req.socket.remoteAddress);
const jePrivatnaIp = (ip) => !ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80:|::ffff:127\.)/i.test(ip);
// Zaglavlje X-Forwarded-For šalje klijent — do baze i GeoIP pretrage stiže samo valjana, kratka IP adresa.
const ocistiIp = (ip) => { const s = String(ip || "").trim().slice(0, 64).replace(/^::ffff:(?=\d+\.)/, ""); return net.isIP(s) ? s : ""; };

function opisUredjaja(ua = "") {
  const sustav = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "nepoznat sustav";
  const preglednik = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "preglednik";
  const mobitel = /Mobile|iPhone|Android/.test(ua) && !/iPad|Tablet/.test(ua);
  return `${preglednik}, ${sustav}${mobitel ? " (mobitel)" : ""}`;
}

// geoip-lite drži bazu u memoriji (~150 MB) — učitava se tek pri prvoj prijavi, ne pri pokretanju.
let geoip = null;
const NAZIVI_DRZAVA = new Intl.DisplayNames(["hr"], { type: "region" });
function lokacijaIzIp(ip) {
  if (!ip || jePrivatnaIp(ip)) return null;
  try {
    geoip ||= require("geoip-lite");
    const g = geoip.lookup(ip);
    if (!g) return null;
    let drzava = g.country || null;
    try { if (drzava) drzava = NAZIVI_DRZAVA.of(drzava) || drzava; } catch { /* nepoznat kôd */ }
    return { grad: g.city || null, regija: null, drzava, mreza: null };
  } catch (e) {
    console.error("GeoIP pretraga nije uspjela:", e.message);
    return null;
  }
}

// Poziva se nakon uspješne prijave demo računom. Ne čeka se — prijava ne smije kasniti zbog praćenja.
function zabiljeziPrijavu(pool, req, sesija) {
  const ip = ipKlijenta(req);
  const lok = lokacijaIzIp(ip) || {};
  pool.query("INSERT INTO demo_posjete (sesija, ip, uredjaj, grad, regija, drzava, mreza) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (sesija) DO NOTHING",
    [sesija, ip, opisUredjaja(String(req.headers["user-agent"] || "").slice(0, 500)), lok.grad || null, lok.regija || null, lok.drzava || null, lok.mreza || null])
    .catch((e) => console.error("Praćenje prijave nije uspjelo:", e.message));
}

const MODUL_RE = /^[a-zA-Z]{1,40}$/;

function ukljuciPracenje(app, pool, autentikacija) {
  // Preglednik javlja da je kartica s aplikacijom otvorena i vidljiva (svakih 30 s i pri promjeni modula).
  app.post("/api/demo/aktivnost", autentikacija, async (req, res) => {
    if (!req.sesija) return res.json({ ok: true });
    const modul = MODUL_RE.test(String(req.body?.modul || "")) ? req.body.modul : null;
    const maxSekundi = req.body?.povratak ? 0 : HEARTBEAT_MAX_SEKUNDI; // povratak na karticu: vrijeme dok je bila skrivena se ne broji
    try {
      const r = await pool.query(
        `UPDATE demo_posjete SET
           aktivno_sekundi = aktivno_sekundi + LEAST($2, GREATEST(0, EXTRACT(EPOCH FROM now() - zadnje)))::int,
           zadnje = now(),
           moduli = CASE WHEN $3::text IS NULL OR moduli ? $3::text THEN moduli ELSE moduli || to_jsonb($3::text) END
         WHERE sesija = $1`,
        [req.sesija, maxSekundi, modul]
      );
      // Sesija nastala prije uvođenja praćenja (token iz ranije prijave): otvori zapis sada.
      if (r.rowCount === 0) await pool.query("INSERT INTO demo_posjete (sesija, ip, uredjaj, moduli) VALUES ($1, $2, $3, $4) ON CONFLICT (sesija) DO NOTHING", [req.sesija, ipKlijenta(req), opisUredjaja(req.headers["user-agent"]), JSON.stringify(modul ? [modul] : [])]);
      res.json({ ok: true });
    } catch (e) {
      console.error("Praćenje aktivnosti nije uspjelo:", e.message);
      res.json({ ok: false });
    }
  });

  app.get("/api/demo/izvjestaj", async (req, res) => {
    const kljuc = process.env.DEMO_IZVJESTAJ_KLJUC || "";
    const dano = String(req.query.kljuc || "");
    const ok = kljuc.length >= 12 && dano.length === kljuc.length && crypto.timingSafeEqual(Buffer.from(dano), Buffer.from(kljuc));
    if (!ok) return res.status(404).send("Not found");
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex");
    const dana = Math.min(Math.max(parseInt(req.query.dana, 10) || 90, 1), 3650);
    const r = await pool.query(`SELECT * FROM demo_posjete WHERE pocetak > now() - ($1 || ' days')::interval ORDER BY pocetak DESC`, [String(dana)]);
    const redovi = r.rows;
    if (req.query.format === "csv") {
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="demo-posjete.csv"`);
      return res.send("﻿" + csv(redovi));
    }
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(html(redovi, dana, dano));
  });
}

// ---------- prikaz ----------
const fmtVrijeme = (d) => new Intl.DateTimeFormat("hr-HR", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
const fmtTrajanje = (s) => { s = Number(s) || 0; if (s < 60) return s ? `${s} s` : "< 1 min"; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
const lokacija = (p) => [p.grad, p.regija && p.regija !== p.grad ? p.regija : null, p.drzava].filter(Boolean).join(", ") || "nepoznato";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NAZIVI_MODULA = { dashboard: "Nadzorna ploča", ponude: "Ponude", projekti: "Projekti", proizvodnja: "Proizvodnja", nabava: "Nabava", skladiste: "Skladište", kontrola: "Kontrola kvalitete", otpremnice: "Otpremnice i CMR", fakturiranje: "Financije", partneri: "Kupci i dobavljači", zaposlenici: "Zaposlenici" };
const moduliTekst = (m) => (Array.isArray(m) ? m : []).map((k) => NAZIVI_MODULA[k] || k).join(", ");

function csv(redovi) {
  const polja = ["Početak", "Zadnja aktivnost", "Aktivno (min)", "Grad", "Država", "Uređaj", "Moduli", "IP"];
  const c = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [polja.map(c).join(";"), ...redovi.map((p) => [fmtVrijeme(p.pocetak), fmtVrijeme(p.zadnje), Math.round(p.aktivno_sekundi / 60), p.grad, p.drzava, p.uredjaj, moduliTekst(p.moduli), p.ip].map(c).join(";"))].join("\r\n");
}

function html(redovi, dana, kljuc) {
  const ukupno = redovi.reduce((s, p) => s + (p.aktivno_sekundi || 0), 0);
  const lokacije = new Set(redovi.map(lokacija).filter((l) => l !== "nepoznato"));
  const tablica = redovi.map((p) => `<tr>
    <td>${esc(fmtVrijeme(p.pocetak))}</td>
    <td class="br">${esc(fmtTrajanje(p.aktivno_sekundi))}</td>
    <td>${esc(lokacija(p))}</td>
    <td>${esc(p.uredjaj || "")}</td>
    <td>${esc(moduliTekst(p.moduli)) || "—"}</td>
    <td class="sitno">${esc(p.ip || "")}<div>zadnje: ${esc(fmtVrijeme(p.zadnje))}</div></td>
  </tr>`).join("");
  return `<!doctype html><html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Demo · posjete</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F3F1EC;color:#1C2026;margin:0;padding:24px 16px}
  main{max-width:1200px;margin:0 auto} h1{font-size:24px;margin:0 0 4px} p{color:#4A5260;margin:0 0 20px}
  .kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
  .kpi div{background:#fff;border:1px solid #DDD8CD;border-left:4px solid #F5B400;border-radius:8px;padding:14px}
  .kpi b{display:block;font-size:26px} .kpi span{font-size:13px;color:#6A717C;text-transform:uppercase;letter-spacing:.04em}
  .omot{overflow-x:auto;background:#fff;border:1px solid #DDD8CD;border-radius:8px}
  table{border-collapse:collapse;width:100%;font-size:14px} th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #ECE8E0;vertical-align:top}
  th{background:#F8F6F2;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6A717C;white-space:nowrap}
  .br{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600} .sitno{font-size:12px;color:#6A717C}
  nav{margin-bottom:16px;font-size:14px} nav a{color:#215C77;margin-right:14px}
</style></head><body><main>
<h1>Posjete demo verziji</h1>
<p>Zadnjih ${dana} dana. Lokacija je približna (prema IP adresi), vrijeme je aktivno vrijeme dok je aplikacija bila otvorena i vidljiva.</p>
<nav><a href="?kljuc=${encodeURIComponent(kljuc)}&dana=7">7 dana</a><a href="?kljuc=${encodeURIComponent(kljuc)}&dana=30">30 dana</a><a href="?kljuc=${encodeURIComponent(kljuc)}&dana=365">godina</a><a href="?kljuc=${encodeURIComponent(kljuc)}&dana=${dana}&format=csv">Preuzmi CSV</a></nav>
<div class="kpi"><div><b>${redovi.length}</b><span>prijava</span></div><div><b>${esc(fmtTrajanje(ukupno))}</b><span>ukupno aktivno</span></div><div><b>${esc(fmtTrajanje(redovi.length ? Math.round(ukupno / redovi.length) : 0))}</b><span>prosjek po prijavi</span></div><div><b>${lokacije.size}</b><span>različitih lokacija</span></div></div>
<div class="omot"><table><thead><tr><th>Prijava</th><th>Aktivno</th><th>Lokacija</th><th>Uređaj</th><th>Otvoreni moduli</th><th>IP</th></tr></thead>
<tbody>${tablica || `<tr><td colspan="6">Još nema prijava u ovom razdoblju.</td></tr>`}</tbody></table></div>
<p class="sitno" style="margin-top:12px">Lokacija: GeoLite2 podaci tvrtke MaxMind (https://www.maxmind.com), licenca CC BY-SA 4.0.</p>
</main></body></html>`;
}

module.exports = { pripremiTablicu, zabiljeziPrijavu, ukljuciPracenje, opisUredjaja };

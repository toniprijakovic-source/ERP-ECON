// Rute za potrošni materijal (Skladište → Zalihe → Potrošni materijal, kiosk "Potrošni materijal", Skladište → Potrošnja po radniku).
// Logika brojeva je u potrosni.js; ovdje su samo ovlasti, transakcije i zapisi.
//  • popis artikala = app_data ključ "potrosniMaterijal" (objekt postavki: "potrosniPostavke"); stanje se mijenja SAMO ovim rutama, u transakciji nad
//    zaključanim popisom, pa zastarjeli tablet ili preglednik ne mogu prepisati stanje (PUT /api/data/<ključ> je isključen — vidi SAMO_CILJANO)
//  • dnevnik svakog kretanja = tablica potrosni_dnevnik (raste svaki dan, zato nije u app_data; stvara se pri pokretanju kao korekcije_bodova)
//  • kiosk rute nemaju prijavu (kao /api/kiosk/scan): osoba se prepoznaje karticom, a neprepoznate kartice se broje po IP adresi
const P = require("./potrosni");

const KLJUC = "potrosniMaterijal";
const POSTAVKE = "potrosniPostavke";
const tekst = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const greska = (status, poruka) => Object.assign(new Error(poruka), { httpStatus: status });
const SQL_DNEVNIK = {
  unos: "INSERT INTO potrosni_dnevnik (id, zaposlenik_id, zaposlenik, artikl_id, artikl, jm, kolicina, vrsta, zahtjev_id, korisnik_id, korisnik, napomena) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
  zahtjev: "SELECT 1 FROM potrosni_dnevnik WHERE zahtjev_id = $1 LIMIT 1",
  razdoblje: "SELECT zaposlenik_id, zaposlenik, artikl_id, artikl, jm, kolicina, vrsta, storno, vrijeme FROM potrosni_dnevnik WHERE vrsta = 'uzimanje' AND vrijeme >= $1 AND vrijeme < $2",
  radnik: "SELECT id, vrijeme, zaposlenik_id, zaposlenik, artikl_id, artikl, jm, kolicina, vrsta, storno, napomena FROM potrosni_dnevnik WHERE zaposlenik_id = $1 AND vrijeme >= $2 AND vrijeme < $3 ORDER BY vrijeme DESC",
  jedan: "SELECT id, artikl_id, kolicina, vrsta, storno FROM potrosni_dnevnik WHERE id = $1",
  storno: "UPDATE potrosni_dnevnik SET storno = true, storno_vrijeme = now(), storno_korisnik = $2 WHERE id = $1",
};

// Početak i kraj razdoblja (UTC granice dovoljno široke; mjesec se na kraju računa po zagrebačkoj zoni u agregirajPotrosnju).
const granice = (godina, mjesec) => {
  const poc = mjesec ? new Date(Date.UTC(godina, mjesec - 1, 1) - 2 * 3600 * 1000) : new Date(Date.UTC(godina, 0, 1) - 2 * 3600 * 1000);
  const kraj = mjesec ? new Date(Date.UTC(godina, mjesec, 1) - 2 * 3600 * 1000) : new Date(Date.UTC(godina + 1, 0, 1) - 2 * 3600 * 1000);
  return [poc.toISOString(), kraj.toISOString()];
};

function registrirajPotrosneRute(app, d) {
  const { pool, autentikacija, ucitajPozicijuZaposlenika, dozvolaZaKarticu, klijentIp, neuspjeliKiosk } = d;

  const pripremi = async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS potrosni_dnevnik (
        id text PRIMARY KEY, vrijeme timestamptz NOT NULL DEFAULT now(), zaposlenik_id text, zaposlenik text NOT NULL DEFAULT '',
        artikl_id text NOT NULL, artikl text NOT NULL DEFAULT '', jm text NOT NULL DEFAULT '', kolicina numeric NOT NULL, vrsta text NOT NULL,
        zahtjev_id text, storno boolean NOT NULL DEFAULT false, storno_vrijeme timestamptz, storno_korisnik text,
        korisnik_id text, korisnik text NOT NULL DEFAULT '', napomena text NOT NULL DEFAULT '')`);
      await pool.query("CREATE INDEX IF NOT EXISTS idx_potrosni_dnevnik_vrijeme ON potrosni_dnevnik (vrijeme DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_potrosni_dnevnik_radnik ON potrosni_dnevnik (zaposlenik_id, vrijeme DESC)");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_potrosni_dnevnik_zahtjev ON potrosni_dnevnik (zahtjev_id, artikl_id) WHERE zahtjev_id IS NOT NULL");
      await pool.query("ALTER TABLE potrosni_dnevnik ENABLE ROW LEVEL SECURITY");
      await pool.query("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON potrosni_dnevnik FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON potrosni_dnevnik FROM authenticated; END IF; END $$");
    } catch (e) {
      console.error("Greška kod pripreme tablice potrošnog materijala:", e);
    }
  };

  const imaKarticu = (pozicija, modul, kartica, izmjene) => {
    const moduli = pozicija?.moduli?.length ? pozicija.moduli : ["dashboard"];
    if (!moduli.includes(modul)) return false;
    const dz = dozvolaZaKarticu(pozicija, modul, kartica);
    return dz.pristup && (!izmjene || dz.izmjene);
  };
  // uvjeti: popis [modul, kartica, izmjene] — dovoljan je JEDAN. Šalje 403 i vraća null ako nitko nije ispunjen.
  const ovlast = async (req, res, ...uvjeti) => {
    const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
    if (!uvjeti.some(([m, k, i]) => imaKarticu(pozicija, m, k, i))) { res.status(403).json({ error: "Vaša pozicija nema ovlaštenje za ovu radnju." }); return null; }
    return pozicija;
  };
  const SKLADISTE_UREDI = ["skladiste", "zalihe", true];
  const obradi = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
      console.error("Greška potrošnog materijala:", e);
      res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." });
    }
  };
  // Transakcija nad zaključanim popisom artikala: fn(client, artikli) vraća { artikli?, odgovor }. Popis mora postojati (stvara ga DDL skripta).
  const uTransakciji = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const artikli = (await client.query("SELECT value FROM app_data WHERE key = $1 FOR UPDATE", [KLJUC])).rows[0]?.value;
      if (!Array.isArray(artikli)) throw greska(503, "Potrošni materijal još nije pripremljen na poslužitelju.");
      const r = await fn(client, artikli);
      if (r.artikli) await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'potrosniMaterijal'", [JSON.stringify(r.artikli)]);
      await client.query("COMMIT");
      return r.odgovor;
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  };
  const upisiDnevnik = (client, z) => client.query(SQL_DNEVNIK.unos, [z.id, z.zaposlenikId || null, z.zaposlenik || "", z.artikl.id, z.artikl.naziv, z.artikl.jm, z.kolicina, z.vrsta, z.zahtjevId || null, z.korisnikId || null, z.korisnik || "", z.napomena || ""]);
  const imeZaposlenika = (z) => (z ? `${z.ime} ${z.prezime}`.trim() : "");
  const noviId = () => `pd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const danasZagreb = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zagreb" });

  // Zadaci za naručivanje: otvoreni zadatak po artiklu (dok se ne zaprimi); ako odgovorna osoba nije određena, zadatka nema (artikl se vidi u popisu "Za naručiti").
  const zadaciZaUpozorenja = async (client, artikli, sada) => {
    if (!artikli.length) return;
    const postavke = (await client.query("SELECT value FROM app_data WHERE key = $1", [POSTAVKE])).rows[0]?.value || {};
    const osobaId = postavke.nabavaOsobaId;
    if (!osobaId) return;
    const zaposlenici = (await client.query("SELECT value FROM app_data WHERE key = $1", ["zaposlenici"])).rows[0]?.value || [];
    if (!zaposlenici.some((z) => z.id === osobaId)) return;
    const zadaci = (await client.query("SELECT value FROM app_data WHERE key = $1 FOR UPDATE", ["slobodniZadaci"])).rows[0]?.value || [];
    const novi = artikli.filter((a) => !zadaci.some((z) => z.potrosniArtiklId === a.id && !z.izvrseno)).map((a) => P.zadatakZaNarucivanje(a, osobaId, sada));
    if (!novi.length) return;
    await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'slobodniZadaci'", [JSON.stringify([...zadaci, ...novi])]);
  };
  // Kad se artikl zaprimi i upozorenje nestane, njegov otvoreni zadatak se zatvara.
  const zatvoriZadatke = async (client, artiklIds, korisnikId, sada) => {
    if (!artiklIds.length) return;
    const zadaci = (await client.query("SELECT value FROM app_data WHERE key = $1 FOR UPDATE", ["slobodniZadaci"])).rows[0]?.value;
    if (!Array.isArray(zadaci) || !zadaci.some((z) => artiklIds.includes(z.potrosniArtiklId) && !z.izvrseno)) return;
    const nova = zadaci.map((z) => (artiklIds.includes(z.potrosniArtiklId) && !z.izvrseno ? { ...z, izvrseno: true, izvrsioId: korisnikId, datumIzvrsenja: sada, dodjelaVidjena: true } : z));
    await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'slobodniZadaci'", [JSON.stringify(nova)]);
  };

  // ---------------- KIOSK (bez prijave, kartica) ----------------
  const kartica = async (req, res) => {
    const sirovi = req.body?.rfidKod;
    if (sirovi != null && (typeof sirovi !== "string" || sirovi.length > 40)) { res.status(400).json({ error: "Kartica nije prepoznata." }); return null; }
    const kod = (sirovi || "").trim().toUpperCase();
    if (!kod) { res.status(404).json({ error: "Kartica nije prepoznata." }); return null; }
    const ip = klijentIp(req);
    if (neuspjeliKiosk.blokiran(ip)) { res.status(429).json({ error: "Previše neprepoznatih kartica — pokušaj ponovno za nekoliko minuta." }); return null; }
    const zaposlenici = (await pool.query("SELECT value FROM app_data WHERE key = $1", ["zaposlenici"])).rows[0]?.value || [];
    const z = zaposlenici.find((x) => String(x.rfidKod || "").trim().toUpperCase() === kod);
    if (!z) { neuspjeliKiosk.zabiljezi(ip); res.status(404).json({ error: "Kartica nije prepoznata." }); return null; }
    return z;
  };
  app.post("/api/kiosk/potrosni/prijava", obradi(async (req, res) => {
    const z = await kartica(req, res);
    if (!z) return;
    const artikli = (await pool.query("SELECT value FROM app_data WHERE key = $1", [KLJUC])).rows[0]?.value;
    if (!Array.isArray(artikli)) return res.status(503).json({ error: "Potrošni materijal još nije pripremljen." });
    res.json({
      ime: z.ime, prezime: z.prezime,
      artikli: artikli.filter((a) => a.aktivan !== false).map((a) => ({ id: a.id, naziv: a.naziv, jm: a.jm, skupina: a.skupina || "" })).sort((a, b) => String(a.skupina).localeCompare(String(b.skupina), "hr") || a.naziv.localeCompare(b.naziv, "hr")),
    });
  }));
  app.post("/api/kiosk/potrosni/uzmi", obradi(async (req, res) => {
    const z = await kartica(req, res);
    if (!z) return;
    const zahtjevId = tekst(req.body?.zahtjevId, 60);
    if (!zahtjevId) return res.status(400).json({ error: "Neispravan zahtjev." });
    const odgovor = await uTransakciji(async (client, artikli) => {
      // isti zahtjev poslan dvaput (npr. tablet ponovi nakon prekida veze) ne smije dvaput skinuti sa zalihe
      if ((await client.query(SQL_DNEVNIK.zahtjev, [zahtjevId])).rowCount > 0) return { odgovor: { ok: true, vecZabiljezeno: true, ime: z.ime, prezime: z.prezime, stavke: [] } };
      const prov = P.provjeriStavke(artikli, req.body?.stavke);
      if (prov.greska) throw greska(400, prov.greska);
      const sada = new Date().toISOString();
      const r = P.primijeniUzimanje(artikli, prov.stavke, danasZagreb());
      for (const p of r.promjene) await upisiDnevnik(client, { id: noviId(), zaposlenikId: z.id, zaposlenik: imeZaposlenika(z), artikl: p.artikl, kolicina: p.kolicina, vrsta: "uzimanje", zahtjevId });
      await zadaciZaUpozorenja(client, r.novaUpozorenja, sada);
      return { artikli: r.artikli, odgovor: { ok: true, ime: z.ime, prezime: z.prezime, stavke: r.promjene.map((p) => ({ naziv: p.artikl.naziv, kolicina: p.kolicina, jm: p.artikl.jm })) } };
    });
    res.json(odgovor);
  }));

  // ---------------- Zalihe (prijavljeni) ----------------
  app.put("/api/potrosni/artikl", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, SKLADISTE_UREDI))) return;
    const odgovor = await uTransakciji(async (client, artikli) => {
      const r = P.upisiArtikl(artikli, req.body || {}, danasZagreb());
      if (r.greska) throw greska(400, r.greska);
      const korisnik = imeZaposlenika(((await client.query("SELECT value FROM app_data WHERE key = $1", ["zaposlenici"])).rows[0]?.value || []).find((x) => x.id === req.zaposlenikId));
      if (r.novi && r.artikl.stanje > 0) await upisiDnevnik(client, { id: noviId(), artikl: r.artikl, kolicina: r.artikl.stanje, vrsta: "korekcija", korisnikId: req.zaposlenikId, korisnik, napomena: "Početno stanje" });
      return { artikli: r.artikli, odgovor: { ok: true, artikl: r.artikl } };
    });
    res.json(odgovor);
  }));
  app.post("/api/potrosni/uvoz", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, SKLADISTE_UREDI))) return;
    const odgovor = await uTransakciji(async (client, artikli) => {
      const r = P.uvezi(artikli, req.body?.redovi, danasZagreb());
      if (r.greska) throw greska(400, r.greska);
      const korisnik = imeZaposlenika(((await client.query("SELECT value FROM app_data WHERE key = $1", ["zaposlenici"])).rows[0]?.value || []).find((x) => x.id === req.zaposlenikId));
      for (const a of r.dodano) if (a.stanje > 0) await upisiDnevnik(client, { id: noviId(), artikl: a, kolicina: a.stanje, vrsta: "korekcija", korisnikId: req.zaposlenikId, korisnik, napomena: "Početno stanje (uvoz)" });
      return { artikli: r.artikli, odgovor: { ok: true, dodano: r.dodano.length, preskoceno: r.preskoceno } };
    });
    res.json(odgovor);
  }));
  const promjenaStanja = (vrsta, izracun) => obradi(async (req, res) => {
    if (!(await ovlast(req, res, SKLADISTE_UREDI))) return;
    const odgovor = await uTransakciji(async (client, artikli) => {
      const sada = new Date().toISOString();
      const r = izracun(artikli, req.body || {});
      if (r.greska) throw greska(400, r.greska);
      const korisnik = imeZaposlenika(((await client.query("SELECT value FROM app_data WHERE key = $1", ["zaposlenici"])).rows[0]?.value || []).find((x) => x.id === req.zaposlenikId));
      const kolicina = vrsta === "korekcija" ? r.delta : Number(req.body.kolicina);
      await upisiDnevnik(client, { id: noviId(), artikl: r.artikl, kolicina, vrsta, korisnikId: req.zaposlenikId, korisnik, napomena: tekst(req.body.napomena, 200) });
      if (r.novoUpozorenje) await zadaciZaUpozorenja(client, [r.artikl], sada);
      if (r.ugaseno) await zatvoriZadatke(client, [r.artikl.id], req.zaposlenikId, sada);
      return { artikli: r.artikli, odgovor: { ok: true, artikl: r.artikl } };
    });
    res.json(odgovor);
  });
  app.post("/api/potrosni/zaprimi", autentikacija, promjenaStanja("zaprimanje", (a, b) => P.primijeniZaprimanje(a, b.artiklId, b.kolicina, danasZagreb())));
  app.post("/api/potrosni/korekcija", autentikacija, promjenaStanja("korekcija", (a, b) => P.primijeniKorekciju(a, b.artiklId, b.novoStanje, danasZagreb())));

  // "Naručeno": nabava (ili skladište) označi da je naručeno — artikl ostaje na popisu do zaprimanja, ali s datumom narudžbe.
  app.post("/api/potrosni/naruceno", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, SKLADISTE_UREDI, ["nabava", "narudzbenice", true]))) return;
    const odgovor = await uTransakciji(async (client, artikli) => {
      const a = artikli.find((x) => x.id === req.body?.artiklId);
      if (!a) throw greska(404, "Artikl ne postoji.");
      if (!a.naruciti) throw greska(400, "Artikl nije ispod minimuma.");
      const novi = { ...a, narucenoDatum: req.body.naruceno === false ? null : danasZagreb() };
      return { artikli: artikli.map((x) => (x.id === a.id ? novi : x)), odgovor: { ok: true, artikl: novi } };
    });
    res.json(odgovor);
  }));
  // Odgovorna osoba za naručivanje (dobiva zadatak kad artikl padne na minimum). Dok nije određena, zadataka nema.
  app.put("/api/potrosni/postavke", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, SKLADISTE_UREDI))) return;
    const osobaId = tekst(req.body?.nabavaOsobaId, 60);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (osobaId) {
        const zaposlenici = (await client.query("SELECT value FROM app_data WHERE key = $1", ["zaposlenici"])).rows[0]?.value || [];
        if (!zaposlenici.some((z) => z.id === osobaId)) throw greska(400, "Zaposlenik nije pronađen.");
      }
      const stare = (await client.query("SELECT value FROM app_data WHERE key = $1 FOR UPDATE", [POSTAVKE])).rows[0]?.value || {};
      const nove = { ...stare, nabavaOsobaId: osobaId };
      await client.query("INSERT INTO app_data (key, value, updated_at) VALUES ('potrosniPostavke', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(nove)]);
      await client.query("COMMIT");
      res.json({ ok: true, postavke: nove });
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  }));

  // ---------------- Potrošnja (pregled po radniku) ----------------
  const godinaIzUpita = (req) => { const g = Number(req.query.godina); return Number.isInteger(g) && g >= 2020 && g <= 2100 ? g : Number(danasZagreb().slice(0, 4)); };
  app.get("/api/potrosni/potrosnja", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, ["skladiste", "potrosnja", false]))) return;
    const godina = godinaIzUpita(req);
    const [od, do_] = granice(godina);
    const r = await pool.query(SQL_DNEVNIK.razdoblje, [od, do_]);
    res.json({ godina, redovi: P.agregirajPotrosnju(r.rows).filter((x) => x.mjesec.startsWith(`${godina}-`)) });
  }));
  app.get("/api/potrosni/dnevnik", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, ["skladiste", "potrosnja", false]))) return;
    const mjesec = /^(\d{4})-(\d{2})$/.exec(String(req.query.mjesec || ""));
    const zaposlenikId = tekst(req.query.zaposlenikId, 60);
    if (!mjesec || !zaposlenikId) return res.status(400).json({ error: "Navedi radnika i mjesec." });
    const [od, do_] = granice(Number(mjesec[1]), Number(mjesec[2]));
    const r = await pool.query(SQL_DNEVNIK.radnik, [zaposlenikId, od, do_]);
    res.json({ redovi: r.rows.filter((x) => P.mjesecZagreb(x.vrijeme) === `${mjesec[1]}-${mjesec[2]}`).map((x) => ({ id: x.id, vrijeme: x.vrijeme, artiklId: x.artikl_id, artikl: x.artikl, jm: x.jm, kolicina: Number(x.kolicina), vrsta: x.vrsta, storno: !!x.storno, napomena: x.napomena || "" })) });
  }));
  // Potrošnja po artiklu u zadnjih 30 dana (stupac u popisu zaliha).
  app.get("/api/potrosni/zadnjih30", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, ["skladiste", "zalihe", false], ["nabava", "narudzbenice", false]))) return;
    const sada = Date.now();
    const r = await pool.query(SQL_DNEVNIK.razdoblje, [new Date(sada - 30 * 24 * 3600 * 1000).toISOString(), new Date(sada + 24 * 3600 * 1000).toISOString()]);
    const m = {};
    r.rows.filter((x) => !x.storno).forEach((x) => { m[x.artikl_id] = P.zaokruzi((m[x.artikl_id] || 0) + Number(x.kolicina)); });
    res.json({ potroseno: m });
  }));
  app.post("/api/potrosni/storno", autentikacija, obradi(async (req, res) => {
    if (!(await ovlast(req, res, ["skladiste", "potrosnja", true]))) return;
    const zapisId = tekst(req.body?.zapisId, 80);
    const odgovor = await uTransakciji(async (client, artikli) => {
      const z = (await client.query(SQL_DNEVNIK.jedan, [zapisId])).rows[0];
      if (!z) throw greska(404, "Zapis ne postoji.");
      if (z.vrsta !== "uzimanje") throw greska(400, "Stornirati se može samo uzimanje.");
      if (z.storno) throw greska(400, "Zapis je već storniran.");
      const korisnik = imeZaposlenika(((await client.query("SELECT value FROM app_data WHERE key = $1", ["zaposlenici"])).rows[0]?.value || []).find((x) => x.id === req.zaposlenikId));
      const r = P.primijeniStorno(artikli, z.artikl_id, Number(z.kolicina), danasZagreb());
      await client.query(SQL_DNEVNIK.storno, [zapisId, korisnik || req.zaposlenikId]);
      if (r.ugaseno && r.artikl) await zatvoriZadatke(client, [r.artikl.id], req.zaposlenikId, new Date().toISOString());
      return { artikli: r.artikl ? r.artikli : undefined, odgovor: { ok: true, artikl: r.artikl } };
    });
    res.json(odgovor);
  }));

  return { pripremi };
}

module.exports = { registrirajPotrosneRute };

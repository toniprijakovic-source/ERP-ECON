// Dokumenti projekta na serveru ECON-R550 — poslužiteljska strana (most radi u most/lib/dokumenti.js).
//
// STRUKTURA MAPA: za projekte otvorene u ERP-u NAKON uvođenja ove funkcije most napravi mapu projekta i standardne podmape. "Novi" znači:
// projekta nije bilo na popisu zapamćenom pri prvom pokretanju (most_stanje "strukturaPocetak"), pa postojeći projekti ostaju kakvi jesu.
// Kad most javi da je struktura napravljena, projekt ide na popis "strukturaGotovo" i putanja se upiše kao "Mapa projekta" (samo ako je
// polje prazno). Greška (npr. Z: nije spojen) se pamti i most pokušava ponovno.
//
// PRAĆENJE MAPA: most svakih nekoliko minuta šalje sažetak mapa aktivnih projekata (kartica Dokumenti u projektu) i promjene:
//   laser    — mape "Laser za limove" / "Laser za profile": zadatak u zvoncu osobi odabranoj u Direktorski pregled → Stanje servera,
//   nacrti   — "Od kupca" i "Za proizvodnju" (nove revizije): zadatak voditelju projekta i voditeljima proizvodnje; potvrđuje se u kartici
//              Dokumenti uz napomenu što se promijenilo i koje naloge pogađa,
//   odobrenje — nove mape "Poslano/Odgovor/Freigabe DATUM": samo zapis u kartici (bez zvonca).
// Događaji su u tablici most_dogadaji (ulazi u satnu sigurnosnu kopiju). Otvoreni zadatak za isto područje istog projekta se ažurira
// umjesto da se gomilaju novi; zatvoreni sustavski zadaci stariji od 30 dana se brišu.
const crypto = require("crypto");

const tekst = (v, max) => String(v ?? "").slice(0, max);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const PUTANJA = /^(?:[A-Za-z]:[\\/]|\\\\[^\\])/;
const CUVAJ_ZATVORENE_DANA = 30;
const VRSTE = ["laser", "nacrti", "odobrenje"];
const NAZIV_PODRUCJA = { laser: "Laser", kupac: "Nacrti od kupca", proizvodnja: "Nacrti za proizvodnju" };

// ---------------- Čista logika (testovi: test/dokumenti-projekta.test.js) ----------------
const popisNaziva = (v, max = 200) => (Array.isArray(v) ? v.slice(0, max).map((x) => tekst(x, 300)) : []);
// Događaj koji javi most — samo dopuštena polja i duljine.
function ocistiDogadaj(d) {
  const vrsta = VRSTE.includes(d?.vrsta) ? d.vrsta : null;
  if (!vrsta || !tekst(d?.projektId, 80)) return null;
  const broj = (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined);
  const osnova = { projektId: tekst(d.projektId, 80), vrsta };
  if (vrsta === "odobrenje") return { ...osnova, mape: popisNaziva(d.mape, 50) };
  const podaci = {
    ...osnova, podrucje: tekst(d.podrucje, 300), dodano: popisNaziva(d.dodano), izmijenjeno: popisNaziva(d.izmijenjeno), obrisano: popisNaziva(d.obrisano),
    ...(broj(d.dodanoUkupno) ? { dodanoUkupno: broj(d.dodanoUkupno) } : {}), ...(broj(d.izmijenjenoUkupno) ? { izmijenjenoUkupno: broj(d.izmijenjenoUkupno) } : {}), ...(broj(d.obrisanoUkupno) ? { obrisanoUkupno: broj(d.obrisanoUkupno) } : {}),
  };
  if (vrsta === "laser") return { ...podaci, faza: ["C", "D"].includes(d.faza) ? d.faza : "" };
  return { ...podaci, gdje: d.gdje === "kupac" ? "kupac" : "proizvodnja", revizije: (Array.isArray(d.revizije) ? d.revizije.slice(0, 100) : []).map((r) => ({ naziv: tekst(r?.naziv, 300), prije: tekst(r?.prije, 300) })) };
}

const kratkoIme = (n) => String(n).split("/").pop();
const broj = (d, k) => d[`${k}Ukupno`] || (d[k] || []).length;
// Hrvatska množina: 1 nova datoteka, 2–4 nove datoteke, 5+ novih datoteka (11–14 kao 5+).
const mnozina = (n, jedan, dva, pet) => (n % 10 === 1 && n % 100 !== 11 ? jedan : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? dva : pet);
// Kratki opis za zvonce i popis događaja.
function opisDogadaja(d, sifra = "") {
  const dio = [];
  if (d.vrsta === "odobrenje") return `${sifra ? `${sifra}: ` : ""}nova mapa odobravanja nacrta: ${(d.mape || []).map(kratkoIme).join(", ")}`;
  (d.revizije || []).slice(0, 3).forEach((r) => dio.push(`nova revizija ${kratkoIme(r.naziv)} (prije ${kratkoIme(r.prije)})`));
  const revNazivi = new Set((d.revizije || []).map((r) => r.naziv));
  const dodano = (d.dodano || []).filter((n) => !revNazivi.has(n));
  const nDodano = broj(d, "dodano") - (d.revizije || []).length;
  if (nDodano > 0) dio.push(`${nDodano} ${mnozina(nDodano, "nova datoteka", "nove datoteke", "novih datoteka")}${dodano.length ? ` (${dodano.slice(0, 3).map(kratkoIme).join(", ")}${dodano.length > 3 ? ", …" : ""})` : ""}`);
  const nIzm = broj(d, "izmijenjeno"), nObr = broj(d, "obrisano");
  if (nIzm) dio.push(`${nIzm} ${mnozina(nIzm, "izmijenjena", "izmijenjene", "izmijenjenih")}${(d.izmijenjeno || []).length ? ` (${d.izmijenjeno.slice(0, 2).map(kratkoIme).join(", ")}${d.izmijenjeno.length > 2 ? ", …" : ""})` : ""}`);
  if (nObr) dio.push(`${nObr} ${mnozina(nObr, "obrisana", "obrisane", "obrisanih")}`);
  const gdje = d.vrsta === "laser" ? kratkoIme(d.podrucje || "Laser") : NAZIV_PODRUCJA[d.gdje] || "Nacrti";
  return tekst(`${gdje}${sifra ? ` · ${sifra}` : ""}: ${dio.join("; ") || "promjena"}`, 280);
}

// Primatelji zadatka za događaj: laser → odabrana osoba za laser; nacrti → voditelj projekta + voditelji proizvodnje (ako nikoga nema,
// osoba koja prima upozorenja servera); odobrenje → nitko (samo zapis).
function primateljiDogadaja(d, projekt, zaposlenici, pozicije, postavke = {}) {
  const aktivni = new Map((zaposlenici || []).filter((z) => z && z.status !== "Neaktivan").map((z) => [z.id, z]));
  if (d.vrsta === "laser") return postavke.laserPrimateljId && aktivni.has(postavke.laserPrimateljId) ? [postavke.laserPrimateljId] : [];
  if (d.vrsta !== "nacrti") return [];
  const vodPro = new Set((pozicije || []).filter((p) => String(p?.naziv || "").trim().toLowerCase() === "voditelj proizvodnje").map((p) => p.id));
  const ids = [projekt?.voditeljId, ...[...aktivni.values()].filter((z) => vodPro.has(z.pozicijaId)).map((z) => z.id)].filter((id) => id && aktivni.has(id));
  const jedinstveni = [...new Set(ids)];
  if (jedinstveni.length) return jedinstveni;
  return postavke.primateljId && aktivni.has(postavke.primateljId) ? [postavke.primateljId] : [];
}

// Zadaci u zvoncu: novi = [{ dogadajId, kljuc, projektId, primatelji, naziv }]. Otvoreni zadatak s istim ključem i primateljem se ažurira.
function uskladiZadatkeDokumenata(zadaci, novi, sada) {
  let popis = Array.isArray(zadaci) ? [...zadaci] : [];
  let promijenjeno = false;
  const granica = Date.parse(sada) - CUVAJ_ZATVORENE_DANA * 24 * 3600 * 1000;
  const prije = popis.length;
  popis = popis.filter((z) => !(z && z.zadaoId === "sustav" && z.dokumentiKljuc && z.izvrseno && Date.parse(z.datumIzvrsenja || z.zadanoDatum || sada) < granica));
  if (popis.length !== prije) promijenjeno = true;
  for (const n of novi) {
    for (const primatelj of n.primatelji) {
      const i = popis.findIndex((z) => z && z.zadaoId === "sustav" && z.dokumentiKljuc === n.kljuc && z.dodijeljenoId === primatelj && !z.izvrseno);
      if (i >= 0) {
        popis[i] = { ...popis[i], naziv: n.naziv, zadanoDatum: sada, dodjelaVidjena: false, dokumentiDogadajId: n.dogadajId };
      } else {
        popis.push({
          id: `dok-${n.dogadajId.slice(0, 12)}-${crypto.randomBytes(3).toString("hex")}`, naziv: n.naziv, dodijeljenoId: primatelj, planiraniDatum: null,
          izvrseno: false, izvrsioId: null, datumIzvrsenja: null, kreiraoId: "sustav", zadaoId: "sustav", zadanoDatum: sada, dodjelaVidjena: false,
          projektId: n.projektId, dokumentiKljuc: n.kljuc, dokumentiDogadajId: n.dogadajId,
        });
      }
      promijenjeno = true;
    }
  }
  return { zadaci: popis, promijenjeno };
}

// Novi projekti kojima treba napraviti strukturu mapa (nisu bili na početnom popisu, nisu gotovi, nisu arhivirani, imaju šifru).
function projektiZaStrukturu(projekti, pocetak, gotovo) {
  const bili = new Set(pocetak?.postojeci || []);
  return (projekti || []).filter((p) => p && p.id && !bili.has(p.id) && !(gotovo || {})[p.id] && p.status !== "Arhiviran" && String(p.sifra || "").trim());
}

// ---------------- Rute ----------------
function registrirajDokumente(app, d) {
  const { pool, autentikacija, mostAutentikacija, ucitajKljuc, ucitajPozicijuZaposlenika } = d;
  const obradi = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { console.error("Greška dokumenata projekta:", req.method, req.path, e); res.status(500).json({ error: "Greška na poslužitelju — pokušaj ponovno." }); }
  };
  const ucitajStanje = async (kljuc) => (await pool.query("SELECT vrijednost FROM most_stanje WHERE kljuc = $1", [kljuc])).rows[0]?.vrijednost ?? null;
  const spremiStanje = (kljuc, vrijednost) => pool.query(
    `INSERT INTO most_stanje (kljuc, vrijednost, azurirano) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (kljuc) DO UPDATE SET vrijednost = EXCLUDED.vrijednost, azurirano = now()`, [kljuc, JSON.stringify(vrijednost)]);

  // Početni popis postojećih projekata: tko god prvi zatreba (pokretanje ili prvi upit mosta), samo jednom.
  let pocetakObecanje = null;
  const osigurajPocetak = () => {
    if (!pocetakObecanje) {
      pocetakObecanje = (async () => {
        const postoji = await ucitajStanje("strukturaPocetak");
        if (postoji?.postojeci) return postoji;
        const projekti = (await ucitajKljuc("projekti")) || [];
        const pocetak = { vrijeme: new Date().toISOString(), postojeci: projekti.filter((p) => p?.id).map((p) => p.id) };
        await spremiStanje("strukturaPocetak", pocetak);
        return pocetak;
      })().catch((e) => { pocetakObecanje = null; throw e; });
    }
    return pocetakObecanje;
  };

  const pripremi = async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS most_dogadaji (
        id text PRIMARY KEY, projekt_id text NOT NULL, vrsta text NOT NULL, podaci jsonb NOT NULL DEFAULT '{}',
        vrijeme timestamptz NOT NULL DEFAULT now(), primatelji jsonb NOT NULL DEFAULT '[]',
        potvrdio text, potvrdeno timestamptz, napomena text NOT NULL DEFAULT '')`);
      await pool.query("CREATE INDEX IF NOT EXISTS idx_most_dogadaji_projekt ON most_dogadaji (projekt_id, vrijeme DESC)");
      await pool.query("ALTER TABLE most_dogadaji ENABLE ROW LEVEL SECURITY");
      await pool.query("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON most_dogadaji FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON most_dogadaji FROM authenticated; END IF; END $$");
      await osigurajPocetak();
    } catch (e) {
      console.error("Greška kod pripreme dokumenata projekta:", e);
    }
  };

  // Upis putanja u projekte (samo prazno polje; ispravljena mapa samo ako je u polju i dalje stara, sad nepostojeća putanja).
  const upisiMape = async (upisi) => {
    if (!upisi.length) return [];
    const upisano = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const projekti = (await client.query("SELECT value FROM app_data WHERE key = 'projekti' FOR UPDATE")).rows[0]?.value || [];
      const poId = new Map(upisi.map((u) => [u.projektId, u]));
      const nova = projekti.map((p) => {
        const u = p && poId.get(p.id);
        if (!u) return p;
        const trenutna = String(p.mapa || "").trim();
        if (u.stara ? trenutna !== u.stara : trenutna) return p;
        upisano.push({ projektId: p.id, sifra: tekst(p.sifra, 60), mapa: u.mapa });
        return { ...p, mapa: u.mapa };
      });
      if (upisano.length) await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'projekti'", [JSON.stringify(nova)]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return upisano;
  };

  // ---- Most: struktura mapa ----
  app.get("/api/most/projekti-za-strukturu", mostAutentikacija, obradi(async (req, res) => {
    const pocetak = await osigurajPocetak();
    const [projekti, kupci, gotovo] = await Promise.all([ucitajKljuc("projekti"), ucitajKljuc("kupci"), ucitajStanje("strukturaGotovo")]);
    const kupacPoId = new Map((kupci || []).map((k) => [k.id, k]));
    res.json({ projekti: projektiZaStrukturu(projekti, pocetak, gotovo).slice(0, 20).map((p) => ({ id: p.id, sifra: tekst(String(p.sifra).trim(), 60), naziv: tekst(p.naziv, 160), kupac: tekst(kupacPoId.get(p.kupacId)?.naziv, 160), mapa: tekst(p.mapa, 400) })) });
  }));
  app.post("/api/most/projekti/struktura", mostAutentikacija, obradi(async (req, res) => {
    const rezultati = Array.isArray(req.body?.rezultati) ? req.body.rezultati.slice(0, 50) : [];
    const sada = new Date().toISOString();
    const [projekti, gotovoStaro, greskeStaro] = await Promise.all([ucitajKljuc("projekti"), ucitajStanje("strukturaGotovo"), ucitajStanje("strukturaGreske")]);
    const poId = new Map((projekti || []).map((p) => [p.id, p]));
    const gotovo = { ...(gotovoStaro || {}) }, greske = { ...(greskeStaro || {}) };
    const upisi = [];
    for (const r of rezultati) {
      const id = tekst(r?.projektId, 80);
      const p = poId.get(id);
      if (!p) continue;
      if (r.greska) { greske[id] = { sifra: tekst(p.sifra, 60), greska: tekst(r.greska, 400), vrijeme: sada }; continue; }
      const mapa = tekst(r.mapa, 400).trim();
      if (!PUTANJA.test(mapa)) { greske[id] = { sifra: tekst(p.sifra, 60), greska: "Most je javio neispravnu putanju.", vrijeme: sada }; continue; }
      gotovo[id] = { sifra: tekst(p.sifra, 60), mapa, novaMapa: !!r.novaMapa, stvoreno: popisNaziva(r.stvoreno, 40), vrijeme: sada };
      delete greske[id];
      upisi.push({ projektId: id, mapa });
    }
    const upisano = await upisiMape(upisi);
    await spremiStanje("strukturaGotovo", gotovo);
    await spremiStanje("strukturaGreske", greske);
    res.json({ ok: true, upisano });
  }));

  // ---- Most: praćenje mapa ----
  app.get("/api/most/projekti-za-pracenje", mostAutentikacija, obradi(async (req, res) => {
    const projekti = (await ucitajKljuc("projekti")) || [];
    res.json({ projekti: projekti.filter((p) => p && p.id && String(p.sifra || "").trim() && p.status !== "Arhiviran").map((p) => ({ id: p.id, sifra: tekst(String(p.sifra).trim(), 60), mapa: tekst(p.mapa, 400) })) });
  }));
  app.post("/api/most/dokumenti", mostAutentikacija, obradi(async (req, res) => {
    const b = req.body || {};
    const sada = new Date().toISOString();
    const [projekti, zaposlenici, pozicije, postavke, stari] = await Promise.all([ucitajKljuc("projekti"), ucitajKljuc("zaposlenici"), ucitajKljuc("pozicijeZaposlenika"), ucitajStanje("postavke"), ucitajStanje("dokumenti")]);
    const poId = new Map((projekti || []).map((p) => [p.id, p]));
    // Sažeci: aktivni projekti iz ovog javljanja (zamjenjuju stare); projekti koji više nisu aktivni otpadaju.
    const sazeci = {};
    for (const x of Array.isArray(b.projekti) ? b.projekti.slice(0, 500) : []) {
      const id = tekst(x?.projektId, 80);
      if (!poId.has(id)) continue;
      sazeci[id] = x.greska
        ? { greska: tekst(x.greska, 400), vrijeme: sada }
        : { mapa: tekst(x.mapa, 400), ukupno: Number(x.ukupno) || 0, zadnja: iso(x.zadnja), prekinuto: !!x.prekinuto, vrijeme: sada,
          podmape: (Array.isArray(x.podmape) ? x.podmape.slice(0, 80) : []).map((m) => ({ naziv: tekst(m?.naziv, 200), datoteka: Number(m?.datoteka) || 0, zadnja: iso(m?.zadnja) })) };
    }
    await spremiStanje("dokumenti", { ...(stari && typeof stari === "object" ? Object.fromEntries(Object.entries(stari).filter(([id]) => poId.get(id)?.status !== "Arhiviran" && poId.has(id))) : {}), ...sazeci });

    // Događaji → tablica + zadaci u zvoncu.
    const zaZvonce = [];
    for (const sirov of Array.isArray(b.dogadaji) ? b.dogadaji.slice(0, 300) : []) {
      const dg = ocistiDogadaj(sirov);
      const projekt = dg && poId.get(dg.projektId);
      if (!projekt) continue;
      const primatelji = primateljiDogadaja(dg, projekt, zaposlenici, pozicije, postavke || {});
      const id = crypto.randomUUID();
      const { projektId, vrsta, ...podaci } = dg;
      await pool.query("INSERT INTO most_dogadaji (id, projekt_id, vrsta, podaci, primatelji) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)", [id, projektId, vrsta, JSON.stringify(podaci), JSON.stringify(primatelji)]);
      if (primatelji.length) zaZvonce.push({ dogadajId: id, kljuc: `${projektId}|${vrsta}|${dg.podrucje || ""}`, projektId, primatelji, naziv: `${opisDogadaja(dg, tekst(projekt.sifra, 60))}${vrsta === "nacrti" ? " — potvrdite u projektu (Dokumenti)" : ""}` });
    }
    if (zaZvonce.length) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const zadaci = (await client.query("SELECT value FROM app_data WHERE key = 'slobodniZadaci' FOR UPDATE")).rows[0]?.value || [];
        const u = uskladiZadatkeDokumenata(zadaci, zaZvonce, sada);
        if (u.promijenjeno) await client.query(`INSERT INTO app_data (key, value, updated_at) VALUES ('slobodniZadaci', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(u.zadaci)]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
    // Preimenovana mapa: upiši novu putanju ako je u projektu i dalje stara.
    const ispravci = (Array.isArray(b.ispravljeneMape) ? b.ispravljeneMape.slice(0, 100) : [])
      .map((x) => ({ projektId: tekst(x?.projektId, 80), stara: tekst(x?.stara, 400).trim(), mapa: tekst(x?.nova, 400).trim() }))
      .filter((x) => poId.has(x.projektId) && x.stara && PUTANJA.test(x.mapa));
    const ispravljeno = await upisiMape(ispravci);
    res.json({ ok: true, sifre: Object.fromEntries([...poId.values()].filter((p) => sazeci[p.id]).map((p) => [p.id, tekst(p.sifra, 60)])), ispravljeno });
  }));

  // ---- Aplikacija: kartica Dokumenti u projektu ----
  // Kartica je u detalju projekta, pa traži modul Projekti (kartica Projekti). Potvrditi smije onaj tko ima izmjene te kartice ili primatelj
  // obavijesti (npr. osoba za laser). Primatelj bez modula Projekti (npr. voditelj proizvodnje) dobiva obavijest u zvoncu i zatvara je tamo.
  const dozvole = async (req) => {
    const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
    const moduli = pozicija?.moduli?.length ? pozicija.moduli : ["dashboard"];
    const k = pozicija?.karticeDozvole?.projekti?.projekti;
    const imaModul = moduli.includes("projekti") && k?.pristup !== false;
    return { citanje: imaModul, izmjene: imaModul && k?.izmjene !== false };
  };
  const uRedak = (r, mojId, mozeSve) => {
    const primatelji = Array.isArray(r.primatelji) ? r.primatelji : [];
    return {
      id: r.id, vrsta: r.vrsta, vrijeme: iso(r.vrijeme), podaci: r.podaci || {}, primatelji,
      potvrdio: r.potvrdio || null, potvrdeno: iso(r.potvrdeno), napomena: r.napomena || "",
      mozePotvrditi: !r.potvrdeno && r.vrsta !== "odobrenje" && (mozeSve || primatelji.includes(mojId)),
    };
  };
  app.get("/api/dokumenti/projekt/:id", autentikacija, obradi(async (req, res) => {
    const dz = await dozvole(req);
    if (!dz.citanje) return res.status(403).json({ error: "Vaša pozicija nema pristup projektima." });
    const id = tekst(req.params.id, 80);
    const [dokumenti, gotovo, greske, pocetak] = await Promise.all([ucitajStanje("dokumenti"), ucitajStanje("strukturaGotovo"), ucitajStanje("strukturaGreske"), ucitajStanje("strukturaPocetak")]);
    const r = await pool.query("SELECT id, projekt_id, vrsta, podaci, vrijeme, primatelji, potvrdio, potvrdeno, napomena FROM most_dogadaji WHERE projekt_id = $1 ORDER BY vrijeme DESC LIMIT 100", [id]);
    res.json({
      sazetak: dokumenti?.[id] || null,
      struktura: { gotovo: gotovo?.[id] || null, greska: greske?.[id] || null, novi: !!pocetak?.postojeci && !pocetak.postojeci.includes(id) },
      dogadaji: r.rows.map((x) => uRedak(x, req.zaposlenikId, dz.izmjene)),
    });
  }));
  app.post("/api/dokumenti/dogadaj/:id/potvrdi", autentikacija, obradi(async (req, res) => {
    const dz = await dozvole(req);
    const id = tekst(req.params.id, 80);
    const r = (await pool.query("SELECT id, projekt_id, vrsta, podaci, vrijeme, primatelji, potvrdio, potvrdeno, napomena FROM most_dogadaji WHERE id = $1", [id])).rows[0];
    if (!r) return res.status(404).json({ error: "Zapis nije pronađen." });
    if (!uRedak(r, req.zaposlenikId, dz.izmjene).mozePotvrditi) return res.status(r.potvrdeno ? 409 : 403).json({ error: r.potvrdeno ? "Već je potvrđeno." : "Ovu promjenu potvrđuje voditelj projekta ili osoba kojoj je stigla obavijest." });
    const napomena = tekst(String(req.body?.napomena || "").trim(), 1000);
    const u = await pool.query("UPDATE most_dogadaji SET potvrdio = $2, potvrdeno = now(), napomena = $3 WHERE id = $1 AND potvrdeno IS NULL", [id, req.zaposlenikId, napomena]);
    if (!u.rowCount) return res.status(409).json({ error: "Već je potvrđeno." });
    // Zadaci u zvoncu za ovu promjenu se zatvaraju.
    const sada = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const zadaci = (await client.query("SELECT value FROM app_data WHERE key = 'slobodniZadaci' FOR UPDATE")).rows[0]?.value || [];
      let promjena = false;
      const nova = zadaci.map((z) => (z && z.dokumentiDogadajId === id && !z.izvrseno ? (promjena = true, { ...z, izvrseno: true, izvrsioId: req.zaposlenikId, datumIzvrsenja: sada }) : z));
      if (promjena) await client.query("UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'slobodniZadaci'", [JSON.stringify(nova)]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }));

  return { pripremi };
}

module.exports = { registrirajDokumente, ocistiDogadaj, opisDogadaja, primateljiDogadaja, uskladiZadatkeDokumenata, projektiZaStrukturu };

// SKIDANJE SATI RADNIKU (Evidencija sati → Sati po nalozima → Dnevni unos): voditelj proizvodnje radniku koji je zabušavao skine dio sati tog dana
// i upiše razlog. Vrijeme dolaska i odlaska s kioska se NE mijenja (evidencija radnog vremena ostaje stvarna prisutnost); korekcija je zaseban zapis
// u app_data "korekcijeSati" (jedan aktivan zapis po radniku i danu). Aplikacija svugdje prikazuje i obračunava korigirane sate (mreža Evidencije rada,
// zbrojevi, PDF evidencije, obračun plaće), bez ikakve napomene; tko je, kada, koliko i zašto skinuo vide samo osobe s posebnom dozvolom.
// Izmjena i brisanje se ne gube: zapis čuva povijest, a obrisani zapis ostaje označen kao obrisan.
//
// Posebna dozvola je po zadanom ISKLJUČENA: admin je uključuje kvačicom u Zaposlenici → Pozicije (karticeDozvole.evidencijasati.skidanjesati.pristup
// === true), a pozicija uz to mora imati modul Evidencija sati s pristupom i izmjenama kartice Sati po nalozima.

const KLJUC = "korekcijeSati";
const KORAK_SATI = 0.5; // obračunska jedinica (30 min)
const MAX_SATI = 16;
const MAX_RAZLOG = 300;

const tekst = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const datumIso = (v) => { const s = String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T12:00:00Z`)) ? s : ""; };
const greska = (status, poruka) => Object.assign(new Error(poruka), { httpStatus: status });

const dozvolaKartice = (pozicija, modul, kartica) => {
  const e = pozicija?.karticeDozvole?.[modul]?.[kartica];
  return { pristup: e?.pristup !== false, izmjene: e?.izmjene !== false };
};
const smijeSkidatiSate = (pozicija) => {
  if (!(pozicija?.moduli || []).includes("evidencijasati")) return false;
  const k = dozvolaKartice(pozicija, "evidencijasati", "satinalozi");
  return k.pristup && k.izmjene && pozicija?.karticeDozvole?.evidencijasati?.skidanjesati?.pristup === true;
};

// Gornja granica za provjeru na poslužitelju: zbroj sirovog trajanja (odlazak − dolazak) zapisa s prisutnošću tog dana. Točne obračunske sate (zaokruživanje,
// početak smjene) računa aplikacija; sirovo trajanje nikad nije manje od njih, pa ova provjera samo odbija očito pogrešan unos.
const satiPrisutnosti = (evidencija, zaposlenikId, datum) => (Array.isArray(evidencija) ? evidencija : [])
  .filter((e) => e && e.zaposlenikId === zaposlenikId && String(e.vrijemeDolaska || "").slice(0, 10) === datum && ((e.vrsta || "rad") === "rad" || e.vrsta === "montazaHR") && e.vrijemeOdlaska)
  .reduce((s, e) => s + Math.max(0, (Date.parse(e.vrijemeOdlaska) - Date.parse(e.vrijemeDolaska)) / 3600000), 0);

const noviId = () => `ks_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Primjena jednog zahtjeva { zaposlenikId, datum, sati, razlog } na popis. sati = 0 briše aktivni zapis (ostaje označen kao obrisan).
// Vraća { popis, promijenjeno }. Baca grešku s httpStatus za neispravan zahtjev.
function primijeniKorekciju(popis, zahtjev, { korisnikId, sada, zaposlenici, evidencija }) {
  const trenutno = Array.isArray(popis) ? popis : [];
  const zaposlenikId = tekst(zahtjev?.zaposlenikId, 80);
  if (!zaposlenikId || !(zaposlenici || []).some((z) => z.id === zaposlenikId)) throw greska(400, "Radnik nije pronađen.");
  const datum = datumIso(zahtjev?.datum);
  if (!datum) throw greska(400, "Neispravan datum.");
  const sutra = new Date(Date.parse(sada) + 36 * 3600000).toISOString().slice(0, 10);
  if (datum > sutra) throw greska(400, "Sati se ne mogu skinuti za budući dan.");
  const sati = Number(zahtjev?.sati);
  if (!Number.isFinite(sati) || sati < 0 || sati > MAX_SATI) throw greska(400, "Neispravan broj sati.");
  if (Math.abs(sati / KORAK_SATI - Math.round(sati / KORAK_SATI)) > 1e-9) throw greska(400, "Sati se skidaju po pola sata (0,5 h).");
  const razlog = tekst(zahtjev?.razlog, MAX_RAZLOG);
  const aktivni = trenutno.find((k) => k && !k.obrisano && k.zaposlenikId === zaposlenikId && k.datum === datum);

  if (sati === 0) {
    if (!aktivni) return { popis: trenutno, promijenjeno: false };
    const obrisan = { ...aktivni, obrisano: true, obrisaoId: korisnikId, obrisanoVrijeme: sada, povijest: [...(aktivni.povijest || []), { vrijeme: sada, korisnikId, radnja: "brisanje", sati: 0, razlog: "" }] };
    return { popis: trenutno.map((k) => (k === aktivni ? obrisan : k)), promijenjeno: true };
  }
  if (!razlog) throw greska(400, "Upišite razlog skidanja sati.");
  const prisutno = satiPrisutnosti(evidencija, zaposlenikId, datum);
  if (prisutno <= 0) throw greska(400, "Radnik taj dan nema evidentiranu prijavu i odjavu.");
  if (sati > prisutno + 0.01) throw greska(400, "Ne može se skinuti više sati nego što je radnik bio prijavljen.");

  if (aktivni) {
    if (Number(aktivni.sati) === sati && aktivni.razlog === razlog) return { popis: trenutno, promijenjeno: false };
    const izmijenjen = { ...aktivni, sati, razlog, promijenioId: korisnikId, promijenjeno: sada, povijest: [...(aktivni.povijest || []), { vrijeme: sada, korisnikId, radnja: "izmjena", sati, razlog }] };
    return { popis: trenutno.map((k) => (k === aktivni ? izmijenjen : k)), promijenjeno: true };
  }
  const novi = { id: noviId(), zaposlenikId, datum, sati, razlog, unioId: korisnikId, unioVrijeme: sada, povijest: [{ vrijeme: sada, korisnikId, radnja: "upis", sati, razlog }] };
  return { popis: [...trenutno, novi], promijenjeno: true };
}

// PUT /api/korekcijeSati/patch { upsert: [{ zaposlenikId, datum, sati, razlog }] } — isti oblik kao ostali ciljani popisi (spremiCiljano u App.jsx).
// Odgovor: { ok, korekcijeSati } (cijeli popis, uključujući obrisane zapise s poviješću).
function registrirajKorekcijeSati(app, { pool, autentikacija, ucitajPozicijuZaposlenika }) {
  app.put("/api/korekcijeSati/patch", autentikacija, async (req, res) => {
    const pozicija = await ucitajPozicijuZaposlenika(req.zaposlenikId);
    if (!smijeSkidatiSate(pozicija)) return res.status(403).json({ error: "Vaša pozicija nema dozvolu za skidanje sati (Zaposlenici → Pozicije → Evidencija sati)." });
    const upsert = Array.isArray(req.body?.upsert) ? req.body.upsert.slice(0, 20) : [];
    if (!upsert.length) return res.status(400).json({ error: "Nema ničega za spremiti." });
    const sada = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(`SELECT value FROM app_data WHERE key = '${KLJUC}' FOR UPDATE`);
      const zaposlenici = (await client.query("SELECT value FROM app_data WHERE key = 'zaposlenici'")).rows[0]?.value || [];
      const evidencija = (await client.query("SELECT value FROM app_data WHERE key = 'evidencijaRada'")).rows[0]?.value || [];
      let popis = r.rows[0]?.value || [];
      let promijenjeno = false;
      for (const z of upsert) {
        const ishod = primijeniKorekciju(popis, z, { korisnikId: req.zaposlenikId, sada, zaposlenici, evidencija });
        popis = ishod.popis;
        promijenjeno = promijenjeno || ishod.promijenjeno;
      }
      if (promijenjeno) {
        await client.query(
          `INSERT INTO app_data (key, value, updated_at) VALUES ('${KLJUC}', $1, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify(popis)]
        );
      }
      await client.query("COMMIT");
      res.json({ ok: true, [KLJUC]: popis });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      if (e?.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
      console.error("Greška kod skidanja sati:", e);
      res.status(500).json({ error: "Greška na poslužitelju — pokušajte ponovno." });
    } finally {
      client.release();
    }
  });
}

module.exports = { registrirajKorekcijeSati, primijeniKorekciju, smijeSkidatiSate, satiPrisutnosti, KLJUC };

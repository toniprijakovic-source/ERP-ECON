// Pravilo kumulativa (Zahlungsspezifikation): avans se odbija razmjerno napretku, najviše do punog avansa.
// Provjereno na računima 115/1/8, 126/1/8, 136/1/8 i 13/1/8 projekta RN 170-208 (vidi test/kumulativ.test.js).
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Provjera i normalizacija postavki kumulativa koje stižu iz ERP-ovog obrasca (brojevi mogu doći kao tekst sa zarezom).
// Vraća čisti objekt za kumulativ.json ili baca Error s porukom za korisnika.
export function provjeriKumulativ(ulaz) {
  if (!ulaz || typeof ulaz !== "object") throw new Error("Nema podataka o kumulativu.");
  // Prihvaća 176411.76, 176411,76 i 176.411,76 (točka kao oznaka tisućica samo uz zarez ili obrazac 176.411).
  const broj = (v, naziv) => {
    let s = typeof v === "number" ? String(v) : String(v ?? "").trim().replace(/[\s€]/g, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    const n = s === "" ? NaN : Number(s);
    if (!Number.isFinite(n)) throw new Error(`${naziv}: "${v}" nije broj.`);
    return r2(n);
  };
  const G = broj(ulaz.gesamtauftrag, "Ugovorena vrijednost");
  if (G <= 0) throw new Error("Ugovorena vrijednost mora biti veća od 0.");
  const V = broj(ulaz.vorauszahlung ?? 0, "Avans");
  if (V < 0 || V > G) throw new Error("Avans ne smije biti negativan niti veći od ugovorene vrijednosti.");
  const racuni = [];
  let prethodniKum = 0;
  for (const r of Array.isArray(ulaz.racuni) ? ulaz.racuni : []) {
    const vrsta = r.vrsta === "aconto" ? "aconto" : "racun";
    const brojRacuna = String(r.broj ?? "").trim().slice(0, 40);
    if (!brojRacuna) throw new Error("Prijašnji račun nema broj.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.datum ?? ""))) throw new Error(`Račun ${brojRacuna}: datum mora biti u obliku GGGG-MM-DD.`);
    const unos = { oznaka: `R${racuni.length + 1}`, vrsta, broj: brojRacuna, datum: r.datum, iznos: broj(r.iznos, `Račun ${brojRacuna}: iznos`) };
    if (vrsta === "racun") {
      const kum = broj(r.kumulativ, `Račun ${brojRacuna}: kumulativ (Summe Netto)`);
      if (kum < prethodniKum) throw new Error(`Račun ${brojRacuna}: kumulativ (${kum}) ne smije biti manji od kumulativa prethodnog računa (${prethodniKum}).`);
      unos.kumulativ = kum; prethodniKum = kum;
    }
    racuni.push(unos);
  }
  if (new Set(racuni.map((r) => r.broj)).size !== racuni.length) throw new Error("Isti broj računa je naveden više puta.");
  const cfg = { ...(ulaz._napomena ? { _napomena: String(ulaz._napomena).slice(0, 500) } : {}), ...(ulaz.projekt ? { projekt: String(ulaz.projekt).slice(0, 60) } : {}), ...(ulaz.pozicija ? { pozicija: String(ulaz.pozicija).trim().slice(0, 60) } : {}), gesamtauftrag: G, vorauszahlung: V, racuni };
  const isp = ulaz.isporuka || {};
  if (String(isp.grad ?? "").trim() && String(isp.posta ?? "").trim()) {
    cfg.isporuka = { ...(String(isp.ulica ?? "").trim() ? { ulica: String(isp.ulica).trim().slice(0, 100) } : {}), posta: String(isp.posta).trim().slice(0, 12), grad: String(isp.grad).trim().slice(0, 60), drzava: String(isp.drzava || "DE").trim().toUpperCase().slice(0, 2) };
  }
  return cfg;
}

// cfg.racuni: prijašnji računi, svaki s "vrsta" ("aconto" | "racun"), "iznos" (što je kupac platio) i, za "racun",
// "kumulativ" (Summe Netto tog računa). razdoblje = izvedba novog računa (zbroj njegovih stavki).
export function izracunaj(cfg, razdoblje) {
  const G = cfg.gesamtauftrag, V = cfg.vorauszahlung;
  const prijasnji = cfg.racuni.filter((r) => r.vrsta === "racun");
  const prethodniKum = prijasnji.length ? prijasnji.at(-1).kumulativ : 0;
  const kumulativ = r2(prethodniKum + razdoblje);
  const avansDo = (S) => r2(Math.min(V, (V * S) / G));
  const avansUkupno = avansDo(kumulativ);
  const avansOvajRacun = r2(avansUkupno - avansDo(prethodniKum));
  const zaPlatiti = r2(razdoblje - avansOvajRacun);
  const neto = r2(kumulativ - avansUkupno);                    // priznata izvedba umanjena za odbijeni avans
  const A = r2(neto + V);                                      // "A: Anerkannte Leistung"
  const B = r2(cfg.racuni.reduce((s, r) => s + r.iznos, 0));   // "B: Geleistete Zahlungen"
  const rest = r2(A - B);
  if (Math.abs(rest - zaPlatiti) > 0.005) throw new Error(`Nesklad u kumulativu: A-B=${rest}, a razdoblje-avans=${zaPlatiti}`);
  return { G, V, prethodniKum, kumulativ, avansUkupno, avansOvajRacun, zaPlatiti, neto, A, B, rest };
}

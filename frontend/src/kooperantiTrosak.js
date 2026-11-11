// Trošak kooperanata po projektima za mjesec (Obračun plaća → Kooperanti). Trošak = sati na projektu × satnica kooperanta; ostatak sati iz evidencije koji
// nije raspoređen na naloge prikazuje se zasebno, pa se ukupno uvijek slaže s isplatom (sati iz evidencije × satnica).
// Ulaz: redovi = [{ zaposlenikId, kljuc, sati }] s poslužitelja (kljuc: "p:<projektId>" | "s:<stalniPosao>" | "bez-projekta"), projekti = [{ id, sifra, naziv }],
// kooperanti = [{ id, ime, satnica, evSati }] (iz obračuna: evSati = obračunski sati iz evidencije), nazivStalnog(id) = naziv stalnog posla.
const zaokr = (n) => Math.round(n * 100) / 100;

export function trosakKooperanataPoProjektima({ redovi = [], projekti = [], kooperanti = [], nazivStalnog = (id) => id }) {
  const projektPoId = new Map(projekti.map((p) => [p.id, p]));
  const koop = new Map(kooperanti.map((k) => [k.id, { ...k, satnica: Number(k.satnica) || 0, rasporedeno: 0 }]));
  const stavkeMapa = new Map();
  let izvanObracuna = 0;
  redovi.forEach((r) => {
    const k = koop.get(r.zaposlenikId);
    const sati = Number(r.sati) || 0;
    if (!(sati > 0)) return;
    if (!k) { izvanObracuna += sati; return; } // kooperant koji nije u obračunu tog mjeseca (npr. neaktivan)
    const kljuc = r.kljuc;
    const s = stavkeMapa.get(kljuc) || { kljuc, vrsta: kljuc.startsWith("p:") ? "projekt" : kljuc === "bez-projekta" ? "bez-projekta" : "stalni", poOsobi: {}, sati: 0, trosak: 0 };
    if (!s.naziv) {
      const p = kljuc.startsWith("p:") ? projektPoId.get(kljuc.slice(2)) : null;
      s.naziv = kljuc.startsWith("p:") ? (p ? `${p.sifra} — ${p.naziv}` : "(obrisan projekt)") : kljuc === "bez-projekta" ? "Nalozi bez projekta" : `Stalni posao: ${nazivStalnog(kljuc.slice(2))}`;
    }
    s.poOsobi[k.id] = (s.poOsobi[k.id] || 0) + sati;
    s.sati += sati;
    s.trosak += sati * k.satnica;
    k.rasporedeno += sati;
    stavkeMapa.set(kljuc, s);
  });
  const redoslijedVrste = { projekt: 0, "bez-projekta": 1, stalni: 2 };
  const stavke = [...stavkeMapa.values()]
    .map((s) => ({ ...s, sati: zaokr(s.sati), trosak: zaokr(s.trosak), brojKooperanata: Object.keys(s.poOsobi).length, poOsobi: Object.fromEntries(Object.entries(s.poOsobi).map(([id, h]) => [id, zaokr(h)])) }))
    .sort((a, b) => redoslijedVrste[a.vrsta] - redoslijedVrste[b.vrsta] || b.trosak - a.trosak || a.naziv.localeCompare(b.naziv, "hr"));
  // sati iz evidencije koji nisu raspoređeni na naloge (po osobi); višak raspoređenih sati iznad evidencije (ako postoji) prijavljuje se zasebno
  const nerasporedeno = { sati: 0, trosak: 0, poOsobi: {} };
  let visak = 0;
  koop.forEach((k) => {
    const razlika = zaokr((Number(k.evSati) || 0) - k.rasporedeno);
    if (razlika > 0.005) { nerasporedeno.poOsobi[k.id] = razlika; nerasporedeno.sati += razlika; nerasporedeno.trosak += razlika * k.satnica; }
    else if (razlika < -0.005) visak += -razlika;
  });
  nerasporedeno.sati = zaokr(nerasporedeno.sati); nerasporedeno.trosak = zaokr(nerasporedeno.trosak);
  const ukupnoRasporedeno = zaokr(stavke.reduce((a, s) => a + s.sati, 0));
  const trosakRasporedeno = zaokr(stavke.reduce((a, s) => a + s.trosak, 0));
  const trosakProjekti = zaokr(stavke.filter((s) => s.vrsta === "projekt").reduce((a, s) => a + s.trosak, 0));
  return {
    stavke, nerasporedeno, ukupnoSati: zaokr(ukupnoRasporedeno + nerasporedeno.sati), ukupnoTrosak: zaokr(trosakRasporedeno + nerasporedeno.trosak),
    trosakProjekti, brojProjekata: stavke.filter((s) => s.vrsta === "projekt").length, izvanObracuna: zaokr(izvanObracuna), visakRasporedenih: zaokr(visak),
  };
}

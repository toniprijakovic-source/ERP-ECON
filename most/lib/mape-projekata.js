// Automatska "Mapa projekta": za projekte u ERP-u kojima mapa nije upisana most potraži mapu po šifri (isto pravilo kao za
// XRechnung: mapa u korijenu projekata čije ime počinje šifrom, npr. "RN 170-330_Kupac_Opis") i javi je ERP-u. ERP upisuje
// putanju SAMO ako je polje i dalje prazno — ručno upisana mapa se nikad ne mijenja (backend/most-veza.js).
// Most ovdje ništa ne stvara ni ne mijenja na Z: — samo čita popis mapa.
import fs from "node:fs";
import { Greska } from "./pretvori.js";
import { nadjiMapuProjekta } from "./mapa.js";

// projekti: [{ id, sifra }] iz ERP-a. Vraća { pronadjene: [{ projektId, sifra, mapa }], nepronadjene: [{ projektId, sifra, razlog }] }
// ili null kad nijedan korijen projekata nije dostupan (npr. Z: nije spojen) — tada se ERP-u ništa ne javlja.
export function pronadjiMape(projekti, korijen, { postoji = (p) => fs.existsSync(p) } = {}) {
  const korijeni = Array.isArray(korijen) ? korijen : [korijen];
  if (!korijeni.some((k) => postoji(k))) return null;
  const pronadjene = [], nepronadjene = [];
  for (const p of projekti) {
    if (!p || !p.id || !String(p.sifra || "").trim()) continue;
    try {
      pronadjene.push({ projektId: p.id, sifra: p.sifra, mapa: nadjiMapuProjekta(korijeni, String(p.sifra).trim(), "") });
    } catch (e) {
      const poruka = e instanceof Greska ? e.message : `Neočekivana greška: ${e.message}`;
      // "U Z:/ECON_2026/… ; Z:/ECON_2025/… nema mape …" je predugo za pregled — kraće, bez popisa korijena.
      nepronadjene.push({ projektId: p.id, sifra: p.sifra, razlog: /nema mape čije ime počinje/.test(poruka) ? `Nema mape čije ime počinje s "${String(p.sifra).trim()}" (traženo u projektima tekuće i dvije prethodne godine).` : poruka });
    }
  }
  return { pronadjene, nepronadjene };
}

// Jedan krug: pitaj ERP za projekte bez mape, potraži mape, javi rezultat. U probnom načinu ništa se ne javlja (samo zapisnik).
export async function uskladiMapeProjekata(api, okolina, log) {
  const { projekti } = await api("GET", "/api/most/projekti-bez-mape");
  if (!projekti?.length) return { upisano: [] };
  const r = pronadjiMape(projekti, okolina.korijen);
  if (!r) return { upisano: [], nedostupno: true };
  if (okolina.probno) {
    if (r.pronadjene.length) log(`[PROBNO] Mape projekata pronađene, ali se ne upisuju u ERP: ${r.pronadjene.map((x) => x.sifra).join(", ")}`);
    return { upisano: [] };
  }
  const { upisano } = await api("POST", "/api/most/projekti/mapa", {
    pronadjene: r.pronadjene.map(({ projektId, mapa }) => ({ projektId, mapa })),
    nepronadjene: r.nepronadjene,
  });
  for (const u of upisano || []) log(`Mapa projekta upisana u ERP: ${u.sifra} → ${u.mapa}`);
  return { upisano: upisano || [] };
}

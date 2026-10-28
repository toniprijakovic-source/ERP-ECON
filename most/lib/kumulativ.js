// Pravilo kumulativa (Zahlungsspezifikation): avans se odbija razmjerno napretku, najviše do punog avansa.
// Provjereno na računima 115/1/8, 126/1/8, 136/1/8 i 13/1/8 projekta RN 170-208 (vidi test/kumulativ.test.js).
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

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

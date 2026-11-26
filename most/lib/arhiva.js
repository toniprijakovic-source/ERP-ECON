// Arhiva mapa projekata na serveru. Projekt koji je u ERP-u Arhiviran ili Otkazan seli se u podmapu "Arhiva" korijena SVOJE godine
// (npr. Econ_2026_Projekti\Arhiva), a usluga radione RN 40-04-NN u "Arhiva" zbirne mape usluga. Projekt koji se u ERP-u vrati u
// aktivne (ili u Završen) vraća se iz arhive na staro mjesto. Mape bez projekta u ERP-u kojima naziv završava s "_ZAVRŠEN" /
// "_ZAVRŠENO" sele se u arhivu za godine odabrane u ERP-u (Direktorski pregled → Stanje servera).
//
// Sigurnost:
//   - samo preimenovanje unutar iste godišnje mape (isti disk: ništa se ne kopira, ne briše ni ne spaja; ime mape ostaje isto);
//   - seli se samo mapa izravno u korijenu godine ili u zbirnoj mapi usluga; ugniježđene mape (npr. RN 60 B&O\…) se ne diraju;
//   - ime mape projekta mora počinjati šifrom tog projekta (ručno upisana "Mapa projekta" s drugim imenom se ne seli);
//   - ako na odredištu postoji mapa istog imena, ili istu mapu koriste projekti različitog statusa, ništa se ne radi (javlja se);
//   - dok premještanje nije uključeno u ERP-u, most samo javlja popis onoga što bi premjestio (prvi popis za potvrdu).
// Otvorena datoteka u mapi (Windows tada ne da premjestiti) → most pokušava ponovno u sljedećem krugu (svakih 5 minuta).
import fs from "node:fs";
import path from "node:path";
import { Greska } from "./pretvori.js";
import { nadjiMapuProjekta, NAZIV_ARHIVE, SIFRA_USLUGE, ZBIRNA_USLUGE, brojUsluge } from "./mapa.js";

// "_ZAVRŠEN", "_ZAVRŠENO", "_ ZAVRŠEN", "-ZAVRŠEN" (i bez kvačice) na kraju naziva.
export const NASTAVAK_ZAVRSEN = /[_\s-]\s*zavr[sš]en[oa]?\s*$/i;
const nfc = (s) => String(s ?? "").normalize("NFC");
const kljuc = (p) => path.normalize(String(p)).replace(/[\\/]+$/, "").toLowerCase(); // Windows ne razlikuje velika i mala slova
const izbjegni = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const jeArhiva = (ime) => String(ime).toLowerCase() === NAZIV_ARHIVE.toLowerCase();
const podmape = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()) : []);
export const godinaKorijena = (k) => {
  const m = path.basename(String(k)).match(/(\d{4})/) || String(k).match(/(\d{4})(?!.*\d{4})/);
  return m ? Number(m[1]) : null;
};

// Gdje je mapa: u korijenu godine, u njegovoj Arhivi, u zbirnoj mapi usluga, u Arhivi zbirne mape — ili negdje drugdje (ne dira se).
export function polozaj(mapa, korijeni) {
  const roditelj = path.dirname(mapa), ime = path.basename(mapa), djed = path.dirname(roditelj);
  for (const k of korijeni) {
    const K = kljuc(k);
    if (kljuc(roditelj) === K) return { vrsta: "korijen", korijen: k, roditelj, ime };
    if (kljuc(djed) === K && jeArhiva(path.basename(roditelj))) return { vrsta: "arhiva", korijen: k, roditelj, ime };
    if (kljuc(djed) === K && ZBIRNA_USLUGE.test(path.basename(roditelj))) return { vrsta: "zbirna", korijen: k, roditelj, ime };
    if (jeArhiva(path.basename(roditelj)) && ZBIRNA_USLUGE.test(path.basename(djed)) && kljuc(path.dirname(djed)) === K) return { vrsta: "zbirna-arhiva", korijen: k, roditelj, ime };
  }
  return { vrsta: "drugdje", korijen: null, roditelj, ime };
}

const reSifre = (sifra) => new RegExp(`^${izbjegni(sifra)}(?:[_ ]|$)`, "i");
export const pripadaSifri = (ime, sifra) => {
  const s = String(sifra || "").trim();
  const u = s.match(SIFRA_USLUGE);
  return reSifre(s).test(nfc(ime)) || (!!u && brojUsluge(ime) === Number(u[1]));
};
const javno = (s) => ({ vrsta: s.vrsta, projektId: s.projektId || null, sifra: s.sifra || "", status: s.status || "", od: s.od, do: s.do, godina: s.godina ?? null });
const REDOSLIJED = { arhiva: 0, vrati: 1, "bez-erp": 2 };

// projekti = [{ id, sifra, mapa, status, arhiva }] iz ERP-a (arhiva = treba biti u arhivi). Vraća što treba premjestiti, što se
// preskače (s razlogom) i projekte kojima upisana "Mapa projekta" više ne postoji, a mapa je nađena drugdje (ispravak putanje u ERP-u).
export function planArhive(projekti, korijeni) {
  const popis = Array.isArray(korijeni) ? korijeni : [korijeni];
  const dostupni = popis.filter((k) => fs.existsSync(k));
  if (!dostupni.length) throw new Greska(`Korijenska mapa projekata nije dostupna: ${popis.join(" ; ")} (je li Z: spojen?)`);
  const premjesti = [], preskoceno = [], ispravljeneMape = [];
  const zauzete = new Map(); // mapa → projekti iz ERP-a kojima je to mapa
  const nadjene = [];        // { p, m }: svaki projekt iz ERP-a s pronađenom mapom
  const sifre = [];
  const svi = (Array.isArray(projekti) ? projekti : []).filter((p) => p?.id);
  for (const p of svi) {
    const sifra = String(p?.sifra || "").trim();
    if (!sifra) continue;
    sifre.push(sifra);
    let m;
    try { m = nadjiMapuProjekta(dostupni, sifra, p.mapa || ""); } catch (e) {
      if (p.arhiva && e?.kod !== "nema") preskoceno.push({ projektId: p.id, sifra, status: p.status || "", razlog: e.message });
      continue;
    }
    if (p.mapa && kljuc(p.mapa) !== kljuc(m) && !fs.existsSync(path.normalize(p.mapa))) ispravljeneMape.push({ projektId: p.id, stara: p.mapa, nova: m });
    nadjene.push({ p, m });
    const k = kljuc(m);
    if (!zauzete.has(k)) zauzete.set(k, { mapa: m, vlasnici: [] });
    zauzete.get(k).vlasnici.push(p);
  }
  // Mapa drugog, aktivnog projekta UNUTAR mape koja ide u arhivu (npr. ručno upisana podmapa) → ne premješta se.
  const unutra = (roditelj, dijete) => kljuc(dijete).startsWith(kljuc(roditelj) + path.sep);
  const aktivniUnutra = (od) => {
    const a = nadjene.filter((n) => !n.p.arhiva && unutra(od, n.m));
    return a.length ? `U mapi je mapa projekta koji nije arhiviran (${a.map((n) => `${String(n.p.sifra).trim()}: ${n.p.status || "aktivan"}`).join("; ")}) — ne premješta se.` : "";
  };
  // Projekti kojima je u ERP-u upisana baš ta mapa ili podmapa u njoj: nakon premještanja javlja se nova putanja.
  const ispravciZa = (od, cilj) => svi.filter((p) => p.mapa && (kljuc(p.mapa) === kljuc(od) || unutra(od, p.mapa)))
    .map((p) => ({ projektId: p.id, stara: p.mapa, nova: path.join(cilj, path.relative(od, path.normalize(p.mapa))) }));

  for (const { mapa, vlasnici } of zauzete.values()) {
    const p = vlasnici[0];
    const sifraV = vlasnici.map((v) => String(v.sifra).trim()).join(", ");
    const statusV = [...new Set(vlasnici.map((v) => v.status || ""))].join(", ");
    const osnova = { projektId: p.id, sifra: sifraV, status: statusV, mapa };
    const pol = polozaj(mapa, dostupni);
    const uArhivi = pol.vrsta === "arhiva" || pol.vrsta === "zbirna-arhiva";
    const zeliArhivu = !!p.arhiva;
    if (vlasnici.some((v) => !!v.arhiva !== zeliArhivu)) {
      preskoceno.push({ ...osnova, razlog: `Istu mapu koriste projekti različitog statusa (${vlasnici.map((v) => `${v.sifra}: ${v.status}`).join("; ")}) — ne premješta se. Ispravite "Mapa projekta" u ERP-u.` });
      continue;
    }
    if (zeliArhivu === uArhivi) {
      if (!zeliArhivu && NASTAVAK_ZAVRSEN.test(nfc(pol.ime))) preskoceno.push({ ...osnova, razlog: `U nazivu mape piše ZAVRŠEN, ali projekt u ERP-u nije arhiviran (${statusV}) — ostaje gdje je. U arhivu ide kad ga arhivirate u ERP-u.` });
      continue;
    }
    if (pol.vrsta === "drugdje") {
      if (zeliArhivu) preskoceno.push({ ...osnova, razlog: "Mapa nije izravno u mapi projekata godine (ni u zbirnoj mapi usluga), pa se ne premješta. Premjestite je ručno ako treba." });
      continue;
    }
    if (!vlasnici.every((v) => pripadaSifri(pol.ime, v.sifra))) {
      preskoceno.push({ ...osnova, razlog: "Ime mape ne počinje šifrom projekta (\"Mapa projekta\" je upisana ručno), pa se ne premješta." });
      continue;
    }
    const cilj = zeliArhivu ? path.join(pol.roditelj, NAZIV_ARHIVE, pol.ime) : path.join(path.dirname(pol.roditelj), pol.ime);
    if (fs.existsSync(cilj)) {
      preskoceno.push({ ...osnova, razlog: `Na odredištu već postoji mapa istog imena (${cilj}) — riješite ručno.` });
      continue;
    }
    const zauzeto = zeliArhivu ? aktivniUnutra(mapa) : "";
    if (zauzeto) { preskoceno.push({ ...osnova, razlog: zauzeto }); continue; }
    premjesti.push({ vrsta: zeliArhivu ? "arhiva" : "vrati", projektId: p.id, sifra: sifraV, status: statusV, od: mapa, do: cilj, godina: godinaKorijena(pol.korijen), erp: ispravciZa(mapa, cilj) });
  }

  // Mape bez projekta u ERP-u s nastavkom "_ZAVRŠEN" (u korijenu godine i u zbirnoj mapi usluga).
  const dodajBezErp = (od, cilj, godina) => {
    const zauzeto = aktivniUnutra(od);
    if (zauzeto) preskoceno.push({ mapa: od, razlog: zauzeto });
    else if (fs.existsSync(cilj)) preskoceno.push({ mapa: od, razlog: `Na odredištu već postoji mapa istog imena (${cilj}) — riješite ručno.` });
    else premjesti.push({ vrsta: "bez-erp", od, do: cilj, godina, erp: ispravciZa(od, cilj) });
  };
  const reSifri = sifre.map(reSifre);
  const brojeviUsluga = new Set(sifre.map((s) => s.match(SIFRA_USLUGE)).filter(Boolean).map((u) => Number(u[1])));
  for (const k of dostupni) {
    const godina = godinaKorijena(k);
    for (const d of podmape(k)) {
      if (jeArhiva(d.name)) continue;
      if (ZBIRNA_USLUGE.test(d.name)) {
        const zbirna = path.join(k, d.name);
        for (const u of podmape(zbirna)) {
          const od = path.join(zbirna, u.name);
          if (jeArhiva(u.name) || !NASTAVAK_ZAVRSEN.test(nfc(u.name)) || zauzete.has(kljuc(od)) || brojeviUsluga.has(brojUsluge(u.name))) continue;
          dodajBezErp(od, path.join(zbirna, NAZIV_ARHIVE, u.name), godina);
        }
        continue;
      }
      const od = path.join(k, d.name);
      if (!NASTAVAK_ZAVRSEN.test(nfc(d.name)) || zauzete.has(kljuc(od))) continue;
      if (reSifri.some((re) => re.test(nfc(d.name)))) {
        preskoceno.push({ mapa: od, razlog: "Ime počinje šifrom projekta iz ERP-a, ali to nije mapa koju ERP koristi za taj projekt — ne premješta se." });
        continue;
      }
      dodajBezErp(od, path.join(k, NAZIV_ARHIVE, d.name), godina);
    }
  }
  const naziv = (s) => s.sifra || path.basename(s.od);
  premjesti.sort((a, b) => REDOSLIJED[a.vrsta] - REDOSLIJED[b.vrsta] || (a.vrsta === "bez-erp" ? (b.godina || 0) - (a.godina || 0) : 0) || naziv(a).localeCompare(naziv(b), "hr", { numeric: true }));
  return { premjesti, preskoceno, ispravljeneMape };
}

// Premještanje po planu. Mape bez projekta u ERP-u samo za odabrane godine. Izvor i odredište provjeravaju se neposredno prije.
export function provediArhivu(plan, { bezErpGodine = [], rename = fs.renameSync, mkdir = fs.mkdirSync, sada = () => new Date().toISOString() } = {}) {
  const godine = new Set((bezErpGodine || []).map(Number));
  const premjesteno = [], ceka = [], ispravljeneMape = [];
  for (const s of plan) {
    if (s.vrsta === "bez-erp" && !godine.has(Number(s.godina))) continue;
    try {
      if (!fs.existsSync(s.od)) throw new Greska("Mapa više nije na starom mjestu (premještena ili preimenovana u međuvremenu).");
      if (fs.existsSync(s.do)) throw new Greska("Na odredištu već postoji mapa istog imena — riješite ručno.");
      const roditelj = path.dirname(s.do);
      if (!fs.existsSync(roditelj)) mkdir(roditelj);
      rename(s.od, s.do);
      premjesteno.push({ ...javno(s), vrijeme: sada() });
      for (const e of s.erp || []) ispravljeneMape.push({ projektId: e.projektId, stara: e.stara, nova: e.nova || s.do });
    } catch (e) {
      const kod = e?.code;
      const greska = e instanceof Greska ? e.message
        : ["EPERM", "EBUSY", "EACCES"].includes(kod) ? `Windows ne da premjestiti mapu (${kod}): neka datoteka u njoj je vjerojatno otvorena, ili most nema prava na tu mapu. Most pokušava ponovno svakih 5 minuta.`
        : `Neočekivana greška: ${e.message}`;
      ceka.push({ ...javno(s), greska });
    }
  }
  return { premjesteno, ceka, ispravljeneMape };
}

// Jedan krug (svakih 5 minuta, most.js): ERP daje projekte i postavke arhive, most napravi plan, premjesti ako je uključeno i javi stanje.
let zadnjaCekanja = "";
export async function uskladiArhivu(api, okolina, log) {
  const odg = await api("GET", "/api/most/projekti-za-arhivu");
  if (!Array.isArray(odg?.projekti)) return null;
  const ukljuceno = !!odg.ukljuceno;
  const bezErpGodine = Array.isArray(odg.bezErpGodine) ? odg.bezErpGodine : [];
  const plan = planArhive(odg.projekti, okolina.korijen);
  if (okolina.probno) {
    if (plan.premjesti.length) log(`[PROBNO] Arhiva: ${plan.premjesti.length} mapa bi se premjestilo (ništa se ne premješta, ERP-u se ne javlja).`);
    return { plan, premjesteno: [], ceka: [] };
  }
  const rez = ukljuceno ? provediArhivu(plan.premjesti, { bezErpGodine }) : { premjesteno: [], ceka: [], ispravljeneMape: [] };
  for (const s of rez.premjesteno) log(`Arhiva: ${s.sifra || "mapa bez projekta u ERP-u"} ${s.vrsta === "vrati" ? "vraćena iz arhive" : "premještena u arhivu"}: ${s.od} → ${s.do}`);
  const cekanja = rez.ceka.map((c) => `${c.od}|${c.greska}`).join("\n");
  if (cekanja !== zadnjaCekanja) {
    for (const c of rez.ceka) log(`Arhiva: nije premješteno ${c.od}: ${c.greska}`);
    zadnjaCekanja = cekanja;
  }
  const premjesteneMape = new Set(rez.premjesteno.map((s) => kljuc(s.od)));
  const isprPoProjektu = new Map([...plan.ispravljeneMape, ...rez.ispravljeneMape].map((x) => [x.projektId, x]));
  await api("POST", "/api/most/arhiva", {
    ukljuceno,
    plan: plan.premjesti.filter((s) => !premjesteneMape.has(kljuc(s.od))).map(javno),
    premjesteno: rez.premjesteno,
    ceka: rez.ceka,
    preskoceno: plan.preskoceno,
    ispravljeneMape: [...isprPoProjektu.values()],
  });
  return { plan, ...rez };
}

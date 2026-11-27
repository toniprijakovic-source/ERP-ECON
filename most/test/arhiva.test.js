// Arhiva mapa projekata (lib/arhiva.js): plan, premještanje u Arhivu i natrag, mape bez projekta u ERP-u s nastavkom _ZAVRŠEN,
// zatvorene godine (2024, 2025), zaštite (ugniježđene, krivo ime, dijeljena mapa, postoji na odredištu, otvorena datoteka) — na privremenoj mapi, bez ERP-a i bez Z:.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planArhive, provediArhivu, uskladiArhivu, NASTAVAK_ZAVRSEN, godinaKorijena, polozaj, pripadaSifri, PRVA_GODINA_ARHIVE } from "../lib/arhiva.js";
import { nadjiMapuProjekta } from "../lib/mapa.js";

let neuspjeh = 0;
const provjeri = (uvjet, opis, detalj) => { console.log(`${uvjet ? "OK " : "NE!"} ${opis}${!uvjet && detalj !== undefined ? `  → ${JSON.stringify(detalj)}` : ""}`); if (!uvjet) neuspjeh++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "econ-arhiva-"));
const k26 = path.join(dir, "Econ_2028_Projekti");
const k25 = path.join(dir, "Econ_2027_Projekti");
const korijeni = [k26, k25];
const mapa = (...dijelovi) => { const p = path.join(...dijelovi); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, "nacrt.pdf"), "x"); return p; };
const postoji = (p) => fs.existsSync(p);
const A26 = path.join(k26, "Arhiva"), A25 = path.join(k25, "Arhiva");
const Z26 = path.join(k26, "RN 40-04_Usluge radione");

try {
  // ---------------- nastavak ZAVRŠEN, godina, položaj ----------------
  for (const ime of ["RN 1_Ograda_ZAVRŠEN", "RN 1_Ograda_ZAVRŠENO", "RN 1_Ograda_ ZAVRŠEN", "RN 1_Ograda _ ZAVRŠEN", "RN 1_Ograda-ZAVRŠEN", "RN 1_Ograda_ZAVRSEN", "RN 1_Ograda_završen ", "RN 1_Ograda_ZAVRŠEN".normalize("NFD").normalize("NFC")]) provjeri(NASTAVAK_ZAVRSEN.test(ime), `nastavak prepoznat: "${ime}"`);
  for (const ime of ["RN 1_Završni radovi", "RN 1_Završena montaža hala", "RN 1_ZAVRŠEN dio 1", "RN 1_Nezavršeno"]) provjeri(!NASTAVAK_ZAVRSEN.test(ime), `nije nastavak: "${ime}"`);
  provjeri(godinaKorijena("Z:/ECON_2028/ECON_2028/Econ_2028_Projekti") === 2028 && godinaKorijena(k25) === 2027, "godina iz korijena");
  provjeri(pripadaSifri("RN 170-100_Ograda", "RN 170-100") && !pripadaSifri("RN 170-1000_X", "RN 170-100") && pripadaSifri("30-Inoxmont", "RN 40-04-30") && !pripadaSifri("31-Inoxmont", "RN 40-04-30"), "ime mape pripada šifri (i usluge po broju)");

  // ---------------- početno stanje ----------------
  const m100 = mapa(k26, "RN 170-100_Ograda_ZAVRŠEN");        // Arhiviran, mapa upisana (automatski) → u arhivu + nova putanja u ERP
  const m101 = mapa(k26, "RN 170-101_Stube");                 // Otkazan, mapa prazna → u arhivu
  const m102 = mapa(k26, "RN 170-102_Hala_ZAVRŠEN");          // U izradi s ZAVRŠEN u nazivu → ostaje (javlja se)
  const m103 = mapa(A26, "RN 170-103_Vraćen");                 // U izradi, a mapa je u Arhivi → vraća se
  const m30 = mapa(Z26, "30-Inoxmont_Usluga rezanja");         // usluga Arhivirana → Arhiva zbirne mape
  const m12 = mapa(Z26, "12-Stari posao_ZAVRŠEN");             // usluga bez projekta u ERP-u, ZAVRŠEN → Arhiva zbirne mape
  const m900 = mapa(k26, "RN 900-1_Stari_ZAVRŠEN");            // bez projekta u ERP-u, 2028 → arhiva (ako je 2028 odabrana)
  const m800 = mapa(k25, "RN 800-5_Jako stari_ZAVRŠENO");      // bez projekta u ERP-u, 2027 → arhiva samo ako je 2027 odabrana
  const m801 = mapa(k25, "RN 800-6_Bez nastavka");             // bez nastavka → ne dira se
  const m6012 = mapa(k26, "RN 60 B&O", "RN 60-12_Limovi");     // Arhiviran, ali ugniježđen → ne dira se
  const m104 = mapa(k26, "RN 170-104_Krivo");                 // RN 170-105 Arhiviran s ručno upisanom tuđom mapom → ne dira se
  const m106 = mapa(k26, "RN 170-106_Dijeljena");             // RN 170-106 Arhiviran + RN 170-107 U izradi s istom mapom → ne dira se
  const m108 = mapa(k26, "RN 170-108_Dupla");                  // Arhiviran, ali u Arhivi već postoji isto ime → ne dira se
  mapa(A26, "RN 170-108_Dupla");
  mapa(k26, "RN 170-109_Novo");                                // aktivan u 2028 ...
  const m109s = mapa(k25, "RN 170-109_Staro_ZAVRŠEN");         // ... a stara mapa iste šifre u 2027 → ne dira se (javlja se)
  const m110 = mapa(A26, "RN 170-110_Gotovo");                 // Arhiviran, već u Arhivi, a u ERP-u stara putanja → samo ispravak putanje
  const plan = mapa(k26, "Plan proizvodnje");
  fs.writeFileSync(path.join(k26, "Projekti-2028_ZAVRŠEN.one"), "x"); // datoteka, ne mapa

  const P = (id, sifra, status, mapaErp = "") => ({ id, sifra, status, mapa: mapaErp, arhiva: ["Arhiviran", "Otkazan"].includes(status) });
  const projekti = [
    P("p100", "RN 170-100", "Arhiviran", m100), P("p101", "RN 170-101", "Otkazan"), P("p102", "RN 170-102", "U izradi"), P("p103", "RN 170-103", "U izradi"),
    P("p30", "RN 40-04-30", "Arhiviran"), P("p6012", "RN 60-12", "Arhiviran", m6012), P("p105", "RN 170-105", "Arhiviran", m104),
    P("p106", "RN 170-106", "Arhiviran"), P("p107", "RN 170-107", "U izradi", m106), P("p108", "RN 170-108", "Arhiviran"), P("p109", "RN 170-109", "Završen"),
    P("p110", "RN 170-110", "Arhiviran", path.join(k26, "RN 170-110_Gotovo")), P("p111", "RN 170-111", "Arhiviran"), // 111 nema mape → ništa
    P("pbez", "", "Arhiviran"),
  ];

  provjeri(nadjiMapuProjekta(korijeni, "RN 170-103", "") === m103, "mapa projekta se nalazi i u Arhivi godine", nadjiMapuProjekta(korijeni, "RN 170-103", ""));
  provjeri(polozaj(m103, korijeni).vrsta === "arhiva" && polozaj(m30, korijeni).vrsta === "zbirna" && polozaj(m6012, korijeni).vrsta === "drugdje" && polozaj(m100, korijeni).vrsta === "korijen", "položaj mape");

  let pl = planArhive(projekti, korijeni);
  const od = (p) => pl.premjesti.find((s) => s.od === p);
  provjeri(od(m100)?.vrsta === "arhiva" && od(m100).do === path.join(A26, "RN 170-100_Ograda_ZAVRŠEN") && od(m100).erp.length === 1, "Arhiviran → Arhiva godine (ime ostaje), ERP putanja za ispravak", od(m100));
  provjeri(od(m101)?.vrsta === "arhiva" && od(m101).erp.length === 0, "Otkazan → Arhiva (mapa u ERP-u nije upisana)", od(m101));
  provjeri(od(m103)?.vrsta === "vrati" && od(m103).do === path.join(k26, "RN 170-103_Vraćen"), "aktivan projekt iz Arhive → natrag u korijen", od(m103));
  provjeri(od(m30)?.vrsta === "arhiva" && od(m30).do === path.join(Z26, "Arhiva", "30-Inoxmont_Usluga rezanja"), "usluga → Arhiva zbirne mape usluga", od(m30));
  provjeri(od(m12)?.vrsta === "bez-erp" && od(m12).do === path.join(Z26, "Arhiva", "12-Stari posao_ZAVRŠEN"), "usluga bez projekta u ERP-u s ZAVRŠEN → Arhiva zbirne mape", od(m12));
  provjeri(od(m900)?.vrsta === "bez-erp" && od(m900).godina === 2028 && od(m800)?.vrsta === "bez-erp" && od(m800).godina === 2027, "mape bez projekta u ERP-u s ZAVRŠEN (2028 i 2027) su u planu", pl.premjesti.map((s) => s.od));
  provjeri(!od(m102) && !od(m801) && !od(m6012) && !od(m104) && !od(m106) && !od(m108) && !od(m109s) && !od(m110) && !od(plan), "ne premješta: aktivan, bez nastavka, ugniježđen, krivo ime, dijeljena, dupla, stara iste šifre, već u arhivi, ostale mape", pl.premjesti.map((s) => path.basename(s.od)));
  provjeri(pl.premjesti.length === 7, "točno 7 stavki u planu", pl.premjesti.map((s) => path.basename(s.od)));
  provjeri(pl.premjesti.map((s) => s.vrsta).join(",") === "arhiva,arhiva,arhiva,vrati,bez-erp,bez-erp,bez-erp", "redoslijed: arhiva, vrati, bez ERP-a", pl.premjesti.map((s) => s.vrsta));
  const razlog = (dio) => pl.preskoceno.find((x) => x.mapa?.includes(dio))?.razlog || "";
  provjeri(/ZAVRŠEN.*nije arhiviran/.test(razlog("RN 170-102")), "javlja: ZAVRŠEN u nazivu, a projekt je aktivan", razlog("RN 170-102"));
  provjeri(/nije izravno/.test(razlog("RN 60-12")), "javlja: ugniježđena mapa se ne premješta", razlog("RN 60-12"));
  provjeri(/ne počinje šifrom/.test(razlog("RN 170-104")), "javlja: ručno upisana tuđa mapa", razlog("RN 170-104"));
  provjeri(/različitog statusa/.test(razlog("RN 170-106")), "javlja: istu mapu koriste projekti različitog statusa", razlog("RN 170-106"));
  provjeri(/već postoji/.test(razlog("RN 170-108")), "javlja: na odredištu već postoji isto ime", razlog("RN 170-108"));
  provjeri(/šifrom projekta iz ERP-a/.test(razlog("RN 170-109_Staro")), "javlja: stara mapa iste šifre u drugoj godini", razlog("RN 170-109_Staro"));
  provjeri(pl.ispravljeneMape.some((x) => x.projektId === "p110" && x.nova === m110), "upisana putanja ne postoji, mapa nađena u Arhivi → ispravak putanje", pl.ispravljeneMape);
  provjeri(!pl.preskoceno.some((x) => x.sifra === "RN 170-111"), "arhivirani projekt bez mape se ne javlja");
  provjeri(postoji(m100) && postoji(m900) && !postoji(path.join(Z26, "Arhiva")), "plan ništa ne premješta");

  // ---------------- premještanje (2028 odabrana za mape bez ERP-a, 2027 nije) ----------------
  const zakljucana = new Set([m101]);
  const rename = (a, b) => { if (zakljucana.has(a)) throw Object.assign(new Error("operation not permitted"), { code: "EPERM" }); fs.renameSync(a, b); };
  let rez = provediArhivu(pl.premjesti, { bezErpGodine: [2028], rename });
  provjeri(rez.premjesteno.length === 5, "premješteno 5 (bez zaključane i bez 2027)", rez.premjesteno.map((s) => path.basename(s.od)));
  provjeri(!postoji(m100) && postoji(path.join(A26, "RN 170-100_Ograda_ZAVRŠEN", "nacrt.pdf")), "mapa je u Arhivi sa sadržajem");
  provjeri(postoji(path.join(k26, "RN 170-103_Vraćen", "nacrt.pdf")) && !postoji(m103), "vraćena mapa je opet u korijenu");
  provjeri(postoji(path.join(Z26, "Arhiva", "30-Inoxmont_Usluga rezanja")) && postoji(path.join(Z26, "Arhiva", "12-Stari posao_ZAVRŠEN")), "Arhiva zbirne mape usluga stvorena i popunjena");
  provjeri(postoji(path.join(A26, "RN 900-1_Stari_ZAVRŠEN")) && postoji(m800) && !postoji(A25), "mapa bez ERP-a 2028 premještena, 2027 ostaje (godina nije odabrana)");
  provjeri(rez.ceka.length === 1 && rez.ceka[0].od === m101 && /EPERM/.test(rez.ceka[0].greska) && postoji(m101), "otvorena datoteka: mapa ostaje, javlja se i čeka", rez.ceka);
  provjeri(rez.ispravljeneMape.length === 1 && rez.ispravljeneMape[0].projektId === "p100" && rez.ispravljeneMape[0].stara === m100 && rez.ispravljeneMape[0].nova === path.join(A26, "RN 170-100_Ograda_ZAVRŠEN"), "nova putanja za projekt s upisanom mapom", rez.ispravljeneMape);
  provjeri(nadjiMapuProjekta(korijeni, "RN 40-04-30", "") === path.join(Z26, "Arhiva", "30-Inoxmont_Usluga rezanja"), "usluga se nalazi u Arhivi zbirne mape");
  provjeri(nadjiMapuProjekta(korijeni, "RN 170-100", m100) === path.join(A26, "RN 170-100_Ograda_ZAVRŠEN"), "stara upisana putanja → mapa se nalazi u Arhivi");

  // ---------------- drugi krug: ostaje samo zaključana i 2027 ----------------
  zakljucana.clear();
  pl = planArhive(projekti, korijeni);
  provjeri(pl.premjesti.map((s) => path.basename(s.od)).sort().join("|") === ["RN 170-101_Stube", "RN 800-5_Jako stari_ZAVRŠENO"].sort().join("|"), "drugi krug: ostaje zaključana i mapa 2027", pl.premjesti.map((s) => path.basename(s.od)));
  rez = provediArhivu(pl.premjesti, { bezErpGodine: [2028, 2027] });
  provjeri(rez.premjesteno.length === 2 && postoji(path.join(A26, "RN 170-101_Stube")) && postoji(path.join(A25, "RN 800-5_Jako stari_ZAVRŠENO")), "nakon otvaranja datoteke i odabira 2027: premješteno");
  pl = planArhive(projekti, korijeni);
  provjeri(pl.premjesti.length === 0, "treći krug: ništa za premjestiti", pl.premjesti);

  // ---------------- vraćanje u aktivne ----------------
  const ponovno = projekti.map((p) => (p.id === "p100" ? { ...p, status: "U izradi", arhiva: false, mapa: path.join(A26, "RN 170-100_Ograda_ZAVRŠEN") } : p));
  pl = planArhive(ponovno, korijeni);
  provjeri(pl.premjesti.length === 1 && pl.premjesti[0].vrsta === "vrati" && pl.premjesti[0].do === m100 && pl.premjesti[0].erp.length === 1, "projekt vraćen u aktivne → mapa natrag iz Arhive", pl.premjesti);
  rez = provediArhivu(pl.premjesti, {});
  provjeri(postoji(m100) && rez.ispravljeneMape[0]?.nova === m100, "vraćeno na staro mjesto, putanja u ERP-u ispravljena");

  // ---------------- uskladiArhivu: isključeno (samo plan), uključeno, probni način ----------------
  const m200 = mapa(k26, "RN 170-200_Novi arhivirani");
  const pozivi = [];
  const lazniApi = (ukljuceno, bezErpGodine = []) => async (metoda, ruta, tijelo) => {
    pozivi.push({ metoda, ruta, tijelo });
    if (ruta === "/api/most/projekti-za-arhivu") return { ukljuceno, bezErpGodine, projekti: [P("p200", "RN 170-200", "Arhiviran", m200), P("p100", "RN 170-100", "U izradi", m100)] };
    return { ok: true };
  };
  const zapisnik = [];
  const log = (...a) => zapisnik.push(a.join(" "));
  await uskladiArhivu(lazniApi(false), { korijen: korijeni, probno: false }, log);
  let post = pozivi.find((x) => x.metoda === "POST");
  provjeri(postoji(m200) && post?.ruta === "/api/most/arhiva" && post.tijelo.ukljuceno === false && post.tijelo.plan.some((s) => s.od === m200) && post.tijelo.premjesteno.length === 0, "isključeno: ništa se ne premješta, ERP dobiva plan", post?.tijelo);
  provjeri(post.tijelo.plan.every((s) => !("erp" in s)), "plan prema ERP-u bez unutarnjih polja");
  pozivi.length = 0;
  await uskladiArhivu(lazniApi(true), { korijen: korijeni, probno: true }, log);
  provjeri(postoji(m200) && !pozivi.some((x) => x.metoda === "POST"), "probni način: ništa se ne premješta i ništa se ne javlja ERP-u");
  pozivi.length = 0;
  await uskladiArhivu(lazniApi(true), { korijen: korijeni, probno: false }, log);
  post = pozivi.find((x) => x.metoda === "POST");
  provjeri(!postoji(m200) && postoji(path.join(A26, "RN 170-200_Novi arhivirani")) && post.tijelo.premjesteno.length === 1 && !post.tijelo.plan.some((s) => s.od === m200) && post.tijelo.plan.every((s) => s.vrsta === "bez-erp") && post.tijelo.ispravljeneMape.some((x) => x.projektId === "p200"), "uključeno: premješteno, u planu ostaju samo mape bez ERP-a neodabranih godina, nova putanja javljena", post?.tijelo);
  provjeri(zapisnik.some((z) => /RN 170-200 premještena u arhivu/.test(z)), "premještanje je u zapisniku mosta", zapisnik);

  // ---------------- podmape drugih projekata unutar mape ----------------
  const m300 = mapa(k26, "RN 170-300_Glavni_ZAVRŠEN"), m300d = mapa(m300, "Podprojekt");      // aktivni RN 170-301 ima mapu unutra → ne seli se
  const m310 = mapa(k26, "RN 170-310_Glavni"), m310d = mapa(m310, "Dio-2");                  // arhivirani RN 170-311 ima mapu unutra → seli se zajedno
  const m950 = mapa(k26, "RN 950-1_Kontejner_ZAVRŠEN"), m950d = mapa(m950, "Aktivni");      // bez ERP-a, ali unutra mapa aktivnog RN 170-312 → ne seli se
  const pod = [P("p300", "RN 170-300", "Arhiviran"), P("p301", "RN 170-301", "U izradi", m300d), P("p310", "RN 170-310", "Arhiviran"), P("p311", "RN 170-311", "Arhiviran", m310d), P("p312", "RN 170-312", "Odobren", m950d)];
  pl = planArhive(pod, korijeni);
  provjeri(!od(m300) && /RN 170-301: U izradi/.test(pl.preskoceno.find((x) => x.mapa === m300)?.razlog || ""), "mapa s podmapom aktivnog projekta se ne seli (javlja se)", pl.preskoceno.find((x) => x.mapa === m300));
  const s310 = od(m310);
  provjeri(s310?.vrsta === "arhiva" && s310.erp.length === 1 && s310.erp[0].projektId === "p311" && s310.erp[0].nova === path.join(A26, "RN 170-310_Glavni", "Dio-2"), "arhivirani projekt s podmapom drugog arhiviranog: seli se, putanja podmape se ispravlja", s310);
  provjeri(!od(m950) && /RN 170-312/.test(pl.preskoceno.find((x) => x.mapa === m950)?.razlog || ""), "mapa bez ERP-a s podmapom aktivnog projekta se ne seli", pl.preskoceno.find((x) => x.mapa === m950));
  rez = provediArhivu(pl.premjesti.filter((s) => s.od === m310), {});
  provjeri(postoji(path.join(A26, "RN 170-310_Glavni", "Dio-2", "nacrt.pdf")) && rez.ispravljeneMape.some((x) => x.projektId === "p311" && x.nova === path.join(A26, "RN 170-310_Glavni", "Dio-2")), "premješteno sa podmapom; nova putanja podmape javljena", rez.ispravljeneMape);
  // ---------------- zatvorene godine (prije PRVA_GODINA_ARHIVE = 2026): ništa se ne dira ----------------
  provjeri(PRVA_GODINA_ARHIVE === 2026, "zatvorene su godine prije 2026");
  const zd = path.join(dir, "zatvorene");
  const z26 = path.join(zd, "Econ_2026_Projekti"), z25 = path.join(zd, "Econ_2025_Projekti"), z24 = path.join(zd, "Econ_2024_Projekti");
  const zk = [z26, z25, z24];
  const n26 = mapa(z26, "RN 990-1_Otvorena godina_ZAVRŠEN");             // bez ERP-a, 2026 → u planu (kontrola)
  const a26 = mapa(z26, "RN 170-400_Arhiviran 2026");                    // Arhiviran, 2026 → u planu (kontrola)
  const a25 = mapa(z25, "RN 160-1_Arhiviran u 2025");                    // Arhiviran, 2025 → ne dira se (javlja se)
  const v25 = mapa(z25, "Arhiva", "RN 160-2_Vraćen u 2025");             // aktivan, a u Arhivi 2025 → ne vraća se (javlja se)
  const s25 = mapa(z25, "RN 160-3_Aktivan u 2025");                      // aktivan u 2025, nije u arhivi → ništa (ne javlja se)
  const b25 = mapa(z25, "RN 801-1_Stari_ZAVRŠEN");                       // bez ERP-a, 2025 → ne dira se, ne javlja se
  const b24 = mapa(z24, "RN 40-04_Usluge radione", "7-Stara usluga_ZAVRŠEN"); // usluga bez ERP-a, 2024 → ne dira se
  const b24k = mapa(z24, "RN 700-1_Stari_ZAVRŠENO");                     // bez ERP-a, 2024 → ne dira se
  const zp = [P("z400", "RN 170-400", "Arhiviran"), P("z1", "RN 160-1", "Arhiviran"), P("z2", "RN 160-2", "U izradi"), P("z3", "RN 160-3", "U izradi")];
  pl = planArhive(zp, zk);
  const imena = pl.premjesti.map((s) => path.basename(s.od)).sort();
  provjeri(imena.join("|") === ["RN 170-400_Arhiviran 2026", "RN 990-1_Otvorena godina_ZAVRŠEN"].sort().join("|"), "u planu je samo 2026 (Arhiviran i mapa bez ERP-a)", imena);
  provjeri(/zatvorenoj godini 2025/.test(pl.preskoceno.find((x) => x.mapa === a25)?.razlog || ""), "Arhiviran projekt u 2025: javlja se da je godina zatvorena", pl.preskoceno);
  provjeri(/zatvorenoj godini 2025/.test(pl.preskoceno.find((x) => x.mapa === v25)?.razlog || ""), "vraćeni projekt u Arhivi 2025: ne vraća se, javlja se", pl.preskoceno);
  provjeri(!pl.preskoceno.some((x) => [s25, b25, b24, b24k].includes(x.mapa)), "aktivni projekt i mape bez ERP-a u 2025/2024 se ni ne javljaju", pl.preskoceno);
  rez = provediArhivu([...pl.premjesti, { vrsta: "bez-erp", od: b25, do: path.join(z25, "Arhiva", path.basename(b25)), godina: 2025, erp: [] }, { vrsta: "arhiva", od: a25, do: path.join(z25, "Arhiva", path.basename(a25)), godina: 2025, erp: [] }], { bezErpGodine: [2026, 2025, 2024] });
  provjeri(rez.premjesteno.length === 2 && !postoji(n26) && !postoji(a26), "2026 premješteno", rez.premjesteno.map((s) => path.basename(s.od)));
  provjeri(postoji(a25) && postoji(v25) && postoji(s25) && postoji(b25) && postoji(b24) && postoji(b24k) && !postoji(path.join(z25, "Arhiva", path.basename(b25))) && !postoji(path.join(z24, "Arhiva")), "2025 i 2024 ostaju netaknute, i kad je godina odabrana i kad stavka zaobiđe plan");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(neuspjeh ? `\n${neuspjeh} provjera NIJE prošlo.` : "\nSve provjere arhive prošle.");
process.exit(neuspjeh ? 1 : 0);

// Spajanje pogona (npr. Z:) za most koji radi na serveru.
// Na računalu korisnika Z: je već spojen pri prijavi. Na serveru most radi pod servisnim računom bez spojenih pogona, a ERP i postavke
// čuvaju putanje oblika Z:\ECON_2026\... (polje "Mapa projekta", mapa nesukladnosti u postavke.json). Zato most sam spoji pogon za
// svoju sesiju i sve postojeće putanje rade bez izmjena.
//   MAPIRAJ_POGONE=Z:=//ECON-R550/econ   dijeljena mapa → net use Z: \\ECON-R550\econ /persistent:no
//   MAPIRAJ_POGONE=Z:=D:/econ            lokalna mapa na istom računalu → subst Z: D:\econ
// Više pogona odvojeno s ";". Kose crte (/) jer Node u .env datoteci briše obrnute. Spajanje vrijedi samo za sesiju mosta i ne
// mijenja ništa trajno na računalu; pogon koji već postoji ne dira se.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Greska } from "./pretvori.js";

const SLOVO = /^[A-Z]:$/;
const MREZA = /^\\\\[^\\/:*?"<>|]+\\[^\\/:*?"<>|]+(\\[^/:*?"<>|]+)*$/; // \\poslužitelj\mapa[\podmapa]
const LOKALNO = /^[A-Z]:\\[^/:*?"<>|]*$/i; // D:\mapa

export function procitajMapiranja(tekst) {
  const rezultat = [];
  for (const dio of String(tekst || "").split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = dio.indexOf("=");
    if (i < 0) throw new Greska(`MAPIRAJ_POGONE: očekuje se oblik Z:=//posluzitelj/mapa ili Z:=D:/mapa, a piše "${dio}".`);
    const slovo = dio.slice(0, i).trim().toUpperCase();
    const cilj = dio.slice(i + 1).trim().replace(/\//g, "\\").replace(/\\+$/, "");
    if (!SLOVO.test(slovo)) throw new Greska(`MAPIRAJ_POGONE: "${dio.slice(0, i)}" nije slovo pogona (npr. Z:).`);
    if (cilj.split("\\").includes("..")) throw new Greska(`MAPIRAJ_POGONE: putanja ne smije sadržavati "..": ${cilj}`);
    const vrsta = MREZA.test(cilj) ? "mreza" : LOKALNO.test(cilj) ? "lokalno" : null;
    if (!vrsta) throw new Greska(`MAPIRAJ_POGONE: "${cilj}" nije ni dijeljena mapa (//posluzitelj/mapa) ni lokalna mapa (D:/mapa).`);
    if (vrsta === "lokalno" && cilj.slice(0, 2).toUpperCase() === slovo) throw new Greska(`MAPIRAJ_POGONE: pogon ${slovo} ne može pokazivati sam na sebe.`);
    if (rezultat.some((m) => m.slovo === slovo)) throw new Greska(`MAPIRAJ_POGONE: pogon ${slovo} je naveden dvaput.`);
    rezultat.push({ slovo, cilj, vrsta });
  }
  return rezultat;
}

const sustav = (exe) => path.join(process.env.SystemRoot || "C:\\Windows", "System32", exe);
const pokreniZadano = (exe, argumenti) => execFileSync(sustav(exe), argumenti, { stdio: "pipe", windowsHide: true, timeout: 60_000 });
const porukaGreske = (e) => String(e?.stderr?.length ? e.stderr : e?.stdout?.length ? e.stdout : e?.message || e)
  .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 2).join(" ").slice(0, 300);

// Za svaki pogon koji ne postoji pokuša ga spojiti. Ne baca grešku (most mora nastaviti raditi i javljati greške ERP-u);
// vraća [{ slovo, cilj, vrsta, stanje: "vec" | "spojeno" | "greska", poruka? }].
export function osigurajPogone(mapiranja, { postoji = (p) => fs.existsSync(p), pokreni = pokreniZadano } = {}) {
  return mapiranja.map((m) => {
    if (postoji(`${m.slovo}\\`)) return { ...m, stanje: "vec" };
    try {
      if (m.vrsta === "mreza") pokreni("net.exe", ["use", m.slovo, m.cilj, "/persistent:no"]);
      else pokreni("subst.exe", [m.slovo, m.cilj]);
    } catch (e) {
      return { ...m, stanje: "greska", poruka: porukaGreske(e) };
    }
    return postoji(`${m.slovo}\\`) ? { ...m, stanje: "spojeno" } : { ...m, stanje: "greska", poruka: `naredba je prošla, ali ${m.slovo}\\ i dalje nije dostupan` };
  });
}

// Opis za zapisnik (samo promjene stanja, da se zapisnik ne puni svake minute istom porukom).
export function opisPogona(r) {
  if (r.stanje === "spojeno") return `Pogon ${r.slovo} spojen na ${r.cilj}.`;
  if (r.stanje === "greska") return `Pogon ${r.slovo} NIJE spojen na ${r.cilj}: ${r.poruka}`;
  return `Pogon ${r.slovo} je dostupan.`;
}

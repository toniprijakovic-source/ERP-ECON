// Spajanje pogona za most na serveru (MAPIRAJ_POGONE): čitanje postavke i poziv net use / subst samo kad pogon ne postoji.
import { procitajMapiranja, osigurajPogone, opisPogona } from "../lib/pogoni.js";

let neuspjeh = 0;
const provjeri = (uvjet, opis) => { console.log(`${uvjet ? "OK " : "NE!"} ${opis}`); if (!uvjet) neuspjeh++; };
const baca = (fn) => { try { fn(); return false; } catch { return true; } };

// Čitanje postavke
provjeri(procitajMapiranja("").length === 0 && procitajMapiranja(undefined).length === 0, "prazna postavka = bez spajanja");
let m = procitajMapiranja("z:=//ECON-R550/econ");
provjeri(m.length === 1 && m[0].slovo === "Z:" && m[0].cilj === "\\\\ECON-R550\\econ" && m[0].vrsta === "mreza", "Z:=//ECON-R550/econ → net use na \\\\ECON-R550\\econ");
m = procitajMapiranja(" Z: = D:/econ/ ; Y:=//192.168.100.250/cad");
provjeri(m.length === 2 && m[0].cilj === "D:\\econ" && m[0].vrsta === "lokalno" && m[1].slovo === "Y:" && m[1].vrsta === "mreza", "dva pogona, lokalni bez završne crte + mrežni");
provjeri(baca(() => procitajMapiranja("Z//ECON-R550/econ")), "bez = → greška");
provjeri(baca(() => procitajMapiranja("ZZ:=//a/b")), "neispravno slovo → greška");
provjeri(baca(() => procitajMapiranja("Z:=econ")), "relativna putanja → greška");
provjeri(baca(() => procitajMapiranja("Z:=//ECON-R550")), "UNC bez dijeljene mape → greška");
provjeri(baca(() => procitajMapiranja("Z:=//a/b/../c")), "\"..\" → greška");
provjeri(baca(() => procitajMapiranja("Z:=Z:/econ")), "pogon na samog sebe → greška");
provjeri(baca(() => procitajMapiranja("Z:=//a/b;Z:=//c/d")), "isti pogon dvaput → greška");
provjeri(baca(() => procitajMapiranja('Z:=//a/b" & del')), "navodnici u putanji → greška");

// Spajanje (lažni sustav)
const sustav = (postojeci) => {
  const pozivi = [];
  return { pozivi, postoji: (p) => postojeci.has(p.slice(0, 2)), pokreni: (exe, arg) => { pozivi.push([exe, ...arg]); if (exe === "net.exe" && arg[2] === "\\\\los\\put") { const e = new Error("x"); e.stderr = Buffer.from("System error 67 has occurred.\r\n\r\nThe network name cannot be found.\r\n"); throw e; } postojeci.add(arg[exe === "net.exe" ? 1 : 0]); } };
};
let s = sustav(new Set(["Z:"]));
let r = osigurajPogone(procitajMapiranja("Z:=//ECON-R550/econ"), s);
provjeri(r[0].stanje === "vec" && s.pozivi.length === 0, "pogon već postoji → ništa se ne pokreće");
s = sustav(new Set());
r = osigurajPogone(procitajMapiranja("Z:=//ECON-R550/econ"), s);
provjeri(r[0].stanje === "spojeno" && JSON.stringify(s.pozivi) === JSON.stringify([["net.exe", "use", "Z:", "\\\\ECON-R550\\econ", "/persistent:no"]]), "mrežni: net use Z: \\\\ECON-R550\\econ /persistent:no");
s = sustav(new Set());
r = osigurajPogone(procitajMapiranja("Z:=D:/econ"), s);
provjeri(r[0].stanje === "spojeno" && JSON.stringify(s.pozivi) === JSON.stringify([["subst.exe", "Z:", "D:\\econ"]]), "lokalni: subst Z: D:\\econ");
s = sustav(new Set());
r = osigurajPogone(procitajMapiranja("Z:=//los/put"), s);
provjeri(r[0].stanje === "greska" && /network name cannot be found/.test(r[0].poruka), "neuspjeh naredbe → stanje greska s porukom sustava");
provjeri(/NIJE spojen/.test(opisPogona(r[0])), "opis greške za zapisnik");
s = { postoji: () => false, pokreni: () => {} };
r = osigurajPogone(procitajMapiranja("Z:=//a/b"), s);
provjeri(r[0].stanje === "greska", "naredba prošla, ali pogon i dalje ne postoji → greska");

console.log(neuspjeh ? `\n${neuspjeh} provjera nije prošlo.` : "\nSve provjere prošle.");
process.exit(neuspjeh ? 1 : 0);

// Službena provjera XRechnunga: KoSIT validator + konfiguracija XRechnung (lokalna Java iz mape alati).
// Validator na izlazu piše izvještaj (XML i HTML) — ocjena se čita iz izvještaja, a ne iz izlaznog koda
// (u okruženju bez konzole Java prijavi "Incorrect function" za ulazni tok, ali izvještaj ipak napiše).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const razvij = (s) => String(s).replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export function citajIzvjestaj(izvjestajXml) {
  const prihvaceno = /<rep:accept[\s>/]/.test(izvjestajXml);
  const odbijeno = /<rep:reject[\s>/]/.test(izvjestajXml);
  const greske = [], upozorenja = [];
  // Schematron: neuspjela pravila (id, ozbiljnost, tekst)
  for (const m of izvjestajXml.matchAll(/<svrl:failed-assert\b([^>]*)>([\s\S]*?)<\/svrl:failed-assert>/g)) {
    const id = (m[1].match(/\bid="([^"]*)"/) || [])[1] || "";
    const flag = (m[1].match(/\bflag="([^"]*)"/) || [])[1] || "error";
    const unos = { id, tekst: razvij((m[2].match(/<svrl:text[^>]*>([\s\S]*?)<\/svrl:text>/) || [, m[2]])[1]).slice(0, 400) };
    (flag === "warning" || flag === "information" ? upozorenja : greske).push(unos);
  }
  // Strukturne (XSD) i ostale poruke validatora
  for (const m of izvjestajXml.matchAll(/<rep:message\b([^>]*)>([\s\S]*?)<\/rep:message>/g)) {
    const razina = (m[1].match(/\blevel="([^"]*)"/) || [])[1] || "error";
    const unos = { id: (m[1].match(/\bcode="([^"]*)"/) || [])[1] || "XSD", tekst: razvij(m[2]).slice(0, 400) };
    (razina === "warning" || razina === "information" ? upozorenja : greske).push(unos);
  }
  const ocjena = prihvaceno && !greske.length ? "Valjano" : odbijeno || greske.length ? "Nevaljano" : "Nije provjereno";
  return { ocjena, greske: greske.slice(0, 30), upozorenja: upozorenja.slice(0, 30) };
}

export function validirajXml({ java, jar, konfig, xmlPutanja, izlaz, rok = 120000 }) {
  return new Promise((resolve) => {
    fs.mkdirSync(izlaz, { recursive: true });
    const pocetak = Date.now() - 2000;
    const osnova = path.basename(xmlPutanja, path.extname(xmlPutanja));
    const args = ["-jar", jar, "-s", path.join(konfig, "scenarios.xml"), "-r", konfig, "-o", izlaz, "-h", xmlPutanja];
    let dijete;
    // Ulaz mora biti cijev (pipe) koju odmah zatvorimo: validator provjerava ima li podataka na ulazu (System.in.available()),
    // a to na Windowsima baca "Incorrect function" kad je ulaz NUL ili nasljeđeni ručnik bez konzole.
    try { dijete = spawn(java, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); dijete.stdin.end(); }
    catch (e) { return resolve({ ocjena: "Nije provjereno", greske: [], upozorenja: [], pogreska: `Java se ne može pokrenuti: ${e.message}` }); }
    const izlazTekst = [];
    dijete.stdout.on("data", (d) => izlazTekst.push(String(d)));
    dijete.stderr.on("data", (d) => izlazTekst.push(String(d)));
    const sat = setTimeout(() => dijete.kill(), rok);
    dijete.on("error", (e) => { clearTimeout(sat); resolve({ ocjena: "Nije provjereno", greske: [], upozorenja: [], pogreska: `Java se ne može pokrenuti: ${e.message}` }); });
    dijete.on("close", () => {
      clearTimeout(sat);
      const izvjestajXml = path.join(izlaz, `${osnova}-report.xml`);
      const izvjestajHtml = path.join(izlaz, `${osnova}-report.html`);
      if (!fs.existsSync(izvjestajXml) || fs.statSync(izvjestajXml).mtimeMs < pocetak) {
        return resolve({ ocjena: "Nije provjereno", greske: [], upozorenja: [], pogreska: `Validator nije napisao izvještaj. ${izlazTekst.join("").slice(0, 300)}` });
      }
      resolve({ ...citajIzvjestaj(fs.readFileSync(izvjestajXml, "utf8")), izvjestajXml, izvjestajHtml: fs.existsSync(izvjestajHtml) ? izvjestajHtml : null });
    });
  });
}

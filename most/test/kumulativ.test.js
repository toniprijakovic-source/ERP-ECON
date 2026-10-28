// Pravilo kumulativa provjereno na četiri stvarna računa projekta RN 170-208 (vrijednosti iz PDF-ova u mapi projekta).
import fs from "node:fs";
import { izracunaj } from "../lib/kumulativ.js";

const cfg = JSON.parse(fs.readFileSync(new URL("../primjeri/kumulativ-RN-170-208.json", import.meta.url), "utf8"));
// prije: koji su računi bili izdani prije; razdoblje = Endbetrag s 1. stranice; rest = "Rest zu Zahlen" s 2. stranice
const slucajevi = [
  { broj: "115/1/8", prije: ["29/1/3", "76/1/8"], razdoblje: 93865.72, rest: 55937.74 },
  { broj: "126/1/8", prije: ["29/1/3", "76/1/8", "115/1/8"], razdoblje: 105664.98, rest: 62969.31 },
  { broj: "136/1/8", prije: ["29/1/3", "76/1/8", "115/1/8", "126/1/8"], razdoblje: 75855.55, rest: 45204.86 },
  { broj: "13/1/8", prije: ["29/1/3", "76/1/8", "115/1/8", "126/1/8", "136/1/8"], razdoblje: 34204.05, rest: 24165.31 },
];
let svi = true;
for (const s of slucajevi) {
  const k = izracunaj({ ...cfg, racuni: cfg.racuni.filter((r) => s.prije.includes(r.broj)) }, s.razdoblje);
  const ok = Math.abs(k.zaPlatiti - s.rest) < 0.005;
  svi &&= ok;
  console.log(`${ok ? "OK " : "NE!"} ${s.broj}: kumulativ ${k.kumulativ.toFixed(2)} | avans ${k.avansOvajRacun.toFixed(2)} | za platiti ${k.zaPlatiti.toFixed(2)} (PDF ${s.rest.toFixed(2)})`);
}
if (!svi) { console.error("Kumulativ se ne poklapa s PDF-ovima!"); process.exit(1); }

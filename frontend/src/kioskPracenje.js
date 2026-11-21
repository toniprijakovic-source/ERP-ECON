// Praćenje kioska u kartici Evidencija rada: je li zaslon živ (zadnji signal), i treba li upozoriti. Čiste funkcije — testirano u kioskPracenje.test.js.
// Poslužitelj pamti zadnji "ping" svakog kioska (šalje ga svakih 5 min); upozorenje se daje samo RADNIM DANOM u radno vrijeme, da noćna i vikend tišina ne alarmiraju.

export const PRAGOVI_KIOSKA = {
  minutaDoUpozorenja: 15, // tri propuštena pinga
  radnoOd: 6 * 60, // 06:00
  radnoDo: 16 * 60 + 30, // 16:30
  odgodaMin: 30, // prvih pola sata radnog vremena ne upozorava (uređaj se tek pali)
};

// Datum, minuta u danu i dan u tjednu po zagrebačkom vremenu.
function zagreb(iso) {
  const dijelovi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t) => dijelovi.find((x) => x.type === t).value;
  return { datum: `${g("year")}-${g("month")}-${g("day")}`, minutaDana: Number(g("hour")) * 60 + Number(g("minute")), vikend: ["Sat", "Sun"].includes(g("weekday")) };
}

// praznik: (datumISO) => boolean
export function jeRadnoVrijeme(sadaISO, praznik = () => false, pragovi = PRAGOVI_KIOSKA) {
  const z = zagreb(sadaISO);
  const radniDan = !z.vikend && !praznik(z.datum);
  return { radno: radniDan && z.minutaDana >= pragovi.radnoOd && z.minutaDana < pragovi.radnoDo, minutaDana: z.minutaDana, radniDan };
}

export const minuteOd = (zadnjiISO, sadaISO) => Math.max(0, Math.floor((new Date(sadaISO) - new Date(zadnjiISO)) / 60000));

export function opisProteklog(min) {
  if (min < 1) return "upravo";
  if (min < 60) return `prije ${min} min`;
  if (min < 24 * 60) { const h = Math.floor(min / 60), m = min % 60; return m ? `prije ${h} h ${m} min` : `prije ${h} h`; }
  return `prije ${Math.floor(min / (24 * 60))} d`;
}

// Stanje jednog kioska: "radi" (signal u zadnjih 15 min), "nema" (šuti u radno vrijeme) ili "izvan" (šuti, ali nije radno vrijeme).
export function stanjeKioska(uredaj, sadaISO, praznik = () => false, pragovi = PRAGOVI_KIOSKA) {
  const minuta = minuteOd(uredaj.zadnji, sadaISO);
  const rv = jeRadnoVrijeme(sadaISO, praznik, pragovi);
  let status = "izvan";
  if (minuta <= pragovi.minutaDoUpozorenja) status = "radi";
  else if (rv.radno && rv.minutaDana >= pragovi.radnoOd + pragovi.odgodaMin) status = "nema";
  return { status, minuta, opis: opisProteklog(minuta) };
}

export const kioskoviBezSignala = (uredaji, sadaISO, praznik, pragovi) => (uredaji || []).filter((u) => stanjeKioska(u, sadaISO, praznik, pragovi).status === "nema");

export const NAZIV_VRSTE_KIOSKA = { evidencija: "Evidencija radnog vremena", potrosni: "Potrošni materijal" };

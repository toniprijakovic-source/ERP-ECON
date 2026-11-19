// Izdavanje materijala prema REZERVACIJAMA projekta (Skladište → Izdatnice → "Za izdavanje").
// Rezervacija je jedina stvarna veza zalihe ↔ projekt (nastaje sama pri zaprimanju narudžbenice s projektom ili ručno),
// pa skladištar iz nje jednim klikom dobije pripremljenu izdatnicu. Čiste funkcije, bez ovisnosti o App.jsx — testirano u
// izdavanjeRezervirano.test.js. Pomoćna funkcija redoviZa(materijal) dolazi iz aplikacije: vraća retke dužina ({duzinaMM,
// sirinaMM, komada}) kad materijal ima VIŠE dužina/formata (tad se izdaje po dužinama), inače null.

const zaokruzi = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const istaDuzina = (a, b) => Number(a.duzinaMM) === Number(b.duzinaMM) && (Number(a.sirinaMM) || 0) === (Number(b.sirinaMM) || 0);
const opisDuzine = (x) => `${x.sirinaMM ? `${x.duzinaMM}×${x.sirinaMM}` : x.duzinaMM} mm`;

// Statusi s kojima projekt smije dobiti materijal i kad za njega postoji rezervacija.
const STATUSI_ZA_IZDAVANJE = ["Odobren", "U izradi", "Montaža", "Završen"];
// Projekti za koje se pita "je li ikad izdan materijal?" — samo "U izradi": u Montaži je materijal odavno utrošen, pa bi popis bio buka.
const STATUSI_U_PROIZVODNJI = ["U izradi"];
// Rezervacija na ovakvom projektu je zaostala: materijal je ili utrošen bez izdatnice ili još leži na zalihi.
const STATUSI_ZATVORENI = ["Arhiviran", "Otkazan"];

// Što je rezervirano za projekt, zbrojeno po materijalu: [{ materijalId, kolicina, po: [{duzinaMM, sirinaMM, komada}], rezervacijaIds }]
export function rezerviranoPoProjektu(rezervacije, projektId) {
  const mapa = new Map();
  (rezervacije || []).filter((r) => r.projektId === projektId && Number(r.kolicina) > 0).forEach((r) => {
    const t = mapa.get(r.materijalId) || { materijalId: r.materijalId, kolicina: 0, po: [], rezervacijaIds: [] };
    t.kolicina = zaokruzi(t.kolicina + Number(r.kolicina));
    t.rezervacijaIds.push(r.id);
    (Array.isArray(r.po) ? r.po : []).forEach((x) => {
      const i = t.po.findIndex((y) => istaDuzina(y, x));
      if (i >= 0) t.po[i] = { ...t.po[i], komada: zaokruzi(t.po[i].komada + (Number(x.komada) || 0)) };
      else t.po.push({ duzinaMM: Number(x.duzinaMM), sirinaMM: x.sirinaMM ? Number(x.sirinaMM) : null, komada: zaokruzi(Number(x.komada) || 0) });
    });
    mapa.set(r.materijalId, t);
  });
  return [...mapa.values()];
}

// Stavke za modal izdatnice iz rezervacija jednog projekta. Količine se ograničavaju na stvarno stanje (ne može se izdati
// više nego ima), a sve što treba provjeriti ručno ide u napomene. Stavka: { materijalId, kolicina, po }:
// obični materijal → kolicina (tekst); materijal s više dužina → po[indeks retka dužine] (tekst), kao u modalu.
export function stavkeIzRezervacija({ projektId, rezervacije, materijali, redoviZa }) {
  const stavke = [];
  const napomene = [];
  for (const r of rezerviranoPoProjektu(rezervacije, projektId)) {
    const mat = (materijali || []).find((m) => m.id === r.materijalId);
    if (!mat) { napomene.push("Rezerviran je materijal koji više ne postoji na skladištu — preskočen."); continue; }
    const ime = `${mat.sifra ? `${mat.sifra} ` : ""}${mat.naziv}`.trim();
    if (!(Number(mat.kolicina) > 0)) { napomene.push(`${ime}: rezervirano ${r.kolicina} ${mat.jm || ""}, a na stanju nema ništa — preskočeno.`.replace(/\s+,/g, ",")); continue; }
    const redovi = redoviZa ? redoviZa(mat) : null;
    if (redovi) {
      const po = {};
      let uneseno = 0;
      for (const x of r.po) {
        const idx = redovi.findIndex((d) => istaDuzina(d, x));
        if (idx < 0) { napomene.push(`${ime}: dužina ${opisDuzine(x)} (rezervirano ${x.komada} kom) više nije na stanju.`); continue; }
        const dostupno = Number(redovi[idx].komada) || 0;
        const q = Math.min(Number(x.komada) || 0, dostupno);
        if (q < (Number(x.komada) || 0) - 1e-9) napomene.push(`${ime}: dužina ${opisDuzine(x)} — rezervirano ${x.komada} kom, na stanju samo ${dostupno}.`);
        if (q > 0) { po[idx] = String(zaokruzi((Number(po[idx]) || 0) + q)); uneseno += q; }
      }
      if (r.po.length === 0) napomene.push(`${ime}: rezervacija ne određuje dužine (rezervirano ${r.kolicina} kom) — upiši koje se dužine izdaju.`);
      else if (uneseno <= 0) continue;
      stavke.push({ materijalId: mat.id, kolicina: "", po });
    } else {
      const q = Math.min(r.kolicina, Number(mat.kolicina) || 0);
      if (q < r.kolicina - 1e-9) napomene.push(`${ime}: rezervirano ${r.kolicina} ${mat.jm || ""}, na stanju samo ${zaokruzi(mat.kolicina)}.`.replace(/\s+,/g, ","));
      stavke.push({ materijalId: mat.id, kolicina: String(zaokruzi(q)), po: {} });
    }
  }
  return { stavke, napomene };
}

// Pregled za odjeljak "Za izdavanje":
//  • zaIzdati — projekti koji primaju materijal i imaju otvorene rezervacije (što skladištar treba izdati)
//  • bezMaterijala — projekti u proizvodnji koji nikad nisu dobili izdatnicu i nemaju rezervaciju (tko još nije dobio ništa)
//  • zatvoreni — Arhiviran/Otkazan (i nepostojeći) projekti s rezervacijom koja je ostala "visjeti"
// Stavka: { materijalId, sifra, naziv, jm, kolicina, po, naStanju, manjak }.
export function pregledZaIzdavanje({ projekti, rezervacije, izdatnice, materijali }) {
  const poId = new Map((projekti || []).map((p) => [p.id, p]));
  const mat = new Map((materijali || []).map((m) => [m.id, m]));
  const opisi = (projektId) => rezerviranoPoProjektu(rezervacije, projektId).map((r) => {
    const m = mat.get(r.materijalId);
    const naStanju = zaokruzi(m?.kolicina);
    return { materijalId: r.materijalId, sifra: m?.sifra || "", naziv: m?.naziv || "(materijal više ne postoji)", jm: m?.jm || "", kolicina: r.kolicina, po: r.po, naStanju, manjak: !m || naStanju < r.kolicina - 1e-9, rezervacijaIds: r.rezervacijaIds };
  });
  const projektiSRez = [...new Set((rezervacije || []).filter((r) => Number(r.kolicina) > 0).map((r) => r.projektId))];
  const zaIzdati = [];
  const zatvoreni = [];
  const imaOtvorenu = new Set();
  for (const pid of projektiSRez) {
    const p = poId.get(pid);
    if (p && p.status === "Ponuda") continue; // rezervirano prije potvrde projekta — još se ne izdaje
    const stavke = opisi(pid);
    if (!p || STATUSI_ZATVORENI.includes(p.status)) zatvoreni.push({ projekt: p || { id: pid, sifra: "—", naziv: "projekt više ne postoji", status: "—" }, stavke });
    else if (STATUSI_ZA_IZDAVANJE.includes(p.status)) { zaIzdati.push({ projekt: p, stavke, manjak: stavke.some((s) => s.manjak) }); imaOtvorenu.add(pid); }
  }
  const imaIzdatnicu = new Set((izdatnice || []).map((i) => i.projektId));
  const bezMaterijala = (projekti || [])
    .filter((p) => STATUSI_U_PROIZVODNJI.includes(p.status) && !imaIzdatnicu.has(p.id) && !imaOtvorenu.has(p.id))
    .map((p) => ({ projekt: p }));
  const poSifri = (a, b) => String(a.projekt.sifra).localeCompare(String(b.projekt.sifra), "hr", { numeric: true });
  zaIzdati.sort((a, b) => b.stavke.length - a.stavke.length || poSifri(a, b));
  zatvoreni.sort(poSifri);
  bezMaterijala.sort(poSifri);
  return { zaIzdati, bezMaterijala, zatvoreni };
}

// Rezervacije bez zadanih ids (za "Oslobodi") — vraća novi popis rezervacija.
export const ukloniRezervacije = (rezervacije, ids) => (rezervacije || []).filter((r) => !ids.includes(r.id));

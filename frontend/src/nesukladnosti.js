// Nesukladnosti i popravne radnje (ISO 9001): čiste funkcije za karticu Kontrola kvalitete → Nesukladnosti i za prijavu s mobitela.
// Isti popisi kao backend/nesukladnosti.js (poslužitelj je mjerodavan za statuse i ovlasti).

export const STATUSI_NS = ["Otvorena", "Mjere u tijeku", "Čeka ocjenu", "Zatvorena", "Poništena"];
export const ZAVRSNI_NS = ["Zatvorena", "Poništena"];
export const IZVORI_NS = ["reklamacija kupca", "radni proces", "analiza poslovodstva", "ostalo", "interni audit", "inspekcijski nalaz", "reklamacija dobavljaču"];
export const MJERE_NS = ["ispravak", "popravna radnja", "preventivna radnja"];
export const BOJA_STATUSA_NS = { "Otvorena": "badge-danger", "Mjere u tijeku": "badge-warning", "Čeka ocjenu": "badge-info", "Zatvorena": "badge-success", "Poništena": "badge-muted" };

export const prazniPodaciNs = ({ mojId = "", projektId = "", nositeljId = "", danas = "" } = {}) => ({
  datum: danas, potencijalna: false, izvor: "radni proces", projektId, dobavljacId: "", opis: "", evidentiraoId: mojId, evidentirao: "",
  nositeljId, uzrok: "", mjere: [], aktivnosti: [], napomena: "",
});
export const novaAktivnost = () => ({ id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, opis: "", odgovoran: "", rok: "", provedeno: "" });

// Otvorene aktivnosti s prošlim rokom (bez stvarne provedbe) i najbliži otvoreni rok — za popis i podsjetnike.
export const kasneAktivnosti = (p, danas) => (p?.aktivnosti || []).filter((a) => a.rok && !a.provedeno && a.rok < danas);
export const sljedeciRok = (p) => (p?.aktivnosti || []).filter((a) => a.rok && !a.provedeno).map((a) => a.rok).sort()[0] || "";

// Što nedostaje za slanje na ocjenu (isto pravilo kao na poslužitelju).
export const nedostajeZaOcjenu = (p) => [!String(p?.uzrok || "").trim() && "uzrok", !(p?.mjere || []).length && "vrsta mjere", !(p?.aktivnosti || []).some((a) => String(a.opis || "").trim()) && "barem jedna aktivnost"].filter(Boolean);

// Filtar popisa: status ("otvorene" = sve osim završnih, "zatvorene", "sve" ili točan status) i tekst (broj, projekt, opis, uzrok, nositelj, evidentirao).
export function filtrirajNs(zapisi, { status = "sve", tekst = "" } = {}) {
  const t = String(tekst).trim().toLowerCase();
  return (zapisi || []).filter((z) => {
    if (status === "otvorene" && ZAVRSNI_NS.includes(z.status)) return false;
    if (status === "zatvorene" && z.status !== "Zatvorena") return false;
    if (!["sve", "otvorene", "zatvorene"].includes(status) && z.status !== status) return false;
    if (!t) return true;
    const p = z.podaci || {};
    return [z.oznaka, p.projektSifra, p.projektNaziv, p.opis, p.uzrok, p.nositelj, p.evidentirao, p.izvor].some((v) => String(v || "").toLowerCase().includes(t));
  });
}

// Zbrojevi za naslov kartice.
export function sazetakNs(zapisi, danas) {
  const z = zapisi || [];
  return {
    ukupno: z.length,
    otvorene: z.filter((x) => !ZAVRSNI_NS.includes(x.status)).length,
    cekaOcjenu: z.filter((x) => x.status === "Čeka ocjenu").length,
    kasne: z.filter((x) => !ZAVRSNI_NS.includes(x.status) && kasneAktivnosti(x.podaci, danas).length > 0).length,
    zatvorene: z.filter((x) => x.status === "Zatvorena").length,
  };
}

// Zadani nositelj kod prijave s mobitela: voditelj projekta, inače osoba koja prijavljuje.
export const zadaniNositelj = (projekt, mojId) => projekt?.voditeljId || mojId || "";

export const datumHr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join(".") + "." : "");
export const vrijemeHr = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${datumHr(d.toLocaleDateString("sv-SE", { timeZone: "Europe/Zagreb" }))} ${d.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zagreb" })}`; };

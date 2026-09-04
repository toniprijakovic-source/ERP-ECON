import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard, Package, Truck, Factory, Building2, Receipt, Users,
  Plus, Pencil, Trash2, X, Search, AlertTriangle, CheckCircle2, ArrowRight,
  Clock, ChevronRight, Save, PackageCheck, PackageMinus, Settings, Layers,
  ChevronDown, ChevronUp, FolderInput, Eye, UserCog, CalendarRange,
  Database, Download, Upload, AlertCircle
} from "lucide-react";
import logoEcon from "./assets/logo-econ.jpg";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Čita zaposlenikId iz JWT-a bez provjere potpisa (potpis provjerava backend na svakom pozivu) — koristi se samo da frontend zna tko je prijavljen.
function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64).split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ============================== PROIZVODNE OPERACIJE ============================== */
const OPERACIJE = [
  { key: "pila", label: "Pila" },
  { key: "laserProfili", label: "Laser za profile" },
  { key: "laserLimovi", label: "Laser za limove" },
  { key: "kutnoSavijanje", label: "Kutno savijanje" },
  { key: "strojnaObrada", label: "Strojna obrada" },
  { key: "pripremaPozicija", label: "Priprema pozicija za sklapanje" },
  { key: "sklapanjeKonstrukcije", label: "Sklapanje - konstrukcije" },
  { key: "sklapanjeKupaonice", label: "Sklapanje - kupaonice" },
  { key: "zavarivanje", label: "Zavarivanje" },
  { key: "brusenje", label: "Brušenje" },
  { key: "ravnanje", label: "Ravnanje" },
  { key: "akz", label: "Bojanje" },
];
const praznaOperacijaSati = () => Object.fromEntries(OPERACIJE.map((o) => [o.key, 0]));

// Stvarna količina (kg) stavke materijala: iz dužine×komada×kg/m ako je taj način unosa odabran, inače upisana količina izravno.
// Korišteno posvuda (kalkulacija ponude, iznos narudžbenice, primanje/izdavanje sa skladišta) da izračuni ostanu točni bez obzira kad/kako je stavka nastala.
// Izračun fakture: osnovica (bez PDV-a), iznos PDV-a i ukupno za platiti
const izracunFakture = (faktura, pdvStopa) => {
  const osnovica = (faktura.stavke || []).reduce((s, st) => s + (Number(st.kolicina) || 0) * (Number(st.cijenaJed) || 0), 0);
  const stopa = Number(pdvStopa ?? 25);
  const pdvIznos = osnovica * (stopa / 100);
  return { osnovica, pdvIznos, stopa, ukupno: osnovica + pdvIznos };
};

const efektivnaKolicinaMaterijala = (st, mat) => {
  if (st?.nacinUnosa === "duzina" && mat?.kgPoM > 0) return (Number(st.duzinaM) || 0) * (Number(st.komada) || 0) * Number(mat.kgPoM);
  return Number(st?.kolicina) || 0;
};

// Generator sljedećeg broja dokumenta (npr. "NAR-2026-101") koji gleda postojeće brojeve umjesto nasumičnog broja — sprječava duplikate
const sljedeciBroj = (lista, polje, prefiks, sirina = 3) => {
  const brojevi = (lista || []).map((x) => x?.[polje]).filter((b) => b && b.startsWith(prefiks)).map((b) => parseInt(b.slice(prefiks.length), 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 0) + 1;
  return `${prefiks}${String(sljedeci).padStart(sirina, "0")}`;
};

// Sljedeći broj otpremnice, format OTP-DD-MM-YY/N — N raste ako je isti dan već izdana otpremnica
const sljedeciBrojOtpremnice = (otpremnice, datumISO) => {
  const d = new Date(datumISO);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const prefiks = `OTP-${dd}-${mm}-${yy}/`;
  const brojevi = (otpremnice || []).map((o) => o?.broj).filter((b) => b && b.startsWith(prefiks)).map((b) => parseInt(b.slice(prefiks.length), 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 0) + 1;
  return `${prefiks}${sljedeci}`;
};

// Sljedeći broj podloge za fakturu, format PDR-<šifra projekta>/N (N = redni broj obračuna za taj projekt)
const sljedeciBrojPodloge = (podloge, projektSifra) => {
  const prefiks = `PDR-${projektSifra}/`;
  const brojevi = (podloge || []).map((p) => p?.broj).filter((b) => b && b.startsWith(prefiks)).map((b) => parseInt(b.slice(prefiks.length), 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 0) + 1;
  return `${prefiks}${sljedeci}`;
};

// Sljedeći broj radnog naloga, format <šifra projekta>/N (N = redni broj naloga unutar tog projekta)
const sljedeciBrojRadnogNaloga = (radniNalozi, projektSifra) => {
  const prefiks = `${projektSifra}/`;
  const brojevi = (radniNalozi || []).map((r) => r?.broj).filter((b) => b && b.startsWith(prefiks)).map((b) => parseInt(b.slice(prefiks.length), 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 0) + 1;
  return `${prefiks}${sljedeci}`;
};

// Izračun ponude: sati po operaciji (zbroj svih pozicija), trošak rada, materijala i ostalog
const izracunPonude = (ponuda, materijali, cjenikRada) => {
  const satiPoOperaciji = praznaOperacijaSati();
  (ponuda.pozicije || []).forEach((p) => {
    OPERACIJE.forEach((o) => { satiPoOperaciji[o.key] += Number(p.operacije?.[o.key] || 0); });
  });
  const trosakRada = OPERACIJE.reduce((s, o) => s + satiPoOperaciji[o.key] * (Number(cjenikRada?.[o.key]) || 0), 0);
  const trosakMaterijala = (ponuda.materijalStavke || []).reduce((s, st) => {
    const m = materijali.find((x) => x.id === st.materijalId);
    const cijena = st.cijenaPoJed != null ? Number(st.cijenaPoJed) : (m ? m.cijena : 0);
    return s + cijena * efektivnaKolicinaMaterijala(st, m);
  }, 0);
  const trosakOstalo = (ponuda.ostaleStavke || []).reduce((s, st) => s + (Number(st.kolicina) || 0) * (Number(st.cijenaJed) || 0), 0);
  const ukupnoSati = OPERACIJE.reduce((s, o) => s + satiPoOperaciji[o.key], 0);
  return { satiPoOperaciji, trosakRada, trosakMaterijala, trosakOstalo, ukupno: trosakRada + trosakMaterijala + trosakOstalo, ukupnoSati };
};

/* ============================== NORMATIV TIPSKIH PROJEKATA ==============================
   Za dugoročno ugovorene poslove (npr. kupaonice) cijena i vrijeme ne unose se ručno po poziciji,
   nego se izvode iz mase: cijena = masa × €/kg, sati = masa ÷ (kg/h), a ti sati se zatim
   raspoređuju po operacijama prema postotku. Dvije grupe jer postoje dvije ugovorene cijene:
   "pod" (podna konstrukcija) i "komplet" (stranice + krov + spojni profili). */
const zbrojRaspodjele = (raspodjela) => OPERACIJE.reduce((s, o) => s + (Number(raspodjela?.[o.key]) || 0), 0);

// Pod i komplet naručuju se kao potpuno nezavisne stavke (različite oznake tipova i
// različite količine u narudžbenici — npr. "Pod Typ A1 EG" nema par u stranicama jer
// dijeli isti dizajn stranica kao "Pod Typ A1"), zato se svaka grupa unosi zasebno.
const izracunStavke = (stavka, grupa) => {
  const kom = Number(stavka.komada) || 0;
  const masaUk = (Number(stavka.masaJed) || 0) * kom;
  const vrijednost = masaUk * (Number(grupa?.cijenaKg) || 0);
  const sati = Number(grupa?.ucinakKgH) > 0 ? masaUk / Number(grupa.ucinakKgH) : 0;
  const satiPoOperaciji = praznaOperacijaSati();
  OPERACIJE.forEach((o) => { satiPoOperaciji[o.key] = sati * ((Number(grupa?.raspodjela?.[o.key]) || 0) / 100); });
  return { masaUk, vrijednost, sati, satiPoOperaciji };
};

const izracunSkupine = (stavke, grupa) => {
  const poStavci = (stavke || []).map((s) => ({ stavka: s, ...izracunStavke(s, grupa) }));
  const ukupno = { komada: 0, masaUk: 0, vrijednost: 0, sati: 0, satiPoOperaciji: praznaOperacijaSati() };
  poStavci.forEach((r) => {
    ukupno.komada += Number(r.stavka.komada) || 0;
    ukupno.masaUk += r.masaUk;
    ukupno.vrijednost += r.vrijednost;
    ukupno.sati += r.sati;
    OPERACIJE.forEach((o) => { ukupno.satiPoOperaciji[o.key] += r.satiPoOperaciji[o.key]; });
  });
  return { poStavci, ukupno };
};

const izracunTipskogProjekta = (projekt, normativi) => {
  const grupa = (kljuc) => (normativi?.grupe || []).find((g) => g.kljuc === kljuc);
  const pod = izracunSkupine(projekt.stavkePod, grupa("pod"));
  const komplet = izracunSkupine(projekt.stavkeKomplet, grupa("komplet"));
  const ukupno = {
    masaUk: pod.ukupno.masaUk + komplet.ukupno.masaUk,
    vrijednost: pod.ukupno.vrijednost + komplet.ukupno.vrijednost,
    sati: pod.ukupno.sati + komplet.ukupno.sati,
    satiPoOperaciji: praznaOperacijaSati(),
  };
  OPERACIJE.forEach((o) => { ukupno.satiPoOperaciji[o.key] = pod.ukupno.satiPoOperaciji[o.key] + komplet.ukupno.satiPoOperaciji[o.key]; });
  return { pod, komplet, ukupno };
};

/* ============================== STYLE TOKENS ============================== */
const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    :root{
      --bg:#E9ECEE; --surface:#FFFFFF; --surface-alt:#F3F4F6;
      --ink:#1A1D21; --ink-soft:#5B6470; --ink-faint:#8A9198;
      --line:#D7DBDF; --line-strong:#B7BEC4;
      --accent:#F5B700; --accent-ink:#1A1D21;
      --steel:#2E5E7A; --rust:#B8442C; --green:#256B45;
      --sidebar:#14181C; --sidebar-ink:#AEB6BD; --sidebar-ink-active:#FFFFFF;
      --font-display:'Oswald',sans-serif; --font-body:'Inter',sans-serif; --font-mono:'IBM Plex Mono',monospace;
    }
    .erp-root *{ box-sizing:border-box; }
    .erp-root{ font-family:var(--font-body); color:var(--ink); background:var(--bg); }
    .f-display{ font-family:var(--font-display); letter-spacing:0.01em; }
    .f-mono{ font-family:var(--font-mono); }

    .beam-tick{ position:relative; }
    .beam-tick::before{ content:''; position:absolute; left:0; top:0; width:3px; height:100%; background:var(--accent); }

    .sidebar-item{ display:flex; align-items:center; gap:10px; padding:10px 14px; color:var(--sidebar-ink); font-size:13px; font-weight:500; border-left:3px solid transparent; cursor:pointer; transition:background .15s,color .15s; }
    .sidebar-item:hover{ background:rgba(255,255,255,0.05); color:var(--sidebar-ink-active); }
    .sidebar-item.active{ background:rgba(245,183,0,0.09); color:var(--sidebar-ink-active); border-left-color:var(--accent); }

    .btn{ display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; padding:8px 14px; border-radius:2px; cursor:pointer; border:1px solid transparent; transition:filter .15s,background .15s; white-space:nowrap; }
    .btn:active{ filter:brightness(0.95); }
    .btn-primary{ background:var(--accent); color:var(--accent-ink); }
    .btn-primary:hover{ filter:brightness(1.05); }
    .btn-ghost{ background:transparent; color:var(--ink-soft); border-color:var(--line); }
    .btn-ghost:hover{ background:var(--surface-alt); }
    .btn-danger{ background:transparent; color:var(--rust); border-color:#EAC3BA; }
    .btn-danger:hover{ background:#FBEAE6; }
    .btn-sm{ padding:5px 9px; font-size:12px; }
    .btn-icon{ padding:6px; }

    .card{ background:var(--surface); border:1px solid var(--line); border-radius:3px; }
    .input, .select, .textarea{ width:100%; font-size:13px; padding:8px 10px; border:1px solid var(--line-strong); border-radius:2px; background:var(--surface); color:var(--ink); font-family:var(--font-body); }
    .input:focus, .select:focus, .textarea:focus{ outline:2px solid var(--steel); outline-offset:0; border-color:var(--steel); }
    .label{ font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-soft); margin-bottom:5px; display:block; }

    table.erp-table{ width:100%; border-collapse:collapse; font-size:13px; }
    table.erp-table thead th{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-soft); font-weight:600; padding:9px 12px; border-bottom:2px solid var(--line-strong); background:var(--surface-alt); white-space:nowrap; }
    table.erp-table tbody td{ padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:middle; }
    table.erp-table tbody tr:hover{ background:var(--surface-alt); }
    table.erp-table tbody tr.row-warn{ background:#FDF6E9; }
    table.erp-table tbody tr.row-warn:hover{ background:#FBEFD4; }

    .badge{ display:inline-flex; align-items:center; gap:4px; padding:3px 8px; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.045em; border:1px solid; border-radius:2px; font-family:var(--font-mono); white-space:nowrap; }
    .badge-muted{ background:#F0F1F2; color:#5B6470; border-color:#D7DBDF; }
    .badge-info{ background:#EAF3F7; color:#215C77; border-color:#BFE0EC; }
    .badge-warning{ background:#FFF6DE; color:#8A6100; border-color:#F5D98A; }
    .badge-success{ background:#EAF6EF; color:#1F6B41; border-color:#B9E3C9; }
    .badge-danger{ background:#FBEAE6; color:#9A2E1B; border-color:#F0C2B5; }

    .kpi-card{ background:var(--surface); border:1px solid var(--line); border-radius:3px; padding:16px 18px; position:relative; overflow:hidden; }
    .kpi-num{ font-family:var(--font-display); font-size:28px; font-weight:600; line-height:1; }
    .kpi-label{ font-size:11.5px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:0.04em; margin-top:6px; font-weight:600; }

    .modal-overlay{ position:fixed; inset:0; background:rgba(20,24,28,0.55); display:flex; align-items:flex-start; justify-content:center; padding:40px 16px; z-index:50; overflow-y:auto; }
    .modal-panel{ background:var(--surface); width:100%; max-width:640px; border-radius:3px; box-shadow:0 20px 50px rgba(0,0,0,0.25); margin-bottom:40px; }
    .modal-header{ display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--line); }
    .modal-body{ padding:20px; }
    .modal-footer{ padding:14px 20px; border-top:1px solid var(--line); display:flex; justify-content:flex-end; gap:8px; }

    .nav-tab{ padding:9px 4px; font-size:13px; font-weight:600; color:var(--ink-soft); border-bottom:2px solid transparent; cursor:pointer; }
    .nav-tab.active{ color:var(--ink); border-bottom-color:var(--accent); }

    ::-webkit-scrollbar{ width:9px; height:9px; }
    ::-webkit-scrollbar-thumb{ background:#C6CBCF; border-radius:5px; }
    ::-webkit-scrollbar-track{ background:transparent; }

    @media print{
      body *{ visibility:hidden; }
      .print-doc, .print-doc *{ visibility:visible; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .print-doc{ position:fixed; inset:0; background:#fff; padding:28px 34px; z-index:99999; overflow:visible; }
      .no-print{ display:none !important; }
    }
    .doc-table{ width:100%; border-collapse:collapse; font-size:11.5px; }
    .doc-table th, .doc-table td{ border:1px solid #333; padding:5px 7px; text-align:left; vertical-align:top; }
    .doc-table th{ background:#f0f0f0; font-weight:700; }
  `}</style>
);

/* ============================== HELPERS ============================== */
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const fmtCur = (n) => new Intl.NumberFormat("hr-HR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n) || 0);
const fmtCurDec = (n) => new Intl.NumberFormat("hr-HR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(Number(n) || 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("hr-HR") : "—");
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysUntil = (d) => Math.ceil((new Date(d) - new Date(todayISO())) / 86400000);
const addDays = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };

const STATUS_TONE = {
  "Nacrt": "muted", "Ponuda": "muted", "Planiran": "muted",
  "Poslano": "info", "Poslana": "info", "Odobren": "info",
  "Djelomično primljeno": "warning", "U izradi": "warning", "Montaža": "warning",
  "U tijeku": "warning", "Pauziran": "warning", "Djelomično plaćeno": "warning",
  "Primljeno": "success", "Završen": "success", "Prihvaćena": "success", "Plaćeno": "success",
  "Otkazan": "danger", "Odbijena": "danger", "Kasni": "danger",
  "Aktivan": "success", "Neaktivan": "muted",
};
const Badge = ({ status }) => <span className={`badge badge-${STATUS_TONE[status] || "muted"}`}>{status}</span>;

/* ============================== SEED DATA ============================== */

// Kvaliteta materijala — faktor gustoće u odnosu na konstrukcijski čelik (7.85 kg/dm3)
const KVALITETE_MATERIJALA = [
  { key: "celik", label: "Konstrukcijski čelik (S235 / S275 / S355)", faktor: 1 },
  { key: "inox304", label: "Nehrđajući čelik – Inox 304", faktor: 7.9 / 7.85 },
  { key: "inox316", label: "Nehrđajući čelik – Inox 316", faktor: 8.0 / 7.85 },
  { key: "alu", label: "Aluminij (EN AW-6082)", faktor: 2.7 / 7.85 },
];

const skiniDijakritiku = (s) => (s || "")
  .replace(/[čć]/gi, (m) => (m === m.toUpperCase() ? "C" : "c"))
  .replace(/š/gi, (m) => (m === m.toUpperCase() ? "S" : "s"))
  .replace(/ž/gi, (m) => (m === m.toUpperCase() ? "Z" : "z"))
  .replace(/đ/gi, (m) => (m === m.toUpperCase() ? "D" : "d"));

// Generira kratki jedinstveni kod za NFC/kiosk prijavu (npr. "MKOV03")
const generirajRfidKod = (ime, prezime, postojeciKodovi) => {
  const baza = skiniDijakritiku(`${ime[0] || "X"}${(prezime || "XXX").slice(0, 3)}`).toUpperCase().replace(/[^A-Z]/g, "") || "ZAP";
  let broj = 1;
  let kod = `${baza}${String(broj).padStart(2, "0")}`;
  while (postojeciKodovi.includes(kod)) { broj++; kod = `${baza}${String(broj).padStart(2, "0")}`; }
  return kod;
};

const STORAGE_KEYS = ["kupci", "dobavljaci", "materijali", "projekti", "narudzbenice", "ponude", "radniNalozi", "fakture", "cjenikRada", "katalogProfila", "pozicijeZaposlenika", "zaposlenici", "standardniZadaci", "programiRezanja", "kapacitetiDana", "postavkeTvrtke", "upitiNabave", "radniCentri", "evidencijaRada", "narudzbe", "otpremnice", "podlogeZaFakturu", "normativi"];

/* ============================== SMALL UI PRIMITIVES ============================== */
const Btn = ({ variant = "ghost", size, icon: Icon, children, className = "", ...rest }) => (
  <button className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""} ${className}`} {...rest}>
    {Icon && <Icon size={14} />}
    {children}
  </button>
);

const Modal = ({ title, onClose, children, footer, wide }) => (
  <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-panel" style={wide ? { maxWidth: 820 } : undefined}>
      <div className="modal-header">
        <h3 className="f-display" style={{ fontSize: 17, fontWeight: 600 }}>{title}</h3>
        <button className="btn btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>
);

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label className="label">{label}</label>
    {children}
  </div>
);

const ConfirmDelete = ({ label, onConfirm, onCancel }) => (
  <Modal title="Potvrda brisanja" onClose={onCancel} footer={
    <>
      <Btn variant="ghost" onClick={onCancel}>Odustani</Btn>
      <Btn variant="danger" icon={Trash2} onClick={onConfirm}>Obriši</Btn>
    </>
  }>
    <p style={{ fontSize: 14, color: "var(--ink-soft)" }}>Jeste li sigurni da želite obrisati <strong style={{ color: "var(--ink)" }}>{label}</strong>? Ova radnja se ne može poništiti.</p>
  </Modal>
);

const EmptyState = ({ text }) => (
  <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>{text}</div>
);

/* ============================== LINE ITEMS EDITOR ============================== */
// Kreira novi skladišni artikl na temelju odabranog profila iz kataloga (tako da postane dostupan za odabir kao materijal)
const kreirajMaterijalIzKataloga = (entry, db, update) => {
  const noviId = uid("mat");
  const cijenaDefault = entry.jedinica === "kg/m2" ? 1.25 : 1.15;
  const noviMaterijal = {
    id: noviId, sifra: entry.oznaka.replace(/[^A-Za-z0-9]+/g, "-"), naziv: `${entry.tip} ${entry.oznaka}`, tip: entry.tip,
    dimenzije: `${entry.vrijednost} ${entry.jedinica}`, jm: "kg", cijena: cijenaDefault, kolicina: 0, minZaliha: 0, lokacija: "",
    kgPoM: entry.jedinica === "kg/m" ? Number(entry.vrijednost) : 0,
  };
  update("materijali", [...db.materijali, noviMaterijal]);
  return noviId;
};

function LineItemsEditor({ mode, rows = [], setRows, materijali = [], katalog = [], onCreateMaterijal }) {
  const addRow = () => setRows([...rows, mode === "materijal" ? { materijalId: "", nacinUnosa: "kolicina", kolicina: 1, duzinaM: 6, komada: 1, cijenaPoJed: 0 } : { opis: "", kolicina: 1, jm: "kom", cijenaJed: 0 }]);
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i));
  const update = (i, patch) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const efektivnaKolicina = (r, mat) => efektivnaKolicinaMaterijala(r, mat);
  const efektivnaCijena = (r, mat) => (r.cijenaPoJed != null ? Number(r.cijenaPoJed) : (mat ? mat.cijena : 0));

  const lineTotal = (r) => {
    if (mode === "materijal") {
      const m = materijali.find((x) => x.id === r.materijalId);
      return efektivnaCijena(r, m) * efektivnaKolicina(r, m);
    }
    return (Number(r.cijenaJed) || 0) * (Number(r.kolicina) || 0);
  };
  const total = rows.reduce((s, r) => s + lineTotal(r), 0);

  // Sprema patch na redak i, ako je način unosa "duzina × komada", odmah preračuna i zapiše stvarnu kolicina (kg) — 
  // tako svi izračuni (ukupno, trošak ponude, iznos narudžbenice, zaprimanje/izdavanje sa skladišta) rade s točnom vrijednošću.
  const azurirajRedak = (i, patch) => {
    setRows(rows.map((r, idx) => {
      if (idx !== i) return r;
      const merged = { ...r, ...patch };
      if (merged.nacinUnosa === "duzina") {
        const mat = materijali.find((m) => m.id === merged.materijalId);
        const kgPoM = mat?.kgPoM > 0 ? Number(mat.kgPoM) : (patch._kgPoM || 0);
        if (kgPoM > 0) merged.kolicina = (Number(merged.duzinaM) || 0) * (Number(merged.komada) || 0) * kgPoM;
      }
      return merged;
    }));
  };

  const odaberiMaterijal = (i, val) => {
    const r = rows[i] || {};
    const duzinaDef = r.duzinaM ?? 6;
    const komadaDef = r.komada ?? 1;
    if (val.startsWith("kat::")) {
      const katId = val.slice(5);
      const entry = (katalog || []).find((k) => k.id === katId);
      if (entry && onCreateMaterijal) {
        const noviId = onCreateMaterijal(entry);
        const jeDuzina = entry.jedinica === "kg/m";
        azurirajRedak(i, { materijalId: noviId, nacinUnosa: jeDuzina ? "duzina" : "kolicina", duzinaM: duzinaDef, komada: komadaDef, cijenaPoJed: entry.jedinica === "kg/m2" ? 1.25 : 1.15, _kgPoM: jeDuzina ? Number(entry.vrijednost) : 0 });
      }
    } else {
      const mat = materijali.find((m) => m.id === val);
      const jeDuzina = mat?.kgPoM > 0;
      azurirajRedak(i, { materijalId: val, nacinUnosa: jeDuzina ? "duzina" : "kolicina", duzinaM: duzinaDef, komada: komadaDef, cijenaPoJed: mat ? mat.cijena : 0 });
    }
  };

  if (mode === "materijal") {
    return (
      <div>
        {rows.length === 0 && <div style={{ textAlign: "center", color: "var(--ink-faint)", padding: "14px 0", fontSize: 13 }}>Nema stavki. Dodaj materijal.</div>}
        {rows.map((r, i) => {
          const mat = materijali.find((x) => x.id === r.materijalId);
          const nacin = r.nacinUnosa || "kolicina";
          const kol = efektivnaKolicina(r, mat);
          return (
            <div key={i} className="card" style={{ padding: 10, marginBottom: 8, background: "var(--surface-alt)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label className="label">Materijal</label>
                  <select className="select" value={r.materijalId} onChange={(e) => odaberiMaterijal(i, e.target.value)}>
                    <option value="">Odaberi materijal…</option>
                    <optgroup label="Zalihe (skladište)">
                      {materijali.map((m) => <option key={m.id} value={m.id}>{m.sifra} — {m.naziv}</option>)}
                    </optgroup>
                    {katalog && katalog.length > 0 && (
                      <optgroup label="Dodaj iz kataloga profila (svi standardni profili)">
                        {katalog.map((k) => <option key={k.id} value={`kat::${k.id}`}>{k.tip} {k.oznaka} ({k.vrijednost} {k.jedinica})</option>)}
                      </optgroup>
                    )}
                  </select>
                </div>
                <button className="btn btn-icon btn-ghost" onClick={() => removeRow(i)}><X size={14} /></button>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
                <div style={{ width: 165 }}>
                  <label className="label">Način unosa</label>
                  <select className="select" value={nacin} onChange={(e) => azurirajRedak(i, { nacinUnosa: e.target.value })}>
                    <option value="duzina">Dužina profila × komada</option>
                    <option value="kolicina">Ručni unos količine</option>
                  </select>
                </div>
                {nacin === "duzina" ? (
                  <>
                    <div style={{ width: 110 }}><label className="label">Dužina (m)</label><input className="input f-mono" type="number" min="0" step="0.1" value={r.duzinaM ?? 6} onChange={(e) => azurirajRedak(i, { duzinaM: e.target.value })} /></div>
                    <div style={{ width: 90 }}><label className="label">Komada</label><input className="input f-mono" type="number" min="0" value={r.komada ?? 1} onChange={(e) => azurirajRedak(i, { komada: e.target.value })} /></div>
                    <div style={{ width: 120 }}>
                      <label className="label">Masa (izračunato)</label>
                      <div className="input f-mono" style={{ background: "var(--surface)", color: mat?.kgPoM > 0 ? "var(--ink-soft)" : "var(--rust)" }}>{mat?.kgPoM > 0 ? `${kol.toFixed(1)} kg` : "nema kg/m"}</div>
                    </div>
                  </>
                ) : (
                  <div style={{ width: 120 }}><label className="label">Količina ({mat?.jm || "kg"})</label><input className="input f-mono" type="number" min="0" value={r.kolicina} onChange={(e) => update(i, { kolicina: e.target.value })} /></div>
                )}
                <div style={{ width: 120 }}>
                  <label className="label">Cijena/{mat?.jm || "kg"} (€)</label>
                  <input className="input f-mono" type="number" min="0" step="0.01" value={r.cijenaPoJed ?? (mat ? mat.cijena : 0)} onChange={(e) => update(i, { cijenaPoJed: e.target.value })} />
                </div>
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <label className="label">Ukupno</label>
                  <div className="f-mono" style={{ fontWeight: 700, fontSize: 14 }}>{fmtCurDec(lineTotal(r))}</div>
                </div>
              </div>
              {nacin === "duzina" && !(mat?.kgPoM > 0) && mat && (
                <div style={{ fontSize: 11, color: "var(--rust)", marginTop: 6 }}>Ovaj materijal nema definiranu masu po m' — unesi je u Skladištu ili prebaci na ručni unos količine.</div>
              )}
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <Btn variant="ghost" size="sm" icon={Plus} onClick={addRow}>Dodaj stavku</Btn>
          <div className="f-mono" style={{ fontSize: 15, fontWeight: 700 }}>Ukupno: {fmtCurDec(total)}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <table className="erp-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Stavka</th>
            <th style={{ width: 100 }}>Količina</th>
            <th style={{ width: 80 }}>JM</th>
            <th style={{ width: 120 }}>Cijena/jed.</th>
            <th style={{ width: 110 }}>Ukupno</th>
            <th style={{ width: 36 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-faint)", padding: 16 }}>Nema stavki. Dodajte prvu stavku.</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ minWidth: 180 }}><input className="input" value={r.opis} placeholder="Opis stavke / usluge" onChange={(e) => update(i, { opis: e.target.value })} /></td>
              <td><input className="input f-mono" type="number" min="0" value={r.kolicina} onChange={(e) => update(i, { kolicina: e.target.value })} /></td>
              <td><input className="input" value={r.jm} onChange={(e) => update(i, { jm: e.target.value })} /></td>
              <td><input className="input f-mono" type="number" min="0" step="0.01" value={r.cijenaJed} onChange={(e) => update(i, { cijenaJed: e.target.value })} /></td>
              <td className="f-mono">{fmtCurDec(lineTotal(r))}</td>
              <td><button className="btn btn-icon btn-ghost" onClick={() => removeRow(i)}><X size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Btn variant="ghost" size="sm" icon={Plus} onClick={addRow}>Dodaj stavku</Btn>
        <div className="f-mono" style={{ fontSize: 15, fontWeight: 700 }}>Ukupno: {fmtCurDec(total)}</div>
      </div>
    </div>
  );
}

/* ============================== GENERIC ENTITY TABLE PAGE ============================== */
function EntityPage({ title, icon: Icon, subtitle, data, onAdd, onEdit, onDelete, columns, searchKeys, addLabel, rowClass }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!q.trim()) return data;
    const s = q.toLowerCase();
    return data.filter((row) => searchKeys.some((k) => String(row[k] ?? "").toLowerCase().includes(s)));
  }, [q, data, searchKeys]);

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} icon={Icon} action={<Btn variant="primary" icon={Plus} onClick={onAdd}>{addLabel}</Btn>} />
      <div className="card" style={{ marginBottom: 14, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, maxWidth: 320 }}>
        <Search size={15} color="var(--ink-faint)" />
        <input className="input" style={{ border: "none", padding: "4px 0" }} placeholder="Pretraži…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        {filtered.length === 0 ? <EmptyState text="Nema podataka." /> : (
          <table className="erp-table">
            <thead><tr>{columns.map((c) => <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}<th style={{ width: 90 }}></th></tr></thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className={rowClass ? rowClass(row) : ""}>
                  {columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn-icon btn-ghost" onClick={() => onEdit(row)}><Pencil size={14} /></button>
                      <button className="btn btn-icon btn-ghost" onClick={() => onDelete(row)}><Trash2 size={14} color="var(--rust)" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const PageHeader = ({ title, subtitle, icon: Icon, action }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {Icon && <Icon size={19} color="var(--steel)" />}
        <h2 className="f-display" style={{ fontSize: 22, fontWeight: 600 }}>{title}</h2>
      </div>
      {subtitle && <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 3 }}>{subtitle}</p>}
    </div>
    {action}
  </div>
);

/* ============================== APP ============================== */
const MODULI_APLIKACIJE = [
  { key: "dashboard", label: "Nadzorna ploča", icon: LayoutDashboard },
  { key: "skladiste", label: "Skladište", icon: Package },
  { key: "nabava", label: "Nabava", icon: Truck },
  { key: "proizvodnja", label: "Proizvodnja", icon: Factory },
  { key: "projekti", label: "Projekti i ponude", icon: Building2 },
  { key: "fakturiranje", label: "Otpremnice i fakturiranje", icon: Receipt },
  { key: "partneri", label: "Kupci i dobavljači", icon: Users },
  { key: "zaposlenici", label: "Zaposlenici", icon: UserCog },
];

function KioskView() {
  const [unos, setUnos] = useState("");
  const [poruka, setPoruka] = useState(null);
  const [sat, setSat] = useState(new Date());
  const inputRef = useRef(null);
  const obradjenIzUrla = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setSat(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, [poruka]);

  const obradiKod = async (kodSirovi) => {
    const kod = (kodSirovi || "").trim().toUpperCase();
    if (!kod) return;
    setUnos("");
    try {
      const res = await fetch(`${API_URL}/api/kiosk/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfidKod: kod }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPoruka({ tip: "greska", tekst: data.error || "Kartica nije prepoznata", detalj: `Kod: ${kod} — javi se administratoru.` });
      } else if (data.tip === "odlazak") {
        const trajanjeMin = Math.max(0, Math.round((new Date(data.vrijeme) - new Date(data.dolazak)) / 60000));
        setPoruka({ tip: "odlazak", tekst: `${data.ime} ${data.prezime}`, detalj: `Odlazak u ${new Date(data.vrijeme).toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })} · Radio/la ${Math.floor(trajanjeMin / 60)}h ${trajanjeMin % 60}min` });
      } else {
        setPoruka({ tip: "dolazak", tekst: `${data.ime} ${data.prezime}`, detalj: `Dolazak zabilježen u ${new Date(data.vrijeme).toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })}` });
      }
    } catch {
      setPoruka({ tip: "greska", tekst: "Greška veze", detalj: "Ne mogu se spojiti na poslužitelj." });
    }
    setTimeout(() => setPoruka(null), 4000);
  };

  useEffect(() => {
    if (obradjenIzUrla.current) return;
    const params = new URLSearchParams(window.location.search);
    const rfid = params.get("rfid");
    if (rfid) { obradjenIzUrla.current = true; obradiKod(rfid); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zatvoriKiosk = () => { window.location.href = window.location.pathname; };
  const bojePoruke = { dolazak: { bg: "#EAF6EF", border: "#B9E3C9", naslov: "#1F6B41" }, odlazak: { bg: "#EAF3F7", border: "#BFE0EC", naslov: "#215C77" }, greska: { bg: "#FBEAE6", border: "#F0C2B5", naslov: "#9A2E1B" } };

  return (
    <div className="erp-root" style={{ minHeight: 640, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--sidebar)", padding: 20 }}>
      <GlobalStyle />
      <div className="card" style={{ width: 420, maxWidth: "100%", padding: 32, background: "var(--surface)", textAlign: "center" }}>
        <div className="f-mono" style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 6, textTransform: "capitalize" }}>{sat.toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "long" })}</div>
        <div className="f-display" style={{ fontSize: 36, fontWeight: 700, marginBottom: 20 }}>{sat.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })}</div>

        {poruka ? (
          <div style={{ padding: "20px 16px", borderRadius: 4, marginBottom: 18, background: bojePoruke[poruka.tip].bg, border: `1px solid ${bojePoruke[poruka.tip].border}` }}>
            {poruka.tip !== "greska" && <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: bojePoruke[poruka.tip].naslov, marginBottom: 6 }}>{poruka.tip === "dolazak" ? "✓ Dolazak" : "✓ Odlazak"}</div>}
            <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 4, color: poruka.tip === "greska" ? bojePoruke.greska.naslov : "var(--ink)" }}>{poruka.tekst}</div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{poruka.detalj}</div>
          </div>
        ) : (
          <div style={{ fontSize: 14, color: "var(--ink-soft)", marginBottom: 18 }}>Prisloni karticu ili upiši kod</div>
        )}

        <input
          ref={inputRef} autoFocus value={unos} placeholder="Kod kartice"
          onChange={(e) => setUnos(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") obradiKod(unos); }}
          className="input f-mono" style={{ textAlign: "center", fontSize: 18, padding: "12px 10px" }}
        />
      </div>
      <button onClick={zatvoriKiosk} style={{ marginTop: 22, background: "none", border: "none", color: "var(--sidebar-ink)", fontSize: 11, cursor: "pointer", opacity: 0.5 }}>Zatvori kiosk način</button>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [zaposlenici, setZaposlenici] = useState([]);
  const [zapId, setZapId] = useState("");
  const [lozinka, setLozinka] = useState("");
  const [greska, setGreska] = useState("");
  const [ucitavanje, setUcitavanje] = useState(true);
  const [saljem, setSaljem] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/zaposlenici`);
        if (!res.ok) throw new Error();
        const lista = await res.json();
        setZaposlenici(lista);
        setZapId(lista[0]?.id || "");
      } catch {
        setGreska("Ne mogu učitati popis zaposlenika — provjeri je li backend pokrenut.");
      } finally {
        setUcitavanje(false);
      }
    })();
  }, []);

  const prijavi = async () => {
    if (!zapId) { setGreska("Odaberite zaposlenika."); return; }
    if (!lozinka) { setGreska("Unesite lozinku."); return; }
    setSaljem(true);
    setGreska("");
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zaposlenikId: zapId, lozinka }),
      });
      const data = await res.json();
      if (!res.ok) { setGreska(data.error || "Prijava nije uspjela."); return; }
      onLogin(data.token, data.zaposlenik);
    } catch {
      setGreska("Greška pri povezivanju s poslužiteljem.");
    } finally {
      setSaljem(false);
    }
  };

  return (
    <div className="erp-root" style={{ minHeight: 640, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--sidebar)" }}>
      <GlobalStyle />
      <div className="card" style={{ width: 380, padding: 28, background: "var(--surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 34, height: 34, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 3, flexShrink: 0 }}>
            <Building2 size={18} color="var(--accent-ink)" />
          </div>
          <div>
            <div className="f-mono" style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--ink-faint)", textTransform: "uppercase" }}>ERP prijava</div>
            <div className="f-display" style={{ fontSize: 18, fontWeight: 600 }}>ECON D.O.O.</div>
          </div>
        </div>
        {ucitavanje ? (
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Učitavanje popisa zaposlenika…</div>
        ) : (
          <>
            <Field label="Zaposlenik">
              <select className="select" value={zapId} onChange={(e) => { setZapId(e.target.value); setGreska(""); }}>
                {zaposlenici.map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
              </select>
            </Field>
            <Field label="Lozinka">
              <input
                className="input f-mono" type="password" placeholder="Lozinka" value={lozinka}
                onChange={(e) => { setLozinka(e.target.value); setGreska(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") prijavi(); }}
              />
            </Field>
            {greska && <div style={{ color: "var(--rust)", fontSize: 12.5, marginBottom: 10 }}>{greska}</div>}
            <Btn variant="primary" onClick={prijavi} disabled={saljem} className="f-display" style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>{saljem ? "Prijava…" : "Prijava"}</Btn>
          </>
        )}
      </div>
    </div>
  );
}

function BackupModal({ db, update, showToast, onClose }) {
  const [uvozPodaci, setUvozPodaci] = useState(null);
  const [greska, setGreska] = useState("");

  const izvezi = () => {
    const paket = { __erp_backup: true, verzija: 1, datum: new Date().toISOString(), podaci: Object.fromEntries(STORAGE_KEYS.map((k) => [k, db[k]])) };
    const blob = new Blob([JSON.stringify(paket, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-erp-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Backup preuzet.");
  };

  const ucitajDatoteku = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGreska("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const podaci = parsed?.podaci && typeof parsed.podaci === "object" ? parsed.podaci : parsed;
        const nadenoKljuceva = STORAGE_KEYS.filter((k) => podaci[k] !== undefined);
        if (nadenoKljuceva.length === 0) { setGreska("Datoteka ne sadrži prepoznatljive ERP podatke."); return; }
        setUvozPodaci(podaci);
      } catch {
        setGreska("Datoteka nije valjan JSON backup.");
      }
    };
    reader.readAsText(file);
  };

  const potvrdiUvoz = () => {
    STORAGE_KEYS.forEach((k) => { if (uvozPodaci[k] !== undefined) update(k, uvozPodaci[k]); });
    showToast("Podaci vraćeni iz backupa.");
    setUvozPodaci(null);
    onClose();
  };

  return (
    <Modal title="Backup — izvoz i uvoz baze" onClose={onClose} footer={<Btn onClick={onClose}>Zatvori</Btn>}>
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Download size={16} color="var(--steel)" />
          <strong className="f-display" style={{ fontSize: 14.5 }}>Izvoz (preuzmi backup)</strong>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 10 }}>Preuzima cijelu bazu (svi moduli) kao jednu JSON datoteku na tvoj uređaj. Preporuka: napravi ovo redovito (npr. svaki tjedan) dok koristiš prototip.</p>
        <Btn variant="primary" icon={Download} onClick={izvezi}>Preuzmi backup (.json)</Btn>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Upload size={16} color="var(--steel)" />
          <strong className="f-display" style={{ fontSize: 14.5 }}>Uvoz (vrati iz backupa)</strong>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--rust)", marginBottom: 10 }}><AlertCircle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Ovo će <strong>prepisati sve trenutne podatke</strong> podacima iz odabrane datoteke. Ne može se poništiti.</p>
        <input type="file" accept="application/json" onChange={ucitajDatoteku} style={{ fontSize: 13 }} />
        {greska && <div style={{ color: "var(--rust)", fontSize: 12.5, marginTop: 8 }}>{greska}</div>}
        {uvozPodaci && (
          <div style={{ marginTop: 12, padding: 10, background: "var(--surface-alt)", borderRadius: 3 }}>
            <div style={{ fontSize: 12.5, marginBottom: 8 }}>Datoteka sadrži:</div>
            <ul style={{ margin: "0 0 10px 18px", padding: 0, fontSize: 12 }}>
              {STORAGE_KEYS.filter((k) => uvozPodaci[k] !== undefined).map((k) => (
                <li key={k}>{k}: <strong className="f-mono">{Array.isArray(uvozPodaci[k]) ? uvozPodaci[k].length : "1"}</strong> {Array.isArray(uvozPodaci[k]) ? "zapisa" : "objekt"}</li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" size="sm" onClick={() => setUvozPodaci(null)}>Odustani</Btn>
              <Btn variant="danger" size="sm" icon={Upload} onClick={potvrdiUvoz}>Potvrdi i prepiši sve podatke</Btn>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function App() {
  const [db, setDb] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [potrebnaPrijava, setPotrebnaPrijava] = useState(false);
  const [prijavljenId, setPrijavljenIdInternal] = useState(() => {
    const token = localStorage.getItem("erp_token");
    const payload = token ? decodeJwtPayload(token) : null;
    return payload?.zaposlenikId || null;
  });

  const ucitajPodatke = async () => {
    const token = localStorage.getItem("erp_token");
    if (!token) { setDb(null); setPotrebnaPrijava(true); return; }
    try {
      const res = await fetch(`${API_URL}/api/data`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        localStorage.removeItem("erp_token");
        setPotrebnaPrijava(true);
        setPrijavljenIdInternal(null);
        return;
      }
      setDb(await res.json());
      setPotrebnaPrijava(false);
    } catch {
      showToast("Greška pri učitavanju podataka — provjeri internetsku vezu.");
    }
  };

  useEffect(() => { ucitajPodatke(); }, []);

  const update = (key, newArr) => {
    setDb((prev) => ({ ...prev, [key]: newArr }));
    fetch(`${API_URL}/api/data/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
      body: JSON.stringify(newArr),
    }).catch(() => showToast("Greška pri spremanju — provjeri internetsku vezu."));
  };

  // Ponovno učitava jedan ključ s backenda i osvježava lokalni state BEZ ponovnog PUT-a —
  // koristi se nakon promjena koje backend napravi izravno (npr. hashiranje lozinke), gdje
  // bi obični update() prepisao stvarni hash lokalnom (nepotpunom) kopijom podataka.
  const refetchKljuc = async (key) => {
    const token = localStorage.getItem("erp_token");
    const res = await fetch(`${API_URL}/api/data/${key}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const vrijednost = await res.json();
    setDb((prev) => ({ ...prev, [key]: vrijednost }));
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const urlParametri = new URLSearchParams(window.location.search);
  const jeKioskNacin = urlParametri.get("kiosk") === "1" || !!urlParametri.get("rfid");
  if (jeKioskNacin) return <KioskView />;

  if (potrebnaPrijava || !prijavljenId) {
    return (
      <LoginScreen
        onLogin={(token, zaposlenikOdgovor) => {
          localStorage.setItem("erp_token", token);
          setPrijavljenIdInternal(zaposlenikOdgovor.id);
          setPotrebnaPrijava(false);
          ucitajPodatke();
        }}
      />
    );
  }

  if (!db) {
    return (
      <div className="erp-root" style={{ minHeight: 420, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle />
        <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>Učitavanje podataka…</div>
      </div>
    );
  }

  const zaposlenik = db.zaposlenici.find((z) => z.id === prijavljenId);
  const mojaPozicija = db.pozicijeZaposlenika.find((p) => p.id === zaposlenik?.pozicijaId);
  const dopusteniKljucevi = mojaPozicija?.moduli?.length ? mojaPozicija.moduli : ["dashboard"];
  const NAV = MODULI_APLIKACIJE.filter((m) => dopusteniKljucevi.includes(m.key));
  const aktivnaStranica = dopusteniKljucevi.includes(page) ? page : (dopusteniKljucevi[0] || "dashboard");
  const odjava = () => {
    localStorage.removeItem("erp_token");
    setDb(null);
    setPrijavljenIdInternal(null);
    setPage("dashboard");
  };

  return (
    <div className="erp-root" style={{ display: "flex", minHeight: 640, background: "var(--bg)" }}>
      <GlobalStyle />

      {/* SIDEBAR */}
      <div style={{ width: 60, background: "var(--sidebar)", flexShrink: 0, display: "flex", flexDirection: "column" }} className="sidebar-wrap">
        <div style={{ padding: "18px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ width: 26, height: 26, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 2 }}>
            <Building2 size={15} color="var(--accent-ink)" />
          </div>
        </div>
        <nav style={{ paddingTop: 8, flex: 1 }}>
          {NAV.map((item) => (
            <div key={item.key} className={`sidebar-item ${aktivnaStranica === item.key ? "active" : ""}`} onClick={() => setPage(item.key)} title={item.label}>
              <item.icon size={17} style={{ flexShrink: 0 }} />
              <span className="nav-label" style={{ display: "none" }}>{item.label}</span>
            </div>
          ))}
        </nav>
      </div>

      {/* WIDE SIDEBAR FOR LARGER SCREENS */}
      <style>{`
        @media (min-width:820px){
          .sidebar-wrap{ width:230px !important; }
          .sidebar-wrap .nav-label{ display:inline !important; }
        }
      `}</style>

      {/* MAIN */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--line)", background: "var(--surface)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="f-mono" style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "var(--ink-faint)", textTransform: "uppercase" }}>ERP · Proizvodnja čeličnih konstrukcija</div>
            <div className="f-display" style={{ fontSize: 15, fontWeight: 600 }}>{db.postavkeTvrtke?.naziv || "ECON D.O.O."}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{new Date().toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
            <div style={{ width: 1, height: 26, background: "var(--line)" }} />
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{zaposlenik?.ime} {zaposlenik?.prezime}</div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{mojaPozicija?.naziv || "—"}</div>
            </div>
            <Btn variant="ghost" size="sm" icon={Database} onClick={() => setBackupOpen(true)}>Backup</Btn>
            <Btn variant="ghost" size="sm" onClick={odjava}>Odjava</Btn>
          </div>
        </div>

        <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
          {aktivnaStranica === "dashboard" && <Dashboard db={db} setPage={setPage} />}
          {aktivnaStranica === "skladiste" && <SkladistePage db={db} update={update} showToast={showToast} />}
          {aktivnaStranica === "nabava" && <NabavaPage db={db} update={update} showToast={showToast} />}
          {aktivnaStranica === "proizvodnja" && <ProizvodnjaPage db={db} update={update} showToast={showToast} />}
          {aktivnaStranica === "projekti" && <ProjektiPage db={db} update={update} showToast={showToast} setPage={setPage} />}
          {aktivnaStranica === "fakturiranje" && <FakturiranjePage db={db} update={update} showToast={showToast} />}
          {aktivnaStranica === "partneri" && <PartneriPage db={db} update={update} showToast={showToast} />}
          {aktivnaStranica === "zaposlenici" && <ZaposleniciPage db={db} update={update} showToast={showToast} refetchKljuc={refetchKljuc} />}
        </div>

      </div>

      {backupOpen && <BackupModal db={db} update={update} showToast={showToast} onClose={() => setBackupOpen(false)} />}

      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, background: "var(--ink)", color: "#fff", padding: "10px 16px", borderRadius: 3, fontSize: 13, display: "flex", alignItems: "center", gap: 8, zIndex: 100 }}>
          <CheckCircle2 size={15} color="var(--accent)" /> {toast}
        </div>
      )}
    </div>
  );
}

/* ============================== DASHBOARD ============================== */
function Dashboard({ db, setPage }) {
  const aktivniProjekti = db.projekti.filter((p) => ["U izradi", "Montaža"].includes(p.status));
  const otvorenePonude = db.ponude.filter((p) => p.status === "Poslana" || p.status === "U izradi");
  const vrijednostPonuda = otvorenePonude.reduce((s, p) => s + izracunPonude(p, db.materijali, db.cjenikRada).ukupno, 0);
  const radniNaloziUTijeku = db.radniNalozi.filter((r) => r.status === "U tijeku");
  const niskaZaliha = db.materijali.filter((m) => m.kolicina < m.minZaliha);
  const neplaceneFakture = db.fakture.filter((f) => f.status !== "Plaćeno");
  const dugovanje = neplaceneFakture.reduce((s, f) => s + izracunFakture(f, db.postavkeTvrtke?.pdvStopa).ukupno, 0);
  const kasneFakture = db.fakture.filter((f) => f.status === "Kasni" || (f.status !== "Plaćeno" && daysUntil(f.rokPlacanja) < 0));
  const uskoroRokovi = db.projekti.filter((p) => !["Završen", "Otkazan"].includes(p.status) && daysUntil(p.rokZavrsetka) <= 30 && daysUntil(p.rokZavrsetka) >= 0).sort((a, b) => daysUntil(a.rokZavrsetka) - daysUntil(b.rokZavrsetka));

  return (
    <div>
      <PageHeader title="Nadzorna ploča" subtitle="Pregled stanja proizvodnje, skladišta i financija" icon={LayoutDashboard} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div className="kpi-card beam-tick" onClick={() => setPage("projekti")} style={{ cursor: "pointer" }}>
          <div className="kpi-num">{aktivniProjekti.length}</div>
          <div className="kpi-label">Aktivni projekti</div>
        </div>
        <div className="kpi-card beam-tick" onClick={() => setPage("projekti")} style={{ cursor: "pointer" }}>
          <div className="kpi-num">{fmtCur(vrijednostPonuda)}</div>
          <div className="kpi-label">Otvorene ponude ({otvorenePonude.length})</div>
        </div>
        <div className="kpi-card beam-tick" onClick={() => setPage("proizvodnja")} style={{ cursor: "pointer" }}>
          <div className="kpi-num">{radniNaloziUTijeku.length}</div>
          <div className="kpi-label">Radni nalozi u tijeku</div>
        </div>
        <div className="kpi-card beam-tick" onClick={() => setPage("skladiste")} style={{ cursor: "pointer", borderColor: niskaZaliha.length ? "#F0C2B5" : undefined }}>
          <div className="kpi-num" style={{ color: niskaZaliha.length ? "var(--rust)" : undefined }}>{niskaZaliha.length}</div>
          <div className="kpi-label">Materijali ispod min. zalihe</div>
        </div>
        <div className="kpi-card beam-tick" onClick={() => setPage("fakturiranje")} style={{ cursor: "pointer", borderColor: kasneFakture.length ? "#F0C2B5" : undefined }}>
          <div className="kpi-num">{fmtCur(dugovanje)}</div>
          <div className="kpi-label">Nenaplaćeno ({neplaceneFakture.length} faktura)</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="dash-grid">
        <style>{`@media (max-width:760px){ .dash-grid{ grid-template-columns:1fr !important; } }`}</style>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <AlertTriangle size={15} color="var(--rust)" />
            <h3 className="f-display" style={{ fontSize: 14.5, fontWeight: 600 }}>Niska zaliha materijala</h3>
          </div>
          {niskaZaliha.length === 0 ? <EmptyState text="Sve zalihe su iznad minimuma." /> : (
            <table className="erp-table">
              <thead><tr><th>Materijal</th><th>Stanje</th><th>Min.</th></tr></thead>
              <tbody>
                {niskaZaliha.map((m) => (
                  <tr key={m.id}><td>{m.naziv}</td><td className="f-mono" style={{ color: "var(--rust)" }}>{m.kolicina} {m.jm}</td><td className="f-mono">{m.minZaliha} {m.jm}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <Clock size={15} color="var(--steel)" />
            <h3 className="f-display" style={{ fontSize: 14.5, fontWeight: 600 }}>Rokovi projekata (30 dana)</h3>
          </div>
          {uskoroRokovi.length === 0 ? <EmptyState text="Nema nadolazećih rokova." /> : (
            <table className="erp-table">
              <thead><tr><th>Projekt</th><th>Rok</th><th>Preostalo</th></tr></thead>
              <tbody>
                {uskoroRokovi.map((p) => (
                  <tr key={p.id}><td>{p.naziv}</td><td className="f-mono">{fmtDate(p.rokZavrsetka)}</td><td className="f-mono">{daysUntil(p.rokZavrsetka)} d.</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== SKLADIŠTE ============================== */
const TIPOVI_MATERIJALA = ["HEA", "HEB", "HEM", "IPE", "IPN", "UPN", "SHS", "RHS", "CHS", "Okrugla šipka", "Kvadratna šipka", "Plosnat", "Kutni jednakokraki", "Lim", "Vijčana roba", "Boja i premazi", "Ostalo"];
const JEDINICE = ["kg", "kom", "m", "m2", "l"];

const TIPOVI_KATALOGA = ["HEA", "HEB", "HEM", "IPE", "IPN", "UPN", "SHS", "RHS", "CHS", "Okrugla šipka", "Kvadratna šipka", "Plosnat", "Kutni jednakokraki", "Lim", "Ostalo"];
const katalogPoTipu = (katalog) => TIPOVI_KATALOGA.map((tip) => ({ tip, stavke: katalog.filter((k) => k.tip === tip) })).filter((g) => g.stavke.length);
const masaIzKataloga = (entry, dimenzija) => (entry ? (Number(entry.vrijednost) || 0) * (Number(dimenzija) || 0) : 0);

function SkladistePage({ db, update, showToast }) {
  const [tab, setTab] = useState("zalihe");
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', item}
  const [del, setDel] = useState(null);
  const empty = { sifra: "", naziv: "", tip: TIPOVI_MATERIJALA[0], dimenzije: "", jm: "kg", cijena: 0, kolicina: 0, minZaliha: 0, lokacija: "", kgPoM: 0 };
  const [form, setForm] = useState(empty);

  const openAdd = () => { setForm(empty); setModal({ mode: "add" }); };
  const openEdit = (item) => { setForm(item); setModal({ mode: "edit" }); };
  const save = () => {
    if (!form.sifra.trim() || !form.naziv.trim()) return;
    const duplikat = db.materijali.some((m) => m.sifra.trim().toLowerCase() === form.sifra.trim().toLowerCase() && m.id !== form.id);
    if (duplikat) { showToast(`Šifra "${form.sifra}" već postoji na drugom materijalu — koristi drugu šifru.`); return; }
    if (modal.mode === "add") update("materijali", [...db.materijali, { ...form, id: uid("mat"), cijena: Number(form.cijena), kolicina: Number(form.kolicina), minZaliha: Number(form.minZaliha), kgPoM: Number(form.kgPoM) || 0 }]);
    else update("materijali", db.materijali.map((m) => (m.id === form.id ? { ...form, cijena: Number(form.cijena), kolicina: Number(form.kolicina), minZaliha: Number(form.minZaliha), kgPoM: Number(form.kgPoM) || 0 } : m)));
    showToast("Materijal spremljen.");
    setModal(null);
  };

  // katalog CRUD
  const [katModal, setKatModal] = useState(null);
  const [katDel, setKatDel] = useState(null);
  const emptyKat = { tip: TIPOVI_KATALOGA[0], oznaka: "", jedinica: "kg/m", vrijednost: 0 };
  const [katForm, setKatForm] = useState(emptyKat);
  const openKatAdd = () => { setKatForm(emptyKat); setKatModal("add"); };
  const openKatEdit = (item) => { setKatForm(item); setKatModal("edit"); };
  const saveKat = () => {
    if (!katForm.oznaka.trim()) return;
    const payload = { ...katForm, vrijednost: Number(katForm.vrijednost) };
    if (katModal === "add") update("katalogProfila", [...db.katalogProfila, { ...payload, id: uid("kat") }]);
    else update("katalogProfila", db.katalogProfila.map((k) => (k.id === katForm.id ? payload : k)));
    setKatModal(null);
    showToast("Stavka kataloga spremljena.");
  };

  return (
    <div>
      <PageHeader title="Skladište" icon={Package} subtitle="Zalihe materijala i katalog standardnih profila/limova za izračun mase" />
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        <div className={`nav-tab ${tab === "zalihe" ? "active" : ""}`} onClick={() => setTab("zalihe")}>Zalihe</div>
        <div className={`nav-tab ${tab === "katalog" ? "active" : ""}`} onClick={() => setTab("katalog")}>Katalog profila i limova</div>
      </div>

      {tab === "zalihe" && (
        <EntityPage
          title="" data={db.materijali} onAdd={openAdd} onEdit={openEdit} onDelete={(row) => setDel(row)}
          addLabel="Novi materijal" searchKeys={["sifra", "naziv", "tip"]}
          rowClass={(row) => (row.kolicina < row.minZaliha ? "row-warn" : "")}
          columns={[
            { key: "sifra", label: "Šifra", render: (r) => <span className="f-mono">{r.sifra}</span> },
            { key: "naziv", label: "Naziv" },
            { key: "tip", label: "Tip" },
            { key: "dimenzije", label: "Dimenzije" },
            { key: "kolicina", label: "Stanje", render: (r) => <span className="f-mono" style={{ color: r.kolicina < r.minZaliha ? "var(--rust)" : "inherit", fontWeight: r.kolicina < r.minZaliha ? 700 : 400 }}>{r.kolicina} {r.jm}{r.kolicina < r.minZaliha && <AlertTriangle size={12} style={{ marginLeft: 4, verticalAlign: -2 }} />}</span> },
            { key: "minZaliha", label: "Min. zaliha", render: (r) => <span className="f-mono">{r.minZaliha} {r.jm}</span> },
            { key: "cijena", label: "Cijena/jed.", render: (r) => <span className="f-mono">{fmtCurDec(r.cijena)}</span> },
            { key: "lokacija", label: "Lokacija" },
          ]}
        />
      )}

      {tab === "katalog" && (
        <>
          <div style={{ marginBottom: 12, fontSize: 13, color: "var(--ink-soft)" }}>
            Puni standardni raspon profila (HEA, HEB, HEM, IPE, IPN, UPN sve dimenzije) te formulom generirani SHS/RHS/CHS cijevni profili, okrugle i kvadratne šipke, plosnati i kutni profili te limovi. HEA/HEB/HEM/IPE/IPN/UPN mase su standardne tablične vrijednosti; ostali profili računati su po standardnoj formuli za gustoću čelika 7,85 kg/dm³ (točnost ±1–2%, preporuka: provjeriti s dobavljačem za velike narudžbe).
          </div>
          <div style={{ marginBottom: 12, fontSize: 12, color: "var(--ink-faint)" }}>Ukupno stavki u katalogu: <strong className="f-mono">{db.katalogProfila.length}</strong></div>
          <EntityPage
            title="" data={db.katalogProfila} onAdd={openKatAdd} onEdit={openKatEdit} onDelete={(row) => setKatDel(row)}
            addLabel="Nova stavka kataloga" searchKeys={["oznaka", "tip"]}
            columns={[
              { key: "tip", label: "Tip", render: (r) => <span className="badge badge-muted">{r.tip}</span> },
              { key: "oznaka", label: "Oznaka", render: (r) => <span className="f-mono">{r.oznaka}</span> },
              { key: "vrijednost", label: "Masa", render: (r) => <span className="f-mono">{r.vrijednost} {r.jedinica}</span> },
            ]}
          />
        </>
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Novi materijal" : "Uredi materijal"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={save}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Šifra"><input className="input" value={form.sifra} onChange={(e) => setForm({ ...form, sifra: e.target.value })} /></Field>
            <Field label="Naziv"><input className="input" value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} /></Field>
            <Field label="Tip"><select className="select" value={form.tip} onChange={(e) => setForm({ ...form, tip: e.target.value })}>{TIPOVI_MATERIJALA.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Dimenzije"><input className="input" value={form.dimenzije} onChange={(e) => setForm({ ...form, dimenzije: e.target.value })} /></Field>
            <Field label="Jedinica mjere"><select className="select" value={form.jm} onChange={(e) => setForm({ ...form, jm: e.target.value })}>{JEDINICE.map((j) => <option key={j}>{j}</option>)}</select></Field>
            <Field label="Cijena po jedinici (€)"><input className="input f-mono" type="number" step="0.01" value={form.cijena} onChange={(e) => setForm({ ...form, cijena: e.target.value })} /></Field>
            <Field label="Masa po m' (kg/m) — za auto-izračun po dužini"><input className="input f-mono" type="number" step="0.01" value={form.kgPoM || 0} onChange={(e) => setForm({ ...form, kgPoM: e.target.value })} /></Field>
            <Field label="Trenutno stanje"><input className="input f-mono" type="number" value={form.kolicina} onChange={(e) => setForm({ ...form, kolicina: e.target.value })} /></Field>
            <Field label="Minimalna zaliha"><input className="input f-mono" type="number" value={form.minZaliha} onChange={(e) => setForm({ ...form, minZaliha: e.target.value })} /></Field>
            <div style={{ gridColumn: "1 / -1" }}><Field label="Lokacija na skladištu"><input className="input" value={form.lokacija} onChange={(e) => setForm({ ...form, lokacija: e.target.value })} /></Field></div>
          </div>
        </Modal>
      )}
      {del && <ConfirmDelete label={del.naziv} onCancel={() => setDel(null)} onConfirm={() => { update("materijali", db.materijali.filter((m) => m.id !== del.id)); setDel(null); showToast("Materijal obrisan."); }} />}

      {katModal && (
        <Modal title={katModal === "add" ? "Nova stavka kataloga" : "Uredi stavku kataloga"} onClose={() => setKatModal(null)} footer={<><Btn onClick={() => setKatModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={saveKat}>Spremi</Btn></>}>
          <Field label="Tip profila"><select className="select" value={katForm.tip} onChange={(e) => setKatForm({ ...katForm, tip: e.target.value })}>{TIPOVI_KATALOGA.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Oznaka (npr. HEB 200, Lim 10 mm, 60×60×4)"><input className="input" value={katForm.oznaka} onChange={(e) => setKatForm({ ...katForm, oznaka: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Jedinica"><select className="select" value={katForm.jedinica} onChange={(e) => setKatForm({ ...katForm, jedinica: e.target.value })}><option value="kg/m">kg/m (linearni profil)</option><option value="kg/m2">kg/m² (lim)</option></select></Field>
            <Field label={katForm.jedinica === "kg/m2" ? "Masa (kg po m²)" : "Masa (kg po m dužni)"}><input className="input f-mono" type="number" step="0.001" value={katForm.vrijednost} onChange={(e) => setKatForm({ ...katForm, vrijednost: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {katDel && <ConfirmDelete label={katDel.oznaka} onCancel={() => setKatDel(null)} onConfirm={() => { update("katalogProfila", db.katalogProfila.filter((k) => k.id !== katDel.id)); setKatDel(null); showToast("Stavka kataloga obrisana."); }} />}
    </div>
  );
}

/* ============================== NABAVA ============================== */
/* ============================== ISPIS DOKUMENTA (UPIT / NARUDŽBA) ============================== */
function DokumentNabavePrintModal({ tip, brojDokumenta, datum, izradioIme, stavke, postavkeTvrtke, onClose }) {
  const t = postavkeTvrtke || {};
  return (
    <Modal wide title={`Pregled za ispis — ${tip} ${brojDokumenta}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => window.print()}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ maxWidth: 260 }}>
            <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>NARUDŽBA / UPIT<br />ZA NABAVU OSNOVNOG<br />MATERIJALA</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.naziv}</div>
            <div style={{ fontSize: 9.5, color: "#555", marginBottom: 4, maxWidth: 260 }}>{t.djelatnost}</div>
            <div>{t.adresa}</div>
            <div>{t.telefon}</div>
            <div>{t.email}</div>
            <div>{t.web}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 30, marginBottom: 14, fontSize: 11.5 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 13, height: 13, border: "1px solid #333", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{tip === "Upit" ? "✓" : ""}</span> Upit</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 13, height: 13, border: "1px solid #333", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{tip === "Narudžba" ? "✓" : ""}</span> Narudžba</span>
        </div>

        <table style={{ fontSize: 11.5, marginBottom: 16, borderCollapse: "collapse" }}>
          <tbody>
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Datum:</td><td style={{ fontWeight: 600 }}>{fmtDate(datum)}</td></tr>
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Izradio:</td><td style={{ fontWeight: 600 }}>{izradioIme}</td></tr>
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Upit/Narudžba broj:</td><td style={{ fontWeight: 600 }}>{brojDokumenta}</td></tr>
          </tbody>
        </table>

        <table className="doc-table" style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={{ width: 34 }}>R. br.</th><th style={{ width: 45 }}>Kom:</th><th style={{ width: 65 }}>Dimenzije: [mm]</th>
              <th>Vrsta materijala/ Norma kvalitete:</th><th style={{ width: 85 }}>Kvaliteta materijala:</th>
              <th style={{ width: 90 }}>Zahtijevane norme isporuke:</th><th>Dodatni zahtjevi:</th>
            </tr>
          </thead>
          <tbody>
            {stavke.map((s, i) => (
              <tr key={s.id || i}>
                <td>{i + 1}.</td><td>{s.kolicina}</td><td>{s.dimenzijaMM}</td>
                <td>{s.vrstaMaterijala}</td><td>{s.kvaliteta}</td><td>{s.normaIsporuke}</td><td>{s.dodatniZahtjevi}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ fontSize: 11, marginBottom: 14 }}>
          <strong>Opći zahtjevi:</strong>
          <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li>Svaki nabavljeni materijal ili dio mora biti popraćen sa primjerkom uvjerenja o kvaliteti ili certifikatom usklađenosti po tehničkim specifikacijama ili općim normama.</li>
            <li>Na svim uvjerenjima o kvaliteti ili certifikatima usklađenosti moraju biti navedene zahtijevane norme, te sve šarže materijala moraju biti usklađene s uvjerenjima.</li>
            <li>Kontrola se vrši prilikom preuzimanja robe.</li>
          </ol>
        </div>

        <div style={{ fontSize: 11, marginBottom: 16 }}>
          <strong>Certifikati i izvještaji:</strong>
          <div style={{ marginTop: 6, fontWeight: 600 }}>Za materijale kvalitete S235/S275 JR /J0 dostaviti ateste materijala 2.2</div>
          <div style={{ fontWeight: 600 }}>Za materijale kvalitete S235/S275 J2 i više razrede kvalitete dostaviti ateste materijala 3.1.</div>
          <div>Za vijke je potrebno isporučiti izjavu o svojstvima.</div>
          <div style={{ fontWeight: 600 }}>Sve materijale za konstrukcije isporučiti sa vidljivom oznakom šarže.</div>
        </div>

        <div style={{ fontSize: 11, marginBottom: 20 }}>
          <div>Molimo Vas da nas po primitku narudžbe izvijestite.</div>
          <div>Za eventualne potrebne informacije stojimo Vam na raspolaganju!</div>
          <div style={{ marginTop: 10 }}>S poštovanjem,</div>
          <div style={{ fontWeight: 700, marginTop: 8 }}>{t.naziv}</div>
          <div>{izradioIme}</div>
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>Žiro račun:</strong> {t.ziroRacun}<br />
          <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Temeljni kapital:</strong> {t.temeljniKapital} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

function PostavkeTvrtkeModal({ postavke, onSave, onClose }) {
  const [form, setForm] = useState(postavke);
  const polja = [
    ["naziv", "Naziv tvrtke"], ["djelatnost", "Djelatnost"], ["adresa", "Adresa"], ["telefon", "Telefon"], ["faks", "Faks"], ["email", "E-mail"], ["web", "Web"],
    ["oib", "OIB"], ["mb", "MB"], ["vatId", "VAT-ID"], ["ziroRacun", "Žiro račun"], ["iban", "IBAN"], ["swift", "SWIFT"], ["sud", "Trgovački sud"], ["mbs", "MBS"], ["temeljniKapital", "Temeljni kapital"], ["uprava", "Uprava"], ["pdvStopa", "Stopa PDV-a (%)"],
  ];
  return (
    <Modal wide title="Postavke tvrtke (podaci za dokumente)" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={() => onSave(form)}>Spremi</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {polja.map(([key, label]) => (
          <Field key={key} label={label}><input className="input" value={form[key] || ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></Field>
        ))}
      </div>
    </Modal>
  );
}

function UpitStavkeEditor({ stavke, setStavke }) {
  const addRow = () => setStavke([...stavke, { id: uid("us"), kolicina: 1, dimenzijaMM: 6000, vrstaMaterijala: "", kvaliteta: "", normaIsporuke: "", dodatniZahtjevi: "", ponude: [], odabranaPonudaId: null, narudzbenicaId: null }]);
  const update = (i, patch) => setStavke(stavke.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeRow = (i) => setStavke(stavke.filter((_, idx) => idx !== i));
  return (
    <div>
      <table className="erp-table" style={{ marginBottom: 8 }}>
        <thead><tr><th style={{ width: 55 }}>Kom</th><th style={{ width: 90 }}>Dim. [mm]</th><th>Vrsta materijala</th><th style={{ width: 110 }}>Kvaliteta</th><th style={{ width: 110 }}>Norma isporuke</th><th>Dodatni zahtjevi</th><th style={{ width: 32 }}></th></tr></thead>
        <tbody>
          {stavke.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-faint)", padding: 14 }}>Nema stavki. Dodaj potreban materijal.</td></tr>}
          {stavke.map((s, i) => (
            <tr key={s.id}>
              <td><input className="input f-mono" type="number" min="0" value={s.kolicina} onChange={(e) => update(i, { kolicina: e.target.value })} /></td>
              <td><input className="input f-mono" type="number" min="0" value={s.dimenzijaMM} onChange={(e) => update(i, { dimenzijaMM: e.target.value })} /></td>
              <td><input className="input" placeholder="npr. Cijev 40x20x2 / HEA 100" value={s.vrstaMaterijala} onChange={(e) => update(i, { vrstaMaterijala: e.target.value })} /></td>
              <td><input className="input" placeholder="S235JR…" value={s.kvaliteta} onChange={(e) => update(i, { kvaliteta: e.target.value })} /></td>
              <td><input className="input" value={s.normaIsporuke} onChange={(e) => update(i, { normaIsporuke: e.target.value })} /></td>
              <td><input className="input" value={s.dodatniZahtjevi} onChange={(e) => update(i, { dodatniZahtjevi: e.target.value })} /></td>
              <td><button className="btn btn-icon btn-ghost" onClick={() => removeRow(i)}><X size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Btn variant="ghost" size="sm" icon={Plus} onClick={addRow}>Dodaj stavku</Btn>
    </div>
  );
}

const generirajBrojUpita = (upiti) => {
  const god = new Date().getFullYear().toString().slice(-2);
  const brojevi = upiti.filter((u) => u.broj && u.broj.startsWith(`${god}-`)).map((u) => parseInt(u.broj.split("-")[1], 10)).filter((n) => !isNaN(n));
  const sljedeci = (brojevi.length ? Math.max(...brojevi) : 58) + 1;
  return `${god}-${String(sljedeci).padStart(3, "0")}`;
};

// Kreira novi Upit (RFQ) u Nabavi na temelju popisa potrebnog materijala definiranog na projektu
const kreirajUpitIzMaterijala = (projekt, db, update, showToast) => {
  const stavke = (projekt.materijalStavke || []).filter((s) => s.materijalId).map((s) => {
    const m = db.materijali.find((x) => x.id === s.materijalId);
    return { id: uid("us"), kolicina: s.kolicina, dimenzijaMM: "", vrstaMaterijala: m?.naziv || "", kvaliteta: "", normaIsporuke: "", dodatniZahtjevi: `Za projekt ${projekt.sifra} — ${projekt.naziv}`, ponude: [], odabranaPonudaId: null, narudzbenicaId: null };
  });
  if (stavke.length === 0) { showToast("Nema definiranog materijala na projektu — dodaj stavke prije kreiranja upita."); return null; }
  const noviUpit = { id: uid("upit"), broj: generirajBrojUpita(db.upitiNabave), datum: todayISO(), izradioId: projekt.voditeljId || "", status: "Priprema", napomena: `Kreirano iz projekta ${projekt.sifra} — ${projekt.naziv}`, izvorProjektaId: projekt.id, stavke };
  update("upitiNabave", [...db.upitiNabave, noviUpit]);
  showToast(`Upit ${noviUpit.broj} kreiran u Nabavi (Upiti materijala).`);
  return noviUpit;
};

// Grupira odabrane (a još nenaručene) stavke upita po dobavljaču i stvara narudžbenice + skladišne artikle
const generirajNarudzbeIzUpita = (upit, db, update, showToast) => {
  const zaObradu = upit.stavke.filter((s) => s.odabranaPonudaId && !s.narudzbenicaId);
  if (zaObradu.length === 0) { showToast("Nema odabranih pozicija spremnih za narudžbu."); return; }
  const poDobavljacu = {};
  zaObradu.forEach((s) => {
    const ponuda = s.ponude.find((p) => p.id === s.odabranaPonudaId);
    if (!ponuda) return;
    if (!poDobavljacu[ponuda.dobavljacId]) poDobavljacu[ponuda.dobavljacId] = [];
    poDobavljacu[ponuda.dobavljacId].push({ stavka: s, ponuda });
  });

  let noviMaterijali = [...db.materijali];
  let noveNarudzbenice = [...db.narudzbenice];
  const azuriranjeStavkiId = {};
  const nabPrefiks = "NAR-2026-";
  let nabBrojac = parseInt(sljedeciBroj(noveNarudzbenice, "broj", nabPrefiks).slice(nabPrefiks.length), 10);

  Object.entries(poDobavljacu).forEach(([dobavljacId, stavke]) => {
    const materijalIdZaStavku = [];
    stavke.forEach(({ stavka, ponuda }) => {
      const noviMaterijal = {
        id: uid("mat"), sifra: stavka.vrstaMaterijala.replace(/[^A-Za-z0-9]+/g, "-") || uid("sif"),
        naziv: stavka.vrstaMaterijala, tip: "Ostalo", dimenzije: `${stavka.dimenzijaMM} mm${stavka.kvaliteta ? ", " + stavka.kvaliteta : ""}`,
        jm: "kom", cijena: Number(ponuda.cijena) || 0, kolicina: 0, minZaliha: 0, lokacija: "",
      };
      noviMaterijali.push(noviMaterijal);
      materijalIdZaStavku.push({ stavkaId: stavka.id, materijalId: noviMaterijal.id, kolicina: stavka.kolicina });
    });
    const novaNarudzbenica = {
      id: uid("nab"), broj: `${nabPrefiks}${String(nabBrojac++).padStart(3, "0")}`, dobavljacId, datum: todayISO(), rokIsporuke: addDays(todayISO(), 14),
      status: "Nacrt", napomena: `Generirano iz upita ${upit.broj}`, izradioId: upit.izradioId, izvorUpitaId: upit.id,
      stavke: materijalIdZaStavku.map((m) => ({ materijalId: m.materijalId, kolicina: m.kolicina })),
      stavkeUpita: stavke.map(({ stavka, ponuda }) => ({ kolicina: stavka.kolicina, dimenzijaMM: stavka.dimenzijaMM, vrstaMaterijala: stavka.vrstaMaterijala, kvaliteta: stavka.kvaliteta, normaIsporuke: stavka.normaIsporuke, dodatniZahtjevi: stavka.dodatniZahtjevi, cijena: ponuda.cijena })),
    };
    noveNarudzbenice.push(novaNarudzbenica);
    stavke.forEach(({ stavka }) => { azuriranjeStavkiId[stavka.id] = novaNarudzbenica.id; });
  });

  update("materijali", noviMaterijali);
  update("narudzbenice", noveNarudzbenice);
  update("upitiNabave", db.upitiNabave.map((u) => (u.id === upit.id ? { ...u, stavke: u.stavke.map((s) => (azuriranjeStavkiId[s.id] ? { ...s, narudzbenicaId: azuriranjeStavkiId[s.id] } : s)), status: "Zatvoreno" } : u)));
  showToast(`Generirano ${Object.keys(poDobavljacu).length} narudžbenica prema dobavljačima.`);
};

function UpitDetaljModal({ upit, db, update, showToast, onClose, onOtvoriPrint }) {
  const azuriraj = (noveStavke) => update("upitiNabave", db.upitiNabave.map((u) => (u.id === upit.id ? { ...u, stavke: noveStavke } : u)));
  const dodajPonudu = (stavkaId) => azuriraj(upit.stavke.map((s) => (s.id === stavkaId ? { ...s, ponude: [...s.ponude, { id: uid("usp"), dobavljacId: db.dobavljaci[0]?.id || "", cijena: 0, napomena: "" }] } : s)));
  const azurirajPonudu = (stavkaId, ponudaId, patch) => azuriraj(upit.stavke.map((s) => (s.id === stavkaId ? { ...s, ponude: s.ponude.map((p) => (p.id === ponudaId ? { ...p, ...patch } : p)) } : s)));
  const obrisiPonudu = (stavkaId, ponudaId) => azuriraj(upit.stavke.map((s) => (s.id === stavkaId ? { ...s, ponude: s.ponude.filter((p) => p.id !== ponudaId), odabranaPonudaId: s.odabranaPonudaId === ponudaId ? null : s.odabranaPonudaId } : s)));
  const odaberiPonudu = (stavkaId, ponudaId) => azuriraj(upit.stavke.map((s) => (s.id === stavkaId ? { ...s, odabranaPonudaId: ponudaId || null } : s)));
  const dobNaziv = (id) => db.dobavljaci.find((d) => d.id === id)?.naziv || "—";

  return (
    <Modal wide title={`Ponude dobavljača — Upit ${upit.broj}`} onClose={onClose} footer={
      <>
        <Btn onClick={onClose}>Zatvori</Btn>
        <Btn variant="primary" icon={FolderInput} onClick={() => generirajNarudzbeIzUpita(upit, db, update, showToast)}>Generiraj narudžbe za odabrane pozicije</Btn>
      </>
    }>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>Za svaku stavku unesi ponude pristiglih dobavljača (cijena po komadu), zatim označi koju ponudu odabireš. Nakon toga generiraj narudžbe — automatski grupirane po dobavljaču.</p>
      {upit.stavke.map((s) => (
        <div key={s.id} className="card" style={{ padding: 12, marginBottom: 10, background: "var(--surface-alt)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.vrstaMaterijala} <span className="f-mono" style={{ fontWeight: 400, color: "var(--ink-soft)" }}>· {s.kolicina} kom × {s.dimenzijaMM}mm{s.kvaliteta ? ` · ${s.kvaliteta}` : ""}</span></div>
            {s.narudzbenicaId ? <Badge status="Primljeno" /> : (s.odabranaPonudaId ? <Badge status="Odobren" /> : <Badge status="Nacrt" />)}
          </div>
          {s.ponude.length === 0 ? <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 8 }}>Još nema unesenih ponuda.</div> : (
            <table className="erp-table" style={{ marginBottom: 8 }}>
              <thead><tr><th style={{ width: 30 }}></th><th>Dobavljač</th><th style={{ width: 110 }}>Cijena/kom</th><th>Napomena</th><th style={{ width: 32 }}></th></tr></thead>
              <tbody>
                {s.ponude.map((p) => (
                  <tr key={p.id} style={s.odabranaPonudaId === p.id ? { background: "#EAF6EF" } : undefined}>
                    <td><input type="radio" name={`odabir-${s.id}`} checked={s.odabranaPonudaId === p.id} onChange={() => odaberiPonudu(s.id, p.id)} disabled={!!s.narudzbenicaId} /></td>
                    <td><select className="select" style={{ fontSize: 12.5 }} value={p.dobavljacId} disabled={!!s.narudzbenicaId} onChange={(e) => azurirajPonudu(s.id, p.id, { dobavljacId: e.target.value })}>{db.dobavljaci.map((d) => <option key={d.id} value={d.id}>{d.naziv}</option>)}</select></td>
                    <td><input className="input f-mono" type="number" min="0" step="0.01" disabled={!!s.narudzbenicaId} value={p.cijena} onChange={(e) => azurirajPonudu(s.id, p.id, { cijena: e.target.value })} /></td>
                    <td><input className="input" disabled={!!s.narudzbenicaId} value={p.napomena} onChange={(e) => azurirajPonudu(s.id, p.id, { napomena: e.target.value })} /></td>
                    <td>{!s.narudzbenicaId && <button className="btn btn-icon btn-ghost" onClick={() => obrisiPonudu(s.id, p.id)}><X size={13} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!s.narudzbenicaId && <Btn variant="ghost" size="sm" icon={Plus} onClick={() => dodajPonudu(s.id)}>Dodaj ponudu</Btn>}
          {s.narudzbenicaId && <div style={{ fontSize: 11.5, color: "var(--green)" }}>✓ Naručeno od {dobNaziv(s.ponude.find((p) => p.id === s.odabranaPonudaId)?.dobavljacId)}</div>}
        </div>
      ))}
    </Modal>
  );
}

function NabavaPage({ db, update, showToast }) {
  const [tab, setTab] = useState("narudzbenice");
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [postavkeOpen, setPostavkeOpen] = useState(false);
  const [printDoc, setPrintDoc] = useState(null); // { tip, brojDokumenta, datum, izradioIme, stavke }
  const [upitDetalj, setUpitDetalj] = useState(null);

  const emptyForm = () => ({ id: null, broj: sljedeciBroj(db.narudzbenice, "broj", "NAR-2026-"), dobavljacId: db.dobavljaci[0]?.id || "", datum: todayISO(), rokIsporuke: todayISO(), status: "Nacrt", napomena: "", stavke: [] });
  const [form, setForm] = useState(emptyForm());

  const emptyUpit = () => ({ id: null, broj: generirajBrojUpita(db.upitiNabave), datum: todayISO(), izradioId: db.zaposlenici[0]?.id || "", status: "Priprema", napomena: "", stavke: [] });
  const [upitForm, setUpitForm] = useState(emptyUpit());

  const openAdd = () => { setForm(emptyForm()); setModal("edit"); };
  const openEdit = (row) => { setForm(JSON.parse(JSON.stringify(row))); setModal("edit"); };
  const save = () => {
    if (form.id) update("narudzbenice", db.narudzbenice.map((n) => (n.id === form.id ? form : n)));
    else update("narudzbenice", [...db.narudzbenice, { ...form, id: uid("nab") }]);
    setModal(null);
    showToast("Narudžbenica spremljena.");
  };
  const primi = (row) => {
    let materijali = [...db.materijali];
    row.stavke.forEach((s) => {
      const mat = materijali.find((m) => m.id === s.materijalId);
      materijali = materijali.map((m) => (m.id === s.materijalId ? { ...m, kolicina: m.kolicina + efektivnaKolicinaMaterijala(s, mat) } : m));
    });
    update("materijali", materijali);
    update("narudzbenice", db.narudzbenice.map((n) => (n.id === row.id ? { ...n, status: "Primljeno" } : n)));
    showToast("Roba zaprimljena, stanje skladišta ažurirano.");
  };
  const dobNaziv = (id) => db.dobavljaci.find((d) => d.id === id)?.naziv || "—";
  const zaposlenikIme = (id) => { const z = db.zaposlenici.find((zz) => zz.id === id); return z ? `${z.ime} ${z.prezime}` : "—"; };
  const iznos = (row) => row.stavke.reduce((s, st) => { const m = db.materijali.find((x) => x.id === st.materijalId); const cijena = st.cijenaPoJed != null ? Number(st.cijenaPoJed) : (m ? m.cijena : 0); return s + cijena * efektivnaKolicinaMaterijala(st, m); }, 0);

  const openUpitAdd = () => { setUpitForm(emptyUpit()); setModal("upit"); };
  const openUpitEdit = (row) => { setUpitForm(JSON.parse(JSON.stringify(row))); setModal("upit"); };
  const saveUpit = () => {
    if (upitForm.id) update("upitiNabave", db.upitiNabave.map((u) => (u.id === upitForm.id ? upitForm : u)));
    else update("upitiNabave", [...db.upitiNabave, { ...upitForm, id: uid("upit") }]);
    setModal(null);
    showToast("Upit spremljen.");
  };
  const savePostavke = (novo) => { update("postavkeTvrtke", novo); setPostavkeOpen(false); showToast("Postavke tvrtke spremljene."); };

  const otvoriPrintUpit = (upit) => setPrintDoc({ tip: "Upit", brojDokumenta: upit.broj, datum: upit.datum, izradioIme: zaposlenikIme(upit.izradioId), stavke: upit.stavke });
  const otvoriPrintNarudzba = (row) => {
    const stavke = row.stavkeUpita && row.stavkeUpita.length
      ? row.stavkeUpita
      : row.stavke.map((s) => { const m = db.materijali.find((x) => x.id === s.materijalId); return { kolicina: s.kolicina, dimenzijaMM: "", vrstaMaterijala: m?.naziv || "—", kvaliteta: "", normaIsporuke: "", dodatniZahtjevi: "" }; });
    setPrintDoc({ tip: "Narudžba", brojDokumenta: row.broj, datum: row.datum, izradioIme: zaposlenikIme(row.izradioId), stavke });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <PageHeader title="Nabava" icon={Truck} subtitle="Upiti, ponude dobavljača i narudžbenice materijala" />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 20 }}>
          <div className={`nav-tab ${tab === "narudzbenice" ? "active" : ""}`} onClick={() => setTab("narudzbenice")}>Narudžbenice</div>
          <div className={`nav-tab ${tab === "upiti" ? "active" : ""}`} onClick={() => setTab("upiti")}>Upiti materijala</div>
        </div>
        <Btn variant="ghost" size="sm" icon={Settings} onClick={() => setPostavkeOpen(true)}>Postavke tvrtke</Btn>
      </div>

      {tab === "narudzbenice" && (
        <EntityPage
          title="" data={db.narudzbenice} onAdd={openAdd} onEdit={openEdit} onDelete={(r) => setDel(r)}
          addLabel="Nova narudžbenica" searchKeys={["broj"]}
          columns={[
            { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
            { key: "dobavljac", label: "Dobavljač", render: (r) => dobNaziv(r.dobavljacId) },
            { key: "datum", label: "Datum", render: (r) => fmtDate(r.datum) },
            { key: "rokIsporuke", label: "Rok isporuke", render: (r) => fmtDate(r.rokIsporuke) },
            { key: "iznos", label: "Iznos", render: (r) => <span className="f-mono">{fmtCurDec(iznos(r))}</span> },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            { key: "print", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => otvoriPrintNarudzba(r)}>PDF</Btn> },
            { key: "primi", label: "", render: (r) => r.status !== "Primljeno" && r.stavke.length > 0 ? <Btn size="sm" icon={PackageCheck} onClick={() => primi(r)}>Primi robu</Btn> : null },
          ]}
        />
      )}

      {tab === "upiti" && (
        <EntityPage
          title="" data={db.upitiNabave} onAdd={openUpitAdd} onEdit={openUpitEdit} onDelete={(r) => setDel({ type: "upit", row: r })}
          addLabel="Novi upit" searchKeys={["broj"]}
          columns={[
            { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
            { key: "datum", label: "Datum", render: (r) => fmtDate(r.datum) },
            { key: "izradio", label: "Izradio", render: (r) => zaposlenikIme(r.izradioId) },
            { key: "stavke", label: "Stavki", render: (r) => <span className="f-mono">{r.stavke.length}</span> },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            { key: "pdf", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => otvoriPrintUpit(r)}>PDF upita</Btn> },
            { key: "ponude", label: "", render: (r) => <Btn size="sm" variant="primary" icon={FolderInput} onClick={() => setUpitDetalj(r)}>Ponude i odabir</Btn> },
          ]}
        />
      )}

      {modal === "edit" && (
        <Modal wide title={form.id ? `Narudžbenica ${form.broj}` : "Nova narudžbenica"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={save}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Dobavljač"><select className="select" value={form.dobavljacId} onChange={(e) => setForm({ ...form, dobavljacId: e.target.value })}>{db.dobavljaci.map((d) => <option key={d.id} value={d.id}>{d.naziv}</option>)}</select></Field>
            <Field label="Datum narudžbe"><input className="input" type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} /></Field>
            <Field label="Rok isporuke"><input className="input" type="date" value={form.rokIsporuke} onChange={(e) => setForm({ ...form, rokIsporuke: e.target.value })} /></Field>
          </div>
          <Field label="Status"><select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["Nacrt", "Poslano", "Djelomično primljeno", "Primljeno"].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Stavke narudžbe">
            <LineItemsEditor mode="materijal" rows={form.stavke} setRows={(rows) => setForm({ ...form, stavke: rows })} materijali={db.materijali} katalog={db.katalogProfila} onCreateMaterijal={(entry) => kreirajMaterijalIzKataloga(entry, db, update)} />
          </Field>
          <Field label="Napomena"><textarea className="textarea" rows={2} value={form.napomena} onChange={(e) => setForm({ ...form, napomena: e.target.value })} /></Field>
        </Modal>
      )}

      {modal === "upit" && (
        <Modal wide title={upitForm.id ? `Upit ${upitForm.broj}` : "Novi upit za nabavu materijala"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={saveUpit}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Broj"><input className="input f-mono" value={upitForm.broj} onChange={(e) => setUpitForm({ ...upitForm, broj: e.target.value })} /></Field>
            <Field label="Datum"><input className="input" type="date" value={upitForm.datum} onChange={(e) => setUpitForm({ ...upitForm, datum: e.target.value })} /></Field>
            <Field label="Izradio"><select className="select" value={upitForm.izradioId} onChange={(e) => setUpitForm({ ...upitForm, izradioId: e.target.value })}>{[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((z) => <option key={z.id} value={z.id}>{z.ime} {z.prezime}</option>)}</select></Field>
          </div>
          <Field label="Status"><select className="select" style={{ maxWidth: 220 }} value={upitForm.status} onChange={(e) => setUpitForm({ ...upitForm, status: e.target.value })}>{["Priprema", "Poslan", "Zaprimanje ponuda", "Zatvoreno"].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Potreban materijal"><UpitStavkeEditor stavke={upitForm.stavke} setStavke={(rows) => setUpitForm({ ...upitForm, stavke: rows })} /></Field>
          <Field label="Napomena"><textarea className="textarea" rows={2} value={upitForm.napomena} onChange={(e) => setUpitForm({ ...upitForm, napomena: e.target.value })} /></Field>
        </Modal>
      )}

      {del && (
        <ConfirmDelete
          label={del.type === "upit" ? del.row.broj : del.broj}
          onCancel={() => setDel(null)}
          onConfirm={() => {
            if (del?.type === "upit") update("upitiNabave", db.upitiNabave.filter((u) => u.id !== del.row.id));
            else update("narudzbenice", db.narudzbenice.filter((n) => n.id !== del.id));
            setDel(null);
            showToast("Stavka obrisana.");
          }}
        />
      )}

      {postavkeOpen && <PostavkeTvrtkeModal postavke={db.postavkeTvrtke} onSave={savePostavke} onClose={() => setPostavkeOpen(false)} />}
      {upitDetalj && <UpitDetaljModal upit={db.upitiNabave.find((u) => u.id === upitDetalj.id) || upitDetalj} db={db} update={update} showToast={showToast} onClose={() => setUpitDetalj(null)} />}
      {printDoc && <DokumentNabavePrintModal {...printDoc} postavkeTvrtke={db.postavkeTvrtke} onClose={() => setPrintDoc(null)} />}
    </div>
  );
}

/* ============================== PROIZVODNJA ============================== */
const FAZE = [...OPERACIJE.map((o) => o.label), "Montaža (teren)", "Kontrola kvalitete", "Ostalo"];

/* ============================== GANTOGRAM ============================== */
const GANTT_BOJA = { muted: "#9aa1a8", info: "#2E5E7A", warning: "#C68A1A", success: "#256B45", danger: "#B8442C" };

const mjeseciSegmenti = (minDate, maxDate, totalDays) => {
  const segs = [];
  let cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  let guard = 0;
  while (cur <= maxDate && guard < 60) {
    guard++;
    const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const segStart = cur < minDate ? minDate : cur;
    const segEnd = nextMonth < maxDate ? nextMonth : maxDate;
    const startOffset = Math.max(0, (segStart - minDate) / 86400000);
    const widthDays = Math.max(0, (segEnd - segStart) / 86400000);
    segs.push({ key: `${cur.getFullYear()}-${cur.getMonth()}`, label: cur.toLocaleDateString("hr-HR", { month: "short", year: "numeric" }), leftPct: (startOffset / totalDays) * 100, widthPct: (widthDays / totalDays) * 100 });
    cur = nextMonth;
  }
  return segs;
};

/* ============================== PLANER PROIZVODNJE (dinamičko raspoređivanje) ============================== */
// Topološki poredak radnih naloga prema ovisnostima (ovisiONalogId), uz očuvanje izvornog redoslijeda gdje ovisnosti ne postoje
const topoloskiPoredakNaloga = (nalozi) => {
  const obradjeno = new Set();
  const rezultat = [];
  let guard = 0;
  while (rezultat.length < nalozi.length && guard < nalozi.length * 2 + 5) {
    guard++;
    for (const n of nalozi) {
      if (obradjeno.has(n.id)) continue;
      const ovisiO = n.ovisiONalogId;
      const ovisnostJosNijeGotova = ovisiO && nalozi.some((x) => x.id === ovisiO) && !obradjeno.has(ovisiO);
      if (!ovisnostJosNijeGotova) { rezultat.push(n); obradjeno.add(n.id); }
    }
  }
  nalozi.forEach((n) => { if (!obradjeno.has(n.id)) rezultat.push(n); });
  return rezultat;
};

// Broj aktivnih zaposlenika kompetentnih za određenu fazu/radni centar
const kompetentnihZaFazu = (zaposlenici, faza) => zaposlenici.filter((z) => z.status === "Aktivan" && (z.kompetencije || []).includes(faza)).length;

const kapacitetCentraSati = (kapaciteti, radniCentri, nazivCentra, datum) => {
  const override = kapaciteti.find((k) => k.stroj === nazivCentra && k.datum === datum);
  if (override) return Number(override.sati) || 0;
  const dan = new Date(datum).getDay();
  if (dan === 0 || dan === 6) return 0;
  const centar = radniCentri.find((c) => c.naziv === nazivCentra);
  return centar ? Number(centar.kapacitetSatiPoDanu) || 0 : 8;
};

// Glavni planer: raspoređuje SVE nezavršene radne naloge poštujući (1) redoslijed unutar radnog centra, (2) ovisnosti o drugim nalozima, (3) dnevni kapacitet centra.
// Vraća mapu {nalogId: {pocetak, zavrsetak}} s izračunatim (dinamičkim) datumima - vrijedi "uživo", preračunava se iz trenutnog stanja.
const izracunajRasporedProizvodnje = (radniNalozi, radniCentri, kapaciteti) => {
  const aktivni = radniNalozi.filter((n) => n.status !== "Završen" && Math.max(0, (Number(n.planiranoSati) || 0) - (Number(n.utrosenoSati) || 0)) > 0);
  const poredak = topoloskiPoredakNaloga(aktivni);
  const cursori = {};
  const rezultati = {};

  poredak.forEach((n) => {
    const preostaloUkupno = Math.max(0, (Number(n.planiranoSati) || 0) - (Number(n.utrosenoSati) || 0));
    let najranije = todayISO();
    if (n.ovisiONalogId && rezultati[n.ovisiONalogId]) najranije = addDays(rezultati[n.ovisiONalogId].zavrsetak, 1);

    if (!cursori[n.faza]) cursori[n.faza] = { datum: todayISO(), preostalo: kapacitetCentraSati(kapaciteti, radniCentri, n.faza, todayISO()) };
    const cur = cursori[n.faza];
    if (cur.datum < najranije) { cur.datum = najranije; cur.preostalo = kapacitetCentraSati(kapaciteti, radniCentri, n.faza, cur.datum); }
    let guard = 0;
    while (cur.preostalo <= 0 && guard < 400) { cur.datum = addDays(cur.datum, 1); cur.preostalo = kapacitetCentraSati(kapaciteti, radniCentri, n.faza, cur.datum); guard++; }

    const pocetak = cur.datum;
    let preostalo = preostaloUkupno;
    let zadnji = cur.datum;
    let guard2 = 0;
    while (preostalo > 0 && guard2 < 3000) {
      guard2++;
      if (cur.preostalo <= 0) { cur.datum = addDays(cur.datum, 1); cur.preostalo = kapacitetCentraSati(kapaciteti, radniCentri, n.faza, cur.datum); continue; }
      const trosi = Math.min(preostalo, cur.preostalo);
      cur.preostalo -= trosi;
      preostalo -= trosi;
      zadnji = cur.datum;
    }
    rezultati[n.id] = { pocetak, zavrsetak: zadnji };
  });
  return rezultati;
};

function RadniCentriModal({ db, update, showToast, onClose }) {
  const [centarZaKapacitet, setCentarZaKapacitet] = useState(db.radniCentri[0]?.naziv || "");
  const [kapForm, setKapForm] = useState({ datum: addDays(todayISO(), 1), sati: 0 });
  const [satiPoOsobi, setSatiPoOsobi] = useState(8);

  const azurirajDefault = (id, vrijednost) => update("radniCentri", db.radniCentri.map((c) => (c.id === id ? { ...c, kapacitetSatiPoDanu: Number(vrijednost) || 0 } : c)));
  const izracunajIzKompetencija = (c) => azurirajDefault(c.id, kompetentnihZaFazu(db.zaposlenici, c.naziv) * Number(satiPoOsobi || 0));
  const izracunajSveIzKompetencija = () => update("radniCentri", db.radniCentri.map((c) => ({ ...c, kapacitetSatiPoDanu: kompetentnihZaFazu(db.zaposlenici, c.naziv) * Number(satiPoOsobi || 0) })));
  const iznimkeZaCentar = [...db.kapacitetiDana].filter((k) => k.stroj === centarZaKapacitet).sort((a, b) => a.datum.localeCompare(b.datum));
  const dodajIznimku = () => {
    if (!kapForm.datum) return;
    const bezPostojece = db.kapacitetiDana.filter((k) => !(k.stroj === centarZaKapacitet && k.datum === kapForm.datum));
    update("kapacitetiDana", [...bezPostojece, { id: uid("kap"), stroj: centarZaKapacitet, datum: kapForm.datum, sati: Number(kapForm.sati) || 0 }]);
    showToast("Iznimka kapaciteta postavljena.");
  };
  const obrisiIznimku = (id) => update("kapacitetiDana", db.kapacitetiDana.filter((k) => k.id !== id));

  return (
    <Modal wide title="Kapaciteti radnih centara" onClose={onClose} footer={<Btn onClick={onClose}>Zatvori</Btn>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 10 }}>Standardni broj sati rada po danu za svaki radni centar (koristi se u automatskom rasporedu proizvodnje). Vikendi su uvijek 0h osim ako postaviš iznimku.</p>
      <div className="card" style={{ padding: 10, marginBottom: 12, background: "var(--surface-alt)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5 }}>Sati po kompetentnoj osobi dnevno:</span>
        <input className="input f-mono" type="number" min="0" step="0.5" style={{ width: 70 }} value={satiPoOsobi} onChange={(e) => setSatiPoOsobi(e.target.value)} />
        <Btn variant="ghost" size="sm" onClick={izracunajSveIzKompetencija}>Izračunaj sve prema kompetencijama zaposlenika</Btn>
      </div>
      <table className="erp-table" style={{ marginBottom: 20 }}>
        <thead><tr><th>Radni centar</th><th style={{ width: 110 }}>Kompetentnih</th><th style={{ width: 140 }}>Sati/dan (standard)</th><th style={{ width: 60 }}></th></tr></thead>
        <tbody>
          {db.radniCentri.map((c) => {
            const kompetentnih = kompetentnihZaFazu(db.zaposlenici, c.naziv);
            return (
              <tr key={c.id}>
                <td>{c.naziv}</td>
                <td className="f-mono" style={{ color: kompetentnih === 0 ? "var(--rust)" : "inherit" }}>{kompetentnih}</td>
                <td><input className="input f-mono" type="number" min="0" step="0.5" value={c.kapacitetSatiPoDanu} onChange={(e) => azurirajDefault(c.id, e.target.value)} /></td>
                <td><button className="btn btn-icon btn-ghost" title="Izračunaj iz kompetencija" onClick={() => izracunajIzKompetencija(c)}><UserCog size={14} /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="label" style={{ marginBottom: 8 }}>Iznimke po datumu (produženo radno vrijeme, druga smjena, godišnji…)</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <select className="select" style={{ maxWidth: 220 }} value={centarZaKapacitet} onChange={(e) => setCentarZaKapacitet(e.target.value)}>{db.radniCentri.map((c) => <option key={c.id} value={c.naziv}>{c.naziv}</option>)}</select>
        <input className="input" type="date" style={{ maxWidth: 160 }} value={kapForm.datum} onChange={(e) => setKapForm({ ...kapForm, datum: e.target.value })} />
        <input className="input f-mono" type="number" min="0" style={{ width: 80 }} value={kapForm.sati} onChange={(e) => setKapForm({ ...kapForm, sati: e.target.value })} />
        <Btn variant="ghost" size="sm" onClick={dodajIznimku}>Postavi</Btn>
      </div>
      {iznimkeZaCentar.length === 0 ? <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>Nema iznimki za {centarZaKapacitet}.</div> : (
        iznimkeZaCentar.map((k) => (
          <div key={k.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
            <span>{fmtDate(k.datum)} — <strong className="f-mono">{k.sati}h</strong></span>
            <button className="btn btn-icon btn-ghost" onClick={() => obrisiIznimku(k.id)}><X size={13} /></button>
          </div>
        ))
      )}
    </Modal>
  );
}

// Ponedjeljak tjedna u kojem se nalazi zadani datum
const pocetakTjedna = (datumISO) => {
  const d = new Date(datumISO);
  const dan = d.getDay();
  const offset = dan === 0 ? -6 : 1 - dan;
  return addDays(datumISO, offset);
};
const oznakaTjedna = (pocetak) => `${datumKratica(pocetak)}–${datumKratica(addDays(pocetak, 6))}`;

// Tjedno opterećenje po radnom centru (fazi): kapacitet = zbroj dnevnih kapaciteta centra kroz tjedan;
// potražnja = preostali sati nedovršenih naloga te faze, raspoređeni po danima unutar NJIHOVOG izračunatog rasporeda (raspored), pa zbrojeni po tjednu.
const izracunajTjednoOpterecenje = (radniNalozi, radniCentri, kapaciteti, raspored, brojTjedana = 8) => {
  const prviTjedan = pocetakTjedna(todayISO());
  const tjedni = Array.from({ length: brojTjedana }, (_, i) => addDays(prviTjedan, i * 7));
  const zadnjiTjedanDo = addDays(tjedni[tjedni.length - 1], 6);

  const potraznjaPoFaziTjednu = {}; // { faza: { tjedanPocetak: sati } }
  radniNalozi.filter((n) => n.status !== "Završen").forEach((n) => {
    const d = raspored[n.id];
    if (!d) return;
    const preostalo = Math.max(0, (Number(n.planiranoSati) || 0) - (Number(n.utrosenoSati) || 0));
    if (preostalo <= 0) return;
    const brojDana = Math.max(1, Math.round((new Date(d.zavrsetak) - new Date(d.pocetak)) / 86400000) + 1);
    const satiPoDanu = preostalo / brojDana;
    if (!potraznjaPoFaziTjednu[n.faza]) potraznjaPoFaziTjednu[n.faza] = {};
    for (let i = 0; i < brojDana; i++) {
      const dan = addDays(d.pocetak, i);
      if (dan > zadnjiTjedanDo) continue;
      const tjedan = pocetakTjedna(dan);
      potraznjaPoFaziTjednu[n.faza][tjedan] = (potraznjaPoFaziTjednu[n.faza][tjedan] || 0) + satiPoDanu;
    }
  });

  const redovi = radniCentri.map((c) => {
    const poTjednu = tjedni.map((tjedanPocetak) => {
      let kapacitet = 0;
      for (let i = 0; i < 7; i++) kapacitet += kapacitetCentraSati(kapaciteti, radniCentri, c.naziv, addDays(tjedanPocetak, i));
      const sati = (potraznjaPoFaziTjednu[c.naziv]?.[tjedanPocetak]) || 0;
      const postotak = kapacitet > 0 ? Math.round((sati / kapacitet) * 100) : (sati > 0 ? 999 : 0);
      return { tjedanPocetak, sati, kapacitet, postotak };
    });
    return { centar: c, poTjednu };
  });

  return { tjedni, redovi };
};

function TjednoOpterecenjeView({ db, raspored }) {
  const { tjedni, redovi } = useMemo(() => izracunajTjednoOpterecenje(db.radniNalozi, db.radniCentri, db.kapacitetiDana, raspored, 8), [db.radniNalozi, db.radniCentri, db.kapacitetiDana, raspored]);

  const bojaZaPostotak = (p) => {
    if (p === 0) return "var(--ink-faint)";
    if (p > 100) return "var(--rust)";
    if (p >= 80) return "#C68A1A";
    return "var(--green)";
  };

  return (
    <div className="card" style={{ marginTop: 16, overflowX: "auto", padding: 0 }}>
      <div style={{ padding: "12px 16px 4px" }}>
        <h3 className="f-display" style={{ fontSize: 15, fontWeight: 600 }}>Opterećenje kapaciteta po fazama (tjedno)</h3>
        <p style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>Kapacitet dolazi iz postavki radnih centara (Kapaciteti radnih centara); potražnja iz preostalih sati nedovršenih radnih naloga raspoređenih prema gantogramu iznad.</p>
      </div>
      <div style={{ minWidth: 760, padding: "8px 16px 16px" }}>
        <table className="erp-table">
          <thead>
            <tr>
              <th style={{ minWidth: 170 }}>Faza</th>
              {tjedni.map((t) => <th key={t} style={{ textAlign: "center" }}>{oznakaTjedna(t)}</th>)}
            </tr>
          </thead>
          <tbody>
            {redovi.map((r) => (
              <tr key={r.centar.id}>
                <td style={{ fontWeight: 600 }}>{r.centar.naziv}</td>
                {r.poTjednu.map((cell) => (
                  <td key={cell.tjedanPocetak} style={{ textAlign: "center" }}>
                    {cell.sati === 0 ? <span style={{ color: "var(--ink-faint)" }}>—</span> : (
                      <span className="f-mono" style={{ color: bojaZaPostotak(cell.postotak), fontWeight: cell.postotak > 100 ? 700 : 400 }}>
                        {Math.round(cell.sati)}/{Math.round(cell.kapacitet)}h ({cell.postotak > 100 ? ">100" : cell.postotak}%)
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 14, padding: "8px 16px 12px", fontSize: 11, color: "var(--ink-soft)", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "var(--green)", borderRadius: 2, display: "inline-block" }} />Do 80%</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "#C68A1A", borderRadius: 2, display: "inline-block" }} />80–100%</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: "var(--rust)", borderRadius: 2, display: "inline-block" }} />Preko 100% (uska grla)</span>
      </div>
    </div>
  );
}

function PlanProizvodnjeView({ db, update, showToast }) {
  const [grupiranje, setGrupiranje] = useState("projekt");
  const [centriOpen, setCentriOpen] = useState(false);

  const raspored = useMemo(() => izracunajRasporedProizvodnje(db.radniNalozi, db.radniCentri, db.kapacitetiDana), [db.radniNalozi, db.radniCentri, db.kapacitetiDana]);
  const datumPrikaza = (n) => raspored[n.id] || (n.datumPocetka && n.datumZavrsetka ? { pocetak: n.datumPocetka, zavrsetak: n.datumZavrsetka } : null);

  const svi = db.radniNalozi.filter((n) => datumPrikaza(n));
  if (svi.length === 0) return <EmptyState text="Nema radnih naloga s rokovima za prikaz." />;

  const svidatumi = svi.flatMap((n) => { const d = datumPrikaza(n); return [new Date(d.pocetak), new Date(d.zavrsetak)]; });
  const minDate = new Date(Math.min(...svidatumi.map((d) => d.getTime())) - 2 * 86400000);
  const maxDate = new Date(Math.max(...svidatumi.map((d) => d.getTime())) + 2 * 86400000);
  const totalDays = Math.max(1, (maxDate - minDate) / 86400000);
  const segs = mjeseciSegmenti(minDate, maxDate, totalDays);
  const todayOffset = ((new Date(todayISO()) - minDate) / 86400000 / totalDays) * 100;
  const LABEL_W = 230;

  // --- Upozorenja ---
  const projektiURiziku = db.projekti.filter((p) => !["Završen", "Otkazan"].includes(p.status)).map((p) => {
    const naloziProjekta = svi.filter((n) => n.projektId === p.id);
    if (naloziProjekta.length === 0) return null;
    const zadnji = naloziProjekta.reduce((max, n) => { const d = datumPrikaza(n).zavrsetak; return d > max ? d : max; }, "0000-00-00");
    return zadnji > p.rokZavrsetka ? { projekt: p, procjena: zadnji } : null;
  }).filter(Boolean);

  const kasneciNalozi = db.radniNalozi.filter((n) => n.status !== "Završen" && n.datumZavrsetka && n.datumZavrsetka < todayISO());

  const centarOpterecenje = db.radniCentri.map((c) => {
    const preostaliSati = svi.filter((n) => n.faza === c.naziv).reduce((s, n) => s + Math.max(0, (Number(n.planiranoSati) || 0) - (Number(n.utrosenoSati) || 0)), 0);
    const danaBacklog = c.kapacitetSatiPoDanu > 0 ? preostaliSati / c.kapacitetSatiPoDanu : 0;
    return { centar: c, preostaliSati, danaBacklog };
  }).filter((x) => x.danaBacklog > 20);

  const pomakniNalog = (nalogId, faza, smjer) => {
    const svi2 = [...db.radniNalozi];
    const indeksiCentra = svi2.map((n, i) => ({ n, i })).filter((x) => x.n.faza === faza).map((x) => x.i);
    const trenutniIdx = indeksiCentra.findIndex((i) => svi2[i].id === nalogId);
    const noviIdx = trenutniIdx + smjer;
    if (noviIdx < 0 || noviIdx >= indeksiCentra.length) return;
    const iA = indeksiCentra[trenutniIdx], iB = indeksiCentra[noviIdx];
    [svi2[iA], svi2[iB]] = [svi2[iB], svi2[iA]];
    update("radniNalozi", svi2);
  };

  const projNaziv = (id) => { const p = db.projekti.find((x) => x.id === id); return p ? `${p.sifra} — ${p.naziv}` : "—"; };

  let grupe;
  if (grupiranje === "projekt") {
    grupe = db.projekti
      .map((p) => ({ naslov: `${p.sifra} — ${p.naziv}`, kljuc: p.id, nalozi: svi.filter((n) => n.projektId === p.id) }))
      .filter((g) => g.nalozi.length > 0)
      .sort((a, b) => new Date(datumPrikaza(a.nalozi[0]).pocetak) - new Date(datumPrikaza(b.nalozi[0]).pocetak));
  } else {
    grupe = db.radniCentri
      .map((c) => ({ naslov: c.naziv, kljuc: c.naziv, nalozi: svi.filter((n) => n.faza === c.naziv), moguceReordati: true }))
      .filter((g) => g.nalozi.length > 0);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant={grupiranje === "projekt" ? "primary" : "ghost"} size="sm" onClick={() => setGrupiranje("projekt")}>Po projektu</Btn>
          <Btn variant={grupiranje === "centar" ? "primary" : "ghost"} size="sm" onClick={() => setGrupiranje("centar")}>Po radnom centru</Btn>
        </div>
        <Btn variant="ghost" size="sm" icon={Settings} onClick={() => setCentriOpen(true)}>Kapaciteti radnih centara</Btn>
      </div>

      {(projektiURiziku.length > 0 || kasneciNalozi.length > 0 || centarOpterecenje.length > 0) && (
        <div className="card" style={{ padding: 14, marginBottom: 16, borderColor: "#F0C2B5" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <AlertTriangle size={15} color="var(--rust)" /><strong className="f-display" style={{ fontWeight: 600 }}>Upozorenja</strong>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, fontSize: 12.5 }}>
            {projektiURiziku.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Rizik kašnjenja roka ({projektiURiziku.length})</div>
                {projektiURiziku.map((r) => <div key={r.projekt.id} style={{ color: "var(--ink-soft)" }}>{r.projekt.sifra} — procjena {fmtDate(r.procjena)} <span style={{ color: "var(--rust)" }}>(rok {fmtDate(r.projekt.rokZavrsetka)})</span></div>)}
              </div>
            )}
            {kasneciNalozi.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Kasne radni nalozi ({kasneciNalozi.length})</div>
                {kasneciNalozi.slice(0, 5).map((n) => <div key={n.id} style={{ color: "var(--ink-soft)" }}>{n.broj} — {n.faza} <span style={{ color: "var(--rust)" }}>(rok bio {fmtDate(n.datumZavrsetka)})</span></div>)}
              </div>
            )}
            {centarOpterecenje.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Preopterećeni centri ({centarOpterecenje.length})</div>
                {centarOpterecenje.map((c) => <div key={c.centar.id} style={{ color: "var(--ink-soft)" }}>{c.centar.naziv} — red čekanja ~{Math.round(c.danaBacklog)} radnih dana</div>)}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <div style={{ minWidth: 900 }}>
          <div style={{ display: "flex", borderBottom: "2px solid var(--line-strong)", background: "var(--surface-alt)" }}>
            <div style={{ width: LABEL_W, flexShrink: 0, padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{grupiranje === "projekt" ? "Radni nalog" : "Nalog (svi projekti)"}</div>
            <div style={{ flex: 1, position: "relative", height: 32 }}>
              {segs.map((s) => <div key={s.key} style={{ position: "absolute", left: `${s.leftPct}%`, width: `${s.widthPct}%`, height: "100%", borderLeft: "1px solid var(--line)", fontSize: 10.5, color: "var(--ink-faint)", padding: "8px 0 0 4px", boxSizing: "border-box" }}>{s.label}</div>)}
            </div>
          </div>

          <div style={{ position: "relative" }}>
            {todayOffset >= 0 && todayOffset <= 100 && <div style={{ position: "absolute", left: `calc(${LABEL_W}px + ${todayOffset}% * (100% - ${LABEL_W}px) / 100%)`, top: 0, bottom: 0, width: 2, background: "var(--rust)", zIndex: 2 }} title="Danas" />}
            {grupe.map((g) => (
              <div key={g.kljuc}>
                <div style={{ display: "flex", background: "var(--surface-alt)", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ width: LABEL_W, flexShrink: 0, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>{g.naslov}</div>
                  <div style={{ flex: 1 }} />
                </div>
                {g.nalozi.map((n) => {
                  const d = datumPrikaza(n);
                  const leftPct = Math.max(0, ((new Date(d.pocetak) - minDate) / 86400000 / totalDays) * 100);
                  const rawWidthDays = Math.max(1, (new Date(d.zavrsetak) - new Date(d.pocetak)) / 86400000 + 1);
                  const widthPct = Math.max(1.5, (rawWidthDays / totalDays) * 100);
                  const boja = GANTT_BOJA[STATUS_TONE[n.status] || "muted"];
                  const napredak = n.planiranoSati > 0 ? Math.min(100, Math.round((n.utrosenoSati / n.planiranoSati) * 100)) : 0;
                  const ovisi = n.ovisiONalogId ? db.radniNalozi.find((x) => x.id === n.ovisiONalogId) : null;
                  return (
                    <div key={n.id} style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
                      <div style={{ width: LABEL_W, flexShrink: 0, padding: "8px 12px", fontSize: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontWeight: 600 }}>{grupiranje === "projekt" ? n.faza : n.broj}</span>
                          {grupiranje === "centar" && (
                            <span style={{ display: "flex", marginLeft: "auto", gap: 1 }}>
                              <button className="btn btn-icon btn-ghost" style={{ padding: 2 }} onClick={() => pomakniNalog(n.id, n.faza, -1)}><ChevronUp size={12} /></button>
                              <button className="btn btn-icon btn-ghost" style={{ padding: 2 }} onClick={() => pomakniNalog(n.id, n.faza, 1)}><ChevronDown size={12} /></button>
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{grupiranje === "projekt" ? n.broj : projNaziv(n.projektId)} · {n.utrosenoSati}/{n.planiranoSati} h{ovisi && ` · nakon: ${ovisi.faza}`}</div>
                      </div>
                      <div style={{ flex: 1, position: "relative", height: 40 }}>
                        <div title={`${n.broj} · ${n.faza} (${fmtDate(d.pocetak)} – ${fmtDate(d.zavrsetak)}) · ${n.status}`} style={{ position: "absolute", left: `${leftPct}%`, width: `${widthPct}%`, top: 8, height: 22, background: boja, borderRadius: 2, opacity: 0.9, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${napredak}%`, background: "rgba(255,255,255,0.35)" }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, padding: "10px 12px", fontSize: 11, color: "var(--ink-soft)", borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
          {Object.entries(GANTT_BOJA).map(([tone, boja]) => (
            <span key={tone} style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, background: boja, borderRadius: 2, display: "inline-block" }} />{{ muted: "Planirano", info: "Poslano/odobreno", warning: "U tijeku", success: "Završeno", danger: "Pauzirano/kasni" }[tone]}</span>
          ))}
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 2, height: 10, background: "var(--rust)", display: "inline-block" }} />Danas</span>
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8 }}>Datumi za nezavršene naloge računaju se automatski (red čekanja centra + kapacitet + ovisnosti) i mijenjaju se čim promijeniš redoslijed, sate ili status. Završeni nalozi prikazuju stvarne (ranije upisane) datume.</p>

      <TjednoOpterecenjeView db={db} raspored={raspored} />

      {centriOpen && <RadniCentriModal db={db} update={update} showToast={showToast} onClose={() => setCentriOpen(false)} />}
    </div>
  );
}

/* ============================== PLAN REZANJA (LASER) ============================== */
const REZANJE_STATUSI = ["Na čekanju", "U tijeku", "Pauzirano", "Završeno"];
const REZANJE_BOJA = { "Na čekanju": "#F0883E", "U tijeku": "#3B6EE0", "Pauzirano": "#9AA1A8", "Završeno": "#22A05E" };
const DAN_KRATICA = ["ned", "pon", "uto", "sri", "čet", "pet", "sub"];
const STANDARD_MIN_PO_DANU = 8 * 60; // standard 8h radnog vremena

const fmtMin = (min) => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)}h ${m % 60}min`;
};
const datumKratica = (iso) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`; };

// Kapacitet dana u MINUTAMA: standard 8h (480min) radnim danom, 0 vikendom, ili ručna iznimka (uneseno u satima)
const kapacitetZaDanMin = (kapaciteti, stroj, datum) => {
  const override = kapaciteti.find((k) => k.stroj === stroj && k.datum === datum);
  if (override) return Math.round(Number(override.sati) * 60);
  const dan = new Date(datum).getDay();
  if (dan === 0 || dan === 6) return 0;
  return STANDARD_MIN_PO_DANU;
};

// Raspoređuje NEZAVRŠENE programe (redom) u dane dok se ne popuni kapacitet, pa prelazi u sljedeći dan
const rasporediProgramRezanja = (programi, kapaciteti, stroj) => {
  const listaZaStroj = programi.filter((p) => p.stroj === stroj && p.status !== "Završeno");
  if (listaZaStroj.length === 0) return [];
  let datum = todayISO();
  let kap = kapacitetZaDanMin(kapaciteti, stroj, datum);
  let guard = 0;
  while (kap <= 0 && guard < 90) { datum = addDays(datum, 1); kap = kapacitetZaDanMin(kapaciteti, stroj, datum); guard++; }
  const dani = [];
  let trenutni = { datum, kapacitetMin: kap, stavke: [], iskoristenoMin: 0 };
  listaZaStroj.forEach((p) => {
    const trajanje = Number(p.trajanjeMin) || 0;
    if (trenutni.stavke.length > 0 && trenutni.iskoristenoMin + trajanje > trenutni.kapacitetMin) {
      dani.push(trenutni);
      let sljedeci = addDays(trenutni.datum, 1);
      let k2 = kapacitetZaDanMin(kapaciteti, stroj, sljedeci);
      let g2 = 0;
      while (k2 <= 0 && g2 < 90) { sljedeci = addDays(sljedeci, 1); k2 = kapacitetZaDanMin(kapaciteti, stroj, sljedeci); g2++; }
      trenutni = { datum: sljedeci, kapacitetMin: k2, stavke: [], iskoristenoMin: 0 };
    }
    trenutni.stavke.push(p);
    trenutni.iskoristenoMin += trajanje;
  });
  dani.push(trenutni);
  return dani;
};

function PlanRezanjaView({ db, update, showToast }) {
  const [stroj, setStroj] = useState("laserProfili");
  const emptyForm = () => ({ brojPrograma: "", trajanjeMin: 60, radniNalogId: "", napomena: "", status: "Na čekanju" });
  const [form, setForm] = useState(emptyForm());
  const [kapForm, setKapForm] = useState({ datum: addDays(todayISO(), 1), sati: 12 });

  const programiZaStroj = db.programiRezanja.filter((p) => p.stroj === stroj);
  const nezavrseni = programiZaStroj.filter((p) => p.status !== "Završeno");
  const zavrseni = programiZaStroj.filter((p) => p.status === "Završeno");
  const dani = rasporediProgramRezanja(db.programiRezanja, db.kapacitetiDana, stroj);
  const kapacitetiZaStroj = [...db.kapacitetiDana].filter((k) => k.stroj === stroj).sort((a, b) => a.datum.localeCompare(b.datum));

  const ukupnoVrijemeMin = nezavrseni.reduce((s, p) => s + (Number(p.trajanjeMin) || 0), 0);
  const zavrsenoVrijemeMin = zavrseni.reduce((s, p) => s + (Number(p.trajanjeMin) || 0), 0);
  const potrebnoDana = Math.ceil(ukupnoVrijemeMin / STANDARD_MIN_PO_DANU) || 0;
  const ukupnoKapacitetMin = dani.reduce((s, d) => s + d.kapacitetMin, 0);
  const ukupnoIskoristenoMin = dani.reduce((s, d) => s + d.iskoristenoMin, 0);
  const postotakPopunjenosti = ukupnoKapacitetMin > 0 ? Math.min(100, Math.round((ukupnoIskoristenoMin / ukupnoKapacitetMin) * 100)) : 0;

  // Raspon dana za prikaz gantograma (min. 3 tjedna, produljuje se ako je reda čekanja duži)
  const poDatumu = Object.fromEntries(dani.map((d) => [d.datum, d]));
  let krajPrikaza = addDays(todayISO(), 20);
  if (dani.length) { const zadnji = dani[dani.length - 1].datum; if (zadnji > krajPrikaza) krajPrikaza = addDays(zadnji, 2); }
  const nizDana = [];
  for (let d = todayISO(); d <= krajPrikaza; d = addDays(d, 1)) nizDana.push(d);

  const dodajProgram = () => {
    if (!form.brojPrograma.trim()) return;
    update("programiRezanja", [...db.programiRezanja, { id: uid("pr"), stroj, brojPrograma: form.brojPrograma.trim(), trajanjeMin: Number(form.trajanjeMin) || 0, radniNalogId: form.radniNalogId, napomena: form.napomena, status: form.status }]);
    setForm(emptyForm());
    showToast("Program rezanja dodan u red čekanja.");
  };
  const obrisiProgram = (id) => update("programiRezanja", db.programiRezanja.filter((p) => p.id !== id));
  const postaviStatus = (id, status) => update("programiRezanja", db.programiRezanja.map((p) => (p.id === id ? { ...p, status } : p)));
  const pomakni = (id, smjer) => {
    const svi = [...db.programiRezanja];
    const indeksiStroj = svi.map((p, i) => ({ p, i })).filter((x) => x.p.stroj === stroj).map((x) => x.i);
    const trenutniIdx = indeksiStroj.findIndex((i) => svi[i].id === id);
    const noviIdx = trenutniIdx + smjer;
    if (noviIdx < 0 || noviIdx >= indeksiStroj.length) return;
    const iA = indeksiStroj[trenutniIdx], iB = indeksiStroj[noviIdx];
    [svi[iA], svi[iB]] = [svi[iB], svi[iA]];
    update("programiRezanja", svi);
  };
  const dodajKapacitet = () => {
    if (!kapForm.datum) return;
    const bezPostojeceg = db.kapacitetiDana.filter((k) => !(k.stroj === stroj && k.datum === kapForm.datum));
    update("kapacitetiDana", [...bezPostojeceg, { id: uid("kap"), stroj, datum: kapForm.datum, sati: Number(kapForm.sati) || 0 }]);
    showToast("Kapacitet dana postavljen.");
  };
  const obrisiKapacitet = (id) => update("kapacitetiDana", db.kapacitetiDana.filter((k) => k.id !== id));
  const radniNalogLabel = (id) => {
    const rn = db.radniNalozi.find((r) => r.id === id);
    if (!rn) return "—";
    const proj = db.projekti.find((p) => p.id === rn.projektId);
    return `${rn.broj} — ${proj?.sifra || ""} ${rn.faza}`;
  };

  const KpiCard = ({ label, value, sub }) => (
    <div className="kpi-card">
      <div className="kpi-label" style={{ marginTop: 0, marginBottom: 6, textTransform: "none", fontSize: 12.5 }}>{label}</div>
      <div className="kpi-num" style={{ fontSize: 24 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 3 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <Btn variant={stroj === "laserProfili" ? "primary" : "ghost"} onClick={() => setStroj("laserProfili")}>Laser za profile</Btn>
        <Btn variant={stroj === "laserLimovi" ? "primary" : "ghost"} onClick={() => setStroj("laserLimovi")}>Laser za limove</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
        <KpiCard label="Ukupno nezavršenih" value={nezavrseni.length} sub="naloga" />
        <KpiCard label="Ukupno vrijeme" value={fmtMin(ukupnoVrijemeMin)} sub="za rezanje" />
        <KpiCard label="Potrebno dana" value={potrebnoDana} sub={`(${STANDARD_MIN_PO_DANU / 60}h/dan standard)`} />
        <KpiCard label="Završeno ukupno" value={zavrseni.length} sub={fmtMin(zavrsenoVrijemeMin)} />
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
          <strong className="f-display" style={{ fontWeight: 600 }}>Ukupno opterećenje</strong>
          <span className="f-mono" style={{ color: "var(--ink-soft)" }}>{fmtMin(ukupnoIskoristenoMin)} / {fmtMin(ukupnoKapacitetMin)}</span>
        </div>
        <div style={{ height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${postotakPopunjenosti}%`, background: postotakPopunjenosti >= 100 ? "var(--rust)" : "var(--steel)" }} />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 6 }}>{postotakPopunjenosti}% popunjenosti za {dani.length} radnih dana</div>
      </div>

      <div className="card" style={{ padding: "10px 16px", marginBottom: 16, display: "flex", gap: 20, flexWrap: "wrap" }}>
        {REZANJE_STATUSI.map((s) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 2, background: REZANJE_BOJA[s], display: "inline-block" }} />{s}
          </span>
        ))}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 className="f-display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Gantogram — Redoslijed rezanja</h3>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", minWidth: nizDana.length * 72, borderTop: "1px solid var(--line)", borderLeft: "1px solid var(--line)" }}>
            {nizDana.map((datum) => {
              const dow = new Date(datum).getDay();
              const jeVikend = dow === 0 || dow === 6;
              const jeDanas = datum === todayISO();
              const dan = poDatumu[datum];
              const kapMin = dan ? dan.kapacitetMin : kapacitetZaDanMin(db.kapacitetiDana, stroj, datum);
              return (
                <div key={datum} style={{ width: 72, flexShrink: 0, borderRight: "1px solid var(--line)", background: jeDanas ? "var(--surface-alt)" : (jeVikend ? "#FBEAE6" : "transparent") }}>
                  <div style={{ textAlign: "center", padding: "6px 2px 1px", fontSize: 11, fontWeight: 600, color: jeVikend ? "var(--rust)" : "var(--ink-soft)" }}>{DAN_KRATICA[dow]}</div>
                  <div style={{ textAlign: "center", fontSize: 10.5, color: "var(--ink-faint)", marginBottom: 4 }}>{datumKratica(datum)}</div>
                  <div className="f-mono" style={{ textAlign: "center", fontSize: 11, fontWeight: 600, padding: "4px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", color: kapMin === 0 ? "var(--rust)" : "var(--ink)" }}>
                    {kapMin === 0 ? "✕" : `${(kapMin / 60).toFixed(kapMin % 60 === 0 ? 0 : 1)}h`}
                  </div>
                  <div style={{ minHeight: 90, padding: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                    {(dan?.stavke || []).map((p) => (
                      <div key={p.id} title={`${p.brojPrograma} — ${fmtMin(p.trajanjeMin)} · ${p.status}`} style={{ fontSize: 9.5, padding: "3px 4px", borderRadius: 2, background: REZANJE_BOJA[p.status], color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="f-mono">
                        {p.brojPrograma}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "flex-start" }} className="plan-rezanja-grid">
        <style>{`@media (max-width:900px){ .plan-rezanja-grid{ grid-template-columns:1fr !important; } }`}</style>

        <div>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 8 }}>Novi program rezanja</div>
            <Field label="Broj programa"><input className="input f-mono" value={form.brojPrograma} onChange={(e) => setForm({ ...form, brojPrograma: e.target.value })} placeholder="npr. LP-2607-04" /></Field>
            <Field label="Trajanje (minute)"><input className="input f-mono" type="number" min="0" step="5" value={form.trajanjeMin} onChange={(e) => setForm({ ...form, trajanjeMin: e.target.value })} /></Field>
            <Field label="Radni nalog">
              <select className="select" value={form.radniNalogId} onChange={(e) => setForm({ ...form, radniNalogId: e.target.value })}>
                <option value="">Odaberi radni nalog…</option>
                {db.radniNalozi.map((rn) => { const proj = db.projekti.find((p) => p.id === rn.projektId); return <option key={rn.id} value={rn.id}>{rn.broj} — {proj?.sifra} {rn.faza}</option>; })}
              </select>
            </Field>
            <Field label="Status"><select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{REZANJE_STATUSI.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Napomena"><input className="input" value={form.napomena} onChange={(e) => setForm({ ...form, napomena: e.target.value })} /></Field>
            <Btn variant="primary" icon={Plus} onClick={dodajProgram} style={{ width: "100%", justifyContent: "center" }}>Dodaj u red čekanja</Btn>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="label" style={{ marginBottom: 8 }}>Radno vrijeme po danu</div>
            <p style={{ fontSize: 11.5, color: "var(--ink-faint)", marginBottom: 10 }}>Standard je 8h radnim danom, 0h vikendom. Ovdje postavi iznimku (produženo radno vrijeme, druga smjena…) za pojedini datum.</p>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input className="input" type="date" value={kapForm.datum} onChange={(e) => setKapForm({ ...kapForm, datum: e.target.value })} />
              <input className="input f-mono" type="number" min="0" style={{ width: 70 }} value={kapForm.sati} onChange={(e) => setKapForm({ ...kapForm, sati: e.target.value })} />
              <Btn variant="ghost" size="sm" onClick={dodajKapacitet}>Postavi</Btn>
            </div>
            {kapacitetiZaStroj.length === 0 ? <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>Nema iznimki — koristi se standard (8h / 0h vikendom).</div> : (
              kapacitetiZaStroj.map((k) => (
                <div key={k.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
                  <span>{fmtDate(k.datum)} — <strong className="f-mono">{k.sati}h</strong></span>
                  <button className="btn btn-icon btn-ghost" onClick={() => obrisiKapacitet(k.id)}><X size={13} /></button>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="label" style={{ marginBottom: 8 }}>Popis programa (redoslijed rezanja)</div>
          {programiZaStroj.length === 0 ? <EmptyState text="Nema unesenih programa rezanja za ovaj stroj." /> : (
            <div className="card" style={{ overflowX: "auto" }}>
              <table className="erp-table">
                <thead><tr><th>Program</th><th>Radni nalog</th><th style={{ width: 90 }}>Trajanje</th><th>Napomena</th><th style={{ width: 130 }}>Status</th><th style={{ width: 100 }}></th></tr></thead>
                <tbody>
                  {programiZaStroj.map((p) => (
                    <tr key={p.id}>
                      <td className="f-mono">{p.brojPrograma}</td>
                      <td style={{ fontSize: 12.5 }}>{radniNalogLabel(p.radniNalogId)}</td>
                      <td className="f-mono">{fmtMin(p.trajanjeMin)}</td>
                      <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{p.napomena}</td>
                      <td>
                        <select className="select" style={{ fontSize: 12, padding: "4px 6px" }} value={p.status} onChange={(e) => postaviStatus(p.id, e.target.value)}>
                          {REZANJE_STATUSI.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 2 }}>
                          <button className="btn btn-icon btn-ghost" onClick={() => pomakni(p.id, -1)}><ChevronUp size={13} /></button>
                          <button className="btn btn-icon btn-ghost" onClick={() => pomakni(p.id, 1)}><ChevronDown size={13} /></button>
                          <button className="btn btn-icon btn-ghost" onClick={() => obrisiProgram(p.id)}><Trash2 size={13} color="var(--rust)" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== NARUDŽBA KUPCA / OTPREMNICE ============================== */
// "Narudžba" ovdje = narudžba KOJU ŠALJE KUPAC Econu (s dogovorenim cijenama po stavci), za
// razliku od postojećih "Narudžbenica" koje su Econova narudžba DOBAVLJAČU.
function NarudzbaModal({ narudzba, projekt, db, update, showToast, onClose }) {
  const emptyForm = () => ({ id: null, projektId: projekt.id, kupacId: projekt?.kupacId || db.kupci[0]?.id || "", broj: "", datum: todayISO(), napomena: "", stavke: [] });
  const [form, setForm] = useState(narudzba ? JSON.parse(JSON.stringify(narudzba)) : emptyForm());

  const dodajStavku = () => setForm({ ...form, stavke: [...form.stavke, { id: uid("nst"), sifra: "", naziv: "", jm: "Stk", kolicina: 0, masaJed: 0, nacinCijene: "rucno", cijenaKg: 0, cijena: 0 }] });
  // Cijena se ili upisuje ručno po komadu, ili se izvodi iz mase × €/kg (isti princip kao normativ) —
  // u drugom slučaju cijena se drži uvijek sinkroniziranom da otpremnica/podloga za fakturu rade nepromijenjeno.
  const azurirajStavku = (i, patch) => setForm({
    ...form,
    stavke: form.stavke.map((s, idx) => {
      if (idx !== i) return s;
      const novo = { ...s, ...patch };
      if ((novo.nacinCijene || "rucno") === "izMase") novo.cijena = (Number(novo.masaJed) || 0) * (Number(novo.cijenaKg) || 0);
      return novo;
    }),
  });
  const obrisiStavku = (i) => setForm({ ...form, stavke: form.stavke.filter((_, idx) => idx !== i) });

  const spremi = () => {
    if (!form.broj.trim()) { showToast("Unesi broj narudžbe kupca."); return; }
    const payload = { ...form, stavke: form.stavke.map((s) => ({ ...s, cijena: Number(s.cijena) || 0, cijenaKg: Number(s.cijenaKg) || 0 })) };
    if (form.id) update("narudzbe", db.narudzbe.map((n) => (n.id === form.id ? payload : n)));
    else update("narudzbe", [...db.narudzbe, { ...payload, id: uid("nar") }]);
    showToast("Narudžba spremljena.");
    onClose();
  };

  return (
    <Modal wide title={narudzba ? `Narudžba ${narudzba.broj}` : "Nova narudžba kupca"} onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi}>Spremi</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="Broj narudžbe kupca"><input className="input f-mono" value={form.broj} onChange={(e) => setForm({ ...form, broj: e.target.value })} placeholder="npr. E-BEST-2026-106" /></Field>
        <Field label="Datum narudžbe"><input className="input" type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} /></Field>
        <Field label="Kupac"><select className="select" value={form.kupacId} onChange={(e) => setForm({ ...form, kupacId: e.target.value })}>{db.kupci.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}</select></Field>
      </div>
      <Field label="Napomena"><input className="input" value={form.napomena} onChange={(e) => setForm({ ...form, napomena: e.target.value })} /></Field>

      <div className="label" style={{ marginTop: 6, marginBottom: 6 }}>Stavke (cijene se koriste kasnije u podlozi za fakturu; količina i masa mogu se iskoristiti za uvoz u normativ)</div>
      <table className="erp-table">
        <thead><tr><th style={{ width: 90 }}>Šifra</th><th>Naziv</th><th style={{ width: 55 }}>JM</th><th style={{ width: 75 }}>Količina</th><th style={{ width: 95 }}>Masa (kg/kom)</th><th style={{ width: 155 }}>Cijena</th><th style={{ width: 36 }}></th></tr></thead>
        <tbody>
          {form.stavke.length === 0 && <tr><td colSpan={7}><EmptyState text="Nema stavki. Dodaj stavku." /></td></tr>}
          {form.stavke.map((s, i) => {
            const izMase = (s.nacinCijene || "rucno") === "izMase";
            return (
              <tr key={s.id}>
                <td><input className="input f-mono" style={{ padding: "5px 8px" }} value={s.sifra} onChange={(e) => azurirajStavku(i, { sifra: e.target.value })} /></td>
                <td><input className="input" style={{ padding: "5px 8px" }} value={s.naziv} onChange={(e) => azurirajStavku(i, { naziv: e.target.value })} /></td>
                <td><input className="input" style={{ padding: "5px 8px" }} value={s.jm} onChange={(e) => azurirajStavku(i, { jm: e.target.value })} /></td>
                <td><input className="input f-mono" type="number" step="1" style={{ padding: "5px 8px" }} value={s.kolicina || 0} onChange={(e) => azurirajStavku(i, { kolicina: e.target.value })} /></td>
                <td><input className="input f-mono" type="number" step="0.1" style={{ padding: "5px 8px" }} value={s.masaJed || 0} onChange={(e) => azurirajStavku(i, { masaJed: e.target.value })} /></td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <select className="select" style={{ padding: "5px 2px", fontSize: 11, width: 58 }} value={s.nacinCijene || "rucno"} onChange={(e) => azurirajStavku(i, { nacinCijene: e.target.value })}>
                      <option value="rucno">€/kom</option>
                      <option value="izMase">€/kg</option>
                    </select>
                    {izMase ? (
                      <input className="input f-mono" type="number" step="0.01" style={{ padding: "5px 8px" }} value={s.cijenaKg || 0} onChange={(e) => azurirajStavku(i, { cijenaKg: e.target.value })} />
                    ) : (
                      <input className="input f-mono" type="number" step="0.01" style={{ padding: "5px 8px" }} value={s.cijena} onChange={(e) => azurirajStavku(i, { cijena: e.target.value })} />
                    )}
                  </div>
                  {izMase && <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 2 }}>= {fmtCurDec(s.cijena)} / kom</div>}
                </td>
                <td><button className="btn btn-icon btn-ghost" onClick={() => obrisiStavku(i)}><Trash2 size={14} color="var(--rust)" /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Btn variant="ghost" size="sm" icon={Plus} onClick={dodajStavku} style={{ marginTop: 8 }}>Dodaj stavku</Btn>
    </Modal>
  );
}

function OtpremnicaFormModal({ narudzba, projekt, db, update, showToast, onClose }) {
  const emptyForm = () => ({
    broj: sljedeciBrojOtpremnice(db.otpremnice, todayISO()), datum: todayISO(), mjesto: "Prelog",
    projektId: projekt.id, kupacId: projekt?.kupacId || "", narudzbaId: narudzba?.id || null, izdaoId: "", napomena: "",
    stavke: (narudzba?.stavke || []).map((s) => ({ id: uid("ost"), narudzbaStavkaId: s.id, naziv: s.naziv, jm: s.jm, kolicina: "" })),
  });
  const [form, setForm] = useState(emptyForm());

  const azurirajKolicinu = (i, val) => setForm({ ...form, stavke: form.stavke.map((s, idx) => (idx === i ? { ...s, kolicina: val } : s)) });

  const spremi = () => {
    const stavke = form.stavke.filter((s) => Number(s.kolicina) > 0).map((s) => ({ ...s, kolicina: Number(s.kolicina) }));
    if (stavke.length === 0) { showToast("Unesi količinu za barem jednu stavku."); return; }
    update("otpremnice", [...db.otpremnice, { ...form, id: uid("otp"), stavke }]);
    showToast("Otpremnica kreirana.");
    onClose();
  };

  return (
    <Modal wide title="Nova otpremnica" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi}>Kreiraj otpremnicu</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="Broj otpremnice"><input className="input f-mono" value={form.broj} disabled /></Field>
        <Field label="Datum"><input className="input" type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value, broj: sljedeciBrojOtpremnice(db.otpremnice, e.target.value) })} /></Field>
        <Field label="Mjesto"><input className="input" value={form.mjesto} onChange={(e) => setForm({ ...form, mjesto: e.target.value })} /></Field>
      </div>
      <Field label="Izdao (zaposlenik)">
        <select className="select" value={form.izdaoId} onChange={(e) => setForm({ ...form, izdaoId: e.target.value })}>
          <option value="">—</option>
          {[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
        </select>
      </Field>

      {form.stavke.length === 0 && <EmptyState text="Narudžba kupca nema stavki — prvo dodaj stavke u narudžbu." />}
      {form.stavke.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 6, marginBottom: 6 }}>Stavke za isporuku (upiši količinu koja se sada šalje)</div>
          <table className="erp-table">
            <thead><tr><th>Naziv</th><th style={{ width: 80 }}>JM</th><th style={{ width: 130 }}>Količina</th></tr></thead>
            <tbody>
              {form.stavke.map((s, i) => (
                <tr key={s.id}>
                  <td>{s.naziv}</td>
                  <td className="f-mono">{s.jm}</td>
                  <td><input className="input f-mono" type="number" min="0" style={{ padding: "5px 8px" }} value={s.kolicina} onChange={(e) => azurirajKolicinu(i, e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

function OtpremnicaPrintModal({ otpremnica, kupac, projekt, narudzba, izdao, postavkeTvrtke, onClose }) {
  const t = postavkeTvrtke || {};
  const PRAZNI_REDOVI = Math.max(0, 20 - otpremnica.stavke.length);
  return (
    <Modal wide title={`Pregled za ispis — Otpremnica ${otpremnica.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => window.print()}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div style={{ maxWidth: 250 }}>
            <img src={logoEcon} alt="Econ" style={{ width: 190, display: "block", marginBottom: 4 }} />
            <div style={{ fontSize: 9, color: "#555", lineHeight: 1.3 }}>Projektiranje, izrada i montaža metalnih<br />konstrukcija i ventiliranih fasada</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 20 }}>OTPREMNICA / <span style={{ fontStyle: "italic" }}>LIEFERSCHEIN</span> :&nbsp;<span className="f-mono">{otpremnica.broj}</span></div>
            <table style={{ fontSize: 11.5, marginTop: 10, marginLeft: "auto", borderCollapse: "collapse" }}>
              <tbody>
                <tr><td style={{ paddingRight: 10, color: "#555", textAlign: "right" }}>Datum :</td><td style={{ fontWeight: 600, textAlign: "left" }}>{fmtDate(otpremnica.datum)}</td></tr>
                <tr><td style={{ paddingRight: 10, color: "#555", textAlign: "right" }}>Mjesto / Ort :</td><td style={{ fontWeight: 600, textAlign: "left" }}>{otpremnica.mjesto}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ fontSize: 9.5, color: "#333", lineHeight: 1.6, marginBottom: 18, borderTop: "1px solid #ddd", borderBottom: "1px solid #ddd", padding: "8px 0" }}>
          {t.adresa} &nbsp;·&nbsp; {t.telefon} &nbsp;·&nbsp; {t.email}
        </div>

        <table style={{ fontSize: 11.5, marginBottom: 18, borderCollapse: "collapse" }}>
          <tbody>
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Kupac / Kunde :</td><td style={{ fontWeight: 600 }}>{kupac?.naziv || "—"}</td></tr>
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Narudžba / Bestellung :</td><td style={{ fontWeight: 600 }}>{narudzba?.broj || "—"}</td></tr>
            <tr><td style={{ paddingRight: 10, color: "#555" }}>Projekt :</td><td style={{ fontWeight: 600 }}>{projekt?.sifra}{projekt?.naziv ? ` — ${projekt.naziv}` : ""}</td></tr>
          </tbody>
        </table>

        <table className="doc-table" style={{ marginBottom: 20 }}>
          <thead>
            <tr style={{ background: "var(--steel)" }}>
              <th style={{ width: 50, background: "var(--steel)", color: "#fff" }}>Red.br. / RmNr</th>
              <th style={{ background: "var(--steel)", color: "#fff" }}>Naziv / Name</th>
              <th style={{ width: 90, background: "var(--steel)", color: "#fff" }}>Jed. Mjere / Maße</th>
              <th style={{ width: 80, background: "var(--steel)", color: "#fff" }}>Količina / Menge</th>
            </tr>
          </thead>
          <tbody>
            {otpremnica.stavke.map((s, i) => (
              <tr key={s.id || i}>
                <td>{i + 1}.</td><td>{s.naziv}</td><td>{s.jm}</td><td className="f-mono">{s.kolicina}</td>
              </tr>
            ))}
            {Array.from({ length: PRAZNI_REDOVI }).map((_, i) => (
              <tr key={`prazno-${i}`}><td>{otpremnica.stavke.length + i + 1}.</td><td>&nbsp;</td><td></td><td></td></tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 30, marginBottom: 16, fontSize: 10.5 }}>
          <div style={{ textAlign: "center", width: "30%" }}><div style={{ borderTop: "1px solid #333", paddingTop: 4 }}>Izdao / Ausgestellt von {izdao ? `— ${izdao.prezime} ${izdao.ime}` : ""}</div></div>
          <div style={{ textAlign: "center", width: "30%" }}><div style={{ borderTop: "1px solid #333", paddingTop: 4 }}>Otpremio / Versendet von</div></div>
          <div style={{ textAlign: "center", width: "30%" }}><div style={{ borderTop: "1px solid #333", paddingTop: 4 }}>Zaprimio / Empfangen von</div></div>
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>Žiro račun:</strong> {t.ziroRacun}<br />
          <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Temeljni kapital:</strong> {t.temeljniKapital} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

function OtpremniceListModal({ projekt, narudzba, db, update, showToast, onClose }) {
  const kupac = db.kupci.find((k) => k.id === projekt?.kupacId);
  const otpremnice = db.otpremnice.filter((o) => o.projektId === projekt.id).sort((a, b) => b.datum.localeCompare(a.datum));
  const [otpModal, setOtpModal] = useState(false);
  const [printOtp, setPrintOtp] = useState(null);
  const [delOtp, setDelOtp] = useState(null);

  return (
    <>
      <Modal wide title={`Otpremnice — ${projekt.sifra}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Plus} onClick={() => setOtpModal(true)} disabled={!narudzba}>Nova otpremnica</Btn></>}>
        {!narudzba && <div style={{ fontSize: 12.5, color: "var(--rust)", marginBottom: 12 }}>Ovaj projekt nema unesenu narudžbu kupca — prvo je unesi (gumb "Narudžba" u detaljima projekta).</div>}
        {otpremnice.length === 0 ? <EmptyState text="Nema izdanih otpremnica." /> : (
          <table className="erp-table">
            <thead><tr><th>Broj</th><th>Datum</th><th>Stavki</th><th></th></tr></thead>
            <tbody>
              {otpremnice.map((o) => (
                <tr key={o.id}>
                  <td className="f-mono">{o.broj}</td>
                  <td>{fmtDate(o.datum)}</td>
                  <td className="f-mono">{o.stavke.length}</td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <Btn size="sm" icon={Eye} onClick={() => setPrintOtp(o)}>PDF</Btn>
                    <button className="btn btn-icon btn-ghost" onClick={() => setDelOtp(o)}><Trash2 size={14} color="var(--rust)" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      {otpModal && <OtpremnicaFormModal narudzba={narudzba} projekt={projekt} db={db} update={update} showToast={showToast} onClose={() => setOtpModal(false)} />}
      {printOtp && <OtpremnicaPrintModal otpremnica={printOtp} kupac={kupac} projekt={projekt} narudzba={narudzba} izdao={db.zaposlenici.find((z) => z.id === printOtp.izdaoId)} postavkeTvrtke={db.postavkeTvrtke} onClose={() => setPrintOtp(null)} />}
      {delOtp && <ConfirmDelete label={delOtp.broj} onCancel={() => setDelOtp(null)} onConfirm={() => { update("otpremnice", db.otpremnice.filter((o) => o.id !== delOtp.id)); setDelOtp(null); showToast("Otpremnica obrisana."); }} />}
    </>
  );
}

function ProizvodnjaPage({ db, update, showToast }) {
  const [prikaz, setPrikaz] = useState("tablica");
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const emptyForm = () => {
    const projekt = db.projekti[0];
    return { id: null, broj: projekt ? sljedeciBrojRadnogNaloga(db.radniNalozi, projekt.sifra) : "", projektId: projekt?.id || "", naziv: "", faza: FAZE[0], zaduzenTim: "", status: "Planiran", planiranoSati: 0, utrosenoSati: 0, datumPocetka: todayISO(), datumZavrsetka: todayISO(), stavke: [], materijalIzdan: false, ovisiONalogId: null };
  };
  const [form, setForm] = useState(emptyForm());

  const openAdd = () => { setForm(emptyForm()); setModal("edit"); };
  const openEdit = (row) => { setForm(JSON.parse(JSON.stringify(row))); setModal("edit"); };
  const save = () => {
    const payload = { ...form, planiranoSati: Number(form.planiranoSati), utrosenoSati: Number(form.utrosenoSati) };
    if (form.id) update("radniNalozi", db.radniNalozi.map((r) => (r.id === form.id ? payload : r)));
    else update("radniNalozi", [...db.radniNalozi, { ...payload, id: uid("rn") }]);
    setModal(null);
    showToast("Radni nalog spremljen.");
  };
  const izdaj = (row) => {
    let materijali = [...db.materijali];
    row.stavke.forEach((s) => {
      const mat = materijali.find((m) => m.id === s.materijalId);
      materijali = materijali.map((m) => (m.id === s.materijalId ? { ...m, kolicina: Math.max(0, m.kolicina - efektivnaKolicinaMaterijala(s, mat)) } : m));
    });
    update("materijali", materijali);
    update("radniNalozi", db.radniNalozi.map((r) => (r.id === row.id ? { ...r, materijalIzdan: true } : r)));
    showToast("Materijal izdan, skladište ažurirano.");
  };
  const projNaziv = (id) => db.projekti.find((p) => p.id === id)?.naziv || "—";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <PageHeader title="Proizvodnja" icon={Factory} subtitle="Radni nalozi po fazama izrade i montaže" />
      </div>
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        <div className={`nav-tab ${prikaz === "tablica" ? "active" : ""}`} onClick={() => setPrikaz("tablica")}>Tablica</div>
        <div className={`nav-tab ${prikaz === "gantogram" ? "active" : ""}`} onClick={() => setPrikaz("gantogram")}><CalendarRange size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Gantogram</div>
        <div className={`nav-tab ${prikaz === "rezanje" ? "active" : ""}`} onClick={() => setPrikaz("rezanje")}>Plan rezanja</div>
      </div>

      {prikaz === "gantogram" && <PlanProizvodnjeView db={db} update={update} showToast={showToast} />}
      {prikaz === "rezanje" && <PlanRezanjaView db={db} update={update} showToast={showToast} />}

      {prikaz === "tablica" && (
      <EntityPage
        title="" data={db.radniNalozi} onAdd={openAdd} onEdit={openEdit} onDelete={(r) => setDel(r)}
        addLabel="Novi radni nalog" searchKeys={["broj", "naziv", "zaduzenTim"]}
        columns={[
          { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
          { key: "naziv", label: "Opis" },
          { key: "projekt", label: "Projekt", render: (r) => projNaziv(r.projektId) },
          { key: "faza", label: "Faza" },
          { key: "zaduzenTim", label: "Tim" },
          { key: "sati", label: "Sati (utr./plan.)", render: (r) => <span className="f-mono">{r.utrosenoSati} / {r.planiranoSati}</span> },
          { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
          { key: "materijal", label: "", render: (r) => r.stavke.length > 0 && !r.materijalIzdan ? <Btn size="sm" icon={PackageMinus} onClick={() => izdaj(r)}>Izdaj materijal</Btn> : (r.materijalIzdan ? <span style={{ fontSize: 11, color: "var(--green)" }}>Materijal izdan ✓</span> : null) },
        ]}
      />
      )}

      {modal && (
        <Modal wide title={form.id ? `Radni nalog ${form.broj}` : "Novi radni nalog"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={save}>Spremi</Btn></>}>
          <Field label="Projekt"><select className="select" value={form.projektId} onChange={(e) => { const noviProjekt = db.projekti.find((p) => p.id === e.target.value); setForm({ ...form, projektId: e.target.value, broj: !form.id && noviProjekt ? sljedeciBrojRadnogNaloga(db.radniNalozi, noviProjekt.sifra) : form.broj }); }}>{db.projekti.map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}</select></Field>
          <Field label="Opis radnog naloga"><input className="input" value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Faza proizvodnje"><select className="select" value={form.faza} onChange={(e) => setForm({ ...form, faza: e.target.value })}>{FAZE.map((f) => <option key={f}>{f}</option>)}</select></Field>
            <Field label="Zadužen tim"><input className="input" value={form.zaduzenTim} onChange={(e) => setForm({ ...form, zaduzenTim: e.target.value })} /></Field>
            <Field label="Status"><select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["Planiran", "U tijeku", "Pauziran", "Završen"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Planirano sati"><input className="input f-mono" type="number" value={form.planiranoSati} onChange={(e) => setForm({ ...form, planiranoSati: e.target.value })} /></Field>
            <Field label="Utrošeno sati"><input className="input f-mono" type="number" value={form.utrosenoSati} onChange={(e) => setForm({ ...form, utrosenoSati: e.target.value })} /></Field>
            <Field label="Ovisi o nalogu (opcionalno)">
              <select className="select" value={form.ovisiONalogId || ""} onChange={(e) => setForm({ ...form, ovisiONalogId: e.target.value || null })}>
                <option value="">— Bez ovisnosti —</option>
                {db.radniNalozi.filter((r) => r.id !== form.id).map((r) => { const proj = db.projekti.find((p) => p.id === r.projektId); return <option key={r.id} value={r.id}>{proj?.sifra} · {r.broj} — {r.faza}</option>; })}
              </select>
            </Field>
            <Field label="Datum početka"><input className="input" type="date" value={form.datumPocetka} onChange={(e) => setForm({ ...form, datumPocetka: e.target.value })} /></Field>
            <Field label="Datum završetka"><input className="input" type="date" value={form.datumZavrsetka} onChange={(e) => setForm({ ...form, datumZavrsetka: e.target.value })} /></Field>
          </div>
          <Field label="Potreban materijal (skladište)">
            <LineItemsEditor mode="materijal" rows={form.stavke} setRows={(rows) => setForm({ ...form, stavke: rows })} materijali={db.materijali} katalog={db.katalogProfila} onCreateMaterijal={(entry) => kreirajMaterijalIzKataloga(entry, db, update)} />
          </Field>
        </Modal>
      )}
      {del && <ConfirmDelete label={del.broj} onCancel={() => setDel(null)} onConfirm={() => { update("radniNalozi", db.radniNalozi.filter((r) => r.id !== del.id)); setDel(null); showToast("Radni nalog obrisan."); }} />}
    </div>
  );
}

/* ============================== POZICIJE PONUDE (kalkulacija sati po operaciji) ============================== */
function PozicijeEditor({ pozicije = [], setPozicije, cjenikRada, katalog = [] }) {
  const [otvorene, setOtvorene] = useState(() => Object.fromEntries(pozicije.map((p) => [p.id, true])));
  const toggle = (id) => setOtvorene((o) => ({ ...o, [id]: !o[id] }));
  const grupe = katalogPoTipu(katalog);

  const addPoz = () => {
    const id = uid("poz");
    setPozicije([...pozicije, { id, oznaka: `P${pozicije.length + 1}`, naziv: "", kolicina: 1, nacinMase: "rucno", masaJed: 0, katalogId: "", dimenzija: 0, kvaliteta: "celik", operacije: praznaOperacijaSati() }]);
    setOtvorene((o) => ({ ...o, [id]: true }));
  };
  const updatePoz = (id, patch) => setPozicije(pozicije.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const updateOp = (id, key, val) => setPozicije(pozicije.map((p) => (p.id === id ? { ...p, operacije: { ...p.operacije, [key]: val } } : p)));
  const removePoz = (id) => setPozicije(pozicije.filter((p) => p.id !== id));

  const satiPoz = (p) => OPERACIJE.reduce((s, o) => s + (Number(p.operacije?.[o.key]) || 0), 0);
  const trosakPoz = (p) => OPERACIJE.reduce((s, o) => s + (Number(p.operacije?.[o.key]) || 0) * (Number(cjenikRada?.[o.key]) || 0), 0);
  const masaPoz = (p) => {
    if (p.nacinMase === "katalog") {
      const entry = katalog.find((k) => k.id === p.katalogId);
      const faktor = KVALITETE_MATERIJALA.find((k) => k.key === (p.kvaliteta || "celik"))?.faktor || 1;
      return masaIzKataloga(entry, p.dimenzija) * faktor;
    }
    return Number(p.masaJed) || 0;
  };

  return (
    <div>
      {pozicije.length === 0 && <div style={{ textAlign: "center", color: "var(--ink-faint)", padding: "16px 0", fontSize: 13 }}>Nema pozicija. Dodajte prvu poziciju konstrukcije.</div>}
      {pozicije.map((p) => {
        const nacinMase = p.nacinMase || "rucno";
        const katEntry = katalog.find((k) => k.id === p.katalogId);
        const masaJedEfektivna = masaPoz(p);
        return (
          <div key={p.id} className="card" style={{ padding: 12, marginBottom: 10, background: "var(--surface-alt)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ width: 62 }}><label className="label">Oznaka</label><input className="input f-mono" value={p.oznaka} onChange={(e) => updatePoz(p.id, { oznaka: e.target.value })} /></div>
              <div style={{ flex: "2 1 220px" }}><label className="label">Naziv pozicije</label><input className="input" placeholder="npr. Glavni nosači rešetke" value={p.naziv} onChange={(e) => updatePoz(p.id, { naziv: e.target.value })} /></div>
              <div style={{ width: 90 }}><label className="label">Količina</label><input className="input f-mono" type="number" min="0" value={p.kolicina} onChange={(e) => updatePoz(p.id, { kolicina: e.target.value })} /></div>
              <button className="btn btn-icon btn-ghost" onClick={() => toggle(p.id)} title="Prikaži/sakrij sate po operaciji">{otvorene[p.id] ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
              <button className="btn btn-icon btn-ghost" onClick={() => removePoz(p.id)}><Trash2 size={14} color="var(--rust)" /></button>
            </div>

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-strong)", display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ width: 150 }}>
                <label className="label">Način unosa mase</label>
                <select className="select" value={nacinMase} onChange={(e) => updatePoz(p.id, { nacinMase: e.target.value })}>
                  <option value="rucno">Ručni unos</option>
                  <option value="katalog">Iz kataloga profila</option>
                </select>
              </div>
              {nacinMase === "katalog" ? (
                <>
                  <div style={{ flex: "1 1 220px" }}>
                    <label className="label">Profil / lim</label>
                    <select className="select" value={p.katalogId} onChange={(e) => updatePoz(p.id, { katalogId: e.target.value })}>
                      <option value="">Odaberi iz kataloga…</option>
                      {grupe.map((g) => (
                        <optgroup key={g.tip} label={g.tip}>
                          {g.stavke.map((k) => <option key={k.id} value={k.id}>{k.oznaka} ({k.vrijednost} {k.jedinica})</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div style={{ width: 150 }}>
                    <label className="label">{katEntry?.jedinica === "kg/m2" ? "Površina/kom (m²)" : "Dužina/kom (m)"}</label>
                    <input className="input f-mono" type="number" min="0" step="0.01" value={p.dimenzija} onChange={(e) => updatePoz(p.id, { dimenzija: e.target.value })} />
                  </div>
                  <div style={{ width: 170 }}>
                    <label className="label">Kvaliteta materijala</label>
                    <select className="select" value={p.kvaliteta || "celik"} onChange={(e) => updatePoz(p.id, { kvaliteta: e.target.value })}>
                      {KVALITETE_MATERIJALA.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                    </select>
                  </div>
                  <div style={{ width: 130 }}>
                    <label className="label">Masa/kom (izračunato)</label>
                    <div className="input f-mono" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>{masaJedEfektivna.toFixed(2)} kg</div>
                  </div>
                </>
              ) : (
                <div style={{ width: 150 }}>
                  <label className="label">Masa/kom (kg)</label>
                  <input className="input f-mono" type="number" min="0" value={p.masaJed} onChange={(e) => updatePoz(p.id, { masaJed: e.target.value })} />
                </div>
              )}
            </div>

            {otvorene[p.id] && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-strong)" }}>
                <div className="label" style={{ marginBottom: 8 }}>Predviđeni sati po operaciji</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
                  {OPERACIJE.map((o) => (
                    <div key={o.key}>
                      <label style={{ fontSize: 11, color: "var(--ink-soft)", display: "block", marginBottom: 3 }}>{o.label}</label>
                      <input className="input f-mono" type="number" min="0" step="0.5" value={p.operacije?.[o.key] ?? 0} onChange={(e) => updateOp(p.id, o.key, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 18, fontSize: 12.5 }}>
              <span style={{ color: "var(--ink-soft)" }}>Ukupno masa: <strong className="f-mono" style={{ color: "var(--ink)" }}>{(Number(p.kolicina) * masaJedEfektivna || 0).toLocaleString("hr-HR", { maximumFractionDigits: 1 })} kg</strong></span>
              <span style={{ color: "var(--ink-soft)" }}>Ukupno sati: <strong className="f-mono" style={{ color: "var(--ink)" }}>{satiPoz(p)} h</strong></span>
              <span style={{ color: "var(--ink-soft)" }}>Trošak rada: <strong className="f-mono" style={{ color: "var(--ink)" }}>{fmtCurDec(trosakPoz(p))}</strong></span>
            </div>
          </div>
        );
      })}
      <Btn variant="ghost" size="sm" icon={Plus} onClick={addPoz}>Dodaj poziciju</Btn>
    </div>
  );
}

function CjenikRadaModal({ cjenikRada, onSave, onClose }) {
  const [form, setForm] = useState(cjenikRada);
  return (
    <Modal title="Cjenik rada po operaciji (€/h)" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={() => onSave(form)}>Spremi cjenik</Btn></>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>Ove satnice koriste se za izračun troška rada u kalkulaciji ponuda.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {OPERACIJE.map((o) => (
          <Field key={o.key} label={o.label}>
            <input className="input f-mono" type="number" min="0" step="0.5" value={form[o.key]} onChange={(e) => setForm({ ...form, [o.key]: e.target.value })} />
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function StandardniZadaciModal({ standardniZadaci, update, showToast, onClose }) {
  const [noviNaziv, setNoviNaziv] = useState("");
  const dodaj = () => {
    if (!noviNaziv.trim()) return;
    update("standardniZadaci", [...standardniZadaci, { id: uid("std"), naziv: noviNaziv.trim() }]);
    setNoviNaziv("");
  };
  const obrisi = (id) => { update("standardniZadaci", standardniZadaci.filter((t) => t.id !== id)); };
  return (
    <Modal title="Standardni zadaci projekta" onClose={onClose} footer={<Btn onClick={onClose}>Zatvori</Btn>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>Ovi zadaci se automatski dodaju na svaki novi projekt (i pri pretvaranju ponude u projekt). Brisanje ovdje ne utječe na zadatke već postojećih projekata.</p>
      <div style={{ marginBottom: 14 }}>
        {standardniZadaci.length === 0 && <EmptyState text="Nema standardnih zadataka." />}
        {standardniZadaci.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={{ fontSize: 13.5 }}>{t.naziv}</span>
            <button className="btn btn-icon btn-ghost" onClick={() => obrisi(t.id)}><Trash2 size={14} color="var(--rust)" /></button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="Naziv novog standardnog zadatka…" value={noviNaziv} onChange={(e) => setNoviNaziv(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") dodaj(); }} />
        <Btn variant="primary" icon={Plus} onClick={dodaj}>Dodaj</Btn>
      </div>
    </Modal>
  );
}

// Tablica stavki jedne grupe normativa (Pod ili Komplet) unutar detalja projekta — svaka
// grupa ima svoju listu tipova jer se pod i komplet naručuju kao nezavisne stavke (različite
// oznake i količine u narudžbenici, npr. varijanta poda za prizemlje bez para u stranicama).
// Uvoz stavki iz vec unesene Narudzbe kupca (koja vec ima sifru/naziv/kolicinu/masu po stavci)
// u Pod/Komplet tablice normativa, da se iste stavke ne moraju upisivati dvaput. Svaka uvezena
// stavka pamti izNarudzbeId pa ponovni uvoz azurira postojeci redak umjesto da ga duplicira.
function NarudzbaUvozModal({ narudzba, stavkePod, stavkeKomplet, onUvezi, onClose }) {
  const pocetniIzbor = () => {
    const vecPod = new Set(stavkePod.map((s) => s.izNarudzbeId).filter(Boolean));
    const vecKomplet = new Set(stavkeKomplet.map((s) => s.izNarudzbeId).filter(Boolean));
    return Object.fromEntries((narudzba.stavke || []).map((s) => [s.id, vecPod.has(s.id) ? "stavkePod" : vecKomplet.has(s.id) ? "stavkeKomplet" : ""]));
  };
  const [izbor, setIzbor] = useState(pocetniIzbor);

  const spremi = () => {
    const odabrano = (narudzba.stavke || []).filter((s) => izbor[s.id]);
    if (odabrano.length > 0) onUvezi(odabrano.map((s) => ({ narudzbaStavka: s, grupa: izbor[s.id] })));
    onClose();
  };

  return (
    <Modal wide title="Uvezi stavke iz narudžbe" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Download} onClick={spremi}>Uvezi odabrano</Btn></>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>
        Za svaku stavku iz narudžbe {narudzba.broj} odaberi ide li u Pod ili Komplet tablicu normativa. Ponovni uvoz iste stavke ažurira već uvezeni redak (oznaku, masu, komade) umjesto da ga duplicira.
      </p>
      <table className="erp-table">
        <thead><tr><th>Naziv</th><th style={{ width: 80 }}>Kom</th><th style={{ width: 110 }}>Masa (kg/kom)</th><th style={{ width: 160 }}>Uvezi u</th></tr></thead>
        <tbody>
          {(narudzba.stavke || []).length === 0 && <tr><td colSpan={4}><EmptyState text="Narudžba nema unesenih stavki." /></td></tr>}
          {(narudzba.stavke || []).map((s) => (
            <tr key={s.id}>
              <td>{s.sifra ? `${s.sifra} — ` : ""}{s.naziv || "(bez naziva)"}</td>
              <td className="f-mono">{s.kolicina || 0}</td>
              <td className="f-mono">{s.masaJed || 0}</td>
              <td>
                <select className="select" value={izbor[s.id] || ""} onChange={(e) => setIzbor({ ...izbor, [s.id]: e.target.value })}>
                  <option value="">Preskoči</option>
                  <option value="stavkePod">Pod</option>
                  <option value="stavkeKomplet">Komplet</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function StavkeNormativaTablica({ naslov, rezultat, rasporedjeno, onDodaj, onAzuriraj, onObrisi }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="label" style={{ marginBottom: 6 }}>{naslov}</div>
      <table className="erp-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Oznaka tipa</th>
            <th style={{ width: 110 }}>Masa (kg/kom)</th>
            <th style={{ width: 80 }}>Komada</th>
            <th style={{ width: 100 }}>Ukupno kg</th>
            <th style={{ width: 110 }}>Vrijednost</th>
            <th style={{ width: 90 }}>Sati</th>
            <th style={{ width: 90 }}>U rasporedu</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {rezultat.poStavci.length === 0 && (
            <tr><td colSpan={8}><EmptyState text="Nema unesenih stavki." /></td></tr>
          )}
          {rezultat.poStavci.map((r) => {
            const rasp = rasporedjeno(r.stavka.id);
            const kom = Number(r.stavka.komada) || 0;
            return (
              <tr key={r.stavka.id}>
                <td><input className="input" placeholder="npr. Typ A1" value={r.stavka.oznaka} onChange={(e) => onAzuriraj(r.stavka.id, { oznaka: e.target.value })} /></td>
                <td><input className="input f-mono" type="number" min="0" step="1" value={r.stavka.masaJed} onChange={(e) => onAzuriraj(r.stavka.id, { masaJed: e.target.value })} /></td>
                <td><input className="input f-mono" type="number" min="0" step="1" value={r.stavka.komada} onChange={(e) => onAzuriraj(r.stavka.id, { komada: e.target.value })} /></td>
                <td className="f-mono">{Math.round(r.masaUk).toLocaleString("hr-HR")}</td>
                <td className="f-mono">{fmtCur(r.vrijednost)}</td>
                <td className="f-mono">{r.sati.toFixed(1)} h</td>
                <td className="f-mono" style={{ color: rasp === kom ? "var(--green)" : "var(--rust)" }}>{rasp}/{kom}</td>
                <td><button className="btn btn-icon btn-ghost" onClick={() => onObrisi(r.stavka.id)}><Trash2 size={14} /></button></td>
              </tr>
            );
          })}
          {rezultat.poStavci.length > 0 && (
            <tr style={{ fontWeight: 700, background: "var(--surface-alt)" }}>
              <td>UKUPNO</td>
              <td></td>
              <td className="f-mono">{rezultat.ukupno.komada}</td>
              <td className="f-mono">{Math.round(rezultat.ukupno.masaUk).toLocaleString("hr-HR")}</td>
              <td className="f-mono">{fmtCur(rezultat.ukupno.vrijednost)}</td>
              <td className="f-mono">{rezultat.ukupno.sati.toFixed(1)} h</td>
              <td></td>
              <td></td>
            </tr>
          )}
        </tbody>
      </table>
      <Btn variant="ghost" size="sm" icon={Plus} onClick={onDodaj}>Dodaj stavku</Btn>
    </div>
  );
}

/* ============================== NORMATIV TIPSKIH PROJEKATA — UREĐIVANJE ============================== */
function NormativiModal({ db, update, showToast, onClose }) {
  const [form, setForm] = useState(() => JSON.parse(JSON.stringify(db.normativi || { naziv: "", grupe: [] })));

  const azurirajGrupu = (kljuc, patch) => setForm({ ...form, grupe: form.grupe.map((g) => (g.kljuc === kljuc ? { ...g, ...patch } : g)) });
  const azurirajPostotak = (kljuc, opKey, val) => setForm({
    ...form,
    grupe: form.grupe.map((g) => (g.kljuc === kljuc ? { ...g, raspodjela: { ...g.raspodjela, [opKey]: val === "" ? 0 : Number(val) } } : g)),
  });

  const spremi = () => {
    const losa = form.grupe.find((g) => Math.abs(zbrojRaspodjele(g.raspodjela) - 100) > 0.01);
    if (losa) { showToast(`Raspodjela za "${losa.naziv}" ne daje 100% (trenutno ${zbrojRaspodjele(losa.raspodjela).toFixed(1)}%).`); return; }
    update("normativi", form);
    showToast("Normativ spremljen.");
    onClose();
  };

  return (
    <Modal wide title="Normativ tipskih projekata (ugovorene cijene)" onClose={onClose}
      footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi}>Spremi</Btn></>}>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>
        Postavlja se jednom i vrijedi za sve projekte koji koriste normativ. Cijena i sati izvode se iz mase:
        <strong> vrijednost = masa × €/kg</strong>, <strong>sati = masa ÷ (kg/h)</strong>, a ti se sati raspoređuju po operacijama prema postotku ispod.
      </p>
      <Field label="Naziv normativa"><input className="input" value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} /></Field>

      {form.grupe.map((g) => {
        const zbroj = zbrojRaspodjele(g.raspodjela);
        const ok = Math.abs(zbroj - 100) < 0.01;
        return (
          <div key={g.kljuc} className="card" style={{ padding: 14, marginBottom: 14, background: "var(--surface-alt)" }}>
            <div className="f-display" style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{g.naziv}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <Field label="Ugovorena cijena (€/kg)"><input className="input f-mono" type="number" step="0.01" min="0" value={g.cijenaKg} onChange={(e) => azurirajGrupu(g.kljuc, { cijenaKg: e.target.value })} /></Field>
              <Field label="Učinak (kg/h)"><input className="input f-mono" type="number" step="0.1" min="0" value={g.ucinakKgH} onChange={(e) => azurirajGrupu(g.kljuc, { ucinakKgH: e.target.value })} /></Field>
            </div>
            <div className="label" style={{ marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
              <span>Raspodjela sati po operacijama (%)</span>
              <span className="f-mono" style={{ color: ok ? "var(--green)" : "var(--rust)", fontWeight: 700 }}>{zbroj.toFixed(1)}% {ok ? "✓" : "— mora biti 100%"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {OPERACIJE.map((o) => (
                <div key={o.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11.5, flex: 1, color: "var(--ink-soft)" }}>{o.label}</span>
                  <input className="input f-mono" type="number" step="0.5" min="0" style={{ width: 62 }} value={g.raspodjela?.[o.key] ?? 0} onChange={(e) => azurirajPostotak(g.kljuc, o.key, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

/* ============================== DETALJI PROJEKTA ============================== */
function ProjektDetaljModal({ projekt, db, update, showToast, setPage, onClose }) {
  const kupac = db.kupci.find((k) => k.id === projekt.kupacId);
  const voditelj = db.zaposlenici.find((z) => z.id === projekt.voditeljId);
  const nalozi = db.radniNalozi.filter((r) => r.projektId === projekt.id);
  const planiranoUkupno = nalozi.reduce((s, n) => s + (Number(n.planiranoSati) || 0), 0);
  const utrosenoUkupno = nalozi.reduce((s, n) => s + (Number(n.utrosenoSati) || 0), 0);
  const postotak = planiranoUkupno > 0 ? Math.min(100, Math.round((utrosenoUkupno / planiranoUkupno) * 100)) : 0;
  const pozicije = projekt.pozicije || [];
  const materijalStavke = projekt.materijalStavke || [];
  const ostaleStavke = projekt.ostaleStavke || [];
  const zadaci = projekt.zadaci || [];
  const zadaciDone = zadaci.filter((z) => z.izvrseno).length;
  const [noviZadatak, setNoviZadatak] = useState("");
  const [noviZadatakDatum, setNoviZadatakDatum] = useState("");
  const [narudzbaModal, setNarudzbaModal] = useState(false);
  const [otpremniceModal, setOtpremniceModal] = useState(false);
  const narudzba = db.narudzbe.find((n) => n.projektId === projekt.id);
  const brojOtpremnica = db.otpremnice.filter((o) => o.projektId === projekt.id).length;

  const [normativOtvoren, setNormativOtvoren] = useState(false);
  const stavkePod = projekt.stavkePod || [];
  const stavkeKomplet = projekt.stavkeKomplet || [];
  const isporuke = projekt.isporuke || [];
  const koristiNormativ = !!projekt.koristiNormativ;
  const izracunNorm = useMemo(() => izracunTipskogProjekta({ stavkePod, stavkeKomplet }, db.normativi), [stavkePod, stavkeKomplet, db.normativi]);
  const patchProjekt = (patch) => update("projekti", db.projekti.map((p) => (p.id === projekt.id ? { ...p, ...patch } : p)));
  const dodajStavku = (grupa) => patchProjekt({ [grupa]: [...(projekt[grupa] || []), { id: uid("stv"), oznaka: "", masaJed: 0, komada: 0 }] });
  const azurirajStavku = (grupa, id, patch) => patchProjekt({ [grupa]: (projekt[grupa] || []).map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const obrisiStavku = (grupa, id) => patchProjekt({ [grupa]: (projekt[grupa] || []).filter((s) => s.id !== id), isporuke: isporuke.filter((i) => !(i.grupa === grupa && i.stavkaId === id)) });
  // Sve unesene stavke (pod + komplet) u jednoj listi, za padajući izbornik u rasporedu isporuka
  const sveStavke = [
    ...stavkePod.map((s) => ({ grupa: "stavkePod", stavka: s })),
    ...stavkeKomplet.map((s) => ({ grupa: "stavkeKomplet", stavka: s })),
  ];
  const nadjiStavku = (grupa, stavkaId) => (grupa === "stavkePod" ? stavkePod : stavkeKomplet).find((s) => s.id === stavkaId);
  const rasporedjenoZaStavku = (grupa, stavkaId) => isporuke.filter((i) => i.grupa === grupa && i.stavkaId === stavkaId).reduce((s, i) => s + (Number(i.komada) || 0), 0);
  const [uvozOtvoren, setUvozOtvoren] = useState(false);
  const uveziIzNarudzbe = (odabrane) => {
    const noviPod = [...stavkePod];
    const noviKomplet = [...stavkeKomplet];
    odabrane.forEach(({ narudzbaStavka, grupa }) => {
      const cilj = grupa === "stavkePod" ? noviPod : noviKomplet;
      const patch = { izNarudzbeId: narudzbaStavka.id, oznaka: narudzbaStavka.naziv, masaJed: Number(narudzbaStavka.masaJed) || 0, komada: Number(narudzbaStavka.kolicina) || 0 };
      const idx = cilj.findIndex((s) => s.izNarudzbeId === narudzbaStavka.id);
      if (idx >= 0) cilj[idx] = { ...cilj[idx], ...patch };
      else cilj.push({ id: uid("stv"), ...patch });
    });
    patchProjekt({ stavkePod: noviPod, stavkeKomplet: noviKomplet });
    showToast && showToast("Stavke uvezene iz narudžbe.");
  };
  const dodajIsporuku = () => {
    const prva = sveStavke[0];
    patchProjekt({ isporuke: [...isporuke, { id: uid("isp"), redniBroj: isporuke.length + 1, grupa: prva?.grupa || "stavkePod", stavkaId: prva?.stavka.id || "", komada: 1, datum: "", isporuceno: false }] });
  };
  const azurirajIsporuku = (id, patch) => patchProjekt({ isporuke: isporuke.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const obrisiIsporuku = (id) => patchProjekt({ isporuke: isporuke.filter((i) => i.id !== id) });

  const azurirajZadatke = (noviZadaci) => update("projekti", db.projekti.map((p) => (p.id === projekt.id ? { ...p, zadaci: noviZadaci } : p)));
  const azurirajMaterijal = (noveStavke) => update("projekti", db.projekti.map((p) => (p.id === projekt.id ? { ...p, materijalStavke: noveStavke } : p)));
  const pokreniKreiranjeUpita = () => {
    const noviUpit = kreirajUpitIzMaterijala({ ...projekt, materijalStavke }, db, update, showToast);
    if (noviUpit && setPage) setPage("nabava");
  };
  const toggleZadatak = (zadId, checked) => azurirajZadatke(zadaci.map((z) => (z.id === zadId ? { ...z, izvrseno: checked, izvrsioId: checked ? z.izvrsioId : null, datumIzvrsenja: checked ? z.datumIzvrsenja || todayISO() : null } : z)));
  const postaviIzvrsitelja = (zadId, izvrsioId) => azurirajZadatke(zadaci.map((z) => (z.id === zadId ? { ...z, izvrsioId, izvrseno: true, datumIzvrsenja: z.datumIzvrsenja || todayISO() } : z)));
  const postaviPlaniraniDatum = (zadId, datum) => azurirajZadatke(zadaci.map((z) => (z.id === zadId ? { ...z, planiraniDatum: datum } : z)));
  const obrisiZadatak = (zadId) => azurirajZadatke(zadaci.filter((z) => z.id !== zadId));
  const dodajZadatak = () => {
    if (!noviZadatak.trim()) return;
    azurirajZadatke([...zadaci, { id: uid("zad"), naziv: noviZadatak.trim(), izvrseno: false, izvrsioId: null, datumIzvrsenja: null, planiraniDatum: noviZadatakDatum || null }]);
    setNoviZadatak("");
    setNoviZadatakDatum("");
    showToast && showToast("Zadatak dodan.");
  };

  return (
    <>
    <Modal wide title={`Detalji projekta — ${projekt.sifra}`} onClose={onClose} footer={<Btn onClick={onClose}>Zatvori</Btn>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }} className="f-display">{projekt.naziv}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>{kupac?.naziv || "—"} · Rok: {fmtDate(projekt.rokPocetka)} – {fmtDate(projekt.rokZavrsetka)}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2, display: "flex", alignItems: "center", gap: 8 }}>
            Voditelj projekta: <strong style={{ color: "var(--ink)" }}>{voditelj ? `${voditelj.prezime} ${voditelj.ime}` : "nije dodijeljen"}</strong>
            {voditelj && <Btn variant="ghost" size="sm" onClick={() => { const ok = posaljiObavijestVoditelju(projekt, voditelj); showToast && showToast(ok ? "Otvoren e-mail za slanje obavijesti." : "Voditelj nema unesen e-mail."); }}>Pošalji obavijest</Btn>}
          </div>
          {projekt.izvorPonudaId && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>Kreirano iz ponude {db.ponude.find((p) => p.id === projekt.izvorPonudaId)?.broj || projekt.izvorPonudaId}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <Badge status={projekt.status} />
          <div className="f-mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{fmtCur(projekt.vrijednost)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 16, background: "var(--surface-alt)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
          <span style={{ color: "var(--ink-soft)" }}>Napredak izvršenja (sati)</span>
          <span className="f-mono">{utrosenoUkupno} / {planiranoUkupno} h ({postotak}%)</span>
        </div>
        <div style={{ height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${postotak}%`, background: postotak >= 100 ? "var(--green)" : "var(--steel)" }} />
        </div>
      </div>

      {/* ===== Tipski projekt po normativu (kupaonice i sl.) ===== */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={koristiNormativ} onChange={(e) => patchProjekt({ koristiNormativ: e.target.checked })} />
            <strong className="f-display" style={{ fontSize: 14 }}>Tipski projekt po normativu</strong>
          </label>
          {koristiNormativ && (
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" size="sm" icon={Download} onClick={() => setUvozOtvoren(true)} disabled={!narudzba}>Uvezi iz narudžbe</Btn>
              <Btn variant="ghost" size="sm" icon={Settings} onClick={() => setNormativOtvoren(true)}>Uredi normativ</Btn>
            </div>
          )}
        </div>

        {!koristiNormativ && <p style={{ fontSize: 12, color: "var(--ink-faint)" }}>Uključi ako se projekt obračunava po ugovorenoj cijeni €/kg (npr. tipske kupaonice) — tada se vrijednost i sati računaju iz mase, a ne unose ručno po poziciji. Pod i komplet unose se odvojeno, kao zasebne stavke narudžbenice.</p>}

        {koristiNormativ && (
          <>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginBottom: 10 }}>
              Normativ: <strong>{db.normativi?.naziv}</strong> · {(db.normativi?.grupe || []).map((g) => `${g.naziv.split(" (")[0]}: ${g.cijenaKg} €/kg, ${g.ucinakKgH} kg/h`).join(" · ")}
              {!narudzba && <span> · Za uvoz stavki iz narudžbe prvo kreiraj narudžbu kupca za ovaj projekt.</span>}
            </div>

            <StavkeNormativaTablica naslov="Pod (podna konstrukcija)" rezultat={izracunNorm.pod} rasporedjeno={(id) => rasporedjenoZaStavku("stavkePod", id)} onDodaj={() => dodajStavku("stavkePod")} onAzuriraj={(id, patch) => azurirajStavku("stavkePod", id, patch)} onObrisi={(id) => obrisiStavku("stavkePod", id)} />
            <StavkeNormativaTablica naslov="Komplet (stranice + krov + spojni profili)" rezultat={izracunNorm.komplet} rasporedjeno={(id) => rasporedjenoZaStavku("stavkeKomplet", id)} onDodaj={() => dodajStavku("stavkeKomplet")} onAzuriraj={(id, patch) => azurirajStavku("stavkeKomplet", id, patch)} onObrisi={(id) => obrisiStavku("stavkeKomplet", id)} />

            {izracunNorm.pod.ukupno.komada > 0 && izracunNorm.komplet.ukupno.komada > 0 && izracunNorm.pod.ukupno.komada !== izracunNorm.komplet.ukupno.komada && (
              <p style={{ fontSize: 11.5, color: "var(--rust)", marginTop: -6, marginBottom: 14 }}>
                Napomena: ukupno komada poda ({izracunNorm.pod.ukupno.komada}) i kompleta ({izracunNorm.komplet.ukupno.komada}) se ne poklapaju.
              </p>
            )}

            <div className="card" style={{ padding: "10px 14px", marginBottom: 14, background: "var(--surface-alt)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong style={{ fontSize: 13 }}>UKUPNO PROJEKT</strong>
              <span className="f-mono" style={{ fontSize: 13 }}>{Math.round(izracunNorm.ukupno.masaUk).toLocaleString("hr-HR")} kg · {fmtCur(izracunNorm.ukupno.vrijednost)} · {izracunNorm.ukupno.sati.toFixed(1)} h</span>
            </div>

            {izracunNorm.ukupno.vrijednost > 0 && Math.abs(izracunNorm.ukupno.vrijednost - (Number(projekt.vrijednost) || 0)) > 1 && (
              <div style={{ marginBottom: 14 }}>
                <Btn variant="ghost" size="sm" onClick={() => patchProjekt({ vrijednost: Math.round(izracunNorm.ukupno.vrijednost) })}>Prepiši vrijednost projekta ({fmtCur(izracunNorm.ukupno.vrijednost)})</Btn>
              </div>
            )}

            {izracunNorm.ukupno.sati > 0 && (
              <>
                <div className="label" style={{ marginBottom: 6 }}>Planirani sati po operacijama (izračunato iz normativa)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
                  {OPERACIJE.filter((o) => izracunNorm.ukupno.satiPoOperaciji[o.key] > 0.01).map((o) => (
                    <div key={o.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "3px 8px", background: "var(--surface-alt)", borderRadius: 3 }}>
                      <span style={{ color: "var(--ink-soft)" }}>{o.label}</span>
                      <span className="f-mono" style={{ fontWeight: 600 }}>{izracunNorm.ukupno.satiPoOperaciji[o.key].toFixed(1)} h</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ===== Raspored isporuka (po stavkama poda/kompleta, djeljivo na više datuma) ===== */}
      {koristiNormativ && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <strong className="f-display" style={{ fontSize: 14 }}>Raspored isporuka ({isporuke.length})</strong>
            <Btn variant="ghost" size="sm" icon={Plus} onClick={dodajIsporuku} disabled={sveStavke.length === 0}>Dodaj isporuku</Btn>
          </div>
          {sveStavke.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--ink-faint)" }}>Prvo unesi barem jednu stavku poda ili kompleta.</p>
          ) : isporuke.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--ink-faint)" }}>Dodaj redak, izaberi tip (pod ili komplet) iz padajućeg izbornika i unesi koliko komada te stavke ide na koji datum — ista stavka može imati više redaka ako se isporučuje u više navrata.</p>
          ) : (
            <table className="erp-table">
              <thead><tr><th style={{ width: 40 }}>Br.</th><th>Tip</th><th style={{ width: 80 }}>Komada</th><th style={{ width: 150 }}>Datum isporuke</th><th style={{ width: 100 }}>Isporučeno</th><th></th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {[...isporuke].sort((a, b) => (a.datum || "9999").localeCompare(b.datum || "9999")).map((i) => {
                  const kasni = i.datum && !i.isporuceno && i.datum < todayISO();
                  const stavka = nadjiStavku(i.grupa, i.stavkaId);
                  return (
                    <tr key={i.id}>
                      <td className="f-mono">{i.redniBroj}</td>
                      <td>
                        <select className="select" value={`${i.grupa}:${i.stavkaId}`} onChange={(e) => { const [g, id] = e.target.value.split(":"); azurirajIsporuku(i.id, { grupa: g, stavkaId: id }); }}>
                          <optgroup label="Pod">
                            {stavkePod.map((s) => <option key={s.id} value={`stavkePod:${s.id}`}>{s.oznaka || "(bez oznake)"}</option>)}
                          </optgroup>
                          <optgroup label="Komplet">
                            {stavkeKomplet.map((s) => <option key={s.id} value={`stavkeKomplet:${s.id}`}>{s.oznaka || "(bez oznake)"}</option>)}
                          </optgroup>
                        </select>
                      </td>
                      <td><input className="input f-mono" type="number" min="0" step="1" max={stavka?.komada || undefined} value={i.komada} onChange={(e) => azurirajIsporuku(i.id, { komada: e.target.value })} /></td>
                      <td><input className="input" type="date" value={i.datum || ""} onChange={(e) => azurirajIsporuku(i.id, { datum: e.target.value })} /></td>
                      <td><input type="checkbox" checked={!!i.isporuceno} onChange={(e) => azurirajIsporuku(i.id, { isporuceno: e.target.checked })} /></td>
                      <td>{kasni && <span style={{ fontSize: 11, color: "var(--rust)", fontWeight: 600 }}>Kasni</span>}</td>
                      <td><button className="btn btn-icon btn-ghost" onClick={() => obrisiIsporuku(i.id)}><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Btn variant="ghost" icon={narudzba ? Pencil : Plus} onClick={() => setNarudzbaModal(true)}>{narudzba ? `Narudžba ${narudzba.broj}` : "Narudžba"}</Btn>
        <Btn variant="ghost" icon={Truck} onClick={() => setOtpremniceModal(true)}>Otpremnice{brojOtpremnica > 0 ? ` (${brojOtpremnica})` : ""}</Btn>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div className="label" style={{ marginBottom: 0 }}>Zadaci projekta</div>
          <span className="f-mono" style={{ fontSize: 12 }}>{zadaciDone}/{zadaci.length}</span>
        </div>
        <div className="card">
          {zadaci.length === 0 && <EmptyState text="Nema zadataka." />}
          {zadaci.map((z) => {
            const zakasnio = z.planiraniDatum && !z.izvrseno && daysUntil(z.planiraniDatum) < 0;
            return (
              <div key={z.id} style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="checkbox" checked={z.izvrseno} onChange={(e) => toggleZadatak(z.id, e.target.checked)} style={{ width: 15, height: 15, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13.5, textDecoration: z.izvrseno ? "line-through" : "none", color: z.izvrseno ? "var(--ink-faint)" : "var(--ink)" }}>{z.naziv}</span>
                  {zakasnio && <Badge status="Kasni" />}
                  <button className="btn btn-icon btn-ghost" onClick={() => obrisiZadatak(z.id)}><X size={14} /></button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginLeft: 25, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 11, color: "var(--ink-faint)" }}>Planirano do:</label>
                  <input type="date" className="input f-mono" style={{ width: 145, fontSize: 12, padding: "4px 8px", borderColor: zakasnio ? "var(--rust)" : undefined }} value={z.planiraniDatum || ""} onChange={(e) => postaviPlaniraniDatum(z.id, e.target.value)} />
                  <select className="select" style={{ maxWidth: 175, fontSize: 12, padding: "4px 8px" }} value={z.izvrsioId || ""} onChange={(e) => postaviIzvrsitelja(z.id, e.target.value)}>
                    <option value="">Izvršio…</option>
                    {[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((zz) => <option key={zz.id} value={zz.id}>{zz.prezime} {zz.ime}</option>)}
                  </select>
                  {z.izvrseno && z.datumIzvrsenja && <span style={{ fontSize: 11.5, color: "var(--green)" }}>✓ Izvršeno {fmtDate(z.datumIzvrsenja)}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input className="input" placeholder="Dodaj novi zadatak za ovaj projekt…" value={noviZadatak} onChange={(e) => setNoviZadatak(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") dodajZadatak(); }} />
          <input type="date" className="input" style={{ width: 150 }} value={noviZadatakDatum} onChange={(e) => setNoviZadatakDatum(e.target.value)} title="Planirani datum izvršenja" />
          <Btn variant="ghost" size="sm" icon={Plus} onClick={dodajZadatak}>Dodaj</Btn>
        </div>
      </div>

      {pozicije.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 6 }}>Pozicije (iz kalkulacije ponude)</div>
          <table className="erp-table">
            <thead><tr><th>Oz.</th><th>Naziv</th><th>Kom</th><th>Masa/kom</th><th>Ukupno masa</th><th>Sati</th></tr></thead>
            <tbody>
              {pozicije.map((p) => {
                const masaJed = p.nacinMase === "katalog" ? masaIzKataloga(db.katalogProfila.find((k) => k.id === p.katalogId), p.dimenzija) : Number(p.masaJed) || 0;
                const sati = OPERACIJE.reduce((s, o) => s + (Number(p.operacije?.[o.key]) || 0), 0);
                return (
                  <tr key={p.id}>
                    <td className="f-mono">{p.oznaka}</td>
                    <td>{p.naziv}</td>
                    <td className="f-mono">{p.kolicina}</td>
                    <td className="f-mono">{masaJed.toFixed(1)} kg</td>
                    <td className="f-mono">{(masaJed * Number(p.kolicina)).toFixed(1)} kg</td>
                    <td className="f-mono">{sati} h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div className="label" style={{ marginBottom: 0 }}>Potreban materijal za izradu</div>
          <Btn variant="ghost" size="sm" icon={FolderInput} onClick={pokreniKreiranjeUpita}>Kreiraj upit iz materijala</Btn>
        </div>
        <LineItemsEditor mode="materijal" rows={materijalStavke} setRows={azurirajMaterijal} materijali={db.materijali} katalog={db.katalogProfila} onCreateMaterijal={(entry) => kreirajMaterijalIzKataloga(entry, db, update)} />
      </div>

      {ostaleStavke.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 6 }}>Ostale stavke</div>
          <table className="erp-table">
            <thead><tr><th>Opis</th><th>Kom</th><th>Cijena/jed.</th></tr></thead>
            <tbody>{ostaleStavke.map((s, i) => <tr key={i}><td>{s.opis}</td><td className="f-mono">{s.kolicina} {s.jm}</td><td className="f-mono">{fmtCurDec(s.cijenaJed)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div>
        <div className="label" style={{ marginBottom: 6 }}>Radni nalozi</div>
        {nalozi.length === 0 ? <EmptyState text="Nema radnih naloga za ovaj projekt." /> : (
          <table className="erp-table">
            <thead><tr><th>Broj</th><th>Faza</th><th>Tim</th><th>Sati (utr./plan.)</th><th>Status</th></tr></thead>
            <tbody>
              {nalozi.map((n) => (
                <tr key={n.id}>
                  <td className="f-mono">{n.broj}</td>
                  <td>{n.faza}</td>
                  <td>{n.zaduzenTim || "—"}</td>
                  <td className="f-mono">{n.utrosenoSati} / {n.planiranoSati}</td>
                  <td><Badge status={n.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>

    {narudzbaModal && <NarudzbaModal narudzba={narudzba} projekt={projekt} db={db} update={update} showToast={showToast} onClose={() => setNarudzbaModal(false)} />}
    {otpremniceModal && <OtpremniceListModal projekt={projekt} narudzba={narudzba} db={db} update={update} showToast={showToast} onClose={() => setOtpremniceModal(false)} />}
    {normativOtvoren && <NormativiModal db={db} update={update} showToast={showToast} onClose={() => setNormativOtvoren(false)} />}
    {uvozOtvoren && narudzba && <NarudzbaUvozModal narudzba={narudzba} stavkePod={stavkePod} stavkeKomplet={stavkeKomplet} onUvezi={uveziIzNarudzbe} onClose={() => setUvozOtvoren(false)} />}
    </>
  );
}

/* ============================== PROJEKTI I PONUDE ============================== */
// Priprema i pokušaj otvaranja e-mail klijenta korisnika s obavijesti o dodjeli voditelja projekta
// NAPOMENA: artefakt nema pristup serveru za slanje e-pošte, pa ovo otvara mailto: koji korisnik treba potvrditi/poslati u svom mail programu.
const posaljiObavijestVoditelju = (projekt, zaposlenik) => {
  if (!zaposlenik?.email) return false;
  const subject = `Dodijeljen/a si kao voditelj projekta ${projekt.sifra} — ${projekt.naziv}`;
  const body = `Pozdrav ${zaposlenik.ime},\n\nDodijeljen/a si kao voditelj/ica projekta:\n\nŠifra: ${projekt.sifra}\nNaziv: ${projekt.naziv}\nRok završetka: ${fmtDate(projekt.rokZavrsetka)}\nVrijednost: ${fmtCur(projekt.vrijednost)}\n\nPrijavi se u ERP za popis zadataka i detalje.\n\nLijep pozdrav,\nECON D.O.O. ERP`;
  window.open(`mailto:${zaposlenik.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
  return true;
};

function PonudaPrintModal({ ponuda, kupac, db, onClose }) {
  const t = db.postavkeTvrtke || {};
  const calc = izracunPonude(ponuda, db.materijali, db.cjenikRada);
  const pdvStopa = Number(t.pdvStopa ?? 25);
  const izradaIznos = calc.trosakRada + calc.trosakMaterijala;
  const komercijalneStavke = [{ opis: "Izrada i isporuka čelične konstrukcije (materijal i rad)", iznos: izradaIznos }, ...(ponuda.ostaleStavke || []).map((s) => ({ opis: s.opis, iznos: (Number(s.kolicina) || 0) * (Number(s.cijenaJed) || 0) }))];
  const osnovica = komercijalneStavke.reduce((s, r) => s + r.iznos, 0);
  const pdvIznos = osnovica * (pdvStopa / 100);
  const ukupno = osnovica + pdvIznos;

  return (
    <Modal wide title={`Pregled za ispis — Ponuda ${ponuda.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => window.print()}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>PONUDA</div>
            <div className="f-mono" style={{ fontSize: 13 }}>Broj: {ponuda.broj}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.naziv}</div>
            <div style={{ fontSize: 9.5, color: "#555", maxWidth: 260 }}>{t.djelatnost}</div>
            <div>{t.adresa}</div>
            <div>{t.telefon}</div>
            <div>{t.email}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 11.5 }}>
          <div>
            <div style={{ color: "#555", marginBottom: 3 }}>Naručitelj:</div>
            <div style={{ fontWeight: 700 }}>{kupac?.naziv || "—"}</div>
            <div>{kupac?.adresa}</div>
            {kupac?.oib && <div>OIB: {kupac.oib}</div>}
          </div>
          <table style={{ borderCollapse: "collapse", height: "fit-content" }}>
            <tbody>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Datum ponude:</td><td style={{ fontWeight: 600 }}>{fmtDate(ponuda.datum)}</td></tr>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Ponuda vrijedi do:</td><td style={{ fontWeight: 600 }}>{fmtDate(addDays(ponuda.datum, 30))}</td></tr>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Predmet:</td><td style={{ fontWeight: 600 }}>{ponuda.naziv}</td></tr>
            </tbody>
          </table>
        </div>

        {(ponuda.pozicije || []).length > 0 && (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Tehnički opis konstrukcije</div>
            <table className="doc-table" style={{ marginBottom: 16 }}>
              <thead><tr><th style={{ width: 34 }}>Poz.</th><th>Naziv</th><th style={{ width: 55 }}>Kom.</th><th style={{ width: 80 }}>Masa (kg)</th></tr></thead>
              <tbody>
                {ponuda.pozicije.map((p) => {
                  const masaJed = p.nacinMase === "katalog" ? masaIzKataloga(db.katalogProfila.find((k) => k.id === p.katalogId), p.dimenzija) : Number(p.masaJed) || 0;
                  return <tr key={p.id}><td>{p.oznaka}</td><td>{p.naziv}</td><td>{p.kolicina}</td><td>{(masaJed * Number(p.kolicina)).toFixed(1)}</td></tr>;
                })}
              </tbody>
            </table>
          </>
        )}

        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Komercijalna ponuda</div>
        <table className="doc-table" style={{ marginBottom: 14 }}>
          <thead><tr><th>Opis</th><th style={{ width: 100 }}>Iznos</th></tr></thead>
          <tbody>{komercijalneStavke.map((r, i) => <tr key={i}><td>{r.opis}</td><td>{fmtCurDec(r.iznos)}</td></tr>)}</tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 240 }}>
            <tbody>
              <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>Osnovica:</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(osnovica)}</td></tr>
              <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>PDV ({pdvStopa}%):</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(pdvIznos)}</td></tr>
              <tr style={{ borderTop: "1px solid #333" }}><td style={{ padding: "6px 14px 0 0", fontWeight: 700 }}>UKUPNO:</td><td style={{ textAlign: "right", fontWeight: 700, paddingTop: 6, fontSize: 14 }}>{fmtCurDec(ukupno)}</td></tr>
            </tbody>
          </table>
        </div>

        {ponuda.napomena && <div style={{ fontSize: 11, marginBottom: 16 }}><strong>Napomena:</strong> {ponuda.napomena}</div>}

        <div style={{ fontSize: 11, marginBottom: 20 }}>
          <div>Uvjeti plaćanja i rok isporuke definiraju se ugovorom/narudžbom po prihvaćanju ponude.</div>
          <div style={{ marginTop: 10 }}>S poštovanjem,</div>
          <div style={{ fontWeight: 700, marginTop: 8 }}>{t.naziv}</div>
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

function ProjektiPage({ db, update, showToast, setPage }) {
  const [tab, setTab] = useState("projekti");
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);

  const noviZadaciIzStandarda = () => (db.standardniZadaci || []).map((t) => ({ id: uid("zad"), naziv: t.naziv, izvrseno: false, izvrsioId: null, datumIzvrsenja: null, planiraniDatum: null }));
  const emptyProj = () => ({ sifra: "", naziv: "", kupacId: db.kupci[0]?.id || "", status: "Ponuda", vrijednost: 0, rokPocetka: todayISO(), rokZavrsetka: todayISO(), opis: "", voditeljId: "", zadaci: noviZadaciIzStandarda() });
  const [projForm, setProjForm] = useState(emptyProj());

  const emptyPon = () => ({ id: null, broj: sljedeciBroj(db.ponude, "broj", "PON-2026-"), naziv: "", kupacId: db.kupci[0]?.id || "", datum: todayISO(), status: "U izradi", napomena: "", projektId: null, pozicije: [], materijalStavke: [], ostaleStavke: [] });
  const [ponForm, setPonForm] = useState(emptyPon());
  const [cjenikOpen, setCjenikOpen] = useState(false);
  const [zadaciOpen, setZadaciOpen] = useState(false);
  const [detalj, setDetalj] = useState(null);
  const [printPonuda, setPrintPonuda] = useState(null);

  const kupacNaziv = (id) => db.kupci.find((k) => k.id === id)?.naziv || "—";
  const projSifra = (id) => db.projekti.find((p) => p.id === id)?.sifra || "";

  const saveProj = () => {
    if (!projForm.sifra.trim() || !projForm.naziv.trim()) return;
    const payload = { ...projForm, vrijednost: Number(projForm.vrijednost) };
    const stariProjekt = projForm.id ? db.projekti.find((p) => p.id === projForm.id) : null;
    const voditeljPromijenjen = payload.voditeljId && payload.voditeljId !== stariProjekt?.voditeljId;
    if (projForm.id) update("projekti", db.projekti.map((p) => (p.id === projForm.id ? payload : p)));
    else update("projekti", [...db.projekti, { ...payload, id: uid("proj") }]);
    setModal(null);
    if (voditeljPromijenjen) {
      const zaposlenik = db.zaposlenici.find((z) => z.id === payload.voditeljId);
      const poslano = posaljiObavijestVoditelju(payload, zaposlenik);
      showToast(poslano ? `Projekt spremljen. Otvoren e-mail za ${zaposlenik.ime} ${zaposlenik.prezime}.` : "Projekt spremljen. Voditelj nema unesen e-mail — obavijest nije pripremljena.");
    } else {
      showToast("Projekt spremljen.");
    }
  };
  const savePon = () => {
    if (!ponForm.naziv.trim()) return;
    if (ponForm.id) update("ponude", db.ponude.map((p) => (p.id === ponForm.id ? ponForm : p)));
    else update("ponude", [...db.ponude, { ...ponForm, id: uid("pon") }]);
    setModal(null);
    showToast("Ponuda spremljena.");
  };
  const saveCjenik = (novi) => {
    const cleaned = Object.fromEntries(Object.entries(novi).map(([k, v]) => [k, Number(v) || 0]));
    update("cjenikRada", cleaned);
    setCjenikOpen(false);
    showToast("Cjenik rada ažuriran.");
  };
  const pretvoriUProjekt = (ponuda) => {
    const calc = izracunPonude(ponuda, db.materijali, db.cjenikRada);
    const noviProjekt = {
      id: uid("proj"), sifra: sljedeciBroj(db.projekti, "sifra", "PRJ-2026-"), naziv: ponuda.naziv, kupacId: ponuda.kupacId,
      status: "Odobren", vrijednost: Math.round(calc.ukupno), rokPocetka: todayISO(), rokZavrsetka: addDays(todayISO(), 60),
      opis: `Kreirano iz ponude ${ponuda.broj}.`,
      izvorPonudaId: ponuda.id, pozicije: ponuda.pozicije || [], materijalStavke: ponuda.materijalStavke || [], ostaleStavke: ponuda.ostaleStavke || [],
      voditeljId: "", zadaci: noviZadaciIzStandarda(),
    };
    let rnBrojac = parseInt(sljedeciBrojRadnogNaloga(db.radniNalozi, noviProjekt.sifra).split("/").pop(), 10);
    const sljedeciRnBroj = () => `${noviProjekt.sifra}/${rnBrojac++}`;
    let noviNalozi = OPERACIJE.filter((o) => calc.satiPoOperaciji[o.key] > 0).map((o) => ({
      id: uid("rn"), broj: sljedeciRnBroj(), projektId: noviProjekt.id,
      naziv: `${o.label} — ${ponuda.naziv}`, faza: o.label, zaduzenTim: "", status: "Planiran",
      planiranoSati: calc.satiPoOperaciji[o.key], utrosenoSati: 0, datumPocetka: todayISO(), datumZavrsetka: addDays(todayISO(), 14),
      stavke: o.key === "pripremaPozicija" ? ponuda.materijalStavke || [] : [], materijalIzdan: false,
    }));
    // Osiguraj da materijal iz ponude uvijek završi na nekom radnom nalogu, čak i ako "priprema pozicija" nema planiranih sati
    const imaPripremuNalog = noviNalozi.some((n) => n.faza === "Priprema pozicija za sklapanje");
    if (!imaPripremuNalog && (ponuda.materijalStavke || []).length > 0) {
      noviNalozi = [...noviNalozi, {
        id: uid("rn"), broj: sljedeciRnBroj(), projektId: noviProjekt.id,
        naziv: `Priprema materijala — ${ponuda.naziv}`, faza: "Priprema pozicija za sklapanje", zaduzenTim: "", status: "Planiran",
        planiranoSati: 0, utrosenoSati: 0, datumPocetka: todayISO(), datumZavrsetka: addDays(todayISO(), 14),
        stavke: ponuda.materijalStavke || [], materijalIzdan: false,
      }];
    }
    update("projekti", [...db.projekti, noviProjekt]);
    update("radniNalozi", [...db.radniNalozi, ...noviNalozi]);
    update("ponude", db.ponude.map((p) => (p.id === ponuda.id ? { ...p, projektId: noviProjekt.id } : p)));
    showToast(`Projekt ${noviProjekt.sifra} kreiran s ${noviNalozi.length} radnih naloga.`);
    setTab("projekti");
  };

  return (
    <div>
      <PageHeader title="Projekti i ponude" subtitle="Praćenje projekata od ponude do realizacije" icon={Building2} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 20 }}>
          <div className={`nav-tab ${tab === "projekti" ? "active" : ""}`} onClick={() => setTab("projekti")}>Projekti</div>
          <div className={`nav-tab ${tab === "ponude" ? "active" : ""}`} onClick={() => setTab("ponude")}>Ponude</div>
        </div>
        {tab === "ponude" && <Btn variant="ghost" size="sm" icon={Settings} onClick={() => setCjenikOpen(true)}>Cjenik rada</Btn>}
        {tab === "projekti" && <Btn variant="ghost" size="sm" icon={Settings} onClick={() => setZadaciOpen(true)}>Standardni zadaci</Btn>}
      </div>

      {tab === "projekti" && (
        <EntityPage
          title="" data={db.projekti}
          onAdd={() => { setProjForm(emptyProj()); setModal("proj"); }}
          onEdit={(row) => { setProjForm({ ...emptyProj(), ...row, zadaci: row.zadaci || noviZadaciIzStandarda(), voditeljId: row.voditeljId || "" }); setModal("proj"); }}
          onDelete={(r) => setDel({ type: "proj", row: r })}
          addLabel="Novi projekt" searchKeys={["sifra", "naziv"]}
          columns={[
            { key: "sifra", label: "Šifra", render: (r) => <span className="f-mono">{r.sifra}</span> },
            { key: "naziv", label: "Naziv" },
            { key: "kupac", label: "Kupac", render: (r) => kupacNaziv(r.kupacId) },
            { key: "voditelj", label: "Voditelj", render: (r) => { const v = db.zaposlenici.find((z) => z.id === r.voditeljId); return v ? `${v.prezime} ${v.ime}` : <span style={{ color: "var(--ink-faint)" }}>—</span>; } },
            { key: "vrijednost", label: "Vrijednost", render: (r) => <span className="f-mono">{fmtCur(r.vrijednost)}</span> },
            { key: "zadaci", label: "Zadaci", render: (r) => { const z = r.zadaci || []; const done = z.filter((x) => x.izvrseno).length; return z.length ? <span className="f-mono">{done}/{z.length}</span> : "—"; } },
            { key: "rokZavrsetka", label: "Rok završetka", render: (r) => fmtDate(r.rokZavrsetka) },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            { key: "detalji", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => setDetalj(r)}>Detalji</Btn> },
          ]}
        />
      )}

      {tab === "ponude" && (
        <EntityPage
          title="" data={db.ponude}
          onAdd={() => { setPonForm(emptyPon()); setModal("pon"); }}
          onEdit={(row) => { setPonForm({ ...emptyPon(), ...JSON.parse(JSON.stringify(row)), pozicije: row.pozicije || [], materijalStavke: row.materijalStavke || [], ostaleStavke: row.ostaleStavke || [] }); setModal("pon"); }}
          onDelete={(r) => setDel({ type: "pon", row: r })}
          addLabel="Nova ponuda" searchKeys={["broj", "naziv"]}
          columns={[
            { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
            { key: "naziv", label: "Naziv posla" },
            { key: "kupac", label: "Kupac", render: (r) => kupacNaziv(r.kupacId) },
            { key: "sati", label: "Sati", render: (r) => <span className="f-mono">{izracunPonude(r, db.materijali, db.cjenikRada).ukupnoSati} h</span> },
            { key: "ukupno", label: "Vrijednost", render: (r) => <span className="f-mono">{fmtCurDec(izracunPonude(r, db.materijali, db.cjenikRada).ukupno)}</span> },
            { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            { key: "pdf", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => setPrintPonuda(r)}>PDF ponude</Btn> },
            {
              key: "akcija", label: "", render: (r) =>
                r.projektId ? <span style={{ fontSize: 11, color: "var(--green)" }}>→ {projSifra(r.projektId)}</span>
                : r.status === "Prihvaćena" ? <Btn size="sm" icon={FolderInput} onClick={() => pretvoriUProjekt(r)}>Pretvori u projekt</Btn>
                : null
            },
          ]}
        />
      )}

      {modal === "proj" && (
        <Modal title={projForm.id ? "Uredi projekt" : "Novi projekt"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={saveProj}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Šifra projekta"><input className="input" value={projForm.sifra} onChange={(e) => setProjForm({ ...projForm, sifra: e.target.value })} /></Field>
            <Field label="Kupac"><select className="select" value={projForm.kupacId} onChange={(e) => setProjForm({ ...projForm, kupacId: e.target.value })}>{db.kupci.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}</select></Field>
          </div>
          <Field label="Naziv projekta"><input className="input" value={projForm.naziv} onChange={(e) => setProjForm({ ...projForm, naziv: e.target.value })} /></Field>
          <Field label="Voditelj projekta">
            <select className="select" value={projForm.voditeljId || ""} onChange={(e) => setProjForm({ ...projForm, voditeljId: e.target.value })}>
              <option value="">— Nije dodijeljen —</option>
              {[...db.zaposlenici].filter((z) => z.status === "Aktivan").sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr")).map((z) => <option key={z.id} value={z.id}>{z.prezime} {z.ime}</option>)}
            </select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Status"><select className="select" value={projForm.status} onChange={(e) => setProjForm({ ...projForm, status: e.target.value })}>{["Ponuda", "Odobren", "U izradi", "Montaža", "Završen", "Otkazan"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Vrijednost (€)"><input className="input f-mono" type="number" value={projForm.vrijednost} onChange={(e) => setProjForm({ ...projForm, vrijednost: e.target.value })} /></Field>
            <div />
            <Field label="Rok početka"><input className="input" type="date" value={projForm.rokPocetka} onChange={(e) => setProjForm({ ...projForm, rokPocetka: e.target.value })} /></Field>
            <Field label="Rok završetka"><input className="input" type="date" value={projForm.rokZavrsetka} onChange={(e) => setProjForm({ ...projForm, rokZavrsetka: e.target.value })} /></Field>
          </div>
          <Field label="Opis"><textarea className="textarea" rows={3} value={projForm.opis} onChange={(e) => setProjForm({ ...projForm, opis: e.target.value })} /></Field>
        </Modal>
      )}

      {modal === "pon" && (() => {
        const calc = izracunPonude(ponForm, db.materijali, db.cjenikRada);
        return (
          <Modal wide title={ponForm.id ? `Ponuda ${ponForm.broj}` : "Nova ponuda"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={savePon}>Spremi</Btn></>}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
              <Field label="Naziv posla / konstrukcije"><input className="input" placeholder="npr. Nadstrešnica autobusnog kolodvora" value={ponForm.naziv} onChange={(e) => setPonForm({ ...ponForm, naziv: e.target.value })} /></Field>
              <Field label="Kupac"><select className="select" value={ponForm.kupacId} onChange={(e) => setPonForm({ ...ponForm, kupacId: e.target.value })}>{db.kupci.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}</select></Field>
              <Field label="Datum"><input className="input" type="date" value={ponForm.datum} onChange={(e) => setPonForm({ ...ponForm, datum: e.target.value })} /></Field>
            </div>
            <Field label="Status"><select className="select" style={{ maxWidth: 220 }} value={ponForm.status} onChange={(e) => setPonForm({ ...ponForm, status: e.target.value })}>{["U izradi", "Poslana", "Prihvaćena", "Odbijena"].map((s) => <option key={s}>{s}</option>)}</select></Field>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              <label className="label" style={{ marginBottom: 0 }}>Pozicije i kalkulacija sati</label>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>Satnice se uređuju putem gumba "Cjenik rada"</span>
            </div>
            <div style={{ marginTop: 8, marginBottom: 16 }}>
              <PozicijeEditor pozicije={ponForm.pozicije} setPozicije={(rows) => setPonForm({ ...ponForm, pozicije: rows })} cjenikRada={db.cjenikRada} katalog={db.katalogProfila} />
            </div>

            <Field label="Materijal (iz skladišta)"><LineItemsEditor mode="materijal" rows={ponForm.materijalStavke} setRows={(rows) => setPonForm({ ...ponForm, materijalStavke: rows })} materijali={db.materijali} katalog={db.katalogProfila} onCreateMaterijal={(entry) => kreirajMaterijalIzKataloga(entry, db, update)} /></Field>
            <Field label="Ostale stavke (transport, montaža na terenu, projektiranje…)"><LineItemsEditor mode="custom" rows={ponForm.ostaleStavke} setRows={(rows) => setPonForm({ ...ponForm, ostaleStavke: rows })} materijali={db.materijali} /></Field>
            <Field label="Napomena"><textarea className="textarea" rows={2} value={ponForm.napomena} onChange={(e) => setPonForm({ ...ponForm, napomena: e.target.value })} /></Field>

            <div className="card" style={{ padding: 14, background: "var(--surface-alt)", marginTop: 4 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, fontSize: 12.5 }}>
                <div><div style={{ color: "var(--ink-soft)" }}>Trošak rada ({calc.ukupnoSati} h)</div><div className="f-mono" style={{ fontSize: 15, fontWeight: 700 }}>{fmtCurDec(calc.trosakRada)}</div></div>
                <div><div style={{ color: "var(--ink-soft)" }}>Trošak materijala</div><div className="f-mono" style={{ fontSize: 15, fontWeight: 700 }}>{fmtCurDec(calc.trosakMaterijala)}</div></div>
                <div><div style={{ color: "var(--ink-soft)" }}>Ostalo</div><div className="f-mono" style={{ fontSize: 15, fontWeight: 700 }}>{fmtCurDec(calc.trosakOstalo)}</div></div>
                <div><div style={{ color: "var(--ink-soft)" }}>Ukupna vrijednost ponude</div><div className="f-mono" style={{ fontSize: 17, fontWeight: 700, color: "var(--steel)" }}>{fmtCurDec(calc.ukupno)}</div></div>
              </div>
            </div>
          </Modal>
        );
      })()}

      {cjenikOpen && <CjenikRadaModal cjenikRada={db.cjenikRada} onSave={saveCjenik} onClose={() => setCjenikOpen(false)} />}
      {zadaciOpen && <StandardniZadaciModal standardniZadaci={db.standardniZadaci} update={update} showToast={showToast} onClose={() => setZadaciOpen(false)} />}
      {detalj && <ProjektDetaljModal projekt={db.projekti.find((p) => p.id === detalj.id) || detalj} db={db} update={update} showToast={showToast} setPage={setPage} onClose={() => setDetalj(null)} />}
      {printPonuda && <PonudaPrintModal ponuda={printPonuda} kupac={db.kupci.find((k) => k.id === printPonuda.kupacId)} db={db} onClose={() => setPrintPonuda(null)} />}

      {del && (
        <ConfirmDelete
          label={del.type === "proj" ? del.row.naziv : del.row.broj}
          onCancel={() => setDel(null)}
          onConfirm={() => {
            if (del.type === "proj") update("projekti", db.projekti.filter((p) => p.id !== del.row.id));
            else update("ponude", db.ponude.filter((p) => p.id !== del.row.id));
            setDel(null);
            showToast("Stavka obrisana.");
          }}
        />
      )}
    </div>
  );
}

/* ============================== FAKTURIRANJE ============================== */
function FakturaPrintModal({ faktura, kupac, projekt, postavkeTvrtke, onClose }) {
  const t = postavkeTvrtke || {};
  const calc = izracunFakture(faktura, t.pdvStopa);
  return (
    <Modal wide title={`Pregled za ispis — Faktura ${faktura.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => window.print()}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>RAČUN</div>
            <div className="f-mono" style={{ fontSize: 13 }}>Broj: {faktura.broj}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.naziv}</div>
            <div>{t.adresa}</div>
            <div>{t.telefon}</div>
            <div>{t.email}</div>
            <div>OIB: {t.oib}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 11.5 }}>
          <div>
            <div style={{ color: "#555", marginBottom: 3 }}>Kupac:</div>
            <div style={{ fontWeight: 700 }}>{kupac?.naziv || "—"}</div>
            <div>{kupac?.adresa}</div>
            {kupac?.oib && <div>OIB: {kupac.oib}</div>}
          </div>
          <table style={{ borderCollapse: "collapse", height: "fit-content" }}>
            <tbody>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Datum izdavanja:</td><td style={{ fontWeight: 600 }}>{fmtDate(faktura.datumIzdavanja)}</td></tr>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Rok plaćanja:</td><td style={{ fontWeight: 600 }}>{fmtDate(faktura.rokPlacanja)}</td></tr>
              <tr><td style={{ paddingRight: 10, color: "#555" }}>Poziv na broj:</td><td style={{ fontWeight: 600 }}>{faktura.broj}</td></tr>
              {projekt && <tr><td style={{ paddingRight: 10, color: "#555" }}>Projekt:</td><td style={{ fontWeight: 600 }}>{projekt.sifra}</td></tr>}
            </tbody>
          </table>
        </div>

        <table className="doc-table" style={{ marginBottom: 14 }}>
          <thead><tr><th style={{ width: 30 }}>R.br.</th><th>Opis</th><th style={{ width: 55 }}>Kom.</th><th style={{ width: 45 }}>JM</th><th style={{ width: 80 }}>Cijena/jed.</th><th style={{ width: 90 }}>Iznos</th></tr></thead>
          <tbody>
            {(faktura.stavke || []).map((s, i) => (
              <tr key={i}><td>{i + 1}.</td><td>{s.opis}</td><td>{s.kolicina}</td><td>{s.jm}</td><td>{fmtCurDec(s.cijenaJed)}</td><td>{fmtCurDec(s.kolicina * s.cijenaJed)}</td></tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 240 }}>
            <tbody>
              <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>Osnovica:</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(calc.osnovica)}</td></tr>
              <tr><td style={{ padding: "3px 14px 3px 0", color: "#555" }}>PDV ({calc.stopa}%):</td><td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCurDec(calc.pdvIznos)}</td></tr>
              <tr style={{ borderTop: "1px solid #333" }}><td style={{ padding: "6px 14px 0 0", fontWeight: 700 }}>UKUPNO ZA PLATITI:</td><td style={{ textAlign: "right", fontWeight: 700, paddingTop: 6, fontSize: 14 }}>{fmtCurDec(calc.ukupno)}</td></tr>
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 11, marginBottom: 20 }}>
          <div>Molimo uplatu izvršiti na žiro račun/IBAN: <strong>{t.iban}</strong> ({t.naziv}), s pozivom na broj <strong>{faktura.broj}</strong>.</div>
        </div>

        <div style={{ border: "1px solid #c9a227", background: "#fdf6e3", padding: "8px 10px", fontSize: 9.5, color: "#6b5511", marginBottom: 16, lineHeight: 1.5 }}>
          <strong>Napomena:</strong> Ovo je interni/predračunski ispis iz ERP sustava. Od 1.1.2026. B2B računi u Hrvatskoj moraju biti izdani kao fiskalizirani eRačun (Fiskalizacija 2.0) — ovaj PDF ne zamjenjuje tu zakonsku obvezu. Za pravno valjano izdavanje računa prema drugim tvrtkama koristite ovlašteni sustav za eRačune (npr. besplatnu aplikaciju MikroeRačun ili informacijskog posrednika).
        </div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>Žiro račun:</strong> {t.ziroRacun}<br />
          <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

/* ============================== PODLOGA ZA FAKTURU ============================== */
// Spaja stavke odabranih otpremnica po istoj stavci narudžbe (zbraja količine ako se
// ista stavka isporučuje kroz više otpremnica) i množi s cijenom iz narudžbe kupca.
const izracunajStavkePodloge = (otpremniceOdabrane, narudzba) => {
  const mapa = {};
  otpremniceOdabrane.forEach((o) => {
    o.stavke.forEach((s) => {
      const nst = narudzba?.stavke?.find((n) => n.id === s.narudzbaStavkaId);
      const key = s.narudzbaStavkaId || s.naziv;
      if (!mapa[key]) mapa[key] = { naziv: s.naziv, sifra: nst?.sifra || "", jm: s.jm, cijena: Number(nst?.cijena) || 0, kolicina: 0 };
      mapa[key].kolicina += Number(s.kolicina) || 0;
    });
  });
  return Object.values(mapa).map((s) => ({ ...s, ukupno: s.kolicina * s.cijena }));
};

function PodlogaZaFakturuFormModal({ db, update, showToast, onClose }) {
  const [projektId, setProjektId] = useState("");
  const [odabraneOtpId, setOdabraneOtpId] = useState([]);
  const [vorkasa, setVorkasa] = useState(0);
  const [datum, setDatum] = useState(todayISO());

  const otpremniceZaProjekt = db.otpremnice.filter((o) => o.projektId === projektId);
  const projekt = db.projekti.find((p) => p.id === projektId);
  const narudzba = db.narudzbe.find((n) => n.projektId === projektId);
  const odabraneOtp = otpremniceZaProjekt.filter((o) => odabraneOtpId.includes(o.id));
  const stavke = izracunajStavkePodloge(odabraneOtp, narudzba);
  const zbroj = stavke.reduce((s, x) => s + x.ukupno, 0);
  const zaPlatiti = zbroj - (Number(vorkasa) || 0);

  const toggleOtp = (id) => setOdabraneOtpId((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const spremi = () => {
    if (!projekt) { showToast("Odaberi projekt."); return; }
    if (odabraneOtp.length === 0) { showToast("Odaberi barem jednu otpremnicu."); return; }
    const nova = {
      id: uid("pdf"), broj: sljedeciBrojPodloge(db.podlogeZaFakturu, projekt.sifra),
      projektId, otpremniceIds: odabraneOtpId, narudzbaId: narudzba?.id || null,
      datum, vorkasa: Number(vorkasa) || 0, stavke, zbroj, zaPlatiti,
    };
    update("podlogeZaFakturu", [...db.podlogeZaFakturu, nova]);
    showToast("Podloga za fakturu kreirana.");
    onClose();
  };

  return (
    <Modal wide title="Nova podloga za fakturu" onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi}>Kreiraj podlogu</Btn></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Projekt">
          <select className="select" value={projektId} onChange={(e) => { setProjektId(e.target.value); setOdabraneOtpId([]); }}>
            <option value="">— Odaberi —</option>
            {db.projekti.filter((p) => db.otpremnice.some((o) => o.projektId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}
          </select>
        </Field>
        <Field label="Datum obračuna"><input className="input" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></Field>
      </div>

      {projektId && (
        <>
          {!narudzba && <div style={{ fontSize: 12.5, color: "var(--rust)", marginBottom: 10 }}>Ovaj projekt nema narudžbu kupca — cijene neće biti dostupne.</div>}
          <div className="label" style={{ marginTop: 6, marginBottom: 6 }}>Otpremnice za uključiti u obračun</div>
          {otpremniceZaProjekt.length === 0 ? <EmptyState text="Nema otpremnica za ovaj projekt." /> : (
            <table className="erp-table">
              <thead><tr><th style={{ width: 30 }}></th><th>Broj</th><th>Datum</th><th>Stavki</th></tr></thead>
              <tbody>
                {otpremniceZaProjekt.map((o) => (
                  <tr key={o.id}>
                    <td><input type="checkbox" checked={odabraneOtpId.includes(o.id)} onChange={() => toggleOtp(o.id)} /></td>
                    <td className="f-mono">{o.broj}</td>
                    <td>{fmtDate(o.datum)}</td>
                    <td className="f-mono">{o.stavke.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {stavke.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 14, marginBottom: 6 }}>Pregled stavki</div>
              <table className="erp-table">
                <thead><tr><th>Naziv</th><th style={{ width: 70 }}>JM</th><th style={{ width: 80 }}>Kol.</th><th style={{ width: 100 }}>Cijena</th><th style={{ width: 110 }}>Ukupno</th></tr></thead>
                <tbody>{stavke.map((s, i) => <tr key={i}><td>{s.sifra ? `${s.sifra} — ` : ""}{s.naziv}</td><td className="f-mono">{s.jm}</td><td className="f-mono">{s.kolicina}</td><td className="f-mono">{fmtCurDec(s.cijena)}</td><td className="f-mono">{fmtCurDec(s.ukupno)}</td></tr>)}</tbody>
              </table>

              <div className="card" style={{ padding: 12, background: "var(--surface-alt)", marginTop: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
                  <div><div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Zbroj</div><div className="f-mono" style={{ fontWeight: 700 }}>{fmtCurDec(zbroj)}</div></div>
                  <Field label="Predujam (Vorkasse)"><input className="input f-mono" type="number" step="0.01" value={vorkasa} onChange={(e) => setVorkasa(e.target.value)} /></Field>
                  <div><div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Za platiti</div><div className="f-mono" style={{ fontWeight: 700, color: "var(--steel)", fontSize: 16 }}>{fmtCurDec(zaPlatiti)}</div></div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function PodlogaZaFakturuPrintModal({ podloga, projekt, narudzba, kupac, otpremnice, postavkeTvrtke, onClose }) {
  const t = postavkeTvrtke || {};
  return (
    <Modal wide title={`Pregled za ispis — Podloga za fakturu ${podloga.broj}`} onClose={onClose} footer={<><Btn onClick={onClose}>Zatvori</Btn><Btn variant="primary" icon={Save} onClick={() => window.print()}>Ispis / Spremi kao PDF</Btn></>}>
      <div className="print-doc" style={{ background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ marginBottom: 16, fontSize: 10.5 }}>
          <strong>{t.naziv}</strong><div>{t.adresa}</div>
        </div>

        <div style={{ border: "1px solid #333", padding: "10px 14px", marginBottom: 16 }}>
          <div style={{ textAlign: "center", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>PODLOGA ZA FAKTURU / <span style={{ fontStyle: "italic" }}>ABRECHNUNG</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 11 }}>
            <div>
              <div style={{ fontWeight: 700 }}>AG / Kupac:</div>
              <div>{kupac?.naziv}</div>
              <div>{kupac?.adresa}</div>
            </div>
            <div>
              <div><strong>Bestellung Nr.:</strong> {narudzba?.broj || "—"}</div>
              <div><strong>Bestelldatum:</strong> {narudzba ? fmtDate(narudzba.datum) : "—"}</div>
              <div><strong>Projekt:</strong> {projekt?.sifra}{projekt?.naziv ? ` — ${projekt.naziv}` : ""}</div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, marginBottom: 12 }}>
          <strong>Lieferscheine:</strong> {otpremnice.map((o) => o.broj).join(", ") || "—"}
        </div>

        <table className="doc-table" style={{ marginBottom: 16 }}>
          <thead><tr><th style={{ width: 30 }}>Nr.</th><th>Leistungsbeschreibung</th><th style={{ width: 60 }}>Menge</th><th style={{ width: 60 }}>Einheit</th><th style={{ width: 80 }}>E.P (€)</th><th style={{ width: 90 }}>G.P. (€)</th></tr></thead>
          <tbody>
            {podloga.stavke.map((s, i) => (
              <tr key={i}>
                <td>{i + 1}.</td>
                <td>{s.sifra && <div style={{ fontWeight: 700 }}>{s.sifra}</div>}<div>{s.naziv}</div></td>
                <td className="f-mono">{s.kolicina}</td>
                <td>{s.jm}</td>
                <td className="f-mono">{fmtCurDec(s.cijena)}</td>
                <td className="f-mono">{fmtCurDec(s.ukupno)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table style={{ marginLeft: "auto", fontSize: 12, borderCollapse: "collapse", minWidth: 260 }}>
          <tbody>
            <tr><td style={{ padding: "4px 10px", border: "1px solid #333" }}>Summe:</td><td style={{ padding: "4px 10px", border: "1px solid #333", textAlign: "right", fontWeight: 700 }} className="f-mono">{fmtCurDec(podloga.zbroj)}</td></tr>
            <tr><td style={{ padding: "4px 10px", border: "1px solid #333" }}>Vorkasse:</td><td style={{ padding: "4px 10px", border: "1px solid #333", textAlign: "right" }} className="f-mono">{fmtCurDec(podloga.vorkasa)}</td></tr>
            <tr><td style={{ padding: "4px 10px", border: "1px solid #333", fontWeight: 700 }}>Gesamt zu Zahlen:</td><td style={{ padding: "4px 10px", border: "1px solid #333", textAlign: "right", fontWeight: 700 }} className="f-mono">{fmtCurDec(podloga.zaPlatiti)}</td></tr>
          </tbody>
        </table>

        <div style={{ marginTop: 20, fontSize: 11 }}>DATUM: {fmtDate(podloga.datum)}</div>

        <div style={{ borderTop: "1px solid #999", paddingTop: 8, marginTop: 24, fontSize: 8.5, color: "#333", lineHeight: 1.5 }}>
          <strong>OIB</strong>: {t.oib} | <strong>MB</strong>: {t.mb} | <strong>VAT-ID:</strong> {t.vatId} | <strong>Žiro račun:</strong> {t.ziroRacun}<br />
          <strong>IBAN:</strong> {t.iban} | <strong>SWIFT:</strong> {t.swift} | Poduzeće je upisano na {t.sud}, <strong>MBS:</strong> {t.mbs} | <strong>Temeljni kapital:</strong> {t.temeljniKapital} | <strong>Uprava:</strong> {t.uprava}
        </div>
      </div>
    </Modal>
  );
}

function PodlogeZaFakturuTab({ db, update, showToast }) {
  const [formOpen, setFormOpen] = useState(false);
  const [printPodloga, setPrintPodloga] = useState(null);
  const [del, setDel] = useState(null);
  const projektInfo = (id) => db.projekti.find((p) => p.id === id);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Btn variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>Nova podloga za fakturu</Btn>
      </div>
      {db.podlogeZaFakturu.length === 0 ? <EmptyState text="Nema izrađenih podloga za fakturu." /> : (
        <table className="erp-table">
          <thead><tr><th>Broj</th><th>Projekt</th><th>Datum</th><th>Za platiti</th><th></th></tr></thead>
          <tbody>
            {[...db.podlogeZaFakturu].sort((a, b) => b.datum.localeCompare(a.datum)).map((p) => (
              <tr key={p.id}>
                <td className="f-mono">{p.broj}</td>
                <td>{projektInfo(p.projektId)?.sifra || "—"}</td>
                <td>{fmtDate(p.datum)}</td>
                <td className="f-mono">{fmtCurDec(p.zaPlatiti)}</td>
                <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <Btn size="sm" icon={Eye} onClick={() => setPrintPodloga(p)}>PDF</Btn>
                  <button className="btn btn-icon btn-ghost" onClick={() => setDel(p)}><Trash2 size={14} color="var(--rust)" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {formOpen && <PodlogaZaFakturuFormModal db={db} update={update} showToast={showToast} onClose={() => setFormOpen(false)} />}
      {printPodloga && (
        <PodlogaZaFakturuPrintModal
          podloga={printPodloga}
          projekt={projektInfo(printPodloga.projektId)}
          narudzba={db.narudzbe.find((n) => n.id === printPodloga.narudzbaId)}
          kupac={db.kupci.find((k) => k.id === db.narudzbe.find((n) => n.id === printPodloga.narudzbaId)?.kupacId)}
          otpremnice={db.otpremnice.filter((o) => printPodloga.otpremniceIds.includes(o.id))}
          postavkeTvrtke={db.postavkeTvrtke}
          onClose={() => setPrintPodloga(null)}
        />
      )}
      {del && <ConfirmDelete label={del.broj} onCancel={() => setDel(null)} onConfirm={() => { update("podlogeZaFakturu", db.podlogeZaFakturu.filter((p) => p.id !== del.id)); setDel(null); showToast("Podloga obrisana."); }} />}
    </div>
  );
}

function OtpremniceTab({ db, update, showToast }) {
  const [printOtp, setPrintOtp] = useState(null);
  const [del, setDel] = useState(null);
  const projektInfo = (id) => db.projekti.find((p) => p.id === id);
  const kupacInfo = (id) => db.kupci.find((k) => k.id === id);

  return (
    <div>
      {db.otpremnice.length === 0 ? <EmptyState text="Nema izdanih otpremnica. Otpremnice se kreiraju u Projekti i ponude → detalji projekta." /> : (
        <table className="erp-table">
          <thead><tr><th>Broj</th><th>Projekt</th><th>Kupac</th><th>Datum</th><th>Stavki</th><th></th></tr></thead>
          <tbody>
            {[...db.otpremnice].sort((a, b) => b.datum.localeCompare(a.datum)).map((o) => {
              const projekt = projektInfo(o.projektId);
              return (
                <tr key={o.id}>
                  <td className="f-mono">{o.broj}</td>
                  <td>{projekt?.sifra}{projekt?.naziv ? ` — ${projekt.naziv}` : ""}</td>
                  <td>{kupacInfo(o.kupacId)?.naziv || "—"}</td>
                  <td>{fmtDate(o.datum)}</td>
                  <td className="f-mono">{o.stavke.length}</td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <Btn size="sm" icon={Eye} onClick={() => setPrintOtp(o)}>PDF</Btn>
                    <button className="btn btn-icon btn-ghost" onClick={() => setDel(o)}><Trash2 size={14} color="var(--rust)" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {printOtp && (
        <OtpremnicaPrintModal
          otpremnica={printOtp}
          kupac={kupacInfo(printOtp.kupacId)}
          projekt={projektInfo(printOtp.projektId)}
          narudzba={db.narudzbe.find((n) => n.id === printOtp.narudzbaId)}
          izdao={db.zaposlenici.find((z) => z.id === printOtp.izdaoId)}
          postavkeTvrtke={db.postavkeTvrtke}
          onClose={() => setPrintOtp(null)}
        />
      )}
      {del && <ConfirmDelete label={del.broj} onCancel={() => setDel(null)} onConfirm={() => { update("otpremnice", db.otpremnice.filter((o) => o.id !== del.id)); setDel(null); showToast("Otpremnica obrisana."); }} />}
    </div>
  );
}

function FakturiranjePage({ db, update, showToast }) {
  const [tab, setTab] = useState("fakture");
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [printFaktura, setPrintFaktura] = useState(null);
  const emptyForm = () => ({ id: null, broj: sljedeciBroj(db.fakture, "broj", "FAK-2026-", 4), projektId: db.projekti[0]?.id || "", kupacId: db.projekti[0]?.kupacId || db.kupci[0]?.id, datumIzdavanja: todayISO(), rokPlacanja: todayISO(), status: "Nacrt", stavke: [] });
  const [form, setForm] = useState(emptyForm());

  const openAdd = () => { setForm(emptyForm()); setModal(true); };
  const openEdit = (row) => { setForm(JSON.parse(JSON.stringify(row))); setModal(true); };
  const save = () => {
    if (form.id) update("fakture", db.fakture.map((f) => (f.id === form.id ? form : f)));
    else update("fakture", [...db.fakture, { ...form, id: uid("fak") }]);
    setModal(false);
    showToast("Faktura spremljena.");
  };
  const kupacNaziv = (id) => db.kupci.find((k) => k.id === id)?.naziv || "—";
  const projNaziv = (id) => db.projekti.find((p) => p.id === id)?.naziv || "—";
  const isOverdue = (row) => row.status !== "Plaćeno" && daysUntil(row.rokPlacanja) < 0;

  return (
    <div>
      <PageHeader title="Otpremnice i fakturiranje" icon={Receipt} subtitle="Otpremnice, izlazne fakture i naplata po projektima" />
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        <div className={`nav-tab ${tab === "fakture" ? "active" : ""}`} onClick={() => setTab("fakture")}>Fakture</div>
        <div className={`nav-tab ${tab === "otpremnice" ? "active" : ""}`} onClick={() => setTab("otpremnice")}>Otpremnice</div>
        <div className={`nav-tab ${tab === "podloge" ? "active" : ""}`} onClick={() => setTab("podloge")}>Podloge za fakturu</div>
      </div>

      {tab === "otpremnice" && <OtpremniceTab db={db} update={update} showToast={showToast} />}
      {tab === "podloge" && <PodlogeZaFakturuTab db={db} update={update} showToast={showToast} />}

      {tab === "fakture" && (
      <EntityPage
        title="" data={db.fakture} onAdd={openAdd} onEdit={openEdit} onDelete={(r) => setDel(r)}
        addLabel="Nova faktura" searchKeys={["broj"]}
        rowClass={(r) => (isOverdue(r) ? "row-warn" : "")}
        columns={[
          { key: "broj", label: "Broj", render: (r) => <span className="f-mono">{r.broj}</span> },
          { key: "kupac", label: "Kupac", render: (r) => kupacNaziv(r.kupacId) },
          { key: "projekt", label: "Projekt", render: (r) => projNaziv(r.projektId) },
          { key: "datumIzdavanja", label: "Izdano", render: (r) => fmtDate(r.datumIzdavanja) },
          { key: "rokPlacanja", label: "Rok plaćanja", render: (r) => <span style={{ color: isOverdue(r) ? "var(--rust)" : "inherit", fontWeight: isOverdue(r) ? 700 : 400 }}>{fmtDate(r.rokPlacanja)}</span> },
          { key: "iznos", label: "Iznos (s PDV-om)", render: (r) => <span className="f-mono">{fmtCurDec(izracunFakture(r, db.postavkeTvrtke?.pdvStopa).ukupno)}</span> },
          { key: "status", label: "Status", render: (r) => <Badge status={isOverdue(r) ? "Kasni" : r.status} /> },
          { key: "print", label: "", render: (r) => <Btn size="sm" icon={Eye} onClick={() => setPrintFaktura(r)}>PDF</Btn> },
        ]}
      />
      )}

      {modal && (
        <Modal wide title={form.id ? `Faktura ${form.broj}` : "Nova faktura"} onClose={() => setModal(false)} footer={<><Btn onClick={() => setModal(false)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={save}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Projekt"><select className="select" value={form.projektId} onChange={(e) => { const proj = db.projekti.find((p) => p.id === e.target.value); setForm({ ...form, projektId: e.target.value, kupacId: proj?.kupacId || form.kupacId }); }}>{db.projekti.map((p) => <option key={p.id} value={p.id}>{p.sifra} — {p.naziv}</option>)}</select></Field>
            <Field label="Kupac"><select className="select" value={form.kupacId} onChange={(e) => setForm({ ...form, kupacId: e.target.value })}>{db.kupci.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}</select></Field>
            <Field label="Datum izdavanja"><input className="input" type="date" value={form.datumIzdavanja} onChange={(e) => setForm({ ...form, datumIzdavanja: e.target.value })} /></Field>
            <Field label="Rok plaćanja"><input className="input" type="date" value={form.rokPlacanja} onChange={(e) => setForm({ ...form, rokPlacanja: e.target.value })} /></Field>
          </div>
          <Field label="Status"><select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["Nacrt", "Poslano", "Djelomično plaćeno", "Plaćeno", "Kasni"].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Stavke fakture"><LineItemsEditor mode="custom" rows={form.stavke} setRows={(rows) => setForm({ ...form, stavke: rows })} materijali={db.materijali} /></Field>
          {(() => { const calc = izracunFakture(form, db.postavkeTvrtke?.pdvStopa); return (
            <div className="card" style={{ padding: 12, background: "var(--surface-alt)", marginTop: 4 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, fontSize: 12.5 }}>
                <div><div style={{ color: "var(--ink-soft)" }}>Osnovica</div><div className="f-mono" style={{ fontWeight: 700 }}>{fmtCurDec(calc.osnovica)}</div></div>
                <div><div style={{ color: "var(--ink-soft)" }}>PDV ({calc.stopa}%)</div><div className="f-mono" style={{ fontWeight: 700 }}>{fmtCurDec(calc.pdvIznos)}</div></div>
                <div><div style={{ color: "var(--ink-soft)" }}>Ukupno za platiti</div><div className="f-mono" style={{ fontWeight: 700, color: "var(--steel)" }}>{fmtCurDec(calc.ukupno)}</div></div>
              </div>
            </div>
          ); })()}
        </Modal>
      )}
      {del && <ConfirmDelete label={del.broj} onCancel={() => setDel(null)} onConfirm={() => { update("fakture", db.fakture.filter((f) => f.id !== del.id)); setDel(null); showToast("Faktura obrisana."); }} />}
      {printFaktura && <FakturaPrintModal faktura={printFaktura} kupac={db.kupci.find((k) => k.id === printFaktura.kupacId)} projekt={db.projekti.find((p) => p.id === printFaktura.projektId)} postavkeTvrtke={db.postavkeTvrtke} onClose={() => setPrintFaktura(null)} />}
    </div>
  );
}

/* ============================== PARTNERI (KUPCI / DOBAVLJAČI) ============================== */
function PartneriPage({ db, update, showToast }) {
  const [tab, setTab] = useState("kupci");
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const emptyKupac = { naziv: "", oib: "", kontaktOsoba: "", telefon: "", email: "", adresa: "" };
  const emptyDobav = { naziv: "", oib: "", kontaktOsoba: "", telefon: "", email: "" };
  const [form, setForm] = useState(emptyKupac);

  const key = tab === "kupci" ? "kupci" : "dobavljaci";
  const empty = tab === "kupci" ? emptyKupac : emptyDobav;

  const openAdd = () => { setForm(empty); setModal("add"); };
  const openEdit = (row) => { setForm(row); setModal("edit"); };
  const save = () => {
    if (!form.naziv.trim()) return;
    if (modal === "add") update(key, [...db[key], { ...form, id: uid(tab === "kupci" ? "kup" : "dob") }]);
    else update(key, db[key].map((r) => (r.id === form.id ? form : r)));
    setModal(null);
    showToast("Partner spremljen.");
  };

  const cols = [
    { key: "naziv", label: "Naziv" },
    { key: "oib", label: "OIB", render: (r) => <span className="f-mono">{r.oib}</span> },
    { key: "kontaktOsoba", label: "Kontakt osoba" },
    { key: "telefon", label: "Telefon" },
    { key: "email", label: "E-mail" },
  ];

  return (
    <div>
      <PageHeader title="Kupci i dobavljači" subtitle="Poslovni partneri" icon={Users} />
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        <div className={`nav-tab ${tab === "kupci" ? "active" : ""}`} onClick={() => setTab("kupci")}>Kupci</div>
        <div className={`nav-tab ${tab === "dobavljaci" ? "active" : ""}`} onClick={() => setTab("dobavljaci")}>Dobavljači</div>
      </div>
      <EntityPage
        title="" data={db[key]} onAdd={openAdd} onEdit={openEdit} onDelete={(r) => setDel(r)}
        addLabel={tab === "kupci" ? "Novi kupac" : "Novi dobavljač"} searchKeys={["naziv", "oib", "kontaktOsoba"]}
        columns={cols}
      />
      {modal && (
        <Modal title={modal === "add" ? "Novi partner" : "Uredi partnera"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={save}>Spremi</Btn></>}>
          <Field label="Naziv tvrtke"><input className="input" value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="OIB"><input className="input f-mono" value={form.oib} onChange={(e) => setForm({ ...form, oib: e.target.value })} /></Field>
            <Field label="Kontakt osoba"><input className="input" value={form.kontaktOsoba} onChange={(e) => setForm({ ...form, kontaktOsoba: e.target.value })} /></Field>
            <Field label="Telefon"><input className="input" value={form.telefon} onChange={(e) => setForm({ ...form, telefon: e.target.value })} /></Field>
            <Field label="E-mail"><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          </div>
          {tab === "kupci" && <Field label="Adresa"><input className="input" value={form.adresa} onChange={(e) => setForm({ ...form, adresa: e.target.value })} /></Field>}
        </Modal>
      )}
      {del && <ConfirmDelete label={del.naziv} onCancel={() => setDel(null)} onConfirm={() => { update(key, db[key].filter((r) => r.id !== del.id)); setDel(null); showToast("Partner obrisan."); }} />}
    </div>
  );
}

/* ============================== ZAPOSLENICI ============================== */
// Provjera zahtjeva za lozinku — isto pravilo kao na backendu (server je taj koji ga stvarno provodi,
// ovo je samo trenutna povratna informacija korisniku dok tipka).
const lozinkaZahtjevi = (lozinka) => ([
  { ok: lozinka.length >= 8, tekst: "najmanje 8 znakova" },
  { ok: /[A-Za-z]/.test(lozinka), tekst: "barem jedno slovo" },
  { ok: /[0-9]/.test(lozinka), tekst: "barem jedan broj" },
  { ok: /[^A-Za-z0-9]/.test(lozinka), tekst: "barem jedan poseban znak (npr. ! ? # -)" },
]);

function PostaviLozinkuModal({ zaposlenik, onClose, showToast, refetchKljuc }) {
  const [nova, setNova] = useState("");
  const [potvrda, setPotvrda] = useState("");
  const [greska, setGreska] = useState("");
  const [saljem, setSaljem] = useState(false);
  const zahtjevi = lozinkaZahtjevi(nova);
  const sviIspunjeni = zahtjevi.every((z) => z.ok);

  const spremi = async () => {
    if (!sviIspunjeni) { setGreska("Lozinka ne zadovoljava sve uvjete."); return; }
    if (nova !== potvrda) { setGreska("Lozinke se ne podudaraju."); return; }
    setSaljem(true);
    setGreska("");
    try {
      const res = await fetch(`${API_URL}/api/zaposlenici/${zaposlenik.id}/lozinka`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
        body: JSON.stringify({ lozinka: nova }),
      });
      const data = await res.json();
      if (!res.ok) { setGreska(data.error || "Greška pri spremanju lozinke."); return; }
      await refetchKljuc("zaposlenici");
      showToast(`Lozinka za ${zaposlenik.ime} ${zaposlenik.prezime} je postavljena.`);
      onClose();
    } catch {
      setGreska("Greška pri povezivanju s poslužiteljem.");
    } finally {
      setSaljem(false);
    }
  };

  return (
    <Modal title={`Postavi lozinku — ${zaposlenik.ime} ${zaposlenik.prezime}`} onClose={onClose} footer={<><Btn onClick={onClose}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={spremi} disabled={saljem}>{saljem ? "Spremanje…" : "Postavi lozinku"}</Btn></>}>
      <Field label="Nova lozinka"><input className="input f-mono" type="password" value={nova} onChange={(e) => { setNova(e.target.value); setGreska(""); }} /></Field>
      <Field label="Potvrdi lozinku"><input className="input f-mono" type="password" value={potvrda} onChange={(e) => { setPotvrda(e.target.value); setGreska(""); }} onKeyDown={(e) => { if (e.key === "Enter") spremi(); }} /></Field>
      <ul style={{ margin: "8px 0 12px 18px", padding: 0, fontSize: 12.5 }}>
        {zahtjevi.map((z) => (
          <li key={z.tekst} style={{ color: z.ok ? "var(--green)" : "var(--ink-faint)" }}>{z.ok ? "✓" : "—"} {z.tekst}</li>
        ))}
      </ul>
      {greska && <div style={{ color: "var(--rust)", fontSize: 12.5, marginBottom: 10 }}>{greska}</div>}
    </Modal>
  );
}

function ZaposleniciPage({ db, update, showToast, refetchKljuc }) {
  const [tab, setTab] = useState("zaposlenici");
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [lozinkaZa, setLozinkaZa] = useState(null);

  const emptyZap = { ime: "", prezime: "", pozicijaId: db.pozicijeZaposlenika[0]?.id || "", email: "", telefon: "", status: "Aktivan", datumZaposlenja: todayISO(), kompetencije: [], rfidKod: "" };
  const [zapForm, setZapForm] = useState(emptyZap);

  const emptyPoz = { naziv: "", opis: "", moduli: [] };
  const [pozForm, setPozForm] = useState(emptyPoz);

  const pozicijaNaziv = (id) => db.pozicijeZaposlenika.find((p) => p.id === id)?.naziv || "—";
  const brojZaposlenihNaPoziciji = (pozicijaId) => db.zaposlenici.filter((z) => z.pozicijaId === pozicijaId).length;

  const saveZap = () => {
    if (!zapForm.ime.trim() || !zapForm.prezime.trim()) return;
    if (zapForm.id) {
      update("zaposlenici", db.zaposlenici.map((z) => (z.id === zapForm.id ? zapForm : z)));
      setModal(null);
      showToast("Zaposlenik spremljen.");
    } else {
      const noviId = uid("zap");
      update("zaposlenici", [...db.zaposlenici, { ...zapForm, id: noviId }]);
      setModal(null);
      showToast("Zaposlenik dodan — postavi mu lozinku za prijavu (gumb \"Lozinka\" u tablici).");
    }
  };
  const savePoz = () => {
    if (!pozForm.naziv.trim()) return;
    if (pozForm.id) update("pozicijeZaposlenika", db.pozicijeZaposlenika.map((p) => (p.id === pozForm.id ? pozForm : p)));
    else update("pozicijeZaposlenika", [...db.pozicijeZaposlenika, { ...pozForm, id: uid("poz") }]);
    setModal(null);
    showToast("Pozicija spremljena.");
  };
  const toggleModul = (key) => {
    setPozForm((f) => ({ ...f, moduli: f.moduli.includes(key) ? f.moduli.filter((m) => m !== key) : [...f.moduli, key] }));
  };

  return (
    <div>
      <PageHeader title="Zaposlenici" icon={UserCog} subtitle="Zaposlenici, pozicije u tvrtki i ograničenja pristupa aplikaciji" />
      <div style={{ display: "flex", gap: 20, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        <div className={`nav-tab ${tab === "zaposlenici" ? "active" : ""}`} onClick={() => setTab("zaposlenici")}>Zaposlenici</div>
        <div className={`nav-tab ${tab === "pozicije" ? "active" : ""}`} onClick={() => setTab("pozicije")}>Pozicije</div>
        <div className={`nav-tab ${tab === "evidencija" ? "active" : ""}`} onClick={() => setTab("evidencija")}>Evidencija rada</div>
      </div>

      {tab === "zaposlenici" && (
        <>
          {db.zaposlenici.some((z) => !z.lozinkaHash) && (
            <div className="card" style={{ padding: "10px 14px", marginBottom: 14, background: "#FDF6E3", borderColor: "#F0C36B", display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={15} color="#8A6100" />
              <span style={{ fontSize: 12.5, color: "#6b5511" }}><strong>{db.zaposlenici.filter((z) => !z.lozinkaHash).length}</strong> zaposlenika još nema postavljenu jaku lozinku (koriste stari PIN ili nemaju nikakvu) — postavi im lozinku gumbom "Lozinka" u tablici.</span>
            </div>
          )}
          <EntityPage
            title="" data={[...db.zaposlenici].sort((a, b) => (a.prezime + a.ime).localeCompare(b.prezime + b.ime, "hr"))}
            onAdd={() => { setZapForm(emptyZap); setModal("zap"); }}
            onEdit={(row) => { setZapForm({ ...emptyZap, ...row, kompetencije: row.kompetencije || [], rfidKod: row.rfidKod || "" }); setModal("zap"); }}
            onDelete={(r) => setDel({ type: "zap", row: r })}
            addLabel="Novi zaposlenik" searchKeys={["ime", "prezime", "email"]}
            columns={[
              { key: "prezime", label: "Prezime i ime", render: (r) => <strong>{r.prezime} {r.ime}</strong> },
              { key: "pozicija", label: "Pozicija", render: (r) => pozicijaNaziv(r.pozicijaId) },
              { key: "email", label: "E-mail" },
              { key: "telefon", label: "Telefon" },
              { key: "lozinka", label: "Lozinka", render: (r) => (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: r.lozinkaHash ? "var(--green)" : "var(--rust)" }}>{r.lozinkaHash ? "✓ Postavljena" : "Stari/nema PIN"}</span>
                  <Btn variant="ghost" size="sm" onClick={() => setLozinkaZa(r)}>Lozinka</Btn>
                </div>
              ) },
              { key: "kompetencije", label: "Kompetencije", render: (r) => (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, maxWidth: 220 }}>
                  {(r.kompetencije || []).length === 0 ? <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>—</span> : r.kompetencije.map((k) => <span key={k} className="badge badge-muted" style={{ fontSize: 9.5 }}>{k}</span>)}
                </div>
              ) },
              { key: "datumZaposlenja", label: "Zaposlen od", render: (r) => fmtDate(r.datumZaposlenja) },
              { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
            ]}
          />
        </>
      )}


      {tab === "pozicije" && (
        <>
          <div style={{ marginBottom: 12, fontSize: 13, color: "var(--ink-soft)" }}>
            Svaka pozicija određuje kojim modulima aplikacije zaposlenik na toj poziciji smije pristupiti. Napomena: ovo je planska evidencija ograničenja — stvarno tehničko ograničavanje pristupa zahtijeva korisničke račune s prijavom (login), što ovaj prototip trenutno ne implementira.
          </div>
          <EntityPage
            title="" data={db.pozicijeZaposlenika}
            onAdd={() => { setPozForm(emptyPoz); setModal("poz"); }}
            onEdit={(row) => { setPozForm({ ...emptyPoz, ...row }); setModal("poz"); }}
            onDelete={(r) => setDel({ type: "poz", row: r })}
            addLabel="Nova pozicija" searchKeys={["naziv"]}
            columns={[
              { key: "naziv", label: "Naziv pozicije" },
              { key: "opis", label: "Opis" },
              { key: "moduli", label: "Dopušteni moduli", render: (r) => (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(r.moduli || []).map((m) => <span key={m} className="badge badge-info">{MODULI_APLIKACIJE.find((mm) => mm.key === m)?.label || m}</span>)}
                </div>
              ) },
              { key: "broj", label: "Zaposlenika", render: (r) => <span className="f-mono">{brojZaposlenihNaPoziciji(r.id)}</span> },
            ]}
          />
        </>
      )}

      {tab === "evidencija" && (() => {
        const zaposlenikIme = (id) => { const z = db.zaposlenici.find((zz) => zz.id === id); return z ? `${z.prezime} ${z.ime}` : "—"; };
        const danas = [...db.evidencijaRada].filter((e) => e.vrijemeDolaska.slice(0, 10) === todayISO()).sort((a, b) => b.vrijemeDolaska.localeCompare(a.vrijemeDolaska));
        const pocetakOvogTjedna = pocetakTjedna(todayISO());
        const tjedniSati = {};
        db.evidencijaRada.forEach((e) => {
          if (e.vrijemeDolaska.slice(0, 10) < pocetakOvogTjedna) return;
          const kraj = e.vrijemeOdlaska ? new Date(e.vrijemeOdlaska) : new Date();
          const min = Math.max(0, (kraj - new Date(e.vrijemeDolaska)) / 60000);
          tjedniSati[e.zaposlenikId] = (tjedniSati[e.zaposlenikId] || 0) + min;
        });
        const tjedniPregled = Object.entries(tjedniSati).map(([zid, min]) => ({ zid, min })).sort((a, b) => b.min - a.min);
        const kioskUrl = `${window.location.origin}${window.location.pathname}?kiosk=1`;

        return (
          <div>
            <div className="card" style={{ padding: 14, marginBottom: 16, background: "var(--surface-alt)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", maxWidth: 480 }}>
                Postavi ovaj link na uređaju na ulazu (telefon/tablet u kiosk načinu). Zaposlenici prislanjaju NFC karticu (programiranu s njihovim osobnim linkom — vidi karticu zaposlenika) ili ručno upisuju svoj kod.
              </div>
              <Btn variant="primary" icon={UserCog} onClick={() => window.open(kioskUrl, "_blank")}>Otvori kiosk zaslon</Btn>
            </div>

            <div className="label" style={{ marginBottom: 8 }}>Danas ({fmtDate(todayISO())})</div>
            {danas.length === 0 ? <EmptyState text="Još nema zabilježenih dolazaka danas." /> : (
              <table className="erp-table" style={{ marginBottom: 20 }}>
                <thead><tr><th>Zaposlenik</th><th style={{ width: 90 }}>Dolazak</th><th style={{ width: 90 }}>Odlazak</th><th style={{ width: 100 }}>Trajanje</th></tr></thead>
                <tbody>
                  {danas.map((e) => {
                    const kraj = e.vrijemeOdlaska ? new Date(e.vrijemeOdlaska) : new Date();
                    const min = Math.max(0, Math.round((kraj - new Date(e.vrijemeDolaska)) / 60000));
                    return (
                      <tr key={e.id}>
                        <td>{zaposlenikIme(e.zaposlenikId)}</td>
                        <td className="f-mono">{new Date(e.vrijemeDolaska).toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="f-mono">{e.vrijemeOdlaska ? new Date(e.vrijemeOdlaska).toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" }) : <span style={{ color: "var(--green)" }}>U tijeku</span>}</td>
                        <td className="f-mono">{Math.floor(min / 60)}h {min % 60}min</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <div className="label" style={{ marginBottom: 8 }}>Sati ovaj tjedan (od {fmtDate(pocetakOvogTjedna)})</div>
            {tjedniPregled.length === 0 ? <EmptyState text="Nema evidentiranih sati ovaj tjedan." /> : (
              <table className="erp-table">
                <thead><tr><th>Zaposlenik</th><th style={{ width: 100 }}>Ukupno sati</th></tr></thead>
                <tbody>
                  {tjedniPregled.map((r) => <tr key={r.zid}><td>{zaposlenikIme(r.zid)}</td><td className="f-mono">{Math.floor(r.min / 60)}h {Math.round(r.min % 60)}min</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {modal === "zap" && (
        <Modal title={zapForm.id ? "Uredi zaposlenika" : "Novi zaposlenik"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={saveZap}>Spremi</Btn></>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Ime"><input className="input" value={zapForm.ime} onChange={(e) => setZapForm({ ...zapForm, ime: e.target.value })} /></Field>
            <Field label="Prezime"><input className="input" value={zapForm.prezime} onChange={(e) => setZapForm({ ...zapForm, prezime: e.target.value })} /></Field>
          </div>
          <Field label="Pozicija u tvrtki">
            <select className="select" value={zapForm.pozicijaId} onChange={(e) => setZapForm({ ...zapForm, pozicijaId: e.target.value })}>
              {db.pozicijeZaposlenika.map((p) => <option key={p.id} value={p.id}>{p.naziv}</option>)}
            </select>
          </Field>
          {zapForm.pozicijaId && (
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: -8, marginBottom: 14 }}>
              Dopušteni moduli za ovu poziciju: {(db.pozicijeZaposlenika.find((p) => p.id === zapForm.pozicijaId)?.moduli || []).map((m) => MODULI_APLIKACIJE.find((mm) => mm.key === m)?.label).join(", ") || "nijedan"}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="E-mail"><input className="input" value={zapForm.email} onChange={(e) => setZapForm({ ...zapForm, email: e.target.value })} /></Field>
            <Field label="Telefon"><input className="input" value={zapForm.telefon} onChange={(e) => setZapForm({ ...zapForm, telefon: e.target.value })} /></Field>
            <Field label="Status"><select className="select" value={zapForm.status} onChange={(e) => setZapForm({ ...zapForm, status: e.target.value })}><option>Aktivan</option><option>Neaktivan</option></select></Field>
            <Field label="Zaposlen od"><input className="input" type="date" value={zapForm.datumZaposlenja} onChange={(e) => setZapForm({ ...zapForm, datumZaposlenja: e.target.value })} /></Field>
            {zapForm.id && (
              <Field label="Lozinka za prijavu">
                <div style={{ display: "flex", alignItems: "center", gap: 8, height: 36 }}>
                  <span style={{ fontSize: 11.5, color: zapForm.lozinkaHash ? "var(--green)" : "var(--rust)" }}>{zapForm.lozinkaHash ? "✓ Postavljena" : "Stari/nema PIN"}</span>
                  <Btn variant="ghost" size="sm" onClick={() => setLozinkaZa(zapForm)}>Promijeni lozinku</Btn>
                </div>
              </Field>
            )}
            <Field label="RFID/kiosk kod (za NFC karticu)">
              <div style={{ display: "flex", gap: 6 }}>
                <input className="input f-mono" style={{ textTransform: "uppercase" }} value={zapForm.rfidKod || ""} onChange={(e) => setZapForm({ ...zapForm, rfidKod: e.target.value.toUpperCase() })} />
                <Btn variant="ghost" size="sm" onClick={() => setZapForm({ ...zapForm, rfidKod: generirajRfidKod(zapForm.ime || "Z", zapForm.prezime || "ZZZ", db.zaposlenici.filter((z) => z.id !== zapForm.id).map((z) => z.rfidKod)) })}>Generiraj</Btn>
              </div>
            </Field>
          </div>
          {zapForm.rfidKod && (
            <div className="card" style={{ padding: 10, marginBottom: 14, background: "var(--surface-alt)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                Kiosk link za programiranje NFC kartice:<br />
                <span className="f-mono" style={{ fontSize: 11, color: "var(--ink)" }}>{`${window.location.origin}${window.location.pathname}?rfid=${zapForm.rfidKod}`}</span>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}?rfid=${zapForm.rfidKod}`); showToast("Link kopiran."); }}>Kopiraj link</Btn>
            </div>
          )}
          <Field label="Kompetencije — poslovi/faze proizvodnje koje ova osoba smije raditi">
            <div className="card" style={{ padding: 10, background: "var(--surface-alt)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {FAZE.filter((f) => f !== "Ostalo").map((f) => (
                  <label key={f} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, cursor: "pointer" }}>
                    <input
                      type="checkbox" checked={(zapForm.kompetencije || []).includes(f)}
                      onChange={() => setZapForm({ ...zapForm, kompetencije: (zapForm.kompetencije || []).includes(f) ? zapForm.kompetencije.filter((k) => k !== f) : [...(zapForm.kompetencije || []), f] })}
                    />
                    {f}
                  </label>
                ))}
              </div>
            </div>
          </Field>
        </Modal>
      )}

      {modal === "poz" && (
        <Modal title={pozForm.id ? "Uredi poziciju" : "Nova pozicija"} onClose={() => setModal(null)} footer={<><Btn onClick={() => setModal(null)}>Odustani</Btn><Btn variant="primary" icon={Save} onClick={savePoz}>Spremi</Btn></>}>
          <Field label="Naziv pozicije"><input className="input" placeholder="npr. Voditelj proizvodnje" value={pozForm.naziv} onChange={(e) => setPozForm({ ...pozForm, naziv: e.target.value })} /></Field>
          <Field label="Opis"><textarea className="textarea" rows={2} value={pozForm.opis} onChange={(e) => setPozForm({ ...pozForm, opis: e.target.value })} /></Field>
          <Field label="Ograničenja za aplikaciju — dopušteni moduli">
            <div className="card" style={{ padding: 10, background: "var(--surface-alt)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {MODULI_APLIKACIJE.map((m) => (
                  <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={pozForm.moduli.includes(m.key)} onChange={() => toggleModul(m.key)} />
                    <m.icon size={14} color="var(--ink-soft)" /> {m.label}
                  </label>
                ))}
              </div>
            </div>
          </Field>
        </Modal>
      )}

      {del && (
        <ConfirmDelete
          label={del.type === "zap" ? `${del.row.ime} ${del.row.prezime}` : del.row.naziv}
          onCancel={() => setDel(null)}
          onConfirm={() => {
            if (del.type === "zap") update("zaposlenici", db.zaposlenici.filter((z) => z.id !== del.row.id));
            else update("pozicijeZaposlenika", db.pozicijeZaposlenika.filter((p) => p.id !== del.row.id));
            setDel(null);
            showToast("Stavka obrisana.");
          }}
        />
      )}
      {lozinkaZa && <PostaviLozinkuModal zaposlenik={lozinkaZa} showToast={showToast} refetchKljuc={refetchKljuc} onClose={() => setLozinkaZa(null)} />}
    </div>
  );
}

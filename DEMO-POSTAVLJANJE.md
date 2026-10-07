# Demo verzija: upute za otvaranje

Demo radi iz **istog repozitorija** kao prava aplikacija, ali na zasebnoj bazi, zasebnom Render servisu i zasebnom Vercel projektu. Produkcija (postojeći Supabase, Render i Vercel) se ne dira.

Redoslijed je bitan: **1 → 2 → 3**. Render treba adresu baze, a Vercel treba adresu Render servisa.

> **Sigurnost:** demo se spaja isključivo na `DEMO_DATABASE_URL` i nikad ne čita `DATABASE_URL` za spajanje. Rad prekida u ova dva slučaja:
> - adresa pokazuje na istu bazu kao `DATABASE_URL` (iz okoline ili iz `backend/.env`);
> - baza već ima podatke, a nema demo oznaku (tablicu `demo_oznaka`).
>
> Produkcijsku bazu zato ne može ni obrisati ni resetirati. Oznaku dobiva samo nova, **prazna** baza.

---

## 1. Supabase: nova baza za demo (besplatno)

1. Prijavi se na **supabase.com**. Možeš koristiti isti račun kao za produkciju.
2. **New project**:
   - Organization: ista kao za produkciju (besplatni plan dopušta 2 aktivna projekta).
   - Name: `erp-demo`.
   - Database password: **Generate a password**. Spremi lozinku, trebat će ti u koraku 4.
   - Region: **Central EU (Frankfurt)**.
   - Klikni **Create new project** i pričekaj 1–2 minute.
3. U novom projektu klikni gumb **Connect** na vrhu stranice. Na kartici *Connection String* odaberi **Session pooler** (radi s Renderom; izravna veza `db.….supabase.co` na besplatnom Renderu često ne radi).
4. Kopiraj URI. Izgleda otprilike ovako:
   `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
   Umjesto `[YOUR-PASSWORD]` upiši lozinku iz koraka 2.
5. Ništa drugo ne treba raditi: tablice i izmišljene podatke demo server postavlja sam kod prvog pokretanja.

⚠️ Pazi da je to adresa **novog** projekta `erp-demo`, a ne produkcijskog. Prepoznaješ je po dijelu `postgres.<ref>`, koji mora biti drukčiji od onog u produkcijskom `DATABASE_URL`. I kad bi se zabunio, server bi odbio rad.

ℹ️ Supabase besplatni plan pauzira projekt nakon 7 dana bez prometa. Tada ga u Supabaseu ponovno pokreneš gumbom **Restore project**.

---

## 2. Render: novi servis za demo backend

1. Na **dashboard.render.com** klikni **New → Web Service**.
2. Odaberi isti GitHub repozitorij (`ERP-ECON`).
3. Postavke:
   | Polje | Vrijednost |
   |---|---|
   | Name | `erp-demo-api` (iz imena nastaje adresa, npr. `https://erp-demo-api.onrender.com`) |
   | Branch | `main` (vidi napomenu na kraju) |
   | Root Directory | **ostavi prazno** (demo čita i `frontend/src/App.jsx`, pa treba cijeli repozitorij) |
   | Runtime | Node |
   | Build Command | `npm --prefix backend install` |
   | Start Command | `npm --prefix backend start` |
   | Instance Type | **Free** |
4. **Environment Variables** (Add Environment Variable):
   | Ključ | Vrijednost |
   |---|---|
   | `DEMO_MODE` | `1` |
   | `DEMO_DATABASE_URL` | URI iz koraka 1.4 (s lozinkom) |
   | `JWT_SECRET` | **novi** dugi nasumični niz, različit od produkcijskog (npr. gumb *Generate* u Renderu) |
   | `DEMO_IZVJESTAJ_KLJUC` | tajni ključ za izvještaj o posjetama, najmanje 12 znakova (npr. *Generate*); vidi „Izvještaj o posjetama” |

   **Ne dodaji `DATABASE_URL`.** Demo ga ne treba.
5. **Create Web Service**. Nakon builda u logu trebaš vidjeti:
   ```
   Nova demo baza postavljena (25 ključeva).
   ERP backend (DEMO) sluša na portu 10000
   ```
6. Provjera: otvori `https://erp-demo-api.onrender.com/api/auth/zaposlenici`. Trebaš vidjeti samo jedan zapis, „Korisnik Demo”.
7. Zapiši adresu servisa jer ti treba u koraku 3. **Prepiši je točno kako piše ispod naziva servisa**: Render često doda nastavak (npr. `https://erp-demo-api-zzfr.onrender.com`).

ℹ️ Besplatni Render servis „zaspi” nakon 15 minuta bez prometa. Prvo otvaranje nakon toga traje oko minutu.

**Noćni reset:** svaki dan nakon 03:00 (po Zagrebu) baza se vraća na početne izmišljene podatke. Reset se pokreće pri prvom zahtjevu nakon 03:00 ili sam unutar 10 minuta ako servis radi, pa ne treba zaseban zakazani posao (cron). Datumi u podacima uvijek se računaju od toga dana, tako da demo uvijek izgleda kao tvrtka usred posla.

---

## 3. Vercel: novi projekt za demo frontend

1. Na **vercel.com** klikni **Add New… → Project**.
2. Odaberi isti GitHub repozitorij (`ERP-ECON`) i klikni **Import**.
3. Postavke:
   | Polje | Vrijednost |
   |---|---|
   | Project Name | `erp-demo` (adresa: `https://erp-demo.vercel.app` ili slično) |
   | Framework Preset | Vite |
   | Root Directory | `frontend` (klikni **Edit** i odaberi mapu) |
   | Build / Output | ostavi zadano |
4. **Environment Variables** (vrsta **Config**, ne *Secret*: Vercel ne dopušta spremiti `VITE_` varijable kao Secret, a postojeći Secret se ne može prebaciti u Config, nego se briše i dodaje ponovo):
   | Ključ | Vrijednost |
   |---|---|
   | `VITE_DEMO` | `1` |
   | `VITE_API_URL` | adresa Render servisa iz koraka 2.7, **bez** `/` na kraju |

   Kad promijeniš varijablu, napravi **Redeploy**: vrijednosti se upisuju u stranicu tijekom izgradnje.
5. **Deploy**. Kod uvoza Vercel ne nudi izbor grane, pa je prvi deploy s `main`. Dok `demo-verzija` nije spojena u `main`, ta stranica još prikazuje običnu prijavu.
6. **Settings → Environments → Production → Branch Tracking:** upiši `demo-verzija` i spremi.
7. Vercel gradi granu tek nakon prvog pusha na nju koji stigne *nakon* što je projekt otvoren. Ako u Deployments nema nijednog deploya za `demo-verzija`, napravi bilo kakav push na tu granu ili koristi **Settings → Git → Deploy Hooks** (grana `demo-verzija`, URL pozoveš kao POST, npr. `Invoke-RestMethod -Method Post "<url>"`).
8. Otvori dobivenu adresu. Vidjet ćeš prijavu „Demo d.o.o.” s jednim korisnikom, „Demo Korisnik”.

---

## Trenutna instalacija

- Frontend: https://erp-demo-swart.vercel.app
- Backend: https://erp-demo-api-zzfr.onrender.com
- Obje usluge prate granu `demo-verzija`.

## Pristup za stranke

- Link: https://erp-demo-swart.vercel.app
- Korisnik: **Demo Korisnik** (jedini na popisu).
- Lozinka: `Demo2026!`. Šalješ je strankama e-mailom; na stranici se ne prikazuje.

Lozinka je zapisana u `backend/demo/podaci.js` (`DEMO_LOZINKA`). Kad je promijeniš i objaviš, nova lozinka vrijedi od sljedećeg noćnog reseta. U demu se lozinka ne može promijeniti kroz aplikaciju.

## Što je drukčije u demu

- Naziv tvrtke „Demo d.o.o.”, bez Econ logotipa (ni slika logotipa nije uključena u demo build) i bez pravih podataka tvrtke u sučelju i PDF ispisima.
- Nema gumba Backup, nema promjene lozinki, nema kiosk zaslona.
- Posjete se bilježe za izvještaj (vidi „Izvještaj o posjetama”).
- Prijava je moguća samo demo računom. Demo račun i pozicija Administrator ne mogu se obrisati ni promijeniti.
- Izmišljeni podaci pokrivaju cijeli tijek: 7 ponuda, 4 projekta u različitim fazama s radnim nalozima, narudžbe kupaca, narudžbenice, skladište, matičnu knjigu s atestima, izdatnice, rezervacije, otpremnice, CMR, fakture, 14 zaposlenika s evidencijom rada za zadnja dva tjedna, zadatke i praznike.

## Izvještaj o posjetama

Demo bilježi svaku prijavu: vrijeme, približnu lokaciju (grad i država prema IP adresi), uređaj i preglednik, aktivno vrijeme (dok je aplikacija otvorena i vidljiva) i otvorene module. Posjete su u zasebnoj tablici `demo_posjete` koju noćni reset ne briše.

- Lokacija se određuje **lokalno na serveru** (paket `geoip-lite`, podaci MaxMind GeoLite2), pa IP adrese ne idu nijednom vanjskom servisu. Lokacija je približna: na mobilnoj mreži često pokazuje grad operatera.
- Na prijavi u demo piše da se ti podaci bilježe.
- Izvještaj otvoriš u pregledniku (zamijeni ključ onim iz Rendera):
  `https://erp-demo-api-zzfr.onrender.com/api/demo/izvjestaj?kljuc=TVOJ_KLJUČ`
  Na vrhu su poveznice za 7 dana, 30 dana i godinu te **Preuzmi CSV** (za Excel).
- Bez varijable `DEMO_IZVJESTAJ_KLJUC` ili s krivim ključem stranica vraća „Not found”. Ključ nikome ne šalji: tko ga ima, vidi IP adrese posjetitelja.
- Ako se servis upravo budi, prvo otvaranje izvještaja traje do minute.

## Ručne naredbe (nisu potrebne za normalan rad)

Na računalu, u mapi `backend`, adresu demo baze postaviš **samo za tu naredbu** (PowerShell):

```powershell
$env:DEMO_DATABASE_URL="postgresql://postgres.<demo-ref>:...@...pooler.supabase.com:5432/postgres"
npm run demo:reset    # odmah vrati demo bazu na početne podatke
npm run demo:init     # postavi novu, praznu demo bazu
```

Obje naredbe odbiju rad ako adresa pokazuje na produkciju.

## Napomena o grani

Demo kod je na grani `demo-verzija`. Dok se ta grana ne spoji u `main`, na Renderu i Vercelu kao granu odaberi `demo-verzija`. Nakon spajanja prebaci obje na `main`. Produkcija se spajanjem ne mijenja jer je sve demo ponašanje isključeno dok `DEMO_MODE` / `VITE_DEMO` nisu postavljeni. Iznimka je jedan sigurnosni ispravak prijave, opisan u commitu.

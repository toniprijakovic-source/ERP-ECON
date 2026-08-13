# Prijelaz ERP prototipa u pravu aplikaciju

Ovo je uputa za Claude Code (ili developera) — objašnjava što je već pripremljeno, što treba postaviti, i točno koje promjene trebaju u `erp.jsx`.

## 1. Arhitektura odluke

**Frontend (`erp.jsx`) ostaje gotovo nepromijenjen.** Sve poslovne kalkulacije (težina profila, PDV, kapacitet po fazama, raspored proizvodnje, PDF ispis putem `window.print()`) rade ispravno i ostaju u Reactu — nema smisla to pisati ponovno na backendu.

**Mijenjaju se samo dva mjesta:**
- kako se podaci učitavaju pri pokretanju (umjesto `window.storage.get`)
- `update()` funkcija koja sprema promjene (umjesto `window.storage.set`)

**Baza je namjerno "key-value"** — jedna tablica `app_data` koja čuva isti JSON oblik koji frontend već koristi (19 ključeva: kupci, projekti, ponude, fakture...). Ovo je **svjesno pojednostavljenje** za brz i siguran prvi prijelaz. Prava relacijska normalizacija (zasebne tablice s foreign keyevima, indeksi, upiti) je smislen sljedeći korak, ali NE treba se raditi u istom koraku kad se prvi put prelazi s prototipa — previše rizika odjednom.

## 2. Postavljanje baze (preporuka: Supabase, besplatni plan)

1. Napravi račun na supabase.com, novi projekt
2. Project Settings → Database → Connection string → kopiraj URI
3. U `backend/.env` (kopija `.env.example`) zalijepi taj URI kao `DATABASE_URL`, generiraj `JWT_SECRET`
4. Pokreni `npm install` u `backend/` folderu
5. Pokreni shemu: `npm run migrate` (ili zalijepi sadržaj `schema.sql` u Supabase SQL Editor)
6. **Uvezi postojeće podatke**: u aplikaciji klikni Backup → Preuzmi backup (.json), pa pokreni `node seed.js putanja/do/tog-fajla.json` — ovo prebacuje SVE trenutne podatke (kupce, projekte, zaposlenike...) u pravu bazu, ne kreće se ispočetka
7. `npm start` pokreće backend na `http://localhost:3001`

## 3. Točna izmjena u erp.jsx

### a) Učitavanje podataka (zamjena cijelog `useEffect` bloka u `App()`)

Umjesto petlje koja zove `window.storage.get(key, true)` za svaki ključ, jedan poziv:

```js
useEffect(() => {
  (async () => {
    const token = localStorage.getItem("erp_token"); // NAPOMENA: localStorage OVDJE je ok jer ovo više NIJE Claude artifact sandbox
    if (!token) { setDb(null); setPotrebnaPrijava(true); return; }
    const res = await fetch(`${API_URL}/api/data`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { localStorage.removeItem("erp_token"); setPotrebnaPrijava(true); return; }
    setDb(await res.json());
  })();
}, []);
```

*(Migracijske funkcije koje trenutno postoje u tom `useEffect`-u — nadopuna starih zapisa poljima koja nedostaju — više nisu potrebne jer se to sad radi jednom, ručno, u `seed.js` ili SQL-om.)*

### b) `update()` funkcija

```js
const update = (key, newArr) => {
  setDb((prev) => ({ ...prev, [key]: newArr }));
  fetch(`${API_URL}/api/data/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
    body: JSON.stringify(newArr),
  }).catch(() => showToast("Greška pri spremanju — provjeri internetsku vezu."));
};
```

### c) Login (zamjena `LoginScreen` PIN-provjere)

Umjesto lokalne provjere `z.pin === pin`, poziv na backend:

```js
const res = await fetch(`${API_URL}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ zaposlenikId, pin }),
});
if (res.ok) { const { token } = await res.json(); localStorage.setItem("erp_token", token); onLogin(zaposlenikId); }
else setGreska((await res.json()).error);
```

### d) Kiosk zaslon

`KioskView` više ne čita `db.zaposlenici` lokalno — umjesto toga:

```js
const res = await fetch(`${API_URL}/api/kiosk/scan`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ rfidKod: kod }),
});
```

Ovo je i sigurnosno bolje — kiosk uređaj više ne treba imati cijeli popis zaposlenika u pregledniku.

### e) Ukloniti

- `AccessGateScreen` i "pristupna lozinka" (postaje suvišno — pravi login sad postoji)
- Svi pozivi `window.storage.*`

## 4. Sigurnosne napomene (bitno pročitati)

- **4-znamenkasti PIN je slab** čak i kad je hashiran (10.000 kombinacija). Backend ima osnovni rate-limit (5 pokušaja/5 min po zaposleniku), ali za stvarno osjetljive uloge (Direktor, Administrator, Računovodstvo) razmisli o pravoj lozinci ili dužem kodu.
- **Migracija postojećih PIN-ova u hash**: trenutno su PIN-ovi u `zaposlenici` JSON-u plain-text (`pin: "1234"`). Backend podržava i `pinHash` (bcrypt) i stari `pin` (radi kompatibilnosti), ali napravi migraciju čim prije:
  ```js
  const bcrypt = require("bcryptjs");
  zaposlenici = zaposlenici.map(z => ({ ...z, pinHash: bcrypt.hashSync(z.pin, 10), pin: undefined }));
  ```
- **Autorizacija po pozicijama** (koji modul tko smije vidjeti) trenutno postoji samo u frontend UI-ju (sakriva stavke u izborniku) — pravi backend to još ne provjerava po endpointu. Sljedeći razuman korak: provjeriti u `autentikacija` middlewareu smije li `req.zaposlenikId`-ova pozicija pristupiti tom `key`-u, ne samo je li prijavljen.
- HTTPS obavezno u produkciji (Supabase i većina hostinga to rješavaju automatski).

## 5. Deployment prijedlog

- **Backend**: Render.com ili Railway.app (besplatni/jeftini planovi, spoje se direktno na GitHub repo)
- **Frontend**: build `erp.jsx` kao pravu React aplikaciju (Vite), deploy na Vercel ili Netlify
- Postavi `API_URL` u frontendu kao environment varijablu koja pokazuje na URL backenda

## 6. Što reći Claude Codeu (kopiraj-zalijepi kao prvu poruku)

> Ovo je postojeći React prototip ERP-a za proizvodnju čeličnih konstrukcija (`erp.jsx`), plus pripremljen backend (`backend/` folder sa `server.js`, `schema.sql`, `seed.js`) koji treba spojiti. Pročitaj `PRIJELAZ-NA-PRAVU-APLIKACIJU.md` — tamo je točno objašnjeno što treba promijeniti u `erp.jsx` (sekcija 3) i kako postaviti bazu (sekcija 2). Postavi Vite React projekt, prebaci `erp.jsx` u njega, primijeni te izmjene, postavi backend da radi lokalno, i provjeri da cijela aplikacija radi end-to-end s pravom bazom prije nego razmišljamo o deploymentu.

## 7. Poznata ograničenja ovog prvog koraka

- Baza je key-value, ne relacijska — upiti/izvještaji preko više entiteta i dalje se rade u JS-u na frontendu, ne u SQL-u
- Nema real-time sinkronizacije između više otvorenih tabova/uređaja (frontend i dalje čita jednom pri pokretanju + sprema pri promjeni, kao i dosad)
- Autorizacija po ulogama nije još provjerena na backendu (vidi točku 4)
- Multi-tenant (više odvojenih tvrtki na istoj instalaciji) nije uzeto u obzir — trenutno je jedna baza = jedna tvrtka

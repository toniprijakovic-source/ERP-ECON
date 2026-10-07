# Demo verzija ERP-a — dogovoreni plan (2026-10-07)

Sve odluke su već donesene s vlasnikom (Toni Prijaković). Ne pitati ponovno.

## Što se gradi
- Demo je **zasebna instalacija iz ISTOG repozitorija** (ne novi repo, ne localStorage demo): vlastita **Supabase baza**, vlastiti **Render servis**, vlastiti **Vercel projekt** s drugim env varijablama. Račune otvara vlasnik.
- Jezik: hrvatski.
- **Jedan zajednički demo račun** s punim pristupom svim modulima (i Zaposlenici/obračun plaća — podaci su izmišljeni). Pristup demu: javni link, a lozinku vlasnik šalje zainteresiranim strankama u mailu.
- Stranke smiju mijenjati podatke; **baza se svake noći sama vraća na početno stanje** (seed/reset skripta + zakazani posao).
- Naziv tvrtke **"Demo"**. **Bez Econ logotipa** i bez pravih podataka tvrtke (OIB, IBAN, adresa…) u sučelju i u PDF ispisima.
- **Bez Backup opcije** (i bez promjene lozinki prijave) u demu.
- Kiosk (RFID): u demu samo popunjena evidencija rada; kiosk ekran ne treba.
- Demo-specifično ponašanje uključuje se zastavicom (npr. `VITE_DEMO=1` na frontendu, `DEMO_MODE=1` na backendu), tako da produkcijska aplikacija ostane netaknuta.

## Izmišljeni podaci (seed)
Moraju pokriti cijeli tijek: ponuda → projekt → radni nalozi/proizvodnja → nabava i skladište (matični brojevi, atesti, izdatnice) → otpremnica/CMR → faktura → financije. Oko 10–15 zaposlenika, kupci i dobavljači, nekoliko projekata u različitim fazama. **Nikakvi pravi podaci (kupci, projekti, zaposlenici, cijene) ne smiju ući u demo.**

## SIGURNOSNO PRAVILO (važno)
`backend/.env` na vlasnikovom računalu sadrži **PRODUKCIJSKI** `DATABASE_URL`. Demo skripte (seed, reset) smiju koristiti isključivo posebnu varijablu (npr. `DEMO_DATABASE_URL`) i moraju odbiti rad ako je adresa jednaka produkcijskoj ili ako ne sadrži oznaku demo baze. Nikad ne pokretati demo skripte protiv produkcije — one brišu podatke.

## Napomene
- Render free plan "zaspi" (hladni start ~1 min); Supabase free pauzira bazu nakon 7 dana bez prometa.
- Nova ključeva podataka u aplikaciji: vidi popis `DOZVOLJENI_KLJUCEVI` u `backend/server.js` i `schema.sql` (CHECK ograda) — demo baza treba istu shemu.
- Pravila rada na ovom projektu: vidi memoriju/`README` ako postoji; testirati lokalno prije objave, commit poruke završavaju Co-Authored-By linijom.

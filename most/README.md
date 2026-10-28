# ECON most (XRechnung)

Mali program koji radi na uredskom računalu s pristupom disku Z: i povezuje ERP s mapom `Fakture` projekta.
ERP je na internetu pa Z: ne vidi — zato most **sam svakih 5 sekundi pita ERP** ima li zadataka (izlazna veza,
ništa se ne otvara prema vani). Zadatak nastaje klikom na **Financije → XRechnung → Kreiraj XRechnung**.

Što most radi za zadatak:
1. nađe mapu projekta na Z: (ime mape počinje šifrom projekta, npr. `RN 170-208_...`, ili polje "Mapa projekta" u ERP-u),
2. u mapama računa projekta (nazivi u `postavke.json` → `mapeRacuna`: `Fakture`, `Rechnungen`, `Rechnung`; prihvaća se i naziv
   koji počinje njima, npr. `Fakture 2026`; "Računi plaćeni preko B&O" se ne gleda) nađe **najnoviji Konplastov XML** računa
   po datumu računa, bez obzira u kojoj je od tih mapa. `kumulativ.json` traži u mapi u kojoj je račun pronađen, pa u ostalima,
3. napravi XRechnung 3.0 (UBL); ako uz račune postoji `Fakture\kumulativ.json`, računa kumulativ (avans, prijašnji računi)
   i dodaje tablicu "Zahlungsspezifikation" kao PDF prilog,
4. službeno ga provjeri (KoSIT validator + XRechnung konfiguracija, Java u `alati\java`),
5. spremi `XRechnung_<broj>.xml`, `XRechnung_<broj>_Ansicht.pdf` (čitljiv PDF prikaz XRechnunga), `Zahlungsspezifikation_<broj>.pdf`
   i `Pruefbericht_<broj>.html` u podmapu `XRechnung`
   uz račun i javi rezultat ERP-u. Račun se NE šalje kupcu (slanje mailom dolazi u drugoj fazi).

## Pokretanje
1. `most\.env` (vidi `.env.example`): `ERP_API_URL`, `MOST_TOKEN` (ista vrijednost mora biti u Renderu kao `MOST_TOKEN`),
   `KORIJEN_PROJEKTI` (s kosim crtama!), `MOST_PROBNO`.
2. Dvoklik na `pokreni-most.bat` (ili `node most.js`).
3. U ERP-u kartica XRechnung pokazuje "Most je povezan".

## Automatsko pokretanje
Zadatak u Windows Planeru zadataka **"ERP Econ - XRechnung most"** pokreće most 30 s nakon prijave korisnika Econ (skriveno,
bez prozora; Z: mora biti spojen u toj prijavi). Ispis mosta je u `most\most-zapisnik.log` (UTF-8; `most.log` je sirovi ispis planera
u UTF-16 i može se zanemariti). Ručno pokretanje/zaustavljanje:
Planer zadataka → desni klik na zadatak → Run / End. Nakon promjene `.env` ili koda most treba zaustaviti i ponovno pokrenuti.

`MOST_PROBNO=1` = probni način: rezultat ide u `most\proba-izlaz`, na Z: se ništa ne piše i `kumulativ.json` se ne mijenja.
Za pravi rad postavi `MOST_PROBNO=0`.

## kumulativ.json (samo za projekte s avansom / Abschlagsrechnungama)
**Postavlja se iz ERP-a** (za bilo koji projekt): Financije → XRechnung → odabir projekta → odjeljak "Kumulativ" → "Postavi / uredi".
"Učitaj iz mape projekta" pokazuje postojeće podatke, "Spremi u mapu projekta" ih zapisuje (stara datoteka se sačuva kao
`kumulativ.json.bak-<vrijeme>`). Datoteka ide u mapu računa u kojoj je najnoviji XML račun (ili gdje već postoji).
Datoteka u mapi `Fakture` projekta: `gesamtauftrag`, `vorauszahlung`, popis `racuni` (prvi je A-Konto račun, zatim
redovni računi s `iznos` = što je kupac platio i `kumulativ` = "Summe Netto" tog računa) i neobavezno `isporuka`.
Most nakon svakog valjanog XRechnunga sam upiše taj račun u niz. Primjer: `primjeri\kumulativ-RN-170-208.json`.
Bez te datoteke račun se pretvara kao običan (bez kumulativa). **Zaštita:** račun čija stavka sadrži "nach Abrechnungsblatt"
(Abschlagsrechnung) bez `kumulativ.json` se u pravom načinu ODBIJA (iznos za platiti ne bi odgovarao PDF-u kupcu); u probnom je to samo upozorenje.

## Ograničenja prve verzije
Samo isporuke u EU bez PDV-a (kategorija K), valuta EUR, bez popusta na stavkama; domaće račune šalje Konplast.

## Testovi
`npm test` (traži `primjeri\` i `alati\` — lokalne mape koje nisu u gitu).

# Salon 2CATS · Evidencija — rekapitulacija projekta

Dokument pripremljen kao "predaja projekta" — za nastavak rada na drugoj platformi, sa drugim programerom, ili sa drugim AI asistentom. Sadrži sve što je bitno da neko brzo shvati šta aplikacija radi i kako je napravljena.

---

## 1. Šta je aplikacija

Web aplikacija (PWA — instalira se na telefon/desktop kao "prava" aplikacija preko browsera, bez prodavnice aplikacija) za vođenje evidencije u frizerskom salonu sa 3 zaposlene (trenutno: Bilja, Ivana, Tamara — redosled i imena su podesivi). Pokriva zakazivanje termina, bazu klijenata, praćenje naplate, statistiku prometa i obračun zarada.

- **Live sajt:** https://salon-evidencija.vercel.app
- **GitHub:** adamzivkovic/salon-evidencija
- **Lokalni rad:** `npm run dev` (Vite dev server), `npm run build` za produkcioni build

## 2. Tehnologije (stack)

- **React 18** (Vite kao build alat)
- **Firebase Firestore** — baza podataka (NoSQL, real-time sinhronizacija preko `onSnapshot`)
- **Firebase Auth** — email+šifra prijava (koristi se za Obračun zarada i za "Obriši sve podatke")
- **Vercel** — hosting, automatski deploy na svaki `git push` na `main` granu
- **Biblioteke:** `jspdf` + `jspdf-autotable` (PDF izveštaji), `recharts` (grafikon prometa), `lucide-react` (ikonice), `xlsx` (Excel izvoz)
- Firebase **Storage** se ne koristi (zahteva plaćeni Blaze plan) — PDF-ovi obračuna se generišu na licu mesta i preuzimaju direktno na uređaj, ne čuvaju se trajno na serveru (ali podaci iz kojih se prave PDF-ovi jesu trajno sačuvani, pa se PDF može ponovo generisati kad god zatreba)

## 3. Struktura fajlova

```
salon-app/
├── src/
│   ├── App.jsx              ← glavna aplikacija (~3000 linija, sve osim obračuna)
│   ├── PinGate.jsx           ← ekran za unos šifre pri otvaranju aplikacije
│   ├── appLock.js            ← APP_PIN (šifra za PinGate)
│   ├── firebase.js           ← Firebase konfiguracija/inicijalizacija
│   └── payroll/
│       ├── PayrollView.jsx   ← ceo modul za obračun zarada
│       ├── calculations.js   ← logika obračuna (provizija / izdvajanje za materijal)
│       ├── pdf.js             ← generisanje PDF izveštaja
│       ├── utils.js           ← formatiranje datuma/novca, pomoćne funkcije
│       └── fonts/             ← Liberation Sans font (podržava č/ć/š/ž/đ u PDF-u)
```

`App.jsx` je namerno jedan veliki fajl (nije razbijen na desetine malih fajlova) — lakše za AI asistenta da radi kroz njega u ovakvom razgovoru, ali ako neko nastavlja "ručno" u IDE-u, ima smisla razmisliti o deljenju na module.

## 4. Firestore kolekcije (baza)

| Kolekcija | Sadrži |
|---|---|
| `appointments` | Svi termini — datum, vreme, radnica, usluga, klijent, cena, `paidByQR` (bool), `blocked` (bool), `groupId` (za povezane/višedelne usluge) |
| `clients` | Ime, telefon, slobodna beleška (npr. formula za farbanje) |
| `services` | Naziv usluge + trajanje (min) — uređivo iz aplikacije |
| `employees` | Ime, boja, redosled prikaza, tip obračuna (`commission` / `material_deduction`), podrazumevani procenat |
| `payrollRuns` | Zaključeni obračuni zarada — "zamrznut" snimak stanja u trenutku zaključivanja, ne menja se retroaktivno |
| `settings/general` | Opšta podešavanja (trenutno: kontrast "duhova" vremena na vremenskoj osi) |

## 5. Pristup / bezbednost

- **PIN ekran** (`PinGate.jsx`) — štiti CEO app od slučajnih poseta preko linka. Sopstvena numerička tastatura iscrtana dugmadima (namerno, ne native input — sprečava probleme sa autofill/SMS-kod predlozima na Android telefonima koji su ranije pravili lažne "pogrešan PIN" greške). Šifra: `APP_PIN` u `src/appLock.js`.
- **Obračun zarada** — zahteva pravu email+šifra prijavu (Firebase Auth), **odvojeno** od PIN-a, i **uvek iznova traži prijavu** čak i ako je korisnik već prijavljen za nešto drugo — namerna dodatna zaštita da obični PIN (koji znaju sve tri radnice) ne otvara i finansijske podatke.
- **"Obriši sve podatke"** (dugme za kraj testiranja, u Statistici) — ista logika: uvek iznova traži pravu prijavu, bez obzira na trenutno stanje.
- Napomena: brisanje obračuna u Istoriji (unutar Obračuna) i dalje koristi stariji PIN-based potvrda mehanizam (native input, ne novi custom keypad) — radi, ali nije usklađen sa ostatkom aplikacije. Kandidat za doterivanje ako se nastavi rad.

## 6. Glavne funkcionalnosti

### Kalendar
- Mesečni pregled — tačkice u boji po danu (koja radnica ima termin), filter po radnici, prevlačenje levo/desno menja mesec, automatski se uklapa da stane ceo mesec na ekran bez skrolovanja (desktop)
- Dnevni prikaz (vremenska osa 10:00–20:00, automatski se proširi unazad za konkretan dan ako postoji termin zakazan i ranije — npr. 09:00, birano iz padajućeg menija koji ide od 08:00) — kolone po radnici, prevlačenje termina mišem/prstom da se premesti (uz potvrdu), prevlačenje levo/desno menja dan
- **Fullscreen prikaz** dnevne ose (dugme pored datuma) — matematički izračuna visinu reda tako da ceo dan stane na ekran bez skrolovanja, bez obzira na veličinu monitora
- Povezani/višedelni termini (npr. bojenje + pauza + feniranje) — vizuelno povezani linijom, dele isto ime klijenta, cena upisana na jednom delu se prikazuje kao "Naplaćeno" i na drugom
- Nenaplaćeni termini — crveni trougao sa uzvičnikom u uglu (bez treptanja/okvira — to je namerno uklonjeno)
- Prevlačenje levo/desno na osnovnom ekranu (van same mreže kalendara) kruži kroz kartice Kalendar/Klijenti/Statistika

### Klijenti
- Ime, telefon, slobodna beleška (npr. formula za farbanje kose) — pretraga, potvrda pre brisanja

### Statistika
- Podrazumevano "Danas", biranje perioda (danas/nedelja/mesec/sve/prilagođeno)
- Jedna istaknuta kartica: ukupno naplaćeno, sa raspodelom Keš/QR (QR = checkbox "Plaćeno QR kodom" na terminu), broj termina (blokirani se ne računaju)
- Grafikon prometa po radnici, promet po vrsti usluge
- Izvoz bekapa (JSON i Excel), uvoz bekapa

### Podešavanja (Statistika → dugme na dnu)
- Redosled radnica (strelice gore/dole), ime (uređivo polje), boja (sistemski birač boja), dodavanje/brisanje radnice
- Klizač za kontrast "duhova" vremena na praznim terminima vremenske ose

### Obračun zarada (posebna, zaštićena sekcija)
- Mesečni ili prilagođeni period, dva tipa obračuna po radnici: **provizija** (% od prometa) ili **izdvajanje za materijal** (% ide na materijal, ostatak radnici)
- PDF izveštaj po radnici + rekapitulacija (sa srpskim slovima, Liberation Sans font)
- Istorija obračuna — pregled, storniranje, brisanje (PIN), **ponovno preuzimanje PDF-a** bilo kad (generiše se iznova iz sačuvanih brojeva)

## 7. Poznata ograničenja / šta NIJE urađeno

- **Zalihe/materijal** — razgovarano opširno (praćenje utroška boje/oksidanta po formuli klijenta, automatsko umanjenje zaliha, upozorenja ispod minimuma, lista za poručivanje) — **nije implementirano**, samo isplanirano. Detaljan plan postoji u istoriji razgovora ako se nastavi.
- **Admin stranica** za bezbednije upravljanje nalozima/šiframa — delimično urađeno kroz "Podešavanja" (radnice), ali ne i za same login naloge
- **Automatski bekap** (dnevni/nedeljni, na Google Drive ili email) — razgovarano, nije urađeno; trenutno je bekap ručni (dugme u Statistici)
- Brisanje obračuna u Istoriji i dalje koristi stariji PIN mehanizam (vidi tačku 5)
- Nema demo/probne verzije za prezentaciju drugima (razgovarano, odlučeno da nije trenutno potrebno)

## 8. Stil rada / kontekst za nastavak

- Sav tekst u aplikaciji je na srpskom (ćirilica se NE koristi, samo latinica sa č/ć/š/ž/đ)
- Vizuelni stil: toplo/kremasto (bež pozadina `#FBF6EE`, bordo akcenti `#7A2E3D`), font `Fraunces` (naslovi), `Work Sans` (telo teksta), `JetBrains Mono` (brojevi/cene)
- Korisnice aplikacije (Bilja, Ivana, Tamara) nisu tehnički potkovane — sve poruke greške, potvrde i uputstva u aplikaciji su namerno pisane jednostavnim, razumljivim jezikom
- Vlasnik (Adam) radi lokalno u Command Prompt-u (ne PowerShell, zbog ranijih problema sa execution policy), testira lokalno pre svakog push-a na GitHub

---

*Ovaj dokument je generisan avgusta 2026. na osnovu celokupne istorije razvoja aplikacije. Za tačan, aktuelan izvor istine uvek proveriti stvarni kod na GitHub-u — ovaj dokument je snimak stanja, ne živi izvor.*

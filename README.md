# Salon 2CATS · Evidencija

Web aplikacija za vođenje evidencije frizerskog salona — zakazivanje termina, baza klijenata, praćenje naplate, statistika prometa i obračun zarada.

🔗 **Live:** https://salon-evidencija.vercel.app

---

## Šta aplikacija radi

- **Kalendar** — mesečni pregled i dnevna vremenska osa (10:00–20:00, automatski se proširi za dan sa ranije zakazanim terminom), prevlačenje termina između radnica i vremena, povezani/višedelni termini (npr. bojenje + pauza + feniranje), fullscreen prikaz dana
- **Klijenti** — ime, telefon, slobodna beleška (npr. formula za farbanje kose)
- **Statistika** — promet (ukupno, keš/QR raspodela), promet po radnici i po vrsti usluge, izvoz/uvoz bekapa (JSON i Excel)
- **Podešavanja** — redosled, ime i boja svake radnice; kontrast prikaza na vremenskoj osi
- **Obračun zarada** (zaštićena sekcija, posebna prijava) — mesečni ili prilagođeni period, provizija ili izdvajanje za materijal po radnici, PDF izveštaji

Aplikacija je napravljena kao PWA — instalira se na telefon/računar kao "prava" aplikacija direktno iz browsera, bez prodavnice aplikacija.

## Tehnologije

- **React 18** + **Vite**
- **Firebase** — Firestore (baza) + Auth (prijava za Obračun)
- **Vercel** — hosting, automatski deploy na svaki push na `main`
- `recharts`, `jspdf` + `jspdf-autotable`, `xlsx`, `lucide-react`

## Pokretanje lokalno

```bash
npm install
npm run dev
```

Otvara se na `http://localhost:5173`. Za produkcioni build: `npm run build`.

## Struktura

```
src/
├── App.jsx              ← glavna aplikacija
├── PinGate.jsx           ← ekran za unos šifre pri otvaranju
├── appLock.js            ← šifra za PinGate
├── firebase.js           ← Firebase konfiguracija
└── payroll/               ← ceo modul za obračun zarada
    ├── PayrollView.jsx
    ├── calculations.js
    ├── pdf.js
    ├── utils.js
    └── fonts/
```

## Bezbednost / pristup

- **PIN ekran** — štiti od slučajnih poseta preko linka (šifra u `src/appLock.js`)
- **Obračun zarada** — odvojena email+šifra prijava (Firebase Auth), traži se uvek iznova bez obzira na trenutno stanje prijave
- **"Obriši sve podatke"** — ista dodatna zaštita kao Obračun

## Napomena

Sav tekst u aplikaci je na srpskom (latinica). Podaci (termini, klijenti, obračuni) žive u Firebase Firestore bazi, potpuno odvojeno od ovog koda — brisanje/izmena koda nikad ne utiče na već unete podatke.

Za bekap podataka koristi dugme "Izvezi bekap" u Statistici — preporučuje se povremeno (npr. mesečno) i čuvanje te kopije van salona (npr. Google Drive).

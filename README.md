# Salon · Evidencija

Aplikacija za zakazivanje i naplatu usluga — mesečni kalendar, dnevna vremenska osa,
baza klijenata sa recepturama, i statistika po radniku/usluzi.

Ovaj projekat koristi **Firebase Firestore** (besplatno) za čuvanje podataka, umesto
Claude-ovog ugrađenog skladišta — zato može da se hostuje potpuno besplatno preko GitHub-a.

---

## Šta ti treba (sve besplatno)

- Google nalog (za Firebase)
- GitHub nalog (već imaš)
- [Node.js](https://nodejs.org) instaliran na računaru (preuzmi LTS verziju, instalacija je "Next, Next, Finish")
- (Preporuka) [Vercel](https://vercel.com) nalog — za najlakše objavljivanje

---

## Korak 1 — Napravi Firebase projekat i bazu

1. Idi na **https://console.firebase.google.com**, uloguj se Google nalogom.
2. Klikni **"Add project"**, daj mu ime (npr. `salon-evidencija`), pa **Continue** dok se projekat ne napravi.
3. U levom meniju: **Build → Firestore Database → "Create database"**.
   - Izaberi lokaciju (npr. `europe-west3`).
   - Izaberi **"Start in test mode"** (dozvoljava čitanje/upis narednih 30 dana bez posebnih podešavanja — videti napomenu o bezbednosti niže).
4. Klikni na ikonicu **zupčanika** (gore levo, pored "Project Overview") → **Project settings**.
5. Skroluj do sekcije **"Your apps"** → klikni ikonicu **`</>`** (Web app).
6. Daj aplikaciji ime (npr. "salon-web") → **Register app**.
7. Firebase će ti prikazati kod sa konfiguracijom — kopiraj te vrednosti (`apiKey`, `authDomain`, `projectId`...) i zalepi ih u fajl **`src/firebase.js`** u ovom projektu, umesto placeholder teksta.
8. Uključi prijavu za "Obračun zarada": u levom meniju **Build → Authentication → "Get started"** →
   izaberi **"Email/Password"** sa liste provajdera → uključi (toggle) → **Save**.
9. U istom delu (Authentication), otvori tab **"Users"** → **"Add user"** → upiši svoj email i
   šifru koju ćeš koristiti za pristup obračunu zarada. To je jedini nalog koji postoji — nema
   registracije, samo taj jedan login koji ti praviš ručno ovde.
10. Uključi skladište za PDF dokumente: u levom meniju **Build → Storage → "Get started"** →
    prihvati podrazumeva podešavanja ("Start in test mode") → izaberi istu lokaciju kao za Firestore.

---

## Korak 1b — Preporučena bezbednosna pravila (posle Koraka 10)

Pošto sada čuvamo i podatke o zaradama, preporučujem da odmah podesiš Firestore i Storage
pravila da samo prijavljeni nalog (ti) može da čita/menja obračune — dok ostatak aplikacije
(zakazivanja, klijenti, usluge) ostaje otvoren za sve troje, bez prijave.

U Firebase konzoli: **Firestore Database → Rules**, zameni sadržaj sa:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /payrollRuns/{docId} {
      allow read, write: if request.auth != null;
    }
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

U **Storage → Rules**, zameni sa:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /payroll/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Klikni **Publish** posle izmene. (Ako ovo preskočiš, sve i dalje radi — samo je manje bezbedno,
slično kao i ostatak aplikacije dok je u "test mode".)

---

## Korak 2 — Testiraj lokalno na svom računaru

Otvori terminal (Command Prompt / Terminal) u folderu projekta i pokreni:

```bash
npm install
npm run dev
```

Otvori link koji se prikaže (obično `http://localhost:5173`) — aplikacija bi trebalo da radi
identično kao ranije, samo što sad podatke čuva u tvojoj Firebase bazi.

---

## Korak 3 — Postavi kod na GitHub

U terminalu, u folderu projekta:

```bash
git init
git add .
git commit -m "Prva verzija aplikacije"
git branch -M main
git remote add origin https://github.com/TVOJ-KORISNICKI-NALOG/salon-evidencija.git
git push -u origin main
```

(Pre ovoga napravi prazan repozitorijum na GitHub-u pod imenom `salon-evidencija` — dugme "New repository".)

---

## Korak 4 — Objavi aplikaciju (izaberi jednu opciju)

### Opcija A — Vercel (preporučeno, najjednostavnije)

1. Idi na **vercel.com**, klikni "Sign up", izaberi **"Continue with GitHub"**.
2. **"Add New… → Project"**, izaberi repozitorijum `salon-evidencija`.
3. Vercel sam prepoznaje da je Vite projekat — samo klikni **Deploy**.
4. Za par minuta dobijaš link (npr. `salon-evidencija.vercel.app`) koji radi na telefonu i računaru.
5. Od sada, svaki put kad pošalješ izmenu na GitHub (`git push`), Vercel **automatski** ažurira sajt — nema ništa dodatno da se radi.

### Opcija B — GitHub Pages

1. Na GitHub-u, u repozitorijumu: **Settings → Pages → Source: "GitHub Actions"**.
2. Projekat već sadrži gotov fajl (`.github/workflows/deploy.yml`) koji to radi automatski
   pri svakom push-u — ne treba ništa dodatno da se piše.
3. Link će izgledati kao `https://TVOJ-NALOG.github.io/salon-evidencija/`.

---

## Korak 5 — Podeli link

Isti link pošalji Ivani, Bilji i Tamari (Viber/WhatsApp). Na telefonu mogu da izaberu
**"Dodaj na početni ekran"** da dobiju ikonicu kao za pravu aplikaciju.

---

## Gde se sada čuvaju podaci

Svi podaci (zakazivanja i klijenti) čuvaju se u tvojoj **Firebase Firestore** bazi (Google-ov servis),
u realnom vremenu — kad neko unese ili izmeni nešto, sve ostale osobe koje gledaju aplikaciju
vide promenu odmah, bez potrebe za osvežavanjem stranice.

**Besplatni (Spark) Firebase plan** uključuje: 1 GB skladišta i 50.000 čitanja / 20.000 upisa
dnevno besplatno. Za mali salon (par desetina unosa dnevno) to nikad neće biti dostignuto —
realno, ovo ostaje besplatno zauvek na ovoj veličini korišćenja.

Dugmad **"Izvezi bekap" / "Uvezi bekap"** u Statistici i dalje rade, samo sad rade nad
Firebase bazom umesto Claude skladišta.

---

## ⚠️ Važna napomena o bezbednosti

"Test mode" u Firestore-u znači da baza **nema lozinku niti prijavljivanje** — svako ko ima
link ka aplikaciji (i ko bi eventualno pogledao kod u pretraživaču) tehnički može da čita i menja
podatke. Ovo je slično kao i kod trenutnog rešenja na Claude-u (link takođe nije zaštićen lozinkom),
ali ima jednu razliku: Firestore test-mode dozvola **ističe posle 30 dana** i mora se ručno produžiti
(Firestore Database → Rules), inače aplikacija prestaje da čita/piše podatke.

Ako želite dodatnu zaštitu (npr. jednostavan PIN kod pri otvaranju aplikacije), to je moguće
naknadno dodati — samo javi.

**Napomena o "Obračun" dugmetu:** prijava (email + šifra) sada štiti samo tu jednu stranicu u
aplikaciji (niko bez prijave je ne vidi). Kad budemo dodavali stvarne brojke obračuna zarada,
treba još i u Firestore Rules zaključati tu konkretnu kolekciju podataka da samo prijavljeni
nalog može da je čita/menja — podsetiću te na to kad budemo radili taj deo.

**Napomena o Firebase Storage (PDF dokumenti):** Google trenutno zahteva da projekat bude na
plaćenom ("Blaze") planu da bi se Storage uopšte mogao uključiti — čak i ako se u praksi ništa
ne naplati na ovoj veličini korišćenja (Blaze i dalje ima besplatni mesečni limit, samo traži
da kartica bude povezana). Dok se ne odluči da li i kada preći na Blaze, aplikacija radi bez
problema: klikom na "Zaključi mesec", ako Storage nije dostupan, PDF-ovi se automatski preuzimaju
direktno na računar umesto da se otpremaju u Storage, a sam obračun (brojevi, kartice, istorija)
se i dalje trajno čuva u Firestore-u kao i inače.

---

## Kako da ažuriramo aplikaciju ubuduće

1. Vrati se u razgovor sa Claude-om (ovaj isti ili novi), pošalji trenutni `src/App.jsx` i opiši
   šta želiš da se promeni ili doda.
2. Claude ti da ažurirani fajl (ili direktno objasni izmene).
3. Zameniš fajl u svom projektu i pošalješ na GitHub:
   ```bash
   git add .
   git commit -m "opis izmene"
   git push
   ```
4. Ako koristiš Vercel — sajt se automatski ažurira za par minuta. Ivana, Bilja i Tamara ne
   moraju ništa da rade, samo da osveže stranicu na telefonu.

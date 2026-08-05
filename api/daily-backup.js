// ============================================================
// AUTOMATSKI DNEVNI BEKAP na Google Drive salona
// ============================================================
// Ovaj fajl NIJE deo same aplikacije koju korisnice vide — to je
// poseban, "nevidljiv" zadatak koji Vercel sam pokreće jednom dnevno
// (podešeno u vercel.json), nezavisno od toga da li iko tog trenutka
// koristi aplikaciju.
//
// Šta radi, korak po korak:
//   1. Pročita sve termine i sve klijente iz Firestore baze
//   2. Napravi .json fajl (isti format kao ručni "Izvezi bekap")
//   3. Napravi .xlsx fajl (isti format kao ručni "Izvezi u Excel")
//   4. Otpremi oba fajla u podešeni folder na Google Drive-u salona
//
// Potrebna podešavanja pre puštanja u rad — pogledaj uputstvo koje je
// Claude dao uz ovaj fajl (kreiranje service account naloga, deljenje
// Drive foldera, i dodavanje environment varijabli na Vercel-u).
// ============================================================

import { google } from "googleapis";
import * as XLSX from "xlsx";
import { Readable } from "stream";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "Nedostaje GOOGLE_SERVICE_ACCOUNT_KEY environment promenljiva (podešava se na Vercel-u)."
    );
  }
  return JSON.parse(raw);
}

function getFirestoreDb(serviceAccount) {
  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

async function fetchCollection(db, name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function buildJsonBuffer(appointments, clients) {
  const payload = {
    appointments,
    clients,
    exportedAt: new Date().toISOString(),
    source: "automatski-dnevni-bekap",
  };
  return Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
}

function buildXlsxBuffer(appointments, clients) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(appointments), "Zakazivanja");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clients), "Klijenti");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

async function uploadToDrive(authClient, folderId, filename, mimeType, buffer) {
  const drive = google.drive({ version: "v3", auth: authClient });
  await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: bufferToStream(buffer) },
    fields: "id",
  });
}

export default async function handler(req, res) {
  // Vercel automatski dodaje ovaj header kad SAM pokrene zakazani zadatak —
  // ovo sprečava da bilo ko drugi (znajući link) pokrene bekap ručno spolja.
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "Neovlašćen pristup." });
  }

  try {
    const serviceAccount = getServiceAccount();
    const db = getFirestoreDb(serviceAccount);

    const [appointments, clients] = await Promise.all([
      fetchCollection(db, "appointments"),
      fetchCollection(db, "clients"),
    ]);

    const jsonBuffer = buildJsonBuffer(appointments, clients);
    const xlsxBuffer = buildXlsxBuffer(appointments, clients);

    const googleAuth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    const authClient = await googleAuth.getClient();

    const folderId = process.env.BACKUP_DRIVE_FOLDER_ID;
    if (!folderId) {
      throw new Error("Nedostaje BACKUP_DRIVE_FOLDER_ID environment promenljiva.");
    }

    const dateStr = new Date().toISOString().slice(0, 10); // npr. 2026-08-06

    await uploadToDrive(authClient, folderId, `bekap-${dateStr}.json`, "application/json", jsonBuffer);
    await uploadToDrive(
      authClient,
      folderId,
      `bekap-${dateStr}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xlsxBuffer
    );

    return res.status(200).json({
      ok: true,
      date: dateStr,
      appointments: appointments.length,
      clients: clients.length,
    });
  } catch (e) {
    console.error("Greška pri automatskom bekapu:", e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

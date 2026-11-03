// Push obaveštenja (Firebase Cloud Messaging) — klijentski deo.
import { getApp } from "firebase/app";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db, auth } from "./firebase";

// Javni "Web Push" ključ iz Firebase konzole:
// Project settings → Cloud Messaging → Web Push certificates → Generate key pair.
// (Javan je po dizajnu, sme da stoji u kodu.)
const VAPID_KEY = "BHWySoSgWsndVNeC2E4PyXIi9tKavByiK2cpsiKdFnIIR0YwGet3ud4AMg0hp1L3aX9x6SqmV-Uxe8_W9oYnRoQ";

// Za lokalni test protiv objavljene funkcije: VITE_API_BASE=https://tvoj-link.vercel.app
const API_BASE = import.meta.env.VITE_API_BASE || "";
const TOKEN_KEY = "salon-push-token";
const COLLECTION_TOKENS = "deviceTokens";

export const pushPermission = () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

export async function pushSupported() {
  try {
    return typeof Notification !== "undefined" && "serviceWorker" in navigator && (await isSupported());
  } catch (e) {
    return false;
  }
}

async function registerAndGetToken() {
  const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  return getToken(getMessaging(getApp()), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
}

async function saveToken(token, employeeId) {
  await setDoc(doc(db, COLLECTION_TOKENS, token), {
    employeeId,
    updatedAt: Date.now(),
    ua: (navigator.userAgent || "").slice(0, 200),
  });
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch (e) {}
}

// Poziva se pritiskom na dugme (iPhone traži korisnikov klik). Vraća { ok, reason }.
export async function enablePush(employeeId) {
  try {
    if (!(await pushSupported())) return { ok: false, reason: "unsupported" };
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "denied" };
    const token = await registerAndGetToken();
    if (!token) return { ok: false, reason: "no-token" };
    await saveToken(token, employeeId);
    return { ok: true };
  } catch (e) {
    console.error("Push nije uključen:", e);
    return { ok: false, reason: "error" };
  }
}

// Tiho osvežavanje kad je dozvola već data (token se ponekad promeni; veže ga za trenutnu radnicu).
export async function refreshPush(employeeId) {
  try {
    if (pushPermission() !== "granted" || !(await pushSupported())) return;
    const token = await registerAndGetToken();
    if (token) await saveToken(token, employeeId);
  } catch (e) {
    console.error("Osvežavanje push tokena nije uspelo:", e);
  }
}

// Uklanja ovaj uređaj sa liste za obaveštenja.
export async function disablePush() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) await deleteDoc(doc(db, COLLECTION_TOKENS, token));
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

// Poruke dok je aplikacija otvorena (u pozadini ih prikazuje servisni radnik).
export async function listenForeground(cb) {
  try {
    if (pushPermission() !== "granted" || !(await pushSupported())) return () => {};
    return onMessage(getMessaging(getApp()), (payload) => cb(payload.data || {}));
  } catch (e) {
    return () => {};
  }
}

// messages: [{ to: "ivana", kind, title, body }]  — server šalje svim uređajima te radnice.
export async function sendPush(messages) {
  try {
    const user = auth.currentUser;
    if (!user || !messages.length) return;
    const idToken = await user.getIdToken();
    const res = await fetch(`${API_BASE}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ messages }),
      keepalive: true,
    });
    if (!res.ok) console.error("Obaveštenje: server je vratio", res.status);
  } catch (e) {
    console.error("Slanje obaveštenja nije uspelo:", e);
  }
}

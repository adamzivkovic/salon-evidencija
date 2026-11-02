/* Servisni radnik za push obaveštenja (Firebase Cloud Messaging).
   Prima poruke kad je aplikacija zatvorena ili u pozadini. */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD0wTEyvrg6PZuk8bxgR3k2VkOLx2eDLQo",
  authDomain: "salon-2cats-evidencija.firebaseapp.com",
  projectId: "salon-2cats-evidencija",
  storageBucket: "salon-2cats-evidencija.firebasestorage.app",
  messagingSenderId: "19075813339",
  appId: "1:19075813339:web:74e0ddefcf4146f62021fe",
});

const messaging = firebase.messaging();

// Šaljemo "data" poruke, pa prikaz obaveštenja radimo ovde (uvek, i na iPhone-u).
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  return self.registration.showNotification(d.title || "Salon 2CATS", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag || undefined,
    data: { url: "/" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return clients.openWindow("/");
    })
  );
});

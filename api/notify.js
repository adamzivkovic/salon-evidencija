// Vercel funkcija: šalje push obaveštenje uređajima radnice kojoj je termin dodat/izmenjen/obrisan.
// Tajni ključ servisnog naloga čita se ISKLJUČIVO iz Vercel promenljive FIREBASE_SERVICE_ACCOUNT.
import admin from "firebase-admin";

const BAD_TOKEN_CODES = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
];

function init() {
  if (admin.apps.length) return;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const clip = (v, n) => String(v ?? "").slice(0, n);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  try {
    init();
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
    if (!m) return res.status(401).json({ error: "auth" });
    await admin.auth().verifyIdToken(m[1]); // samo prijavljeni korisnici aplikacije

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(0, 6) : [];
    const db = admin.firestore();
    let sent = 0;

    for (const msg of messages) {
      const to = clip(msg.to, 64);
      if (!to) continue;
      const snap = await db.collection("deviceTokens").where("employeeId", "==", to).get();
      const tokens = snap.docs.map((d) => d.id);
      if (!tokens.length) continue;

      const resp = await admin.messaging().sendEachForMulti({
        tokens,
        data: {
          title: clip(msg.title, 80),
          body: clip(msg.body, 200),
          kind: clip(msg.kind, 16),
          tag: `${clip(msg.kind, 16)}-${Date.now()}`,
        },
        webpush: { headers: { Urgency: "high", TTL: "3600" } },
      });

      sent += resp.successCount;
      // Očisti uređaje koji više ne postoje (obrisana aplikacija, odjavljen uređaj...).
      await Promise.all(
        resp.responses.map((r, i) =>
          !r.success && BAD_TOKEN_CODES.includes(r.error?.code)
            ? db.collection("deviceTokens").doc(tokens[i]).delete()
            : null
        )
      );
    }
    return res.status(200).json({ ok: true, sent });
  } catch (e) {
    console.error("notify greška:", e);
    return res.status(500).json({ error: "server" });
  }
}

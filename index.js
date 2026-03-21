/**
 * BabyFeed — Firebase Cloud Functions
 *
 * 1. askAI            — Proxies Claude API (keeps key server-side)
 * 2. checkHungerAlerts — Push notifications when baby is hungry
 *
 * SETUP:
 * 1. cd functions && npm install
 * 2. firebase functions:config:set \
 *      anthropic.key="YOUR_ANTHROPIC_API_KEY" \
 *      vapid.private_key="YOUR_VAPID_PRIVATE_KEY" \
 *      vapid.public_key="BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDkBNE24H6HYk4nOj1LySa7FpnB6h7h4HQNDI5Tq0C4A" \
 *      vapid.subject="mailto:shodipeadeolu@gmail.com"
 * 3. firebase deploy --only functions
 *
 * GET ANTHROPIC KEY: console.anthropic.com → API Keys
 * GET VAPID KEYS:    web-push generate-vapid-keys
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const webpush = require("web-push");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

// ═══════════════════════════════════════════════════════════════
// FUNCTION 1: AI Proxy — calls Claude on behalf of the app
// ═══════════════════════════════════════════════════════════════
exports.askAI = functions.https.onRequest(async (req, res) => {
  // CORS — allow requests from your domain
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { messages, systemPrompt, uid, plan } = req.body;

    if (!messages || !uid) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Verify the user exists in Firebase Auth
    try {
      await admin.auth().getUser(uid);
    } catch (e) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Check rate limit from Firestore
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.data() || {};
    const today = new Date().toDateString();
    const limits = { free: 5, basic: 30, pro: 99999 };
    const userPlan = userData.aiPlan || "free";
    const limit = limits[userPlan] || 5;
    const usedToday = userData.aiResetDate === today ? (userData.aiMsgsToday || 0) : 0;

    if (usedToday >= limit) {
      res.status(429).json({ error: `Daily limit reached (${limit} on ${userPlan} plan)` });
      return;
    }

    // Call Claude API
    const config = functions.config();
    const apiKey = config.anthropic?.key;
    if (!apiKey) {
      res.status(500).json({ error: "API not configured" });
      return;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        system: systemPrompt || "You are BabyFeed AI, a helpful assistant for parents.",
        messages: messages.map(m => ({ role: m.role, content: m.content }))
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Anthropic error:", data);
      res.status(500).json({ error: "AI service error" });
      return;
    }

    const reply = data.content?.[0]?.text || "Sorry, I could not generate a response.";

    // Update usage count in Firestore
    await db.collection("users").doc(uid).set(
      { aiMsgsToday: usedToday + 1, aiResetDate: today },
      { merge: true }
    );

    res.json({ reply, usage: { used: usedToday + 1, limit, plan: userPlan } });

  } catch (err) {
    console.error("askAI error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════
// FUNCTION 2: Hunger Alerts — push when baby is predicted hungry
// ═══════════════════════════════════════════════════════════════
function predictNextHunger(logs) {
  if (!logs || logs.length < 3) return null;
  const sorted = [...logs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const intervals = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push((new Date(sorted[i].timestamp) - new Date(sorted[i - 1].timestamp)) / 60000);
  }
  if (intervals.length < 2) return null;
  const recent10 = sorted.slice(-10);
  const recent10intervals = intervals.slice(-9);
  const lastFeed = sorted[sorted.length - 1];
  const totalWeight = recent10.slice(1).reduce((s, f) => s + (f.amount || 0), 0) || 1;
  const weightedInterval = recent10intervals.reduce(
    (s, iv, i) => s + iv * (recent10[i + 1]?.amount || 60), 0
  ) / totalWeight;
  const avgAmount = recent10.reduce((s, f) => s + (f.amount || 0), 0) / recent10.length || 60;
  const lastAmount = lastFeed.amount || 60;
  const fullnessFactor = Math.min(1.5, Math.max(0.5, lastAmount / avgAmount));
  const now = Date.now();
  const timeSinceLastFeed = (now - new Date(lastFeed.timestamp).getTime()) / 60000;
  const recencyFactor = Math.min(1.0, Math.max(0.7, 1 - (timeSinceLastFeed / weightedInterval) * 0.3));
  const adjustedInterval = Math.round(weightedInterval * fullnessFactor * recencyFactor);
  const nextHungerMs = new Date(lastFeed.timestamp).getTime() + adjustedInterval * 60000;
  const diffMs = nextHungerMs - now;
  return { isHungry: diffMs < 0, minutesUntil: Math.round(diffMs / 60000), lastFeed, lastAmount };
}

function timeSince(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

exports.checkHungerAlerts = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const config = functions.config();
    webpush.setVapidDetails(
      config.vapid.subject,
      config.vapid.public_key,
      config.vapid.private_key
    );
    const familiesSnap = await db.collection("families").get();
    for (const familyDoc of familiesSnap.docs) {
      const familyId = familyDoc.id;
      try {
        const babiesSnap = await db.collection(`families/${familyId}/babies`).get();
        if (babiesSnap.empty) continue;
        const subsSnap = await db.collection(`families/${familyId}/pushSubscriptions`).get();
        if (subsSnap.empty) continue;
        const subscriptions = subsSnap.docs.map(d => d.data().subscription).filter(Boolean);
        for (const babyDoc of babiesSnap.docs) {
          const baby = { id: babyDoc.id, ...babyDoc.data() };
          const logsSnap = await db.collection(`families/${familyId}/logs`)
            .where("babyId", "==", baby.id)
            .orderBy("timestamp", "desc")
            .limit(20)
            .get();
          if (logsSnap.empty) continue;
          const logs = logsSnap.docs.map(d => d.data());
          const prediction = predictNextHunger(logs);
          if (!prediction || !prediction.isHungry) continue;
          const dedupKey = `hungryAlert_${familyId}_${baby.id}`;
          const dedupDoc = await db.collection("_alerts").doc(dedupKey).get();
          if (dedupDoc.exists) {
            const lastSent = dedupDoc.data().sentAt?.toMillis() || 0;
            if (Date.now() - lastSent < 30 * 60 * 1000) continue;
          }
          const payload = JSON.stringify({
            title: `🍼 ${baby.name} is hungry!`,
            body: `Last fed ${timeSince(prediction.lastFeed.timestamp)} (${prediction.lastAmount}ml) — time for a feed`,
            tag: `hungry-${baby.id}`,
            url: `/?baby=${baby.id}&view=log`
          });
          await Promise.all(subscriptions.map(sub =>
            webpush.sendNotification(sub, payload).catch(err => {
              if (err.statusCode === 410) {
                return db.collection(`families/${familyId}/pushSubscriptions`)
                  .where("subscription.endpoint", "==", sub.endpoint)
                  .get().then(snap => snap.forEach(d => d.ref.delete()));
              }
            })
          ));
          await db.collection("_alerts").doc(dedupKey).set({
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            babyId: baby.id, familyId
          });
          console.log(`Hunger alert sent for ${baby.name} in family ${familyId}`);
        }
      } catch (err) {
        console.error(`Error processing family ${familyId}:`, err);
      }
    }
    return null;
  });

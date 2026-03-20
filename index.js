/**
 * BabyFeed — Background Hunger Alert Cloud Function
 * 
 * Runs every 5 minutes, checks all families for hungry babies,
 * sends push notifications to all subscribed devices.
 * 
 * SETUP:
 * 1. cd functions && npm install
 * 2. firebase functions:config:set vapid.private_key="YOUR_VAPID_PRIVATE_KEY" vapid.public_key="BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDkBNE24H6HYk4nOj1LySa7FpnB6h7h4HQNDI5Tq0C4A" vapid.subject="mailto:shodipeadeolu@gmail.com"
 * 3. firebase deploy --only functions
 * 
 * GENERATE VAPID KEYS (run once):
 * npm install -g web-push
 * web-push generate-vapid-keys
 * Copy the private key into the config above.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const webpush = require("web-push");

admin.initializeApp();
const db = admin.firestore();

// ── Hunger prediction (mirrors computeInsights logic in index.html) ──────────
function predictNextHunger(logs) {
  if (!logs || logs.length < 3) return null;

  const sorted = [...logs].sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );

  const intervals = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(
      (new Date(sorted[i].timestamp) - new Date(sorted[i - 1].timestamp)) / 60000
    );
  }

  if (intervals.length < 2) return null;

  const recent10 = sorted.slice(-10);
  const recent10intervals = intervals.slice(-9);
  const lastFeed = sorted[sorted.length - 1];

  // Amount-weighted interval
  const totalWeight = recent10.slice(1).reduce((s, f) => s + (f.amount || 0), 0) || 1;
  const weightedInterval = recent10intervals.reduce(
    (s, iv, i) => s + iv * (recent10[i + 1]?.amount || 60), 0
  ) / totalWeight;

  // Fullness factor
  const avgAmount = recent10.reduce((s, f) => s + (f.amount || 0), 0) / recent10.length || 60;
  const lastAmount = lastFeed.amount || 60;
  const fullnessFactor = Math.min(1.5, Math.max(0.5, lastAmount / avgAmount));

  // Recency factor
  const now = Date.now();
  const timeSinceLastFeed = (now - new Date(lastFeed.timestamp).getTime()) / 60000;
  const recencyFactor = Math.min(1.0, Math.max(0.7, 1 - (timeSinceLastFeed / weightedInterval) * 0.3));

  const adjustedInterval = Math.round(weightedInterval * fullnessFactor * recencyFactor);
  const nextHungerMs = new Date(lastFeed.timestamp).getTime() + adjustedInterval * 60000;
  const diffMs = nextHungerMs - now;

  return {
    isHungry: diffMs < 0,
    minutesUntil: Math.round(diffMs / 60000),
    lastFeed,
    adjustedInterval,
    lastAmount
  };
}

// ── Format time since ────────────────────────────────────────────────────────
function timeSince(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

// ── Main scheduled function ───────────────────────────────────────────────────
exports.checkHungerAlerts = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const config = functions.config().vapid;

    webpush.setVapidDetails(
      config.subject,
      config.public_key,
      config.private_key
    );

    // Get all families
    const familiesSnap = await db.collection("families").get();

    for (const familyDoc of familiesSnap.docs) {
      const familyId = familyDoc.id;

      try {
        // Get babies
        const babiesSnap = await db
          .collection(`families/${familyId}/babies`)
          .get();
        if (babiesSnap.empty) continue;

        // Get push subscriptions for this family
        const subsSnap = await db
          .collection(`families/${familyId}/pushSubscriptions`)
          .get();
        if (subsSnap.empty) continue;

        const subscriptions = subsSnap.docs.map(d => d.data().subscription).filter(Boolean);

        // Check each baby
        for (const babyDoc of babiesSnap.docs) {
          const baby = { id: babyDoc.id, ...babyDoc.data() };

          // Get recent logs for this baby (last 20)
          const logsSnap = await db
            .collection(`families/${familyId}/logs`)
            .where("babyId", "==", baby.id)
            .orderBy("timestamp", "desc")
            .limit(20)
            .get();

          if (logsSnap.empty) continue;
          const logs = logsSnap.docs.map(d => d.data());

          const prediction = predictNextHunger(logs);
          if (!prediction || !prediction.isHungry) continue;

          // Dedup — don't send more than once per 30 minutes per baby
          const dedupKey = `hungryAlert_${familyId}_${baby.id}`;
          const dedupDoc = await db.collection("_alerts").doc(dedupKey).get();
          if (dedupDoc.exists) {
            const lastSent = dedupDoc.data().sentAt?.toMillis() || 0;
            if (Date.now() - lastSent < 30 * 60 * 1000) continue; // skip if sent < 30m ago
          }

          // Build notification payload
          const lastFeedTime = timeSince(prediction.lastFeed.timestamp);
          const payload = JSON.stringify({
            title: `🍼 ${baby.name} is hungry!`,
            body: `Last fed ${lastFeedTime} (${prediction.lastAmount}ml) — time for a feed`,
            tag: `hungry-${baby.id}`,
            url: `/?baby=${baby.id}&view=log`
          });

          // Send to all subscribed devices in this family
          const sendPromises = subscriptions.map(sub =>
            webpush.sendNotification(sub, payload).catch(err => {
              // Remove invalid subscriptions
              if (err.statusCode === 410) {
                return db
                  .collection(`families/${familyId}/pushSubscriptions`)
                  .where("subscription.endpoint", "==", sub.endpoint)
                  .get()
                  .then(snap => snap.forEach(d => d.ref.delete()));
              }
            })
          );

          await Promise.all(sendPromises);

          // Record send time for dedup
          await db.collection("_alerts").doc(dedupKey).set({
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            babyId: baby.id,
            familyId
          });

          console.log(`Sent hunger alert for ${baby.name} in family ${familyId}`);
        }
      } catch (err) {
        console.error(`Error processing family ${familyId}:`, err);
      }
    }

    return null;
  });

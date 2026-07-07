const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const webpush = require("web-push");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

admin.initializeApp();
const AI_LIMITS = { free: 5, basic: 30, pro: Infinity };

// Limit instances
setGlobalOptions({ maxInstances: 10 });

// VAPID keys
webpush.setVapidDetails(
  "mailto:shodipeadeolu@gmail.com",
  "BCTuAvdzKebK4XuKmHZMMvH0tjnVTho-FwEUtKty34FqTr_IvXAFLVKa0fM3-1trzGQlrxxZUlDd5jmsPM_hWtg",
  "fFWlomc6880cRgnKLItddo_DzYfG2DQZ_IkvM05N504"
);

exports.askAI = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, systemPrompt, uid } = req.body;
  if (!uid || !messages) return res.status(400).json({ error: "Missing uid or messages" });

  try {
    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const userData = (await userRef.get()).data() || {};

    const plan = userData.subscription?.plan || "free";
    const limit = AI_LIMITS[plan] ?? AI_LIMITS.free;
    const today = new Date().toISOString().slice(0, 10);
    const used = userData.aiResetDate === today ? (userData.aiMsgsToday || 0) : 0;

    if (limit !== Infinity && used >= limit) {
      return res.status(429).json({ error: "Daily limit reached", usage: { used, limit } });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 350,
      system: systemPrompt || "You are a helpful baby care assistant.",
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const reply = response.content[0]?.text || "";
    await userRef.set({ aiMsgsToday: used + 1, aiResetDate: today }, { merge: true });

    return res.status(200).json({ reply, usage: { used: used + 1 } });
  } catch (err) {
    logger.error("askAI error:", err);
    return res.status(500).json({ error: "AI request failed" });
  }
});

// Function
exports.sendNotification = onRequest(async (req, res) => {
  try {
    const subscription = req.body.subscription;

    const payload = JSON.stringify({
      title: "BabyFeed Notification 👶",
      body: "Your reminder is working!",
    });

    await webpush.sendNotification(subscription, payload);

    res.status(200).send("Notification sent!");
  } catch (error) {
    logger.error(error);
    res.status(500).send("Error sending notification");
  }
});
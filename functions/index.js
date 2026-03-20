const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const webpush = require("web-push");

// Limit instances
setGlobalOptions({ maxInstances: 10 });

// VAPID keys
webpush.setVapidDetails(
  "mailto:shodipeadeolu@gmail.com",
  "BCTuAvdzKebK4XuKmHZMMvH0tjnVTho-FwEUtKty34FqTr_IvXAFLVKa0fM3-1trzGQlrxxZUlDd5jmsPM_hWtg",
  "fFWlomc6880cRgnKLItddo_DzYfG2DQZ_IkvM05N504"
);

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
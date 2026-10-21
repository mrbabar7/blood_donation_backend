// Expo push delivery (expo-server-sdk) for chat notifications.
//
// The app's other pushes (blood requests, calls, admin broadcasts) go through
// Firebase Admin using the device's native FCM token — that path is untouched.
// Chat pushes prefer an Expo push token when the recipient has registered one
// (User.expoPushToken) and fall back to the FCM path otherwise, so a device is
// only ever notified through ONE transport per message (no duplicates).
//
// expo-server-sdk has shipped as both CJS and ESM across major versions, so it
// is loaded defensively; if it cannot be loaded at all, every call here simply
// reports "not sent" and the caller falls back to FCM.

let ExpoClass = null;
let expoClient = null;

const loadExpo = async () => {
  if (expoClient) return { Expo: ExpoClass, client: expoClient };
  let lib;
  try {
    lib = require("expo-server-sdk");
  } catch (e) {
    lib = await import("expo-server-sdk");
  }
  ExpoClass = lib.Expo || (lib.default && lib.default.Expo) || lib.default;
  expoClient = new ExpoClass(
    process.env.EXPO_ACCESS_TOKEN ? { accessToken: process.env.EXPO_ACCESS_TOKEN } : {},
  );
  return { Expo: ExpoClass, client: expoClient };
};

const isValidExpoToken = async (token) => {
  if (!token || typeof token !== "string") return false;
  try {
    const { Expo } = await loadExpo();
    return Expo.isExpoPushToken(token);
  } catch {
    return false;
  }
};

// Receipts are only available some minutes after sending. Checked once,
// best-effort, purely to drop tokens Expo says are dead (app uninstalled).
const RECEIPT_CHECK_DELAY_MS = 15 * 60 * 1000;

const scheduleReceiptCheck = (ticketId, token, onInvalidToken) => {
  const timer = setTimeout(async () => {
    try {
      const { client } = await loadExpo();
      const receipts = await client.getPushNotificationReceiptsAsync([ticketId]);
      const receipt = receipts[ticketId];
      if (receipt?.status === "error") {
        console.error("[expo-push] receipt error:", receipt.message, receipt.details);
        if (receipt.details?.error === "DeviceNotRegistered" && onInvalidToken) {
          await onInvalidToken(token);
        }
      }
    } catch (err) {
      console.error("[expo-push] receipt check failed:", err.message);
    }
  }, RECEIPT_CHECK_DELAY_MS);
  if (typeof timer.unref === "function") timer.unref();
};

/**
 * Sends one Expo push. Never throws.
 * Resolves { sent: boolean, invalidToken?: boolean, error?: string }.
 * `sent` is true only when Expo accepted the message (ticket status "ok").
 */
const sendExpoPush = async (token, { title, body, data = {}, channelId = "high_importance_v1" }, onInvalidToken) => {
  try {
    if (!(await isValidExpoToken(token))) return { sent: false, error: "invalid-expo-token" };
    const { client } = await loadExpo();

    const message = {
      to: token,
      title,
      body,
      data,
      sound: "default",
      priority: "high",
      channelId, // Android channel created in SocketContext.registerPushToken
    };

    const tickets = [];
    for (const chunk of client.chunkPushNotifications([message])) {
      tickets.push(...(await client.sendPushNotificationsAsync(chunk)));
    }
    const ticket = tickets[0];
    if (!ticket) return { sent: false, error: "no-ticket" };

    if (ticket.status === "ok") {
      if (ticket.id) scheduleReceiptCheck(ticket.id, token, onInvalidToken);
      return { sent: true };
    }

    const code = ticket.details?.error;
    console.error("[expo-push] ticket error:", ticket.message, ticket.details);
    if (code === "DeviceNotRegistered" && onInvalidToken) await onInvalidToken(token);
    return { sent: false, invalidToken: code === "DeviceNotRegistered", error: code || ticket.message };
  } catch (err) {
    console.error("[expo-push] send failed:", err.message);
    return { sent: false, error: err.message };
  }
};

module.exports = { sendExpoPush, isValidExpoToken };

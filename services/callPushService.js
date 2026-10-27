const callState = require("./callStateService");

const HIGH_IMPORTANCE_CHANNEL = "high_importance_v1";
// Missed-call notifications are informational: keep them deliverable for a day.
const MISSED_TTL_MS = 24 * 60 * 60 * 1000;
// Never bother the device with an incoming-call push that would ring for less
// than this long — the call is effectively over by the time it would land.
const MIN_RING_TTL_MS = 3_000;

const stringifyData = (data = {}) => {
  const out = {};
  for (const key of Object.keys(data)) {
    const v = data[key];
    if (v === undefined || v === null) continue;
    out[key] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return out;
};

const pickToken = (user) => user?.fcmToken || user?.pushToken || null;

// ---- pure builders -----------------------------------------------------------

const buildIncomingCallData = ({ call, callerName, now = new Date() }) => ({
  type: "INCOMING_CALL",
  callId: String(call._id),
  requestId: String(call.requestId),
  callerId: String(call.callerId),
  callerName: callerName || "",
  expiresAt: callState.effectiveExpiry(call).toISOString(),
  sentAt: new Date(now).toISOString(),
});

// ttlMs is the REMAINING ring time, so a stale ring is dropped by FCM/APNs
// themselves when the device was unreachable. (A zero TTL — "now or never" — is
// stricter still, but Android FCM only honours it for collapsible messages and
// can drop a ring that is a second away from delivery; the remaining-window TTL
// is the documented fallback.) apns-expiration is an absolute unix time.
const buildIncomingCallMessage = ({
  token,
  call,
  callerName,
  now = new Date(),
  title,
  body,
}) => {
  const ttlMs = callState.remainingMs(call, now);
  const data = stringifyData({
    ...buildIncomingCallData({ call, callerName, now }),
    ttlMs,
  });
  const expirySeconds = Math.floor((new Date(now).getTime() + ttlMs) / 1000);
  return {
    token,
    // No top-level `notification` block on purpose: a notification message is
    // shown by the system tray with no actions and, on Android, never reaches
    // the app's background handler. Data-only + high priority wakes the app.
    data,
    android: {
      priority: "high",
      ttl: ttlMs,
      collapseKey: `call_${call._id}`,
    },
    apns: {
      headers: {
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(expirySeconds),
        "apns-collapse-id": String(call._id).slice(0, 64),
      },
      payload: {
        aps: {
          alert: {
            title:
              title ||
              (callerName ? `${callerName} is calling…` : "Incoming call"),
            body: body || "Tap to answer",
          },
          sound: "default",
          "content-available": 1,
          "interruption-level": "time-sensitive",
        },
      },
    },
  };
};

const buildCancelMessage = ({ token, call, reason }) => ({
  token,
  data: stringifyData({
    type: "CALL_CANCELLED",
    callId: String(call._id),
    requestId: String(call.requestId),
    reason: reason || "",
  }),
  android: { priority: "high", ttl: 60_000, collapseKey: `call_${call._id}` },
  apns: {
    headers: {
      "apns-push-type": "background",
      "apns-priority": "5",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 60),
    },
    payload: { aps: { "content-available": 1 } },
  },
});

const buildMissedCallMessage = ({ token, payload }) => {
  const who = payload.callerName || "Someone";
  const title = "Missed call";
  const body = `${who} called you`;
  return {
    token,
    notification: { title, body },
    // Deliberately NO `link` field pointing at /call/... : the client routes on
    // data.type === "MISSED_CALL" to Call History.
    data: stringifyData(payload),
    android: {
      priority: "high",
      ttl: MISSED_TTL_MS,
      collapseKey: `missed_${payload.callerId}`,
      notification: {
        title,
        body,
        sound: "default",
        channelId: HIGH_IMPORTANCE_CHANNEL,
        visibility: "public",
        tag: `missed_${payload.callId}`,
      },
    },
    apns: {
      headers: {
        "apns-expiration": String(
          Math.floor(Date.now() / 1000) + MISSED_TTL_MS / 1000,
        ),
      },
      payload: { aps: { sound: "default", "thread-id": "missed-calls" } },
    },
  };
};

const buildDeclinedMessage = ({ token, call, calleeName }) => ({
  token,
  notification: {
    title: "Call declined",
    body: calleeName
      ? `${calleeName} declined your call`
      : "Your call was declined",
  },
  data: stringifyData({
    type: "CALL_DECLINED",
    callId: String(call._id),
    requestId: String(call.requestId),
  }),
  android: {
    priority: "high",
    ttl: 60_000,
    notification: { channelId: HIGH_IMPORTANCE_CHANNEL, sound: "default" },
  },
});

// ---- senders -----------------------------------------------------------------

const getMessaging = () => require("../config/firebaseAdmin").messaging;

const safeSend = async (message, label, messaging = getMessaging()) => {
  try {
    const id = await messaging.send(message);
    if (process.env.SOCKET_DEBUG) console.log(`📞 ${label} push sent:`, id);
    return { sent: true, id };
  } catch (err) {
    console.error(`❌ ${label} push failed:`, err.message || err);
    return { sent: false, error: err.code || err.message };
  }
};

// Re-checks the call against the DB RIGHT BEFORE sending: a push is only ever a
// signal for a call that is still ringing and unexpired. `fetchCall` is
// injectable for tests.
const sendIncomingCallPush = async ({
  callId,
  callee,
  callerName,
  now = new Date(),
  fetchCall,
  messaging,
}) => {
  const token = pickToken(callee);
  if (!token) return { sent: false, reason: "no_token" };
  const call = await (fetchCall
    ? fetchCall(callId)
    : require("../models/callModel").findById(callId));
  if (!call) return { sent: false, reason: "no_call" };
  if (!callState.isRinging(call, now))
    return { sent: false, reason: "not_ringing" };
  if (callState.remainingMs(call, now) < MIN_RING_TTL_MS)
    return { sent: false, reason: "too_late" };
  const res = await safeSend(
    buildIncomingCallMessage({ token, call, callerName, now }),
    "incoming-call",
    messaging,
  );
  return { ...res, reason: res.sent ? "sent" : "send_failed" };
};

const sendCallCancelledPush = async ({ call, callee, reason, messaging }) => {
  const token = pickToken(callee);
  if (!token || !call) return { sent: false, reason: "no_token" };
  return safeSend(
    buildCancelMessage({ token, call, reason }),
    "call-cancelled",
    messaging,
  );
};

const sendMissedCallPush = async ({
  call,
  callee,
  callerName,
  now = new Date(),
  messaging,
}) => {
  const token = pickToken(callee);
  if (!token || !call) return { sent: false, reason: "no_token" };
  const payload = callState.buildMissedCallPayload({ call, callerName, now });
  return safeSend(
    buildMissedCallMessage({ token, payload }),
    "missed-call",
    messaging,
  );
};

const sendCallDeclinedPush = async ({
  call,
  caller,
  calleeName,
  messaging,
}) => {
  const token = pickToken(caller);
  if (!token || !call) return { sent: false, reason: "no_token" };
  return safeSend(
    buildDeclinedMessage({ token, call, calleeName }),
    "call-declined",
    messaging,
  );
};

module.exports = {
  MISSED_TTL_MS,
  MIN_RING_TTL_MS,
  stringifyData,
  buildIncomingCallData,
  buildIncomingCallMessage,
  buildCancelMessage,
  buildMissedCallMessage,
  buildDeclinedMessage,
  sendIncomingCallPush,
  sendCallCancelledPush,
  sendMissedCallPush,
  sendCallDeclinedPush,
};

// ============================================================================
// Push delivery for the call lifecycle. Pure payload builders (unit-tested) +
// thin senders. Nothing here throws: a push failure must never break a call.
//
// Message types (data.type):
//   INCOMING_CALL   data-only, HIGH priority, TTL <= remaining ring window.
//                   If the app does not confirm the ring (POST /calls/:id/ring-ack) within
//                   ~3 s, runRingFallback sends a visible Android notification instead.
//                   The app's background handler turns it into a Notifee
//                   notification with Accept / Decline (Android) after
//                   re-validating the call. iOS gets an alert push (and the
//                   VoIP/CallKit path when a PushKit token is registered).
//   CALL_CANCELLED  data-only. Caller hung up / call answered elsewhere /
//                   expired: remove the still-visible ringing notification.
//   MISSED_CALL     visible notification { type, callerId, callerName,
//                   timestamp }. Tap opens Call History — never CallScreen.
//   CALL_DECLINED   visible notification to a caller who is not connected.
//
// FCM data values must be strings — see stringifyData.
// ============================================================================
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
// `visible: true` builds the FALLBACK variant: an Android-only system notification (shown by
// Google Play Services even when the app is fully closed). The default is the data-only message
// that wakes the app so it can draw the full ring (Accept / Decline, looping ringtone).
const buildIncomingCallMessage = ({
  token,
  call,
  callerName,
  now = new Date(),
  title,
  body,
  visible = false,
}) => {
  const ttlMs = callState.remainingMs(call, now);
  const data = stringifyData({
    ...buildIncomingCallData({ call, callerName, now }),
    ttlMs,
  });
  const expirySeconds = Math.floor((new Date(now).getTime() + ttlMs) / 1000);
  const alertTitle =
    title || (callerName ? `${callerName} is calling…` : "Incoming call");
  const alertBody = body || "Tap to answer";
  if (visible) {
    // Fallback: no top-level `notification` and no `apns` block, so iPhones (which already got
    // their alert from the primary message) are not notified twice. Tapping it opens the app,
    // which re-validates the call and shows the normal incoming-call screen.
    return {
      token,
      data,
      android: {
        priority: "high",
        ttl: ttlMs,
        collapseKey: `call_${call._id}`,
        notification: {
          title: alertTitle,
          body: alertBody,
          channelId: HIGH_IMPORTANCE_CHANNEL,
          sound: "default",
          priority: "max",
          visibility: "public",
          defaultVibrateTimings: true,
          // Same tag as the MISSED_CALL notification, so "Missed call" REPLACES "X is calling".
          tag: `call_${call._id}`,
        },
      },
    };
  }
  return {
    token,
    // Data-only + high priority: wakes the app so it can show the full ring.
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
          alert: { title: alertTitle, body: alertBody },
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
        tag: `call_${payload.callId}`,
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
  isCalleeOnline,
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
  if (res.sent) {
    // Safety net for phones that refuse to start a closed app for a data message (Oppo, Infinix,
    // Xiaomi, Vivo ...): if nothing confirms the ring shortly, send a visible notification.
    runRingFallback({
      callId,
      callee,
      callerName,
      isCalleeOnline,
      fetchCall,
      messaging,
    }).catch((e) => console.error("❌ ring fallback failed:", e?.message || e));
  }
  return { ...res, reason: res.sent ? "sent" : "send_failed" };
};

// ---- ring acknowledgement + fallback ----------------------------------------------
// The app confirms (POST /calls/:id/ring-ack) as soon as it has drawn the ring. Kept in memory:
// an entry only matters for the ~45 s ring window. (Multi-instance hosting: an ack that lands
// on another instance simply lets the fallback fire - the user may then see one extra
// notification, never a missed ring.)
const RING_FALLBACK_DELAY_MS = 3_000;
const ackedCalls = new Map(); // callId -> ackedAt
const markRingAcked = (callId) => {
  ackedCalls.set(String(callId), Date.now());
  for (const [id, at] of ackedCalls)
    if (Date.now() - at > 120_000) ackedCalls.delete(id);
};
const wasRingAcked = (callId) => ackedCalls.has(String(callId));

// `delayMs`, `isCalleeOnline`, `fetchCall`, `messaging` are injectable for tests.
const runRingFallback = async ({
  callId,
  callee,
  callerName,
  delayMs = RING_FALLBACK_DELAY_MS,
  isCalleeOnline,
  fetchCall,
  messaging,
}) => {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  if (wasRingAcked(callId)) return { sent: false, reason: "acked" };
  // The callee has a live socket: the in-app ring is already handling it.
  if (isCalleeOnline && (await isCalleeOnline()))
    return { sent: false, reason: "online" };
  const token = pickToken(callee);
  if (!token) return { sent: false, reason: "no_token" };
  const call = await (fetchCall
    ? fetchCall(callId)
    : require("../models/callModel").findById(callId));
  const now = new Date();
  if (!call || !callState.isRinging(call, now))
    return { sent: false, reason: "not_ringing" };
  if (callState.remainingMs(call, now) < MIN_RING_TTL_MS)
    return { sent: false, reason: "too_late" };
  const res = await safeSend(
    buildIncomingCallMessage({ token, call, callerName, now, visible: true }),
    "incoming-call-fallback",
    messaging,
  );
  console.log(
    "[call] ring fallback (no ack) for",
    String(callId),
    JSON.stringify(res),
  );
  return { ...res, reason: res.sent ? "fallback_sent" : "send_failed" };
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
  runRingFallback,
  markRingAcked,
  wasRingAcked,
  RING_FALLBACK_DELAY_MS,
  sendCallCancelledPush,
  sendMissedCallPush,
  sendCallDeclinedPush,
};

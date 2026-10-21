// ============================================================================
// Orchestrates call-state changes with their side effects: Socket.IO events to
// both users, call-history updates, and push notifications. State decisions
// live in callStateService (atomic, idempotent); this file only reacts to the
// result of a transition that actually CHANGED state, so duplicate triggers
// (sweeper + timer + caller cancel + restart) never fan out twice.
// ============================================================================
const callState = require("./callStateService");
const callPush = require("./callPushService");
const { callPushAllowed } = require("../utils/notificationPrefs");

const sockets = () => require("./socketService");
const Users = () => require("../models/userMode");

const PUSH_FIELDS = "name fcmToken pushToken voipPushToken notificationPrefs";

const loadUsers = async (ids) => {
  try {
    const docs = await Users().find({ _id: { $in: ids } }).select(PUSH_FIELDS);
    return new Map(docs.map((u) => [String(u._id), u]));
  } catch (err) {
    console.error("[call] could not load users:", err.message);
    return new Map();
  }
};

// Everything that must happen once a call has been turned into "missed"
// (expired, or the caller cancelled while it was still ringing).
const onCallMissed = async (call, { reason } = {}) => {
  try {
    const calleeId = String(call.calleeId);
    const callerId = String(call.callerId);
    const requestId = String(call.requestId);
    const s = sockets();

    s.publishCallUpdate(call);
    // Same events the old in-memory safety-net emitted, so both clients' call
    // screens/overlays behave exactly as before.
    s.emitToUser(calleeId, "call:missed", { requestId, fromUserId: callerId, callId: String(call._id) });
    s.emitToUser(callerId, "call:missed", { requestId, toUserId: calleeId, callId: String(call._id) });

    const users = await loadUsers([calleeId, callerId]);
    const callee = users.get(calleeId);
    const caller = users.get(callerId);
    if (!callee) return;

    // Remove a still-visible ringing notification on the callee's device.
    await callPush.sendCallCancelledPush({ call, callee, reason: reason || "missed" });

    // One MISSED_CALL notification per call, ever (atomic claim).
    if (callPushAllowed(callee) && (await callState.claimMissedNotification({ callId: call._id }))) {
      await callPush.sendMissedCallPush({ call, callee, callerName: caller?.name || "" });
    }
  } catch (err) {
    console.error("[call] onCallMissed failed:", err.message);
  }
};

// Callee declined (socket or REST). Caller hears it via Socket.IO (as the
// existing call:end) and via push when they have no live socket.
const onCallDeclined = async (call, { relay = true } = {}) => {
  try {
    const s = sockets();
    const callerId = String(call.callerId);
    const calleeId = String(call.calleeId);
    s.publishCallUpdate(call);
    // The socket path already relayed call:end before validating; REST relays here.
    if (relay) s.emitToUser(callerId, "call:end", { requestId: String(call.requestId), fromUserId: calleeId, callId: String(call._id) });
    if (!(await s.isUserConnectedAsync(callerId))) {
      const users = await loadUsers([callerId, calleeId]);
      await callPush.sendCallDeclinedPush({
        call,
        caller: users.get(callerId),
        calleeName: users.get(calleeId)?.name || "",
      });
    }
    // The decliner's other devices must stop ringing too.
    const users2 = await loadUsers([calleeId]);
    await callPush.sendCallCancelledPush({ call, callee: users2.get(calleeId), reason: "declined" });
  } catch (err) {
    console.error("[call] onCallDeclined failed:", err.message);
  }
};

// Callee accepted via REST (notification action). The socket path keeps its own
// relay; here the server does the relay the callee's socket would have done.
const onCallAcceptedViaRest = async (call) => {
  try {
    const s = sockets();
    s.publishCallUpdate(call);
    s.emitToUser(String(call.callerId), "call:accept", { requestId: String(call.requestId), fromUserId: String(call.calleeId), callId: String(call._id) });
    const users = await loadUsers([String(call.calleeId)]);
    // Dismiss the ringing notification on any other device of the callee.
    await callPush.sendCallCancelledPush({ call, callee: users.get(String(call.calleeId)), reason: "answered" });
  } catch (err) {
    console.error("[call] onCallAcceptedViaRest failed:", err.message);
  }
};

// ---- expiry: durable sweeper + exact-time accelerator -----------------------

const expireOne = async (callId) => {
  const call = await callState.claimExpired({ callId });
  if (call) await onCallMissed(call, { reason: "expired" });
  return !!call;
};

const sweepOnce = async () => {
  try {
    const expired = await callState.expireDueCalls();
    for (const call of expired) await onCallMissed(call, { reason: "expired" });
    return expired.length;
  } catch (err) {
    console.error("[call] expiry sweep failed:", err.message);
    return 0;
  }
};

// Best-effort timer at the exact expiry instant, for snappy "missed" delivery.
// It is NOT the source of truth (it dies with the process): the sweeper below
// is what guarantees a call is expired after a restart or on another instance.
const scheduleExpiry = (call) => {
  const delay = callState.remainingMs(call) + 250;
  const t = setTimeout(() => {
    expireOne(call._id).catch((err) => console.error("[call] timed expiry failed:", err.message));
  }, delay);
  if (typeof t.unref === "function") t.unref();
};

let sweeperTimer = null;
const SWEEP_INTERVAL_MS = Number(process.env.CALL_SWEEP_INTERVAL_MS) || 5_000;

// Called once at boot. Runs immediately (so a restart instantly resolves calls
// that expired while the server was down) and then on an interval. Safe with
// several instances: each expiry is claimed atomically.
const startCallExpirySweeper = () => {
  if (sweeperTimer) return sweeperTimer;
  sweepOnce();
  sweeperTimer = setInterval(sweepOnce, SWEEP_INTERVAL_MS);
  if (typeof sweeperTimer.unref === "function") sweeperTimer.unref();
  return sweeperTimer;
};

module.exports = {
  onCallMissed,
  onCallDeclined,
  onCallAcceptedViaRest,
  expireOne,
  sweepOnce,
  scheduleExpiry,
  startCallExpirySweeper,
};

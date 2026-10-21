// ============================================================================
// Backend-authoritative call state machine.
//
//   ringing ──accept──▶ accepted ──end──▶ completed
//      │──decline────▶ rejected
//      │──busy───────▶ busy
//      │──cancel─────▶ missed   (caller hung up before an answer)
//      └──expire─────▶ missed   (45 s ring window elapsed)
//
// Every transition out of "ringing" is ONE atomic findOneAndUpdate whose filter
// requires status === "ringing" (and, for callee actions, expiresAt > now), so:
//   * duplicate pushes / double taps / late taps / simultaneous accept+decline
//     resolve to exactly one winner — everybody else gets { changed: false };
//   * the sweeper, the per-call timer, several server instances and a restart
//     can all try to expire the same call; only the first claim succeeds.
// Push payloads and socket events are only SIGNALS — whoever receives one must
// still be told "yes, it is ringing" by this module before acting.
//
// `Call` is injectable so the logic is unit-testable without MongoDB.
// ============================================================================

const RING_WINDOW_MS = Number(process.env.CALL_RING_WINDOW_MS) || 45_000;
// Tolerance for the sweeper vs. the clients' own 45 s timers: the sweeper is a
// backstop, never racing a legitimate accept that landed a hair before expiry.
const SWEEP_BATCH = 50;

const toId = (v) => (v == null ? "" : String(v));

const getCallModel = () => require("../models/callModel");

const expiryFor = (startedAt = new Date()) => new Date(new Date(startedAt).getTime() + RING_WINDOW_MS);

// A legacy row (created before expiresAt existed) falls back to startedAt+window.
const effectiveExpiry = (call) =>
  call && (call.expiresAt || call.startedAt || call.createdAt)
    ? new Date(call.expiresAt || expiryFor(call.startedAt || call.createdAt))
    : null;

const isRinging = (call, now = new Date()) => {
  if (!call || call.status !== "ringing") return false;
  const exp = effectiveExpiry(call);
  return !!exp && exp.getTime() > new Date(now).getTime();
};

const remainingMs = (call, now = new Date()) => {
  const exp = effectiveExpiry(call);
  return exp ? Math.max(0, exp.getTime() - new Date(now).getTime()) : 0;
};

// A new attempt supersedes any earlier still-ringing attempt for the same pair
// (caller re-dialled / duplicate invite). The old one is closed as "missed" so
// there is never more than one ringing call between two users.
const createRingingCall = async ({ requestId, callerId, calleeId, now = new Date(), Call = getCallModel() }) => {
  const startedAt = new Date(now);
  return Call.create({
    requestId,
    callerId,
    calleeId,
    status: "ringing",
    startedAt,
    expiresAt: expiryFor(startedAt),
  });
};

// Closes earlier still-ringing attempts between the same two users (re-dial /
// duplicate invite) so there is never more than one ringing call per pair.
// Marked as already-notified: a superseded attempt must not raise a MISSED_CALL.
const supersedeRinging = async ({ callerId, calleeId, now = new Date(), Call = getCallModel() }) => {
  const when = new Date(now);
  const open = await Call.find({ callerId, calleeId, status: "ringing" });
  const closed = [];
  for (const old of open) {
    const c = await Call.findOneAndUpdate(
      { _id: old._id, status: "ringing" },
      { $set: { status: "missed", endedAt: when, endReason: "superseded", missedNotifiedAt: when } },
      { new: true },
    );
    if (c) closed.push(c);
  }
  return closed;
};

// Newest attempt between a caller/callee pair for a request, any status.
const findLatestForPair = async ({ requestId, callerId, calleeId, Call = getCallModel() }) =>
  Call.findOne({ requestId, callerId, calleeId }).sort({ createdAt: -1 });

// Newest still-open (ringing/accepted) call of a request that `userId` is in.
const findLatestOpenForUser = async ({ requestId, userId, Call = getCallModel() }) =>
  Call.findOne({
    requestId,
    status: { $in: ["ringing", "accepted"] },
    $or: [{ callerId: userId }, { calleeId: userId }],
  }).sort({ createdAt: -1 });

const findLatestRinging = async ({ requestId, callerId, calleeId, Call = getCallModel() }) =>
  Call.findOne({ requestId, callerId, calleeId, status: "ringing" }).sort({ createdAt: -1 });

// Callee-side transitions (accept / decline / busy). Require the call to be
// ringing AND unexpired. Returns { changed, call, reason }.
//   reason (when !changed): "not_found" | "not_participant" | "expired" |
//                           "not_ringing" (already accepted/declined/missed/...)
const calleeTransition = async ({ callId, calleeId, to, endReason, now = new Date(), Call = getCallModel() }) => {
  const when = new Date(now);
  const set = { status: to };
  if (to === "accepted") set.answeredAt = when;
  else {
    set.endedAt = when;
    if (endReason) set.endReason = endReason;
  }
  const claimed = await Call.findOneAndUpdate(
    { _id: callId, calleeId, status: "ringing", expiresAt: { $gt: when } },
    { $set: set },
    { new: true },
  );
  if (claimed) return { changed: true, call: claimed };

  // Lost the race (or invalid) — work out why, for the client's message.
  const existing = await Call.findById(callId);
  if (!existing) return { changed: false, call: null, reason: "not_found" };
  if (toId(existing.calleeId) !== toId(calleeId)) return { changed: false, call: existing, reason: "not_participant" };
  if (existing.status === "ringing") return { changed: false, call: existing, reason: "expired" };
  return { changed: false, call: existing, reason: "not_ringing" };
};

const acceptCall = (args) => calleeTransition({ ...args, to: "accepted" });
const declineCall = (args) => calleeTransition({ ...args, to: "rejected", endReason: "declined" });
const busyCall = (args) => calleeTransition({ ...args, to: "busy", endReason: "busy" });

// Either side ended the call.
//   ringing  + caller ends -> missed   (caller_cancelled)
//   ringing  + callee ends -> rejected (declined from the native call UI)
//   accepted               -> completed, with duration
// Anything already terminal is left alone (idempotent).
const endCall = async ({ callId, userId, now = new Date(), Call = getCallModel() }) => {
  const when = new Date(now);
  const participant = { $or: [{ callerId: userId }, { calleeId: userId }] };

  const ringing = await Call.findOne({ _id: callId, ...participant, status: "ringing" });
  if (ringing) {
    const byCallee = toId(ringing.calleeId) === toId(userId);
    const set = byCallee
      ? { status: "rejected", endedAt: when, endReason: "declined" }
      : { status: "missed", endedAt: when, endReason: "caller_cancelled" };
    const claimed = await Call.findOneAndUpdate({ _id: callId, status: "ringing" }, { $set: set }, { new: true });
    if (claimed) return { changed: true, call: claimed, outcome: byCallee ? "rejected" : "missed" };
  }

  const existing = await Call.findOne({ _id: callId, ...participant, status: "accepted" });
  if (!existing) return { changed: false, call: await Call.findById(callId), outcome: "noop" };
  const duration = existing.answeredAt
    ? Math.max(0, Math.round((when.getTime() - new Date(existing.answeredAt).getTime()) / 1000))
    : 0;
  const completed = await Call.findOneAndUpdate(
    { _id: callId, status: "accepted" },
    { $set: { status: "completed", endedAt: when, durationSeconds: duration, endReason: "ended" } },
    { new: true },
  );
  return completed
    ? { changed: true, call: completed, outcome: "completed" }
    : { changed: false, call: existing, outcome: "noop" };
};

// Claims ONE due ringing call and marks it missed. null when none are due.
const claimExpired = async ({ now = new Date(), callId, Call = getCallModel() }) => {
  const when = new Date(now);
  const filter = { status: "ringing", expiresAt: { $lte: when } };
  if (callId) filter._id = callId;
  return Call.findOneAndUpdate(
    filter,
    { $set: { status: "missed", endedAt: when, endReason: "expired" } },
    { new: true, sort: { expiresAt: 1 } },
  );
};

// Expires every call whose window elapsed (bounded per sweep). Also heals rows
// that predate expiresAt by giving them one, so a restart never leaves a
// legacy "ringing" row stuck forever.
const expireDueCalls = async ({ now = new Date(), limit = SWEEP_BATCH, Call = getCallModel() } = {}) => {
  const when = new Date(now);
  try {
    await Call.updateMany(
      { status: "ringing", expiresAt: { $exists: false }, startedAt: { $lte: new Date(when.getTime() - RING_WINDOW_MS) } },
      [{ $set: { expiresAt: { $add: ["$startedAt", RING_WINDOW_MS] } } }],
    );
  } catch {
    /* legacy-heal is best effort */
  }
  const expired = [];
  for (let i = 0; i < limit; i += 1) {
    const call = await claimExpired({ now: when, Call });
    if (!call) break;
    expired.push(call);
  }
  return expired;
};

// Atomically claims the right to send the MISSED_CALL notification for a call.
// Exactly one caller ever gets `true` per call, however many triggers fire.
const claimMissedNotification = async ({ callId, now = new Date(), Call = getCallModel() }) => {
  const claimed = await Call.findOneAndUpdate(
    { _id: callId, status: "missed", missedNotifiedAt: { $exists: false } },
    { $set: { missedNotifiedAt: new Date(now) } },
    { new: true },
  );
  return !!claimed;
};

// Ringing, unexpired incoming call for a callee (reconnect replay / reconcile).
const findRingingForCallee = async ({ calleeId, now = new Date(), Call = getCallModel() }) =>
  Call.findOne({ calleeId, status: "ringing", expiresAt: { $gt: new Date(now) } }).sort({ createdAt: -1 });

const getCallForParticipant = async ({ callId, userId, Call = getCallModel() }) => {
  const call = await Call.findById(callId);
  if (!call) return null;
  if (toId(call.callerId) !== toId(userId) && toId(call.calleeId) !== toId(userId)) return null;
  return call;
};

// Payload of the distinct missed-call notification.
const buildMissedCallPayload = ({ call, callerName, now = new Date() }) => ({
  type: "MISSED_CALL",
  callerId: toId(call.callerId),
  callerName: callerName || "",
  timestamp: new Date(call.endedAt || now).toISOString(),
  callId: toId(call._id),
  requestId: toId(call.requestId),
});

module.exports = {
  RING_WINDOW_MS,
  expiryFor,
  effectiveExpiry,
  isRinging,
  remainingMs,
  createRingingCall,
  findLatestRinging,
  supersedeRinging,
  findLatestForPair,
  findLatestOpenForUser,
  acceptCall,
  declineCall,
  busyCall,
  endCall,
  claimExpired,
  expireDueCalls,
  claimMissedNotification,
  findRingingForCallee,
  getCallForParticipant,
  buildMissedCallPayload,
};

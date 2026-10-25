const mongoose = require("mongoose");
const Call = require("../models/callModel");
const userModel = require("../models/userMode");
const callState = require("../services/callStateService");
const callLifecycle = require("../services/callLifecycleService");

// Shapes one Call document into the row the Calls tab renders, from the point
// of view of `userId` (a call the callee never answered shows as "Missed" for
// them and "outgoing" for the caller — same as any phone app).
//
// Shared by getCallHistory below AND by the live "call:history:update" socket
// push in services/socketService.js (publishCallUpdate), so a row that arrives
// over the socket is byte-for-byte the same shape as one that arrives from
// GET /calls/history. `usersById` is a Map of userId -> { name, profilePicture }.
const serializeCallForUser = (c, userId, usersById) => {
  const me = userId.toString();
  const isOutgoing = c.callerId.toString() === me;
  const otherUserId = (isOutgoing ? c.calleeId : c.callerId).toString();
  const other = usersById.get(otherUserId);
  // "Missed", from this user's point of view, only ever applies to the
  // callee side of a call that was never answered — an outgoing call
  // nobody picked up shows as "No answer" for the caller, not "Missed".
  const missed = !isOutgoing && (c.status === "missed" || c.status === "rejected");

  return {
    _id: c._id,
    requestId: c.requestId,
    otherUserId,
    otherName: other?.name || "Unknown",
    otherProfilePicture: other?.profilePicture || "",
    direction: isOutgoing ? "outgoing" : "incoming",
    status: c.status,
    missed,
    durationSeconds: c.durationSeconds || 0,
    createdAt: c.createdAt,
    // Lets the client keep whichever copy of a row is newest when a live
    // socket update and an HTTP fetch for the same call cross paths.
    updatedAt: c.updatedAt,
  };
};

// GET /calls/history — powers the "Calls" tab (WhatsApp-style call log).
// Every row is one call attempt this user was either the caller or callee
// on, newest first, with the direction and "missed" state computed relative
// to *this* user.
exports.getCallHistory = async (req, res) => {
  try {
    const userId = (req.user.id || req.user._id).toString();

    const calls = await Call.find({
      $or: [{ callerId: userId }, { calleeId: userId }],
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const otherIds = [
      ...new Set(
        calls.map((c) => (c.callerId.toString() === userId ? c.calleeId : c.callerId).toString()),
      ),
    ];
    const users = await userModel.find({ _id: { $in: otherIds } }).select("name profilePicture");
    const byId = new Map(users.map((u) => [u._id.toString(), u]));

    const history = calls.map((c) => serializeCallForUser(c, userId, byId));

    res.status(200).json({ success: true, calls: history });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /calls/:id — removes ONE call from the current user's own history.
// Soft, per-user hide (see deletedFor in models/callModel.js): the other
// participant still sees the call. Only a participant of the call can do it.
exports.deleteCall = async (req, res) => {
  try {
    const userId = (req.user.id || req.user._id).toString();
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid call id" });
    }
    const result = await Call.updateOne(
      { _id: id, $or: [{ callerId: userId }, { calleeId: userId }] },
      { $addToSet: { deletedFor: userId } },
    );
    if (!result.matchedCount) {
      return res.status(404).json({ success: false, message: "Call not found" });
    }
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /calls — "Clear all": hides every call in the current user's history
// (again per-user only). Calls genuinely ringing are kept so a live call never
// vanishes from under the person while it is happening.
exports.clearCallHistory = async (req, res) => {
  try {
    const userId = (req.user.id || req.user._id).toString();
    await Call.updateMany(
      {
        $and: [
          { $or: [{ callerId: userId }, { calleeId: userId }] },
          // Keep only calls that are genuinely ringing right now; a "ringing"
          // row older than 90s is stale (never resolved) and is cleared too.
          { $or: [{ status: { $ne: "ringing" } }, { createdAt: { $lt: new Date(Date.now() - 90_000) } }] },
        ],
        deletedFor: { $ne: userId },
      },
      { $addToSet: { deletedFor: userId } },
    );
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ---------------------------------------------------------------------------
// Backend-authoritative call state for notifications (push is only a signal).
// Used by the app when it is woken by an incoming_call push / notification
// action: it must ask here — "is this call still ringing?" — before showing,
// accepting or declining anything. All transitions are atomic + idempotent
// (services/callStateService.js).
// ---------------------------------------------------------------------------
const uid = (req) => (req.user.id || req.user._id).toString();

const describeCall = async (call, now = new Date()) => {
  const caller = await userModel.findById(call.callerId).select("name");
  return {
    callId: String(call._id),
    requestId: String(call.requestId),
    callerId: String(call.callerId),
    calleeId: String(call.calleeId),
    callerName: caller?.name || "",
    status: call.status,
    ringing: callState.isRinging(call, now),
    expiresAt: callState.effectiveExpiry(call),
    remainingMs: callState.isRinging(call, now) ? callState.remainingMs(call, now) : 0,
  };
};

const validCallId = (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ success: false, code: "INVALID_ID", message: "Invalid call id" });
    return false;
  }
  return true;
};

// GET /calls/ice-config - STUN/TURN servers for THIS user's call. TURN credentials are
// time-limited and per user (services/iceConfigService.js); never cached by clients/proxies.
exports.getIceConfig = async (req, res) => {
  try {
    const { buildIceConfig } = require("../services/iceConfigService");
    const cfg = buildIceConfig({ userId: uid(req) });
    res.set("Cache-Control", "no-store");
    res.status(200).json({ success: true, iceServers: cfg.iceServers, ttlSec: cfg.ttlSec });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load call configuration" });
  }
};

// GET /calls/:id/state
exports.getCallState = async (req, res) => {
  try {
    if (!validCallId(req, res)) return;
    const call = await callState.getCallForParticipant({ callId: req.params.id, userId: uid(req) });
    if (!call) return res.status(404).json({ success: false, code: "CALL_NOT_FOUND", message: "Call not found" });
    res.status(200).json({ success: true, call: await describeCall(call) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /calls/:id/accept — callee accepts (e.g. from a notification action).
// 200 when the call was ringing (or this user already accepted it); 409 when it
// can no longer be answered (expired / cancelled / declined / answered).
exports.acceptCallRest = async (req, res) => {
  try {
    if (!validCallId(req, res)) return;
    const userId = uid(req);
    const result = await callState.acceptCall({ callId: req.params.id, calleeId: userId });
    if (result.changed) {
      await callLifecycle.onCallAcceptedViaRest(result.call);
      return res.status(200).json({ success: true, changed: true, call: await describeCall(result.call) });
    }
    if (!result.call || result.reason === "not_found" || result.reason === "not_participant") {
      return res.status(404).json({ success: false, code: "CALL_NOT_FOUND", message: "Call not found" });
    }
    if (result.call.status === "accepted") {
      return res.status(200).json({ success: true, changed: false, call: await describeCall(result.call) });
    }
    const code = result.reason === "expired" || result.call.status === "missed" ? "CALL_EXPIRED" : "CALL_NOT_RINGING";
    return res.status(409).json({ success: false, code, status: result.call.status, message: "This call is no longer ringing" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /calls/:id/decline — callee declines. Idempotent: declining a call that
// already ended is a successful no-op (the notification just needs to go away).
exports.declineCallRest = async (req, res) => {
  try {
    if (!validCallId(req, res)) return;
    const userId = uid(req);
    const result = await callState.declineCall({ callId: req.params.id, calleeId: userId });
    if (result.changed) {
      await callLifecycle.onCallDeclined(result.call, { relay: true });
      return res.status(200).json({ success: true, changed: true, status: result.call.status });
    }
    if (!result.call || result.reason === "not_found" || result.reason === "not_participant") {
      return res.status(404).json({ success: false, code: "CALL_NOT_FOUND", message: "Call not found" });
    }
    return res.status(200).json({ success: true, changed: false, status: result.call.status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Cron entry point for hosts without a long-running process (Vercel Cron /
// Cloud Scheduler) — same contract as the other cron endpoints. Expires every
// overdue ringing call (idempotent). Protected by CRON_SECRET.
exports.tick = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.query.secret;
  if (!secret || given !== secret) return res.status(401).json({ success: false, message: "Unauthorized" });
  const expired = await callLifecycle.sweepOnce();
  res.json({ success: true, expired });
};

exports.serializeCallForUser = serializeCallForUser;

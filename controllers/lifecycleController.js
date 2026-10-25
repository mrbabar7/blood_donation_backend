// HTTP layer of the donation lifecycle. Thin: validates ids, calls the service (which
// owns every state transition), maps { ok, status, code } to a localized response.
const mongoose = require("mongoose");
const { localize } = require("../utils/localizedMessages");
const lifecycle = require("../services/donationLifecycle");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const respond = (req, res, result, successBody = {}) => {
  if (result.ok) {
    return res.status(200).json({ success: true, ...successBody(result) });
  }
  let message = localize(req, `lc_${result.code}`) || "Request failed.";
  if (result.minutes) message = message.replace("{minutes}", String(result.minutes));
  return res.status(result.status || 400).json({
    success: false,
    code: result.code,
    message,
    currentStatus: result.currentStatus || undefined,
    // nudge cooldown (HTTP 429): lets the app resync its countdown to the server's clock
    retryAfterSec: result.retryAfterSec || undefined,
    nextNudgeAt: result.nextNudgeAt || undefined,
  });
};

const guard = (handler) => async (req, res) => {
  try {
    if (req.params.requestId && !isId(req.params.requestId)) {
      return res.status(400).json({ success: false, code: "BAD_ID", message: "Invalid request id." });
    }
    return await handler(req, res);
  } catch (err) {
    console.error("[lifecycle] controller error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

const view = (r) => ({
  requestId: String(r.request._id),
  status: r.request.status,
  request: {
    _id: r.request._id,
    status: r.request.status,
    expiresAt: r.request.expiresAt || null,
    requestedAt: r.request.requestedAt || null,
    lockedAt: r.request.lockedAt || null,
    releasedAt: r.request.releasedAt || null,
    donationStartedAt: r.request.donationStartedAt || null,
    seekerAgreedAt: r.request.seekerAgreedAt || null,
    donorMarkedDonatedAt: r.request.donorMarkedDonatedAt || null,
    seekerNotYetAt: r.request.seekerNotYetAt || null,
    seekerNotYetCount: r.request.seekerNotYetCount || 0,
    lastNudgeAt: r.request.lastNudgeAt || null,
    donorDismissedAt: r.request.donorDismissedAt || null,
  },
});

// ---- seeker ----
exports.lockDonor = guard(async (req, res) =>
  respond(req, res, await lifecycle.lock({ seekerId: req.user._id, requestId: req.params.requestId }), view));

exports.releaseDonor = guard(async (req, res) =>
  respond(req, res, await lifecycle.release({ seekerId: req.user._id, requestId: req.params.requestId }), view));

exports.agreeToDonation = guard(async (req, res) =>
  respond(req, res, await lifecycle.agree({ seekerId: req.user._id, requestId: req.params.requestId }), view));

exports.disagreeToDonation = guard(async (req, res) =>
  respond(req, res, await lifecycle.disagree({ seekerId: req.user._id, requestId: req.params.requestId }), view));

exports.reportDonor = guard(async (req, res) =>
  respond(
    req,
    res,
    await lifecycle.reportDonor({
      seekerId: req.user._id,
      requestId: req.params.requestId,
      reason: req.body && req.body.reason,
    }),
    (r) => ({ ...view(r), restrictedUntil: r.restrictedUntil }),
  ));

exports.getRenotifyReleased = guard(async (req, res) => {
  const info = await lifecycle.renotifyInfo({ seekerId: req.user._id });
  return res.status(200).json({ success: true, count: info.count, visible: info.visible });
});

exports.renotifyReleased = guard(async (req, res) =>
  respond(req, res, await lifecycle.bulkRenotify({ seekerId: req.user._id }), (r) => ({
    renotified: r.renotified,
    skipped: r.skipped,
    alreadyProcessed: r.alreadyProcessed,
    requestIds: r.requestIds,
  })));

// ---- donor ----
exports.startDonation = guard(async (req, res) =>
  respond(req, res, await lifecycle.startDonation({ donorUserId: req.user._id, requestId: req.params.requestId }), view));

// POST /donors/requests/:requestId/nudge-seeker - "Send Reminder to Seeker" (10 min cooldown)
exports.nudgeSeeker = guard(async (req, res) =>
  respond(
    req,
    res,
    await lifecycle.nudgeSeeker({ donorUserId: req.user._id, requestId: req.params.requestId }),
    (r) => ({ ...view(r), nextNudgeAt: r.nextNudgeAt || null, retryAfterSec: r.retryAfterSec || 0 }),
  ));

// POST /donors/requests/:requestId/dismiss - hide an EXPIRED card from this donor's list only
exports.dismissExpired = guard(async (req, res) =>
  respond(req, res, await lifecycle.dismissExpired({ donorUserId: req.user._id, requestId: req.params.requestId }), view));

exports.cannotDonate = guard(async (req, res) =>
  respond(
    req,
    res,
    await lifecycle.donorUnable({
      donorUserId: req.user._id,
      requestId: req.params.requestId,
      message: req.body && req.body.message,
    }),
    view,
  ));

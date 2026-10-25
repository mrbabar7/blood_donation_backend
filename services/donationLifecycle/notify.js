// Sends lifecycle notifications + realtime events. Never throws: a failed notification
// must not fail (or roll back) the state transition that already committed.
const userModel = require("../../models/userMode");
const { render } = require("./messages");

// Required lazily: notificationController -> socketService -> ... must not be loaded at
// require time by pure unit tests of the state machine.
const lazy = () => ({
  createNotification: require("../../controllers/notificationController").createNotification,
  emitToUser: require("../socketService").emitToUser,
});

const languageOf = async (userId) => {
  try {
    const u = await userModel.findById(userId).select("language").lean();
    return u && u.language === "ur" ? "ur" : "en";
  } catch {
    return "en";
  }
};

/**
 * Notify one user about one request.
 *   key        a key of messages.js
 *   role       the mode the recipient needs to be in to act ("donor" | "seeker")
 *   critical   bypass quiet hours / preferences (high-priority push)
 * Returns the saved notification (or null).
 */
const notifyUser = async ({ userId, key, params = {}, role, requestId, critical = false }) => {
  if (!userId) return null;
  try {
    const lang = await languageOf(userId);
    const { type, title, body } = render(key, lang, params);
    const { createNotification } = lazy();
    return await createNotification({
      userId,
      title,
      message: body,
      category: "status",
      critical,
      link: "/(tabs)/requests",
      type,
      role,
      requestType: "direct",
      requestId,
    });
  } catch (err) {
    console.error(`[donationLifecycle] notify ${key} failed:`, err.message);
    return null;
  }
};

/**
 * Tell both parties' open screens a request changed (same event the Requests tab, Home and
 * donor dashboard already listen to). Targeted at the two users only.
 */
const emitStatus = ({ request, previousStatus, seekerUserId, donorUserId, extra = {} }) => {
  try {
    const { emitToUser } = lazy();
    const r = request && typeof request.toObject === "function" ? request.toObject() : request || {};
    const payload = {
      requestId: String(r._id),
      requestStatus: r.status,
      status: r.status,
      previousStatus: previousStatus || null,
      donorId: r.donorId ? String(r.donorId) : null,
      seekerId: r.seekerId ? String(r.seekerId) : null,
      requestedAt: r.requestedAt || null,
      expiresAt: r.expiresAt || null,
      lockedAt: r.lockedAt || null,
      releasedAt: r.releasedAt || null,
      donationStartedAt: r.donationStartedAt || null,
      seekerAgreedAt: r.seekerAgreedAt || null,
      donorMarkedDonatedAt: r.donorMarkedDonatedAt || null,
      onHoldAt: r.onHoldAt || null,
      donorUnableReason: r.donorUnableReason || "",
      seekerNotYetAt: r.seekerNotYetAt || null,
      seekerNotYetCount: r.seekerNotYetCount || 0,
      lastNudgeAt: r.lastNudgeAt || null,
      nudgeCount: r.nudgeCount || 0,
      ...extra,
    };
    if (seekerUserId) emitToUser(String(seekerUserId), "blood_request_status_updated", payload);
    if (donorUserId) emitToUser(String(donorUserId), "blood_request_status_updated", payload);
  } catch (err) {
    console.error("[donationLifecycle] emit failed:", err.message);
  }
};

module.exports = { notifyUser, emitStatus, languageOf };

const mongoose = require("mongoose");
const Notification = require("../models/notificationModel");
const userModel = require("../models/userMode"); // Ensure correct model path
const { Donor } = require("../models/formModel");
const { decide } = require("../utils/notificationPrefs");
const { emailActivity } = require("../email-sender/mailer");
const {
  emitToUser,
  sendPushNotification,
} = require("../services/socketService");

// ---------------------------------------------------------------------------
// Notification payload contract
// ---------------------------------------------------------------------------
// Request-related notifications carry a small, validated routing envelope in
// `data` (and in the push payload):
//   type        what happened            (NOTIFICATION_TYPES)
//   role        who it is intended for   ("donor" | "seeker"), i.e. the mode the
//               recipient needs to be in to act on it
//   requestId   the DonationRequest (or reservation) it is about
//   requestType "direct" | "reservation"
// Only identifiers go in the push, never names, phones or addresses. The client
// treats it purely as a routing hint: it re-fetches the request from the API,
// which enforces access.
const NOTIFICATION_TYPES = [
  "request_received", // donor: a seeker sent you a direct request
  "request_reminder", // donor: admin reminder on a pending request
  "request_cancelled", // donor: the seeker cancelled
  "request_accepted", // seeker: a donor accepted
  "request_rejected", // seeker: a donor declined
  "request_expired", // seeker: no response within 12 hours
  "donor_locked", // donor: the seeker locked you for donation
  "donor_released", // donor: the seeker released you
  "donation_started", // seeker: the donor started the donation, do you agree?
  "donation_agreed", // donor: the seeker agreed, you may mark the donation
  "donation_not_agreed", // donor: the seeker has not agreed yet
  "donation_on_hold", // seeker: the donor is busy with another seeker
  "donor_available_again", // seeker: the donor is free again (hold lifted)
  "donor_auto_released", // seeker: the donor donated elsewhere (permanent)
  "donor_unable", // seeker: the donor can't donate at this time
  "donor_reported", // donor: a seeker reported a delay (temporary restriction)
  "request_renotified", // donor: the seeker needs your help again
  "donation_marked", // seeker: donor says they donated, please confirm
  "donation_reminder", // seeker: confirm the donation soon
  "donation_completed", // donor: seeker confirmed + rated
  "chat_history_deleted", // either: chat purged
  "reservation_update", // seeker: blood-bank reservation answered
];
const NOTIFICATION_ROLES = ["donor", "seeker"];
const REQUEST_TYPES = ["direct", "reservation"];

const isObjectIdString = (v) =>
  typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);

const buildRoutingMeta = ({ type, role, requestId, requestType }) => {
  const meta = {};
  if (!type && !role && !requestId && !requestType) return meta;
  const reqId = requestId ? String(requestId) : "";
  if (
    !NOTIFICATION_TYPES.includes(type) ||
    !NOTIFICATION_ROLES.includes(role) ||
    !REQUEST_TYPES.includes(requestType) ||
    !isObjectIdString(reqId)
  ) {
    console.warn("[notification] Ignoring invalid routing metadata", { type, role, requestType });
    return meta;
  }
  meta.type = type;
  meta.role = role;
  meta.requestId = reqId;
  meta.requestType = requestType;
  return meta;
};

exports.createNotification = async ({
  userId,
  title = "Blood Donation",
  message,
  link = "",
  params = {},
  data = {},
  // Optional. One of: requests | status | nearby | chat | calls |
  // eligibility. Lets the recipient's Notification preferences + quiet hours
  // apply. Leave unset (or pass critical) for anything that must always arrive.
  category = null,
  critical = false,
  // Routing envelope, see "Notification payload contract" above.
  type = null,
  role = null,
  requestId = null,
  requestType = null,
  // Set false when a dedicated email for the same event is sent elsewhere,
  // so the user doesn't get two emails for one thing.
  emailCopy = true,
}) => {
  try {
    // 0. Honour the recipient's notification preferences.
    const prefUser = await userModel
      .findById(userId)
      .select("fcmToken pushToken notificationPrefs quietHours");
    const verdict = decide(prefUser, category, critical);
    if (!verdict.inApp) return null;

    // 1. Normalize link and params
    const targetLink = link || data.link || data.url || "";
    const targetParams =
      Object.keys(params).length > 0 ? params : data.params || {};

    // 2. Save Notification to Database (In-App Inbox)
    const routing = buildRoutingMeta({ type, role, requestId, requestType });
    const notification = new Notification({
      userId,
      message,
      link: targetLink,
      data: { ...data, ...routing, params: targetParams },
      isRead: false,
    });
    const savedNotif = await notification.save();

    // Mirror the activity to the user's inbox (fire-and-forget, never throws).
    if (emailCopy) emailActivity({ userId, title, message, type, category, requestId });

    // 3. Emit Real-time Socket Event to Active Users
    emitToUser(userId, "new_notification_received", savedNotif);

    // 4. The user's FCM token (already loaded above with their preferences)
    const targetUser = prefUser;

    // Prefer fcmToken, fallback to pushToken
    const tokenToSend = targetUser?.fcmToken || targetUser?.pushToken;

    // Admin's Donor Detail "push notifications" toggle (donorsController.js
    // updateDonorControls) was never actually checked before this — the flag
    // flipped in the DB but every push still went out regardless. Only the
    // push channel is suppressed; the in-app notification above still saves
    // and still emits over the socket either way.
    const donorProfile = await Donor.findOne({ userId }).select("pushNotificationsEnabled");
    const pushAllowed = donorProfile ? donorProfile.pushNotificationsEnabled !== false : true;

    if (tokenToSend && pushAllowed && verdict.push) {
      // Explicit allow-list (no spreading arbitrary data into the push): the
      // routing envelope + notificationId, plus the legacy link/params for
      // non-request notifications.
      const pushPayload = {
        ...routing,
        link: targetLink,
        url: targetLink,
        params: targetParams,
        notificationId: savedNotif._id.toString(),
      };

      await sendPushNotification(tokenToSend, title, message, pushPayload);
    }

    return savedNotif;
  } catch (err) {
    console.error("Error creating notification:", err);
  }
};

// API Endpoint: Get user notifications
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    res.json({ success: true, notifications });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch notifications" });
  }
};

// API Endpoint: Mark single notification as read
exports.markAsRead = async (req, res) => {
  try {
    // Scoped to req.user.id — previously this updated by _id alone, so any
    // authenticated user could mark (and thus probe the existence of) another
    // user's notification just by guessing/enumerating its id. deleteNotification
    // already scoped this way; this now matches it.
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: "Notification not found or unauthorized" });
    }
    // Idempotent: only the first read sets readAt; repeating the call (double
    // tap, push tap + inbox tap) is a harmless no-op that still returns it.
    let notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id, isRead: false },
      { isRead: true, readAt: new Date() },
      { new: true },
    );
    if (!notif) {
      notif = await Notification.findOne({ _id: req.params.id, userId: req.user.id });
    }
    if (!notif) {
      return res.status(404).json({ success: false, message: "Notification not found or unauthorized" });
    }
    res.json({ success: true, notification: notif });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to mark as read" });
  }
};

// Marks every UNREAD notification this user has about `requestId` (matching
// the request id) as read. Scoped to `userId`, so it
// can never touch anyone else's notifications, and idempotent: calling it again
// once everything is read changes nothing. Tells the user's connected devices
// which ids were read so badges / unread dots update immediately.
// Returns the ids that were newly marked read.
exports.markRequestNotificationsRead = async (userId, requestId) => {
  try {
    const rid = String(requestId || "");
    if (!userId || !isObjectIdString(rid)) return [];
    const unread = await Notification.find({
      userId,
      isRead: false,
      "data.requestId": rid,
    })
      .select("_id")
      .lean();
    if (unread.length === 0) return [];
    const ids = unread.map((n) => n._id);
    await Notification.updateMany(
      { _id: { $in: ids }, userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
    );
    const idStrings = ids.map(String);
    emitToUser(userId, "notifications_read", { ids: idStrings, requestId: rid });
    return idStrings;
  } catch (err) {
    console.error("Error marking request notifications read:", err);
    return [];
  }
};

// API Endpoint: the user opened / acted on a request -> clear its notifications.
exports.markReadByRequest = async (req, res) => {
  try {
    if (!isObjectIdString(req.params.requestId)) {
      return res.status(400).json({ success: false, message: "Invalid request id" });
    }
    const ids = await exports.markRequestNotificationsRead(req.user.id, req.params.requestId);
    res.json({ success: true, updated: ids.length, ids });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to mark notifications as read" });
  }
};

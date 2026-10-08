const Notification = require("../models/notificationModel");
const userModel = require("../models/userMode"); // Ensure correct model path
const { Donor } = require("../models/formModel");
const { decide } = require("../utils/notificationPrefs");
const {
  emitToUser,
  sendPushNotification,
} = require("../services/socketService");

exports.createNotification = async ({
  userId,
  title = "Blood Donation",
  message,
  link = "",
  params = {},
  data = {},
  // Optional. One of: requests | status | nearby | chat | calls | leaderboard |
  // eligibility. Lets the recipient's Notification preferences + quiet hours
  // apply. Leave unset (or pass critical) for anything that must always arrive.
  category = null,
  critical = false,
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
    const notification = new Notification({
      userId,
      message,
      link: targetLink,
      data: { ...data, params: targetParams },
      isRead: false,
    });
    const savedNotif = await notification.save();

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
      // Build clean payload for Expo Router dynamic deep linking
      const pushPayload = {
        ...data,
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
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { isRead: true },
      { new: true },
    );
    if (!notif) {
      return res.status(404).json({ success: false, message: "Notification not found or unauthorized" });
    }
    res.json({ success: true, notification: notif });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to mark as read" });
  }
};

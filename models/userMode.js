// models/userModel.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, unique: true, sparse: true, lowercase: true },
    phone: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, required: false },
    googleId: { type: String, unique: true, sparse: true },
    profilePicture: { type: String, default: "" },
    otp: { type: String },
    otpExpires: { type: Date },
    isVerified: { type: Boolean, default: false },
    token: { type: String, default: null },
    pushToken: { type: String, default: null },
    fcmToken: { type: String, default: null },
    // Expo push token (ExponentPushToken[...]) — used for chat pushes via
    // expo-server-sdk when present; chat falls back to fcmToken otherwise.
    expoPushToken: { type: String, default: null },
    // Apple PushKit VoIP token — distinct from fcmToken/pushToken above.
    // Regular push can't reliably wake a killed iOS app for an incoming call;
    // PushKit is the mechanism Apple provides specifically for that. See
    // services/socketService.js's sendVoipPushNotification.
    voipPushToken: { type: String, default: null },
    isOnline: { type: Boolean, default: false }, // Syncs with Socket.io connections
    lastSeen: { type: Date, default: Date.now },
    pendingEmail: { type: String, default: null },
    emailChangeOtp: { type: String, default: null },
    emailChangeOtpExpires: { type: Date, default: null },
    // Notification preferences screen (Profile > Notification preferences).
    // Every category defaults to the design's initial state; a missing field on
    // an older document falls back to these same defaults when read, so no
    // existing user needs migrating. Emergency alerts for an active donor are
    // deliberately NOT here — they can't be switched off (see
    // utils/notificationPrefs.js).
    notificationPrefs: {
      newRequests: { type: Boolean, default: true },
      statusChanges: { type: Boolean, default: true },
      nearbyBroadcasts: { type: Boolean, default: true },
      chatMessages: { type: Boolean, default: true },
      incomingCalls: { type: Boolean, default: true },
      leaderboard: { type: Boolean, default: false },
      eligibilityReminders: { type: Boolean, default: true },
    },
    // Quiet hours: non-critical PUSHES are held back between startHour and
    // endHour. Hours are 0-23, read in Pakistan time (see notificationPrefs.js).
    quietHours: {
      enabled: { type: Boolean, default: true },
      startHour: { type: Number, default: 23, min: 0, max: 23 },
      endHour: { type: Number, default: 6, min: 0, max: 23 },
    },
  },
  { timestamps: true },
);

const userModel = mongoose.model("User", userSchema);
module.exports = userModel;

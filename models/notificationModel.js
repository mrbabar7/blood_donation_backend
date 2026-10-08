const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  message: { type: String, required: true },
  link: { type: String, default: "" }, // Web fallback link
  data: { type: Object, default: {} }, // Mobile navigation payload { screen: 'RequestDetails', params: { requestId: '123' } }
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Matches notificationController.js's Notification.find({ userId })
// .sort({ createdAt: -1 }).limit(30) exactly — every app open/poll hits
// this, so it's one of the highest-frequency queries in the whole app.
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);

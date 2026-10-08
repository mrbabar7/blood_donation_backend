const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DonationRequest",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, default: "" },

    location: {
      type: new mongoose.Schema(
        {
          label: { type: String },
          latitude: Number,
          longitude: Number,

          isLive: { type: Boolean, default: false },
          expiresAt: { type: Date },
        },
        { _id: false },
      ),
      default: undefined,
    },
    isRead: { type: Boolean, default: false },

    deliveredAt: { type: Date },
    readAt: { type: Date },

    replyToMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },

    // ---- Reactions: one emoji per user per message ----
    reactions: {
      type: [
        new mongoose.Schema(
          {
            userId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
              required: true,
            },
            emoji: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    image: {
      type: new mongoose.Schema(
        {
          url: { type: String, required: true },
          width: Number,
          height: Number,
        },
        { _id: false },
      ),
      default: undefined,
    },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    deletedForEveryone: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

// --- Speed/scale indexes (additive only — no query behavior changes) ---
// Thread history: find({ requestId }).sort({ createdAt }) — without the
// compound index MongoDB sorts every thread's messages in memory.
messageSchema.index({ requestId: 1, createdAt: 1 });
// Unread badges / mark-as-read: { receiverId, isRead } (+ optional requestId).
messageSchema.index({ receiverId: 1, isRead: 1, requestId: 1 });
// "Delivered" backfill when a user's app reconnects: { receiverId, deliveredAt:null, createdAt >= }.
messageSchema.index({ receiverId: 1, deliveredAt: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);

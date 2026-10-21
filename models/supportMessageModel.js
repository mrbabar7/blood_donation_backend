const mongoose = require("mongoose");

// User <-> Admin support chat (PDF screen 08) — distinct from the donor<->seeker
// Message model, which is scoped to an accepted DonationRequest instead.
const supportMessageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderType: { type: String, enum: ["user", "admin"], required: true },
    senderName: { type: String, required: true },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

const supportConversationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    subject: { type: String, default: "" },
    status: { type: String, enum: ["open", "resolved"], default: "open" },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = {
  SupportMessage: mongoose.model("SupportMessage", supportMessageSchema),
  SupportConversation: mongoose.model("SupportConversation", supportConversationSchema),
};

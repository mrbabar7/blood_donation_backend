const mongoose = require("mongoose");

// Chat has no standalone "conversation" document (see messageModel.js's
// comment — it's derived from accepted DonationRequests), so "delete chat
// for myself" can't just flip a flag on one document. Instead this records
// *when* a user deleted their view of a conversation with someone else;
// chatController.js then hides everything up to that timestamp for that
// user only, while the other participant's copy is untouched. A later
// message from either side naturally makes the conversation reappear in
// the deleter's list, same as WhatsApp's "delete chat" (as opposed to
// "clear chat" / block).
//
// "Delete for everyone" doesn't use this model at all — it hard-deletes the
// underlying Message documents directly (see deleteConversation below).
const chatDeletionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    otherUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    deletedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

chatDeletionSchema.index({ userId: 1, otherUserId: 1 }, { unique: true });

module.exports = mongoose.model("ChatDeletion", chatDeletionSchema);

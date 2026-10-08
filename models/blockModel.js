const mongoose = require("mongoose");

// "Blocked users" (Privacy & data). One document per (blocker, blocked) pair.
// A block is symmetric in effect: neither side can find, request or message the
// other while it exists (see utils/blocks.js for the helpers that enforce it).
const blockSchema = new mongoose.Schema(
  {
    blockerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    blockedId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
blockSchema.index({ blockedId: 1 });

module.exports = mongoose.model("Block", blockSchema);

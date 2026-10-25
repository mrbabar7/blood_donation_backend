const mongoose = require("mongoose");

// Real data subject request tracking (PDF: GDPR-style export/deletion requests).
// "Fulfilling" a deletion request actually deletes the real User+Donor records —
// this is a genuine, consequential action, not a status label with no effect.
const dataRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    requesterName: { type: String, required: true },
    type: { type: String, enum: ["export", "deletion"], required: true },
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
    fulfilledAt: { type: Date, default: null },
    fulfilledBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DataRequest", dataRequestSchema);

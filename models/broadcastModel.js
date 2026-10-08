const mongoose = require("mongoose");

// One "Post a Request" / Emergency Broadcast fans out into many DonationRequest
// documents (one per nearby matching donor). This model tracks the broadcast
// itself so the seeker can watch live progress (PDF screen 17).
const broadcastSchema = new mongoose.Schema(
  {
    seekerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    requestedBloodType: { type: String, required: true },
    units: { type: Number, default: 1 },
    urgency: { type: String, enum: ["critical", "within_24h"], default: "within_24h" },
    // "Needed by" and optional hospital contact from the emergency form.
    neededBy: { type: Date, default: null },
    hospitalContact: { type: String, default: "" },
    seekerName: { type: String, required: true },
    seekerPhone: { type: String, required: true },
    seekerLocation: {
      province: { type: String, required: true },
      city: { type: String, required: true },
      addressLine: { type: String, required: true },
      // Optional — set only when the seeker drops a pin on the map picker
      // instead of (or in addition to) typing province/city/address.
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    donorsNotified: { type: Number, default: 0 },
    // "cancelled_by_seeker" is written by the current cancel flow; legacy
    // "cancelled" is kept in the enum so older documents stay valid.
    status: { type: String, enum: ["active", "fulfilled", "cancelled", "cancelled_by_seeker"], default: "active" },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

broadcastSchema.index({ seekerId: 1, createdAt: -1 });
broadcastSchema.index({ status: 1 });

module.exports = mongoose.model("Broadcast", broadcastSchema);

const mongoose = require("mongoose");

// Blood-bank reservation: a seeker asks a listed blood bank to hold units of a
// blood group. The bank's owner (BloodBank.user) confirms or declines it. Shown
// in the seeker's Requests tab as "<Bank> · B+ reservation · Pending".
const reservationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    bankId: { type: mongoose.Schema.Types.ObjectId, ref: "BloodBank", required: true },
    bankName: { type: String, required: true },
    bloodGroup: { type: String, required: true },
    units: { type: Number, default: 1, min: 1, max: 20 },
    requesterName: { type: String, default: "" },
    requesterPhone: { type: String, default: "" },
    status: { type: String, enum: ["pending", "confirmed", "declined", "cancelled"], default: "pending" },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

reservationSchema.index({ userId: 1, createdAt: -1 });
reservationSchema.index({ bankId: 1, status: 1 });

module.exports = mongoose.model("BankReservation", reservationSchema);

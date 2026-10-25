const mongoose = require("mongoose");

// One row per completed donation, so stats can group by real calendar month
// instead of relying on the Donor's cumulative all-time livesSaved total.
const donationLogSchema = new mongoose.Schema(
  {
    donorId: { type: mongoose.Schema.Types.ObjectId, ref: "Donor", required: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "DonationRequest", required: true },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Matches the `date` range (+ donorId) lookups in controllers/statsController.js.
donationLogSchema.index({ date: -1 });
donationLogSchema.index({ donorId: 1, date: -1 });

module.exports = mongoose.model("DonationLog", donationLogSchema);

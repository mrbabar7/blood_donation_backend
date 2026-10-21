const mongoose = require("mongoose");

// "Notify me when available": a seeker asks to be told once when a resting
// donor's recovery window ends.
//
//  - One row per (seeker, donor) - the unique index below makes duplicates
//    impossible even when two requests race each other.
//  - `notifiedAt` is the dedup guard. It is claimed with an atomic
//    update-where-null, so a subscriber is notified at most once per rest
//    cycle. Re-subscribing during a later rest cycle re-arms the same row
//    (notifiedAt back to null) instead of creating a second one.
const availabilitySubscriptionSchema = new mongoose.Schema(
  {
    seekerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    donorId: { type: mongoose.Schema.Types.ObjectId, ref: "Donor", required: true },
    subscribedAt: { type: Date, default: Date.now },
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

availabilitySubscriptionSchema.index({ seekerId: 1, donorId: 1 }, { unique: true });
// Used when a donor becomes available: "who is still waiting on this donor?"
availabilitySubscriptionSchema.index({ donorId: 1, notifiedAt: 1 });
// Used for the per-seeker active-subscription cap.
availabilitySubscriptionSchema.index({ seekerId: 1, notifiedAt: 1 });

module.exports = mongoose.model("AvailabilitySubscription", availabilitySubscriptionSchema);

const mongoose = require("mongoose");
const { Donor } = require("../../models/formModel");
const AvailabilitySubscription = require("../../models/availabilitySubscriptionModel");
const { isBlockedBetween } = require("../../utils/blocks");
const { isResting } = require("../../utils/donorAvailability");
const { reconcileDonorAvailability } = require("../../services/donorAvailabilityService");

const MAX_ACTIVE_SUBSCRIPTIONS = 50;

// POST /seeker/donors/:donorId/notify-available   (auth required via protect)
exports.subscribeToAvailability = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const { donorId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(donorId)) {
      return res.status(404).json({ success: false, message: "Donor not found" });
    }

    const donor = await Donor.findById(donorId);
    if (!donor || donor.isSuspended) {
      return res.status(404).json({ success: false, message: "Donor not found" });
    }
    if (String(donor.userId) === String(seekerId)) {
      return res.status(400).json({ success: false, code: "OWN_PROFILE", message: "You can't subscribe to your own profile." });
    }
    if (await isBlockedBetween(seekerId, donor.userId)) {
      return res.status(403).json({ success: false, message: "This donor isn't available." });
    }

    // If the rest window already ended, make the state truthful first.
    await reconcileDonorAvailability(donor);
    if (!isResting(donor)) {
      return res.status(409).json({
        success: false,
        code: donor.isAvailable ? "ALREADY_AVAILABLE" : "NOT_RESTING",
        message: donor.isAvailable ? "This donor is already available - you can send a request now." : "This donor isn't in a recovery period.",
      });
    }

    // Re-arm a row left over from an earlier rest cycle (already notified).
    const rearmed = await AvailabilitySubscription.updateOne(
      { seekerId, donorId, notifiedAt: { $ne: null } },
      { $set: { notifiedAt: null, subscribedAt: new Date() } },
    );
    if (rearmed.modifiedCount === 1) {
      return res.status(200).json({ success: true, subscribed: true, alreadySubscribed: false });
    }

    const active = await AvailabilitySubscription.countDocuments({ seekerId, notifiedAt: null });
    if (active >= MAX_ACTIVE_SUBSCRIPTIONS) {
      // Only reached when this would be a NEW row; an existing one is handled below.
      const existing = await AvailabilitySubscription.exists({ seekerId, donorId });
      if (!existing) {
        return res.status(429).json({ success: false, code: "LIMIT_REACHED", message: "You're already waiting on the maximum number of donors." });
      }
    }

    try {
      await AvailabilitySubscription.create({ seekerId, donorId });
    } catch (err) {
      if (err && err.code === 11000) {
        // Unique index hit: already subscribed (double tap / race). Idempotent success.
        return res.status(200).json({ success: true, subscribed: true, alreadySubscribed: true });
      }
      throw err;
    }
    return res.status(201).json({ success: true, subscribed: true, alreadySubscribed: false });
  } catch (error) {
    console.error("Subscribe Availability Error:", error);
    res.status(500).json({ success: false, message: "Could not save your subscription." });
  }
};

// DELETE /seeker/donors/:donorId/notify-available
exports.unsubscribeFromAvailability = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const { donorId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(donorId)) {
      return res.status(404).json({ success: false, message: "Donor not found" });
    }
    await AvailabilitySubscription.deleteOne({ seekerId, donorId });
    res.status(200).json({ success: true, subscribed: false });
  } catch (error) {
    console.error("Unsubscribe Availability Error:", error);
    res.status(500).json({ success: false, message: "Could not update your subscription." });
  }
};

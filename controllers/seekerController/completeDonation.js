const { DonationRequest, Donor } = require("../../models/formModel");
const DonationLog = require("../../models/donationLogModel");
const { createNotification, markRequestNotificationsRead } = require("../notificationController");
const { deleteChatForRequest } = require("../../services/chatCleanupService");
const { getRecoveryDays } = require("../../config/recoveryPolicy");
const { computeNextAvailableDate } = require("../../utils/donorAvailability");
const lifecycle = require("../../services/donationLifecycle");
const { localize } = require("../../utils/localizedMessages");

exports.completeDonation = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const { requestId, rating = 5 } = req.body;

    if (!require("mongoose").Types.ObjectId.isValid(String(requestId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid request id." });
    }
    const existing = await DonationRequest.findById(requestId);
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Request not found." });
    }

    if (existing.seekerId.toString() !== seekerId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized action." });
    }

    if (existing.status === "cancelled_by_seeker") {
      return res.status(409).json({
        success: false,
        code: "REQUEST_CANCELLED",
        message: "This request was cancelled, so it can't be completed.",
      });
    }

    const donor = await Donor.findById(existing.donorId).populate("userId");
    if (!donor) {
      return res
        .status(404)
        .json({ success: false, message: "Donor not found." });
    }

    // 0. Atomic claim: donation_agreed -> completed. Completion is only possible after the
    // seeker agreed (persisted), and only ONE caller can win, so a double tap or two
    // devices can never double-count livesSaved / the recovery window.
    const numericRating = Math.min(5, Math.max(1, Number(rating) || 5));
    const claimed = await lifecycle.claimCompletion({ seekerId, requestId, rating: numericRating });
    if (!claimed.ok) {
      return res.status(claimed.status).json({
        success: false,
        code: claimed.code,
        message: localize(req, `lc_${claimed.code}`),
      });
    }
    const request = claimed.request;

    // 1. Calculate recovery dates. The interval is product-configurable
    // (config/recoveryPolicy.js) and added in exact 24h steps so the result
    // doesn't depend on the server's timezone.
    const today = new Date();
    const recoveryDays = getRecoveryDays();
    const nextDate = computeNextAvailableDate(today, recoveryDays);

    donor.isAvailable = false;
    donor.lastDonationDate = today;
    donor.nextAvailableDate = nextDate;
    donor.availabilityReconciled = false;

    // 2. Recalculate average rating
    const oldTotal = donor.totalRatings || 0;
    const oldRating = donor.rating || 0;
    const newTotalRatings = oldTotal + 1;
    const newAverageRating =
      (oldRating * oldTotal + numericRating) / newTotalRatings;

    donor.livesSaved = (donor.livesSaved || 0) + 1;
    donor.rating = parseFloat(newAverageRating.toFixed(2));
    donor.totalRatings = newTotalRatings;
    await donor.save();

    // 3. The request itself was marked completed & rated by the atomic claim above.
    // Free the donor's active-donation lock and PERMANENTLY auto-release every other
    // Locked / On Hold request of this donor (their seekers are notified). Unlocked
    // Accepted requests are intentionally untouched.
    try {
      await lifecycle.afterCompletion({
        request,
        donorUserId: String(donor.userId?._id || donor.userId || ""),
      });
    } catch (err) {
      console.error("Error auto-releasing the donor's other requests:", err.message);
    }

    // Dated log entry — one row per completed donation (feeds the public monthly stats).
    await DonationLog.create({ donorId: donor._id, requestId: request._id, date: today });

    // Donation is confirmed done — its chat has served its purpose (arranging
    // the handoff) and there's no ongoing reason to keep it, so it's deleted
    // now rather than sitting in the DB indefinitely. Both sides are told
    // explicitly why, so this never reads as data loss/a bug to either of
    // them. See services/chatCleanupService.js.
    try {
      await deleteChatForRequest(request, "completed", {
        seekerId: request.seekerId,
        donorUserId: donor.userId?._id || donor.userId,
      });
    } catch (err) {
      // Best-effort: a storage-cleanup failure must never block the donation
      // itself from being recorded as completed — the request above has
      // already saved successfully by this point.
      console.error("Error purging chat after donation completion:", err.message);
    }

    // 4. Notify Donor (In-App Database Notification)
    if (donor.userId) {
      const recipientId = donor.userId._id || donor.userId;
      await createNotification({
        userId: recipientId,
        title: "Donation Completed",
      category: "status",
        message: `Donation Complete! You were rated ${numericRating} ⭐. Thank you for saving a life!`,
        link: "/(tabs)/profile",
        type: "donation_completed",
        role: "donor",
        requestType: "direct",
        requestId: request._id,
      });
    }
    // The seeker confirmed: their "please confirm" notifications are done.
    await markRequestNotificationsRead(seekerId, request._id);

    // =========================================================================
    // 5. REAL-TIME EMIT WITH FALLBACKS & DIAGNOSTICS
    // =========================================================================
    const io = req.app.get("io") || global.io;

    console.log("[completeDonation] Checking Socket Instance -> Found:", !!io);
    console.log(
      "[completeDonation] Checking Donor userId -> Found:",
      !!donor.userId,
    );

    if (donor.userId) {
      const targetUserId = String(donor.userId._id || donor.userId);

      const payload = {
        userId: targetUserId,
        donor: donor.toObject(),
        requestId: request._id,
      };

      if (io) {
        console.log(
          `[completeDonation] Emitting 'donation_completed' to user: ${targetUserId}`,
        );
        // Broadcast globally AND emit to targeted user room
        io.emit("donation_completed", payload);
        io.to(targetUserId).emit("donation_completed", payload);
      } else {
        console.error(
          "[completeDonation] Socket.io instance NOT accessible. Ensure app.set('io', io) is in server.js!",
        );
      }
    }

    res.status(200).json({
      success: true,
      message:
        `Donation completed! Donor rated and put on ${recoveryDays}-day recovery status.`,
      request,
    });
  } catch (error) {
    console.error("Complete Donation Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

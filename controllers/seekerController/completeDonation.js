const { DonationRequest, Donor } = require("../../models/formModel");
const DonationLog = require("../../models/donationLogModel");
const { createNotification } = require("../notificationController");
const { deleteChatForRequest } = require("../../services/chatCleanupService");

exports.completeDonation = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const { requestId, rating = 5 } = req.body;

    const request = await DonationRequest.findById(requestId);
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: "Request not found." });
    }

    if (request.seekerId.toString() !== seekerId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized action." });
    }

    if (request.status === "cancelled_by_seeker") {
      return res.status(409).json({
        success: false,
        code: "REQUEST_CANCELLED",
        message: "This request was cancelled, so it can't be completed.",
      });
    }

    const donor = await Donor.findById(request.donorId).populate("userId");
    if (!donor) {
      return res
        .status(404)
        .json({ success: false, message: "Donor not found." });
    }

    // 1. Calculate recovery dates (90-day break)
    const today = new Date();
    const nextDate = new Date();
    nextDate.setDate(today.getDate() + 90);

    donor.isAvailable = false;
    donor.lastDonationDate = today;
    donor.nextAvailableDate = nextDate;

    // 2. Recalculate average rating
    const numericRating = Math.min(5, Math.max(1, Number(rating)));
    const oldTotal = donor.totalRatings || 0;
    const oldRating = donor.rating || 0;
    const newTotalRatings = oldTotal + 1;
    const newAverageRating =
      (oldRating * oldTotal + numericRating) / newTotalRatings;

    donor.livesSaved = (donor.livesSaved || 0) + 1;
    donor.rating = parseFloat(newAverageRating.toFixed(2));
    donor.totalRatings = newTotalRatings;
    await donor.save();

    // 3. Mark request as completed & rated
    request.status = "completed";
    request.isRated = true;
    request.rating = numericRating;
    request.completedAt = today;
    await request.save();

    // Dated log entry — powers a real monthly leaderboard (not just all-time).
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
      });
    }

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
        "Donation completed! Donor rated and put on 90-day recovery status.",
      request,
    });
  } catch (error) {
    console.error("Complete Donation Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

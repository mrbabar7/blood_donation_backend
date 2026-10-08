const { DonationRequest, Donor } = require("../../models/formModel");
const { createNotification } = require("../notificationController");
const { emitToUser } = require("../../services/socketService");

// PUT /donors/mark-donated/:requestId
//
// The donor's half of a two-step handoff: this says "I gave the blood",
// completeDonation.js (seeker-side) says "I received it, we're done".
// Doesn't touch `status` — see formModel.js's comment on
// donorMarkedDonatedAt for why — so every existing accepted/completed check
// elsewhere in the app is unaffected by this feature existing at all.
//
// Starts the clock services/chatCleanupCron.js watches: if the seeker
// doesn't confirm via completeDonation.js within 3 days of this call, that
// cron auto-deletes the chat and notifies both sides.
exports.markDonated = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { requestId } = req.params;

    const donor = await Donor.findOne({ userId });
    if (!donor) {
      return res.status(404).json({ success: false, message: "Donor profile not found." });
    }

    const request = await DonationRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found." });
    }
    // Ownership check — donorId on the request must be *this* donor's own
    // Donor document, not merely any authenticated user (acceptRequest.js
    // predates this check; new code doesn't get to skip it).
    if (request.donorId.toString() !== donor._id.toString()) {
      return res.status(403).json({ success: false, message: "You are not the donor for this request." });
    }
    if (request.status !== "accepted") {
      return res.status(400).json({
        success: false,
        message:
          request.status === "completed"
            ? "This request has already been completed."
            : "This request must be accepted before it can be marked as donated.",
      });
    }
    if (request.donorMarkedDonatedAt) {
      // Idempotent — a double-tap (slow network, accidental resubmit)
      // shouldn't reset the 3-day clock or re-send the notification.
      return res.status(200).json({ success: true, request, alreadyMarked: true });
    }

    request.donorMarkedDonatedAt = new Date();
    await request.save();

    await createNotification({
      userId: request.seekerId,
      title: "Please confirm your donation",
      category: "status",
      message: `${donor.fullName} has marked this donation as given. Please confirm you received it — if it isn't confirmed within 3 days, this chat's history will be automatically deleted.`,
      link: "/(tabs)/requests",
    });

    emitToUser(request.seekerId.toString(), "donor_marked_donated", {
      requestId: request._id.toString(),
      donorMarkedDonatedAt: request.donorMarkedDonatedAt,
    });

    res.status(200).json({ success: true, request });
  } catch (error) {
    console.error("Mark Donated Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

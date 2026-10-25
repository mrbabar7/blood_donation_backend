const { createNotification, markRequestNotificationsRead } = require("../notificationController");
const { emitToUser } = require("../../services/socketService");
const lifecycle = require("../../services/donationLifecycle");
const { emitStatus } = require("../../services/donationLifecycle/notify");
const { localize } = require("../../utils/localizedMessages");

// PUT /donors/mark-donated/:requestId
//
// The donor's half of a two-step handoff: this says "I gave the blood",
// completeDonation.js (seeker-side) says "I received it, we're done".
// Only available once the seeker AGREED to the donation (status donation_agreed,
// persisted on the backend); it does not change `status`.
//
// Starts the clocks services/donationLifecycle/jobs.js (6-hourly "Mark Complete"
// reminders) and services/chatCleanupCron.js (3-day chat cleanup) watch.
exports.markDonated = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { requestId } = req.params;
    if (!require("mongoose").Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, message: "Invalid request id." });
    }

    const result = await lifecycle.markDonated({ donorUserId: userId, requestId });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        code: result.code,
        message: localize(req, `lc_${result.code}`),
      });
    }
    const request = result.request;
    if (result.alreadyMarked) {
      // Idempotent double-tap: no second notification, the reminder clock is untouched.
      return res.status(200).json({ success: true, request, alreadyMarked: true });
    }

    const donorName = (result.donor && result.donor.fullName) || "The donor";
    await createNotification({
      userId: request.seekerId,
      title: "Please confirm your donation",
      category: "status",
      message: `${donorName} has marked this donation as given. Please tap Mark Complete to confirm you received it. We'll remind you every 6 hours, and if it isn't confirmed within 3 days this chat's history will be automatically deleted.`,
      link: "/(tabs)/requests",
      type: "donation_marked",
      role: "seeker",
      requestType: "direct",
      requestId: request._id,
      critical: true,
    });
    // The donor acted on this request: clear their own notifications about it.
    await markRequestNotificationsRead(userId, request._id);

    emitToUser(request.seekerId.toString(), "donor_marked_donated", {
      requestId: request._id.toString(),
      donorMarkedDonatedAt: request.donorMarkedDonatedAt,
    });
    emitStatus({ request, previousStatus: request.status, seekerUserId: request.seekerId, donorUserId: userId });

    res.status(200).json({ success: true, request });
  } catch (error) {
    console.error("Mark Donated Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

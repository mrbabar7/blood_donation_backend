const { createNotification, markRequestNotificationsRead } = require("../notificationController");
const lifecycle = require("../../services/donationLifecycle");
const { emitStatus } = require("../../services/donationLifecycle/notify");
const { localize } = require("../../utils/localizedMessages");

exports.rejectRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    if (!require("mongoose").Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, message: "Invalid request id" });
    }
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 7); // declined rows are purged after 7 days

    // Atomic pending -> rejected (owner only, not after the 12-hour deadline).
    const result = await lifecycle.rejectRequest({
      donorUserId: req.user.id || req.user._id,
      requestId,
      retainUntil: expiryDate,
    });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        code: result.code,
        message: localize(req, `lc_${result.code}`),
      });
    }
    const request = result.request;

    // The donor acted on this request: its "new request" notification is done.
    await markRequestNotificationsRead(req.user.id || req.user._id, request._id);

    await createNotification({
      userId: request.seekerId,
      title: "Blood Request Rejected",
      category: "status",
      message:
        "We are sorry, the donor has declined your blood request. Please search for another available donor.",
      link: "/(tabs)/requests",
      type: "request_rejected",
      role: "seeker",
      requestType: "direct",
      requestId: request._id,
    });

    emitStatus({
      request,
      previousStatus: "pending",
      seekerUserId: request.seekerId,
      donorUserId: req.user.id || req.user._id,
    });

    res.status(200).json({
      success: true,
      message: "Request rejected and seeker notified via Socket, Push & Email.",
    });
  } catch (error) {
    console.error("Reject Request Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during rejection",
      error: error.message,
    });
  }
};

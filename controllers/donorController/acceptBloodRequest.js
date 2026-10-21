const { Donor } = require("../../models/formModel");
const userModel = require("../../models/userMode");
const { createNotification, markRequestNotificationsRead } = require("../notificationController");
const lifecycle = require("../../services/donationLifecycle");
const { emitStatus } = require("../../services/donationLifecycle/notify");
const { localize } = require("../../utils/localizedMessages");

exports.acceptRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    if (!require("mongoose").Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, message: "Invalid request id" });
    }

    // Atomic pending -> accepted. Only the donor the request was sent to can accept, only
    // while it is still pending AND before its 12-hour deadline: a late accept of an
    // expired / cancelled / already-answered request fails and never revives it.
    const result = await lifecycle.acceptRequest({ donorUserId: req.user.id || req.user._id, requestId });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        code: result.code,
        message: localize(req, `lc_${result.code}`),
      });
    }
    const request = result.request;

    const donor = await Donor.findById(request.donorId).populate("userId");
    const seeker = await userModel.findById(request.seekerId);

    if (!seeker || !donor) {
      return res
        .status(404)
        .json({ success: false, message: "Seeker or Donor record not found" });
    }

    // The donor acted on this request: its "new request" notification is done.
    await markRequestNotificationsRead(req.user.id || req.user._id, request._id);

    await createNotification({
      userId: request.seekerId,
      title: "Blood Request Accepted",
      category: "status",
      message: `Good news! Donor ${donor.fullName} has accepted your blood request. Please contact the donor.`,
      link: "/(tabs)/requests", // Seeker's Request tab (Message / Lock / Release)
      type: "request_accepted",
      role: "seeker",
      requestType: "direct",
      requestId: request._id,
    });

    // Realtime: only the two parties get the update (it used to be emitted to every socket).
    emitStatus({
      request,
      previousStatus: "pending",
      seekerUserId: request.seekerId,
      donorUserId: req.user.id || req.user._id,
    });

    res.status(200).json({
      success: true,
      message: "Request accepted and seeker notified via Socket, Push & Email.",
      request,
    });
  } catch (error) {
    console.error("Accept Request Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during acceptance",
      error: error.message,
    });
  }
};

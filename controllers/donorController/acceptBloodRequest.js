const { DonationRequest, Donor } = require("../../models/formModel");
const userModel = require("../../models/userMode");
const { createNotification } = require("../notificationController");

exports.acceptRequest = async (req, res) => {
  try {
    const { requestId } = req.params;

    // A request the seeker cancelled (broadcast cancellation) can no longer
    // be accepted. The status filter makes this race-safe against a cancel
    // landing at the same moment.
    const request = await DonationRequest.findOneAndUpdate(
      { _id: requestId, status: { $ne: "cancelled_by_seeker" } },
      { status: "accepted" },
      { new: true },
    );

    if (!request) {
      const exists = await DonationRequest.exists({ _id: requestId });
      if (exists) {
        return res.status(409).json({
          success: false,
          code: "REQUEST_CANCELLED",
          message: "This request was cancelled by the seeker.",
        });
      }
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    }

    const donor = await Donor.findById(request.donorId).populate("userId");
    const seeker = await userModel.findById(request.seekerId);

    if (!seeker || !donor) {
      return res
        .status(404)
        .json({ success: false, message: "Seeker or Donor record not found" });
    }

    await createNotification({
      userId: request.seekerId,
      title: "Blood Request Accepted",
      category: "status",
      message: `Good news! Donor ${donor.fullName} has accepted your blood request. Please contact the donor.`,
      link: "/(tabs)/home", // Seeker dashboard is rendered by (tabs)/home based on role — see src/screens/SeekerDashboard.tsx
      // link: "/(manual)/donor-details",
      // params: {
      //   donorId: donor._id.toString(),
      //   requestId: request._id.toString(),
      // },
    });

    // ================= REAL-TIME SOCKET EMIT =================
    const io = req.app?.get("io") || global.io;
    if (io) {
      const socketPayload = {
        requestId: request._id.toString(),
        requestStatus: "accepted",
        status: "accepted",
        donorId: donor._id.toString(),
        seekerId: request.seekerId.toString(),
      };

      // Broadcast to all sockets & specific rooms
      io.emit("blood_request_status_updated", socketPayload);
      // io.emit("request_status_changed", socketPayload);
      io.to(`user_${request.seekerId}`).emit(
        "blood_request_status_updated",
        socketPayload,
      );
    }

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

const { DonationRequest } = require("../../models/formModel");
const userModel = require("../../models/userMode");
const { createNotification } = require("../notificationController");

exports.rejectRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 7);

    const request = await DonationRequest.findOneAndUpdate(
      { _id: requestId, status: { $ne: "cancelled_by_seeker" } },
      {
        status: "rejected",
        expireAt: expiryDate,
      },
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

    await createNotification({
      userId: request.seekerId,
      title: "Blood Request Rejected",
      category: "status",
      message:
        "We are sorry, the donor has declined your blood request. Please search for another available donor.",
      link: "/(tabs)/home", // Seeker dashboard is rendered by (tabs)/home based on role — see src/screens/SeekerDashboard.tsx
    });

    // ================= REAL-TIME SOCKET EMIT =================
    const io = req.app?.get("io") || global.io;
    if (io) {
      const socketPayload = {
        requestId: request._id.toString(),
        requestStatus: "rejected",
        status: "rejected",
        donorId: request.donorId ? request.donorId.toString() : null,
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

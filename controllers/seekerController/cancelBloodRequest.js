const { DonationRequest, Donor } = require("../../models/formModel");
const userModel = require("../../models/userMode");
const { createNotification } = require("../notificationController");

exports.cancelRequest = async (req, res) => {
  try {
    const { donorId } = req.params;
    const seekerId = req.user.id || req.user._id;

    const deletedRequest = await DonationRequest.findOneAndDelete({
      donorId,
      seekerId,
      status: "pending",
    });

    if (!deletedRequest) {
      return res
        .status(404)
        .json({ success: false, message: "No pending request found" });
    }

    const seeker = await userModel.findById(seekerId);
    const donor = await Donor.findById(donorId).populate("userId");

    if (donor && donor.userId) {
      await createNotification({
        userId: donor.userId._id,
        title: "Blood Request Cancelled",
      category: "status",
        message: `${seeker ? seeker.name : "A seeker"} cancelled their blood request.`,
        link: "/(tabs)/home", // Donor dashboard is rendered by (tabs)/home based on role — see src/screens/DonorDashboard.tsx
        type: "request_cancelled",
        role: "donor",
        requestType: "direct",
        // The request row was deleted by this cancel, so the app's lookup will
        // (correctly) report it unavailable and show the friendly fallback.
        requestId: deletedRequest._id,
      });
    }

    res.status(200).json({
      success: true,
      message: "Request cancelled successfully and donor notified.",
    });
  } catch (error) {
    console.error("Cancel Request Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel request",
      error: error.message,
    });
  }
};

const Broadcast = require("../../models/broadcastModel");
const { DonationRequest } = require("../../models/formModel");

// GET /seeker/broadcast/:id  — powers the live "Emergency SOS Broadcast" tracker
// (elapsed time, responded count, on-the-way donors) on PDF screen 17.
exports.getBroadcastStatus = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const broadcast = await Broadcast.findOne({ _id: req.params.id, seekerId });
    if (!broadcast) {
      return res.status(404).json({ success: false, message: "Broadcast not found" });
    }

    const requests = await DonationRequest.find({ broadcastId: broadcast._id }).populate(
      "donorId",
      "fullName bloodType mobileNumber district"
    );

    // Cancelled-by-seeker rows are not donor "responses".
    const responded = requests.filter((r) => r.status !== "pending" && r.status !== "cancelled_by_seeker").length;
    const onTheWay = requests
      .filter((r) => r.status === "accepted")
      .map((r) => ({
        id: r._id,
        donorName: r.donorId?.fullName || "A verified donor",
        bloodType: r.donorId?.bloodType,
        district: r.donorId?.district,
      }));

    res.status(200).json({
      success: true,
      broadcast,
      totalNotified: requests.length,
      responded,
      onTheWay,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load broadcast status", error: error.message });
  }
};

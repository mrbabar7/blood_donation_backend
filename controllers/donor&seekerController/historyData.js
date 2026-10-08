const { DonationRequest, Donor } = require("../../models/formModel");

exports.getActivityHistory = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const seekerRequests = await DonationRequest.find({ seekerId: userId })
      .populate("donorId", "fullName bloodType")
      .sort({ createdAt: -1 });

    const donorProfile = await Donor.findOne({ userId });
    let donorRequests = [];
    if (donorProfile) {
      donorRequests = await DonationRequest.find({
        donorId: donorProfile._id,
        status: { $in: ["accepted", "rejected", "completed"] },
      })
        .populate("seekerId", "name")
        .sort({ createdAt: -1 });
    }

    const history = {
      seeker: seekerRequests.map((r) => ({
        id: r._id,
        date: new Date(r.createdAt).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        partner: r.donorId?.fullName || "Donor",
        bloodGroup: r.requestedBloodType,
        status: r.status.charAt(0).toUpperCase() + r.status.slice(1),
      })),
      donor: donorRequests.map((r) => ({
        id: r._id,
        date: new Date(r.createdAt).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        partner: r.seekerId?.name || "Someone",
        bloodGroup: r.requestedBloodType,
        status: r.status.charAt(0).toUpperCase() + r.status.slice(1),
      })),
    };

    res.status(200).json(history);
  } catch (error) {
    res
      .status(500)
      .json({ message: "History fetch failed", error: error.message });
  }
};

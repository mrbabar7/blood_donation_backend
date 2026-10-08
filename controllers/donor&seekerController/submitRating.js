const { DonationRequest, Donor } = require("../../models/formModel");

const checkActiveDonation = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    // 1. Find the Donor profile associated with this user
    const donor = await Donor.findOne({ userId });

    if (!donor) {
      return res.status(200).json({ success: true, hasActive: false });
    }

    // 2. Query using donor._id instead of user._id
    const activeRequest = await DonationRequest.findOne({
      donorId: donor._id,
      status: "accepted",
    });

    if (activeRequest) {
      return res.status(200).json({
        success: true,
        hasActive: true,
        requestId: activeRequest._id,
      });
    }

    return res.status(200).json({ success: true, hasActive: false });
  } catch (error) {
    console.error("Check Active Donation Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

module.exports = { checkActiveDonation };

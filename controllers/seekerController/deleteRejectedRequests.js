const { DonationRequest } = require("../../models/formModel");

exports.deleteRejectedRequests = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    await DonationRequest.deleteMany({ seekerId, status: "rejected" });
    res.status(200).json({ message: "Rejected requests cleared" });
  } catch (error) {
    res.status(500).json({ message: "Delete failed" });
  }
};

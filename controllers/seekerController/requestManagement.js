const { DonationRequest } = require("../../models/formModel");

exports.deleteSingleRequest = async (req, res) => {
  try {
    const requestId = req.params.requestId;
    const userId = req.user.id || req.user._id;

    const request = await DonationRequest.findOne({
      _id: requestId,
      seekerId: userId,
    });

    if (!request) {
      return res
        .status(404)
        .json({ message: "Request not found or unauthorized" });
    }

    await DonationRequest.findByIdAndDelete(requestId);
    res.status(200).json({ message: "Request deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.clearRequestHistory = async (req, res) => {
  try {
    const { status } = req.params;
    const userId = req.user.id || req.user._id;

    if (!["rejected", "completed"].includes(status)) {
      return res
        .status(400)
        .json({ message: "Only rejected or completed history can be cleared" });
    }

    const result = await DonationRequest.deleteMany({
      seekerId: userId,
      status: status,
    });

    res.status(200).json({
      message: `${status} history cleared`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

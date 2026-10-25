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

    // Only closed requests can be removed from history; deleting a live one would strand
    // the donor's state (lock / active-donation) on the other side.
    if (!TERMINAL_STATUSES.includes(request.status)) {
      return res.status(409).json({ message: "Only finished requests can be deleted" });
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

    if (!TERMINAL_STATUSES.includes(status) || status === "cancelled_by_seeker") {
      return res
        .status(400)
        .json({ message: "Only finished request history can be cleared" });
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

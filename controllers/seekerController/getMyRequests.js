const { DonationRequest } = require("../../models/formModel");

exports.getMyRequests = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Auto-reject stale requests older than 7 days
    await DonationRequest.updateMany(
      {
        seekerId,
        status: "pending",
        createdAt: { $lt: oneWeekAgo },
      },
      { status: "rejected" },
    );

    const requests = await DonationRequest.find({ seekerId })
      .populate({
        path: "donorId",
        select:
          "fullName bloodType district province mobileNumber profilePicture rating totalRatings livesSaved",
        populate: {
          path: "userId",
          select: "isOnline lastSeen",
        },
      })
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: requests.length, requests });
  } catch (error) {
    console.error("Get My Requests Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch requests",
        error: error.message,
      });
  }
};

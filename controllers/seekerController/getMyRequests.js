const { DonationRequest } = require("../../models/formModel");
const lifecycle = require("../../services/donationLifecycle");

exports.getMyRequests = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;

    // Enforce the 12-hour deadline for this seeker before listing (the background worker
    // does the same for everyone; this just guarantees a fresh answer if it lags).
    await lifecycle.expireDue({ seekerId });

    const requests = await DonationRequest.find({ seekerId })
      .populate({
        path: "donorId",
        select:
          "fullName bloodType district province mobileNumber profilePicture rating totalRatings livesSaved",
        populate: {
          path: "userId",
          select: "isOnline lastSeen profilePicture",
        },
      })
      .sort({ createdAt: -1 });

    // Surface the donor's canonical photo (linked User) on the donor object.
    const shaped = requests.map((r) => {
      const obj = r.toObject();
      if (obj.donorId) {
        obj.donorId.profilePicture =
          obj.donorId.userId?.profilePicture || obj.donorId.profilePicture || "";
      }
      return obj;
    });

    // Server-computed lifecycle flags so the app never derives them itself.
    const [renotify, blockedBy] = await Promise.all([
      lifecycle.renotifyInfo({ seekerId }),
      lifecycle.seekerCompletionBlock(seekerId),
    ]);

    res.status(200).json({
      success: true,
      count: shaped.length,
      requests: shaped,
      serverTime: new Date().toISOString(),
      renotifyReleased: { count: renotify.count, visible: renotify.visible },
      sendBlocked: Boolean(blockedBy),
    });
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

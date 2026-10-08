const Broadcast = require("../../models/broadcastModel");
const { DonationRequest } = require("../../models/formModel");

// GET /seeker/my-broadcasts — feeds the "My Requests" list on PDF screen 15
// alongside the existing direct-request list from getMyRequests.
exports.getMyBroadcasts = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const broadcasts = await Broadcast.find({ seekerId }).sort({ createdAt: -1 }).limit(50);

    // One query for every broadcast's requests (grouped in memory) instead of
    // one query per broadcast.
    const allRequests = broadcasts.length
      ? await DonationRequest.find({
          broadcastId: { $in: broadcasts.map((b) => b._id) },
        })
          .select("broadcastId status donorMarkedDonatedAt")
          .lean()
      : [];
    const requestsByBroadcast = new Map();
    for (const r of allRequests) {
      const key = String(r.broadcastId);
      if (!requestsByBroadcast.has(key)) requestsByBroadcast.set(key, []);
      requestsByBroadcast.get(key).push(r);
    }

    const withCounts = await Promise.all(
      broadcasts.map(async (b) => {
        const requests = requestsByBroadcast.get(String(b._id)) || [];
        return {
          ...b.toObject(),
          matchedCount: requests.filter((r) => r.status === "accepted").length,
          completedCount: requests.filter((r) => r.status === "completed").length,
          // Added so the app can tell a broadcast that's still waiting on
          // replies apart from one where every donor has already answered
          // (all rejected, none accepted/completed) — without these the
          // client can't distinguish "still searching" from "nobody could
          // help" and was sending seekers back into the live SOS screen
          // for both.
          pendingCount: requests.filter((r) => r.status === "pending").length,
          rejectedCount: requests.filter((r) => r.status === "rejected").length,
          cancelledCount: requests.filter((r) => r.status === "cancelled_by_seeker").length,
          // A donor already marked "I have donated" on one of this broadcast's
          // accepted requests — cancelling is no longer allowed (see
          // cancelBloodRequest.js), so the app hides the Cancel button.
          donationMarkedCount: requests.filter((r) => r.status === "accepted" && r.donorMarkedDonatedAt).length,
        };
      })
    );

    res.status(200).json({ success: true, broadcasts: withCounts });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load your requests", error: error.message });
  }
};

const { Donor, DonationRequest } = require("../../models/formModel");
const { writeAuditLog } = require("./auditLogController");

// GET /admin/fraud — real detection queries against real data. Two limitations
// flagged honestly rather than hidden:
// 1. CNIC-based duplicate detection isn't possible — the Donor schema doesn't
//    collect a CNIC field (the mobile registration form never asks for one).
//    This uses mobileNumber duplicates as the real proxy signal instead.
// 2. Historical no-show counts are limited to requests still in the database —
//    expired requests are auto-deleted by MongoDB's TTL index (same caveat as
//    the Blood Requests "Expired" tab), so this only catches accepted-but-stale
//    requests that haven't been swept yet.
exports.getFraudOverview = async (req, res) => {
  try {
    const duplicatePhones = await Donor.aggregate([
      { $group: { _id: "$mobileNumber", count: { $sum: 1 }, donors: { $push: { id: "$_id", name: "$fullName" } } } },
      { $match: { count: { $gt: 1 } } },
    ]);

    const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000); // accepted 48h+ ago, still not completed
    const noShows = await DonationRequest.find({ status: "accepted", updatedAt: { $lt: staleThreshold } })
      .populate("donorId", "fullName")
      .limit(20);

    const flaggedDonors = await Donor.find({ isFlagged: true }).select("fullName flagReason district");

    res.status(200).json({
      success: true,
      duplicatePhoneGroups: duplicatePhones,
      possibleNoShows: noShows.map((r) => ({ id: r._id, donorName: r.donorId?.fullName, bloodType: r.requestedBloodType, acceptedAt: r.updatedAt })),
      flaggedDonors,
      note: "Duplicate detection uses phone number, not CNIC — no CNIC field is collected at registration yet. No-show detection only sees requests MongoDB hasn't auto-expired yet, not a full history.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/fraud/merge — merges donor B into donor A: reassigns B's requests
// to A, deletes B. A real, consequential action.
exports.mergeDonors = async (req, res) => {
  try {
    const { keepId, removeId } = req.body;
    if (!keepId || !removeId) return res.status(400).json({ success: false, message: "keepId and removeId are required." });

    await DonationRequest.updateMany({ donorId: removeId }, { donorId: keepId });
    const removed = await Donor.findByIdAndDelete(removeId);

    await writeAuditLog({
      actorId: req.admin._id, actorName: req.admin.name,
      action: `Merged duplicate donor account (${removed?.fullName || removeId}) into ${keepId}`, category: "donors",
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

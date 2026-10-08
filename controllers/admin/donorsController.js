const { Donor, DonationRequest } = require("../../models/formModel");
const DonationLog = require("../../models/donationLogModel");
const { writeAuditLog } = require("./auditLogController");

// GET /admin/donors?status=verified|pending|flagged&search=&page=&limit=
// "Verified" here means "has a completed, ID-checked profile" — i.e. registered
// at all, since this backend doesn't have a separate manual-ID-review workflow.
// Donors are only ever "Pending"/"Flagged" via the explicit fields below, which an
// admin sets — nothing is silently auto-flagged without a real reason attached.
exports.listDonors = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));

    const filter = {};
    if (status === "flagged") filter.isFlagged = true;
    if (status === "pending") {
      filter.isSuspended = false;
      filter.isFlagged = false;
      filter.isAvailable = false;
    }
    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, "i") },
        { mobileNumber: new RegExp(search, "i") },
        { district: new RegExp(search, "i") },
      ];
    }

    const [donors, total] = await Promise.all([
      Donor.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Donor.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      donors,
      pagination: { currentPage: pageNum, totalPages: Math.ceil(total / limitNum) || 1, total },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /admin/donors/:id — full profile + a real activity timeline built from
// actual DonationRequest/DonationLog rows, not placeholder text.
exports.getDonorDetail = async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id).lean();
    if (!donor) return res.status(404).json({ success: false, message: "Donor not found." });

    const [completedLogs, acceptedRequests] = await Promise.all([
      DonationLog.find({ donorId: donor._id }).sort({ date: -1 }).limit(10).lean(),
      DonationRequest.find({ donorId: donor._id, status: { $ne: "pending" } }).sort({ updatedAt: -1 }).limit(10).lean(),
    ]);

    const timeline = [
      ...completedLogs.map((l) => ({ text: "Donation completed", at: l.date })),
      ...acceptedRequests.map((r) => ({
        text: `Request ${r.status} — ${r.requestedBloodType} for ${r.seekerName}`,
        at: r.updatedAt,
      })),
      { text: "Registered as donor", at: donor.createdAt },
    ]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 15);

    const daysSinceLast = donor.lastDonationDate
      ? Math.floor((Date.now() - new Date(donor.lastDonationDate)) / (1000 * 60 * 60 * 24))
      : null;

    res.status(200).json({ success: true, donor, timeline, daysSinceLast });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /admin/donors/:id/controls — toggles from the "Account controls" card.
exports.updateDonorControls = async (req, res) => {
  try {
    const { appearsInPublicSearch, pushNotificationsEnabled, isAvailable } = req.body;
    const update = {};
    if (appearsInPublicSearch !== undefined) update.appearsInPublicSearch = appearsInPublicSearch;
    if (pushNotificationsEnabled !== undefined) update.pushNotificationsEnabled = pushNotificationsEnabled;
    if (isAvailable !== undefined) update.isAvailable = isAvailable;

    const donor = await Donor.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!donor) return res.status(404).json({ success: false, message: "Donor not found." });

    await writeAuditLog({
      actorId: req.admin._id,
      actorName: req.admin.name,
      action: `Updated account controls for donor ${donor.fullName}`,
      category: "donors",
    });

    res.status(200).json({ success: true, donor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.flagDonor = async (req, res) => {
  try {
    const { reason } = req.body;
    const donor = await Donor.findByIdAndUpdate(req.params.id, { isFlagged: true, flagReason: reason || "Flagged by admin" }, { new: true });
    if (!donor) return res.status(404).json({ success: false, message: "Donor not found." });

    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Flagged donor ${donor.fullName}: ${reason || "no reason given"}`, category: "donors" });
    res.status(200).json({ success: true, donor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.suspendDonor = async (req, res) => {
  try {
    const donor = await Donor.findByIdAndUpdate(req.params.id, { isSuspended: true, isAvailable: false }, { new: true });
    if (!donor) return res.status(404).json({ success: false, message: "Donor not found." });

    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Suspended donor account: ${donor.fullName}`, category: "donors" });
    res.status(200).json({ success: true, donor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.reinstateDonor = async (req, res) => {
  try {
    const donor = await Donor.findByIdAndUpdate(req.params.id, { isSuspended: false, isFlagged: false, flagReason: "" }, { new: true });
    if (!donor) return res.status(404).json({ success: false, message: "Donor not found." });

    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Reinstated donor account: ${donor.fullName}`, category: "donors" });
    res.status(200).json({ success: true, donor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

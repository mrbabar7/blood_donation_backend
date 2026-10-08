const Hospital = require("../../models/hospitalModel");
const BloodBank = require("../../models/bankModel");
const Ambulance = require("../../models/ambulanceModel");
const NGO = require("../../models/ngoModel");
const { writeAuditLog } = require("./auditLogController");

const MODELS = { hospitals: Hospital, bloodbanks: BloodBank, ambulances: Ambulance, ngos: NGO };
const LABELS = { hospitals: "Hospital", bloodbanks: "Blood Bank", ambulances: "Ambulance", ngos: "NGO" };

// GET /admin/verification-queue — merges all 4 directory collections' unverified
// entries into one queue, oldest-first, so nothing waits longer just because it's
// in a less-checked collection.
exports.getVerificationQueue = async (req, res) => {
  try {
    const results = await Promise.all(
      Object.entries(MODELS).map(async ([type, Model]) => {
        const docs = await Model.find({ isVerified: false }).sort({ createdAt: 1 }).lean();
        return docs.map((d) => ({ ...d, orgKind: LABELS[type], directoryType: type }));
      })
    );

    const queue = results.flat().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const approvedThisMonth = await Promise.all(
      Object.values(MODELS).map((Model) => Model.countDocuments({ isVerified: true, updatedAt: { $gte: startOfMonth } }))
    ).then((counts) => counts.reduce((a, b) => a + b, 0));

    res.status(200).json({
      success: true,
      queue,
      stats: { awaitingReview: queue.length, approvedThisMonth },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/verification-queue/:type/:id/approve
exports.approveVerification = async (req, res) => {
  try {
    const { type, id } = req.params;
    const Model = MODELS[type];
    if (!Model) return res.status(400).json({ success: false, message: "Unknown directory type." });

    const doc = await Model.findByIdAndUpdate(id, { isVerified: true }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });

    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Approved verification for ${doc.name}`, category: "verification" });
    res.status(200).json({ success: true, doc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/verification-queue/:type/:id/reject
// Rejection doesn't delete the listing (it may be resubmitted with fixes) — it
// just leaves isVerified false with a reason attached, and logs the decision.
exports.rejectVerification = async (req, res) => {
  try {
    const { type, id } = req.params;
    const { reason } = req.body;
    const Model = MODELS[type];
    if (!Model) return res.status(400).json({ success: false, message: "Unknown directory type." });

    const doc = await Model.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });

    await writeAuditLog({
      actorId: req.admin._id,
      actorName: req.admin.name,
      action: `Rejected verification for ${doc.name}${reason ? `: ${reason}` : ""}`,
      category: "verification",
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

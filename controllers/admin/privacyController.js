const DataRequest = require("../../models/dataRequestModel");
const { Donor } = require("../../models/formModel");
const User = require("../../models/userMode");
const PlatformSettings = require("../../models/platformSettingsModel");
const { writeAuditLog } = require("./auditLogController");

// GET /admin/privacy — real consent rates computed from actual Donor fields
// (only the two this schema genuinely tracks — location-adjacent consent and
// marketing-adjacent consent aren't separately captured, so they're omitted
// rather than invented).
exports.getPrivacyOverview = async (req, res) => {
  try {
    const totalDonors = await Donor.countDocuments();
    const [publicSearchOptIn, pushOptIn] = await Promise.all([
      Donor.countDocuments({ appearsInPublicSearch: true }),
      Donor.countDocuments({ pushNotificationsEnabled: true }),
    ]);

    const requests = await DataRequest.find().populate("userId", "name email").sort({ createdAt: -1 }).limit(30);
    const completedThisMonth = requests.filter(
      (r) => r.status === "completed" && r.fulfilledAt && r.fulfilledAt > new Date(new Date().setDate(1))
    ).length;

    // donorDataRetentionYears was a real, saved Settings value with nothing
    // ever reading it. Deliberately NOT auto-deleting anything on a schedule —
    // silently erasing real user data from an untested background job is a
    // worse failure mode than doing nothing. Instead: surface who's past the
    // window so an admin reviews and, if appropriate, logs a real deletion
    // request through the same audited flow above (fulfillDataRequest).
    // updatedAt is used as the "last activity" proxy, same honest
    // approximation pattern as the Dashboard's avg-response-time metric.
    const settings = await PlatformSettings.findOne().select("donorDataRetentionYears");
    const retentionYears = settings?.donorDataRetentionYears || 5;
    const retentionCutoff = new Date();
    retentionCutoff.setFullYear(retentionCutoff.getFullYear() - retentionYears);
    const retentionCandidates = await Donor.find({ updatedAt: { $lt: retentionCutoff } })
      .select("fullName userId updatedAt")
      .sort({ updatedAt: 1 })
      .limit(50);

    res.status(200).json({
      success: true,
      requests,
      completedThisMonth,
      retentionYears,
      retentionCandidates: retentionCandidates.map((d) => ({
        donorId: d._id, userId: d.userId, name: d.fullName, lastActiveAt: d.updatedAt,
      })),
      consentRates: totalDonors > 0 ? {
        publicProfileVisibility: Math.round((publicSearchOptIn / totalDonors) * 100),
        pushNotifications: Math.round((pushOptIn / totalDonors) * 100),
      } : { publicProfileVisibility: 0, pushNotifications: 0 },
      note: "Only two consent types are actually tracked in the schema (public search visibility, push notifications) — location-access and marketing-communication consent aren't captured yet, so they're left out rather than invented. Retention candidates below are surfaced for review only — nothing is auto-deleted; log a deletion request for one to route it through the same audited fulfillment flow as any other request.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.logDataRequest = async (req, res) => {
  try {
    const { userId, type } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const request = await DataRequest.create({ userId, requesterName: user.name, type });
    res.status(201).json({ success: true, request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/privacy/requests/:id/fulfill — REAL action. For "deletion", this
// actually deletes the Donor profile (and, if requested, the User account).
exports.fulfillDataRequest = async (req, res) => {
  try {
    const request = await DataRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });

    if (request.type === "deletion") {
      await Donor.deleteOne({ userId: request.userId });
      await User.findByIdAndDelete(request.userId);
    }
    // "export" fulfillment (assembling and sending a real data file) is a
    // real operational step not automated here — marking it completed records
    // that a human did it, same as the PDF's manual "View" + fulfil workflow.

    request.status = "completed";
    request.fulfilledAt = new Date();
    request.fulfilledBy = req.admin._id;
    await request.save();

    await writeAuditLog({
      actorId: req.admin._id, actorName: req.admin.name,
      action: `Fulfilled ${request.type} request for ${request.requesterName}`, category: "donors",
    });

    res.status(200).json({ success: true, request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

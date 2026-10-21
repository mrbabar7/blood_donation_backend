const FeatureFlag = require("../../models/featureFlagModel");
const { writeAuditLog } = require("./auditLogController");

// GET /feature-flags — PUBLIC. A real app could check this at launch to decide
// what to show — not wired into the mobile app's UI yet this pass, but the data
// is real and a client-side check against it would work today.
exports.getPublicFlags = async (req, res) => {
  try {
    const flags = await FeatureFlag.find();
    res.status(200).json({ success: true, flags });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listFlags = async (req, res) => {
  try {
    const flags = await FeatureFlag.find().sort({ createdAt: 1 });
    res.status(200).json({ success: true, flags });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.upsertFlag = async (req, res) => {
  try {
    const { key, label, status, rolloutPercent } = req.body;
    if (!key || !label) return res.status(400).json({ success: false, message: "Key and label are required." });

    const flag = await FeatureFlag.findOneAndUpdate(
      { key },
      { key, label, status, rolloutPercent },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Updated feature flag: ${key}`, category: "platform" });
    res.status(200).json({ success: true, flag });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteFlag = async (req, res) => {
  try {
    await FeatureFlag.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

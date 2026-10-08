const PlatformSettings = require("../../models/platformSettingsModel");
const { writeAuditLog } = require("./auditLogController");

async function getSingleton() {
  let doc = await PlatformSettings.findOne();
  if (!doc) doc = await PlatformSettings.create({});
  return doc;
}

exports.getSettings = async (req, res) => {
  try {
    const settings = await getSingleton();
    res.status(200).json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await getSingleton();
    Object.assign(settings, req.body);
    await settings.save();
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Updated platform settings`, category: "platform" });
    res.status(200).json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

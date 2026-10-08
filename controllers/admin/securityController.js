const AdminSession = require("../../models/adminSessionModel");
const IpAllowlistEntry = require("../../models/ipAllowlistModel");
const AuditLog = require("../../models/auditLogModel");
const PlatformSettings = require("../../models/platformSettingsModel");
const { writeAuditLog } = require("./auditLogController");

// GET /admin/security — real recent sessions (last 20 logins) + the real
// security-category audit trail + real allowlist entries. No fabricated
// "2FA adoption %" — that would need real TOTP enrollment tracking, which isn't
// built (see the settings' require2FAForAdmins flag: it's a real toggle, but
// nothing enforces a TOTP challenge yet).
exports.getSecurityOverview = async (req, res) => {
  try {
    const [sessions, events, allowlist, settings] = await Promise.all([
      AdminSession.find().sort({ createdAt: -1 }).limit(20),
      AuditLog.find({ category: "security" }).sort({ createdAt: -1 }).limit(20),
      IpAllowlistEntry.find().sort({ createdAt: -1 }),
      PlatformSettings.findOne(),
    ]);

    res.status(200).json({
      success: true,
      sessions,
      events,
      allowlist,
      settings: {
        require2FAForAdmins: settings?.require2FAForAdmins ?? false,
        restrictAdminIpAllowlist: settings?.restrictAdminIpAllowlist ?? false,
      },
      note: "2FA is real per-admin (My Account below) — an admin who completes setup must enter a code on every future login. The global toggle here doesn't retroactively force enrollment for admins who haven't set it up yet, since that would risk locking them out of their own account; it's a policy flag for now, not an auto-enforcement switch. The IP allowlist toggle IS fully enforced: turning it on with at least one range saved blocks admin logins from any other IP.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addAllowlistEntry = async (req, res) => {
  try {
    const { cidr, label } = req.body;
    if (!cidr) return res.status(400).json({ success: false, message: "CIDR range is required (e.g. 203.99.12.0/24)." });
    const entry = await IpAllowlistEntry.create({ cidr, label: label || "" });
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Added IP allowlist range: ${cidr}`, category: "security" });
    res.status(201).json({ success: true, entry });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "That range is already on the allowlist." });
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.removeAllowlistEntry = async (req, res) => {
  try {
    const entry = await IpAllowlistEntry.findByIdAndDelete(req.params.id);
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Removed IP allowlist range: ${entry?.cidr}`, category: "security" });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

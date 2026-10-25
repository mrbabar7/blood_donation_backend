const AuditLog = require("../../models/auditLogModel");

// Shared by every other admin controller — call this after any sensitive action.
async function writeAuditLog({ actorId, actorName, action, category }) {
  try {
    await AuditLog.create({ actorId, actorName, action, category });
  } catch (error) {
    console.error("Audit log write failed:", error.message);
  }
}

// GET /admin/audit-log?category=&limit=
exports.getAuditLog = async (req, res) => {
  try {
    const { category, limit } = req.query;
    const filter = category && category !== "all" ? { category } : {};
    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(Number(limit) || 100);
    res.status(200).json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports.writeAuditLog = writeAuditLog;

const mongoose = require("mongoose");
const Incident = require("../../models/incidentModel");
const { writeAuditLog } = require("./auditLogController");

// GET /admin/platform-health — the ONE real live signal this backend can check
// itself (its own DB connection + process uptime). Per-service uptime %,
// latency ms, and "on-call engineer" rotation are NOT faked — they need a real
// monitoring/paging integration (e.g. Better Stack, PagerDuty).
exports.getPlatformHealth = async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState; // 1 = connected
    const incidents = await Incident.find().populate("createdBy", "name").sort({ createdAt: -1 }).limit(10);
    const openIncidents = incidents.filter((i) => i.status === "investigating").length;

    res.status(200).json({
      success: true,
      selfCheck: {
        databaseConnected: dbState === 1,
        serverUptimeSeconds: Math.round(process.uptime()),
      },
      openIncidents,
      incidents,
      note: "Per-service uptime %, API latency, and on-call rotation need a real monitoring/paging integration — not shown here rather than faked. The self-check above (DB connection, process uptime) is genuinely live.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createIncident = async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "Title is required." });
    const incident = await Incident.create({ title, createdBy: req.admin._id });
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Opened incident: ${title}`, category: "platform" });
    res.status(201).json({ success: true, incident });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.resolveIncident = async (req, res) => {
  try {
    const incident = await Incident.findByIdAndUpdate(req.params.id, { status: "resolved", resolvedAt: new Date() }, { new: true });
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Resolved incident: ${incident?.title}`, category: "platform" });
    res.status(200).json({ success: true, incident });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

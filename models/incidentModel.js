const mongoose = require("mongoose");

// Manually-logged incidents (an admin creates these) — a real runbook tool, but
// honestly NOT automated monitoring. Real uptime %, latency, and auto-detected
// incidents need an actual APM/monitoring service (Datadog, Better Stack,
// UptimeRobot, etc.) wired in separately — this just gives the team a real place
// to record and track incidents once they know about one.
const incidentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    status: { type: String, enum: ["investigating", "resolved"], default: "investigating" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Incident", incidentSchema);

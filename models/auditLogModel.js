const mongoose = require("mongoose");

// Write-once, long-retention log of every sensitive admin action (verification
// decisions, suspensions, content edits, broadcasts, security changes). Nothing
// in the admin API updates or deletes an AuditLog document — only creates.
const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
    actorName: { type: String, required: true },
    action: { type: String, required: true },
    category: {
      type: String,
      enum: ["verification", "donors", "content", "broadcast", "platform", "security", "requests"],
      required: true,
    },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1 });
auditLogSchema.index({ category: 1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);

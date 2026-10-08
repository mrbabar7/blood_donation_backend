const mongoose = require("mongoose");

const backupLogSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["full", "incremental", "dr_drill"], default: "full" },
    status: { type: String, enum: ["running", "completed", "failed"], default: "running" },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    sizeBytes: { type: Number, default: null },
    filePath: { type: String, default: "" },
    errorMessage: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BackupLog", backupLogSchema);

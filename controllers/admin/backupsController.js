const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const BackupLog = require("../../models/backupLogModel");
const { writeAuditLog } = require("./auditLogController");

exports.listBackups = async (req, res) => {
  try {
    const backups = await BackupLog.find().populate("triggeredBy", "name").sort({ createdAt: -1 }).limit(20);
    const lastCompleted = backups.find((b) => b.status === "completed");
    res.status(200).json({
      success: true,
      backups,
      lastCompletedAt: lastCompleted?.createdAt || null,
      note: "This triggers a real `mongodump` process against MONGO_URI if the mongodump binary is installed and on PATH on this server — it is NOT a scheduled/automatic backup system. Wire this endpoint into a real cron job (or your hosting provider's managed backup feature) for actual unattended daily backups.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/backups/trigger — genuinely runs `mongodump` if available. If the
// binary isn't installed, this fails honestly with an actionable error instead
// of pretending a backup happened.
exports.triggerBackup = async (req, res) => {
  const backup = await BackupLog.create({ type: "full", status: "running", triggeredBy: req.admin._id });

  try {
    const outDir = path.join(__dirname, "..", "..", "backups", `backup-${Date.now()}`);
    fs.mkdirSync(outDir, { recursive: true });

    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGO_URI is not set in the environment — can't determine what to back up.");

    const proc = spawn("mongodump", ["--uri", mongoUri, "--out", outDir]);

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", async (code) => {
      if (code === 0) {
        backup.status = "completed";
        backup.filePath = outDir;
        await backup.save();
        await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Triggered manual backup (completed)`, category: "platform" });
      } else {
        backup.status = "failed";
        backup.errorMessage = stderr || `mongodump exited with code ${code}`;
        await backup.save();
      }
    });

    proc.on("error", async (err) => {
      backup.status = "failed";
      backup.errorMessage = `mongodump binary not found or failed to start: ${err.message}`;
      await backup.save();
    });

    res.status(202).json({ success: true, message: "Backup started.", backupId: backup._id });
  } catch (error) {
    backup.status = "failed";
    backup.errorMessage = error.message;
    await backup.save();
    res.status(500).json({ success: false, message: error.message });
  }
};

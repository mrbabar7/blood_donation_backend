const Broadcast = require("../../models/broadcastModel");
const { Donor } = require("../../models/formModel");
const { createNotification } = require("../notificationController");
const { writeAuditLog } = require("./auditLogController");

// GET /admin/broadcasts — real history of every seeker-triggered emergency
// broadcast (from Phase 2's postRequest flow) — nothing fabricated.
exports.listBroadcasts = async (req, res) => {
  try {
    const broadcasts = await Broadcast.find().sort({ createdAt: -1 }).limit(50);
    res.status(200).json({ success: true, broadcasts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/broadcasts/announcement — an ADMIN-composed push notification to a
// filtered slice of donors (PDF's "push notification composer"). Real delivery
// via the same createNotification path the app already uses for match alerts —
// "delivered/opened/acted-on %" would need client-side read receipts the app
// doesn't send yet, so this returns a real recipient COUNT, not fabricated
// delivery analytics.
exports.sendAnnouncement = async (req, res) => {
  try {
    const { title, message, bloodType, city } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: "Title and message are required." });
    }

    const filter = {};
    if (bloodType && bloodType !== "all") filter.bloodType = bloodType;
    if (city && city !== "all") filter.district = new RegExp(`^${city}$`, "i");

    const donors = await Donor.find(filter).select("userId");
    await Promise.all(
      donors.map((d) => createNotification({ userId: d.userId, title, message, link: "/(tabs)/home" }))
    );

    await writeAuditLog({
      actorId: req.admin._id,
      actorName: req.admin.name,
      action: `Sent broadcast "${title}" to ${donors.length} donor(s)`,
      category: "broadcast",
    });

    res.status(201).json({ success: true, recipientCount: donors.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

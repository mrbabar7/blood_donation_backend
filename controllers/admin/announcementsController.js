const Announcement = require("../../models/announcementModel");
const { writeAuditLog } = require("./auditLogController");

// GET /announcements, alias GET /announcements/active — PUBLIC (mobile app
// calls this on launch / tab mount / foreground).
// Optional query params:
//   ?audience=donor|seeker  — the app's current RoleContext role; announcements
//                              targeted at the other role, or already-expired /
//                              not-yet-started ones, are filtered out here so
//                              the client never has to reason about scheduling.
// Returns every currently-live announcement, highest priority first, so the
// client can show them as a one-at-a-time stack (dots + "next") like a promo
// carousel, closing the gap with req.user being present-but-optional: a
// logged-out guest on guest-home.tsx gets "all"-audience announcements too.
exports.getActiveAnnouncements = async (req, res) => {
  try {
    const { audience } = req.query;
    const now = new Date();

    const filter = {
      isActive: true,
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
      ],
    };
    if (audience === "donor" || audience === "seeker") {
      filter.$and.push({ $or: [{ audience: "all" }, { audience }] });
    } else {
      filter.$and.push({ audience: "all" });
    }

    const announcements = await Announcement.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .select("-createdBy -__v");

    res.status(200).json({ success: true, announcements });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /admin/announcements — every announcement regardless of status, for the
// admin table (active/scheduled/expired badges are computed client-side from
// isActive + startDate/endDate).
exports.listAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, announcements });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found." });
    res.status(200).json({ success: true, announcement });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createAnnouncement = async (req, res) => {
  try {
    const {
      title, description, imageUrl, icon, gradientFrom, gradientTo,
      actionType, actionTarget, actionText, audience, startDate, endDate, isActive,
      priority, displayFrequency, dismissible,
    } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, message: "Title and description are required." });
    }

    const announcement = await Announcement.create({
      title, description, imageUrl, icon, gradientFrom, gradientTo,
      actionType, actionTarget, actionText, audience,
      startDate: startDate || null, endDate: endDate || null,
      isActive, priority, displayFrequency, dismissible,
      createdBy: req.admin._id,
    });

    await writeAuditLog({
      actorId: req.admin._id,
      actorName: req.admin.name,
      action: `Created announcement: ${announcement.title}`,
      category: "content",
    });

    res.status(201).json({ success: true, announcement });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateAnnouncement = async (req, res) => {
  try {
    const {
      title, description, imageUrl, icon, gradientFrom, gradientTo,
      actionType, actionTarget, actionText, audience, startDate, endDate, isActive,
      priority, displayFrequency, dismissible,
    } = req.body;

    const announcement = await Announcement.findByIdAndUpdate(
      req.params.id,
      {
        title, description, imageUrl, icon, gradientFrom, gradientTo,
        actionType, actionTarget, actionText, audience,
        startDate: startDate || null, endDate: endDate || null,
        isActive, priority, displayFrequency, dismissible,
      },
      { new: true, runValidators: true }
    );
    if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found." });

    await writeAuditLog({
      actorId: req.admin._id,
      actorName: req.admin.name,
      action: `Updated announcement: ${announcement.title}`,
      category: "content",
    });

    res.status(200).json({ success: true, announcement });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /admin/announcements/:id/toggle — quick on/off from the admin table
// without opening the full edit form.
exports.toggleAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found." });

    announcement.isActive = !announcement.isActive;
    await announcement.save();

    await writeAuditLog({
      actorId: req.admin._id,
      actorName: req.admin.name,
      action: `${announcement.isActive ? "Activated" : "Deactivated"} announcement: ${announcement.title}`,
      category: "content",
    });

    res.status(200).json({ success: true, announcement });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found." });

    await writeAuditLog({
      actorId: req.admin._id,
      actorName: req.admin.name,
      action: `Deleted announcement: ${announcement.title}`,
      category: "content",
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

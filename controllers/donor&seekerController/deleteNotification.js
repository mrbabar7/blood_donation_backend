const Notification = require("../../models/notificationModel");
const mongoose = require("mongoose");

const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    // Bulk deletion
    if (id === "all") {
      const result = await Notification.deleteMany({ userId });
      return res.status(200).json({
        success: true,
        message: "All notifications cleared successfully",
        deletedCount: result.deletedCount,
      });
    }

    // Validate single ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Notification ID format",
      });
    }

    // Delete specific notification scoped to user
    const deletedNotif = await Notification.findOneAndDelete({
      _id: id,
      userId,
    });

    if (!deletedNotif) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or unauthorized",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
      deletedId: id,
    });
  } catch (error) {
    console.error("Delete Notification Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting notification",
      error: error.message,
    });
  }
};


// Bulk delete of a user-selected set of notifications (selection mode in the
// app). Scoped to the signed-in user, so ids belonging to someone else are
// silently ignored rather than deleted. Idempotent: ids that are already gone
// simply don't count towards deletedCount.
const MAX_BULK_DELETE = 200;
const deleteManyNotifications = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const raw = Array.isArray(req.body && req.body.ids) ? req.body.ids : null;
    if (!raw || raw.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ids must be a non-empty array",
      });
    }
    if (raw.length > MAX_BULK_DELETE) {
      return res.status(400).json({
        success: false,
        message: `Too many notifications in one request (max ${MAX_BULK_DELETE})`,
      });
    }
    const ids = [...new Set(raw.map(String))];
    if (!ids.every((i) => mongoose.Types.ObjectId.isValid(i))) {
      return res.status(400).json({
        success: false,
        message: "Invalid Notification ID format",
      });
    }

    const result = await Notification.deleteMany({
      _id: { $in: ids },
      userId,
    });
    return res.status(200).json({
      success: true,
      message: "Notifications deleted successfully",
      deletedCount: result.deletedCount,
      requested: ids.length,
    });
  } catch (error) {
    console.error("Bulk Delete Notifications Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting notifications",
      error: error.message,
    });
  }
};

module.exports = { deleteNotification, deleteManyNotifications };

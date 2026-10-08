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

module.exports = { deleteNotification };

const userModel = require("../../models/userMode");

const savePushToken = async (req, res) => {
  try {
    const { token, fcmToken } = req.body;
    // Extract userId from authenticated user or request body fallback
    const userId = req.user?._id || req.user?.id || req.body.userId;
    const tokenToSave = fcmToken || token;

    if (!tokenToSave) {
      return res.status(400).json({
        success: false,
        message: "FCM token is required",
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User ID not found",
      });
    }

    const updatedUser = await userModel.findByIdAndUpdate(
      userId,
      { fcmToken: tokenToSave },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log(`✅ FCM Token successfully saved for User (${userId})`);

    return res.status(200).json({
      success: true,
      message: "FCM Token saved successfully",
    });
  } catch (error) {
    console.error("Error in savePushToken:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save FCM token",
    });
  }
};

module.exports = savePushToken;

const userModel = require("../../models/userMode");

// Mirrors savePushToken.js, but for the Apple PushKit VoIP token — a separate
// token from the regular FCM/APNs one, obtained via react-native-voip-push-notification
// on the client. Only ever populated on iOS (Android has no VoIP-push equivalent;
// it uses the regular high-priority FCM push, already covered by fcmToken).
const saveVoipPushToken = async (req, res) => {
  try {
    const { voipToken } = req.body;
    const userId = req.user?._id || req.user?.id || req.body.userId;

    if (!voipToken) {
      return res.status(400).json({
        success: false,
        message: "VoIP token is required",
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
      { voipPushToken: voipToken },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log(`✅ VoIP Push Token successfully saved for User (${userId})`);

    return res.status(200).json({
      success: true,
      message: "VoIP token saved successfully",
    });
  } catch (error) {
    console.error("Error in saveVoipPushToken:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save VoIP token",
    });
  }
};

module.exports = saveVoipPushToken;

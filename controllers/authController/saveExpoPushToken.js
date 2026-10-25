const userModel = require("../../models/userMode");
const { isValidExpoToken } = require("../../services/expoPushService");

// POST /auth/save-expo-push-token  { token: "ExponentPushToken[...]" }
// Stored separately from fcmToken (savePushToken.js) — see
// services/expoPushService.js for how chat picks between the two.
const saveExpoPushToken = async (req, res) => {
  try {
    const { token } = req.body || {};
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized: User ID not found" });
    }
    if (!(await isValidExpoToken(token))) {
      return res.status(400).json({ success: false, message: "A valid Expo push token is required" });
    }

    // A physical device that switched accounts must stop receiving the
    // previous account's pushes, so release this token from anyone else.
    await userModel.updateMany(
      { expoPushToken: token, _id: { $ne: userId } },
      { $set: { expoPushToken: null } },
    );
    const updated = await userModel.findByIdAndUpdate(userId, { expoPushToken: token }, { new: true });
    if (!updated) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, message: "Expo push token saved successfully" });
  } catch (error) {
    console.error("Error in saveExpoPushToken:", error);
    return res.status(500).json({ success: false, message: "Failed to save Expo push token" });
  }
};

module.exports = saveExpoPushToken;

const express = require("express");
const router = express.Router();
const userController = require("../controllers/accountController/userController");
const preferences = require("../controllers/accountController/preferencesController");
const { protect } = require("../middlewares/authMiddleware");

router.get("/profile", protect, userController.getUserProfile);
router.put("/profile", protect, userController.updatePersonalInfo);
router.put("/profile-picture", protect, userController.updateProfilePicture);
router.put("/change-password", protect, userController.changePassword);

// 2-Step Email Change
router.post(
  "/request-email-change",
  protect,
  userController.requestEmailChange,
);
router.post(
  "/resend-email-change-otp",
  protect,
  userController.resendEmailChangeOtp,
);
router.post("/verify-email-change", protect, userController.verifyEmailChange);

// Notification preferences + quiet hours, and blocked users (Profile screens)
router.get("/preferences", protect, preferences.getPreferences);
router.put("/preferences", protect, preferences.updatePreferences);
router.get("/blocked", protect, preferences.listBlocked);
router.post("/block/:userId", protect, preferences.blockUser);
router.delete("/block/:userId", protect, preferences.unblockUser);

// Account Deletion
router.delete("/delete-account", protect, userController.deleteAccount);

module.exports = router;

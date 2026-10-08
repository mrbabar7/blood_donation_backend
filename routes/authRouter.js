const express = require("express");
const jwt = require("jsonwebtoken");
const JWT_SECRET = require("../config/jwtSecret");
const userModel = require("../models/userMode");
const login = require("../controllers/authController/logIn");
const signUp = require("../controllers/authController/signUp");
const savePushToken = require("../controllers/authController/savePushToken");
const saveVoipPushToken = require("../controllers/authController/saveVoipPushToken");
const saveExpoPushToken = require("../controllers/authController/saveExpoPushToken");
const { protect } = require("../middlewares/authMiddleware");
const {
  verifyOTP,
  resendOTP,
} = require("../controllers/authController/otpVarify");
const {
  forgotPassword,
  resetPassword,
} = require("../controllers/authController/forgotPassword");
const {
  validateSignup,
  validateLogin,
} = require("../middlewares/authValidation");
const handleContactInquiry = require("../controllers/donor&seekerController/handleContactInquiry");
const { requestPhoneOtp, verifyPhoneOtp } = require("../controllers/authController/phoneAuthController");
const router = express.Router();

router.get("/verify", async (req, res) => {
  try {
    console.log("Auth Verify Hit");
    const token = req.cookies.token;
    if (!token)
      return res.status(401).json({ success: false, message: "No Token" });

    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await userModel.findById(decoded.id);

    if (!user || user.token !== token) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid Session" });
    }

    res.status(200).json({
      success: true,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    res.clearCookie("token", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
    });
    res.status(401).json({ success: false, message: "Auth Failed" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const token = req.cookies.token;
    if (token) {
      const decoded = jwt.decode(token);
      if (decoded && decoded.id) {
        await userModel.findByIdAndUpdate(decoded.id, { token: null });
      }
    }

    res.clearCookie("token", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });

    return res
      .status(200)
      .json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout Error:", err);
    return res.status(500).json({ success: false, message: "Logout failed" });
  }
});

router.post("/signup", validateSignup, signUp);
router.post("/verify-otp", verifyOTP);
router.post("/resend-otp", resendOTP);
router.post("/login", validateLogin, login);
router.post("/forgot-password", forgotPassword);
router.post("/save-push-token", protect, savePushToken);
router.post("/save-voip-token", protect, saveVoipPushToken);
router.post("/save-expo-push-token", protect, saveExpoPushToken);
router.post("/reset-password", resetPassword);
router.post("/phone/request-otp", requestPhoneOtp);
router.post("/phone/verify-otp", verifyPhoneOtp);
router.post("/contact", handleContactInquiry);

module.exports = router;

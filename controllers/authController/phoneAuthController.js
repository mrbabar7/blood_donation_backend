const jwt = require("jsonwebtoken");
const JWT_SECRET = require("../../config/jwtSecret");
const userModel = require("../../models/userMode");
const smsService = require("../../utils/smsService");
const { localize } = require("../../utils/localizedMessages");

// Basic E.164-ish sanity check — real validation happens on Twilio's side.
function isValidPhone(phone) {
  return typeof phone === "string" && /^\+?[1-9]\d{7,14}$/.test(phone.replace(/[\s-]/g, ""));
}

// POST /auth/phone/request-otp
exports.requestPhoneOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: localize(req, "enterValidPhone") });
    }

    await smsService.sendOtp(phone);
    res.status(200).json({ success: true, message: localize(req, "smsCodeSent") });
  } catch (error) {
    if (error.notConfigured) {
      return res.status(501).json({ success: false, message: error.message });
    }
    console.error("Twilio send OTP error:", error.message);
    res.status(500).json({ success: false, message: localize(req, "couldntSendSmsCode") });
  }
};

// POST /auth/phone/verify-otp — finds or creates a User by phone number, then
// signs them in exactly like email login (same JWT shape, same client contract).
exports.verifyPhoneOtp = async (req, res) => {
  try {
    const { phone, otp, name } = req.body;
    if (!isValidPhone(phone) || !otp) {
      return res.status(400).json({ success: false, message: localize(req, "phoneAndCodeRequired") });
    }

    const approved = await smsService.checkOtp(phone, otp);
    if (!approved) {
      return res.status(401).json({ success: false, message: localize(req, "incorrectOrExpiredCode") });
    }

    let user = await userModel.findOne({ phone });
    let isNewUser = false;

    if (!user) {
      // First time signing in with this number — create a phone-only account.
      // No email is collected here; anything in the app that emails the user
      // (contact replies, receipts) won't apply until they add one later.
      user = await userModel.create({
        name: name || "New User",
        phone,
        isVerified: true,
      });
      isNewUser = true;
    }

    const token = jwt.sign({ id: user._id, phone: user.phone }, JWT_SECRET, {
      expiresIn: "24h",
    });
    user.token = token;
    user.isOnline = true;
    await user.save();

    res.status(200).json({
      success: true,
      token,
      user: { userId: user._id, name: user.name, email: user.email || "", phone: user.phone },
      isNewUser,
    });
  } catch (error) {
    if (error.notConfigured) {
      return res.status(501).json({ success: false, message: error.message });
    }
    console.error("Twilio verify OTP error:", error.message);
    res.status(500).json({ success: false, message: localize(req, "couldntVerifyCode") });
  }
};

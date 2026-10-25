const bcrypt = require("bcrypt");
const userModel = require("../../models/userMode");
const { createNotification } = require("../notificationController");
const { revokeAllForUser } = require("../../utils/sessionService");
const { sendingEmail } = require("../../email-sender/emailService");
const { APP_NAME } = require("../../email-sender/brand");
const {
  renderOtpEmail,
} = require("../../email-sender/otpVerificationEmailTemplate");
const { langFor, rememberLang, sendTemplate, sendToUser } = require("../../email-sender/mailer");

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await userModel.findOne({ email });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "No account found with this email" });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 Minutes
    await user.save();

    const { subject: otpSubject, html } = renderOtpEmail({
      purpose: "reset",
      name: user.name,
      code: otp,
      lang: langFor(user, req),
    });

    await sendingEmail(email, otpSubject, html);

    // Pass the email back so Expo can store it in state for the next step
    res.status(200).json({
      success: true,
      message: "Reset OTP sent to your email",
      email: email,
    });
  } catch (err) {
    console.error("Forgot Password Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await userModel.findOne({ email });

    // Validate User and OTP
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (user.otp !== otp) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid OTP code" });
    }

    if (new Date() > user.otpExpires) {
      return res
        .status(400)
        .json({ success: false, message: "OTP has expired" });
    }

    // Securely hash the new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Clear OTP fields and any existing session tokens
    user.otp = undefined;
    user.otpExpires = undefined;
    user.token = undefined; // Legacy single-token field

    await user.save();
    // Force logout everywhere: revokes every refresh-token session.
    await revokeAllForUser(user._id, "password_reset");

    sendTemplate(user.email, "passwordChanged", { name: user.name, via: "reset", when: new Date() }, langFor(user, req));
    createNotification({
      userId: user._id,
      title: "Password changed",
      message: "Your password was reset and all devices were signed out. If this wasn't you, reset your password right away and contact support.",
      link: "/(tabs)/profile",
      critical: true,
      emailCopy: false,
    });

    res.status(200).json({
      success: true,
      message:
        "Password updated successfully! Please login with your new password.",
    });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { forgotPassword, resetPassword };

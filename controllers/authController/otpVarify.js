const { sendingEmail } = require("../../email-sender/emailService");
const { APP_NAME } = require("../../email-sender/brand");
const {
  useTemplate,
} = require("../../email-sender/otpVerificationEmailTemplate");
const userModel = require("../../models/userMode");
const jwt = require("jsonwebtoken");
const JWT_SECRET = require("../../config/jwtSecret");
const { localize } = require("../../utils/localizedMessages");

const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await userModel.findOne({ email });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: localize(req, "userNotFound") });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: localize(req, "invalidOtp") });
    }

    if (new Date() > user.otpExpires) {
      return res.status(400).json({ success: false, message: localize(req, "otpExpired") });
    }

    // Update User Status
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;

    // Generate Token
    const jwtToken = jwt.sign(
      { email: user.email, id: user._id, _id: user._id },
      JWT_SECRET,
      { expiresIn: "24h" }, // Consistent with login.js
    );

    // Optional: Save token if tracking active sessions
    user.token = jwtToken;
    await user.save();

    // 1. Keep cookie for background compatibility
    res.cookie("token", jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000,
    });

    // 2. Return JSON with the token for Mobile SecureStore
    res.status(200).json({
      success: true,
      message: localize(req, "accountVerifiedSuccess"),
      token: jwtToken, // <--- CRITICAL FOR EXPO
      user: {
        userId: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("Verify Error:", err);
    res
      .status(500)
      .json({ success: false, message: localize(req, "serverErrorVerification") });
  }
};

const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await userModel.findOne({ email });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: localize(req, "userNotFound") });
    }

    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = newOtp;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    const subject = `🩸 ${APP_NAME} – New Verification Code`;
    const htmlContent = useTemplate
      .replace("{name}", user.name)
      .replace("{verificationCode}", newOtp);

    await sendingEmail(email, subject, htmlContent);

    res
      .status(200)
      .json({ success: true, message: localize(req, "newOtpSent") });
  } catch (err) {
    console.error("Resend Error:", err);
    res
      .status(500)
      .json({ success: false, message: localize(req, "serverErrorResend") });
  }
};

module.exports = { verifyOTP, resendOTP };

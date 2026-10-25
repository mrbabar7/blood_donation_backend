const { sendingEmail } = require("../../email-sender/emailService");
const { APP_NAME } = require("../../email-sender/brand");
const {
  renderOtpEmail,
} = require("../../email-sender/otpVerificationEmailTemplate");
const { langFor, rememberLang, sendTemplate, sendToUser } = require("../../email-sender/mailer");
const userModel = require("../../models/userMode");
const { createNotification } = require("../notificationController");
const { startSession } = require("../../utils/sessionService");
const { ACCESS_TOKEN_TTL_MS } = require("../../config/sessionPolicy");
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

    await user.save();

    // Welcome email (fire-and-forget — never blocks or breaks verification).
    rememberLang(user, req);
    sendTemplate(user.email, "welcome", { name: user.name }, langFor(user, req));
    createNotification({
      userId: user._id,
      title: "Welcome to Blood Donation",
      message: "Your account is verified and ready. Find donors, post an emergency request, or register as a donor to help save lives.",
      link: "/(tabs)/home",
      emailCopy: false,
    });

    // Session + tokens (same policy as login.js)
    const session = await startSession(user, req, { email: user.email, id: user._id, _id: user._id });

    // 1. Keep cookie for background compatibility
    res.cookie("token", session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: ACCESS_TOKEN_TTL_MS,
    });

    // 2. Return JSON with the token for Mobile SecureStore
    res.status(200).json({
      success: true,
      message: localize(req, "accountVerifiedSuccess"),
      token: session.token, // <--- CRITICAL FOR EXPO (access token)
      refreshToken: session.refreshToken,
      sessionExpiresAt: session.sessionExpiresAt,
      user: {
        userId: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture || "",
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

    const { subject, html: htmlContent } = renderOtpEmail({
      purpose: "resend",
      name: user.name,
      code: newOtp,
      lang: langFor(user, req),
    });

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

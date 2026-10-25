const bcrypt = require("bcrypt");
const { startSession } = require("../../utils/sessionService");
const { ACCESS_TOKEN_TTL_MS } = require("../../config/sessionPolicy");
const userModel = require("../../models/userMode");
const { sendingEmail } = require("../../email-sender/emailService");
const { APP_NAME } = require("../../email-sender/brand");
const {
  renderOtpEmail,
} = require("../../email-sender/otpVerificationEmailTemplate");
const { langFor, rememberLang, sendLoginAlert, sendTemplate, sendToUser } = require("../../email-sender/mailer");
const { localize } = require("../../utils/localizedMessages");

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await userModel.findOne({ email });

    // 1. User existence check
    if (!user) {
      return res
        .status(403)
        .json({ success: false, field: "email", message: localize(req, "emailNotFound") });
    }

    // 2. Google User check
    if (!user.password && user.googleId) {
      return res.status(401).json({
        success: false,
        field: "email",
        message: localize(req, "useGoogleToLogin"),
        isGoogleUser: true,
      });
    }

    // 3. Verification check (Sending OTP)
    if (!user.isVerified) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      user.otp = otp;
      user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
      await user.save();

      const { subject: otpSubject, html: htmlContent } = renderOtpEmail({
        purpose: "verify",
        name: user.name,
        code: otp,
        lang: langFor(user, req),
      });

      await sendingEmail(user.email, otpSubject, htmlContent);

      return res.status(401).json({
        success: false,
        message: localize(req, "emailNotVerifiedOtpSent"),
        notVerified: true,
      });
    }

    // 4. Password check
    const isPassEqual = await bcrypt.compare(password, user.password);
    if (!isPassEqual) {
      return res.status(403).json({
        success: false,
        field: "password",
        message: localize(req, "invalidPassword"),
      });
    }

    rememberLang(user, req);
    sendLoginAlert(user, req, "password");

    // 5. Session + tokens (access JWT + rotating refresh token, 30-day cap —
    // see config/sessionPolicy.js)
    const session = await startSession(user, req, { email: user.email, id: user._id });
    res.cookie("token", session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: ACCESS_TOKEN_TTL_MS,
      path: "/",
    });
    res.status(200).json({
      success: true,
      message: localize(req, "loginSuccess"),
      token: session.token, // <--- EXPO NEEDS THIS (access token)
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
    console.error("Login Error:", err);
    res.status(500).json({ success: false, message: localize(req, "internalServerError") });
  }
};

module.exports = login;

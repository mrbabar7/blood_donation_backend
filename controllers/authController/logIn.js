const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const JWT_SECRET = require("../../config/jwtSecret");
const userModel = require("../../models/userMode");
const { sendingEmail } = require("../../email-sender/emailService");
const { APP_NAME } = require("../../email-sender/brand");
const {
  useTemplate,
} = require("../../email-sender/otpVerificationEmailTemplate");
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

      const htmlContent = useTemplate
        .replace("{name}", user.name)
        .replace("{verificationCode}", otp);

      await sendingEmail(
        user.email,
        `🩸 ${APP_NAME} – Verify Your Account`,
        htmlContent,
      );

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

    // 5. JWT Generation
    const jwtToken = jwt.sign(
      { email: user.email, id: user._id },
      JWT_SECRET,
      { expiresIn: "24h" },
    );
    user.token = jwtToken;
    await user.save();
    res.cookie("token", jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    });
    res.status(200).json({
      success: true,
      message: localize(req, "loginSuccess"),
      token: jwtToken, // <--- EXPO NEEDS THIS
      user: {
        userId: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ success: false, message: localize(req, "internalServerError") });
  }
};

module.exports = login;

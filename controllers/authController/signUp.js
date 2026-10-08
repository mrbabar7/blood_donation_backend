const bcrypt = require("bcrypt");
const userModel = require("../../models/userMode");
const { sendingEmail } = require("../../email-sender/emailService");
const { APP_NAME } = require("../../email-sender/brand");
const {
  useTemplate,
} = require("../../email-sender/otpVerificationEmailTemplate");
const { localize } = require("../../utils/localizedMessages");

const signUp = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    // 1. Validation Check
    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        field: "email",
        message: localize(req, "userAlreadyExists"),
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        field: "password",
        message: localize(req, "passwordTooShort"),
      });
    }

    // 2. Security: Hash Password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. OTP Generation (5-minute expiry)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

    // 4. Create User (Unverified Status)
    await userModel.create({
      name,
      email,
      password: hashedPassword,
      otp,
      otpExpires,
      isVerified: false, // Explicitly set false until OTP is verified
    });

    // 5. Email Service
    const subject = `🩸 ${APP_NAME} – Verify Your Account`;
    const htmlContent = useTemplate
      .replace("{name}", name)
      .replace("{verificationCode}", otp);

    await sendingEmail(email, subject, htmlContent);

    // 6. Response for Expo
    // We return the email so the app can use it in the 'Verify OTP' fetch call
    res.status(201).json({
      success: true,
      message: localize(req, "signupSuccessOtpSent"),
      user: {
        name,
        email, // Expo will need this for the next screen
      },
    });
  } catch (err) {
    console.error("SignUp Error:", err);
    res.status(500).json({
      success: false,
      message: localize(req, "serverErrorSignup"),
    });
  }
};

module.exports = signUp;

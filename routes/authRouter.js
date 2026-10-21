const express = require("express");
const jwt = require("jsonwebtoken");
const JWT_SECRET = require("../config/jwtSecret");
const {
  authenticateAccessToken,
  extractAccessToken,
  rotateRefreshToken,
  completeHandoff,
  revokeSession,
  revokeByRefreshToken,
} = require("../utils/sessionService");
const { ACCESS_TOKEN_TTL_MS } = require("../config/sessionPolicy");
const userModel = require("../models/userMode");
const { rateLimit, identifierKey } = require("../middlewares/rateLimitMiddleware");
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

// Session status. Accepts the Bearer header (mobile) or the cookie (web), and
// is the call the app uses to confirm a stored session is still valid before
// trusting it (app start). Response is a superset of the old
// one: `user` is unchanged, `session` is new.
router.get("/verify", async (req, res) => {
  try {
    const token = extractAccessToken(req);
    if (!token)
      return res.status(401).json({ success: false, code: "NO_TOKEN", message: "No Token" });

    const result = await authenticateAccessToken(token);
    if (!result.ok) {
      res.clearCookie("token", { httpOnly: true, secure: true, sameSite: "none" });
      return res
        .status(401)
        .json({ success: false, code: result.code, message: result.message });
    }

    const { user, session } = result;
    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        userId: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture || "",
      },
      session: session
        ? { id: session._id, expiresAt: session.expiresAt }
        : { id: null, expiresAt: null, legacy: true },
    });
  } catch (err) {
    res.status(401).json({ success: false, code: "TOKEN_INVALID", message: "Auth Failed" });
  }
});

// Exchanges a valid refresh token for a new access token and a ROTATED refresh
// token. The old refresh token stops working (replaying it revokes the whole
// session). The session's 30-day expiry is fixed and is never extended here.
router.post("/refresh", rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
  try {
    const result = await rotateRefreshToken(req.body?.refreshToken, req);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, code: result.code, message: "Session expired. Please log in again." });
    }
    res.cookie("token", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: ACCESS_TOKEN_TTL_MS,
      path: "/",
    });
    res.status(200).json({
      success: true,
      token: result.token,
      refreshToken: result.refreshToken,
      accessExpiresAt: result.accessExpiresAt,
      sessionExpiresAt: result.sessionExpiresAt,
    });
  } catch (err) {
    console.error("Refresh Error:", err.message);
    res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Could not refresh session" });
  }
});

// Mobile Google sign-in: the OAuth redirect carries a one-time code (see
// routes/googleSignup.js); this swaps it for the real tokens.
router.post("/google/exchange", rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
  try {
    const result = await completeHandoff(req.body?.code, req);
    if (!result) {
      return res.status(401).json({ success: false, code: "HANDOFF_INVALID", message: "Sign-in link expired. Please try again." });
    }
    const { user } = result;
    res.status(200).json({
      success: true,
      token: result.token,
      refreshToken: result.refreshToken,
      sessionExpiresAt: result.sessionExpiresAt,
      user: {
        userId: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture || "",
      },
    });
  } catch (err) {
    console.error("Google exchange error:", err.message);
    res.status(500).json({ success: false, message: "Could not complete sign-in" });
  }
});

// Revokes the server-side session. Works for mobile (Bearer and/or the
// refreshToken in the body — the latter still works after the access token has
// expired) and for the web cookie. The old version only read the cookie, so a
// mobile logout never revoked anything on the server.
router.post("/logout", async (req, res) => {
  try {
    const token = extractAccessToken(req);
    if (token) {
      // Signature must be valid, but an expired token may still revoke itself.
      let decoded = null;
      try {
        decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
      } catch (e) {}
      if (decoded?.sid) {
        await revokeSession(decoded.sid, "logout");
      } else if (decoded?.id) {
        // Legacy (pre-session) token.
        await userModel.updateOne({ _id: decoded.id, token }, { $set: { token: null } });
      }
    }
    if (req.body?.refreshToken) await revokeByRefreshToken(req.body.refreshToken);

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

// Abuse protection for the open (pre-login) endpoints. Two layers on purpose:
//  - per IP is GENEROUS, because many mobile users share one carrier-NAT address;
//  - per identifier (email / phone) is what actually stops OTP brute-forcing, password
//    guessing, and SMS/email-cost abuse against one account.
const TEN_MIN = 10 * 60 * 1000;
const byEmail = identifierKey("email");
const byPhone = identifierKey("phone");
const ipLimit = (max, windowMs = 60_000) => rateLimit({ windowMs, max });
const idLimit = (keyFn, max, windowMs, name) => rateLimit({ windowMs, max, keyFn, name });

router.post("/signup", ipLimit(60, TEN_MIN), idLimit(byEmail, 10, 60 * 60 * 1000, "signup:id"), validateSignup, signUp);
router.post("/verify-otp", ipLimit(120, TEN_MIN), idLimit(byEmail, 10, TEN_MIN, "verify-otp:id"), verifyOTP);
router.post("/resend-otp", ipLimit(60, TEN_MIN), idLimit(byEmail, 5, TEN_MIN, "resend-otp:id"), resendOTP);
router.post("/login", ipLimit(300, TEN_MIN), idLimit(byEmail, 10, 15 * 60 * 1000, "login:id"), validateLogin, login);
router.post("/forgot-password", ipLimit(60, TEN_MIN), idLimit(byEmail, 5, TEN_MIN, "forgot-password:id"), forgotPassword);
router.post("/save-push-token", protect, savePushToken);
router.post("/save-voip-token", protect, saveVoipPushToken);
router.post("/save-expo-push-token", protect, saveExpoPushToken);
router.post("/reset-password", ipLimit(120, TEN_MIN), idLimit(byEmail, 10, TEN_MIN, "reset-password:id"), resetPassword);
router.post("/phone/request-otp", ipLimit(60, TEN_MIN), idLimit(byPhone, 5, TEN_MIN, "phone-otp:id"), requestPhoneOtp);
router.post("/phone/verify-otp", ipLimit(120, TEN_MIN), idLimit(byPhone, 10, TEN_MIN, "phone-verify:id"), verifyPhoneOtp);
router.post("/contact", handleContactInquiry);

module.exports = router;

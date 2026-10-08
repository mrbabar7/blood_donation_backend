const express = require("express");
const passport = require("passport");
const jwt = require("jsonwebtoken");
const JWT_SECRET = require("../config/jwtSecret");
const router = express.Router();
const dotenv = require("dotenv");
dotenv.config();

// 1. Initiate Google Login
router.get("/google", (req, res, next) => {
  const platform = req.query.platform || "web";
  const redirectUri = req.query.redirect_uri || ""; // Get dynamic redirect_uri from mobile app

  passport.authenticate("google", {
    scope: ["profile", "email"],
    state: JSON.stringify({ platform, redirectUri }), // Store in state parameter
  })(req, res, next);
});

// 2. Google OAuth Callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
    session: false,
  }),
  async (req, res) => {
    try {
      const user = req.user;

      let platform = "web";
      let clientRedirectUri = "";

      try {
        if (req.query.state) {
          const parsedState = JSON.parse(req.query.state);
          platform = parsedState.platform || "web";
          clientRedirectUri = parsedState.redirectUri || "";
        }
      } catch (e) {
        console.log("State parsing failed, default to web");
      }

      // Generate JWT Token
      const jwtToken = jwt.sign(
        { email: user.email, id: user._id },
        JWT_SECRET,
        { expiresIn: "24h" },
      );

      user.token = jwtToken;
      await user.save();

      // IF MOBILE APP
      if (platform === "mobile") {
        const userDataStr = encodeURIComponent(
          JSON.stringify({
            _id: user._id,
            name: user.name,
            email: user.email,
            profilePicture: user.profilePicture,
            isVerified: user.isVerified,
          }),
        );

        // Fall back to scheme if clientRedirectUri is missing
        const targetUrl = clientRedirectUri || "a://google-auth-success";
        const separator = targetUrl.includes("?") ? "&" : "?";

        // Dynamic redirect back to Expo Go / Custom Scheme!
        return res.redirect(
          `${targetUrl}${separator}token=${jwtToken}&user=${userDataStr}`,
        );
      }

      // IF WEB APP
      res.cookie("token", jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "none",
        maxAge: 24 * 60 * 60 * 1000,
        path: "/",
      });

      const frontendURL =
        process.env.NODE_ENV === "production"
          ? process.env.PUBLIC_WEB_URL || "https://app.example.com"
          : "http://localhost:5173";

      return res.redirect(`${frontendURL}/google-auth-success`);
    } catch (err) {
      console.error("OAuth Error:", err);
      res.redirect(`${process.env.PUBLIC_WEB_URL || "http://localhost:5173"}/login?error=failed`);
    }
  },
);

module.exports = router;

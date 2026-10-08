const jwt = require("jsonwebtoken");
const JWT_SECRET = require("../config/jwtSecret");
const userModel = require("../models/userMode");

const protect = async (req, res, next) => {
  let token;

  // 1. CHECK HEADERS (Standard for Mobile/Expo)
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }
  // 2. CHECK COOKIES (Fallback)
  else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res
      .status(401)
      .json({
        success: false,
        message: "No token found, authorization denied",
      });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await userModel.findById(decoded.id);

    // Verify user exists and the token matches what is stored in DB
    if (!user || user.token !== token) {
      // If it's a browser, clear the cookie
      if (req.cookies && req.cookies.token) res.clearCookie("token");

      return res
        .status(401)
        .json({ success: false, message: "Session invalid or expired" });
    }

    req.user = user;
    next();
  } catch (error) {
    if (req.cookies && req.cookies.token) res.clearCookie("token");
    return res
      .status(401)
      .json({ success: false, message: "Token is not valid" });
  }
};

const optionalProtect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await userModel.findById(decoded.id);

    if (!user || user.token !== token) {
      req.user = null;
    } else {
      req.user = user; // Set the full user object
    }
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

module.exports = { protect, optionalProtect };

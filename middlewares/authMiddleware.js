const { authenticateAccessToken } = require("../utils/sessionService");

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
    // The backend is authoritative: signature + server-side session row
    // (not revoked, not past its 30-day cap). `code` lets the app tell
    // "refresh me" (TOKEN_EXPIRED) from "log in again" apart.
    const result = await authenticateAccessToken(token);

    if (!result.ok) {
      // If it's a browser, clear the cookie
      if (req.cookies && req.cookies.token) res.clearCookie("token");
      return res
        .status(401)
        .json({ success: false, code: result.code, message: result.message });
    }

    req.user = result.user;
    req.sessionId = result.session ? String(result.session._id) : null;
    next();
  } catch (error) {
    if (req.cookies && req.cookies.token) res.clearCookie("token");
    return res
      .status(401)
      .json({ success: false, code: "TOKEN_INVALID", message: "Token is not valid" });
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
    const result = await authenticateAccessToken(token);
    if (!result.ok) {
      req.user = null;
    } else {
      req.user = result.user; // Set the full user object
      req.sessionId = result.session ? String(result.session._id) : null;
    }
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

module.exports = { protect, optionalProtect };

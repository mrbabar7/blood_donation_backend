// Server-side session lifecycle: creating sessions, issuing/validating access
// tokens, rotating refresh tokens and revoking. Every login method (email,
// OTP-verify, phone, Google) goes through startSession()/completeHandoff() so
// there is exactly ONE token strategy. Pure decisions live in
// utils/refreshTokenLogic.js.
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const JWT_SECRET = require("../config/jwtSecret");
const Session = require("../models/sessionModel");
const userModel = require("../models/userMode");
const policy = require("../config/sessionPolicy");
const {
  hashSecret,
  newOpaqueSecret,
  formatRefreshToken,
  parseRefreshToken,
  safeEqualHex,
  evaluateRefresh,
} = require("./refreshTokenLogic");

function clientMeta(req) {
  return {
    userAgent: String(req?.headers?.["user-agent"] || "").slice(0, 300),
    ip: String(req?.ip || "").slice(0, 64),
  };
}

// Access-token lifetime, never outliving the session itself.
function accessLifetimeSeconds(sessionExpiresAt, now = Date.now()) {
  const remaining = new Date(sessionExpiresAt).getTime() - now;
  return Math.max(1, Math.floor(Math.min(policy.ACCESS_TOKEN_TTL_MS, remaining) / 1000));
}

function signAccessToken(claims, sessionId, sessionExpiresAt) {
  const seconds = accessLifetimeSeconds(sessionExpiresAt);
  return {
    token: jwt.sign({ ...claims, sid: String(sessionId) }, JWT_SECRET, { expiresIn: seconds }),
    accessExpiresAt: new Date(Date.now() + seconds * 1000),
  };
}

// Same claim shapes the old per-controller jwt.sign() calls used.
function claimsFor(user) {
  const claims = { id: user._id };
  if (user.email) claims.email = user.email;
  else if (user.phone) claims.phone = user.phone;
  return claims;
}

function tokenBundle({ token, accessExpiresAt, refreshToken, sessionExpiresAt }) {
  return {
    token,
    refreshToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    sessionExpiresAt: new Date(sessionExpiresAt).toISOString(),
  };
}

/** New login -> new session + access token + refresh token. */
async function startSession(user, req, claims = claimsFor(user)) {
  const sessionId = new mongoose.Types.ObjectId();
  const secret = newOpaqueSecret();
  const sessionExpiresAt = new Date(Date.now() + policy.SESSION_MAX_AGE_MS);
  await Session.create({
    _id: sessionId,
    userId: user._id,
    refreshTokenHash: hashSecret(secret),
    expiresAt: sessionExpiresAt,
    ...clientMeta(req),
  });
  const { token, accessExpiresAt } = signAccessToken(claims, sessionId, sessionExpiresAt);
  return tokenBundle({
    token,
    accessExpiresAt,
    refreshToken: formatRefreshToken(sessionId, secret),
    sessionExpiresAt,
  });
}

/** Google (mobile): park a pending session, return a one-time code. */
async function startPendingSession(user, req) {
  const code = newOpaqueSecret();
  await Session.create({
    userId: user._id,
    refreshTokenHash: null,
    handoffHash: hashSecret(code),
    handoffExpiresAt: new Date(Date.now() + policy.HANDOFF_TTL_MS),
    // Provisional; reset to now + 30d when the code is exchanged.
    expiresAt: new Date(Date.now() + policy.HANDOFF_TTL_MS),
    ...clientMeta(req),
  });
  return code;
}

/** Exchange the one-time code for real tokens. Atomic => single use. */
async function completeHandoff(code, req) {
  if (typeof code !== "string" || code.length < 20 || code.length > 200) return null;
  const now = new Date();
  const sessionExpiresAt = new Date(now.getTime() + policy.SESSION_MAX_AGE_MS);
  const secret = newOpaqueSecret();
  const session = await Session.findOneAndUpdate(
    { handoffHash: hashSecret(code), handoffExpiresAt: { $gt: now }, refreshTokenHash: null, revokedAt: null },
    {
      $set: { refreshTokenHash: hashSecret(secret), expiresAt: sessionExpiresAt, lastUsedAt: now, ...clientMeta(req) },
      $unset: { handoffHash: "", handoffExpiresAt: "" },
    },
    { new: true },
  );
  if (!session) return null;
  const user = await userModel.findById(session.userId);
  if (!user) {
    await revokeSession(session._id, "user_missing");
    return null;
  }
  const { token, accessExpiresAt } = signAccessToken(claimsFor(user), session._id, sessionExpiresAt);
  return {
    user,
    ...tokenBundle({
      token,
      accessExpiresAt,
      refreshToken: formatRefreshToken(session._id, secret),
      sessionExpiresAt,
    }),
  };
}

/**
 * Validate an access token against the database. The backend is authoritative:
 * the JWT signature alone is never enough.
 * -> { ok: true, user, session|null } | { ok: false, code, message }
 * Codes: TOKEN_EXPIRED (client should refresh), TOKEN_INVALID,
 *        SESSION_EXPIRED / SESSION_REVOKED (client must log in again).
 */
async function authenticateAccessToken(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return err?.name === "TokenExpiredError"
      ? { ok: false, code: "TOKEN_EXPIRED", message: "Access token expired" }
      : { ok: false, code: "TOKEN_INVALID", message: "Token is not valid" };
  }

  if (decoded.sid) {
    if (!mongoose.isValidObjectId(decoded.sid) || !decoded.id) {
      return { ok: false, code: "TOKEN_INVALID", message: "Token is not valid" };
    }
    const [session, user] = await Promise.all([
      Session.findById(decoded.sid).select("userId expiresAt revokedAt refreshTokenHash"),
      userModel.findById(decoded.id),
    ]);
    if (!session || !user || String(session.userId) !== String(user._id) || session.revokedAt) {
      return { ok: false, code: "SESSION_REVOKED", message: "Session invalid or expired" };
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      return { ok: false, code: "SESSION_EXPIRED", message: "Session expired" };
    }
    return { ok: true, user, session };
  }

  // Legacy 24h tokens issued before this change (no `sid`): keep honouring
  // them until they expire naturally; they die within 24h of deployment.
  const user = decoded.id ? await userModel.findById(decoded.id) : null;
  if (!user || user.token !== token) {
    return { ok: false, code: "SESSION_REVOKED", message: "Session invalid or expired" };
  }
  return { ok: true, user, session: null };
}

async function revokeSession(sessionId, reason = "logout") {
  if (!mongoose.isValidObjectId(sessionId)) return;
  await Session.updateOne(
    { _id: sessionId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

/** Revoke every live session of a user (optionally keeping one) + legacy token. */
async function revokeAllForUser(userId, reason, exceptSessionId = null, { clearLegacy = true } = {}) {
  const filter = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  await Session.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
  if (clearLegacy && !exceptSessionId) await userModel.updateOne({ _id: userId }, { $set: { token: null } });
}

/** Delete all sessions of a deleted account. */
async function purgeUserSessions(userId) {
  await Session.deleteMany({ userId });
}

/**
 * Exchange a refresh token for a new access token + rotated refresh token.
 * -> { ok: true, ...bundle, user } | { ok: false, status, code }
 */
async function rotateRefreshToken(refreshToken, req) {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return { ok: false, status: 401, code: "REFRESH_INVALID" };

  const session = await Session.findById(parsed.sid);
  const verdict = evaluateRefresh(session, parsed.secret, new Date(), policy.REFRESH_REUSE_GRACE_MS);

  if (!verdict.ok) {
    if (verdict.reason === "reuse") await revokeSession(session._id, "refresh_token_reuse");
    const code =
      verdict.reason === "expired" ? "SESSION_EXPIRED"
      : verdict.reason === "revoked" || verdict.reason === "reuse" ? "SESSION_REVOKED"
      : "REFRESH_INVALID";
    return { ok: false, status: 401, code };
  }

  const user = await userModel.findById(session.userId);
  if (!user) {
    await revokeSession(session._id, "user_missing");
    return { ok: false, status: 401, code: "SESSION_REVOKED" };
  }

  const newSecret = newOpaqueSecret();
  const now = new Date();
  // Optimistic concurrency: only rotate if nobody rotated since we read it.
  const updated = await Session.findOneAndUpdate(
    { _id: session._id, rotationCount: session.rotationCount, revokedAt: null },
    {
      $set: {
        refreshTokenHash: hashSecret(newSecret),
        previousRefreshTokenHash: session.refreshTokenHash,
        previousRotatedAt: now,
        lastUsedAt: now,
        ...clientMeta(req),
      },
      $inc: { rotationCount: 1 },
    },
    { new: true },
  );
  if (!updated) return { ok: false, status: 409, code: "REFRESH_CONFLICT" };

  const { token, accessExpiresAt } = signAccessToken(claimsFor(user), session._id, session.expiresAt);
  return {
    ok: true,
    user,
    ...tokenBundle({
      token,
      accessExpiresAt,
      refreshToken: formatRefreshToken(session._id, newSecret),
      sessionExpiresAt: session.expiresAt, // unchanged: never silently extended
    }),
  };
}

/** Logout helper: revoke by refresh token (proves possession) when given. */
async function revokeByRefreshToken(refreshToken) {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return false;
  const session = await Session.findById(parsed.sid).select("refreshTokenHash previousRefreshTokenHash");
  if (!session) return false;
  const h = hashSecret(parsed.secret);
  if (
    safeEqualHex(h, session.refreshTokenHash || "") ||
    safeEqualHex(h, session.previousRefreshTokenHash || "")
  ) {
    await revokeSession(session._id, "logout");
    return true;
  }
  return false;
}

// Reads the Bearer header, falling back to the web cookie (same order as the
// auth middleware).
function extractAccessToken(req) {
  const h = req.headers?.authorization;
  if (h && h.startsWith("Bearer")) return h.split(" ")[1];
  return req.cookies?.token || null;
}

module.exports = {
  startSession,
  startPendingSession,
  completeHandoff,
  authenticateAccessToken,
  rotateRefreshToken,
  revokeSession,
  revokeAllForUser,
  purgeUserSessions,
  revokeByRefreshToken,
  extractAccessToken,
  accessLifetimeSeconds,
};

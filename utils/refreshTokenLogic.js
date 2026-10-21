// Pure (no DB, no JWT) refresh-token helpers, so the security-critical
// decisions can be unit-tested in isolation (tests/sessionLogic.test.js).
const crypto = require("crypto");

const HEX24 = /^[a-f0-9]{24}$/i;

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

function newOpaqueSecret() {
  return crypto.randomBytes(48).toString("base64url");
}

// "<sessionId>.<secret>" — the id lets us find the session row directly while
// the secret proves possession.
function formatRefreshToken(sessionId, secret) {
  return `${sessionId}.${secret}`;
}

function parseRefreshToken(token) {
  if (typeof token !== "string" || token.length > 256) return null;
  const dot = token.indexOf(".");
  if (dot !== 24) return null;
  const sid = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!HEX24.test(sid) || secret.length < 40) return null;
  return { sid, secret };
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Decide whether a presented refresh secret may be exchanged.
 * Returns { ok: true, via: "current" | "previous" } or { ok: false, reason }.
 * reason "reuse" means a rotated-out token was replayed outside the grace
 * window: the caller must revoke the whole session.
 */
function evaluateRefresh(session, secret, now = new Date(), graceMs = 30000) {
  if (!session) return { ok: false, reason: "not_found" };
  if (session.revokedAt) return { ok: false, reason: "revoked" };
  if (!session.refreshTokenHash) return { ok: false, reason: "pending" };
  if (new Date(session.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  const presented = hashSecret(secret);
  if (safeEqualHex(presented, session.refreshTokenHash)) return { ok: true, via: "current" };

  if (session.previousRefreshTokenHash && safeEqualHex(presented, session.previousRefreshTokenHash)) {
    const rotatedAt = session.previousRotatedAt ? new Date(session.previousRotatedAt).getTime() : 0;
    if (now.getTime() - rotatedAt <= graceMs) return { ok: true, via: "previous" };
    return { ok: false, reason: "reuse" };
  }
  return { ok: false, reason: "mismatch" };
}

module.exports = {
  hashSecret,
  newOpaqueSecret,
  formatRefreshToken,
  parseRefreshToken,
  safeEqualHex,
  evaluateRefresh,
};

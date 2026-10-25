// Single source of truth for how long a login lasts.
//
// Model (replaces the old single 24h JWT stored in User.token):
//   - ACCESS token  : signed JWT, short/medium lived, sent as Bearer on every
//                     API call. Carries `sid` (the server-side session id).
//   - REFRESH token : opaque random secret ("<sid>.<secret>"), only its SHA-256
//                     hash is stored (models/sessionModel.js). Rotated on every
//                     use. Valid until the session's ABSOLUTE expiry.
//   - SESSION       : one row per login. `expiresAt` is fixed at creation
//                     (now + SESSION_MAX_AGE_DAYS) and is never extended.
//
// The previous 24h expiry came from `expiresIn: "24h"` hard-coded in
// logIn.js / otpVarify.js / phoneAuthController.js / googleSignup.js, with no
// refresh mechanism, so every user had to log in again after one day.

const DAY_MS = 24 * 60 * 60 * 1000;

// "7d" | "12h" | "30m" | "45s" | "3600" (seconds) -> milliseconds.
function parseDurationMs(value, fallbackMs) {
  if (typeof value === "number" && value > 0) return value * 1000;
  const m = /^(\d+)\s*([smhd])?$/i.exec(String(value || "").trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = (m[2] || "s").toLowerCase();
  const mult = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: DAY_MS }[unit];
  return n > 0 ? n * mult : fallbackMs;
}

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "7d";
const ACCESS_TOKEN_TTL_MS = parseDurationMs(ACCESS_TOKEN_TTL, 7 * DAY_MS);

const SESSION_MAX_AGE_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS) > 0
  ? Number(process.env.SESSION_MAX_AGE_DAYS)
  : 30;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * DAY_MS;

module.exports = {
  DAY_MS,
  parseDurationMs,
  ACCESS_TOKEN_TTL,
  ACCESS_TOKEN_TTL_MS,
  SESSION_MAX_AGE_DAYS,
  SESSION_MAX_AGE_MS,
  // A refresh response can be lost on a flaky mobile network after the server
  // already rotated. Re-presenting the PREVIOUS token inside this window is
  // treated as a retry; outside it, it is treated as token theft/replay and
  // the whole session is revoked.
  REFRESH_REUSE_GRACE_MS: 30 * 1000,
  // Google sign-in hands the app a one-time code (not the tokens) in the
  // redirect URL; the app exchanges it over HTTPS within this window.
  HANDOFF_TTL_MS: 2 * 60 * 1000,
};

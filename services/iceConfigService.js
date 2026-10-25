// ICE (STUN/TURN) servers handed to the app at call time.
//
// Why: the app used to ship ONE static TURN username/credential inside app.json (visible
// to anyone who unpacks the app, never expiring). This builds per-user, time-limited
// credentials instead, in the format coturn's `use-auth-secret` mode (and most hosted
// TURN services) understand:  username = "<expiryUnix>:<userId>",
// credential = base64(HMAC-SHA1(sharedSecret, username)).
//
// Env (all optional; with none set the app gets STUN only, exactly like before):
//   ICE_STUN_URLS              comma list, default stun:stun.l.google.com:19302
//   TURN_URLS                  comma list, e.g. turn:turn.example.com:3478?transport=udp,turns:turn.example.com:443?transport=tcp
//   TURN_STATIC_AUTH_SECRET    coturn static-auth-secret  -> ephemeral credentials (recommended)
//   TURN_CREDENTIAL_TTL_SEC    default 3600 (60..86400)
//   TURN_USERNAME / TURN_CREDENTIAL   fallback for a provider with fixed credentials
const crypto = require("crypto");

const list = (v) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const ttlSeconds = (env) => {
  const n = Number(env.TURN_CREDENTIAL_TTL_SEC);
  return Number.isFinite(n) && n >= 60 && n <= 86400 ? Math.floor(n) : 3600;
};

function buildIceConfig({ env = process.env, userId, now = new Date() } = {}) {
  const stun = list(env.ICE_STUN_URLS);
  const iceServers = [{ urls: stun.length ? stun : ["stun:stun.l.google.com:19302"] }];
  const turnUrls = list(env.TURN_URLS);
  const ttl = ttlSeconds(env);
  let mode = "stun-only";

  if (turnUrls.length && env.TURN_STATIC_AUTH_SECRET && userId) {
    const expiry = Math.floor(now.getTime() / 1000) + ttl;
    const username = `${expiry}:${String(userId)}`;
    const credential = crypto.createHmac("sha1", env.TURN_STATIC_AUTH_SECRET).update(username).digest("base64");
    iceServers.push({ urls: turnUrls, username, credential });
    mode = "ephemeral";
  } else if (turnUrls.length && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    iceServers.push({ urls: turnUrls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
    mode = "static";
  }
  return { iceServers, ttlSec: ttl, mode };
}

module.exports = { buildIceConfig };

// ============================================================================
// Direct APNs (HTTP/2, token auth) sender for iOS PushKit VoIP pushes.
//
// Why: Firebase (FCM) can only address FCM registration tokens. The token the
// app saves from react-native-voip-push-notification is a raw PushKit token,
// which only APNs itself understands — so a VoIP push has to go to APNs
// directly. No new dependency: Node's built-in `http2` + `crypto` (ES256 JWT).
//
// Enabled only when ALL of these env vars are set (otherwise the caller keeps
// its previous behaviour, so nothing changes until you configure it):
//   APNS_KEY_ID      10-char Key ID of the .p8 Auth Key
//   APNS_TEAM_ID     10-char Apple Team ID
//   APNS_AUTH_KEY    contents of the .p8 (PEM, "\n" escapes allowed) or its base64
//   IOS_BUNDLE_ID    app bundle id (topic is "<bundle>.voip")
//   APNS_PRODUCTION  "true" (default when NODE_ENV=production) | "false" for sandbox
// A token from a Debug/TestFlight-sandbox build needs APNS_PRODUCTION=false.
// ============================================================================
const crypto = require("crypto");

const b64url = (buf) => Buffer.from(buf).toString("base64url");

const readKey = (raw) => {
  if (!raw) return null;
  const text = String(raw).replace(/\\n/g, "\n").trim();
  if (text.includes("BEGIN PRIVATE KEY")) return text;
  try {
    const decoded = Buffer.from(text, "base64").toString("utf8");
    return decoded.includes("BEGIN PRIVATE KEY") ? decoded : null;
  } catch {
    return null;
  }
};

const config = (env = process.env) => {
  const key = readKey(env.APNS_AUTH_KEY);
  if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !key || !env.IOS_BUNDLE_ID) return null;
  const prod = env.APNS_PRODUCTION != null ? env.APNS_PRODUCTION === "true" : env.NODE_ENV === "production";
  return {
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    key,
    bundleId: env.IOS_BUNDLE_ID,
    host: prod ? "api.push.apple.com" : "api.sandbox.push.apple.com",
  };
};

const isConfigured = (env = process.env) => !!config(env);

// Provider token, valid up to 60 min; refreshed after 50. ES256 = P-256 + SHA-256
// with the raw r||s signature JWT requires (dsaEncoding: ieee-p1363).
let cachedJwt = null;
const providerToken = (cfg, nowMs = Date.now()) => {
  if (cachedJwt && cachedJwt.keyId === cfg.keyId && nowMs - cachedJwt.at < 50 * 60 * 1000) return cachedJwt.token;
  const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(nowMs / 1000) }));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), { key: cfg.key, dsaEncoding: "ieee-p1363" });
  const token = `${header}.${claims}.${b64url(sig)}`;
  cachedJwt = { token, at: nowMs, keyId: cfg.keyId };
  return token;
};

// Pure: everything about the request except the network call (unit-tested).
const buildVoipRequest = ({ cfg, deviceToken, data, nowMs = Date.now() }) => ({
  path: `/3/device/${deviceToken}`,
  headers: {
    ":method": "POST",
    ":path": `/3/device/${deviceToken}`,
    authorization: `bearer ${providerToken(cfg, nowMs)}`,
    "apns-topic": `${cfg.bundleId}.voip`,
    "apns-push-type": "voip",
    "apns-priority": "10",
    // 0 = deliver now or drop: a ring must never arrive late.
    "apns-expiration": "0",
    "content-type": "application/json",
  },
  // Custom keys at the root: this is what the app's PushKit handler receives.
  body: JSON.stringify({ ...data, aps: { "content-available": 1 } }),
});

const sendVoip = (deviceToken, data, { env = process.env, timeoutMs = 8000 } = {}) =>
  new Promise((resolve) => {
    const cfg = config(env);
    if (!cfg) return resolve({ sent: false, reason: "not_configured" });
    let client;
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      try {
        client && client.close();
      } catch {
        /* already closed */
      }
      resolve(r);
    };
    try {
      const req = buildVoipRequest({ cfg, deviceToken, data });
      client = require("http2").connect(`https://${cfg.host}`);
      client.on("error", (err) => done({ sent: false, reason: err.code || err.message }));
      client.setTimeout(timeoutMs, () => done({ sent: false, reason: "timeout" }));
      const stream = client.request(req.headers);
      let status = 0;
      let body = "";
      stream.on("response", (h) => {
        status = h[":status"];
      });
      stream.setEncoding("utf8");
      stream.on("data", (c) => {
        body += c;
      });
      stream.on("end", () => {
        if (status === 200) return done({ sent: true, status });
        let reason = "";
        try {
          reason = JSON.parse(body).reason;
        } catch {
          /* empty body */
        }
        done({ sent: false, status, reason: reason || `http_${status}` });
      });
      stream.on("error", (err) => done({ sent: false, reason: err.code || err.message }));
      stream.end(req.body);
    } catch (err) {
      done({ sent: false, reason: err.message });
    }
  });

module.exports = { isConfigured, config, providerToken, buildVoipRequest, sendVoip };

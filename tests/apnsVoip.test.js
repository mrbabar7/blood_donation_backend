// Run with:  node --test tests/apnsVoip.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const apns = require("../services/apnsVoipService");

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const env = { APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "TEAM123456", APNS_AUTH_KEY: pem, IOS_BUNDLE_ID: "com.blooddonation.app", APNS_PRODUCTION: "false" };

test("not configured unless every APNS_* value is present", () => {
  assert.equal(apns.isConfigured({}), false);
  assert.equal(apns.isConfigured({ ...env, APNS_KEY_ID: "" }), false);
  assert.equal(apns.isConfigured({ ...env, APNS_AUTH_KEY: "garbage" }), false);
  assert.equal(apns.isConfigured(env), true);
});

test("accepts the key as PEM with \\n escapes or as base64", () => {
  assert.equal(apns.isConfigured({ ...env, APNS_AUTH_KEY: pem.replace(/\n/g, "\\n") }), true);
  assert.equal(apns.isConfigured({ ...env, APNS_AUTH_KEY: Buffer.from(pem).toString("base64") }), true);
});

test("sandbox/production host follows APNS_PRODUCTION", () => {
  assert.equal(apns.config(env).host, "api.sandbox.push.apple.com");
  assert.equal(apns.config({ ...env, APNS_PRODUCTION: "true" }).host, "api.push.apple.com");
});

test("provider JWT is a valid ES256 token for the team/key", () => {
  const cfg = apns.config(env);
  const [h, c, s] = apns.providerToken(cfg, 1_000_000).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "ABC123DEFG" });
  assert.deepEqual(JSON.parse(Buffer.from(c, "base64url")), { iss: "TEAM123456", iat: 1000 });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
});

test("VoIP request has the headers APNs requires and the call data at the payload root", () => {
  const req = apns.buildVoipRequest({ cfg: apns.config(env), deviceToken: "abcd", data: { requestId: "r1", fromName: "Ali", callId: "c1" } });
  assert.equal(req.headers["apns-topic"], "com.blooddonation.app.voip");
  assert.equal(req.headers["apns-push-type"], "voip");
  assert.equal(req.headers["apns-priority"], "10");
  assert.equal(req.headers["apns-expiration"], "0");
  assert.equal(req.headers[":path"], "/3/device/abcd");
  assert.match(req.headers.authorization, /^bearer /);
  const body = JSON.parse(req.body);
  assert.equal(body.requestId, "r1");
  assert.equal(body.callId, "c1");
});

test("sendVoip without configuration resolves not_configured instead of throwing", async () => {
  assert.deepEqual(await apns.sendVoip("abcd", {}, { env: {} }), { sent: false, reason: "not_configured" });
});

// Integration-style test of utils/sessionService.js with in-memory fakes for
// mongoose / jsonwebtoken / the models, so it runs with plain `node --test`
// (no database, no installed packages). The fakes implement only what the
// service uses; the real libraries are exercised in a deployed environment.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const Module = require("node:module");

process.env.JWT_SECRET = "test-secret";
const root = path.join(__dirname, "..");
const abs = (p) => path.join(root, p);

// ---- fake jsonwebtoken (HS256, exp support) --------------------------------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtFake = {
  sign(payload, secret, { expiresIn }) {
    const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresIn };
    const head = b64({ alg: "HS256", typ: "JWT" });
    const sig = crypto.createHmac("sha256", secret).update(`${head}.${b64(body)}`).digest("base64url");
    return `${head}.${b64(body)}.${sig}`;
  },
  verify(token, secret, opts = {}) {
    const [h, b, s] = String(token).split(".");
    const sig = crypto.createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url");
    if (s !== sig) { const e = new Error("invalid"); e.name = "JsonWebTokenError"; throw e; }
    const body = JSON.parse(Buffer.from(b, "base64url").toString());
    if (!opts.ignoreExpiration && body.exp * 1000 <= Date.now()) { const e = new Error("expired"); e.name = "TokenExpiredError"; throw e; }
    return body;
  },
};

// ---- fake store ------------------------------------------------------------
const sessions = new Map();
const users = new Map();
let oid = 0;
const newId = () => (++oid).toString(16).padStart(24, "a");
const match = (doc, filter) =>
  Object.entries(filter).every(([k, cond]) => {
    const v = doc[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !(typeof cond.toHexString === "function")) {
      if ("$gt" in cond) return v > cond.$gt;
      if ("$ne" in cond) return String(v) !== String(cond.$ne);
    }
    if (cond === null) return v === null || v === undefined;
    return String(v) === String(cond);
  });
const apply = (doc, upd) => {
  Object.assign(doc, upd.$set || {});
  for (const k of Object.keys(upd.$unset || {})) delete doc[k];
  for (const [k, n] of Object.entries(upd.$inc || {})) doc[k] = (doc[k] || 0) + n;
};
const chain = (v) => { const p = Promise.resolve(v); p.select = () => p; return p; };
const Session = {
  create: async (d) => { const doc = { revokedAt: null, rotationCount: 0, refreshTokenHash: null, previousRefreshTokenHash: null, ...d, _id: d._id || newId() }; sessions.set(String(doc._id), doc); return doc; },
  findById: (id) => chain(sessions.get(String(id)) || null),
  findOneAndUpdate: async (f, u) => { const d = [...sessions.values()].find((x) => match(x, f)); if (!d) return null; apply(d, u); return d; },
  updateOne: async (f, u) => { const d = [...sessions.values()].find((x) => match(x, f)); if (d) apply(d, u); },
  updateMany: async (f, u) => { [...sessions.values()].filter((x) => match(x, f)).forEach((d) => apply(d, u)); },
  deleteMany: async (f) => { [...sessions.values()].filter((x) => match(x, f)).forEach((d) => sessions.delete(String(d._id))); },
};
const User = {
  findById: (id) => chain(users.get(String(id)) || null),
  updateOne: async (f, u) => { const d = users.get(String(f._id)); if (d) apply(d, u); },
};
const mongooseFake = {
  Types: { ObjectId: class { constructor() { this.id = newId(); } toString() { return this.id; } } },
  isValidObjectId: (v) => /^[a-f0-9]{24}$/i.test(String(v)),
};

const stubs = {
  mongoose: mongooseFake,
  jsonwebtoken: jwtFake,
  [abs("config/jwtSecret.js")]: process.env.JWT_SECRET,
  [abs("models/sessionModel.js")]: Session,
  [abs("models/userMode.js")]: User,
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs[request] !== undefined) return stubs[request];
  if (parent && request.startsWith(".")) {
    const resolved = path.resolve(path.dirname(parent.filename), request);
    for (const k of Object.keys(stubs)) if (k.startsWith(root) && (resolved === k || resolved + ".js" === k)) return stubs[k];
  }
  return origLoad.call(this, request, parent, ...rest);
};
const svc = require("../utils/sessionService");
const req = { headers: { "user-agent": "jest" }, ip: "1.2.3.4" };
const DAY = 86400000;

const makeUser = () => { const u = { _id: newId(), email: "a@b.c", token: null }; users.set(u._id, u); return u; };

test("startSession issues access+refresh tokens with a 30-day absolute expiry", async () => {
  const u = makeUser();
  const s = await svc.startSession(u, req);
  const exp = new Date(s.sessionExpiresAt).getTime() - Date.now();
  assert.ok(exp > 29.99 * DAY && exp <= 30 * DAY);
  const r = await svc.authenticateAccessToken(s.token);
  assert.equal(r.ok, true);
  assert.equal(String(r.user._id), u._id);
});

test("refresh rotates the token, keeps the same session expiry and invalidates the old refresh token after grace", async () => {
  const u = makeUser();
  const s = await svc.startSession(u, req);
  const r1 = await svc.rotateRefreshToken(s.refreshToken, req);
  assert.equal(r1.ok, true);
  assert.notEqual(r1.refreshToken, s.refreshToken);
  assert.equal(r1.sessionExpiresAt, s.sessionExpiresAt, "expiry must never be extended");
  assert.equal((await svc.authenticateAccessToken(r1.token)).ok, true);

  // Replay of the OLD token outside the grace window => session revoked.
  const sess = [...sessions.values()].find((x) => String(x.userId) === u._id);
  sess.previousRotatedAt = new Date(Date.now() - 60000);
  const replay = await svc.rotateRefreshToken(s.refreshToken, req);
  assert.deepEqual([replay.ok, replay.code], [false, "SESSION_REVOKED"]);
  // ...and the newest token no longer works either, nor does the access token.
  assert.equal((await svc.rotateRefreshToken(r1.refreshToken, req)).ok, false);
  assert.equal((await svc.authenticateAccessToken(r1.token)).code, "SESSION_REVOKED");
});

test("a lost refresh response can be retried with the previous token inside the grace window", async () => {
  const u = makeUser();
  const s = await svc.startSession(u, req);
  await svc.rotateRefreshToken(s.refreshToken, req); // response "lost"
  const retry = await svc.rotateRefreshToken(s.refreshToken, req);
  assert.equal(retry.ok, true);
});

test("expired access token reports TOKEN_EXPIRED (client should refresh); tampered one TOKEN_INVALID", async () => {
  const u = makeUser();
  const s = await svc.startSession(u, req);
  const sid = [...sessions.values()].find((x) => String(x.userId) === u._id)._id;
  const expired = jwtFake.sign({ id: u._id, sid }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.equal((await svc.authenticateAccessToken(expired)).code, "TOKEN_EXPIRED");
  assert.equal((await svc.authenticateAccessToken(s.token + "x")).code, "TOKEN_INVALID");
});

test("session past 30 days: access token and refresh token are both rejected (SESSION_EXPIRED)", async () => {
  const u = makeUser();
  const s = await svc.startSession(u, req);
  const sess = [...sessions.values()].find((x) => String(x.userId) === u._id);
  sess.expiresAt = new Date(Date.now() - 1000);
  assert.equal((await svc.authenticateAccessToken(s.token)).code, "SESSION_EXPIRED");
  const r = await svc.rotateRefreshToken(s.refreshToken, req);
  assert.deepEqual([r.ok, r.code], [false, "SESSION_EXPIRED"]);
});

test("logout (by refresh token) revokes immediately: access token and refresh token stop working", async () => {
  const u = makeUser();
  const s = await svc.startSession(u, req);
  assert.equal(await svc.revokeByRefreshToken(s.refreshToken), true);
  assert.equal((await svc.authenticateAccessToken(s.token)).code, "SESSION_REVOKED");
  assert.equal((await svc.rotateRefreshToken(s.refreshToken, req)).ok, false);
  assert.equal(await svc.revokeByRefreshToken("garbage"), false);
});

test("password change revokes other sessions but keeps the current one", async () => {
  const u = makeUser();
  const a = await svc.startSession(u, req);
  const b = await svc.startSession(u, req);
  const current = (await svc.authenticateAccessToken(a.token)).session._id;
  await svc.revokeAllForUser(u._id, "password_changed", current, { clearLegacy: false });
  assert.equal((await svc.authenticateAccessToken(a.token)).ok, true);
  assert.equal((await svc.authenticateAccessToken(b.token)).code, "SESSION_REVOKED");
  await svc.revokeAllForUser(u._id, "password_reset");
  assert.equal((await svc.authenticateAccessToken(a.token)).code, "SESSION_REVOKED");
});

test("Google hand-off code is single use and expires; tokens only exist after exchange", async () => {
  const u = makeUser();
  const code = await svc.startPendingSession(u, req);
  const first = await svc.completeHandoff(code, req);
  assert.ok(first && first.token && first.refreshToken);
  assert.equal((await svc.authenticateAccessToken(first.token)).ok, true);
  assert.equal(await svc.completeHandoff(code, req), null, "second use must fail");

  const code2 = await svc.startPendingSession(u, req);
  const pending = [...sessions.values()].find((x) => x.handoffHash);
  pending.handoffExpiresAt = new Date(Date.now() - 1);
  assert.equal(await svc.completeHandoff(code2, req), null, "expired code must fail");
  assert.equal(await svc.completeHandoff("short", req), null);
});

test("legacy 24h tokens (no sid) still work until they expire, and die on logout of the legacy field", async () => {
  const u = makeUser();
  const legacy = jwtFake.sign({ id: u._id, email: u.email }, process.env.JWT_SECRET, { expiresIn: 3600 });
  u.token = legacy;
  assert.equal((await svc.authenticateAccessToken(legacy)).ok, true);
  u.token = null;
  assert.equal((await svc.authenticateAccessToken(legacy)).code, "SESSION_REVOKED");
});

test("access token never outlives the session", () => {
  const soon = new Date(Date.now() + 90 * 1000);
  assert.ok(svc.accessLifetimeSeconds(soon) <= 90);
  assert.ok(svc.accessLifetimeSeconds(new Date(Date.now() - 5000)) >= 1);
});

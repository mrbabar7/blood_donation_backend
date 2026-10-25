const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hashSecret,
  newOpaqueSecret,
  formatRefreshToken,
  parseRefreshToken,
  evaluateRefresh,
} = require("../utils/refreshTokenLogic");
const { parseDurationMs, SESSION_MAX_AGE_MS, DAY_MS } = require("../config/sessionPolicy");

const SID = "64b7f0c2a1b2c3d4e5f60718";
const T0 = new Date("2026-10-13T12:00:00Z");
const mk = (over = {}) => {
  const secret = newOpaqueSecret();
  return {
    secret,
    session: {
      refreshTokenHash: hashSecret(secret),
      previousRefreshTokenHash: null,
      previousRotatedAt: null,
      revokedAt: null,
      expiresAt: new Date(T0.getTime() + 30 * DAY_MS),
      ...over,
    },
  };
};

test("session lifetime defaults to 30 days", () => {
  assert.equal(SESSION_MAX_AGE_MS, 30 * DAY_MS);
});

test("parseDurationMs understands d/h/m/s and plain seconds, falls back on junk", () => {
  assert.equal(parseDurationMs("7d", 1), 7 * DAY_MS);
  assert.equal(parseDurationMs("12h", 1), 12 * 3600 * 1000);
  assert.equal(parseDurationMs("30m", 1), 30 * 60 * 1000);
  assert.equal(parseDurationMs("3600", 1), 3600 * 1000);
  assert.equal(parseDurationMs("soon", 99), 99);
  assert.equal(parseDurationMs(undefined, 99), 99);
});

test("refresh token round-trips and malformed tokens are rejected", () => {
  const secret = newOpaqueSecret();
  const parsed = parseRefreshToken(formatRefreshToken(SID, secret));
  assert.deepEqual(parsed, { sid: SID, secret });
  for (const bad of [null, undefined, 42, "", "abc", `${SID}.short`, `nothex${SID.slice(6)}.${secret}`, `${SID}${secret}`, "x".repeat(300)]) {
    assert.equal(parseRefreshToken(bad), null, String(bad).slice(0, 20));
  }
});

test("secrets are unique and only hashes are comparable", () => {
  assert.notEqual(newOpaqueSecret(), newOpaqueSecret());
  assert.equal(hashSecret("a"), hashSecret("a"));
  assert.notEqual(hashSecret("a"), hashSecret("b"));
});

test("current refresh token is accepted", () => {
  const { secret, session } = mk();
  assert.deepEqual(evaluateRefresh(session, secret, T0), { ok: true, via: "current" });
});

test("wrong secret, unknown session and pending hand-off sessions are rejected", () => {
  const { session } = mk();
  assert.equal(evaluateRefresh(session, newOpaqueSecret(), T0).reason, "mismatch");
  assert.equal(evaluateRefresh(null, "x", T0).reason, "not_found");
  assert.equal(evaluateRefresh({ ...session, refreshTokenHash: null }, "x", T0).reason, "pending");
});

test("revoked session (logout / password reset) is rejected", () => {
  const { secret, session } = mk({ revokedAt: T0 });
  assert.equal(evaluateRefresh(session, secret, T0).reason, "revoked");
});

test("session past its absolute 30-day expiry is rejected even with the right token", () => {
  const { secret, session } = mk();
  const day31 = new Date(T0.getTime() + 31 * DAY_MS);
  assert.equal(evaluateRefresh(session, secret, day31).reason, "expired");
  const exactly = new Date(session.expiresAt);
  assert.equal(evaluateRefresh(session, secret, exactly).reason, "expired");
});

test("rotated-out token: accepted as a retry inside the grace window", () => {
  const old = mk();
  const next = newOpaqueSecret();
  const session = {
    ...old.session,
    refreshTokenHash: hashSecret(next),
    previousRefreshTokenHash: old.session.refreshTokenHash,
    previousRotatedAt: T0,
  };
  const soon = new Date(T0.getTime() + 5000);
  assert.deepEqual(evaluateRefresh(session, old.secret, soon, 30000), { ok: true, via: "previous" });
  assert.deepEqual(evaluateRefresh(session, next, soon, 30000), { ok: true, via: "current" });
});

test("rotated-out token replayed after the grace window => reuse (caller revokes session)", () => {
  const old = mk();
  const session = {
    ...old.session,
    refreshTokenHash: hashSecret(newOpaqueSecret()),
    previousRefreshTokenHash: old.session.refreshTokenHash,
    previousRotatedAt: T0,
  };
  const later = new Date(T0.getTime() + 60000);
  assert.equal(evaluateRefresh(session, old.secret, later, 30000).reason, "reuse");
});

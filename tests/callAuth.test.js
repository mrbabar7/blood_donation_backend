const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createCallAuth } = require("../services/callAuthService");
const { buildIceConfig } = require("../services/iceConfigService");

const RID = "a".repeat(24);
const SEEKER = "s1";
const DONOR_DOC = "d1";
const DONOR_USER = "u-d1";

function harness({ status = "accepted", donor = { userId: DONOR_USER } } = {}) {
  const reads = { request: 0 };
  const DonationRequest = {
    findById: (id) => ({
      select: () => ({
        lean: async () => {
          reads.request += 1;
          return String(id) === RID ? { seekerId: SEEKER, donorId: DONOR_DOC, status } : null;
        },
      }),
    }),
  };
  const Donor = {
    findById: () => ({ select: () => ({ lean: async () => donor }) }),
  };
  const store = new Map();
  // single-flight like utils/ttlCache: concurrent callers share one load
  const cache = (key, _ttl, loader) => {
    if (!store.has(key)) store.set(key, loader());
    return store.get(key);
  };
  return { auth: createCallAuth({ DonationRequest, Donor, cache }), reads };
}

test("isCallPair: only the request's seeker and donor user, either direction", async () => {
  const { auth } = harness();
  assert.equal(await auth.isCallPair({ requestId: RID, userA: SEEKER, userB: DONOR_USER }), true);
  assert.equal(await auth.isCallPair({ requestId: RID, userA: DONOR_USER, userB: SEEKER }), true);
  assert.equal(await auth.isCallPair({ requestId: RID, userA: SEEKER, userB: "stranger" }), false);
  assert.equal(await auth.isCallPair({ requestId: RID, userA: "stranger", userB: DONOR_USER }), false);
  assert.equal(await auth.isCallPair({ requestId: RID, userA: "x", userB: "y" }), false);
  assert.equal(await auth.isCallPair({ requestId: RID, userA: SEEKER, userB: SEEKER }), false, "no self-call");
});

test("isCallPair: bad / unknown request ids are denied", async () => {
  const { auth } = harness();
  assert.equal(await auth.isCallPair({ requestId: "nope", userA: SEEKER, userB: DONOR_USER }), false);
  assert.equal(await auth.isCallPair({ requestId: "b".repeat(24), userA: SEEKER, userB: DONOR_USER }), false);
  assert.equal(await auth.isCallPair({ requestId: undefined, userA: SEEKER, userB: DONOR_USER }), false);
});

test("isCallPair: a burst of ICE messages costs ONE request lookup", async () => {
  const { auth, reads } = harness();
  await Promise.all(Array.from({ length: 30 }, () => auth.isCallPair({ requestId: RID, userA: SEEKER, userB: DONOR_USER })));
  assert.equal(reads.request, 1);
});

test("isCallPair: donor without a user account is denied", async () => {
  const { auth } = harness({ donor: null });
  assert.equal(await auth.isCallPair({ requestId: RID, userA: SEEKER, userB: DONOR_USER }), false);
});

test("canInvite: participants + chat-open status only", async () => {
  for (const status of ["accepted", "locked", "on_hold", "donation_started", "seeker_not_yet", "donation_agreed", "completed"]) {
    const { auth } = harness({ status });
    assert.equal((await auth.canInvite({ requestId: RID, callerId: SEEKER, calleeId: DONOR_USER })).ok, true, status);
    assert.equal((await auth.canInvite({ requestId: RID, callerId: DONOR_USER, calleeId: SEEKER })).ok, true, status);
  }
  for (const status of ["pending", "rejected", "expired", "released", "auto_released", "donor_unable", "reported"]) {
    const { auth } = harness({ status });
    const r = await auth.canInvite({ requestId: RID, callerId: SEEKER, calleeId: DONOR_USER });
    assert.deepEqual([r.ok, r.reason], [false, "request_not_open"], status);
  }
});

test("canInvite: strangers, self and unknown requests are refused", async () => {
  const { auth } = harness();
  assert.equal((await auth.canInvite({ requestId: RID, callerId: "stranger", calleeId: DONOR_USER })).reason, "not_participants");
  assert.equal((await auth.canInvite({ requestId: RID, callerId: SEEKER, calleeId: "stranger" })).reason, "not_participants");
  assert.equal((await auth.canInvite({ requestId: RID, callerId: SEEKER, calleeId: SEEKER })).reason, "invalid_pair");
  assert.equal((await auth.canInvite({ requestId: "c".repeat(24), callerId: SEEKER, calleeId: DONOR_USER })).reason, "no_request");
});

// ---------------------------------------------------------------- ICE config ----
test("ice config: STUN only when no TURN is configured", () => {
  const c = buildIceConfig({ env: {}, userId: "u1" });
  assert.equal(c.mode, "stun-only");
  assert.equal(c.iceServers.length, 1);
  assert.match(c.iceServers[0].urls[0], /^stun:/);
});

test("ice config: ephemeral coturn credentials (HMAC-SHA1, expiry in the username)", () => {
  const now = new Date("2026-10-23T00:00:00Z");
  const env = { TURN_URLS: "turn:t.example.com:3478, turns:t.example.com:443?transport=tcp", TURN_STATIC_AUTH_SECRET: "s3cret", TURN_CREDENTIAL_TTL_SEC: "600" };
  const c = buildIceConfig({ env, userId: "u1", now });
  assert.equal(c.mode, "ephemeral");
  const turn = c.iceServers[1];
  assert.deepEqual(turn.urls, ["turn:t.example.com:3478", "turns:t.example.com:443?transport=tcp"]);
  const expiry = Math.floor(now.getTime() / 1000) + 600;
  assert.equal(turn.username, `${expiry}:u1`);
  assert.equal(turn.credential, crypto.createHmac("sha1", "s3cret").update(turn.username).digest("base64"));
  assert.ok(!JSON.stringify(c).includes("s3cret"), "the shared secret is never returned");
  // different users get different credentials
  assert.notEqual(buildIceConfig({ env, userId: "u2", now }).iceServers[1].credential, turn.credential);
});

test("ice config: static fallback, bad ttl falls back to 1 h, TURN needs a user for ephemeral mode", () => {
  const stat = buildIceConfig({ env: { TURN_URLS: "turn:t:3478", TURN_USERNAME: "a", TURN_CREDENTIAL: "b" }, userId: "u" });
  assert.equal(stat.mode, "static");
  assert.equal(buildIceConfig({ env: { TURN_URLS: "turn:t:3478", TURN_STATIC_AUTH_SECRET: "x", TURN_CREDENTIAL_TTL_SEC: "5" }, userId: "u" }).ttlSec, 3600);
  assert.equal(buildIceConfig({ env: { TURN_URLS: "turn:t:3478", TURN_STATIC_AUTH_SECRET: "x" } }).mode, "stun-only");
  assert.equal(buildIceConfig({ env: { TURN_STATIC_AUTH_SECRET: "x" }, userId: "u" }).mode, "stun-only", "no URLs, no TURN");
});

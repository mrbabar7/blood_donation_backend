// Run with:  node --test tests/clusterReady.test.js     (npm run test:scale)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter, createMemoryStore, identifierKey } = require("../middlewares/rateLimitMiddleware");
const presenceFactory = require("../services/presence");

// ------------------------------------------------------------------ helpers
const run = async (mw, req) => {
  const res = {
    code: 200, body: null, headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let nextCalled = false;
  await mw(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
};
const req = (over = {}) => ({ method: "POST", baseUrl: "/auth", path: "/login", route: { path: "/login" }, ip: "1.2.3.4", body: {}, ...over });

// A fake Redis shared by "several instances": implements the one command the limiter uses.
const fakeRedis = () => {
  const data = new Map();
  return {
    async eval(_lua, _n, key, windowMs) {
      const e = data.get(key) || { n: 0, exp: Date.now() + Number(windowMs) };
      e.n += 1;
      data.set(key, e);
      return [e.n, Math.max(0, e.exp - Date.now())];
    },
  };
};

// ------------------------------------------------------------- rate limiter
test("memory mode: blocks after max and sends Retry-After", async () => {
  const rl = createRateLimiter({ getRedisClient: () => null, memory: createMemoryStore() })({ windowMs: 60000, max: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await run(rl, req())).nextCalled, true);
  const blocked = await run(rl, req());
  assert.equal(blocked.res.code, 429);
  assert.ok(Number(blocked.res.headers["Retry-After"]) >= 1);
  assert.equal(blocked.nextCalled, false);
});

test("two server instances sharing Redis share ONE counter (limit holds cluster-wide)", async () => {
  const redis = fakeRedis();
  const instanceA = createRateLimiter({ getRedisClient: () => redis, memory: createMemoryStore() })({ windowMs: 60000, max: 4 });
  const instanceB = createRateLimiter({ getRedisClient: () => redis, memory: createMemoryStore() })({ windowMs: 60000, max: 4 });
  for (let i = 0; i < 2; i++) await run(instanceA, req());
  for (let i = 0; i < 2; i++) assert.equal((await run(instanceB, req())).nextCalled, true);
  assert.equal((await run(instanceA, req())).res.code, 429); // 5th hit overall, on a different instance
});

test("a Redis outage degrades to memory counting instead of failing the request", async () => {
  const broken = { eval: async () => { throw new Error("ECONNREFUSED"); } };
  const rl = createRateLimiter({ getRedisClient: () => broken, memory: createMemoryStore() })({ windowMs: 60000, max: 2 });
  assert.equal((await run(rl, req())).nextCalled, true);
  assert.equal((await run(rl, req())).nextCalled, true);
  assert.equal((await run(rl, req())).res.code, 429);
});

test("each route has its own counter (one endpoint can't use up another's allowance)", async () => {
  const make = createRateLimiter({ getRedisClient: () => null, memory: createMemoryStore() });
  const a = make({ windowMs: 60000, max: 1 });
  const b = make({ windowMs: 60000, max: 1 });
  assert.equal((await run(a, req({ route: { path: "/a" } }))).nextCalled, true);
  assert.equal((await run(b, req({ route: { path: "/b" } }))).nextCalled, true);
});

test("per-account limiter: attacker guessing one account is blocked, other accounts and shared IPs are not", async () => {
  const make = createRateLimiter({ getRedisClient: () => null, memory: createMemoryStore() });
  const login = make({ windowMs: 15 * 60000, max: 10, keyFn: identifierKey("email"), name: "login:id" });
  const attempt = (email, ip = "9.9.9.9") => run(login, req({ ip, body: { email } }));
  for (let i = 0; i < 10; i++) assert.equal((await attempt("Victim@x.com ")).nextCalled, true);
  assert.equal((await attempt("victim@x.com")).res.code, 429); // case/whitespace-insensitive
  assert.equal((await attempt("other@x.com")).nextCalled, true); // same IP (carrier NAT), different account
});

test("OTP brute force is capped: 10 verify attempts per 10 minutes per account", async () => {
  const make = createRateLimiter({ getRedisClient: () => null, memory: createMemoryStore() });
  const verify = make({ windowMs: 10 * 60000, max: 10, keyFn: identifierKey("phone"), name: "phone-verify:id" });
  let allowed = 0;
  for (let i = 0; i < 1000; i++) if ((await run(verify, req({ body: { phone: "+923001234567" } }))).nextCalled) allowed++;
  assert.equal(allowed, 10); // a 6-digit code cannot be brute-forced
});

test("identifier limiter ignores requests without an identifier (validation rejects those)", async () => {
  const rl = createRateLimiter({ getRedisClient: () => null, memory: createMemoryStore() })({ windowMs: 1000, max: 1, keyFn: identifierKey("email") });
  for (let i = 0; i < 5; i++) assert.equal((await run(rl, req({ body: {} }))).nextCalled, true);
});

// ----------------------------------------------------------------- presence
const fakeIo = ({ local = {}, cluster = {} } = {}) => {
  const rooms = new Map(Object.entries(local).map(([k, v]) => [k, new Set(v)]));
  const sockets = new Map();
  for (const [room, ids] of Object.entries(local)) ids.forEach((id) => sockets.set(id, { userId: id.split(":")[0] }));
  return {
    sockets: { adapter: { rooms }, sockets },
    in: (room) => ({ fetchSockets: async () => (cluster[room] || []).map((userId) => ({ data: { userId } })) }),
  };
};

test("single instance: presence is answered from local rooms", async () => {
  const io = fakeIo({ local: { u1: ["s1"] } });
  const p = presenceFactory.create({ getIo: () => io, isCluster: () => false });
  assert.equal(await p.userConnected("u1"), true);
  assert.equal(await p.userConnected("u2"), false);
  assert.equal(await p.count("u1"), 1);
});

test("cluster: a user connected on ANOTHER instance counts as online (no wrong offline/push)", async () => {
  const io = fakeIo({ local: {}, cluster: { u1: ["u1"], chat_r1: ["u2"] } });
  const p = presenceFactory.create({ getIo: () => io, isCluster: () => true });
  assert.equal(await p.userConnected("u1"), true);
  assert.equal(await p.inChatRoom("u2", "r1"), true);
  assert.equal(await p.inChatRoom("u3", "r1"), false);
});

test("a user is only marked offline when their LAST socket anywhere is gone", async () => {
  const io = fakeIo({ cluster: { u1: ["u1"] } });
  const p = presenceFactory.create({ getIo: () => io, isCluster: () => true });
  assert.equal(await p.count("u1"), 1); // still has a socket on another instance
  assert.equal(await p.count("nobody"), 0);
});

test("cluster query failure falls back to the local answer", async () => {
  const io = fakeIo({ local: { u1: ["s1"] } });
  io.in = () => ({ fetchSockets: async () => { throw new Error("redis down"); } });
  const p = presenceFactory.create({ getIo: () => io, isCluster: () => true });
  assert.equal(await p.userConnected("u1"), true);
});

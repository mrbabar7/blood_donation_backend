// Rate limiter. Counts in Redis when REDIS_URL is configured (so the limit holds across
// several server instances) and in process memory otherwise. If Redis errors, that
// request is counted in memory instead — a Redis outage never blocks users or logins.
//
//   rateLimit({ windowMs, max })                       per IP, per route   (as before)
//   rateLimit({ windowMs, max, keyFn: (req) => id })   per identifier (e.g. email / phone)
//
// Each route has its OWN counter. (Previously every route shared one counter per IP, so
// calls to one endpoint used up another endpoint's allowance.)
const { getLimiterClient } = require("../config/redis");

// ---- stores ----------------------------------------------------------------------

const createMemoryStore = () => {
  const buckets = new Map();
  // Expired buckets used to stay in the Map forever (one entry per distinct key -> slow
  // memory leak). Swept once a minute; unref'd so it never keeps Node alive.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) if (now > entry.resetAt) buckets.delete(key);
  }, 60_000);
  if (typeof sweep.unref === "function") sweep.unref();
  return {
    async hit(key, windowMs) {
      const now = Date.now();
      let entry = buckets.get(key);
      if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + windowMs };
      entry.count += 1;
      buckets.set(key, entry);
      return { count: entry.count, ttlMs: Math.max(0, entry.resetAt - now) };
    },
  };
};

// INCR + PEXPIRE in one atomic script, so a crash between the two can never leave a
// counter that never expires.
const LUA = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}`;

const createRedisStore = (client) => ({
  async hit(key, windowMs) {
    const [count, ttl] = await client.eval(LUA, 1, `rl:${key}`, String(windowMs));
    return { count: Number(count), ttlMs: Math.max(0, Number(ttl)) };
  },
});

const memoryStore = createMemoryStore();

// ---- middleware -------------------------------------------------------------------

const clientIp = (req) => req.ip || (req.connection && req.connection.remoteAddress) || "unknown";

function createRateLimiter({ getRedisClient = getLimiterClient, memory = memoryStore } = {}) {
  return function rateLimit({ windowMs = 60000, max = 30, keyFn, name, message } = {}) {
    return async (req, res, next) => {
      try {
        const routeName = name || `${req.method}:${req.baseUrl || ""}${(req.route && req.route.path) || req.path}`;
        const who = keyFn ? keyFn(req) : clientIp(req);
        // An identifier-based limiter with no identifier in the request has nothing to
        // count; the route's own validation rejects such a request anyway.
        if (who === undefined || who === null || who === "") return next();
        const key = `${routeName}|${who}`;

        let result;
        const client = getRedisClient();
        if (client) {
          try {
            result = await createRedisStore(client).hit(key, windowMs);
          } catch {
            result = await memory.hit(key, windowMs); // Redis down: degrade, don't fail
          }
        } else {
          result = await memory.hit(key, windowMs);
        }

        if (result.count > max) {
          res.set("Retry-After", String(Math.max(1, Math.ceil(result.ttlMs / 1000))));
          return res.status(429).json({ success: false, message: message || "Too many requests — please slow down." });
        }
        return next();
      } catch (err) {
        // The limiter itself must never take a route down.
        return next();
      }
    };
  };
}

const rateLimit = createRateLimiter();

// Normalises an identifier so "A@x.com" and "a@x.com " share one counter.
const identifierKey = (field) => (req) => {
  const v = req.body && req.body[field];
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null;
};

module.exports = { rateLimit, createRateLimiter, createMemoryStore, createRedisStore, identifierKey };

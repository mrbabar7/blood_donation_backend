// Minimal in-memory rate limiter — no new dependency required. Honest limitation:
// this is per-process memory, so it resets on restart and doesn't share state
// across multiple server instances behind a load balancer. Fine for a single-
// instance deployment; swap for a Redis-backed limiter (e.g. rate-limiter-flexible)
// before running more than one server process.
const buckets = new Map();

function rateLimit({ windowMs = 60000, max = 30 } = {}) {
  return (req, res, next) => {
    const key = req.ip || req.connection?.remoteAddress || "unknown";
    const now = Date.now();
    const entry = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    buckets.set(key, entry);

    if (entry.count > max) {
      return res.status(429).json({ success: false, message: "Too many requests — please slow down." });
    }
    next();
  };
}

module.exports = { rateLimit };

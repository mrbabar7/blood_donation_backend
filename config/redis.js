// Optional Redis. EVERYTHING is off unless REDIS_URL is set, so the app boots and
// behaves exactly as before on a single instance with no Redis at all.
//
// With REDIS_URL set (and `npm install` run for ioredis + @socket.io/redis-adapter):
//   - Socket.IO rooms/emits/presence work across several server instances
//   - the rate limiter counts across instances
// A missing package or an unreachable Redis NEVER stops the server: each user falls
// back to the single-instance behaviour and logs why.
let limiterClient = null;
let warned = false;

const enabled = () => !!String(process.env.REDIS_URL || "").trim();

const load = () => {
  try {
    return require("ioredis");
  } catch {
    if (!warned) {
      warned = true;
      console.error("[redis] REDIS_URL is set but the 'ioredis' package is not installed — run `npm install`. Continuing without Redis.");
    }
    return null;
  }
};

const logErr = (() => {
  let last = 0;
  return (label) => (err) => {
    const now = Date.now();
    if (now - last > 10_000) {
      last = now;
      console.error(`[redis:${label}]`, err && err.message ? err.message : err);
    }
  };
})();

// Rate limiter client: fails FAST (no offline queue) so a Redis outage makes the limiter
// fall back to its in-memory counters instead of making login requests wait.
const getLimiterClient = () => {
  if (!enabled()) return null;
  if (limiterClient) return limiterClient;
  const IORedis = load();
  if (!IORedis) return null;
  limiterClient = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  limiterClient.on("error", logErr("limiter"));
  return limiterClient;
};

// Socket.IO adapter pub/sub pair (default queueing: messages wait out a brief reconnect).
const createPubSub = () => {
  if (!enabled()) return null;
  const IORedis = load();
  if (!IORedis) return null;
  const pub = new IORedis(process.env.REDIS_URL);
  const sub = pub.duplicate();
  pub.on("error", logErr("adapter-pub"));
  sub.on("error", logErr("adapter-sub"));
  return { pub, sub };
};

const closeAll = async () => {
  try {
    if (limiterClient) await limiterClient.quit();
  } catch {
    /* already closed */
  }
};

module.exports = { enabled, getLimiterClient, createPubSub, closeAll };

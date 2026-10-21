// Tiny in-process TTL cache with in-flight de-duplication ("single flight").
//
// For read-mostly data that is IDENTICAL for every user (e.g. the public list of
// verified hospitals): the first request loads it, everyone else within `ttlMs`
// reuses the result, and if 5,000 requests arrive while it is loading they share
// ONE database query instead of firing 5,000. Per-process by design (no Redis
// needed); worst case on several instances is one load per instance per TTL.
// Bounded so it can never grow without limit.
const store = new Map(); // key -> { value, expiresAt }
const inflight = new Map(); // key -> Promise
const MAX_ENTRIES = 200;

async function cached(key, ttlMs, loader) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await loader();
      if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

const invalidate = (key) => store.delete(key);
const clear = () => {
  store.clear();
  inflight.clear();
};

module.exports = { cached, invalidate, clear };

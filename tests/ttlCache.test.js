// Run with:  node --test tests/ttlCache.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { cached, clear } = require("../utils/ttlCache");

test("1,000 simultaneous requests share ONE load (no database stampede)", async () => {
  clear();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise((r) => setTimeout(r, 20));
    return ["a", "b"];
  };
  const results = await Promise.all(Array.from({ length: 1000 }, () => cached("k1", 1000, loader)));
  assert.equal(loads, 1);
  assert.ok(results.every((r) => r === results[0]));
});

test("a cached value is reused until the TTL passes, then reloaded", async () => {
  clear();
  let loads = 0;
  const loader = async () => ++loads;
  assert.equal(await cached("k2", 30, loader), 1);
  assert.equal(await cached("k2", 30, loader), 1);
  await new Promise((r) => setTimeout(r, 45));
  assert.equal(await cached("k2", 30, loader), 2);
});

test("a failed load is not cached: the next request retries", async () => {
  clear();
  let n = 0;
  const loader = async () => {
    n += 1;
    if (n === 1) throw new Error("db down");
    return "ok";
  };
  await assert.rejects(() => cached("k3", 1000, loader), /db down/);
  assert.equal(await cached("k3", 1000, loader), "ok");
});

test("different keys never share results", async () => {
  clear();
  assert.equal(await cached("hospitals", 1000, async () => "H"), "H");
  assert.equal(await cached("ngos", 1000, async () => "N"), "N");
});

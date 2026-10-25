const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeNextAvailableDate,
  buildAvailability,
  effectiveAvailability,
  reachedMilestones,
  DAY_MS,
} = require("../utils/donorAvailability");

const now = new Date("2026-10-13T12:00:00Z");
const last = new Date("2026-10-03T12:00:00Z");

test("next available date adds exact 24h steps (timezone independent)", () => {
  assert.equal(computeNextAvailableDate(last, 56).getTime(), last.getTime() + 56 * DAY_MS);
});

test("resting donor: days remaining, interval and progress come from the stored window", () => {
  const next = computeNextAvailableDate(last, 56);
  const a = buildAvailability({ isAvailable: false, lastDonationDate: last, nextAvailableDate: next }, { now });
  assert.equal(a.status, "resting");
  assert.equal(a.isResting, true);
  assert.equal(a.daysRemaining, 46);
  assert.equal(a.intervalDays, 56);
  assert.equal(a.progressPercent, 18);
});

test("changing the configured interval does not distort an existing rest window", () => {
  const next = computeNextAvailableDate(last, 90);
  const a = buildAvailability({ isAvailable: false, lastDonationDate: last, nextAvailableDate: next }, { now, fallbackIntervalDays: 56 });
  assert.equal(a.intervalDays, 90);
});

test("window ended: not resting, progress complete", () => {
  const a = buildAvailability(
    { isAvailable: true, lastDonationDate: last, nextAvailableDate: new Date(now.getTime() - 1000) },
    { now },
  );
  assert.equal(a.status, "available");
  assert.equal(a.daysRemaining, 0);
  assert.equal(a.progressPercent, 100);
});

test("less than a day left still reads as 1 day", () => {
  const a = buildAvailability(
    { isAvailable: false, lastDonationDate: last, nextAvailableDate: new Date(now.getTime() + 3600e3) },
    { now },
  );
  assert.equal(a.daysRemaining, 1);
});

test("never-donated donor has no window", () => {
  const a = buildAvailability({ isAvailable: true }, { now });
  assert.equal(a.status, "available");
  assert.equal(a.progressPercent, null);
});

test("milestones only appear once reached", () => {
  assert.deepEqual(reachedMilestones(0), []);
  assert.deepEqual(reachedMilestones(6).map((m) => m.threshold), [1, 5]);
});

// ---- list-endpoint rule (resting card + "notify me") -----------------------

test("effectiveAvailability: future window is resting with an ISO date and days left", () => {
  const next = new Date(now.getTime() + 42 * DAY_MS - 3600e3);
  const e = effectiveAvailability({ isAvailable: false, nextAvailableDate: next }, now);
  assert.equal(e.isResting, true);
  assert.equal(e.isAvailable, false);
  assert.equal(e.nextAvailableDate, next.toISOString());
  assert.equal(e.daysRemaining, 42);
  assert.equal(e.needsReconcile, false);
});

test("effectiveAvailability: window ended but job has not run -> available now, flagged for reconcile", () => {
  const e = effectiveAvailability({ isAvailable: false, availabilityReconciled: false, nextAvailableDate: new Date(now.getTime() - 5000) }, now);
  assert.equal(e.isResting, false);
  assert.equal(e.isAvailable, true);
  assert.equal(e.nextAvailableDate, null);
  assert.equal(e.daysRemaining, 0);
  assert.equal(e.needsReconcile, true);
});

test("effectiveAvailability: a donor who switched themselves off after reconcile stays off", () => {
  const e = effectiveAvailability({ isAvailable: false, availabilityReconciled: true, nextAvailableDate: new Date(now.getTime() - 5000) }, now);
  assert.equal(e.isAvailable, false);
  assert.equal(e.needsReconcile, false);
});

test("effectiveAvailability: suspended donors are never revived by the list rule", () => {
  const e = effectiveAvailability({ isAvailable: false, isSuspended: true, nextAvailableDate: new Date(now.getTime() - 5000) }, now);
  assert.equal(e.isAvailable, false);
  assert.equal(e.needsReconcile, false);
});

test("effectiveAvailability: switched-off donor without a window is not resting and has no date", () => {
  const e = effectiveAvailability({ isAvailable: false }, now);
  assert.equal(e.isResting, false);
  assert.equal(e.nextAvailableDate, null);
});

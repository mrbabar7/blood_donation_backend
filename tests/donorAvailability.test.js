const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeNextAvailableDate,
  buildAvailability,
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

// Pure date helpers for donor availability / resting state (no DB access, so
// they are trivially unit-testable).
//
// Date semantics (one rule, used everywhere):
//  - Every date is a UTC instant (JS Date / Mongo ISODate).
//  - nextAvailableDate = lastDonationDate + N * 24h, in plain milliseconds.
//    Calendar arithmetic (setDate) is deliberately NOT used: it shifts with
//    the server's local timezone / DST, which made the end of a rest window
//    depend on where the server happened to run.
//  - A donor is resting while nextAvailableDate is strictly in the future.
//  - daysRemaining = ceil(hours left / 24), so "1 day left" is shown until the
//    very last moment instead of reading "0 days" with hours still to go.
const DAY_MS = 86400000;

function computeNextAvailableDate(from, days) {
  return new Date(new Date(from).getTime() + days * DAY_MS);
}

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function isResting(donor, now = new Date()) {
  const next = toDate(donor && donor.nextAvailableDate);
  return !!next && next.getTime() > now.getTime();
}

function daysRemaining(nextAvailableDate, now = new Date()) {
  const next = toDate(nextAvailableDate);
  if (!next) return 0;
  return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / DAY_MS));
}

// One shared answer to "is this donor resting right now?" for every donor-LIST
// endpoint (nearby + search), so cards, profile and subscriptions never disagree.
//  - Resting: the stored window is still in the future -> never available.
//  - Window already ended but the scheduled job / a profile view has not
//    reconciled the donor yet (job lag, server was down): treated as available,
//    exactly what the reconcile step is about to persist, and flagged with
//    needsReconcile so the caller can trigger that step. The server clock is
//    the only authority; clients never decide this.
//  - A donor who is simply switched off (no future window) is not "resting";
//    they keep isAvailable=false and no date.
function effectiveAvailability(donor, now = new Date()) {
  const next = toDate(donor && donor.nextAvailableDate);
  const resting = !!next && next.getTime() > now.getTime();
  const needsReconcile =
    !!next && !resting && donor.availabilityReconciled !== true && !donor.isSuspended && !donor.isAvailable;
  return {
    isResting: resting,
    isAvailable: resting ? false : needsReconcile ? true : !!donor.isAvailable,
    nextAvailableDate: resting ? next.toISOString() : null,
    daysRemaining: resting ? daysRemaining(next, now) : 0,
    needsReconcile,
  };
}

// Progress through the donor's ACTUAL stored rest window (last -> next), so a
// later change to the configured interval never distorts donors already
// resting. Falls back to the configured interval only when the last donation
// date is missing (legacy rows).
function buildAvailability(donor, { now = new Date(), fallbackIntervalDays } = {}) {
  const last = toDate(donor.lastDonationDate);
  const next = toDate(donor.nextAvailableDate);
  const resting = isResting(donor, now);

  let intervalDays = null;
  let progressPercent = null;
  if (next) {
    let startMs = last ? last.getTime() : null;
    if (startMs == null || startMs >= next.getTime()) {
      startMs = fallbackIntervalDays ? next.getTime() - fallbackIntervalDays * DAY_MS : null;
    }
    if (startMs != null) {
      const total = next.getTime() - startMs;
      intervalDays = Math.max(1, Math.round(total / DAY_MS));
      const elapsed = now.getTime() - startMs;
      progressPercent = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
      if (!resting) progressPercent = 100;
    }
  }

  return {
    status: resting ? "resting" : donor.isAvailable ? "available" : "unavailable",
    isResting: resting,
    lastDonationDate: last,
    nextAvailableDate: next,
    daysRemaining: resting ? daysRemaining(next, now) : 0,
    intervalDays,
    progressPercent,
    // Lets the client run its countdown against the server's clock instead
    // of a possibly wrong device clock.
    serverNow: now.toISOString(),
  };
}

// Donation-count milestones. Derived ONLY from the real donation count; a
// milestone appears once the donor has actually reached it.
const MILESTONES = [1, 5, 10, 25, 50];
function reachedMilestones(totalDonations) {
  return MILESTONES.filter((m) => totalDonations >= m).map((m) => ({ key: `donations_${m}`, threshold: m }));
}

module.exports = { DAY_MS, computeNextAvailableDate, isResting, daysRemaining, effectiveAvailability, buildAvailability, reachedMilestones, MILESTONES };

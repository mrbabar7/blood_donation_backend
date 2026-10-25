// Pure rules of the donation lifecycle (no database, no clock reads except where a `now`
// is passed in) so they can be unit-tested exhaustively.
const {
  STATUS,
  TRANSITIONS,
  ACCEPTED_FAMILY,
  ACTIVE_STATUSES,
  CHAT_STATUSES,
  RELEASE_REASON,
  REQUEST_TTL_MS,
  RENOTIFY_WINDOW_MS,
  REMINDER_INTERVAL_MS,
  NUDGE_COOLDOWN_MS,
} = require("./constants");

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

const toMs = (d) => (d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : NaN);

/** expiresAt is EXACTLY requestedAt + 12 h (server clock). */
const expiresAtFor = (requestedAt) => new Date(toMs(requestedAt) + REQUEST_TTL_MS);

/** True once the deadline has been reached (the boundary itself counts as expired). */
const isPastExpiry = (expiresAt, now = new Date()) => {
  const e = toMs(expiresAt);
  return Number.isFinite(e) && e <= toMs(now);
};

const nextReminderAt = (from) => new Date(toMs(from) + REMINDER_INTERVAL_MS);

/** When the donor may next remind the seeker (null = right now). Server clock only. */
const nextNudgeAt = (lastNudgeAt) => {
  const t = toMs(lastNudgeAt);
  return Number.isFinite(t) ? new Date(t + NUDGE_COOLDOWN_MS) : null;
};

/** Milliseconds left of the nudge cooldown (0 = allowed). */
const nudgeCooldownRemainingMs = (lastNudgeAt, now = new Date()) => {
  const next = nextNudgeAt(lastNudgeAt);
  return next ? Math.max(0, next.getTime() - toMs(now)) : 0;
};

const isAcceptedFamily = (status) => ACCEPTED_FAMILY.includes(status);
const isActive = (status) => ACTIVE_STATUSES.includes(status);
const canChat = (status) => CHAT_STATUSES.includes(status);

/**
 * The newest failure (donor_unable / reported) time among a seeker's requests, or null.
 * `rows` need { status, failedAt }.
 */
const latestFailureAt = (rows, now = new Date()) => {
  const cutoff = toMs(now) - RENOTIFY_WINDOW_MS;
  let best = null;
  for (const r of rows) {
    if (r.status !== STATUS.DONOR_UNABLE && r.status !== STATUS.REPORTED) continue;
    const t = toMs(r.failedAt);
    if (!Number.isFinite(t) || t < cutoff) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best);
};

/**
 * Which released requests may be bulk re-notified.
 *
 *  - a NORMAL release only (status released + reason seeker_released); allegation /
 *    donor_unable / auto-released rows can never qualify;
 *  - released within the last 12 hours;
 *  - released at or before the failure, so it was released *because* another donor was
 *    locked, not afterwards by choice;
 *  - never when the seeker already has a newer open request to that same donor;
 *  - the failure itself must be recent (<= 12 h) and be donor_unable / reported.
 *
 * Returns [] unless there is at least one such failure, which is exactly the rule for
 * showing the "Re-notify Released Donors (N)" button.
 */
const eligibleForBulkRenotify = ({ rows, now = new Date() }) => {
  const failure = latestFailureAt(rows, now);
  if (!failure) return [];
  const cutoff = toMs(now) - RENOTIFY_WINDOW_MS;
  const openDonors = new Set(rows.filter((r) => isActive(r.status)).map((r) => String(r.donorId)));
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (r.status !== STATUS.RELEASED) continue;
    if (r.releaseReason !== RELEASE_REASON.SEEKER_RELEASED) continue;
    if (r.reportedAt) continue; // allegation-related: excluded
    const at = toMs(r.releasedAt);
    if (!Number.isFinite(at) || at < cutoff || at > failure.getTime()) continue;
    const donorKey = String(r.donorId);
    if (openDonors.has(donorKey) || seen.has(donorKey)) continue;
    seen.add(donorKey);
    out.push(r);
  }
  return out;
};

module.exports = {
  canTransition,
  expiresAtFor,
  isPastExpiry,
  nextReminderAt,
  nextNudgeAt,
  nudgeCooldownRemainingMs,
  isAcceptedFamily,
  isActive,
  canChat,
  latestFailureAt,
  eligibleForBulkRenotify,
};

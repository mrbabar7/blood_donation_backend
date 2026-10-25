// Donation lifecycle: canonical statuses, groups and timing policy.
//
// The state lives in ONE place, DonationRequest.status (models/formModel.js). Every
// other layer (API, worker, app) reads these groups instead of re-deriving them.

const STATUS = Object.freeze({
  PENDING: "pending", // "Notified": waiting for the donor, expires 12 h after requestedAt
  ACCEPTED: "accepted",
  LOCKED: "locked", // "Locked by Seeker"
  ON_HOLD: "on_hold", // locked, but the donor is busy with another seeker's donation
  DONATION_STARTED: "donation_started", // donor pressed "Donation Started"; seeker must agree
  //                                       (= "waiting_for_seeker_agreement" in the product brief)
  SEEKER_NOT_YET: "seeker_not_yet", // seeker answered "Not Yet"; donor may message / nudge, never re-start
  DONATION_AGREED: "donation_agreed", // seeker agreed; Mark Complete / I have donated enabled
  COMPLETED: "completed",
  REJECTED: "rejected",
  EXPIRED: "expired",
  RELEASED: "released", // "Released by Seeker" (normal release)
  AUTO_RELEASED: "auto_released", // donor donated to another seeker; permanent
  DONOR_UNABLE: "donor_unable", // donor: "I can't donate at this time" (NOT an allegation)
  REPORTED: "reported", // seeker allegation (delay); never bulk re-notified
  CANCELLED_BY_SEEKER: "cancelled_by_seeker", // legacy (removed emergency broadcast)
});

const RELEASE_REASON = Object.freeze({
  SEEKER_RELEASED: "seeker_released",
  AUTO_OTHER_DONATION: "auto_other_donation",
  DONOR_UNABLE: "donor_unable",
  SEEKER_REPORTED: "seeker_reported",
});

// A seeker may not send another request to the same donor while one of these is open.
const ACTIVE_STATUSES = Object.freeze([
  STATUS.PENDING,
  STATUS.ACCEPTED,
  STATUS.LOCKED,
  STATUS.ON_HOLD,
  STATUS.DONATION_STARTED,
  STATUS.SEEKER_NOT_YET,
  STATUS.DONATION_AGREED,
]);

// The donor said yes: contact details are revealed and the existing chat is open.
const ACCEPTED_FAMILY = Object.freeze([
  STATUS.ACCEPTED,
  STATUS.LOCKED,
  STATUS.ON_HOLD,
  STATUS.DONATION_STARTED,
  STATUS.SEEKER_NOT_YET,
  STATUS.DONATION_AGREED,
]);

// Statuses in which the existing chat (/chat/:requestId) works.
const CHAT_STATUSES = Object.freeze([...ACCEPTED_FAMILY, STATUS.COMPLETED]);

// Statuses that count as the donor's "current donation process" for the seeker's Active tab.
const FAILED_STATUSES = Object.freeze([STATUS.DONOR_UNABLE, STATUS.REPORTED]);

// A request in one of these has left the active flow (history / Notify-or-Re-notify again).
const TERMINAL_STATUSES = Object.freeze([
  STATUS.COMPLETED,
  STATUS.REJECTED,
  STATUS.EXPIRED,
  STATUS.RELEASED,
  STATUS.AUTO_RELEASED,
  STATUS.DONOR_UNABLE,
  STATUS.REPORTED,
  STATUS.CANCELLED_BY_SEEKER,
]);

// Legal transitions. Every state change in the system must be one of these; the service
// layer additionally performs each one as a conditional (compare-and-set) update.
const TRANSITIONS = Object.freeze({
  [STATUS.PENDING]: [STATUS.ACCEPTED, STATUS.REJECTED, STATUS.EXPIRED],
  [STATUS.ACCEPTED]: [STATUS.LOCKED, STATUS.RELEASED],
  [STATUS.LOCKED]: [
    STATUS.DONATION_STARTED,
    STATUS.ON_HOLD,
    STATUS.RELEASED,
    STATUS.DONOR_UNABLE,
    STATUS.REPORTED,
    STATUS.AUTO_RELEASED,
  ],
  [STATUS.ON_HOLD]: [STATUS.LOCKED, STATUS.RELEASED, STATUS.DONOR_UNABLE, STATUS.AUTO_RELEASED],
  [STATUS.DONATION_STARTED]: [
    STATUS.DONATION_AGREED,
    STATUS.SEEKER_NOT_YET, // seeker pressed "Not Yet" (the donor stays engaged; no second start)
    STATUS.LOCKED, // legacy: older builds sent "not agreed" back to Locked
    STATUS.DONOR_UNABLE, // donor cancels the attempt
    STATUS.REPORTED,
  ],
  [STATUS.SEEKER_NOT_YET]: [
    STATUS.DONATION_AGREED, // seeker agrees after a message / reminder
    STATUS.DONOR_UNABLE,
    STATUS.REPORTED,
  ],
  [STATUS.DONATION_AGREED]: [STATUS.COMPLETED, STATUS.DONOR_UNABLE, STATUS.REPORTED],
  [STATUS.RELEASED]: [STATUS.PENDING], // bulk "Re-notify Released Donors" only
  [STATUS.COMPLETED]: [],
  [STATUS.REJECTED]: [],
  [STATUS.EXPIRED]: [],
  [STATUS.AUTO_RELEASED]: [],
  [STATUS.DONOR_UNABLE]: [],
  [STATUS.REPORTED]: [],
  [STATUS.CANCELLED_BY_SEEKER]: [],
});

// ---- Timing policy -------------------------------------------------------------------
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

// Product rule, deliberately NOT configurable: a request lives exactly 12 hours.
const REQUEST_TTL_MS = 12 * HOUR_MS;
// Product rule: reminder cadence once the donor marked the donation.
const REMINDER_INTERVAL_MS = 6 * HOUR_MS;
// Product rule: normally released donors are re-notifiable for 12 hours.
const RENOTIFY_WINDOW_MS = 12 * HOUR_MS;
// Product rule: a donor may remind the seeker at most once per 10 minutes (server-enforced).
const NUDGE_COOLDOWN_MS = 10 * MIN_MS;
// Product rule: from the 2nd "Not Yet" the donor gets escalation guidance (+ Call Seeker).
const ESCALATE_AFTER_NOT_YET = 2;

const envNumber = (name, fallback, { min, max }) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

// ---- Configurable policy (FLAGGED FOR PRODUCT CONFIRMATION) --------------------------
// The brief says "use the existing policy if there is one, otherwise expose it as
// configuration". No existing policy covers these three, so they are configuration with
// the defaults below. Read lazily so tests / ops can change the env without a restart of
// the module cache.
const policy = () => ({
  // How long a reported donor cannot accept NEW requests.
  donorReportBlockMs: envNumber("DONOR_REPORT_BLOCK_HOURS", 24, { min: 1, max: 24 * 30 }) * HOUR_MS,
  // After the donor marks "I have donated blood", how long the seeker may leave it
  // unconfirmed before new requests are blocked ("complete your previous request").
  seekerCompleteBlockAfterMs:
    envNumber("SEEKER_COMPLETE_BLOCK_AFTER_HOURS", 24, { min: 1, max: 24 * 14 }) * HOUR_MS,
  // Minimum time after locking before a seeker may report a delay (0 disables the guard).
  reportMinWaitMs: envNumber("REPORT_MIN_WAIT_MINUTES", 30, { min: 0, max: 24 * 60 }) * MIN_MS,
  // Background worker cadence.
  workerIntervalMs: envNumber("LIFECYCLE_WORKER_INTERVAL_SEC", 15, { min: 2, max: 600 }) * 1000,
});

module.exports = {
  STATUS,
  RELEASE_REASON,
  ACTIVE_STATUSES,
  ACCEPTED_FAMILY,
  CHAT_STATUSES,
  FAILED_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  REQUEST_TTL_MS,
  REMINDER_INTERVAL_MS,
  RENOTIFY_WINDOW_MS,
  NUDGE_COOLDOWN_MS,
  ESCALATE_AFTER_NOT_YET,
  HOUR_MS,
  MIN_MS,
  policy,
};

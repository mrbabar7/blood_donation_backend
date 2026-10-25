// Post-donation recovery ("resting") interval.
//
// PRODUCT / MEDICAL NOTE: the number of days a donor must rest between
// donations is a policy decision, not a universal medical rule (it varies by
// country, blood-bank guideline and donation type). It is therefore NOT
// hard-coded in business logic any more: every place that needs it calls
// getRecoveryDays(), and the value is set with the DONOR_RECOVERY_DAYS
// environment variable.
//
// Until product/medical confirm the approved interval, the fallback below keeps
// the behaviour the app already had (90 days), so nothing changes silently on
// deploy. Change it by setting DONOR_RECOVERY_DAYS (whole days, 1-365).
const FALLBACK_RECOVERY_DAYS = 90;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

let warned = false;

function getRecoveryDays() {
  const raw = process.env.DONOR_RECOVERY_DAYS;
  if (raw === undefined || String(raw).trim() === "") return FALLBACK_RECOVERY_DAYS;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= MIN_DAYS && n <= MAX_DAYS) return n;
  if (!warned) {
    warned = true;
    console.warn(
      `[recoveryPolicy] Ignoring invalid DONOR_RECOVERY_DAYS="${raw}" (expected a whole number ${MIN_DAYS}-${MAX_DAYS}); using ${FALLBACK_RECOVERY_DAYS}.`,
    );
  }
  return FALLBACK_RECOVERY_DAYS;
}

module.exports = { getRecoveryDays, FALLBACK_RECOVERY_DAYS };

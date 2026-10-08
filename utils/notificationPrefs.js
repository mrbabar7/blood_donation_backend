// Notification preferences + quiet hours (Profile > Notification preferences).
//
// Categories a caller can tag a notification with. Anything untagged (or
// tagged "critical" / "system") is always delivered — that keeps every existing
// call site behaving exactly as before until it opts in to a category.
const CATEGORY_TO_PREF = {
  requests: "newRequests",
  status: "statusChanges",
  nearby: "nearbyBroadcasts",
  chat: "chatMessages",
  calls: "incomingCalls",
  leaderboard: "leaderboard",
  eligibility: "eligibilityReminders",
};

const DEFAULT_PREFS = {
  newRequests: true,
  statusChanges: true,
  nearbyBroadcasts: true,
  chatMessages: true,
  incomingCalls: true,
  leaderboard: false,
  eligibilityReminders: true,
};
const DEFAULT_QUIET = { enabled: true, startHour: 23, endHour: 6 };

// Pakistan has no DST; quiet hours are read in PKT (UTC+5) so "11 PM – 6 AM"
// means what the user sees on their clock, regardless of the server's zone.
const QUIET_TZ_OFFSET_HOURS = Number(process.env.QUIET_HOURS_TZ_OFFSET || 5);

const readPrefs = (user) => ({ ...DEFAULT_PREFS, ...((user && user.notificationPrefs && (user.notificationPrefs.toObject ? user.notificationPrefs.toObject() : user.notificationPrefs)) || {}) });
const readQuiet = (user) => ({ ...DEFAULT_QUIET, ...((user && user.quietHours && (user.quietHours.toObject ? user.quietHours.toObject() : user.quietHours)) || {}) });

const localHour = (now = new Date()) => (now.getUTCHours() + QUIET_TZ_OFFSET_HOURS + 24) % 24;

const inQuietHours = (user, now = new Date()) => {
  const q = readQuiet(user);
  if (!q.enabled || q.startHour === q.endHour) return false;
  const h = localHour(now);
  return q.startHour < q.endHour ? h >= q.startHour && h < q.endHour : h >= q.startHour || h < q.endHour;
};

// { inApp, push } for one notification.
//  - category off            -> nothing at all
//  - critical / untagged     -> in-app + push, quiet hours ignored
//  - other, inside quiet hrs -> in-app only (push held back until morning)
const decide = (user, category, critical = false) => {
  if (critical || !category || !CATEGORY_TO_PREF[category]) return { inApp: true, push: true };
  if (readPrefs(user)[CATEGORY_TO_PREF[category]] === false) return { inApp: false, push: false };
  return { inApp: true, push: !inQuietHours(user) };
};

const chatPushAllowed = (user) => decide(user, "chat").push;
// Incoming-call PUSH (the app-closed ring). The live socket ring is unaffected.
const callPushAllowed = (user) => readPrefs(user).incomingCalls !== false;

module.exports = { DEFAULT_PREFS, DEFAULT_QUIET, readPrefs, readQuiet, inQuietHours, decide, chatPushAllowed, callPushAllowed, CATEGORY_TO_PREF };

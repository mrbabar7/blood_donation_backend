// High-level, SAFE email API used by controllers/services.
//
// Everything here is fire-and-forget: it never throws, never blocks the
// request that triggered it, and silently skips users without an email
// address. A mail-server problem can therefore never break an existing flow
// (sign-up, requests, donations…). Disable all activity emails at once with
// EMAIL_NOTIFICATIONS_ENABLED=false in .env.
const { render } = require("./templates");
const { queueEmail } = require("./emailService");

const enabled = () =>
  process.env.EMAIL_NOTIFICATIONS_ENABLED !== "false" &&
  !!process.env.EMAIL_USER &&
  !!process.env.EMAIL_PASS;

// Lazy-required to avoid circular imports with models/controllers.
const User = () => require("../models/userMode");

// Language for an email: the app's X-Lang header on the current request when
// present, else the language we last saw this user use, else English.
const headerLang = (req) => {
  const h = req && req.headers && (req.headers["x-lang"] || req.headers["X-Lang"]);
  return h ? (String(h).toLowerCase() === "ur" ? "ur" : "en") : null;
};
const langFor = (user, req) => headerLang(req) || (user && user.language === "ur" ? "ur" : "en");

// Remember the user's app language (from X-Lang) so emails triggered by OTHER
// people's actions (e.g. a donor replying to your request) use it too.
const rememberLang = (user, req) => {
  try {
    const l = headerLang(req);
    if (!l || !user || user.language === l) return;
    User().updateOne({ _id: user._id }, { $set: { language: l } }).catch(() => {});
  } catch (_) {}
};

// Render + queue one email. `to` is an address.
const sendTemplate = (to, key, data = {}, lang = "en") => {
  try {
    if (!enabled() || !to) return false;
    const { subject, html } = render(key, data, lang);
    return queueEmail(to, subject, html);
  } catch (err) {
    console.error(`[mailer] ${key} failed:`, err && err.message);
    return false;
  }
};

// Look the user up by id and send. `extra(user)` can add data from the user doc.
const sendToUser = async (userId, key, data = {}, { req = null, lang = null } = {}) => {
  try {
    if (!enabled() || !userId) return false;
    const user = await User().findById(userId).select("name email language").lean();
    if (!user || !user.email) return false;
    return sendTemplate(user.email, key, { name: user.name, ...data }, lang || langFor(user, req));
  } catch (err) {
    console.error(`[mailer] sendToUser ${key} failed:`, err && err.message);
    return false;
  }
};

// "You signed in" security email (password and Google logins). Turn off with
// EMAIL_LOGIN_ALERTS=false in .env. Fire-and-forget, never throws.
const describeDevice = (ua = "") => {
  const s = String(ua);
  if (!s) return "";
  const os = /iPhone|iPad|iOS/i.test(s) ? "iOS" : /Android/i.test(s) ? "Android" : /Windows/i.test(s) ? "Windows" : /Mac OS|Macintosh/i.test(s) ? "macOS" : /Linux/i.test(s) ? "Linux" : "";
  const app = /Expo|okhttp|CFNetwork|Dalvik/i.test(s) ? "Mobile app" : /Edg\//.test(s) ? "Edge" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "";
  return [app, os].filter(Boolean).join(" · ") || s.slice(0, 60);
};
const sendLoginAlert = (user, req, method = "password") => {
  try {
    if (process.env.EMAIL_LOGIN_ALERTS === "false" || !user || !user.email) return false;
    return sendTemplate(
      user.email,
      "loginAlert",
      {
        name: user.name,
        method,
        device: describeDevice(req && req.headers && req.headers["user-agent"]),
        ip: String((req && req.ip) || "").replace(/^::ffff:/, ""),
        when: new Date(),
      },
      langFor(user, req),
    );
  } catch (err) {
    console.error("[mailer] login alert failed:", err && err.message);
    return false;
  }
};

// ---------------------------------------------------------------------------
// Activity emails — mirror every in-app notification to the user's inbox.
// Called from the two notification choke points:
//   controllers/notificationController.createNotification
//   services/donationLifecycle/notify.notifyUser
// ---------------------------------------------------------------------------
// Chatty / ephemeral categories & events that should stay in-app only.
const SKIP_CATEGORIES = new Set(["chat", "calls"]);
const recent = new Map();
const DEDUPE_MS = 60 * 1000;
const seenRecently = (key) => {
  const now = Date.now();
  if (recent.size > 2000) {
    for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
  }
  const t = recent.get(key);
  if (t && now - t < DEDUPE_MS) return true;
  recent.set(key, now);
  return false;
};

const emailActivity = async ({ userId, title, message, type = null, category = null, requestId = null }) => {
  try {
    if (!enabled() || !userId || !message) return false;
    if (category && SKIP_CATEGORIES.has(category)) return false;
    if (seenRecently(`${userId}|${type || title}|${requestId || ""}`)) return false;
    return await sendToUser(userId, "activity", { type, title, message });
  } catch (err) {
    console.error("[mailer] activity email failed:", err && err.message);
    return false;
  }
};

module.exports = { sendLoginAlert, sendTemplate, sendToUser, emailActivity, rememberLang, langFor, headerLang, enabled };

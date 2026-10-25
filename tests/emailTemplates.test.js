const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { render, TEMPLATES, TYPE_MAP, } = require("../email-sender/templates");

const SAMPLE = {
  otp: { purpose: "reset", name: "Ali", code: "123456" },
  welcome: { name: "Ali" },
  passwordChanged: { name: "Ali", via: "reset", when: new Date() },
  loginAlert: { name: "Ali", method: "google", device: "Chrome · Windows", ip: "1.2.3.4", when: new Date() },
  emailChangedOld: { name: "Ali", newEmail: "new@example.com", when: new Date() },
  emailChangedNew: { name: "Ali" },
  accountDeleted: { name: "Ali", when: new Date() },
  donorRegistered: { name: "Ali", bloodType: "O+", city: "Lahore" },
  donorRemoved: { name: "Ali" },
  requestPosted: { name: "Ali", bloodType: "A-", city: "Lahore", hospital: "Mayo", units: 2, mode: "emergency", notified: 5 },
  contactAck: { name: "Ali", reference: "SUP-AB12C", subject: "Hi" },
  supportReply: { name: "Ali", agent: "Hina", text: "Hello" },
  supportResolved: { name: "Ali" },
  activity: { name: "Ali", type: "request_accepted", title: "Accepted", message: "Donor X accepted." },
};

test("every template renders in English and Urdu with no leftover placeholders", () => {
  for (const key of Object.keys(TEMPLATES)) {
    for (const lang of ["en", "ur"]) {
      const { subject, html } = render(key, SAMPLE[key], lang);
      assert.ok(subject && subject.length > 3, `${key}/${lang} subject`);
      assert.ok(html.includes("<!doctype html>"), `${key}/${lang} html`);
      assert.ok(!/\{[a-zA-Z]+\}/.test(html.replace(/<style[\s\S]*?<\/style>/g, "")), `${key}/${lang} leftover placeholder`);
      if (lang === "ur") assert.ok(html.includes('dir="rtl"'), `${key} rtl`);
    }
  }
});

test("every activity type renders", () => {
  for (const type of Object.keys(TYPE_MAP)) render("activity", { name: "A", type, title: "T", message: "M" }, "en");
  render("activity", { name: "A", title: "Anything", message: "unknown event" }, "en");
});

test("user-supplied text is escaped", () => {
  const { html } = render("supportReply", { name: "<img src=x onerror=1>", text: "<script>alert(1)</script> $& $1" }, "en");
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("$&amp;") || html.includes("$&"), "$& survives literally");
});

test("bilingual body picks the right line", () => {
  const body = "ڈونر نے قبول کر لیا\nA donor accepted";
  assert.ok(render("activity", { name: "A", type: "request_accepted", title: "t", message: body }, "en").html.includes("A donor accepted"));
  assert.ok(render("activity", { name: "A", type: "request_accepted", title: "t", message: body }, "ur").html.includes("ڈونر نے قبول کر لیا"));
});

test("legacy OTP/contact templates still fill via fill()", () => {
  const { fill } = require("../email-sender/brand");
  const { contactTemplate } = require("../email-sender/contactEmailTemplate");
  const html = fill(contactTemplate, { name: "<b>x</b>", email: "a@b.c", subject: "s", message: "m\nm" });
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
});

// ---- mailer behaviour with stubbed mail transport + user model -------------
const sent = [];
const stub = (rel, exports) => {
  const id = require.resolve(path.join("..", rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
stub("email-sender/emailService.js", { queueEmail: (to, subject, html) => (sent.push({ to, subject, html }), true), sendingEmail: async () => {} });
const users = {
  u1: { _id: "u1", name: "Ali", email: "ali@example.com", language: "ur" },
  u2: { _id: "u2", name: "NoMail", email: undefined },
};
stub("models/userMode.js", {
  findById: (id) => ({ select: () => ({ lean: async () => users[id] || null }) }),
  updateOne: () => ({ catch() {} }),
});
process.env.EMAIL_USER = "x@y.z";
process.env.EMAIL_PASS = "p";
const mailer = require("../email-sender/mailer");

test("activity emails: sent to user in their language, deduped, skips chat & phone-only users", async () => {
  sent.length = 0;
  assert.equal(await mailer.emailActivity({ userId: "u1", title: "T", message: "M", type: "request_received", requestId: "r1" }), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ali@example.com");
  assert.ok(sent[0].html.includes('lang="ur"'));
  // duplicate within a minute
  await mailer.emailActivity({ userId: "u1", title: "T", message: "M", type: "request_received", requestId: "r1" });
  assert.equal(sent.length, 1);
  // chat is in-app only
  await mailer.emailActivity({ userId: "u1", title: "T", message: "M", category: "chat" });
  // user without email
  assert.equal(await mailer.emailActivity({ userId: "u2", title: "T", message: "M", type: "request_accepted" }), false);
  assert.equal(sent.length, 1);
});

test("mailer never throws", async () => {
  assert.equal(mailer.sendTemplate("a@b.c", "doesNotExist", {}, "en"), false);
  assert.equal(await mailer.sendToUser("missing", "welcome", {}), false);
});

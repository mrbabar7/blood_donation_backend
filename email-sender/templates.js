// Every transactional email the app can send, in English and Urdu.
//
//   render(key, data, lang) -> { subject, html }
//
// All user-supplied values are HTML-escaped. Visuals come from brand.js, so a
// design change happens in exactly one file. Add a new email by adding one
// entry to TEMPLATES below (and calling mailer.sendTemplate(...)).
const {
  APP_NAME,
  APP_URL,
  COLORS,
  wrap,
  esc,
  heading,
  para,
  badge,
  button,
  infoCard,
  notice,
  codeBox,
  hr,
  alignOf,
} = require("./brand");

const pick = (lang, en, ur) => (lang === "ur" ? ur : en);
const hello = (lang, name) =>
  pick(lang, `Hello ${esc(name || "there")},`, `السلام علیکم ${esc(name || "محترم صارف")}،`);
const openApp = (lang) => pick(lang, `Open ${APP_NAME}`, `${APP_NAME} کھولیں`);
const fmtDate = (d, lang) => {
  try {
    return new Date(d || Date.now()).toLocaleString(lang === "ur" ? "ur-PK" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Karachi",
    });
  } catch (_) {
    return "";
  }
};

// ---------------------------------------------------------------------------
// ACCOUNT & SECURITY
// ---------------------------------------------------------------------------
const OTP_COPY = {
  verify: {
    subject: ["Verify Your Account", "اپنے اکاؤنٹ کی تصدیق کریں"],
    head: ["Verify your email address", "اپنے ای میل ایڈریس کی تصدیق کریں"],
    intro: [
      "Enter this code in the app to verify your account and get started.",
      "اپنے اکاؤنٹ کی تصدیق کے لیے یہ کوڈ ایپ میں درج کریں۔",
    ],
  },
  resend: {
    subject: ["New Verification Code", "نیا تصدیقی کوڈ"],
    head: ["Your new verification code", "آپ کا نیا تصدیقی کوڈ"],
    intro: ["Here is your new verification code.", "یہ آپ کا نیا تصدیقی کوڈ ہے۔"],
  },
  reset: {
    subject: ["Password Reset Code", "پاس ورڈ ری سیٹ کوڈ"],
    head: ["Reset your password", "اپنا پاس ورڈ ری سیٹ کریں"],
    intro: [
      "We received a request to reset your password. Enter this code in the app to continue.",
      "ہمیں آپ کا پاس ورڈ ری سیٹ کرنے کی درخواست موصول ہوئی ہے۔ جاری رکھنے کے لیے یہ کوڈ ایپ میں درج کریں۔",
    ],
  },
  emailChange: {
    subject: ["Verify Your New Email Address", "اپنے نئے ای میل ایڈریس کی تصدیق کریں"],
    head: ["Confirm your new email address", "اپنے نئے ای میل ایڈریس کی تصدیق کریں"],
    intro: [
      "Enter this code in the app to confirm this address for your account.",
      "اس ایڈریس کو اپنے اکاؤنٹ کے لیے تصدیق کرنے کے لیے یہ کوڈ ایپ میں درج کریں۔",
    ],
  },
};

const otp = ({ purpose = "verify", name, code, minutes = 5 }, lang) => {
  const c = OTP_COPY[purpose] || OTP_COPY.verify;
  const i = lang === "ur" ? 1 : 0;
  return {
    subject: `🩸 ${APP_NAME} – ${c.subject[i]}`,
    preheader: `${c.head[i]}: ${code}`,
    body: [
      heading(c.head[i], lang),
      para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
      para(c.intro[i], lang),
      codeBox(code),
      `<div style="text-align:center; margin:12px 0 18px; font-size:14px; font-weight:700; color:${COLORS.coral};">${pick(
        lang,
        `This code expires in ${minutes} minutes`,
        `یہ کوڈ ${minutes} منٹ میں ختم ہو جائے گا`,
      )}</div>`,
      notice(
        pick(
          lang,
          `For your security, never share this code with anyone — ${APP_NAME} will never ask for it. If you didn't request it, you can safely ignore this email.`,
          `آپ کی حفاظت کے لیے یہ کوڈ کسی کے ساتھ شیئر نہ کریں — ${APP_NAME} آپ سے کبھی یہ کوڈ نہیں مانگے گا۔ اگر آپ نے یہ درخواست نہیں کی تو اس ای میل کو نظر انداز کر دیں۔`,
        ),
        "info",
        lang,
      ),
    ].join(""),
  };
};

const welcome = ({ name }, lang) => ({
  subject: pick(lang, `🩸 Welcome to ${APP_NAME}`, `🩸 ${APP_NAME} میں خوش آمدید`),
  preheader: pick(lang, "Your account is verified and ready.", "آپ کا اکاؤنٹ تصدیق شدہ اور تیار ہے۔"),
  body: [
    badge(pick(lang, "ACCOUNT VERIFIED", "اکاؤنٹ تصدیق شدہ"), COLORS.success),
    heading(pick(lang, `Welcome to ${APP_NAME}`, `${APP_NAME} میں خوش آمدید`), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    para(
      pick(
        lang,
        "Thank you for joining our community of donors and seekers. Your email is verified and your account is ready to use. Here is what you can do:",
        "عطیہ دہندگان اور ضرورت مندوں کی ہماری کمیونٹی میں شامل ہونے کا شکریہ۔ آپ کا ای میل تصدیق شدہ ہے اور اکاؤنٹ استعمال کے لیے تیار ہے۔ آپ یہ کر سکتے ہیں:",
      ),
      lang,
    ),
    infoCard(
      [
        [pick(lang, "Find donors", "عطیہ دہندہ تلاش کریں"), pick(lang, "Search verified donors near you by blood group", "اپنے قریب خون کے گروپ کے مطابق تصدیق شدہ عطیہ دہندگان تلاش کریں")],
        [pick(lang, "Emergency", "ہنگامی درخواست"), pick(lang, "Alert nearby donors instantly when blood is urgently needed", "خون کی فوری ضرورت پر قریبی عطیہ دہندگان کو فوراً اطلاع دیں")],
        [pick(lang, "Become a donor", "عطیہ دہندہ بنیں"), pick(lang, "Register as a donor and help save lives", "بطور عطیہ دہندہ رجسٹر ہوں اور زندگیاں بچائیں")],
      ],
      lang,
    ),
    button(APP_URL, openApp(lang), { lang }),
  ].join(""),
});

const passwordChanged = ({ name, via = "change", when }, lang) => ({
  subject: pick(lang, `🔐 ${APP_NAME} – Your password was changed`, `🔐 ${APP_NAME} – آپ کا پاس ورڈ تبدیل کر دیا گیا`),
  preheader: pick(lang, "Your password was just updated.", "آپ کا پاس ورڈ ابھی اپڈیٹ ہوا ہے۔"),
  body: [
    badge(pick(lang, "SECURITY", "سکیورٹی"), COLORS.indigo),
    heading(pick(lang, "Your password was changed", "آپ کا پاس ورڈ تبدیل ہو گیا"), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    para(
      via === "reset"
        ? pick(lang, "Your password was successfully reset. You have been signed out of all devices — please sign in with your new password.", "آپ کا پاس ورڈ کامیابی سے ری سیٹ ہو گیا ہے۔ تمام آلات سے آپ کو سائن آؤٹ کر دیا گیا ہے — براہِ کرم نئے پاس ورڈ سے سائن اِن کریں۔")
        : pick(lang, "Your password was successfully changed. Other devices have been signed out for your security.", "آپ کا پاس ورڈ کامیابی سے تبدیل ہو گیا ہے۔ آپ کی حفاظت کے لیے دیگر آلات سائن آؤٹ کر دیے گئے ہیں۔"),
      lang,
    ),
    infoCard([[pick(lang, "When", "وقت"), fmtDate(when, lang)]], lang, COLORS.indigo),
    notice(
      pick(lang, "If you did not do this, reset your password immediately from the app and contact our support team.", "اگر یہ آپ نے نہیں کیا تو فوراً ایپ سے اپنا پاس ورڈ ری سیٹ کریں اور ہماری سپورٹ ٹیم سے رابطہ کریں۔"),
      "danger",
      lang,
    ),
  ].join(""),
});

const loginAlert = ({ name, method = "password", device, ip, when }, lang) => ({
  subject: pick(lang, `🔐 ${APP_NAME} – New sign-in to your account`, `🔐 ${APP_NAME} – آپ کے اکاؤنٹ میں نیا سائن اِن`),
  preheader: pick(lang, "We noticed a sign-in to your account.", "ہم نے آپ کے اکاؤنٹ میں سائن اِن دیکھا ہے۔"),
  body: [
    badge(pick(lang, "SIGN-IN", "سائن اِن"), COLORS.indigo),
    heading(pick(lang, "You signed in successfully", "آپ نے کامیابی سے سائن اِن کیا"), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    para(
      pick(lang, "Your account was just signed in to. If this was you, no action is needed.", "ابھی آپ کے اکاؤنٹ میں سائن اِن کیا گیا ہے۔ اگر یہ آپ ہی تھے تو کچھ کرنے کی ضرورت نہیں۔"),
      lang,
    ),
    infoCard(
      [
        [pick(lang, "Method", "طریقہ"), method === "google" ? "Google" : pick(lang, "Email & password", "ای میل اور پاس ورڈ")],
        [pick(lang, "Device", "آلہ"), device],
        [pick(lang, "IP address", "آئی پی ایڈریس"), ip],
        [pick(lang, "When", "وقت"), fmtDate(when, lang)],
      ],
      lang,
      COLORS.indigo,
    ),
    notice(
      pick(lang, "Wasn't you? Change your password right away from the app and contact our support team.", "یہ آپ نہیں تھے؟ فوراً ایپ سے اپنا پاس ورڈ تبدیل کریں اور ہماری سپورٹ ٹیم سے رابطہ کریں۔"),
      "danger",
      lang,
    ),
  ].join(""),
});

const emailChangedOld = ({ name, newEmail, when }, lang) => ({
  subject: pick(lang, `🔐 ${APP_NAME} – Your account email was changed`, `🔐 ${APP_NAME} – آپ کے اکاؤنٹ کا ای میل تبدیل ہو گیا`),
  preheader: pick(lang, "Your sign-in email address was updated.", "آپ کا سائن اِن ای میل ایڈریس اپڈیٹ ہوا۔"),
  body: [
    badge(pick(lang, "SECURITY", "سکیورٹی"), COLORS.indigo),
    heading(pick(lang, "Your account email was changed", "آپ کے اکاؤنٹ کا ای میل تبدیل ہو گیا"), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    para(
      pick(lang, "The email address on your account was changed. This address will no longer receive emails from us.", "آپ کے اکاؤنٹ کا ای میل ایڈریس تبدیل کر دیا گیا ہے۔ اب اس ایڈریس پر ہماری ای میلز موصول نہیں ہوں گی۔"),
      lang,
    ),
    infoCard(
      [
        [pick(lang, "New email", "نیا ای میل"), newEmail],
        [pick(lang, "When", "وقت"), fmtDate(when, lang)],
      ],
      lang,
      COLORS.indigo,
    ),
    notice(
      pick(lang, "If you did not make this change, contact our support team immediately.", "اگر یہ تبدیلی آپ نے نہیں کی تو فوراً ہماری سپورٹ ٹیم سے رابطہ کریں۔"),
      "danger",
      lang,
    ),
  ].join(""),
});

const emailChangedNew = ({ name }, lang) => ({
  subject: pick(lang, `✅ ${APP_NAME} – Email address updated`, `✅ ${APP_NAME} – ای میل ایڈریس اپڈیٹ ہو گیا`),
  preheader: pick(lang, "This address is now linked to your account.", "یہ ایڈریس اب آپ کے اکاؤنٹ سے منسلک ہے۔"),
  body: [
    badge(pick(lang, "CONFIRMED", "تصدیق شدہ"), COLORS.success),
    heading(pick(lang, "Email address updated", "ای میل ایڈریس اپڈیٹ ہو گیا"), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    para(
      pick(lang, "This email address is now linked to your account. You will receive all account and request updates here from now on.", "یہ ای میل ایڈریس اب آپ کے اکاؤنٹ سے منسلک ہے۔ اب سے اکاؤنٹ اور درخواستوں کی تمام اطلاعات یہیں موصول ہوں گی۔"),
      lang,
    ),
    button(APP_URL, openApp(lang), { lang }),
  ].join(""),
});

const accountDeleted = ({ name, when }, lang) => ({
  subject: pick(lang, `${APP_NAME} – Your account has been deleted`, `${APP_NAME} – آپ کا اکاؤنٹ حذف کر دیا گیا`),
  preheader: pick(lang, "Your account and donor profile were permanently deleted.", "آپ کا اکاؤنٹ اور عطیہ دہندہ پروفائل مستقل طور پر حذف کر دیے گئے۔"),
  body: [
    badge(pick(lang, "ACCOUNT DELETED", "اکاؤنٹ حذف"), COLORS.slate),
    heading(pick(lang, "Your account has been deleted", "آپ کا اکاؤنٹ حذف کر دیا گیا"), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    para(
      pick(lang, "As requested, your account and donor profile have been permanently deleted. We're sorry to see you go, and thank you for being part of the community.", "آپ کی درخواست کے مطابق آپ کا اکاؤنٹ اور عطیہ دہندہ پروفائل مستقل طور پر حذف کر دیے گئے ہیں۔ آپ کے جانے کا ہمیں افسوس ہے، اور کمیونٹی کا حصہ بننے کا شکریہ۔"),
      lang,
    ),
    infoCard([[pick(lang, "Deleted on", "حذف کرنے کی تاریخ"), fmtDate(when, lang)]], lang, COLORS.slate),
    para(
      pick(lang, "You are always welcome to create a new account and rejoin us. If you did not request this deletion, please contact support right away.", "آپ جب چاہیں نیا اکاؤنٹ بنا کر دوبارہ شامل ہو سکتے ہیں۔ اگر آپ نے یہ حذف کرنے کی درخواست نہیں کی تو براہِ کرم فوراً سپورٹ سے رابطہ کریں۔"),
      lang,
    ),
  ].join(""),
});

// ---------------------------------------------------------------------------
// DONOR PROFILE
// ---------------------------------------------------------------------------
const donorRegistered = ({ name, bloodType, city }, lang) => ({
  subject: pick(lang, `🩸 You're now a ${APP_NAME} donor`, `🩸 اب آپ ${APP_NAME} کے عطیہ دہندہ ہیں`),
  preheader: pick(lang, "Your donor profile is live.", "آپ کا عطیہ دہندہ پروفائل فعال ہو گیا ہے۔"),
  body: [
    badge(pick(lang, "DONOR PROFILE ACTIVE", "عطیہ دہندہ پروفائل فعال"), COLORS.teal),
    heading(pick(lang, "Thank you for becoming a donor", "عطیہ دہندہ بننے کا شکریہ"), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    para(
      pick(lang, "Your donor profile is now live. People who urgently need blood can find and contact you. You are saving lives just by being here.", "آپ کا عطیہ دہندہ پروفائل اب فعال ہے۔ خون کی فوری ضرورت والے لوگ آپ کو تلاش کر کے رابطہ کر سکتے ہیں۔ آپ کا یہاں ہونا ہی زندگیاں بچانے کا ذریعہ ہے۔"),
      lang,
    ),
    infoCard(
      [
        [pick(lang, "Blood group", "بلڈ گروپ"), bloodType, true],
        [pick(lang, "City", "شہر"), city],
      ],
      lang,
    ),
    notice(
      pick(lang, "Tip: keep your availability up to date in the app. After you donate, a recovery period applies before you can be requested again.", "مشورہ: ایپ میں اپنی دستیابی اپڈیٹ رکھیں۔ عطیہ دینے کے بعد دوبارہ درخواست سے پہلے آرام کی مدت لاگو ہوتی ہے۔"),
      "info",
      lang,
    ),
    button(APP_URL, openApp(lang), { lang }),
  ].join(""),
});

const donorRemoved = ({ name }, lang) => ({
  subject: pick(lang, `${APP_NAME} – Your donor profile was removed`, `${APP_NAME} – آپ کا عطیہ دہندہ پروفائل ہٹا دیا گیا`),
  preheader: pick(lang, "You are no longer listed as a donor.", "اب آپ عطیہ دہندہ کے طور پر درج نہیں ہیں۔"),
  body: [
    badge(pick(lang, "DONOR PROFILE", "عطیہ دہندہ پروفائل"), COLORS.slate),
    heading(pick(lang, "Your donor profile was removed", "آپ کا عطیہ دہندہ پروفائل ہٹا دیا گیا"), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    para(
      pick(lang, "Your donor profile has been removed and you will no longer receive blood requests. Your account is still active, and you can register as a donor again whenever you like.", "آپ کا عطیہ دہندہ پروفائل ہٹا دیا گیا ہے اور اب آپ کو خون کی درخواستیں موصول نہیں ہوں گی۔ آپ کا اکاؤنٹ فعال ہے اور آپ جب چاہیں دوبارہ عطیہ دہندہ کے طور پر رجسٹر ہو سکتے ہیں۔"),
      lang,
    ),
    button(APP_URL, openApp(lang), { lang, color: COLORS.indigo }),
  ].join(""),
});

// ---------------------------------------------------------------------------
// REQUEST CONFIRMATION (seeker)
// ---------------------------------------------------------------------------
const requestPosted = ({ name, bloodType, city, hospital, mode = "direct", notified, units }, lang) => {
  const modeLabel = {
    direct: pick(lang, "Direct request", "براہِ راست درخواست"),
    emergency: pick(lang, "Emergency request", "ہنگامی درخواست"),
  }[mode] || "";
  return {
    subject: pick(lang, `🩸 ${APP_NAME} – Your ${bloodType || "blood"} request is live`, `🩸 ${APP_NAME} – آپ کی ${bloodType || "خون"} کی درخواست بھیج دی گئی`),
    preheader: pick(lang, "We're reaching out to matching donors.", "ہم موزوں عطیہ دہندگان تک پہنچ رہے ہیں۔"),
    body: [
      badge(pick(lang, "REQUEST SENT", "درخواست بھیج دی گئی"), COLORS.teal),
      heading(pick(lang, "Your blood request is live", "آپ کی خون کی درخواست فعال ہے"), lang),
      para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
      para(
        pick(lang, "We've notified matching donors. You'll get an email and an in-app alert as soon as someone responds.", "ہم نے موزوں عطیہ دہندگان کو اطلاع دے دی ہے۔ کسی کے جواب دیتے ہی آپ کو ای میل اور ایپ الرٹ موصول ہوگا۔"),
        lang,
      ),
      infoCard(
        [
          [pick(lang, "Blood group", "بلڈ گروپ"), bloodType, true],
          [pick(lang, "Type", "قسم"), modeLabel],
          [pick(lang, "Units", "یونٹس"), units],
          [pick(lang, "Hospital", "ہسپتال"), hospital],
          [pick(lang, "City", "شہر"), city],
          [pick(lang, "Donors notified", "مطلع کیے گئے عطیہ دہندگان"), notified],
        ],
        lang,
        COLORS.coral,
      ),
      button(APP_URL, pick(lang, "Track request", "درخواست دیکھیں"), { lang }),
    ].join(""),
  };
};

// ---------------------------------------------------------------------------
// SUPPORT
// ---------------------------------------------------------------------------
const contactAck = ({ name, reference, subject }, lang) => ({
  subject: pick(lang, `${APP_NAME} – We received your message [${reference}]`, `${APP_NAME} – ہمیں آپ کا پیغام موصول ہو گیا [${reference}]`),
  preheader: pick(lang, "Our team will get back to you soon.", "ہماری ٹیم جلد آپ سے رابطہ کرے گی۔"),
  body: [
    badge(pick(lang, "MESSAGE RECEIVED", "پیغام موصول"), COLORS.teal),
    heading(pick(lang, "Thanks for contacting us", "ہم سے رابطہ کرنے کا شکریہ"), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    para(
      pick(lang, "We've received your message and our team will get back to you as soon as possible. Please keep your reference number for follow-ups.", "ہمیں آپ کا پیغام موصول ہو گیا ہے اور ہماری ٹیم جلد از جلد آپ سے رابطہ کرے گی۔ فالو اَپ کے لیے اپنا حوالہ نمبر محفوظ رکھیں۔"),
      lang,
    ),
    infoCard(
      [
        [pick(lang, "Reference", "حوالہ نمبر"), reference, true],
        [pick(lang, "Subject", "موضوع"), subject],
      ],
      lang,
    ),
  ].join(""),
});

const supportReply = ({ name, agent, text }, lang) => ({
  subject: pick(lang, `💬 ${APP_NAME} – New reply from support`, `💬 ${APP_NAME} – سپورٹ کی جانب سے نیا جواب`),
  preheader: String(text || "").slice(0, 90),
  body: [
    badge(pick(lang, "SUPPORT REPLY", "سپورٹ کا جواب"), COLORS.indigo),
    heading(pick(lang, "You have a new reply", "آپ کے لیے نیا جواب ہے"), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    `<div dir="auto" style="margin:6px 0 20px; padding:16px 18px; background:${COLORS.bg}; border:1px solid ${COLORS.border}; border-radius:10px; font-size:15px; line-height:1.7; color:${COLORS.ink}; white-space:pre-wrap;">${esc(text)}</div>`,
    agent ? para(pick(lang, `— ${esc(agent)}, ${APP_NAME} Support`, `— ${esc(agent)}، ${APP_NAME} سپورٹ`), lang, "font-size:13px;") : "",
    button(APP_URL, pick(lang, "Open conversation", "گفتگو کھولیں"), { lang }),
  ].join(""),
});

const supportResolved = ({ name }, lang) => ({
  subject: pick(lang, `✅ ${APP_NAME} – Your support conversation was resolved`, `✅ ${APP_NAME} – آپ کی سپورٹ گفتگو حل ہو گئی`),
  preheader: pick(lang, "We've marked your conversation as resolved.", "ہم نے آپ کی گفتگو کو حل شدہ قرار دے دیا ہے۔"),
  body: [
    badge(pick(lang, "RESOLVED", "حل شدہ"), COLORS.success),
    heading(pick(lang, "Your conversation was resolved", "آپ کی گفتگو حل ہو گئی"), lang),
    para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
    para(
      pick(lang, "We've marked your support conversation as resolved. If you still need help, just send us a new message from the app — we're happy to assist.", "ہم نے آپ کی سپورٹ گفتگو کو حل شدہ قرار دے دیا ہے۔ اگر آپ کو اب بھی مدد چاہیے تو ایپ سے ہمیں نیا پیغام بھیجیں — ہم خوشی سے مدد کریں گے۔"),
      lang,
    ),
  ].join(""),
});

// ---------------------------------------------------------------------------
// ACTIVITY (one layout, many events): requests, donations, reservations,
// broadcasts, reminders… Driven by the in-app notification that already
// exists for each event, so every activity the app notifies about also
// reaches the customer's inbox.
// ---------------------------------------------------------------------------
const KIND = {
  urgent: COLORS.coral,
  success: COLORS.success,
  info: COLORS.indigo,
  warn: COLORS.amber,
  neutral: COLORS.slate,
  danger: COLORS.coral,
};
const BADGE = {
  request: ["NEW REQUEST", "نئی درخواست"],
  emergency: ["EMERGENCY ALERT", "ہنگامی الرٹ"],
  reminder: ["REMINDER", "یاد دہانی"],
  cancelled: ["REQUEST CANCELLED", "درخواست منسوخ"],
  accepted: ["REQUEST ACCEPTED", "درخواست قبول"],
  declined: ["REQUEST DECLINED", "درخواست مسترد"],
  expired: ["REQUEST EXPIRED", "درخواست کی مدت ختم"],
  action: ["ACTION NEEDED", "آپ کی توجہ درکار"],
  thanks: ["THANK YOU", "شکریہ"],
  update: ["UPDATE", "اپڈیٹ"],
  notice: ["NOTICE", "نوٹس"],
  warning: ["WARNING", "انتباہ"],
  progress: ["IN PROGRESS", "جاری"],
};
// type (createNotification) -> look
const TYPE_MAP = {
  request_received: { kind: "urgent", badge: "request", head: ["A seeker needs your help", "ایک ضرورت مند کو آپ کی مدد چاہیے"], cta: ["View request", "درخواست دیکھیں"] },
  request_reminder: { kind: "warn", badge: "reminder", head: ["Urgent blood still needed", "خون کی فوری ضرورت اب بھی ہے"], cta: ["Respond now", "ابھی جواب دیں"] },
  request_cancelled: { kind: "neutral", badge: "cancelled", head: ["A request was cancelled", "ایک درخواست منسوخ کر دی گئی"] },
  request_accepted: { kind: "success", badge: "accepted", head: ["Good news — a donor accepted", "خوشخبری — ایک عطیہ دہندہ نے قبول کر لیا"], cta: ["View donor details", "عطیہ دہندہ کی تفصیل دیکھیں"] },
  request_rejected: { kind: "neutral", badge: "declined", head: ["A donor declined your request", "ایک عطیہ دہندہ نے آپ کی درخواست مسترد کر دی"], cta: ["Find another donor", "دوسرا عطیہ دہندہ تلاش کریں"] },
  request_expired: { kind: "warn", badge: "expired", head: ["Your request expired", "آپ کی درخواست کی مدت ختم ہو گئی"], cta: ["Send a new request", "نئی درخواست بھیجیں"] },
  donor_locked: { kind: "info", badge: "progress", head: ["You were locked for a donation", "آپ کو عطیے کے لیے لاک کیا گیا"], cta: ["View request", "درخواست دیکھیں"] },
  donor_released: { kind: "neutral", badge: "update", head: ["You were released", "آپ کو فارغ کر دیا گیا"] },
  donation_started: { kind: "info", badge: "action", head: ["Donation started, do you agree?", "عطیہ شروع، کیا آپ متفق ہیں؟"], cta: ["View request", "درخواست دیکھیں"] },
  donation_agreed: { kind: "success", badge: "update", head: ["The seeker agreed", "سیکر متفق ہے"], cta: ["View request", "درخواست دیکھیں"] },
  donation_not_agreed: { kind: "neutral", badge: "update", head: ["Waiting for the seeker", "سیکر کا انتظار"] },
  donor_nudge: { kind: "info", badge: "action", head: ["The donor is waiting for your confirmation", "ڈونر آپ کی تصدیق کا منتظر ہے"], cta: ["View request", "درخواست دیکھیں"] },
  donation_on_hold: { kind: "warn", badge: "update", head: ["Your request is on hold", "آپ کی درخواست روک دی گئی"] },
  donor_available_again: { kind: "success", badge: "update", head: ["The donor is available again", "ڈونر دوبارہ دستیاب ہے"], cta: ["View request", "درخواست دیکھیں"] },
  donor_auto_released: { kind: "neutral", badge: "update", head: ["The donor donated elsewhere", "ڈونر نے کہیں اور عطیہ دیا"] },
  donor_unable: { kind: "warn", badge: "update", head: ["The donor can't donate right now", "ڈونر اس وقت عطیہ نہیں دے سکتا"] },
  donor_reported: { kind: "warn", badge: "warning", head: ["A delay was reported", "تاخیر کی اطلاع دی گئی"] },
  request_renotified: { kind: "urgent", badge: "request", head: ["A seeker needs your help again", "سیکر کو دوبارہ آپ کی مدد درکار ہے"], cta: ["View request", "درخواست دیکھیں"] },
  donation_marked: { kind: "info", badge: "action", head: ["Please confirm your donation", "براہِ کرم اپنے عطیہ کی تصدیق کریں"], cta: ["Confirm donation", "عطیہ کی تصدیق کریں"] },
  donation_reminder: { kind: "warn", badge: "reminder", head: ["Please confirm your donation", "براہِ کرم اپنے عطیہ کی تصدیق کریں"], cta: ["Confirm donation", "عطیہ کی تصدیق کریں"] },
  donation_completed: { kind: "success", badge: "thanks", head: ["Thank you — donation completed", "شکریہ — عطیہ مکمل ہو گیا"], cta: [`Open ${APP_NAME}`, `${APP_NAME} کھولیں`] },
  chat_history_deleted: { kind: "neutral", badge: "notice", head: ["Chat history was deleted", "چیٹ کی ہسٹری حذف کر دی گئی"] },
  reservation_update: { kind: "info", badge: "update", head: ["Blood reservation update", "خون کی ریزرویشن کی اپڈیٹ"], cta: ["View reservation", "ریزرویشن دیکھیں"] },
};
// Some bodies are "<urdu>\n<english>": show only the reader's language.
const bodyForLang = (message, lang) => {
  const parts = String(message || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 2 && /[؀-ۿ]/.test(parts[0]) && !/[؀-ۿ]/.test(parts[1])) {
    return lang === "ur" ? parts[0] : parts[1];
  }
  return String(message || "");
};

const activity = ({ name, type, title, message, details }, lang) => {
  const look = (type && TYPE_MAP[type]) || { kind: "info", badge: "update" };
  const color = KIND[look.kind] || COLORS.indigo;
  const i = lang === "ur" ? 1 : 0;
  const badgeText = (BADGE[look.badge] || BADGE.update)[i];
  const head = look.head ? look.head[i] : esc(title || APP_NAME);
  const text = bodyForLang(message, lang);
  const subjectTitle = title || (look.head && look.head[0]) || "Update";
  return {
    subject: `${look.kind === "urgent" ? "🩸" : look.kind === "success" ? "✅" : "🔔"} ${look.kind === "urgent" && lang === "ur" && look.head ? look.head[1] : subjectTitle}`,
    preheader: text.slice(0, 100),
    body: [
      badge(badgeText, color),
      heading(head, lang),
      para(hello(lang, name), lang, `font-weight:700; color:${COLORS.ink};`),
      `<div dir="auto" style="margin:6px 0 20px; padding:16px 18px; background:${COLORS.bg}; border:1px solid ${COLORS.border}; border-${lang === "ur" ? "right" : "left"}:4px solid ${color}; border-radius:10px; font-size:15px; line-height:1.7; color:${COLORS.ink}; text-align:${alignOf(lang)};">${esc(text)}</div>`,
      details ? infoCard(details, lang, color) : "",
      button(APP_URL, look.cta ? look.cta[i] : openApp(lang), { lang, color: look.kind === "urgent" ? COLORS.coral : COLORS.teal }),
      look.kind === "urgent"
        ? notice(pick(lang, "Every minute counts. Open the app to respond — your quick action can save a life.", "ہر منٹ قیمتی ہے۔ جواب دینے کے لیے ایپ کھولیں — آپ کا فوری ردِعمل زندگی بچا سکتا ہے۔"), "danger", lang)
        : "",
    ].join(""),
  };
};

const TEMPLATES = {
  otp,
  welcome,
  passwordChanged,
  loginAlert,
  emailChangedOld,
  emailChangedNew,
  accountDeleted,
  donorRegistered,
  donorRemoved,
  requestPosted,
  contactAck,
  supportReply,
  supportResolved,
  activity,
};

const render = (key, data = {}, lang = "en") => {
  const l = lang === "ur" ? "ur" : "en";
  const build = TEMPLATES[key];
  if (!build) throw new Error(`Unknown email template: ${key}`);
  const out = build(data, l);
  const html = wrap({ title: out.subject, bodyHtml: out.body, lang: l, preheader: out.preheader });
  return { subject: out.subject, html };
};

module.exports = { render, TEMPLATES, TYPE_MAP };

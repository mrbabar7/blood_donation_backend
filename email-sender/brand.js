// Single source of truth for email branding — every template composes from
// this instead of duplicating its own CSS/colors. Change a color or the
// header/footer markup here once and every email updates together.
//
// Palette matches the mobile app exactly (src/theme/tokens.ts, "restrained
// clinical" redesign): deep teal = primary/trust, indigo = structure,
// coral/red = blood & urgency ACCENT ONLY, amber = attention, green =
// confirmed. Bordered surfaces, no heavy shadows — same as the app screens.
//
// Layout is table-based with inline styles so it renders the same in Gmail,
// Outlook, Apple Mail and mobile clients. Urdu emails render right-to-left.

const APP_NAME = "Blood Donation";
const APP_TAGLINE = { en: "Donate Blood · Save a Life", ur: "خون عطیہ کریں · زندگی بچائیں" };

const COLORS = {
  teal: "#0A6B66",
  tealDark: "#07504C",
  tealLight: "#3FA39D",
  indigo: "#37468C",
  indigoDark: "#2A3670",
  coral: "#C8362B",
  amber: "#9A6207",
  success: "#14764E",
  ink: "#101418",
  slate: "#5B6569",
  slateLight: "#8A9498",
  bg: "#F5F7F8",
  card: "#EEF1F2",
  border: "#DDE3E4",
};

// Public URLs the emails link back into. Set PUBLIC_APP_URL / PUBLIC_API_URL
// in .env — the fallback is deliberately obvious so a misconfigured deploy is
// visible in the link itself.
const APP_URL = process.env.PUBLIC_APP_URL || "https://app.example.com";
const API_URL = process.env.PUBLIC_API_URL || "https://api.example.com";
const SUPPORT_EMAIL = () => process.env.SUPPORT_EMAIL || process.env.EMAIL_USER || "";

const FONT_LATIN = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_URDU = "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Noto Naskh Arabic',Tahoma,'Segoe UI',Arial,sans-serif";

const FOOTER_TEXT = {
  en: {
    auto: "This is an automated message — please don't reply to it.",
    help: "Need help?",
    prefs: "You can manage which notifications you receive in the app under Profile › Notification preferences.",
    rights: "All rights reserved",
  },
  ur: {
    auto: "یہ ایک خودکار پیغام ہے — براہِ کرم اس کا جواب نہ دیں۔",
    help: "مدد چاہیے؟",
    prefs: "آپ ایپ میں پروفائل › نوٹیفکیشن ترجیحات میں جا کر منتخب کر سکتے ہیں کہ کون سی اطلاعات موصول ہوں۔",
    rights: "جملہ حقوق محفوظ ہیں",
  },
};

// ---- small safe helpers ----------------------------------------------------
const esc = (v) =>
  String(v === undefined || v === null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Single-pass {placeholder} fill: every occurrence replaced, values are
// escaped, and "$&"-style sequences in user text can't corrupt the output
// (the problem with chained String.replace). Keys listed in `raw` are
// inserted as-is (pre-built HTML).
const fill = (template, values = {}, raw = []) =>
  String(template).replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in values)) return m;
    return raw.includes(k) ? String(values[k]) : esc(values[k]);
  });

const dirOf = (lang) => (lang === "ur" ? "rtl" : "ltr");
const alignOf = (lang) => (lang === "ur" ? "right" : "left");
const fontOf = (lang) => (lang === "ur" ? FONT_URDU : FONT_LATIN);

// ---- building blocks -------------------------------------------------------
function heading(text, lang = "en") {
  return `<h1 style="margin:0 0 12px; font-size:${lang === "ur" ? 24 : 22}px; line-height:1.35; font-weight:700; color:${COLORS.ink}; text-align:${alignOf(lang)};">${text}</h1>`;
}

function para(html, lang = "en", extra = "") {
  return `<p style="margin:0 0 16px; font-size:15px; line-height:${lang === "ur" ? 2 : 1.65}; color:${COLORS.slate}; text-align:${alignOf(lang)}; ${extra}">${html}</p>`;
}

// Small status pill — meaning is carried by the label as well as the color.
function badge(text, color = COLORS.teal) {
  return `<span style="display:inline-block; padding:5px 12px; border-radius:999px; font-size:12px; font-weight:700; letter-spacing:0.3px; color:#ffffff; background:${color}; margin-bottom:16px;">${text}</span>`;
}

// Bulletproof button (works in Outlook via the table + padded <a>).
function button(href, label, { color = COLORS.teal, lang = "en" } = {}) {
  return `
<div style="margin:8px 0 20px; text-align:${alignOf(lang)};">
  <a href="${esc(href)}" target="_blank" style="display:inline-block; padding:14px 30px; font-size:15px; font-weight:700; line-height:1.2; color:#ffffff; background:${color}; text-decoration:none; border-radius:10px; font-family:${fontOf(lang)}; mso-padding-alt:0;">
    <!--[if mso]><i style="letter-spacing:30px; mso-font-width:-100%; mso-text-raise:20pt">&nbsp;</i><![endif]-->${label}<!--[if mso]><i style="letter-spacing:30px; mso-font-width:-100%">&nbsp;</i><![endif]-->
  </a>
</div>`;
}

// Label/value rows inside a bordered card (request details, donor details…).
function infoCard(rows, lang = "en", accent = COLORS.teal) {
  const body = rows
    .filter((r) => r && r[1] !== undefined && r[1] !== null && String(r[1]) !== "")
    .map(
      ([label, value, strong], i, arr) => `
    <tr>
      <td style="padding:11px 16px; ${i < arr.length - 1 ? `border-bottom:1px solid ${COLORS.border};` : ""} font-size:12px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase; color:${COLORS.slateLight}; text-align:${alignOf(lang)}; width:38%;">${label}</td>
      <td style="padding:11px 16px; ${i < arr.length - 1 ? `border-bottom:1px solid ${COLORS.border};` : ""} font-size:15px; font-weight:${strong ? 800 : 600}; color:${strong ? COLORS.coral : COLORS.ink}; text-align:${alignOf(lang)};">${esc(value)}</td>
    </tr>`,
    )
    .join("");
  if (!body) return "";
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px; background:${COLORS.bg}; border:1px solid ${COLORS.border}; border-${lang === "ur" ? "right" : "left"}:4px solid ${accent}; border-radius:10px;" dir="${dirOf(lang)}">${body}</table>`;
}

// Highlighted callout (security notes, expiry notes, warnings).
function notice(html, kind = "info", lang = "en") {
  const c = { info: COLORS.indigo, warn: COLORS.amber, danger: COLORS.coral, ok: COLORS.success }[kind] || COLORS.indigo;
  return `<div style="margin:6px 0 18px; padding:12px 16px; background:${c}12; border:1px solid ${c}33; border-radius:10px; font-size:13px; line-height:${lang === "ur" ? 1.9 : 1.6}; color:${c}; text-align:${alignOf(lang)};">${html}</div>`;
}

function codeBox(code) {
  return `<div style="margin:8px 0 8px; text-align:center;"><span style="display:inline-block; background:${COLORS.indigo}0F; border:2px dashed ${COLORS.indigo}; border-radius:14px; padding:18px 30px; font-family:'SF Mono',Menlo,Consolas,monospace; font-size:34px; font-weight:800; letter-spacing:10px; color:${COLORS.indigoDark}; direction:ltr;">${esc(code)}</span></div>`;
}

const hr = () => `<div style="height:1px; background:${COLORS.border}; margin:22px 0;"></div>`;

// ---- shell ------------------------------------------------------------------
// header(): logo + wordmark on the app's hero gradient (indigo -> teal).
// The logo is attached inline by emailService (cid:brandlogo).
function header(icon, lang = "en") {
  return `
<tr><td bgcolor="${COLORS.teal}" style="background:${COLORS.teal}; background-image:linear-gradient(135deg, ${COLORS.indigo} 0%, ${COLORS.teal} 100%); padding:28px 24px; text-align:center;">
  <img src="cid:brandlogo" width="44" alt="" style="display:block; margin:0 auto 10px; border:0; height:auto;" />
  <div style="font-size:22px; font-weight:800; letter-spacing:-0.2px; color:#ffffff; font-family:${FONT_LATIN};">${APP_NAME}</div>
  <div style="margin-top:4px; font-size:11px; letter-spacing:1.4px; text-transform:uppercase; color:rgba(255,255,255,0.82); font-family:${fontOf(lang)};">${APP_TAGLINE[lang] || APP_TAGLINE.en}</div>
</td></tr>`;
}

function footer(extra, lang = "en") {
  const t = FOOTER_TEXT[lang] || FOOTER_TEXT.en;
  const support = SUPPORT_EMAIL();
  return `
<tr><td style="padding:22px 28px 26px; background:${COLORS.bg}; border-top:1px solid ${COLORS.border}; text-align:center; font-size:12px; line-height:${lang === "ur" ? 2 : 1.7}; color:${COLORS.slateLight}; font-family:${fontOf(lang)};">
  ${extra ? `<div style="margin-bottom:8px; font-weight:700; color:${COLORS.teal};">${extra}</div>` : ""}
  <div>${t.auto}</div>
  ${support ? `<div>${t.help} <a href="mailto:${esc(support)}" style="color:${COLORS.indigo}; text-decoration:underline;">${esc(support)}</a></div>` : ""}
  <div style="margin-top:6px;">${t.prefs}</div>
  <div style="margin-top:10px; color:${COLORS.slateLight};">© ${new Date().getFullYear()} ${APP_NAME} • ${t.rights}</div>
</td></tr>`;
}

// wrap(): full document shell used by every template.
//   preheader — hidden inbox preview text.
function wrap({ title, icon, bodyHtml, footerExtra, lang = "en", preheader = "" }) {
  return `<!doctype html>
<html lang="${lang}" dir="${dirOf(lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${esc(title)}</title>
<style>
  body { margin:0; padding:0; }
  a { text-decoration:none; }
  @media only screen and (max-width:600px) {
    .card { width:100% !important; border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
    .pad { padding:26px 20px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background:${COLORS.bg}; font-family:${fontOf(lang)};">
${preheader ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; font-size:1px; line-height:1px;">${esc(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.bg}" style="background:${COLORS.bg};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" class="card" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px; max-width:100%; background:#ffffff; border:1px solid ${COLORS.border}; border-radius:16px; overflow:hidden;">
    ${header(icon, lang)}
    <tr><td class="pad" dir="${dirOf(lang)}" style="padding:34px 32px 18px; font-family:${fontOf(lang)}; text-align:${alignOf(lang)};">
      ${bodyHtml}
    </td></tr>
    ${footer(footerExtra, lang)}
  </table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = {
  APP_NAME,
  APP_TAGLINE,
  COLORS,
  APP_URL,
  API_URL,
  SUPPORT_EMAIL,
  wrap,
  header,
  footer,
  esc,
  fill,
  heading,
  para,
  badge,
  button,
  infoCard,
  notice,
  codeBox,
  hr,
  dirOf,
  alignOf,
  fontOf,
};

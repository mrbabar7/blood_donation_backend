// Single source of truth for email branding — every template composes from
// this instead of duplicating its own CSS/colors. Change a color or the
// header/footer markup here once, and all 5 email flows update together.
//
// Palette matches the app exactly (src/theme/tokens.ts in the mobile app):
// teal = primary, indigo = secondary, coral = urgency ACCENT ONLY (never the
// dominant color), amber = attention. The old templates used red/rose as the
// dominant color throughout, which contradicted that rule everywhere.

// Single source of truth for the product name across every email — change it
// here once. (Matches the same-purpose constant in the mobile app's
// src/constants/brand.ts and the admin dashboard's src/constants.ts.)
const APP_NAME = "Blood Donation";

const COLORS = {
  teal: "#0EA5A0",
  tealDark: "#0B7E7A",
  indigo: "#4F46E5",
  indigoDark: "#3730A3",
  coral: "#EF5A4C",
  amber: "#F5A623",
  success: "#1FAE6B",
  ink: "#1e293b",
  slate: "#64748b",
  slateLight: "#94a3b8",
  bg: "#f8fafc",
  card: "#f1f5f9",
  border: "#e2e8f0",
};

// Public URLs the emails link back into — real env vars with a clearly-fake
// localhost fallback (so a misconfigured deploy is obvious in the link itself,
// not a silent dead end pointing at someone's laptop).
const APP_URL = process.env.PUBLIC_APP_URL || "https://app.example.com";
const API_URL = process.env.PUBLIC_API_URL || "https://api.example.com";

const baseStyles = `
  body { margin:0; padding:0; background-color:${COLORS.bg}; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  table { border-collapse:collapse; }
  img { border:0; display:block; }
  a { text-decoration:none; }
  .email-wrap { width:100%; max-width:520px; margin:32px auto; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 12px 30px rgba(15,23,42,0.08); border:1px solid ${COLORS.border}; }
  .header { padding:32px 24px; background:linear-gradient(135deg, ${COLORS.indigo} 0%, ${COLORS.teal} 100%); text-align:center; color:#ffffff; }
  .brand { font-size:24px; font-weight:800; letter-spacing:-0.3px; }
  .brand-sub { margin-top:4px; font-size:12px; color:rgba(255,255,255,0.85); }
  .body { padding:36px 30px; color:${COLORS.ink}; text-align:center; }
  .footer { padding:18px 24px; background:${COLORS.bg}; border-top:1px solid ${COLORS.border}; text-align:center; font-size:11px; color:${COLORS.slateLight}; }
  @media only screen and (max-width:480px) {
    .body { padding:26px 20px; }
    .brand { font-size:20px; }
  }
`;

// header(): optional emoji icon shown above the brand wordmark.
function header(icon) {
  return `
    <div class="header">
      ${icon ? `<div style="font-size:32px; margin-bottom:6px;">${icon}</div>` : ""}
      <div class="brand">💧 ${APP_NAME}</div>
      <div class="brand-sub">Connecting Donors, Saving Lives</div>
    </div>`;
}

function footer(extra) {
  return `
    <div class="footer">
      © ${new Date().getFullYear()} ${APP_NAME} • All rights reserved
      ${extra ? `<div style="margin-top:6px; font-weight:600; color:${COLORS.indigo};">${extra}</div>` : ""}
    </div>`;
}

// wrap(): full document shell — every template's outermost structure, so
// changing the shell (fonts, wrapper radius, shadow) happens in exactly one place.
function wrap({ title, icon, bodyHtml, footerExtra }) {
  return `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>${baseStyles}</style>
</head>
<body>
<center>
<table width="100%"><tr><td align="center">
<div class="email-wrap">
${header(icon)}
<div class="body">
${bodyHtml}
</div>
${footer(footerExtra)}
</div>
</td></tr></table>
</center>
</body>
</html>`;
}

module.exports = { APP_NAME, COLORS, APP_URL, API_URL, wrap, header, footer };

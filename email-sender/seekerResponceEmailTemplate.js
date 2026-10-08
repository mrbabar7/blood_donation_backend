const { COLORS, APP_NAME, wrap, APP_URL } = require("./brand");

// Sent by controllers/donorController/donorEmailResponce.js when a donor
// accepts/declines via the email link flow (routes/donorRoutes.js:
// GET /respond-email/:requestId/:action). Brand header is now fixed/consistent
// (previously the whole header recolored per status via {bgColor}, which
// buried the brand identity) — only the small status badge changes color.
const seekerUpdateTemplate = wrap({
  title: `${APP_NAME} – Request Update`,
  bodyHtml: `
    <div style="display:inline-block; padding:6px 18px; border-radius:999px; font-weight:700; font-size:12px; background:{badgeColor}; color:#ffffff; margin-bottom:18px;">{statusText}</div>
    <h2 style="margin:0 0 10px; color:${COLORS.ink}; font-size:20px;">Hello, {seekerName}</h2>
    <p style="color:${COLORS.slate}; line-height:1.6; font-size:14px;">{mainMessage}</p>
    {donorDetailsHtml}
    <div style="margin-top:28px;">
      <a href="${APP_URL}" style="background:${COLORS.indigo}; color:#ffffff; padding:13px 26px; text-decoration:none; border-radius:12px; font-weight:700; font-size:14px; display:inline-block;">Open ${APP_NAME}</a>
    </div>
  `,
});

module.exports = { seekerUpdateTemplate };

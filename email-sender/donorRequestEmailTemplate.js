const { COLORS, APP_NAME, wrap } = require("./brand");

// NOTE — currently unused: nothing in this backend actually calls this
// template (the real in-app + email-link donor response flow uses
// seekerResponceEmailTemplate.js via controllers/donorController/donorEmailResponce.js
// and the in-app Accept/Decline buttons in the mobile app). Fixed and re-branded
// anyway since it's clearly meant to be wired up eventually (a direct "email a
// donor about a specific request with Accept/Decline links" flow) — if you want
// this live, it needs a controller that generates {acceptLink}/{rejectLink}
// pointing at GET /donors/respond-email/:requestId/:action and calls sendingEmail.
const requestTemplate = wrap({
  title: `Urgent Blood Request – ${APP_NAME}`,
  icon: "🩸",
  bodyHtml: `
    <div style="font-size:20px; font-weight:800; color:${COLORS.ink}; margin-bottom:12px;">Urgent Request for {donorName}</div>
    <p style="font-size:14px; color:${COLORS.slate}; line-height:1.6; margin-bottom:26px;">
      You've been identified as a potential match for a critical blood request. Your quick response could save a life today.
    </p>

    <div style="background:${COLORS.card}; border-radius:18px; padding:22px; margin-bottom:28px; border:1px solid ${COLORS.border}; text-align:left;">
      <div style="display:table; width:100%; margin-bottom:12px; border-bottom:1px solid ${COLORS.border}; padding-bottom:8px;">
        <span style="display:table-cell; font-size:12px; font-weight:700; color:${COLORS.slateLight}; text-transform:uppercase;">👤 Seeker</span>
        <span style="display:table-cell; text-align:right; font-size:14px; font-weight:700; color:${COLORS.ink};">{seekerName}</span>
      </div>
      <div style="display:table; width:100%; margin-bottom:12px; border-bottom:1px solid ${COLORS.border}; padding-bottom:8px;">
        <span style="display:table-cell; font-size:12px; font-weight:700; color:${COLORS.slateLight}; text-transform:uppercase;">🩸 Blood type</span>
        <span style="display:table-cell; text-align:right; font-size:17px; font-weight:800; color:${COLORS.coral};">{bloodType}</span>
      </div>
      <div style="display:table; width:100%;">
        <span style="display:table-cell; font-size:12px; font-weight:700; color:${COLORS.slateLight}; text-transform:uppercase;">📍 Location</span>
        <span style="display:table-cell; text-align:right; font-size:14px; font-weight:700; color:${COLORS.ink};">{location}</span>
      </div>
    </div>

    <a href="{acceptLink}" style="display:inline-block; background:${COLORS.teal}; color:#ffffff; padding:15px 28px; border-radius:12px; font-weight:700; font-size:14px; margin:0 6px 10px;">Accept & Help</a>
    <a href="{rejectLink}" style="display:inline-block; background:${COLORS.card}; color:${COLORS.slate}; padding:15px 28px; border-radius:12px; font-weight:700; font-size:14px; border:1px solid ${COLORS.border}; margin:0 6px 10px;">Decline</a>

    <p style="font-size:12px; color:${COLORS.slateLight}; margin-top:12px;">Clicking accept will share your contact info with the seeker.</p>
  `,
  footerExtra: "Helping each other, one drop at a time.",
});

module.exports = { requestTemplate };

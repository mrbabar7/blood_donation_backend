const { COLORS, APP_NAME, wrap } = require("./brand");

// Used by controllers/donor&seekerController/handleContactInquiry.js —
// notifies the team when someone submits the app/website Contact Us form.
const contactTemplate = wrap({
  title: `New Contact Inquiry — ${APP_NAME}`,
  icon: "📩",
  bodyHtml: `
    <div style="text-align:left;">
      <p style="color:${COLORS.slate}; font-size:14px; margin-bottom:18px;">You have received a new message from the ${APP_NAME} contact form:</p>
      <div style="background:${COLORS.card}; border-radius:14px; padding:20px; border-left:5px solid ${COLORS.indigo};">
        <div style="font-weight:700; color:${COLORS.slateLight}; font-size:11px; text-transform:uppercase; margin-bottom:4px;">Full Name</div>
        <div style="font-size:15px; color:${COLORS.ink}; margin-bottom:14px;">{name}</div>

        <div style="font-weight:700; color:${COLORS.slateLight}; font-size:11px; text-transform:uppercase; margin-bottom:4px;">Email Address</div>
        <div style="font-size:15px; color:${COLORS.ink}; margin-bottom:14px;">{email}</div>

        <div style="font-weight:700; color:${COLORS.slateLight}; font-size:11px; text-transform:uppercase; margin-bottom:4px;">Subject</div>
        <div style="font-size:15px; color:${COLORS.ink}; margin-bottom:14px;">{subject}</div>

        <div style="font-weight:700; color:${COLORS.slateLight}; font-size:11px; text-transform:uppercase; margin-bottom:4px;">Message</div>
        <div style="font-size:15px; color:${COLORS.ink}; white-space:pre-wrap;">{message}</div>
      </div>
    </div>
  `,
  footerExtra: `Sent from the ${APP_NAME} contact form`,
});

module.exports = { contactTemplate };

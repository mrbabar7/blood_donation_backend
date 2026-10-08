const { COLORS, APP_NAME, wrap } = require("./brand");

// Reused by 5 real flows: signup verification, login OTP, forgot-password,
// email-change verification, and resend-email-change-OTP (all in
// controllers/authController/*.js and accountController/userController.js).
// Fixing this one file fixes all five emails at once.
const useTemplate = wrap({
  title: `${APP_NAME} – Verify Your Email`,
  bodyHtml: `
    <div style="font-size:16px; font-weight:700; margin-bottom:10px;">Hello, {name}</div>
    <div style="font-size:14px; color:${COLORS.slate}; margin-bottom:24px; line-height:1.6;">
      Enter the verification code below to continue.
    </div>
    <div style="display:inline-block; background:${COLORS.indigo}0D; border:2px dashed ${COLORS.indigo}; border-radius:16px; padding:20px 34px; font-size:34px; font-weight:800; letter-spacing:10px; color:${COLORS.indigoDark};">
      {verificationCode}
    </div>
    <div style="margin-top:14px; font-size:14px; font-weight:700; color:${COLORS.coral};">This code expires in 5 minutes</div>
    <div style="margin-top:18px; font-size:12px; color:${COLORS.slateLight}; line-height:1.6;">
      For your security, never share this code with anyone.<br/>
      If you didn't request this, you can safely ignore this email.
    </div>
  `,
});

module.exports = { useTemplate };

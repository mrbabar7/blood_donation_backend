const { COLORS, APP_NAME, wrap, heading, para, codeBox, notice } = require("./brand");
const { render } = require("./templates");

// Preferred API: purpose-aware, escaped, bilingual (EN/UR).
//   purpose: "verify" | "resend" | "reset" | "emailChange"
// Used by signup, login (unverified), resend, forgot-password and the two
// email-change flows (controllers/authController/*, accountController/userController.js).
const renderOtpEmail = ({ purpose = "verify", name, code, lang = "en", minutes = 5 }) =>
  render("otp", { purpose, name, code, minutes }, lang);

// Legacy string template kept so any older caller using
// `useTemplate.replace("{name}", …).replace("{verificationCode}", …)` still works.
const useTemplate = wrap({
  title: `${APP_NAME} – Verify Your Email`,
  bodyHtml: `
    ${heading("Verify your email address")}
    ${para("Hello, {name}", "en", `font-weight:700; color:${COLORS.ink};`)}
    ${para("Enter the verification code below to continue.")}
    ${codeBox("{verificationCode}")}
    <div style="text-align:center; margin:12px 0 18px; font-size:14px; font-weight:700; color:${COLORS.coral};">This code expires in 5 minutes</div>
    ${notice("For your security, never share this code with anyone. If you didn't request this, you can safely ignore this email.", "info")}
  `,
});

module.exports = { useTemplate, renderOtpEmail };

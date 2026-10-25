const { contactTemplate } = require("../../email-sender/contactEmailTemplate");
const { sendingEmail } = require("../../email-sender/emailService");
const { fill } = require("../../email-sender/brand");
const { sendTemplate, langFor } = require("../../email-sender/mailer");
require("dotenv").config();

const handleContactInquiry = async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    // Reference shown to the user on the "Message sent" screen and included in
    // the support email's subject, so a follow-up can be matched to this message.
    const reference = `SUP-${Date.now().toString(36).slice(-5).toUpperCase()}`;

    // Values are HTML-escaped (user-supplied text must never be injected as markup).
    const htmlContent = fill(contactTemplate, { name, email, subject, message });

    await sendingEmail(
      process.env.EMAIL_USER,
      `Contact [${reference}]: ${subject}`,
      htmlContent,
      { replyTo: email },
    );

    // Acknowledgment to the person who wrote in (fire-and-forget).
    sendTemplate(email, "contactAck", { name, reference, subject }, langFor(null, req));

    res
      .status(200)
      .json({ success: true, message: "Message sent successfully!", reference });
  } catch (error) {
    console.error("Contact Error:", error);
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
};

module.exports = handleContactInquiry;

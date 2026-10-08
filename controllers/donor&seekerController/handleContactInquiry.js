const { contactTemplate } = require("../../email-sender/contactEmailTemplate");
const { sendingEmail } = require("../../email-sender/emailService");
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

    const htmlContent = contactTemplate
      .replace("{name}", name)
      .replace("{email}", email)
      .replace("{subject}", subject)
      .replace("{message}", message);

    await sendingEmail(
      process.env.EMAIL_USER,
      `Contact [${reference}]: ${subject}`,
      htmlContent,
    );

    res
      .status(200)
      .json({ success: true, message: "Message sent successfully!", reference });
  } catch (error) {
    console.error("Contact Error:", error);
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
};

module.exports = handleContactInquiry;

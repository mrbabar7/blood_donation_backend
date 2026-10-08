const nodemailer = require("nodemailer");
require("dotenv").config();
const { APP_NAME } = require("./brand");

const sendingEmail = async (email, subject, htmlContent) => {
  console.log("Attempting to send email to:", email);

  const transporter = nodemailer.createTransport({
    host: "mail.blooddonation.pk",
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  if (!email) {
    throw new Error("No recipient email provided to sendingEmail function");
  }

  const mailOptions = {
    from: `"${APP_NAME}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: subject,
    html: htmlContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email Sent [${subject}]:`, info.response);
    return info;
  } catch (error) {
    console.error("❌ Email Error Details:", error);
    throw error;
  }
};

module.exports = { sendingEmail };

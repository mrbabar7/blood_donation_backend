const path = require("path");
const nodemailer = require("nodemailer");
require("dotenv").config();
const { APP_NAME } = require("./brand");

// One pooled SMTP connection for the whole process (previously a new
// transporter + TCP/TLS handshake was created for every single email).
// Host and TLS strictness are overridable from .env; the defaults keep the
// exact behaviour the app already had.
let _transporter = null;
const getTransporter = () => {
  if (_transporter) return _transporter;
  const port = Number(process.env.EMAIL_PORT) || 587;
  _transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "mail.blooddonation.pk",
    port,
    secure: port === 465 ? true : false,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      // Same as before (self-signed / mismatched cert tolerated). Set
      // EMAIL_TLS_STRICT=true once the mail server has a valid certificate.
      rejectUnauthorized: process.env.EMAIL_TLS_STRICT === "true",
    },
  });
  return _transporter;
};

// Crude but safe plain-text alternative (improves spam score and helps
// clients that don't render HTML).
const htmlToText = (html) =>
  String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(br|\/p|\/div|\/tr|\/h1|\/h2|\/h3)\s*\/?>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const LOGO_PATH = path.join(__dirname, "assets", "logo-white.png");

const sendingEmail = async (email, subject, htmlContent, opts = {}) => {
  if (!email) {
    throw new Error("No recipient email provided to sendingEmail function");
  }
  console.log("Attempting to send email to:", email);

  const mailOptions = {
    from: `"${APP_NAME}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: subject,
    html: htmlContent,
    text: htmlToText(htmlContent),
  };
  if (opts.replyTo) mailOptions.replyTo = opts.replyTo;
  // The branded header references the logo as cid:brandlogo.
  if (String(htmlContent).includes("cid:brandlogo")) {
    mailOptions.attachments = [
      { filename: "logo.png", path: LOGO_PATH, cid: "brandlogo", contentDisposition: "inline" },
    ];
  }

  try {
    const info = await getTransporter().sendMail(mailOptions);
    console.log(`✅ Email Sent [${subject}]:`, info.response);
    return info;
  } catch (error) {
    console.error("❌ Email Error Details:", error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Background sending for "activity" emails (notifications, confirmations).
// - never throws and never blocks the request that triggered it
// - runs one email at a time with a short gap, so a broadcast to hundreds of
//   donors can't hammer the SMTP server or trip its rate limits
// ---------------------------------------------------------------------------
const GAP_MS = Number(process.env.EMAIL_QUEUE_GAP_MS || 250);
const MAX_QUEUE = Number(process.env.EMAIL_QUEUE_MAX || 5000);
const queue = [];
let running = false;

const pump = async () => {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      await sendingEmail(job.to, job.subject, job.html);
    } catch (err) {
      console.error(`[email-queue] failed for ${job.to} [${job.subject}]:`, err && err.message);
    }
    if (queue.length) await new Promise((r) => setTimeout(r, GAP_MS));
  }
  running = false;
};

const queueEmail = (to, subject, html) => {
  try {
    if (!to) return false;
    if (queue.length >= MAX_QUEUE) {
      console.warn("[email-queue] full — dropping email to", to);
      return false;
    }
    queue.push({ to, subject, html });
    setImmediate(pump);
    return true;
  } catch (err) {
    console.error("[email-queue] enqueue error:", err && err.message);
    return false;
  }
};

module.exports = { sendingEmail, queueEmail, htmlToText };

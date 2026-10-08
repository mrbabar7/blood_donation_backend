// Real Twilio Verify integration for phone-number sign-in. Twilio Verify
// manages the OTP lifecycle for you (generation, expiry, retry limits) — no
// need for our own OTP model, unlike the email flow.
//
// REQUIRES YOUR OWN TWILIO ACCOUNT to actually send SMS: set TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID in .env (create a Verify
// Service in the Twilio console — it's free to create, SMS sends are billed by
// Twilio per message). Without these three set, phone sign-in fails with a
// clear configuration error instead of silently pretending to work.

function isConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
  );
}

function getClient() {
  const twilio = require("twilio");
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

async function sendOtp(phone) {
  if (!isConfigured()) {
    const err = new Error(
      "Phone sign-in isn't configured on this server yet — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID in .env."
    );
    err.notConfigured = true;
    throw err;
  }
  const client = getClient();
  return client.verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to: phone, channel: "sms" });
}

async function checkOtp(phone, code) {
  if (!isConfigured()) {
    const err = new Error("Phone sign-in isn't configured on this server yet.");
    err.notConfigured = true;
    throw err;
  }
  const client = getClient();
  const result = await client.verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({ to: phone, code });
  return result.status === "approved";
}

module.exports = { isConfigured, sendOtp, checkOtp };

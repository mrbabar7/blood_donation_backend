const crypto = require("crypto");

// RFC 6238 TOTP, RFC 4648 base32 — implemented directly on Node's built-in
// `crypto` module rather than pulling in a third-party package (otplib/
// speakeasy), since a new dependency can't be npm-installed or verified in
// this sandbox. This is the same algorithm every authenticator app (Google
// Authenticator, Authy, 1Password, etc.) implements, so it's interoperable.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, "0");
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// A fresh random 20-byte secret, base32-encoded — the standard size used by
// every mainstream authenticator app.
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

function generateTOTP(base32Secret, stepSeconds = 30, forTime = Date.now()) {
  const counter = Math.floor(forTime / 1000 / stepSeconds);
  return hotp(base32Decode(base32Secret), counter);
}

// Accepts a code from one step before/after "now" to absorb clock drift
// between the server and the admin's phone — standard TOTP practice.
function verifyTOTP(base32Secret, token, stepSeconds = 30, window = 1) {
  if (!token || !/^\d{6}$/.test(token)) return false;
  const now = Date.now();
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = generateTOTP(base32Secret, stepSeconds, now + errorWindow * stepSeconds * 1000);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(token))) return true;
  }
  return false;
}

function buildOtpAuthUri({ secret, accountName, issuer }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { generateSecret, generateTOTP, verifyTOTP, buildOtpAuthUri, base32Encode, base32Decode };

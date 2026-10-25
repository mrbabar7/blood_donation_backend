// Centralized JWT secret.
//
// Every place that used to sign/verify tokens with
// `process.env.JWT_SECRET || "secret123"` silently fell back to that
// hardcoded, publicly-known default whenever JWT_SECRET wasn't set — meaning
// anyone could forge a valid login token (including admin tokens, which are
// signed with this same secret) without ever needing to see this codebase.
//
// This module removes the fallback: it fails loudly at startup if JWT_SECRET
// is missing, instead of failing silently/insecurely at request time.
if (!process.env.JWT_SECRET) {
  throw new Error(
    "JWT_SECRET is not set. Add a strong, random JWT_SECRET to your .env file before starting the server (see .env.example).",
  );
}

module.exports = process.env.JWT_SECRET;

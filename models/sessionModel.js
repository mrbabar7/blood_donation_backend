const mongoose = require("mongoose");

// One document per login (device). See config/sessionPolicy.js for the model.
// Only hashes of secrets are stored — a database leak never yields a usable
// refresh token.
const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // SHA-256 of the current refresh secret. null while a Google hand-off is
    // still pending (no tokens have been issued yet).
    refreshTokenHash: { type: String, default: null },
    // The hash that was current before the last rotation (replay detection).
    previousRefreshTokenHash: { type: String, default: null },
    previousRotatedAt: { type: Date, default: null },
    rotationCount: { type: Number, default: 0 },

    // One-time Google hand-off code (hashed) + its expiry. Cleared on use.
    handoffHash: { type: String, default: null, index: true, sparse: true },
    handoffExpiresAt: { type: Date, default: null },

    // ABSOLUTE end of the session. Set once; rotation never moves it. Also the
    // TTL index key, so MongoDB deletes dead sessions automatically.
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },

    lastUsedAt: { type: Date, default: Date.now },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
  },
  { timestamps: true },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Session", sessionSchema);

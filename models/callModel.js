const mongoose = require("mongoose");

// Backs the "Calls" tab / call history screen (REQUIREMENT 3). One document
// per call *attempt* — created the moment call:invite fires (see
// services/socketService.js), then updated in place as that same call
// progresses through ringing -> accepted/rejected/missed -> (if accepted)
// completed. Deliberately a new document per attempt rather than one row per
// requestId, same "every event is its own row" shape WhatsApp/native phone
// call logs use — re-calling the same match twice produces two rows, not one
// row that gets overwritten.
const callSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "DonationRequest", required: true, index: true },
    callerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    calleeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["ringing", "accepted", "rejected", "missed", "busy", "completed"],
      default: "ringing",
    },
    startedAt: { type: Date, default: Date.now },
    answeredAt: { type: Date },
    endedAt: { type: Date },
    durationSeconds: { type: Number, default: 0 },
    // Users who removed this call from THEIR OWN history (swipe/long-press
    // delete or "Clear all" on the Calls History screen). It is a per-user
    // hide, never a hard delete: the other participant's log is untouched.
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Backend-authoritative ring window: startedAt + 45s (see
    // services/callStateService.js). A call still "ringing" past this instant
    // is expired — it can no longer be accepted/declined and the sweeper turns
    // it into "missed". Optional so documents written before this field existed
    // keep working (they are treated as expired once older than the window).
    expiresAt: { type: Date },
    // Why a call reached its terminal state (expired | caller_cancelled |
    // declined | busy | ended). Informational; status stays the source of truth.
    endReason: { type: String },
    // Set exactly once, atomically, when the MISSED_CALL push/notification has
    // been dispatched — makes the missed-call fan-out idempotent across
    // duplicate expiry triggers, multiple server instances and restarts.
    missedNotifiedAt: { type: Date },
  },
  { timestamps: true },
);

// Call history (GET /calls/history): $or on caller/callee, newest first.
callSchema.index({ callerId: 1, createdAt: -1 });
callSchema.index({ calleeId: 1, createdAt: -1 });
// Expiry sweeper: "ringing calls whose window has elapsed".
callSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model("Call", callSchema);

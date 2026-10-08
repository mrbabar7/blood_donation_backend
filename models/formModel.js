// models/donorModel.js
const mongoose = require("mongoose");

const donorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    fullName: { type: String, required: true },
    age: { type: Number, required: true },
    gender: { type: String, required: true },
    bloodType: { type: String, required: true },
    mobileNumber: { type: String, required: true },
    province: { type: String, required: true },
    district: { type: String, required: true },
    // Real device GPS captured at registration (optional — powers real distance
    // search instead of a slider that does nothing). Not required so existing
    // donors without it keep working exactly as before.
    location: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    profilePicture: { type: String, default: "" },
    isAvailable: { type: Boolean, default: true },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    livesSaved: { type: Number, default: 0 },
    rating: { type: Number, default: 0 },
    totalRatings: { type: Number, default: 0 },
    lastDonationDate: { type: Date, default: null },
    nextAvailableDate: { type: Date, default: null },
    // Admin account controls (Donor Detail screen). All additive/defaulted so
    // every existing donor document keeps working unchanged.
    isSuspended: { type: Boolean, default: false },
    isFlagged: { type: Boolean, default: false },
    flagReason: { type: String, default: "" },
    appearsInPublicSearch: { type: Boolean, default: true },
    pushNotificationsEnabled: { type: Boolean, default: true },
    // Privacy & data screen. "nearby" = only seekers within 15 km see this
    // donor (when the seeker's GPS is known); "city" = anyone searching this
    // donor's city; "hidden" mirrors appearsInPublicSearch=false. Existing
    // donors default to "city", which behaves like the old always-visible
    // search, so nothing changes for them until they pick another option.
    visibilityScope: { type: String, enum: ["nearby", "city", "hidden"], default: "city" },
    // false = seekers see an approximate distance band instead of exact km.
    showExactDistance: { type: Boolean, default: true },
    referralCount: { type: Number, default: 0 },
    // Digital donor card (PK-LHR-4821). Generated once, server-side, the first
    // time the donor is saved (or the first time an older donor opens the
    // card). Never writable from the client.
    donorCode: { type: String, unique: true, sparse: true, index: true },
    cardIssuedAt: { type: Date, default: null },
    // Stamped each time a partner scans the donor's QR (GET /donors/verify/:id).
    cardVerifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// PK-<first 3 letters of district>-<4 digits>, retried until unique.
donorSchema.statics.generateDonorCode = async function (district) {
  const city = String(district || "XXX").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  for (let i = 0; i < 25; i++) {
    const code = `PK-${city}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await this.exists({ donorCode: code }))) return code;
  }
  return `PK-${city}-${Date.now().toString().slice(-6)}`;
};

// Gives every new donor a code and an issue date.
// (async-only: Mongoose 9 pre hooks don't take a next() callback.)
donorSchema.pre("save", async function () {
  if (!this.donorCode) this.donorCode = await this.constructor.generateDonorCode(this.district);
  if (!this.cardIssuedAt) this.cardIssuedAt = new Date();
});

const requestSchema = new mongoose.Schema(
  {
    seekerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    donorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Donor",
      required: true,
    },
    // Set when this request was created as part of a "Post a Request" / Emergency
    // Broadcast fan-out (PDF screens 14-17), so the seeker can track all responses
    // to one broadcast together. Left null for direct one-donor requests.
    broadcastId: { type: mongoose.Schema.Types.ObjectId, ref: "Broadcast", default: null },
    requestedBloodType: { type: String, required: true },
    // Copied from the broadcast on fan-out so a donor's incoming-request card
    // can show urgency / units / deadline without a second lookup. Optional and
    // absent on direct one-donor requests.
    urgency: { type: String, enum: [null, "critical", "within_24h"], default: null },
    units: { type: Number, default: null },
    neededBy: { type: Date, default: null },
    hospitalContact: { type: String, default: "" },
    seekerName: { type: String, required: true },
    seekerPhone: { type: String, required: true },
    seekerLocation: {
      province: { type: String, required: true },
      city: { type: String, required: true },
      addressLine: { type: String, required: true },
    },
    status: {
      type: String,
      // "cancelled_by_seeker" is ONLY ever written by the broadcast
      // cancellation flow (seekerController/cancelBloodRequest.js ->
      // cancelBroadcast). Direct one-donor requests are still cancelled by
      // deletion, so this value never appears on them.
      enum: ["pending", "accepted", "rejected", "completed", "cancelled_by_seeker"],
      default: "pending",
    },
    // Audit trail for broadcast cancellation (status "cancelled_by_seeker").
    cancelledAt: { type: Date, default: null },
    isRated: { type: Boolean, default: false }, // Tracks if seeker gave rating for this donation
    rating: { type: Number, default: 0 }, // Rating score given for this request
    completedAt: { type: Date, default: null },
    expireAt: { type: Date, default: null },

    // ---- Donor-confirms-donation -> seeker-confirms-received flow ----
    // Set the moment the donor taps "I've Donated Blood" on an accepted
    // request (donorController/markDonated.js). Deliberately does NOT change
    // `status` — status stays "accepted" until the seeker actually confirms
    // via completeDonation.js, so every existing status-based check
    // elsewhere in the app (chat access, admin dashboards, history filters)
    // keeps working unchanged. This is purely a second timestamp layered on
    // top of the existing state machine, and is what
    // services/chatCleanupCron.js uses to compute the 3-day countdown.
    donorMarkedDonatedAt: { type: Date, default: null },
    // Set once the "confirm within 3 days or the chat gets deleted" reminder
    // has actually been sent, so the cron never sends it twice.
    chatDeleteWarningSentAt: { type: Date, default: null },
    // Set the moment this request's chat is actually purged — either
    // immediately on a successful completeDonation, or by the 3-day cron.
    // Lets both the API and the app tell "this chat was deleted, here's why"
    // apart from "this chat was simply never started".
    chatDeletedAt: { type: Date, default: null },
    chatDeletedReason: {
      type: String,
      enum: [null, "completed", "unconfirmed_timeout"],
      default: null,
    },
  },
  { timestamps: true },
);

// or keep TTL index if auto-deletion on expireAt is desired.
requestSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// --- Speed/scale indexes (additive only — no query behavior changes) ---
// These mirror exactly what seekerSearchDonor.js, getLeaderboard.js, etc.
// already filter/sort by. Without them Mongo does a full collection scan
// on every search, which is fine with a handful of test donors but is
// exactly what turns into multi-second "hanging" requests once the donor
// collection grows into the thousands/millions — the query logic doesn't
// change at all, it just stops scanning every document to answer it.
donorSchema.index({ bloodType: 1, isAvailable: 1, appearsInPublicSearch: 1 });
donorSchema.index({ province: 1, district: 1 });
donorSchema.index({ isSuspended: 1, appearsInPublicSearch: 1 });
requestSchema.index({ seekerId: 1, donorId: 1 });
requestSchema.index({ donorId: 1, status: 1 });
requestSchema.index({ seekerId: 1, status: 1 });
// Broadcast screens count requests per broadcast (getMyBroadcasts, getBroadcastStatus).
requestSchema.index({ broadcastId: 1 });

const Donor = mongoose.model("Donor", donorSchema);
const DonationRequest = mongoose.model("DonationRequest", requestSchema);

module.exports = { Donor, DonationRequest };

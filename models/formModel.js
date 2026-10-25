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
    // GeoJSON mirror of `location` ([lng, lat]) that powers the indexed
    // $geoNear query behind GET /seeker/nearby-donors. Never written by
    // clients: the pre-save hook below derives it from `location`, and
    // utils/donorGeo.js backfills it for donors saved before it existed.
    // `default: undefined` matters: an empty `coordinates: []` would make the
    // 2dsphere index reject the document.
    geo: {
      type: { type: String, enum: ["Point"], default: undefined },
      coordinates: { type: [Number], default: undefined },
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
    // Set to false on each completed donation and to true once the resulting
    // rest window has been reconciled back to "available" (see
    // services/donorAvailabilityService.js). Makes that transition one-shot, so a
    // donor who later switches themselves off is never flipped back on.
    availabilityReconciled: { type: Boolean, default: false },
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

    // ---- Voluntary vs Compensation donors (request-flow feature) ----
    // VOLUNTARY (فی سبیل اللہ) or COMPENSATION (معاوضہ / سفری خرچ). The word "Paid"
    // is never used. Client-writable (registration / edit profile), validated below.
    donorType: { type: String, enum: ["VOLUNTARY", "COMPENSATION"], default: "VOLUNTARY" },
    // Optional travel-cost range for COMPENSATION donors. Fixed choices only, no free text.
    compensationRange: { type: String, enum: [null, "500", "1000", "1500", "2000"], default: null },
    // ---- Server-managed (a pre-save guard below stops clients from writing them) ----
    // Derived from donorType + fraud state; gives VOLUNTARY donors the green badge.
    badge: { type: String, enum: [null, "VOLUNTARY_HERO"], default: "VOLUNTARY_HERO" },
    // Reviewed + confirmed money-demand strikes. Two confirmed strikes = permanent blacklist.
    // (Kept: the badge derivation and the search filters below still read them.)
    confirmedFraudStrikes: { type: Number, default: 0 },
    isBlacklisted: { type: Boolean, default: false },
    blacklistedAt: { type: Date, default: null },

    // ---- Donation lifecycle (services/donationLifecycle) ----
    // One-active-donation mutex. Holds the DonationRequest the donor is currently
    // donating for (status donation_started / donation_agreed). It is claimed with a
    // conditional update ({ activeDonationRequestId: null } -> id), so two seekers
    // racing for the same donor can never both start. Server-managed.
    activeDonationRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "DonationRequest", default: null },
    // Temporary "cannot accept new requests" restriction, set when a seeker reports an
    // unreasonable delay. Server-managed.
    acceptBlockedUntil: { type: Date, default: null },
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

// Keeps the GeoJSON `geo` field in step with `location` on every save
// (registration + profile edits both go through save()). Invalid / missing
// coordinates remove `geo`, so the donor simply drops out of the geo index
// and is served by the no-coordinates "area" segment instead.
donorSchema.pre("save", function () {
  // Always re-derived (cheap), so a client can never inject its own `geo`.
  const lat = this.location ? this.location.latitude : null;
  const lng = this.location ? this.location.longitude : null;
  const valid =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);
  this.geo = valid ? { type: "Point", coordinates: [lng, lat] } : undefined;
});

// ---------------------------------------------------------------------------
// Server-managed guard. badge / blacklist / fraud counters, the active-donation mutex
// and the temporary accept restriction are owned by the backend (which writes them
// with atomic updateOne / findOneAndUpdate calls that bypass this hook). Registration
// and edit-profile both go through save(), so without this guard a client could send
// {activeDonationRequestId: null} or {acceptBlockedUntil: null} in the body and wipe
// its own restriction. The hook restores the stored value for any such field, then
// re-derives `badge` and keeps compensationRange consistent.
// ---------------------------------------------------------------------------
const SERVER_MANAGED_DONOR_FIELDS = [
  "badge",
  "confirmedFraudStrikes",
  "isBlacklisted",
  "blacklistedAt",
  "activeDonationRequestId",
  "acceptBlockedUntil",
];
const SERVER_MANAGED_DEFAULTS = {
  badge: null,
  confirmedFraudStrikes: 0,
  isBlacklisted: false,
  blacklistedAt: null,
  activeDonationRequestId: null,
  acceptBlockedUntil: null,
};

donorSchema.post("init", function (doc) {
  doc.$locals = doc.$locals || {};
  doc.$locals.managedOriginal = {};
  SERVER_MANAGED_DONOR_FIELDS.forEach((k) => {
    doc.$locals.managedOriginal[k] = doc.get(k);
  });
});

donorSchema.pre("save", function () {
  if (!(this.$locals && this.$locals.serverWrite)) {
    const original = (this.$locals && this.$locals.managedOriginal) || SERVER_MANAGED_DEFAULTS;
    SERVER_MANAGED_DONOR_FIELDS.forEach((k) => {
      if (this.isNew || this.isModified(k)) {
        this.set(k, original[k] !== undefined ? original[k] : SERVER_MANAGED_DEFAULTS[k]);
      }
    });
  }
  if (this.donorType !== "COMPENSATION") this.compensationRange = null;
  const clean = !this.isBlacklisted && (this.confirmedFraudStrikes || 0) < 2;
  this.badge = this.donorType === "VOLUNTARY" && clean ? "VOLUNTARY_HERO" : null;
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
    requestedBloodType: { type: String, required: true },
    seekerName: { type: String, required: true },
    seekerPhone: { type: String, required: true },
    seekerLocation: {
      province: { type: String, required: true },
      city: { type: String, required: true },
      addressLine: { type: String, required: true },
    },
    // Canonical request/donation state. The ONLY place the lifecycle state lives; every
    // transition is a conditional (atomic) write made by services/donationLifecycle, and
    // the app only ever renders this value (no frontend-only statuses).
    //   pending           notified, waiting for the donor (expires 12 h after requestedAt)
    //   accepted          donor accepted; seeker can message / lock / release
    //   locked            seeker locked the donor for donation ("Locked by Seeker")
    //   on_hold           locked, but the donor is busy with another seeker's donation
    //   donation_started  donor pressed "Donation Started"; waiting for the seeker to agree
    //                     (the brief's "waiting_for_seeker_agreement")
    //   seeker_not_yet    seeker answered "Not Yet"; donor can message / remind, never re-start
    //   donation_agreed   seeker agreed; "I have donated blood" / "Mark Complete" available
    //   completed         seeker confirmed the donation
    //   rejected          donor declined
    //   expired           nobody answered within 12 h (server worker)
    //   released          seeker released the donor (normal release)
    //   auto_released     donor donated to another seeker; released permanently
    //   donor_unable      donor chose "I can't donate at this time" (not an allegation)
    //   reported          seeker reported the donor for an unreasonable delay (allegation)
    //   cancelled_by_seeker  legacy value of the removed emergency broadcast; never written now
    status: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "locked",
        "on_hold",
        "donation_started",
        "seeker_not_yet",
        "donation_agreed",
        "completed",
        "rejected",
        "expired",
        "released",
        "auto_released",
        "donor_unable",
        "reported",
        "cancelled_by_seeker",
      ],
      default: "pending",
    },
    // ---- 12-hour request expiry (server clock only; never taken from the client) ----
    // requestedAt is stamped by the backend when the seeker notifies the donor;
    // expiresAt is EXACTLY requestedAt + 12 h. Re-notification stamps both again.
    // NOTE: deliberately separate from `expireAt` below, which is the legacy TTL-index
    // field (MongoDB deletes the document when it passes) and must stay null for live
    // requests.
    requestedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },

    // ---- Lock / release / hold ----
    lockedAt: { type: Date, default: null },
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    releasedAt: { type: Date, default: null },
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Why the request left the active flow. Persisted so the bulk "Re-notify Released
    // Donors" action can tell a NORMAL release (eligible) from everything else.
    releaseReason: {
      type: String,
      enum: [null, "seeker_released", "auto_other_donation", "donor_unable", "seeker_reported"],
      default: null,
    },
    // On Hold: the request of ANOTHER seeker that currently owns the donor.
    onHoldAt: { type: Date, default: null },
    onHoldByRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "DonationRequest", default: null },

    // ---- Donation started / seeker agreement ----
    donationStartedAt: { type: Date, default: null },
    seekerAgreedAt: { type: Date, default: null },
    // ---- "Not Yet" / reminder (nudge) ----
    // donationStartedAt doubles as the brief's lastDonationStartedAt: it is no longer wiped
    // by "Not Yet", and a second start is impossible once the status is seeker_not_yet, so no
    // separate donationStartAttempts counter is needed.
    seekerNotYetAt: { type: Date, default: null },
    seekerNotYetCount: { type: Number, default: 0 },
    // Server-authoritative 10-minute cooldown for "Send Reminder to Seeker".
    lastNudgeAt: { type: Date, default: null },
    nudgeCount: { type: Number, default: 0 },
    // The donor dismissed this (expired) card from their own list. Per-request == per-donor
    // (a DonationRequest belongs to one donor), so the seeker's data is never affected.
    donorDismissedAt: { type: Date, default: null },

    // ---- Failure paths ----
    // Set for BOTH failure paths (donor_unable / reported); drives bulk re-notification.
    failedAt: { type: Date, default: null },
    donorUnableAt: { type: Date, default: null },
    donorUnableReason: { type: String, default: "", maxlength: 500 },
    // Allegation (distinct from donor_unable): never eligible for bulk re-notification.
    reportedAt: { type: Date, default: null },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reportReason: { type: String, default: "", maxlength: 500 },

    // ---- Re-notification bookkeeping ----
    renotifyCount: { type: Number, default: 0 },
    lastRenotifiedAt: { type: Date, default: null },

    // ---- "Mark Complete" reminders (every 6 h after the donor marks the donation) ----
    // nextReminderAt is claimed atomically by the worker before sending, so several
    // server instances can never send the same reminder twice.
    nextReminderAt: { type: Date, default: null },
    lastReminderAt: { type: Date, default: null },
    reminderCount: { type: Number, default: 0 },
    // Audit trail kept from the removed broadcast cancellation (legacy documents only).
    cancelledAt: { type: Date, default: null },
    isRated: { type: Boolean, default: false }, // Tracks if seeker gave rating for this donation
    rating: { type: Number, default: 0 }, // Rating score given for this request
    completedAt: { type: Date, default: null },
    expireAt: { type: Date, default: null },

    // ---- Donor-confirms-donation -> seeker-confirms-received flow ----
    // Set the moment the donor taps "I have donated blood" on a donation_agreed
    // request (donorController/markDonated.js). `status` stays donation_agreed until
    // the seeker confirms via completeDonation.js. This timestamp starts the 6-hour
    // "Mark Complete" reminders, the seeker's temporary new-request block, and the
    // 3-day countdown services/chatCleanupCron.js uses.
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
// These mirror exactly what seekerSearchDonor.js, etc.
// already filter/sort by. Without them Mongo does a full collection scan
// on every search, which is fine with a handful of test donors but is
// exactly what turns into multi-second "hanging" requests once the donor
// collection grows into the thousands/millions — the query logic doesn't
// change at all, it just stops scanning every document to answer it.
donorSchema.index({ bloodType: 1, isAvailable: 1, appearsInPublicSearch: 1 });
donorSchema.index({ province: 1, district: 1 });
donorSchema.index({ isSuspended: 1, appearsInPublicSearch: 1 });
// Scheduled job: donors whose rest window has ended and not yet reconciled.
donorSchema.index({ nextAvailableDate: 1, availabilityReconciled: 1 });
// Nearby-donor feed (GET /seeker/nearby-donors): $geoNear needs the 2dsphere
// index (sparse by nature - donors without `geo` are skipped), and the
// no-coordinates/area segment sorts online-first then available-first.
donorSchema.index({ geo: "2dsphere" });
donorSchema.index({ isOnline: -1, isAvailable: -1, _id: 1 });
// Request-flow wave selection (voluntary, available, not blacklisted).
donorSchema.index({ bloodType: 1, donorType: 1, isAvailable: 1, isBlacklisted: 1 });
requestSchema.index({ seekerId: 1, donorId: 1 });
requestSchema.index({ donorId: 1, status: 1 });
requestSchema.index({ seekerId: 1, status: 1 });
// 12-hour expiry sweep: only pending rows carry the deadline, so the partial index stays tiny
// and the worker (services/donationLifecycle/jobs.js) never scans the whole collection.
requestSchema.index({ expiresAt: 1 }, { partialFilterExpression: { status: "pending" } });
// 6-hourly "Mark Complete" reminder sweep.
requestSchema.index({ nextReminderAt: 1 }, { partialFilterExpression: { status: "donation_agreed" } });
// Bulk re-notify eligibility / one-active-donation lookups per donor.
requestSchema.index({ seekerId: 1, status: 1, releasedAt: -1 });
requestSchema.index({ donorId: 1, status: 1, onHoldByRequestId: 1 });
// Donor / seeker history + request lists sort newest-first per user; without these
// MongoDB had to sort every one of a user's requests in memory on each load.
requestSchema.index({ donorId: 1, createdAt: -1 });
requestSchema.index({ seekerId: 1, createdAt: -1 });

const Donor = mongoose.model("Donor", donorSchema);
const DonationRequest = mongoose.model("DonationRequest", requestSchema);

module.exports = { Donor, DonationRequest };

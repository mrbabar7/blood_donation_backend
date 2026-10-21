// Donation lifecycle service (single canonical state machine for manual requests).
//
// Rules this file enforces (see constants.js / stateMachine.js for the pure parts):
//   * every status change is ONE conditional findOneAndUpdate ("compare-and-set"), so
//     concurrent requests can never both win and a stale client can never revive a
//     request (e.g. a late accept of an expired request);
//   * the one-active-donation-per-donor mutex is Donor.activeDonationRequestId, claimed
//     with { activeDonationRequestId: null } -> requestId. Exactly one concurrent claim
//     succeeds; a leftover claim from a crashed process is detected and healed;
//   * all times come from the server clock; the app never supplies a timestamp.
//
// The factory takes its collaborators so the identical code runs against an in-memory
// fake in tests/donationLifecycle.test.js. The default export is wired to the real models.
const C = require("./constants");
const sm = require("./stateMachine");

const { STATUS, RELEASE_REASON } = C;
const ok = (data = {}) => ({ ok: true, ...data });
const fail = (status, code, extra = {}) => ({ ok: false, status, code, ...extra });

const MAX_TEXT = 500;
const cleanText = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

function createLifecycleService(deps) {
  const { DonationRequest, Donor, notifyUser, emitStatus } = deps;
  const clock = deps.now || (() => new Date());
  const markNotificationsRead = deps.markNotificationsRead || (async () => []);

  // ---------------------------------------------------------------- primitives ----
  // Compare-and-set. Returns the document as it was BEFORE the update (lean) when the
  // filter still matched, otherwise null. `inc` is optional.
  async function claim(filter, set, inc) {
    const update = { $set: set };
    if (inc) update.$inc = inc;
    return DonationRequest.findOneAndUpdate(filter, update, { new: false }).lean();
  }

  const donorUserIdOf = async (donorId) => {
    const d = await Donor.findById(donorId).select("userId").lean();
    return d && d.userId ? String(d.userId) : null;
  };

  // Notify + realtime for one committed transition (best-effort, never throws).
  async function publish(prev, set, { donorUserId, seekerKey, donorKey, seekerParams, donorParams, critical } = {}) {
    const next = { ...prev, ...set };
    const donorUser = donorUserId !== undefined ? donorUserId : await donorUserIdOf(prev.donorId);
    emitStatus({
      request: next,
      previousStatus: prev.status,
      seekerUserId: prev.seekerId,
      donorUserId: donorUser,
    });
    const jobs = [];
    if (seekerKey) {
      jobs.push(
        notifyUser({
          userId: prev.seekerId,
          key: seekerKey,
          params: seekerParams,
          role: "seeker",
          requestId: prev._id,
          critical,
        }),
      );
    }
    if (donorKey && donorUser) {
      jobs.push(
        notifyUser({
          userId: donorUser,
          key: donorKey,
          params: donorParams,
          role: "donor",
          requestId: prev._id,
          critical,
        }),
      );
    }
    if (jobs.length) await Promise.allSettled(jobs);
    return next;
  }

  // ------------------------------------------------------------- donor mutex ----
  // The donor's current donation, validated: a claim whose request is no longer
  // donation_started/donation_agreed is stale (crash between the two writes) and is
  // cleared with a compare-and-set so it can never block the donor forever.
  async function liveActiveRequestId(donorId) {
    const donor = await Donor.findById(donorId).select("activeDonationRequestId").lean();
    const activeId = donor && donor.activeDonationRequestId;
    if (!activeId) return null;
    const r = await DonationRequest.findById(activeId).select("status donorId").lean();
    const live =
      r &&
      String(r.donorId) === String(donorId) &&
      (r.status === STATUS.DONATION_STARTED || r.status === STATUS.DONATION_AGREED);
    if (live) return String(activeId);
    await Donor.updateOne({ _id: donorId, activeDonationRequestId: activeId }, { $set: { activeDonationRequestId: null } });
    return null;
  }

  async function claimDonorMutex(donorId, requestId) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const got = await Donor.findOneAndUpdate(
        { _id: donorId, activeDonationRequestId: null },
        { $set: { activeDonationRequestId: requestId } },
        { new: true },
      )
        .select("_id")
        .lean();
      if (got) return { ok: true };
      const live = await liveActiveRequestId(donorId); // heals a stale claim
      if (live) return { ok: false, heldBy: live };
    }
    return { ok: false, heldBy: null };
  }

  const releaseDonorMutex = (donorId, requestId) =>
    Donor.updateOne({ _id: donorId, activeDonationRequestId: requestId }, { $set: { activeDonationRequestId: null } });

  // The attempt ended without a donation (cancelled / not agreed / reported): free the
  // donor and put every request that was On Hold behind it back to Locked by Seeker.
  async function freeDonorAndRevertHolds(donorId, requestId, donorUserId) {
    await releaseDonorMutex(donorId, requestId);
    const held = await DonationRequest.find({ donorId, status: STATUS.ON_HOLD }).select("_id").lean();
    let reverted = 0;
    for (const { _id } of held) {
      const set = { status: STATUS.LOCKED, onHoldAt: null, onHoldByRequestId: null };
      const prev = await claim({ _id, status: STATUS.ON_HOLD }, set);
      if (!prev) continue;
      reverted += 1;
      await publish(prev, set, { donorUserId, seekerKey: "holdReverted" });
    }
    return reverted;
  }

  // ----------------------------------------------------------------- expiry ----
  /** Server-side 12 h expiry. Idempotent: each row is claimed once; replays are no-ops. */
  async function expireDue({ now = clock(), seekerId, donorId, limit = 500 } = {}) {
    const filter = { status: STATUS.PENDING, expiresAt: { $lte: now } };
    if (seekerId) filter.seekerId = seekerId;
    if (donorId) filter.donorId = donorId;
    const due = await DonationRequest.find(filter).select("_id").limit(limit).lean();
    let expired = 0;
    for (const { _id } of due) {
      const set = { status: STATUS.EXPIRED, expiredAt: now };
      const prev = await claim({ _id, status: STATUS.PENDING, expiresAt: { $lte: now } }, set);
      if (!prev) continue; // another worker / a donor response got there first
      expired += 1;
      const donor = await Donor.findById(prev.donorId).select("fullName userId").lean();
      const donorUserId = donor && donor.userId ? String(donor.userId) : null;
      if (donorUserId) await markNotificationsRead(donorUserId, prev._id);
      await publish(prev, set, {
        donorUserId,
        seekerKey: "requestExpired",
        seekerParams: { name: (donor && donor.fullName) || "the donor" },
      });
    }
    return expired;
  }

  // ------------------------------------------------- seeker-side send gating ----
  const seekerCompletionBlock = async (seekerId, now = clock()) => {
    const cutoff = new Date(now.getTime() - C.policy().seekerCompleteBlockAfterMs);
    const r = await DonationRequest.findOne({
      seekerId,
      status: STATUS.DONATION_AGREED,
      donorMarkedDonatedAt: { $ne: null, $lte: cutoff },
    })
      .select("_id")
      .lean();
    return r ? String(r._id) : null;
  };

  /** Fresh server stamps for a (re-)notification. */
  const stampRequest = (now = clock()) => ({ requestedAt: now, expiresAt: sm.expiresAtFor(now) });

  /** An open request from this seeker to this donor (blocks a duplicate notify). */
  const findOpenRequest = (seekerId, donorId) =>
    DonationRequest.findOne({ seekerId, donorId, status: { $in: C.ACTIVE_STATUSES } }).select("_id status").lean();

  // ---------------------------------------------------------- donor responses ----
  async function diagnose(requestId, ownerFilter) {
    const r = await DonationRequest.findById(requestId).lean();
    if (!r || (ownerFilter && !ownerFilter(r))) return fail(404, "NOT_FOUND");
    if (r.status === STATUS.EXPIRED || (r.status === STATUS.PENDING && sm.isPastExpiry(r.expiresAt, clock()))) {
      if (r.status === STATUS.PENDING) await expireDue({ now: clock(), seekerId: r.seekerId, donorId: r.donorId });
      return fail(409, "REQUEST_EXPIRED", { currentStatus: STATUS.EXPIRED });
    }
    if (r.status === STATUS.CANCELLED_BY_SEEKER) return fail(409, "REQUEST_CANCELLED", { currentStatus: r.status });
    return fail(409, "INVALID_STATE", { currentStatus: r.status });
  }

  const donorByUser = (userId) =>
    Donor.findOne({ userId }).select("_id userId fullName acceptBlockedUntil isSuspended").lean();

  /** Donor accepts. A late accept of an expired request fails and never revives it. */
  async function acceptRequest({ donorUserId, requestId }) {
    const donor = await donorByUser(donorUserId);
    if (!donor) return fail(404, "DONOR_NOT_FOUND");
    const now = clock();
    if (donor.acceptBlockedUntil && new Date(donor.acceptBlockedUntil) > now) {
      return fail(403, "DONOR_RESTRICTED", { until: donor.acceptBlockedUntil });
    }
    const set = { status: STATUS.ACCEPTED, expireAt: null };
    const prev = await claim(
      { _id: requestId, donorId: donor._id, status: STATUS.PENDING, expiresAt: { $gt: now } },
      set,
    );
    if (!prev) return diagnose(requestId, (r) => String(r.donorId) === String(donor._id));
    return ok({ request: { ...prev, ...set }, donor });
  }

  /** Donor declines (only while pending and not expired). */
  async function rejectRequest({ donorUserId, requestId, retainUntil }) {
    const donor = await donorByUser(donorUserId);
    if (!donor) return fail(404, "DONOR_NOT_FOUND");
    const now = clock();
    const set = { status: STATUS.REJECTED, expireAt: retainUntil || null };
    const prev = await claim(
      { _id: requestId, donorId: donor._id, status: STATUS.PENDING, expiresAt: { $gt: now } },
      set,
    );
    if (!prev) return diagnose(requestId, (r) => String(r.donorId) === String(donor._id));
    return ok({ request: { ...prev, ...set }, donor });
  }

  // ------------------------------------------------------------ seeker: lock ----
  async function lock({ seekerId, requestId }) {
    const r = await DonationRequest.findOne({ _id: requestId, seekerId }).lean();
    if (!r) return fail(404, "NOT_FOUND");
    if (r.status !== STATUS.ACCEPTED) return fail(409, "INVALID_STATE", { currentStatus: r.status });

    const donor = await Donor.findById(r.donorId).select("userId fullName nextAvailableDate isSuspended").lean();
    if (!donor) return fail(404, "DONOR_NOT_FOUND");
    const now = clock();
    if (donor.nextAvailableDate && new Date(donor.nextAvailableDate) > now) return fail(409, "DONOR_RESTING");

    const set = { status: STATUS.LOCKED, lockedAt: now, lockedBy: seekerId, expireAt: null };
    const prev = await claim({ _id: requestId, seekerId, status: STATUS.ACCEPTED }, set);
    if (!prev) return diagnose(requestId, (x) => String(x.seekerId) === String(seekerId));

    const donorUserId = donor.userId ? String(donor.userId) : null;
    let next = await publish(prev, set, { donorUserId, donorKey: "donorLocked", critical: true });

    // Race guard: the donor may have started another seeker's donation between our status
    // check and the write above. The donation start claims the mutex FIRST and sweeps
    // Locked requests AFTER, so either that sweep sees this row, or the mutex is already
    // visible here. Whichever happens, the row ends On Hold.
    const busyWith = await liveActiveRequestId(r.donorId);
    if (busyWith && busyWith !== String(requestId)) {
      const hold = { status: STATUS.ON_HOLD, onHoldAt: clock(), onHoldByRequestId: busyWith };
      const heldPrev = await claim({ _id: requestId, status: STATUS.LOCKED }, hold);
      if (heldPrev) next = await publish(heldPrev, hold, { donorUserId, seekerKey: "onHold" });
    }

    // Race guard 2: a donation completed meanwhile put the donor into recovery.
    const fresh = await Donor.findById(r.donorId).select("nextAvailableDate").lean();
    if (fresh && fresh.nextAvailableDate && new Date(fresh.nextAvailableDate) > clock()) {
      const auto = {
        status: STATUS.AUTO_RELEASED,
        releasedAt: clock(),
        releaseReason: RELEASE_REASON.AUTO_OTHER_DONATION,
        onHoldAt: null,
        onHoldByRequestId: null,
      };
      const autoPrev = await claim({ _id: requestId, status: { $in: [STATUS.LOCKED, STATUS.ON_HOLD] } }, auto);
      if (autoPrev) {
        await publish(autoPrev, auto, { donorUserId, seekerKey: "autoReleased" });
        return fail(409, "DONOR_RESTING");
      }
    }
    return ok({ request: next });
  }

  // --------------------------------------------------------- seeker: release ----
  async function release({ seekerId, requestId }) {
    const now = clock();
    const set = {
      status: STATUS.RELEASED,
      releasedAt: now,
      releasedBy: seekerId,
      releaseReason: RELEASE_REASON.SEEKER_RELEASED,
      onHoldAt: null,
      onHoldByRequestId: null,
    };
    const prev = await claim(
      { _id: requestId, seekerId, status: { $in: [STATUS.ACCEPTED, STATUS.LOCKED, STATUS.ON_HOLD] } },
      set,
    );
    if (!prev) return diagnose(requestId, (x) => String(x.seekerId) === String(seekerId));
    const next = await publish(prev, set, { donorKey: "donorReleased" });
    return ok({ request: next });
  }

  // ----------------------------------------------- donor: Donation Started ----
  async function startDonation({ donorUserId, requestId }) {
    const donor = await donorByUser(donorUserId);
    if (!donor) return fail(404, "DONOR_NOT_FOUND");
    const r = await DonationRequest.findById(requestId).lean();
    if (!r || String(r.donorId) !== String(donor._id)) return fail(404, "NOT_FOUND");
    if (r.status === STATUS.ON_HOLD) return fail(409, "DONOR_BUSY", { currentStatus: r.status });
    if (r.status !== STATUS.LOCKED) return fail(409, "INVALID_STATE", { currentStatus: r.status });

    // 1) mutex first - exactly one concurrent start can hold it.
    const got = await claimDonorMutex(donor._id, requestId);
    if (!got.ok) return fail(409, "DONOR_BUSY", { heldBy: got.heldBy });

    // 2) then the request itself, only if it is still Locked.
    const now = clock();
    const set = { status: STATUS.DONATION_STARTED, donationStartedAt: now, seekerAgreedAt: null };
    const prev = await claim({ _id: requestId, donorId: donor._id, status: STATUS.LOCKED }, set);
    if (!prev) {
      await releaseDonorMutex(donor._id, requestId); // compensate
      return diagnose(requestId, (x) => String(x.donorId) === String(donor._id));
    }

    // 3) the donor's other Locked requests go On Hold (and their seekers are told).
    const others = await DonationRequest.find({
      donorId: donor._id,
      status: STATUS.LOCKED,
      _id: { $ne: requestId },
    })
      .select("_id")
      .lean();
    for (const { _id } of others) {
      const hold = { status: STATUS.ON_HOLD, onHoldAt: now, onHoldByRequestId: requestId };
      const heldPrev = await claim({ _id, status: STATUS.LOCKED }, hold);
      if (heldPrev) await publish(heldPrev, hold, { donorUserId: String(donorUserId), seekerKey: "onHold" });
    }

    const next = await publish(prev, set, {
      donorUserId: String(donorUserId),
      seekerKey: "donationStarted",
      critical: true,
    });
    return ok({ request: next });
  }

  // --------------------------------------------- seeker: agree / do not agree ----
  async function agree({ seekerId, requestId }) {
    const now = clock();
    const set = { status: STATUS.DONATION_AGREED, seekerAgreedAt: now };
    const prev = await claim({ _id: requestId, seekerId, status: STATUS.DONATION_STARTED }, set);
    if (!prev) return diagnose(requestId, (x) => String(x.seekerId) === String(seekerId));
    const next = await publish(prev, set, { donorKey: "donationAgreed", critical: true });
    return ok({ request: next });
  }

  async function disagree({ seekerId, requestId }) {
    const set = { status: STATUS.LOCKED, donationStartedAt: null, seekerAgreedAt: null };
    const prev = await claim({ _id: requestId, seekerId, status: STATUS.DONATION_STARTED }, set);
    if (!prev) return diagnose(requestId, (x) => String(x.seekerId) === String(seekerId));
    const donorUserId = await donorUserIdOf(prev.donorId);
    const reverted = await freeDonorAndRevertHolds(prev.donorId, prev._id, donorUserId);
    const next = await publish(prev, set, { donorUserId, donorKey: "donationNotAgreed" });
    return ok({ request: next, revertedHolds: reverted });
  }

  // ----------------------------------------------- donor: "I can't donate now" ----
  // Voluntary path: NEVER an allegation. Ends the attempt, frees the donor, enables
  // bulk re-notification of normally released donors.
  async function donorUnable({ donorUserId, requestId, message }) {
    const text = cleanText(message);
    if (!text) return fail(400, "REASON_REQUIRED");
    const donor = await donorByUser(donorUserId);
    if (!donor) return fail(404, "DONOR_NOT_FOUND");
    const now = clock();
    const set = {
      status: STATUS.DONOR_UNABLE,
      failedAt: now,
      donorUnableAt: now,
      donorUnableReason: text,
      releasedAt: now,
      releasedBy: donorUserId,
      releaseReason: RELEASE_REASON.DONOR_UNABLE,
      onHoldAt: null,
      onHoldByRequestId: null,
    };
    const prev = await claim(
      {
        _id: requestId,
        donorId: donor._id,
        status: { $in: [STATUS.LOCKED, STATUS.ON_HOLD, STATUS.DONATION_STARTED, STATUS.DONATION_AGREED] },
        donorMarkedDonatedAt: null,
      },
      set,
    );
    if (!prev) return diagnose(requestId, (x) => String(x.donorId) === String(donor._id));
    let reverted = 0;
    if (prev.status === STATUS.DONATION_STARTED || prev.status === STATUS.DONATION_AGREED) {
      reverted = await freeDonorAndRevertHolds(donor._id, prev._id, String(donorUserId));
    }
    const next = await publish(prev, set, {
      donorUserId: String(donorUserId),
      seekerKey: "donorUnable",
      seekerParams: { name: donor.fullName || "The donor", message: text },
    });
    return ok({ request: next, revertedHolds: reverted });
  }

  // ----------------------------------------------- seeker: report (allegation) ----
  async function reportDonor({ seekerId, requestId, reason }) {
    const text = cleanText(reason);
    if (text.length < 3) return fail(400, "REASON_REQUIRED");
    const r = await DonationRequest.findOne({ _id: requestId, seekerId }).lean();
    if (!r) return fail(404, "NOT_FOUND");
    const now = clock();
    const minWait = C.policy().reportMinWaitMs;
    if (
      [STATUS.LOCKED, STATUS.DONATION_STARTED, STATUS.DONATION_AGREED].includes(r.status) &&
      minWait > 0 &&
      r.lockedAt &&
      now.getTime() - new Date(r.lockedAt).getTime() < minWait
    ) {
      return fail(409, "REPORT_TOO_EARLY", { minutes: Math.ceil(minWait / C.MIN_MS) });
    }
    const set = {
      status: STATUS.REPORTED,
      failedAt: now,
      reportedAt: now,
      reportedBy: seekerId,
      reportReason: text,
      releasedAt: now,
      releasedBy: seekerId,
      releaseReason: RELEASE_REASON.SEEKER_REPORTED,
    };
    const prev = await claim(
      {
        _id: requestId,
        seekerId,
        status: { $in: [STATUS.LOCKED, STATUS.DONATION_STARTED, STATUS.DONATION_AGREED] },
        donorMarkedDonatedAt: null,
      },
      set,
    );
    if (!prev) return diagnose(requestId, (x) => String(x.seekerId) === String(seekerId));

    const blockMs = C.policy().donorReportBlockMs;
    const until = new Date(now.getTime() + blockMs);
    // $max: concurrent reports can only extend the restriction, never shorten it.
    await Donor.updateOne({ _id: prev.donorId }, { $max: { acceptBlockedUntil: until } });
    const donorUserId = await donorUserIdOf(prev.donorId);
    let reverted = 0;
    if (prev.status === STATUS.DONATION_STARTED || prev.status === STATUS.DONATION_AGREED) {
      reverted = await freeDonorAndRevertHolds(prev.donorId, prev._id, donorUserId);
    }
    const next = await publish(prev, set, {
      donorUserId,
      donorKey: "donorReported",
      donorParams: { hours: Math.round(blockMs / C.HOUR_MS) },
    });
    return ok({ request: next, revertedHolds: reverted, restrictedUntil: until });
  }

  // ------------------------------------------- donor: "I have donated blood" ----
  async function markDonated({ donorUserId, requestId }) {
    const donor = await donorByUser(donorUserId);
    if (!donor) return fail(404, "DONOR_NOT_FOUND");
    const now = clock();
    const set = { donorMarkedDonatedAt: now, nextReminderAt: sm.nextReminderAt(now), reminderCount: 0 };
    const prev = await claim(
      { _id: requestId, donorId: donor._id, status: STATUS.DONATION_AGREED, donorMarkedDonatedAt: null },
      set,
    );
    if (!prev) {
      const r = await DonationRequest.findById(requestId).lean();
      if (!r || String(r.donorId) !== String(donor._id)) return fail(404, "NOT_FOUND");
      if (r.status === STATUS.DONATION_AGREED && r.donorMarkedDonatedAt) return ok({ request: r, alreadyMarked: true });
      if (r.status === STATUS.DONATION_STARTED) return fail(409, "NOT_AGREED", { currentStatus: r.status });
      return fail(409, "INVALID_STATE", { currentStatus: r.status });
    }
    return ok({ request: { ...prev, ...set }, donor });
  }

  // ------------------------------------------------------ seeker: completion ----
  // Atomic: only ONE caller can move donation_agreed -> completed, so a double tap can
  // never double-count a donation. Requires the persisted seeker agreement.
  async function claimCompletion({ seekerId, requestId, rating }) {
    const now = clock();
    const set = {
      status: STATUS.COMPLETED,
      completedAt: now,
      isRated: true,
      rating,
      nextReminderAt: null,
    };
    const prev = await claim({ _id: requestId, seekerId, status: STATUS.DONATION_AGREED }, set);
    if (prev) return ok({ request: { ...prev, ...set }, previous: prev });
    const r = await DonationRequest.findById(requestId).lean();
    if (!r) return fail(404, "NOT_FOUND");
    if (String(r.seekerId) !== String(seekerId)) return fail(403, "FORBIDDEN");
    if (r.status === STATUS.COMPLETED) return fail(409, "ALREADY_COMPLETED", { currentStatus: r.status });
    if (r.status === STATUS.CANCELLED_BY_SEEKER) return fail(409, "REQUEST_CANCELLED", { currentStatus: r.status });
    if ([STATUS.ACCEPTED, STATUS.LOCKED, STATUS.ON_HOLD, STATUS.DONATION_STARTED].includes(r.status)) {
      return fail(409, "NOT_AGREED", { currentStatus: r.status });
    }
    return fail(409, "INVALID_STATE", { currentStatus: r.status });
  }

  // After a donation completed: free the donor and PERMANENTLY auto-release every other
  // Locked / On Hold request of that donor (never reverted). Unrelated Accepted-but-not-
  // locked requests are intentionally left alone.
  async function afterCompletion({ request, donorUserId }) {
    const donorId = request.donorId;
    await releaseDonorMutex(donorId, request._id);
    const others = await DonationRequest.find({
      donorId,
      _id: { $ne: request._id },
      status: { $in: [STATUS.LOCKED, STATUS.ON_HOLD] },
    })
      .select("_id")
      .lean();
    let released = 0;
    for (const { _id } of others) {
      const set = {
        status: STATUS.AUTO_RELEASED,
        releasedAt: clock(),
        releaseReason: RELEASE_REASON.AUTO_OTHER_DONATION,
        onHoldAt: null,
        onHoldByRequestId: null,
      };
      const prev = await claim({ _id, status: { $in: [STATUS.LOCKED, STATUS.ON_HOLD] } }, set);
      if (!prev) continue;
      released += 1;
      await publish(prev, set, { donorUserId, seekerKey: "autoReleased" });
    }
    emitStatus({
      request,
      previousStatus: STATUS.DONATION_AGREED,
      seekerUserId: request.seekerId,
      donorUserId,
    });
    return released;
  }

  // ------------------------------------------- bulk "Re-notify Released Donors" ----
  async function renotifyInfo({ seekerId, now = clock() }) {
    const cutoff = new Date(now.getTime() - C.RENOTIFY_WINDOW_MS);
    const rows = await DonationRequest.find({
      seekerId,
      $or: [
        { status: STATUS.RELEASED, releasedAt: { $gte: cutoff } },
        { status: { $in: C.FAILED_STATUSES }, failedAt: { $gte: cutoff } },
        { status: { $in: C.ACTIVE_STATUSES } },
      ],
    })
      .select("_id donorId status releaseReason releasedAt failedAt reportedAt")
      .lean();
    const eligible = sm.eligibleForBulkRenotify({ rows, now });
    return { eligible, count: eligible.length, visible: eligible.length > 0 };
  }

  async function bulkRenotify({ seekerId }) {
    const blocked = await seekerCompletionBlock(seekerId);
    if (blocked) return fail(403, "SEEKER_BLOCKED", { blockedBy: blocked });
    const now = clock();
    const info = await renotifyInfo({ seekerId, now });
    if (!info.count) return fail(409, "NOTHING_TO_RENOTIFY");

    const stamp = stampRequest(now);
    const cutoff = new Date(now.getTime() - C.RENOTIFY_WINDOW_MS);
    const summary = { renotified: 0, skipped: 0, requestIds: [] };
    for (const row of info.eligible) {
      const donor = await Donor.findById(row.donorId)
        .select("userId fullName isAvailable nextAvailableDate isSuspended acceptBlockedUntil")
        .lean();
      const unavailable =
        !donor ||
        donor.isSuspended ||
        donor.isAvailable === false ||
        (donor.nextAvailableDate && new Date(donor.nextAvailableDate) > now) ||
        (donor.acceptBlockedUntil && new Date(donor.acceptBlockedUntil) > now);
      if (unavailable) {
        summary.skipped += 1;
        continue;
      }
      const set = {
        status: STATUS.PENDING,
        requestedAt: stamp.requestedAt,
        expiresAt: stamp.expiresAt,
        expiredAt: null,
        releasedAt: null,
        releasedBy: null,
        releaseReason: null,
        lockedAt: null,
        lockedBy: null,
        onHoldAt: null,
        onHoldByRequestId: null,
        donationStartedAt: null,
        seekerAgreedAt: null,
        lastRenotifiedAt: now,
        expireAt: null,
      };
      // Per-row compare-and-set: a repeated / concurrent bulk call cannot transition (or
      // notify) the same row twice.
      const prev = await claim(
        {
          _id: row._id,
          seekerId,
          status: STATUS.RELEASED,
          releaseReason: RELEASE_REASON.SEEKER_RELEASED,
          releasedAt: { $gte: cutoff },
        },
        set,
        { renotifyCount: 1 },
      );
      if (!prev) continue;
      summary.renotified += 1;
      summary.requestIds.push(String(row._id));
      const donorUserId = donor.userId ? String(donor.userId) : null;
      await publish(prev, set, { donorUserId, donorKey: "renotify" });
      if (deps.emitNewRequest) await deps.emitNewRequest({ ...prev, ...set }, donorUserId);
    }
    return ok({ ...summary, alreadyProcessed: summary.renotified === 0 && summary.skipped === 0 });
  }

  // --------------------------------------------------- 6-hourly reminders ----
  async function sendDueReminders({ now = clock(), limit = 200 } = {}) {
    let sent = 0;
    for (let i = 0; i < limit; i += 1) {
      // Claim BEFORE sending: the cursor moves 6 h ahead atomically, so another worker
      // (or the next tick) cannot send the same reminder. A row that is completed or
      // cancelled no longer matches, which stops the reminders immediately.
      const prev = await claim(
        {
          status: STATUS.DONATION_AGREED,
          donorMarkedDonatedAt: { $ne: null },
          nextReminderAt: { $lte: now },
        },
        { nextReminderAt: sm.nextReminderAt(now), lastReminderAt: now },
        { reminderCount: 1 },
      );
      if (!prev) break;
      sent += 1;
      await notifyUser({
        userId: prev.seekerId,
        key: "completeReminder",
        role: "seeker",
        requestId: prev._id,
        critical: true,
      });
    }
    return sent;
  }

  // ------------------------------------------------------- startup migration ----
  async function backfill() {
    const FIELD = C.REQUEST_TTL_MS;
    // Legacy pending requests had no 12 h deadline: derive it from createdAt (idempotent).
    if (deps.rawUpdateMany) {
      await deps.rawUpdateMany(
        { status: STATUS.PENDING, expiresAt: null },
        [
          {
            $set: {
              requestedAt: { $ifNull: ["$requestedAt", "$createdAt"] },
              expiresAt: { $add: [{ $ifNull: ["$requestedAt", "$createdAt"] }, FIELD] },
            },
          },
        ],
      );
    }
    // Live requests must never be removed by the legacy 7-day TTL index.
    await DonationRequest.updateMany(
      { status: { $in: [...C.ACTIVE_STATUSES, STATUS.COMPLETED] }, expireAt: { $ne: null } },
      { $set: { expireAt: null } },
    );
  }

  return {
    claim,
    expireDue,
    seekerCompletionBlock,
    stampRequest,
    findOpenRequest,
    acceptRequest,
    rejectRequest,
    lock,
    release,
    startDonation,
    agree,
    disagree,
    donorUnable,
    reportDonor,
    markDonated,
    claimCompletion,
    afterCompletion,
    renotifyInfo,
    bulkRenotify,
    sendDueReminders,
    backfill,
    liveActiveRequestId,
    claimDonorMutex,
  };
}

// ---- default wiring (real models) -------------------------------------------------
let defaultInstance = null;
const getService = () => {
  if (defaultInstance) return defaultInstance;
  const { DonationRequest, Donor } = require("../../models/formModel");
  const { notifyUser, emitStatus } = require("./notify");
  defaultInstance = createLifecycleService({
    DonationRequest,
    Donor,
    notifyUser,
    emitStatus,
    markNotificationsRead: (userId, requestId) =>
      require("../../controllers/notificationController").markRequestNotificationsRead(userId, requestId),
    rawUpdateMany: (filter, pipeline) => DonationRequest.collection.updateMany(filter, pipeline),
    emitNewRequest: async (request, donorUserId) => {
      // Same event + shape sendBloodRequest emits, so the donor's list shows the
      // re-notified request instantly.
      const { emitToUser } = require("../socketService");
      const userModel = require("../../models/userMode");
      const seeker = await userModel.findById(request.seekerId).select("email profilePicture").lean();
      const loc = request.seekerLocation || {};
      emitToUser(donorUserId, "new_blood_request_received", {
        ...request,
        seekerId: {
          _id: request.seekerId,
          fullName: request.seekerName,
          phone: request.seekerPhone,
          email: (seeker && seeker.email) || "",
          profilePicture: (seeker && seeker.profilePicture) || "",
          location: `${loc.addressLine || ""}, ${loc.city || ""}, ${loc.province || ""}`,
          city: loc.city || "",
          province: loc.province || "",
          addressLine: loc.addressLine || "",
        },
      });
    },
  });
  return defaultInstance;
};

// Lazy proxy: requiring this module never touches mongoose/models until first use.
const service = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === "createLifecycleService") return createLifecycleService;
      return getService()[prop];
    },
  },
);

module.exports = service;
module.exports.createLifecycleService = createLifecycleService;

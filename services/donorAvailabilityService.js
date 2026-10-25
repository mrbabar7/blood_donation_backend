const { Donor } = require("../models/formModel");
const AvailabilitySubscription = require("../models/availabilitySubscriptionModel");
const { createNotification } = require("../controllers/notificationController");
const { isBlockedBetween } = require("../utils/blocks");

// Tells every seeker still waiting on `donor` that they can request now.
// Each subscription is CLAIMED with an atomic "set notifiedAt where it is
// still null" before anything is sent, so concurrent callers (cron + a
// profile view + a second server instance) can never double-notify.
async function notifySubscribers(donor) {
  const subs = await AvailabilitySubscription.find({ donorId: donor._id, notifiedAt: null })
    .select("_id seekerId")
    .lean();
  let sent = 0;
  for (const sub of subs) {
    try {
      const claim = await AvailabilitySubscription.updateOne(
        { _id: sub._id, notifiedAt: null },
        { $set: { notifiedAt: new Date() } },
      );
      if (claim.modifiedCount !== 1) continue; // another worker already took it

      const donorUserId = donor.userId && donor.userId._id ? donor.userId._id : donor.userId;
      if (donorUserId && (await isBlockedBetween(sub.seekerId, donorUserId))) continue;

      await createNotification({
        userId: sub.seekerId,
        title: "Donor available again",
        category: "status",
        message: `${donor.fullName} has finished their recovery period and is available to donate again. You can send a request now.`,
        link: `/donor-profile/${donor._id}`,
      });
      sent += 1;
    } catch (err) {
      console.error("[availability] notify subscriber failed:", err.message);
    }
  }
  return sent;
}

// Moves a donor whose recovery window has ended back to "available".
//
//  - Atomic and idempotent: only the caller whose update actually matches
//    (window ended, not yet reconciled, not suspended) wins and sends the
//    notifications; everyone else is a no-op.
//  - `availabilityReconciled` makes this one-shot per donation. After it is
//    stamped, a donor who later switches themselves off by choice is never
//    flipped back on by this code.
//  - Updates the in-memory `donor` too, so the caller sees the new state.
// Returns true only when THIS call performed the transition.
async function reconcileDonorAvailability(donor, now = new Date()) {
  try {
    if (!donor || !donor.nextAvailableDate) return false;
    if (new Date(donor.nextAvailableDate).getTime() > now.getTime()) return false;
    if (donor.availabilityReconciled === true || donor.isSuspended) return false;

    const res = await Donor.updateOne(
      {
        _id: donor._id,
        isSuspended: { $ne: true },
        availabilityReconciled: { $ne: true },
        nextAvailableDate: { $lte: now },
      },
      { $set: { isAvailable: true, availabilityReconciled: true } },
    );
    if (res.matchedCount !== 1) {
      // Lost the race - pick up whatever the winner wrote.
      const fresh = await Donor.findById(donor._id).select("isAvailable availabilityReconciled").lean();
      if (fresh) {
        donor.isAvailable = fresh.isAvailable;
        donor.availabilityReconciled = fresh.availabilityReconciled;
      }
      return false;
    }
    donor.isAvailable = true;
    donor.availabilityReconciled = true;
    // Tell the donor themself they can donate again ("Eligibility reminders"
    // preference in Profile > Notification preferences).
    const donorUserId = donor.userId && donor.userId._id ? donor.userId._id : donor.userId;
    if (donorUserId) {
      createNotification({
        userId: donorUserId,
        title: "You can donate again",
        category: "eligibility",
        message: "Your recovery period is over — you're eligible to donate blood again and are now visible to people who need your help.",
        link: "/(tabs)/home",
      });
    }
    await notifySubscribers(donor);
    return true;
  } catch (err) {
    // Reconciliation is a best-effort improvement; it must never break the
    // request that happened to trigger it.
    console.error("[availability] reconcile failed:", err.message);
    return false;
  }
}

// Batch version used by the scheduled job.
async function reconcileExpiredRecoveries(now = new Date()) {
  let transitioned = 0;
  const cursor = Donor.find({
    nextAvailableDate: { $lte: now },
    availabilityReconciled: { $ne: true },
    isSuspended: { $ne: true },
  })
    .select("_id userId fullName nextAvailableDate isAvailable isSuspended availabilityReconciled")
    .cursor();
  for await (const donor of cursor) {
    if (await reconcileDonorAvailability(donor, now)) transitioned += 1;
  }
  return transitioned;
}

// Which of these donors is the seeker still waiting on? Used by the donor LIST
// endpoints so each resting card renders its subscribed state in one query
// (no per-card request). Returns a Set of donor id strings.
async function pendingSubscriptionSet(seekerId, donorIds) {
  if (!seekerId || !donorIds || donorIds.length === 0) return new Set();
  try {
    const rows = await AvailabilitySubscription.find({ seekerId, donorId: { $in: donorIds }, notifiedAt: null })
      .select("donorId")
      .lean();
    return new Set(rows.map((r) => String(r.donorId)));
  } catch (err) {
    console.error("[availability] subscription lookup failed:", err.message);
    return new Set();
  }
}

// Adds `isSubscribed` to the RESTING entries of an already-shaped donor list.
// Active donors are left untouched (their cards have no subscription UI).
async function attachSubscriptionState(seekerId, shapedDonors) {
  const resting = (shapedDonors || []).filter((d) => d && d.isResting);
  if (resting.length === 0) return shapedDonors;
  const subscribed = await pendingSubscriptionSet(
    seekerId,
    resting.map((d) => d._id),
  );
  resting.forEach((d) => {
    d.isSubscribed = subscribed.has(String(d._id));
  });
  return shapedDonors;
}

// Persists the "window ended" transition for donors a list just displayed as
// available because the scheduled job has not reached them yet. Fire-and-forget
// and capped, so a list response never waits on it; reconcileDonorAvailability
// is atomic/idempotent, so racing the cron or another request is harmless.
const LIST_RECONCILE_CAP = 10;
function reconcileStaleInBackground(donorDocs) {
  const batch = (donorDocs || []).slice(0, LIST_RECONCILE_CAP);
  if (batch.length === 0) return;
  setImmediate(async () => {
    for (const donor of batch) {
      await reconcileDonorAvailability(donor);
    }
  });
}

module.exports = {
  reconcileDonorAvailability,
  reconcileExpiredRecoveries,
  notifySubscribers,
  pendingSubscriptionSet,
  attachSubscriptionState,
  reconcileStaleInBackground,
};

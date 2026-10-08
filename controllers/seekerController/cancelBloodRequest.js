const { DonationRequest, Donor } = require("../../models/formModel");
const userModel = require("../../models/userMode");
const { createNotification } = require("../notificationController");

exports.cancelRequest = async (req, res) => {
  try {
    const { donorId } = req.params;
    const seekerId = req.user.id || req.user._id;

    const deletedRequest = await DonationRequest.findOneAndDelete({
      donorId,
      seekerId,
      status: "pending",
    });

    if (!deletedRequest) {
      return res
        .status(404)
        .json({ success: false, message: "No pending request found" });
    }

    const seeker = await userModel.findById(seekerId);
    const donor = await Donor.findById(donorId).populate("userId");

    if (donor && donor.userId) {
      await createNotification({
        userId: donor.userId._id,
        title: "Blood Request Cancelled",
      category: "status",
        message: `${seeker ? seeker.name : "A seeker"} cancelled their blood request.`,
        link: "/(tabs)/home", // Donor dashboard is rendered by (tabs)/home based on role — see src/screens/DonorDashboard.tsx
      });
    }

    res.status(200).json({
      success: true,
      message: "Request cancelled successfully and donor notified.",
    });
  } catch (error) {
    console.error("Cancel Request Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel request",
      error: error.message,
    });
  }
};

// DELETE /seeker/cancel-broadcast/:broadcastId — cancels an entire "Post a
// Request" fan-out.
//
//   * parent Broadcast            -> "cancelled_by_seeker"
//   * every child DonationRequest -> "cancelled_by_seeker" if it was still
//     "pending" OR "accepted" (so an accepted donor's Chat / "I have donated"
//     actions disappear too). Nothing is deleted: rows are kept for audit, and
//     their TTL expiry is cleared so Mongo's TTL index can't purge them later.
//   * rejected / completed children are left exactly as they were.
//
// Consistency: parent + children are written in one MongoDB transaction when
// the deployment supports it (replica set / Atlas). On a standalone mongod
// (no transactions) it falls back to a "claim the parent first, then sweep the
// children" order, and a repeated call re-runs the child sweep, so a crash in
// between can never leave a cancelled parent with permanently-active children.
//
// Direct (one-donor) requests use cancelRequest above and are untouched.
const CANCELLED_BY_SEEKER = "cancelled_by_seeker";

const runAtomic = async (work) => {
  const mongoose = require("mongoose");
  let session = null;
  try {
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    const msg = String(err?.message || "");
    const unsupported =
      err?.code === 20 ||
      /Transaction numbers are only allowed|replica set|transactions? (is|are) not supported/i.test(msg);
    if (!unsupported) throw err;
    return work(null); // standalone MongoDB: ordered, idempotent fallback
  } finally {
    if (session) session.endSession();
  }
};

exports.cancelBroadcast = async (req, res) => {
  try {
    const { broadcastId } = req.params;
    const seekerId = req.user.id || req.user._id;
    const Broadcast = require("../../models/broadcastModel");
    const { emitToUser } = require("../../services/socketService");

    const now = new Date();
    const childPatch = { $set: { status: CANCELLED_BY_SEEKER, cancelledAt: now, expireAt: null } };

    const outcome = await runAtomic(async (session) => {
      const broadcast = await Broadcast.findOne({ _id: broadcastId, seekerId }).session(session);
      if (!broadcast) return { kind: "not_found" };

      // Repeat cancellation: idempotent. Also sweeps any child that an earlier
      // interrupted attempt left active, then reports a controlled error.
      if (broadcast.status === CANCELLED_BY_SEEKER || broadcast.status === "cancelled") {
        await DonationRequest.updateMany(
          { broadcastId, status: { $in: ["pending", "accepted"] } },
          childPatch
        ).session(session);
        return { kind: "already" };
      }
      if (broadcast.status !== "active") return { kind: "not_cancellable" };

      // Once a donation has been marked/confirmed the lifecycle is legitimate
      // and must not be silently overwritten, so cancellation is refused.
      const locked = await DonationRequest.exists({
        broadcastId,
        $or: [{ status: "completed" }, { status: "accepted", donorMarkedDonatedAt: { $ne: null } }],
      }).session(session);
      if (locked) return { kind: "not_cancellable" };

      const affected = await DonationRequest.find({ broadcastId, status: { $in: ["pending", "accepted"] } })
        .select("_id donorId status")
        .session(session)
        .lean();

      // Claim the parent first; only one concurrent cancel can win this.
      const claimed = await Broadcast.findOneAndUpdate(
        { _id: broadcastId, seekerId, status: "active" },
        { $set: { status: CANCELLED_BY_SEEKER, cancelledAt: now } },
        { new: true }
      ).session(session);
      if (!claimed) return { kind: "already" };

      await DonationRequest.updateMany(
        { _id: { $in: affected.map((r) => r._id) }, status: { $in: ["pending", "accepted"] } },
        childPatch
      ).session(session);

      return { kind: "cancelled", affected };
    });

    if (outcome.kind === "not_found") {
      return res.status(404).json({ success: false, message: "Broadcast not found" });
    }
    if (outcome.kind === "already") {
      return res.status(409).json({
        success: false,
        code: "ALREADY_CANCELLED",
        message: "This request has already been cancelled.",
      });
    }
    if (outcome.kind === "not_cancellable") {
      return res.status(409).json({
        success: false,
        code: "CANCEL_NOT_ALLOWED",
        message: "This request can no longer be cancelled because a donation has already been completed.",
      });
    }

    // ---- committed: notify + realtime (best-effort, never fails the cancel) ----
    const affected = outcome.affected;
    const donors = await Donor.find({ _id: { $in: affected.map((r) => r.donorId) } })
      .select("userId")
      .lean();
    const userByDonor = new Map(donors.map((d) => [String(d._id), d.userId ? String(d.userId) : null]));

    const donorIds = [];
    const requestIds = [];
    await Promise.allSettled(
      affected.map(async (r) => {
        const donorId = String(r.donorId);
        const donorUserId = userByDonor.get(donorId);
        donorIds.push(donorId);
        requestIds.push(String(r._id));
        if (!donorUserId) return;

        // Same event the donor screens already listen to for status changes,
        // so Home, Requests and the pending list all update with no reload.
        emitToUser(donorUserId, "blood_request_status_updated", {
          requestId: String(r._id),
          requestStatus: CANCELLED_BY_SEEKER,
          status: CANCELLED_BY_SEEKER,
          previousStatus: r.status,
          donorId,
          seekerId: String(seekerId),
          broadcastId: String(broadcastId),
        });

        await createNotification({
          userId: donorUserId,
          title: "Blood Request Cancelled",
          category: "status",
          message:
            r.status === "accepted"
              ? "The seeker cancelled this emergency request, so it is no longer active."
              : "The seeker cancelled this emergency blood request.",
          link: "/(tabs)/requests",
        });
      })
    );

    // One event to the seeker's own devices; the app updates its shared
    // state once from this and every dependent screen re-renders from it.
    emitToUser(String(seekerId), "broadcast_cancelled", {
      broadcastId: String(broadcastId),
      status: CANCELLED_BY_SEEKER,
      cancelledAt: now,
      donorIds,
      requestIds,
    });

    res.status(200).json({
      success: true,
      message: "Broadcast cancelled for all donors.",
      broadcastId: String(broadcastId),
      status: CANCELLED_BY_SEEKER,
      cancelledCount: requestIds.length,
      donorIds,
      requestIds,
    });
  } catch (error) {
    console.error("Cancel Broadcast Error:", error);
    res.status(500).json({ success: false, message: "Failed to cancel broadcast", error: error.message });
  }
};

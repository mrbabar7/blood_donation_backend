const { DonationRequest } = require("../../models/formModel");
const Broadcast = require("../../models/broadcastModel");
const { createNotification } = require("../notificationController");
const { writeAuditLog } = require("./auditLogController");

// GET /admin/requests?status=live|critical|fulfilled_today|expired
exports.listRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));

    const filter = {};
    if (status === "live") filter.status = { $in: ["pending", "accepted"] };
    if (status === "fulfilled_today") {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      filter.status = "completed";
      filter.completedAt = { $gte: startOfDay };
    }
    // Note: "expired" requests are auto-deleted by MongoDB's TTL index on expireAt
    // (see models/formModel.js) once past due — so this filter only ever catches
    // ones in the brief window before the TTL sweep runs, not a full history. If
    // you want a real historical "Expired" archive, that needs an expiry hook that
    // copies the doc somewhere before Mongo deletes it — flagging honestly rather
    // than pretending this tab shows more than it can.
    if (status === "expired") filter.expireAt = { $lt: new Date() };

    const [requests, total] = await Promise.all([
      DonationRequest.find(filter)
        .populate("donorId", "fullName bloodType")
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      DonationRequest.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      requests,
      pagination: { currentPage: pageNum, totalPages: Math.ceil(total / limitNum) || 1, total },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /admin/requests/:id — hero + matched donors + timeline. If this request was
// part of a broadcast, pulls in every sibling request from the same broadcast so
// the admin sees the full fan-out, not just this one donor's response.
exports.getRequestDetail = async (req, res) => {
  try {
    const request = await DonationRequest.findById(req.params.id).populate("donorId", "fullName bloodType district").lean();
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });

    let siblings = [request];
    let broadcast = null;
    if (request.broadcastId) {
      broadcast = await Broadcast.findById(request.broadcastId).lean();
      siblings = await DonationRequest.find({ broadcastId: request.broadcastId })
        .populate("donorId", "fullName bloodType district")
        .lean();
    }

    const timeline = [
      { text: `Request posted by ${request.seekerName}`, at: request.createdAt },
      ...(broadcast ? [{ text: `Broadcast sent to ${broadcast.donorsNotified} nearby donor(s)`, at: broadcast.createdAt }] : []),
      ...siblings
        .filter((s) => s.status !== "pending")
        .map((s) => ({ text: `${s.donorId?.fullName || "A donor"} ${s.status} the request`, at: s.updatedAt })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    res.status(200).json({ success: true, request, broadcast, matchedDonors: siblings, timeline });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/requests/:id/rebroadcast — re-notifies every donor who hasn't
// responded yet on this request's broadcast (or just this donor, for a direct request).
exports.rebroadcastRequest = async (req, res) => {
  try {
    const request = await DonationRequest.findById(req.params.id).populate("donorId");
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });

    const targets = request.broadcastId
      ? await DonationRequest.find({ broadcastId: request.broadcastId, status: "pending" }).populate("donorId")
      : [request];

    await Promise.all(
      targets.map((r) =>
        r.donorId?.userId
          ? createNotification({
              userId: r.donorId.userId,
              title: "🚨 Reminder: urgent blood needed",
              message: `${request.requestedBloodType} still needed for ${request.seekerName}.`,
              link: "/(tabs)/home",
            })
          : Promise.resolve()
      )
    );

    await writeAuditLog({
      actorId: req.admin._id,
      actorName: req.admin.name,
      action: `Re-broadcast request #${request._id.toString().slice(-6).toUpperCase()} to ${targets.length} donor(s)`,
      category: "requests",
    });

    res.status(200).json({ success: true, message: `Re-broadcast to ${targets.length} donor(s).` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

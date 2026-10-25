const { DonationRequest } = require("../../models/formModel");
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

// GET /admin/requests/:id — hero + donor + timeline of the request's lifecycle.
exports.getRequestDetail = async (req, res) => {
  try {
    const request = await DonationRequest.findById(req.params.id).populate("donorId", "fullName bloodType district").lean();
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });

    const donorName = request.donorId?.fullName || "The donor";
    const at = (d) => (d ? [d] : []);
    const timeline = [
      { text: `Request sent by ${request.seekerName}`, at: request.requestedAt || request.createdAt },
      ...at(request.lockedAt).map((d) => ({ text: `Seeker locked ${donorName}`, at: d })),
      ...at(request.donationStartedAt).map((d) => ({ text: `${donorName} started the donation`, at: d })),
      ...at(request.seekerAgreedAt).map((d) => ({ text: "Seeker agreed to the donation", at: d })),
      ...at(request.donorMarkedDonatedAt).map((d) => ({ text: `${donorName} marked the donation as given`, at: d })),
      ...at(request.reportedAt).map((d) => ({ text: "Seeker reported the donor for a delay", at: d })),
      ...at(request.expiredAt).map((d) => ({ text: "Request expired after 12 hours", at: d })),
      ...at(request.completedAt).map((d) => ({ text: "Donation completed", at: d })),
      ...(["accepted", "rejected", "released", "auto_released", "donor_unable"].includes(request.status) && !request.completedAt
        ? [{ text: `Request is ${request.status}`, at: request.updatedAt }]
        : []),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    res.status(200).json({ success: true, request, matchedDonors: [request], timeline });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/requests/:id/rebroadcast — sends the donor a reminder about this request.
exports.rebroadcastRequest = async (req, res) => {
  try {
    const request = await DonationRequest.findById(req.params.id).populate("donorId");
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });

    const targets = request.status === "pending" ? [request] : [];

    await Promise.all(
      targets.map((r) =>
        r.donorId?.userId
          ? createNotification({
              userId: r.donorId.userId,
              title: "🚨 Reminder: urgent blood needed",
              message: `${request.requestedBloodType} still needed for ${request.seekerName}.`,
              link: "/(tabs)/home",
              type: "request_reminder",
              role: "donor",
              requestType: "direct",
              requestId: r._id,
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

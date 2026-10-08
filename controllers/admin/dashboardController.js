const { Donor, DonationRequest } = require("../../models/formModel");
const DonationLog = require("../../models/donationLogModel");
const Broadcast = require("../../models/broadcastModel");
const Hospital = require("../../models/hospitalModel");
const BloodBank = require("../../models/bankModel");
const Ambulance = require("../../models/ambulanceModel");
const NGO = require("../../models/ngoModel");
const PlatformSettings = require("../../models/platformSettingsModel");

// GET /admin/dashboard — every number here is a real query against your actual
// collections, not simulated telemetry. One honest approximation, flagged inline:
// "avg response time" uses updatedAt as a proxy for "when accepted" since the
// DonationRequest schema doesn't log a dedicated acceptedAt timestamp yet.
exports.getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const settings = await PlatformSettings.findOne().select("criticalRequestAlertMinutes");
    const alertThresholdMs = (settings?.criticalRequestAlertMinutes ?? 15) * 60 * 1000;
    const alertCutoff = new Date(now.getTime() - alertThresholdMs);

    const [
      verifiedDonors,
      activeRequests,
      criticalUnmatched,
      fulfilledThisMonth,
      pendingVerification,
    ] = await Promise.all([
      Donor.countDocuments(),
      DonationRequest.countDocuments({ status: { $in: ["pending", "accepted"] } }),
      // Was `countDocuments({status:"pending"})` — every pending request,
      // "critical" in name only, ignoring urgency entirely and ignoring the
      // Settings page's "notification threshold" (which nothing checked).
      // This is a real Broadcast-level query now: critical-urgency, still
      // active, and past the admin's own configured alert window.
      Broadcast.countDocuments({ urgency: "critical", status: "active", createdAt: { $lt: alertCutoff } }),
      DonationLog.countDocuments({ date: { $gte: startOfMonth } }),
      Promise.all([
        Hospital.countDocuments({ isVerified: false }),
        BloodBank.countDocuments({ isVerified: false }),
        Ambulance.countDocuments({ isVerified: false }),
        NGO.countDocuments({ isVerified: false }),
      ]).then((counts) => counts.reduce((a, b) => a + b, 0)),
    ]);

    // Avg response time: mean(updatedAt - createdAt) for requests that left "pending".
    const respondedRequests = await DonationRequest.find({
      status: { $in: ["accepted", "rejected", "completed"] },
      createdAt: { $gte: sevenDaysAgo },
    }).select("createdAt updatedAt").lean();

    let avgResponseSeconds = null;
    if (respondedRequests.length > 0) {
      const totalMs = respondedRequests.reduce((sum, r) => sum + (new Date(r.updatedAt) - new Date(r.createdAt)), 0);
      avgResponseSeconds = Math.round(totalMs / respondedRequests.length / 1000);
    }

    // 7-day donations chart (by day, from the real DonationLog)
    const dailyLogs = await DonationLog.aggregate([
      { $match: { date: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    // Request outcomes this month (fulfilled/pending/rejected split)
    const monthRequests = await DonationRequest.find({ createdAt: { $gte: startOfMonth } }).select("status").lean();
    const outcomeCounts = { completed: 0, pending: 0, accepted: 0, rejected: 0 };
    monthRequests.forEach((r) => { outcomeCounts[r.status] = (outcomeCounts[r.status] || 0) + 1; });
    const totalMonthRequests = monthRequests.length || 1;

    // Recent activity feed — merged from a few real collections, newest first.
    const [recentCompleted, recentDonors, recentBroadcasts] = await Promise.all([
      DonationRequest.find({ status: "completed" }).sort({ completedAt: -1 }).limit(5).select("requestedBloodType completedAt seekerName").lean(),
      Donor.find().sort({ createdAt: -1 }).limit(5).select("fullName createdAt").lean(),
      Broadcast.find().sort({ createdAt: -1 }).limit(5).select("seekerLocation requestedBloodType createdAt").lean(),
    ]);

    const activity = [
      ...recentCompleted.map((r) => ({
        text: `${r.requestedBloodType} request fulfilled for ${r.seekerName}`,
        at: r.completedAt,
      })),
      ...recentDonors.map((d) => ({ text: `${d.fullName} registered as a donor`, at: d.createdAt })),
      ...recentBroadcasts.map((b) => ({ text: `Broadcast sent: ${b.requestedBloodType} needed in ${b.seekerLocation?.city || "an unspecified city"}`, at: b.createdAt })),
    ]
      .filter((a) => a.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 8);

    res.status(200).json({
      success: true,
      kpis: {
        verifiedDonors,
        activeRequests,
        criticalUnmatched,
        fulfilledThisMonth,
        avgResponseSeconds,
        pendingVerification,
      },
      donationsChart: dailyLogs.map((d) => ({ date: d._id, count: d.count })),
      requestOutcomes: {
        completed: Math.round((outcomeCounts.completed / totalMonthRequests) * 100),
        pending: Math.round(((outcomeCounts.pending + outcomeCounts.accepted) / totalMonthRequests) * 100),
        rejected: Math.round((outcomeCounts.rejected / totalMonthRequests) * 100),
      },
      activity,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

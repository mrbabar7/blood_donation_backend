const { DonationRequest } = require("../../models/formModel");
const { Donor } = require("../../models/formModel");
const DonationLog = require("../../models/donationLogModel");

// GET /admin/analytics — real aggregations only. No "supply vs demand heatmap"
// (that needs real geo-coordinates per request, which most requests don't have
// since city/province are free text) — replaced with a real per-city breakdown
// table instead of a fabricated heatmap.
exports.getAnalytics = async (req, res) => {
  try {
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);

    const [totalDonationsYTD, newDonorsYTD, donorCount] = await Promise.all([
      DonationLog.countDocuments({ date: { $gte: yearStart } }),
      Donor.countDocuments({ createdAt: { $gte: yearStart } }),
      Donor.countDocuments(),
    ]);

    const monthly = await DonationLog.aggregate([
      { $match: { date: { $gte: twelveMonthsAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const demandByCity = await DonationRequest.aggregate([
      { $group: { _id: "$seekerLocation.city", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);
    const totalRequests = demandByCity.reduce((s, c) => s + c.count, 0) || 1;

    const bloodGroupBreakdown = await DonationRequest.aggregate([
      { $group: { _id: "$requestedBloodType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const totalByGroup = bloodGroupBreakdown.reduce((s, g) => s + g.count, 0) || 1;

    res.status(200).json({
      success: true,
      totalDonationsYTD,
      newDonorsYTD,
      donorCount,
      monthlyDonations: monthly.map((m) => ({ month: m._id, count: m.count })),
      demandByCity: demandByCity.map((c) => ({ city: c._id || "Unknown", pct: Math.round((c.count / totalRequests) * 100) })),
      bloodGroupBreakdown: bloodGroupBreakdown.map((g) => ({ group: g._id, pct: Math.round((g.count / totalByGroup) * 100) })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

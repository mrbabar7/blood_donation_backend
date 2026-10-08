const { Donor } = require("../../models/formModel");
const DonationLog = require("../../models/donationLogModel");

// GET /donors/leaderboard?city=&limit=&period=month|all
// Powers both PDF screen 33 (Community Leaderboard) and screen 37 (Our Heroes).
// period=month is a REAL monthly ranking (grouped from DonationLog, written on every
// completed donation) — falls back to all-time livesSaved only when explicitly asked
// for period=all, or for donors/cities with no logged donations yet.
exports.getLeaderboard = async (req, res) => {
  try {
    const { city, limit, period = "month" } = req.query;
    const limitNum = Number(limit) || 20;
    const filter = {};
    if (city) filter.district = new RegExp(`^${city}$`, "i");

    if (period === "month") {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const donorFilter = city ? await Donor.find(filter).select("_id") : null;
      const donorIdFilter = donorFilter ? donorFilter.map((d) => d._id) : null;

      const matchStage = { date: { $gte: startOfMonth } };
      if (donorIdFilter) matchStage.donorId = { $in: donorIdFilter };

      const grouped = await DonationLog.aggregate([
        { $match: matchStage },
        { $group: { _id: "$donorId", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limitNum },
      ]);

      if (grouped.length > 0) {
        const donors = await Donor.find({ _id: { $in: grouped.map((g) => g._id) } })
          .select("fullName bloodType district rating")
          .lean();
        const donorMap = new Map(donors.map((d) => [d._id.toString(), d]));

        const leaderboard = grouped
          .map((g) => {
            const d = donorMap.get(g._id.toString());
            if (!d) return null;
            return { ...d, livesSaved: g.count };
          })
          .filter(Boolean);

        let myRank = null;
        if (req.user) {
          const myDonor = await Donor.findOne({ userId: req.user._id || req.user.id });
          if (myDonor) {
            const myCount = await DonationLog.countDocuments({ donorId: myDonor._id, date: { $gte: startOfMonth } });
            const higherCount = grouped.filter((g) => g.count > myCount).length;
            myRank = { rank: higherCount + 1, fullName: myDonor.fullName, livesSaved: myCount };
          }
        }

        return res.status(200).json({ success: true, leaderboard, myRank, period: "month" });
      }
      // No donations logged this month anywhere matching the filter — fall through
      // to the all-time ranking below rather than showing an empty board.
    }

    const leaderboard = await Donor.find(filter)
      .sort({ livesSaved: -1, totalRatings: -1 })
      .limit(limitNum)
      .select("fullName bloodType district livesSaved rating");

    let myRank = null;
    if (req.user) {
      const myDonor = await Donor.findOne({ userId: req.user._id || req.user.id });
      if (myDonor) {
        const higherCount = await Donor.countDocuments({
          ...filter,
          livesSaved: { $gt: myDonor.livesSaved },
        });
        myRank = { rank: higherCount + 1, fullName: myDonor.fullName, livesSaved: myDonor.livesSaved };
      }
    }

    res.status(200).json({ success: true, leaderboard, myRank, period: "all" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const { Donor, DonationRequest } = require("./../models/formModel");
const Hospital = require("../models/hospitalModel");
const BloodBank = require("../models/bankModel");
const Ambulance = require("../models/ambulanceModel");
const NGO = require("../models/ngoModel");
const DonationLog = require("../models/donationLogModel");

// GET /stats — public, real counts for the guest home hero + About Us (PDF screens
// 30 & 38 both show numeric stats — this replaces what would otherwise be fabricated).
// This public endpoint runs ~10 collection-wide counts/aggregations/distincts
// and is hit by every guest-home / About screen load. The numbers are headline
// totals that don't need to be second-accurate, so one computed result is
// shared for a short window instead of recomputed per request.
const STATS_CACHE_MS = Number(process.env.STATS_CACHE_MS) || 60 * 1000;
let statsCache = { at: 0, payload: null };

exports.getPlatformStats = async (req, res) => {
  try {
    if (statsCache.payload && Date.now() - statsCache.at < STATS_CACHE_MS) {
      return res.status(200).json(statsCache.payload);
    }
    const [totalDonors, completedRequests, hospitals, banks, ambulances, ngos, avgMatchAgg] = await Promise.all([
      Donor.countDocuments(),
      DonationRequest.countDocuments({ status: "completed" }),
      Hospital.countDocuments(),
      BloodBank.countDocuments(),
      Ambulance.countDocuments(),
      NGO.countDocuments(),
      // Average time from a request being created to being marked completed,
      // in minutes — powers the guest home's "Avg. match time" stat. Only
      // considers completed requests that actually have both timestamps.
      DonationRequest.aggregate([
        { $match: { status: "completed", completedAt: { $ne: null } } },
        {
          $project: {
            matchMinutes: {
              $divide: [{ $subtract: ["$completedAt", "$createdAt"] }, 1000 * 60],
            },
          },
        },
        { $group: { _id: null, avgMinutes: { $avg: "$matchMinutes" } } },
      ]),
    ]);

    // "This month in Pakistan" (Heroes wall): real counts for the current
    // calendar month. An emergency is a completed request that came from an
    // emergency broadcast or carried an urgency level.
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const [monthDonations, monthEmergencies, monthDonorIds] = await Promise.all([
      DonationLog.countDocuments({ date: { $gte: startOfMonth } }),
      DonationRequest.countDocuments({
        status: "completed",
        completedAt: { $gte: startOfMonth },
        $or: [{ broadcastId: { $ne: null } }, { urgency: { $ne: null } }],
      }),
      DonationLog.distinct("donorId", { date: { $gte: startOfMonth } }),
    ]);
    const monthDonors = monthDonorIds.length
      ? await Donor.find({ _id: { $in: monthDonorIds } }).select("district").lean()
      : [];
    const monthCities = new Set(
      monthDonors.map((d) => String(d.district || "").trim().toLowerCase()).filter(Boolean)
    ).size;

    // Distinct districts that have at least one registered donor ("Cities covered" on About us).
    const districts = await Donor.distinct("district");
    const citiesCovered = new Set(
      districts.map((d) => String(d || "").trim().toLowerCase()).filter(Boolean)
    ).size;

    const avgMatchMinutes = avgMatchAgg.length > 0 ? Math.max(1, Math.round(avgMatchAgg[0].avgMinutes)) : 0;

    const payload = {
      success: true,
      totalDonors,
      livesSupported: completedRequests,
      partnerFacilities: hospitals + banks + ambulances + ngos,
      avgMatchMinutes,
      citiesCovered,
      month: {
        donations: monthDonations,
        emergenciesMet: monthEmergencies,
        cities: monthCities,
      },
    };

    statsCache = { at: Date.now(), payload };
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const mongoose = require("mongoose");
const { ACCEPTED_FAMILY } = require("../../services/donationLifecycle/constants");
const { Donor, DonationRequest } = require("../../models/formModel");
const DonationLog = require("../../models/donationLogModel");
const AvailabilitySubscription = require("../../models/availabilitySubscriptionModel");
const { getRecoveryDays } = require("../../config/recoveryPolicy");
const { buildAvailability, reachedMilestones } = require("../../utils/donorAvailability");
const { reconcileDonorAvailability } = require("../../services/donorAvailabilityService");
const { haversineKm, validCoord } = require("../../utils/geo");
const { distanceBand } = require("../../utils/nearbyDonors");

const RECENT_REVIEWS = 5;
const TIMELINE_LIMIT = 10;

// GET /seeker/details/:donorId[?userLat=&userLng=]
//
// Seeker-facing donor profile. Everything below comes from real records; where
// the platform has no data (points, levels, review text) nothing is invented
// and the field is simply absent / empty so the app can show an honest empty
// state. Recipients are anonymised to a city ("A seeker in Lahore") and no
// seeker name, phone, address or id is ever returned.
exports.getDonorDetailsForSeeker = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    if (!mongoose.Types.ObjectId.isValid(req.params.donorId)) {
      return res.status(404).json({ success: false, message: "Donor not found" });
    }
    const donor = await Donor.findById(req.params.donorId).populate(
      "userId",
      "isOnline lastSeen email profilePicture",
    );

    if (!donor) {
      return res
        .status(404)
        .json({ success: false, message: "Donor not found" });
    }

    // Safe on-read update: if the recovery window has ended, make the stored
    // state truthful right now (and notify subscribers) instead of waiting for
    // the scheduled job.
    await reconcileDonorAvailability(donor);

    const now = new Date();
    const donorId = donor._id;

    let activeRequest = await DonationRequest.findOne({
      seekerId,
      donorId,
    }).sort({ createdAt: -1 });
    // Legacy cancelled request -> profile shows the normal "Notify" state.
    if (activeRequest && activeRequest.status === "cancelled_by_seeker") activeRequest = null;

    const completedFilter = { donorId, status: "completed" };
    const [donationCount, recentLogs, ratingRows, recentRatings, subscription, higherInCity] = await Promise.all([
      DonationLog.countDocuments({ donorId }),
      DonationLog.find({ donorId }).sort({ date: -1 }).limit(TIMELINE_LIMIT).select("date requestId").lean(),
      DonationRequest.aggregate([
        { $match: { ...completedFilter, isRated: true, rating: { $gte: 1 } } },
        { $group: { _id: "$rating", count: { $sum: 1 } } },
      ]),
      DonationRequest.find({ ...completedFilter, isRated: true, rating: { $gte: 1 } })
        .sort({ completedAt: -1 })
        .limit(RECENT_REVIEWS)
        .select("rating completedAt seekerLocation.city")
        .lean(),
      AvailabilitySubscription.exists({ seekerId, donorId, notifiedAt: null }),
      donor.livesSaved > 0
        ? Donor.countDocuments({ district: donor.district, isSuspended: { $ne: true }, livesSaved: { $gt: donor.livesSaved } })
        : Promise.resolve(null),
    ]);

    // Timeline: city of the (anonymous) recipient, looked up per logged request.
    const logRequestIds = recentLogs.map((l) => l.requestId).filter(Boolean);
    const logRequests = logRequestIds.length
      ? await DonationRequest.find({ _id: { $in: logRequestIds } }).select("seekerLocation.city").lean()
      : [];
    const cityByRequest = new Map(logRequests.map((r) => [String(r._id), r.seekerLocation?.city || null]));
    const timeline = recentLogs.map((l) => ({
      date: l.date,
      recipientCity: cityByRequest.get(String(l.requestId)) || null,
    }));

    const totalDonations = Math.max(donationCount, donor.livesSaved || 0);

    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratingRows.forEach((r) => {
      if (breakdown[r._id] !== undefined) breakdown[r._id] = r.count;
    });

    // Distance (only when the seeker's position is known and the donor has a
    // saved position). Honours the donor's "show exact distance" privacy
    // switch: when off, only a band is returned.
    const userLat = parseFloat(req.query.userLat);
    const userLng = parseFloat(req.query.userLng);
    let distanceKm = null;
    let distanceBandLabel = null;
    const loc = donor.location;
    if (validCoord(userLat, userLng) && loc && validCoord(loc.latitude, loc.longitude)) {
      const km = Math.round(haversineKm(userLat, userLng, loc.latitude, loc.longitude) * 10) / 10;
      if (donor.showExactDistance === false) distanceBandLabel = distanceBand(km);
      else distanceKm = km;
    }

    const availability = buildAvailability(donor, { now, fallbackIntervalDays: getRecoveryDays() });
    availability.isSubscribed = !!subscription;

    // Explicit allow-list (the previous version spread the whole donor
    // document, which also exposed admin flags, exact GPS and the donor code).
    const donorData = {
      _id: donor._id,
      fullName: donor.fullName,
      bloodType: donor.bloodType,
      province: donor.province,
      district: donor.district,
      profilePicture: donor.userId?.profilePicture || donor.profilePicture || "",
      isOnline: donor.userId ? donor.userId.isOnline : false,
      lastSeen: donor.userId ? donor.userId.lastSeen : null,
      // Effective availability: never "available" while a rest window is open.
      isAvailable: availability.isResting ? false : !!donor.isAvailable,
      livesSaved: donor.livesSaved || 0,
      rating: donor.rating || 0,
      totalRatings: donor.totalRatings || 0,
      lastDonationDate: availability.lastDonationDate,
      nextAvailableDate: availability.nextAvailableDate,
      memberSince: donor.createdAt || null,
      requestStatus: activeRequest ? activeRequest.status : null,
      requestId: activeRequest ? String(activeRequest._id) : null,
      mobileNumber:
        activeRequest && ACCEPTED_FAMILY.includes(activeRequest.status)
          ? donor.mobileNumber
          : null,

      availability,
      distanceKm,
      distanceBand: distanceBandLabel,
      // The platform has no points/level system, so none is returned. The
      // "verified" flag is real: the donor's card has been scanned by a partner.
      verification: { verified: !!donor.cardVerifiedAt, verifiedAt: donor.cardVerifiedAt || null },
      stats: {
        totalDonations,
        rank: higherInCity == null ? null : { scope: "city", city: donor.district, position: higherInCity + 1 },
      },
      reviews: {
        average: donor.totalRatings > 0 ? donor.rating || 0 : null,
        count: donor.totalRatings || 0,
        breakdown,
        // Ratings only: reviewers leave a star rating, not text, and are
        // shown solely as the city they were in.
        recent: recentRatings.map((r) => ({
          rating: r.rating,
          date: r.completedAt || null,
          reviewerCity: r.seekerLocation?.city || null,
        })),
      },
      achievements: reachedMilestones(totalDonations),
      timeline,
    };

    res.status(200).json({ success: true, donor: donorData });
  } catch (error) {
    console.error("Get Donor Details Error:", error);
    res.status(500).json({ success: false, message: "Error fetching profile" });
  }
};

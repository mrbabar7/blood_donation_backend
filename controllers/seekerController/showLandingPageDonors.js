const { Donor, DonationRequest } = require("../../models/formModel");

exports.showLandingPageDonors = async (req, res) => {
  try {
    const currentUserId = req.user ? req.user.id || req.user._id : null;
    const { bloodType, district, province } = req.query;

    const today = new Date();

    let query = {
      $or: [{ nextAvailableDate: { $gt: today } }, { isAvailable: true }],
      isSuspended: { $ne: true },
      appearsInPublicSearch: { $ne: false },
    };

    if (currentUserId) {
      query.userId = { $ne: currentUserId };
    }
    if (bloodType) {
      query.bloodType = bloodType;
    }
    if (province) {
      query.province = province;
    }
    if (district) {
      query.district = { $regex: `^${district.trim()}$`, $options: "i" };
    }

    // Safety cap: this used to return EVERY matching donor, which is fine for
    // a few hundred but turns into a huge, slow response (and memory spike)
    // once the donor base grows. Adjustable via HERO_SEARCH_MAX.
    const HERO_MAX = Number(process.env.HERO_SEARCH_MAX) || 1000;
    const donors = await Donor.find(query).limit(HERO_MAX);

    // One query for this seeker's requests to ALL of these donors (newest
    // first, so the first hit per donor is their latest) instead of one
    // findOne per donor — that loop was N database round trips per request.
    const latestRequestByDonor = new Map();
    if (currentUserId && donors.length > 0) {
      const myRequests = await DonationRequest.find({
        seekerId: currentUserId,
        donorId: { $in: donors.map((d) => d._id) },
      })
        .sort({ createdAt: -1 })
        .select("status donorId")
        .lean();
      for (const r of myRequests) {
        const key = String(r.donorId);
        if (!latestRequestByDonor.has(key)) latestRequestByDonor.set(key, r);
      }
    }

    const donorsWithStatus = await Promise.all(
      donors.map(async (donor) => {
        let request = null;
        if (currentUserId) {
          request = latestRequestByDonor.get(String(donor._id)) || null;
          // Cancelled broadcast request -> back to the normal "Notify" state.
          if (request && request.status === "cancelled_by_seeker") request = null;
        }

        let daysRemaining = 0;
        if (donor.nextAvailableDate) {
          const nextDate = new Date(donor.nextAvailableDate);
          if (nextDate > today) {
            const diffTime = nextDate - today;
            daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          }
        }

        return {
          ...donor.toObject(),
          daysRemaining: daysRemaining,
          mobileNumber:
            request && request.status === "accepted"
              ? donor.mobileNumber
              : null,
          requestStatus: request ? request.status : null,
          requestId: request ? request._id : null,
        };
      }),
    );

    res.status(200).json(donorsWithStatus);
  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json([]);
  }
};

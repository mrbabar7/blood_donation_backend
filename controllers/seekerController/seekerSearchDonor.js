const mongoose = require("mongoose");
const { ACCEPTED_FAMILY } = require("../../services/donationLifecycle/constants");
const { Donor, DonationRequest } = require("../../models/formModel");
const { voluntaryFirstStages, donorTypeFields } = require("../../utils/nearbyDonors");
const { blockedEitherWay } = require("../../utils/blocks");
const { donorVisibleTo } = require("../../utils/donorMatching");

// Verbose search logging is development-only (it prints the raw query, which
// contains user and blocked-user ids).
const DEBUG_SEARCH = process.env.NODE_ENV !== "production";

const toObjId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));

// Adds the Voluntary / compensation presentation fields and removes the server-managed
// strike / fraud bookkeeping, which seekers must never receive.
function presentDonorType(donor) {
  const extra = donorTypeFields(donor);
  const {
    confirmedFraudStrikes, isBlacklisted, blacklistedAt,
    activeDonationRequestId, acceptBlockedUntil,
    ...rest
  } = donor;
  return { ...rest, ...extra };
}
const voluntaryRank = (d) => (d.donorType === "COMPENSATION" ? 1 : 0);

// Approximate distance band shown instead of exact km when a donor turned off
// "Show exact distance" (Privacy & data).
function distanceBand(km) {
  if (km == null) return null;
  if (km < 2) return "< 2 km";
  if (km < 5) return "2–5 km";
  if (km < 10) return "5–10 km";
  if (km < 20) return "10–20 km";
  return "20+ km";
}

// Applies the donor's own privacy choice to one shaped search result.
function applyDistancePrivacy(d) {
  if (d.showExactDistance === false && d.distanceKm != null) {
    return { ...d, distanceKm: null, distanceBand: distanceBand(d.distanceKm) };
  }
  return d;
}

// Haversine distance in km between two lat/lng points.
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

exports.searchDonors = async (req, res) => {
  try {
    const currentUserId = req.user.id || req.user._id;
    const {
      bloodType,
      district,
      city,
      province,
      availableOnly,
      userLat,
      userLng,
      maxDistanceKm,
      // Compensation-based donors are only returned when the seeker asks for them.
      includeCompensation,
      // Best-effort province/city resolved client-side (reverse-geocoded)
      // from the seeker's live GPS fix — used ONLY to also surface donors
      // who were registered with just a province/district and have no saved
      // GPS coordinates (see `location` on the Donor schema: optional, and
      // most donors registered before that field existed don't have it).
      // Never applied to the real distance calculation below, so it can
      // never narrow/break the precise geo search for donors who do have
      // coordinates. Ignored whenever the seeker has explicitly picked a
      // province/city filter of their own — an explicit choice always wins.
      geoProvince,
      geoDistrict,
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    const today = new Date();

    // 1. Build Clean Search Query
    // isSuspended/appearsInPublicSearch exist for the admin dashboard's Donor
    // Detail controls (DonorDetail.tsx suspend/reinstate + visibility toggle) —
    // those actions were pure UI before this: nothing here ever excluded a
    // suspended or hidden donor from actually being found and contacted.
    // Blocked users (either direction) never show up, and a donor who chose
    // "Hidden" is never listed. Donors scoped to "Nearby seekers only" are
    // handled per-branch below (they need the seeker's position).
    const blockedIds = await blockedEitherWay(currentUserId);
    const includeComp = includeCompensation === "true" || includeCompensation === "1" || includeCompensation === true;
    let query = {
      // ObjectIds (not strings) so the same filter also works inside an aggregation $match.
      userId: { $ne: toObjId(currentUserId), ...(blockedIds.length ? { $nin: blockedIds.map(toObjId) } : {}) },
      isSuspended: { $ne: true },
      isBlacklisted: { $ne: true },
      appearsInPublicSearch: { $ne: false },
      visibilityScope: { $ne: "hidden" },
    };

    // Enforced in the query: no opt-in -> no COMPENSATION donor (legacy donors = VOLUNTARY).
    if (!includeComp) query.donorType = { $ne: "COMPENSATION" };

    if (bloodType && bloodType.trim()) {
      const groups = bloodType.split(",").map((g) => g.trim()).filter(Boolean);
      query.bloodType = groups.length > 1 ? { $in: groups } : groups[0];
    }

    const cityOrDistrict = (district || city || "").trim();
    if (cityOrDistrict) {
      // Escape special characters for safer regex matching
      const safeCity = cityOrDistrict.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { district: new RegExp(`^${safeCity}$`, "i") },
        { city: new RegExp(`^${safeCity}$`, "i") },
      ];
    }

    if (province && province.trim()) {
      const safeProvince = province
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.province = new RegExp(`^${safeProvince}$`, "i");
    }

    if (availableOnly === "true") {
      query.isAvailable = true;
    }

    // Shared per-donor shaping (request status, live availability window,
    // online/mobile-number gating) used for every donor returned below,
    // whether matched by real distance or by the no-coordinates area
    // fallback — kept in one place so both paths stay identical.
    const shapeDonor = (donor, requestMap, distanceKmValue) => {
      const request = requestMap.get(donor._id.toString()) || null;
      let finalAvailability = donor.isAvailable;
      let daysRemaining = 0;
      if (donor.nextAvailableDate) {
        const nextDate = new Date(donor.nextAvailableDate);
        if (nextDate > today) {
          finalAvailability = false;
          daysRemaining = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
        }
      }
      return {
        ...presentDonorType(donor),
        // Canonical photo lives on the linked User (Donor.profilePicture is a
        // legacy field that is never written to).
        profilePicture: donor.userId?.profilePicture || donor.profilePicture || "",
        isOnline: donor.userId ? donor.userId.isOnline : false,
        lastSeen: donor.userId ? donor.userId.lastSeen : null,
        isAvailable: finalAvailability,
        daysRemaining,
        requestStatus: request ? request.status : null,
        requestId: request ? request._id : null,
        mobileNumber: request && ACCEPTED_FAMILY.includes(request.status) ? donor.mobileNumber : null,
        distanceKm: distanceKmValue,
      };
    };

    const buildRequestMap = async (donorIds) => {
      const existingRequests = await DonationRequest.find({
        seekerId: currentUserId,
        donorId: { $in: donorIds },
      })
        .sort({ createdAt: -1 })
        .lean();
      const requestMap = new Map();
      const seenDonors = new Set();
      existingRequests.forEach((r) => {
        const key = r.donorId.toString();
        if (seenDonors.has(key)) return;
        seenDonors.add(key);
        // A legacy cancelled request must not show as a live
        // request on the donor card — it reverts to the normal "Notify" state.
        if (r.status !== "cancelled_by_seeker") requestMap.set(key, r);
      });
      return requestMap;
    };

    // Real distance search/sort (PDF screen 26's slider) — only kicks in when the
    // seeker's own device GPS is supplied. Requires distance-based pagination to
    // happen in memory (can't skip/limit at the DB level and still sort globally
    // by distance), so this branch fetches a capped candidate set instead of a
    // single DB page.
    const hasGeoSearch = userLat !== undefined && userLng !== undefined;

    if (hasGeoSearch) {
      const lat = parseFloat(userLat);
      const lng = parseFloat(userLng);
      const maxKm = maxDistanceKm ? parseFloat(maxDistanceKm) : null;

      const geoQuery = {
        ...query,
        "location.latitude": { $ne: null },
        "location.longitude": { $ne: null },
      };

      const candidates = await Donor.find(geoQuery)
        .populate("userId", "isOnline lastSeen profilePicture")
        .limit(500)
        .lean();

      const requestMap = await buildRequestMap(candidates.map((d) => d._id));

      const seekerPos = { lat, lng, city: cityOrDistrict || (geoDistrict || "").trim() };
      let withDistance = candidates.filter((donor) => donorVisibleTo(donor, seekerPos)).map((donor) =>
        shapeDonor(
          donor,
          requestMap,
          Math.round(distanceKm(lat, lng, donor.location.latitude, donor.location.longitude) * 10) / 10
        )
      );

      if (maxKm) withDistance = withDistance.filter((d) => d.distanceKm <= maxKm);
      // Voluntary donors first, nearest first inside each group.
      withDistance.sort((a, b) => voluntaryRank(a) - voluntaryRank(b) || a.distanceKm - b.distanceKm);

      // Donors saved with only a province/district (no GPS — true for most
      // donors registered before live-location existed) can never match the
      // geoQuery above. If the seeker didn't already pick an explicit
      // province/city, use the reverse-geocoded one from their live fix so
      // those donors still show up instead of being silently invisible to
      // "search by my location" — just without a known distance.
      const areaProvince = !province || !province.trim() ? (geoProvince || "").trim() : "";
      const areaDistrict = !cityOrDistrict ? (geoDistrict || "").trim() : "";

      let areaFallback = [];
      if (areaProvince || areaDistrict) {
        const areaConds = [query, { "location.latitude": null }];
        if (areaDistrict) {
          const safeArea = areaDistrict.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          areaConds.push({
            $or: [
              { district: new RegExp(`^${safeArea}$`, "i") },
              { city: new RegExp(`^${safeArea}$`, "i") },
            ],
          });
        }
        if (areaProvince) {
          const safeAreaProvince = areaProvince.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          areaConds.push({ province: new RegExp(`^${safeAreaProvince}$`, "i") });
        }

        const areaCandidates = await Donor.find({ $and: areaConds })
          .populate("userId", "isOnline lastSeen profilePicture")
          .limit(200)
          .lean();

        const areaRequestMap = await buildRequestMap(areaCandidates.map((d) => d._id));
        areaFallback = areaCandidates
          .filter((donor) => donorVisibleTo(donor, seekerPos))
          .map((donor) => shapeDonor(donor, areaRequestMap, null));
      }

      // Precise distance matches first (closest first); same-area donors
      // with no known distance appended after, online/available ones first
      // among themselves — mirrors the plain search's own sort below.
      areaFallback.sort((a, b) => {
        if (voluntaryRank(a) !== voluntaryRank(b)) return voluntaryRank(a) - voluntaryRank(b);
        if (a.isOnline === b.isOnline) return b.isAvailable - a.isAvailable;
        return b.isOnline - a.isOnline;
      });

      const merged = [...withDistance, ...areaFallback];
      const totalDonors = merged.length;
      const paged = merged.slice(skip, skip + limitNum).map(applyDistancePrivacy);

      return res.status(200).json({
        success: true,
        donors: paged,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(totalDonors / limitNum) || 1,
          totalDonors,
          hasMore: skip + limitNum < totalDonors,
        },
      });
    }

    if (DEBUG_SEARCH) console.log("🔍 DB Search Query Raw:", query);
    if (DEBUG_SEARCH) console.log(
      `📄 Pagination: Page=${pageNum}, Limit=${limitNum}, Skip=${skip}`,
    );

    // No seeker position here, so donors who chose "Nearby seekers only"
    // can't be shown (they're only visible within 15 km of the seeker).
    query.visibilityScope = { $nin: ["hidden", "nearby"] };

    // 2. Count Total Matching Donors
    const totalDonors = await Donor.countDocuments(query);
    const totalPages = Math.ceil(totalDonors / limitNum) || 1;
    const hasMore = skip + limitNum < totalDonors; // Precise check for remaining records

    if (DEBUG_SEARCH) console.log(
      `📊 DB Match Results: Total Donors=${totalDonors}, Total Pages=${totalPages}, HasMore=${hasMore}`,
    );

    if (totalDonors === 0) {
      return res.status(200).json({
        success: true,
        donors: [],
        pagination: {
          currentPage: pageNum,
          totalPages: 1,
          totalDonors: 0,
          hasMore: false,
        },
      });
    }

    // 3. Fetch Paginated Slice
    let donors;
    if (includeComp) {
      // Voluntary donors must lead the list across ALL pages, so the order is computed in the
      // database (a per-page re-sort in Node would reshuffle donors between pages).
      donors = await Donor.aggregate([
        { $match: query },
        ...voluntaryFirstStages(),
        { $skip: skip },
        { $limit: limitNum },
      ]);
      await Donor.populate(donors, { path: "userId", select: "isOnline lastSeen profilePicture" });
    } else {
      donors = await Donor.find(query)
        .populate("userId", "isOnline lastSeen profilePicture")
        .skip(skip)
        .limit(limitNum)
        .lean();
    }

    // 4. Batch Fetch Donation Requests
    const donorIds = donors.map((d) => d._id);
    const existingRequests = await DonationRequest.find({
      seekerId: currentUserId,
      donorId: { $in: donorIds },
    })
      .sort({ createdAt: -1 })
      .lean();

    const requestMap = new Map();
    const seenDonors = new Set();
    existingRequests.forEach((reqItem) => {
      const key = reqItem.donorId.toString();
      if (seenDonors.has(key)) return;
      seenDonors.add(key);
      // Legacy cancelled requests revert the card to the normal "Notify" state.
      if (reqItem.status !== "cancelled_by_seeker") requestMap.set(key, reqItem);
    });

    // 5. Process Availability
    const donorsWithStatus = donors.map((donor) => {
      const request = requestMap.get(donor._id.toString()) || null;

      let finalAvailability = donor.isAvailable;
      let daysRemaining = 0;

      if (donor.nextAvailableDate) {
        const nextDate = new Date(donor.nextAvailableDate);
        if (nextDate > today) {
          finalAvailability = false;
          const diffTime = nextDate - today;
          daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
      }

      return {
        ...presentDonorType(donor),
        // Canonical photo lives on the linked User (Donor.profilePicture is a
        // legacy field that is never written to).
        profilePicture: donor.userId?.profilePicture || donor.profilePicture || "",
        isOnline: donor.userId ? donor.userId.isOnline : false,
        lastSeen: donor.userId ? donor.userId.lastSeen : null,
        isAvailable: finalAvailability,
        daysRemaining,
        requestStatus: request ? request.status : null,
        requestId: request ? request._id : null,
        mobileNumber:
          request && ACCEPTED_FAMILY.includes(request.status) ? donor.mobileNumber : null,
      };
    });

    // 6. Sort Online & Available Donors First
    donorsWithStatus.sort((a, b) => {
      if (voluntaryRank(a) !== voluntaryRank(b)) return voluntaryRank(a) - voluntaryRank(b);
      if (a.isOnline === b.isOnline) {
        return b.isAvailable - a.isAvailable;
      }
      return b.isOnline - a.isOnline;
    });

    res.status(200).json({
      success: true,
      donors: donorsWithStatus,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalDonors,
        hasMore,
      },
    });
  } catch (error) {
    console.error("❌ Controller Search Error:", error);
    res.status(500).json({
      success: false,
      message: "Search failed",
      error: error.message,
    });
  }
};

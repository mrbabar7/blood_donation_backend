// GET /seeker/nearby-donors
//
// Cursor-paginated donor feed for the seeker home screen ("live location"
// mode). Query params:
//   userLat, userLng   seeker position (optional - without it only the filters apply)
//   bloodType          REQUIRED: one group or a comma list ("O+,O-"); missing/empty -> empty list
//   province, district explicit area filters (win over geoProvince/geoDistrict)
//   geoProvince, geoDistrict   reverse-geocoded from the live fix, used only to
//                      also surface donors that have no saved GPS
//   availableOnly      "true" to hide resting donors
//   maxDistanceKm      radius cap (needs userLat/userLng)
//   limit              page size, default 25, max 50
//   cursor             opaque `nextCursor` from the previous page
//
// Response: { success, donors, pagination: { limit, count, hasMore, nextCursor } }
//
// Distance ordering and the radius cut-off are done by MongoDB ($geoNear on
// the 2dsphere index of Donor.geo) so a page costs O(offset + limit), not
// "load 500 candidates and sort them in Node" like the legacy /seeker/search.

const mongoose = require("mongoose");
const { Donor, DonationRequest } = require("../../models/formModel");
const { blockedEitherWay } = require("../../utils/blocks");
const { distanceKm } = require("../../utils/donorMatching");
const { effectiveAvailability } = require("../../utils/donorAvailability");
const { attachSubscriptionState, reconcileStaleInBackground } = require("../../services/donorAvailabilityService");
const {
  parseNearbyParams,
  encodeCursor,
  decodeCursor,
  geoSegmentPipeline,
  areaSegmentFilter,
  AREA_SORT,
  voluntaryFirstStages,
  shapeNearbyDonor,
} = require("../../utils/nearbyDonors");

const toId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));
const USER_FIELDS = "isOnline lastSeen profilePicture";

// Latest non-cancelled request this seeker has against each donor on the page.
async function requestMapFor(seekerId, donorIds) {
  if (!donorIds.length) return new Map();
  const rows = await DonationRequest.find({ seekerId, donorId: { $in: donorIds } })
    .sort({ createdAt: -1 })
    .select("donorId status")
    .lean();
  const map = new Map();
  const seen = new Set();
  rows.forEach((r) => {
    const key = String(r.donorId);
    if (seen.has(key)) return;
    seen.add(key);
    // A legacy cancelled request reverts the card to the normal "Notify" state.
    if (r.status !== "cancelled_by_seeker") map.set(key, r);
  });
  return map;
}

exports.getNearbyDonors = async (req, res) => {
  try {
    const parsed = parseNearbyParams(req.query);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, code: parsed.code, message: parsed.message });
    }
    const p = parsed.params;

    // A blood group is REQUIRED. Without one the feed is an empty list - never "all donors"
    // (Seeker Home shows nothing until the seeker picks a group; every other caller sends one).
    if (!p.bloodGroups.length) {
      res.set("Cache-Control", "private, no-store");
      return res.status(200).json({
        success: true,
        donors: [],
        pagination: { limit: p.limit, count: 0, hasMore: false, nextCursor: null },
      });
    }

    const position = decodeCursor(p);
    if (!position) {
      return res
        .status(400)
        .json({ success: false, code: "INVALID_CURSOR", message: "Cursor is invalid or does not match this search" });
    }

    const currentUserId = req.user.id || req.user._id;
    const blockedIds = await blockedEitherWay(currentUserId);
    const ctx = { currentUserId, blockedIds, toId };

    const rows = []; // { donor, distanceKmValue }
    let nextCursor = null;

    // ---- geo segment ------------------------------------------------------
    let geoExhausted = true;
    if (p.seeker && position.segment === "geo") {
      const docs = await Donor.aggregate(
        geoSegmentPipeline(p, ctx, { skip: position.skip, take: p.limit + 1 }),
      );
      const hasMoreGeo = docs.length > p.limit;
      docs.slice(0, p.limit).forEach((donor) => {
        const [lng, lat] = donor.geo.coordinates;
        rows.push({
          donor,
          // Same haversine + rounding the legacy endpoint returned.
          distanceKmValue: Math.round(distanceKm(p.seeker.lat, p.seeker.lng, lat, lng) * 10) / 10,
        });
      });
      if (hasMoreGeo) {
        geoExhausted = false;
        nextCursor = encodeCursor(p, "geo", position.skip + p.limit);
      }
    }

    // ---- area segment (continues the same page when geo ran out) -----------
    if (geoExhausted) {
      const filter = areaSegmentFilter(p, ctx);
      if (filter) {
        const areaSkip = position.segment === "area" ? position.skip : 0;
        const take = p.limit - rows.length;
        // take === 0 only when the geo segment filled the page exactly; fetch
        // one row purely to learn whether anything follows.
        const limitN = Math.max(take, 0) + 1;
        // With the compensation opt-in on, voluntary donors must still come first, which
        // needs a computed sort key -> aggregation. Otherwise the plain indexed find().
        const docs = p.includeCompensation
          ? await Donor.aggregate([
              { $match: filter },
              ...voluntaryFirstStages(),
              ...(areaSkip ? [{ $skip: areaSkip }] : []),
              { $limit: limitN },
            ])
          : await Donor.find(filter).sort(AREA_SORT).skip(areaSkip).limit(limitN).lean();
        docs.slice(0, Math.max(take, 0)).forEach((donor) => rows.push({ donor, distanceKmValue: null }));
        if (docs.length > Math.max(take, 0)) {
          nextCursor = encodeCursor(p, "area", areaSkip + Math.max(take, 0));
        }
      }
    }

    // ---- enrich + shape ----------------------------------------------------
    const donorDocs = rows.map((r) => r.donor);
    await Donor.populate(donorDocs, { path: "userId", select: USER_FIELDS });
    const requestMap = await requestMapFor(
      currentUserId,
      donorDocs.map((d) => d._id),
    );
    const now = new Date();
    const donors = rows.map(({ donor, distanceKmValue }) =>
      shapeNearbyDonor(donor, { request: requestMap.get(String(donor._id)) || null, now, distanceKmValue }),
    );

    // Resting cards need to know whether THIS seeker already asked to be told
    // when the donor returns (one batched query for the whole page), and donors
    // whose window ended while the scheduled job lagged get their transition
    // persisted in the background.
    await attachSubscriptionState(currentUserId, donors);
    reconcileStaleInBackground(donorDocs.filter((doc) => effectiveAvailability(doc, now).needsReconcile));

    res.set("Cache-Control", "private, no-store");
    return res.status(200).json({
      success: true,
      donors,
      pagination: { limit: p.limit, count: donors.length, hasMore: !!nextCursor, nextCursor },
    });
  } catch (error) {
    console.error("Nearby donors error:", error);
    return res.status(500).json({ success: false, message: "Search failed" });
  }
};

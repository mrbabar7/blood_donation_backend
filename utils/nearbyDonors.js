// Pure helpers behind GET /seeker/nearby-donors (controllers/seekerController/
const { ACCEPTED_FAMILY } = require("../services/donationLifecycle/constants");
// nearbyDonors.js). Nothing here touches the database, so every rule that
// decides *which* donors a page contains can be unit-tested without MongoDB
// (see tests/nearbyDonors.test.js).
//
// Result order (identical to the existing /seeker/search live-location mode):
//   1. "geo"  segment - donors that have saved GPS, nearest first
//   2. "area" segment - donors with no GPS found by province/district
//                       (reverse-geocoded from the seeker's fix), online first
// Without seeker coordinates only the "area" segment is used.

const crypto = require("crypto");
const { validCoord } = require("./geo");
const { escapeRegex, NEARBY_RADIUS_KM } = require("./donorMatching");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
// Offset cursors are O(offset) for Mongo; nobody scrolls past this many donors
// and an unbounded offset would let a client force an arbitrarily deep scan.
const MAX_OFFSET = 1000;

// MongoDB measures spherical distance with a 6378.1 km radius while the rest
// of the app (utils/donorMatching.distanceKm, what the UI shows) uses 6371 km.
// Thresholds are converted so a "15 km" / "maxDistanceKm" cut-off means the
// same thing whichever of the two computed it.
const MONGO_EARTH_RADIUS_M = 6378100;
const APP_EARTH_RADIUS_M = 6371000;
const kmToMongoMeters = (km) => (km * 1000 * MONGO_EARTH_RADIUS_M) / APP_EARTH_RADIUS_M;

const str = (v) => (typeof v === "string" ? v.trim() : "");
const bool = (v) => v === true || v === "true" || v === "1";

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------
// Returns { ok: true, params } or { ok: false, code, message }.
function parseNearbyParams(query = {}) {
  const limitRaw = parseInt(query.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(MAX_LIMIT, Math.max(1, limitRaw)) : DEFAULT_LIMIT;

  const hasLat = query.userLat !== undefined && query.userLat !== "";
  const hasLng = query.userLng !== undefined && query.userLng !== "";
  let seeker = null;
  if (hasLat || hasLng) {
    const lat = parseFloat(query.userLat);
    const lng = parseFloat(query.userLng);
    if (!validCoord(lat, lng)) {
      return { ok: false, code: "INVALID_COORDINATES", message: "userLat/userLng must be valid coordinates" };
    }
    seeker = { lat, lng };
  }

  let maxDistanceKm = null;
  if (query.maxDistanceKm !== undefined && query.maxDistanceKm !== "") {
    const km = parseFloat(query.maxDistanceKm);
    if (!Number.isFinite(km) || km <= 0) {
      return { ok: false, code: "INVALID_DISTANCE", message: "maxDistanceKm must be a positive number" };
    }
    maxDistanceKm = km;
  }

  const bloodGroups = str(query.bloodType)
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 8);

  const province = str(query.province);
  const cityOrDistrict = str(query.district) || str(query.city);

  return {
    ok: true,
    params: {
      limit,
      seeker,
      maxDistanceKm,
      bloodGroups,
      province,
      cityOrDistrict,
      availableOnly: bool(query.availableOnly),
      // Compensation-based donors are hidden unless the seeker explicitly asks for them.
      includeCompensation: bool(query.includeCompensation),
      geoProvince: str(query.geoProvince),
      geoDistrict: str(query.geoDistrict),
      cursor: str(query.cursor),
    },
  };
}

// ---------------------------------------------------------------------------
// Cursor: opaque, tamper-evident-by-fingerprint, bound to the exact query.
// A cursor from one filter/location set is rejected for another, so a stale
// "next page" can never be spliced onto a different result list.
// ---------------------------------------------------------------------------
function queryFingerprint(p) {
  const norm = {
    s: p.seeker ? [Number(p.seeker.lat.toFixed(5)), Number(p.seeker.lng.toFixed(5))] : null,
    m: p.maxDistanceKm,
    b: [...p.bloodGroups].sort(),
    p: p.province.toLowerCase(),
    c: p.cityOrDistrict.toLowerCase(),
    a: p.availableOnly,
    ic: !!p.includeCompensation,
    gp: p.geoProvince.toLowerCase(),
    gd: p.geoDistrict.toLowerCase(),
    l: p.limit,
  };
  return crypto.createHash("sha1").update(JSON.stringify(norm)).digest("hex").slice(0, 12);
}

function encodeCursor(p, segment, skip) {
  const payload = { v: 1, s: segment, k: skip, q: queryFingerprint(p) };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

// Returns { segment, skip } ("geo", 0 when there is no cursor) or null when the
// cursor is malformed / belongs to a different query.
function decodeCursor(p) {
  const firstSegment = p.seeker ? "geo" : "area";
  if (!p.cursor) return { segment: firstSegment, skip: 0 };
  try {
    const d = JSON.parse(Buffer.from(p.cursor, "base64url").toString("utf8"));
    if (!d || d.v !== 1 || d.q !== queryFingerprint(p)) return null;
    if (d.s !== "geo" && d.s !== "area") return null;
    if (d.s === "geo" && !p.seeker) return null;
    if (!Number.isInteger(d.k) || d.k < 0 || d.k > MAX_OFFSET) return null;
    return { segment: d.s, skip: d.k };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Filters (plain objects; ids are converted with `toId` because aggregation
// pipelines - unlike find() - are NOT cast by Mongoose).
// ---------------------------------------------------------------------------
const exactCI = (v) => new RegExp(`^${escapeRegex(v)}$`, "i");

function baseFilters(p, { currentUserId, blockedIds, toId }) {
  const q = {
    userId: { $ne: toId(currentUserId) },
    isSuspended: { $ne: true },
    isBlacklisted: { $ne: true },
    appearsInPublicSearch: { $ne: false },
    visibilityScope: { $ne: "hidden" },
  };
  if (blockedIds.length) q.userId.$nin = blockedIds.map(toId);
  if (p.bloodGroups.length) q.bloodType = p.bloodGroups.length > 1 ? { $in: p.bloodGroups } : p.bloodGroups[0];
  if (p.availableOnly) q.isAvailable = true;
  // Enforced in the query itself (not just the UI): without the opt-in, a COMPENSATION donor can
  // never be returned. Legacy donors have no donorType and count as VOLUNTARY.
  if (!p.includeCompensation) q.donorType = { $ne: "COMPENSATION" };
  const and = [];
  if (p.cityOrDistrict) {
    and.push({ $or: [{ district: exactCI(p.cityOrDistrict) }, { city: exactCI(p.cityOrDistrict) }] });
  }
  if (p.province) q.province = exactCI(p.province);
  if (and.length) q.$and = and;
  return q;
}

// $geoNear stage query: the base filters (donors that have a GeoJSON point).
function geoSegmentPipeline(p, ctx, { skip, take }) {
  const near = { type: "Point", coordinates: [p.seeker.lng, p.seeker.lat] };
  const geoNear = {
    near,
    key: "geo",
    distanceField: "distM",
    spherical: true,
    query: baseFilters(p, ctx),
  };
  if (p.maxDistanceKm) geoNear.maxDistance = kmToMongoMeters(p.maxDistanceKm);

  const pipeline = [{ $geoNear: geoNear }];
  // "Nearby seekers only" donors are only visible within 15 km of the seeker.
  pipeline.push({
    $match: {
      $or: [{ visibilityScope: { $ne: "nearby" } }, { distM: { $lte: kmToMongoMeters(NEARBY_RADIUS_KM) } }],
    },
  });
  // Voluntary donors first (green badge), compensation-based donors after them; nearest first
  // inside each group. Only needed when compensation donors were asked for - otherwise every
  // row is voluntary and $geoNear's own distance order already is the final order.
  if (p.includeCompensation) {
    pipeline.push(...voluntaryFirstStages({ distanceField: "distM" }));
  }
  if (skip) pipeline.push({ $skip: skip });
  pipeline.push({ $limit: take });
  return pipeline;
}

// Aggregation stages that put VOLUNTARY (or legacy, donorType-less) donors before COMPENSATION
// donors, then order by distance (geo segment) or online/available (area segment), _id last so
// offset cursors stay stable between pages.
function voluntaryFirstStages({ distanceField = null } = {}) {
  const sort = { _isComp: 1 };
  if (distanceField) sort[distanceField] = 1;
  else Object.assign(sort, AREA_SORT_KEYS);
  sort._id = 1;
  return [
    { $addFields: { _isComp: { $cond: [{ $eq: ["$donorType", "COMPENSATION"] }, 1, 0] } } },
    { $sort: sort },
  ];
}

// Area segment (donors with NO saved GPS) - or the whole result when the
// seeker sent no coordinates.
function areaSegmentFilter(p, ctx) {
  const q = baseFilters(p, ctx);
  const and = q.$and ? [...q.$and] : [];
  delete q.$and;

  if (p.seeker) {
    // Mirrors /seeker/search: only donors with no coordinates, located by the
    // reverse-geocoded province/district - and only when the seeker didn't
    // already choose their own province/city (an explicit choice wins).
    q["location.latitude"] = null;
    const areaProvince = p.province ? "" : p.geoProvince;
    const areaDistrict = p.cityOrDistrict ? "" : p.geoDistrict;
    if (!areaProvince && !areaDistrict) return null; // nothing to match on
    if (areaDistrict) and.push({ $or: [{ district: exactCI(areaDistrict) }, { city: exactCI(areaDistrict) }] });
    if (areaProvince) q.province = exactCI(areaProvince);
  }

  // Visibility scope for donors without a GPS point: "nearby" donors can only
  // be shown when the seeker's city matches their district (donorVisibleTo).
  const seekerCity = p.cityOrDistrict || p.geoDistrict;
  if (p.seeker && seekerCity) {
    and.push({ $or: [{ visibilityScope: { $ne: "nearby" } }, { visibilityScope: "nearby", district: exactCI(seekerCity) }] });
  } else {
    q.visibilityScope = { $nin: ["hidden", "nearby"] };
  }
  if (and.length) q.$and = and;
  return q;
}

const AREA_SORT_KEYS = { isOnline: -1, isAvailable: -1 };
const AREA_SORT = { ...AREA_SORT_KEYS, _id: 1 };

// ---------------------------------------------------------------------------
// Output shaping
// ---------------------------------------------------------------------------
function distanceBand(km) {
  if (km == null) return null;
  if (km < 2) return "< 2 km";
  if (km < 5) return "2–5 km";
  if (km < 10) return "5–10 km";
  if (km < 20) return "10–20 km";
  return "20+ km";
}

// Voluntary / compensation presentation fields shared by every donor-list endpoint.
// `badge` is what drives the green "Voluntary" badge; legacy donors (no donorType) are VOLUNTARY.
function donorTypeFields(donor) {
  const donorType = donor.donorType === "COMPENSATION" ? "COMPENSATION" : "VOLUNTARY";
  const badge = donorType === "VOLUNTARY" && !donor.isBlacklisted && (donor.confirmedFraudStrikes || 0) < 2 ? "VOLUNTARY_HERO" : null;
  return { donorType, badge, compensationRange: donorType === "COMPENSATION" ? donor.compensationRange || null : null };
}

// Explicit allow-list: the card never needs the donor's raw GPS, e-mail or
// phone. (The older /seeker/search returns the whole document, including the
// exact coordinates of donors who switched "Show exact distance" off.)
function shapeNearbyDonor(donor, { request, now, distanceKmValue }) {
  let isAvailable = donor.isAvailable;
  let daysRemaining = 0;
  if (donor.nextAvailableDate) {
    const next = new Date(donor.nextAvailableDate);
    if (next > now) {
      isAvailable = false;
      daysRemaining = Math.ceil((next - now) / 86400000);
    }
  }
  const user = donor.userId && typeof donor.userId === "object" && donor.userId._id ? donor.userId : null;
  const out = {
    _id: String(donor._id),
    userId: String(user ? user._id : donor.userId),
    fullName: donor.fullName,
    bloodType: donor.bloodType,
    province: donor.province,
    district: donor.district,
    profilePicture: (user && user.profilePicture) || donor.profilePicture || "",
    isOnline: user ? !!user.isOnline : false,
    lastSeen: user ? user.lastSeen : null,
    isAvailable,
    daysRemaining,
    rating: donor.rating || 0,
    totalRatings: donor.totalRatings || 0,
    requestStatus: request ? request.status : null,
    requestId: request ? String(request._id) : null,
    mobileNumber: request && ACCEPTED_FAMILY.includes(request.status) ? donor.mobileNumber : null,
    distanceKm: distanceKmValue == null ? null : distanceKmValue,
    distanceBand: null,
    ...donorTypeFields(donor),
  };
  if (donor.showExactDistance === false && out.distanceKm != null) {
    out.distanceBand = distanceBand(out.distanceKm);
    out.distanceKm = null;
  }
  return out;
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_OFFSET,
  kmToMongoMeters,
  parseNearbyParams,
  queryFingerprint,
  encodeCursor,
  decodeCursor,
  baseFilters,
  geoSegmentPipeline,
  areaSegmentFilter,
  AREA_SORT,
  voluntaryFirstStages,
  donorTypeFields,
  distanceBand,
  shapeNearbyDonor,
};

const { Donor } = require("../models/formModel");
const { blockedEitherWay } = require("./blocks");

const escapeRegex = (v) => String(v).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Haversine distance in km between two lat/lng points.
const distanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const NEARBY_RADIUS_KM = 15; // "Nearby seekers only — within 15 km"
const BROADCAST_LIMIT = 60;

// Does this donor's privacy choice (Privacy & data) let this seeker see them?
//  - hidden: never
//  - nearby: within 15 km when both positions are known; otherwise only the
//            same district (so a donor is never exposed wider than promised)
//  - city:   anyone (the search / broadcast filters already scope by city)
const donorVisibleTo = (donor, seeker) => {
  const scope = donor.visibilityScope || "city";
  if (scope === "hidden" || donor.appearsInPublicSearch === false) return false;
  if (scope !== "nearby") return true;
  const hasBoth =
    seeker &&
    Number.isFinite(seeker.lat) &&
    Number.isFinite(seeker.lng) &&
    donor.location &&
    donor.location.latitude != null &&
    donor.location.longitude != null;
  if (hasBoth) {
    return distanceKm(seeker.lat, seeker.lng, donor.location.latitude, donor.location.longitude) <= NEARBY_RADIUS_KM;
  }
  return !!(seeker && seeker.city && donor.district && new RegExp(`^${escapeRegex(seeker.city)}$`, "i").test(donor.district));
};

// Donors who would receive an emergency broadcast — shared by the real
// fan-out (postRequest) and the "This will alert N donors" estimate, so the
// number shown before sending is exactly the number that gets notified.
const findBroadcastDonors = async ({ seekerId, bloodType, province, city, lat, lng, limit = BROADCAST_LIMIT }) => {
  const blocked = await blockedEitherWay(seekerId);
  const candidates = await Donor.find({
    userId: { $ne: seekerId, ...(blocked.length ? { $nin: blocked } : {}) },
    bloodType,
    isAvailable: true,
    isSuspended: { $ne: true },
    appearsInPublicSearch: { $ne: false },
    $or: [
      { district: new RegExp(`^${escapeRegex(city)}$`, "i") },
      { province: new RegExp(`^${escapeRegex(province)}$`, "i") },
    ],
  }).limit(500);
  const now = new Date();
  const seeker = { lat: lat != null ? Number(lat) : NaN, lng: lng != null ? Number(lng) : NaN, city };
  return candidates
    .filter((d) => !(d.nextAvailableDate && new Date(d.nextAvailableDate) > now))
    .filter((d) => donorVisibleTo(d, seeker))
    .slice(0, limit);
};

module.exports = { findBroadcastDonors, donorVisibleTo, distanceKm, escapeRegex, NEARBY_RADIUS_KM, BROADCAST_LIMIT };

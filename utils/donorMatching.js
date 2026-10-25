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

// Does this donor's privacy choice (Privacy & data) let this seeker see them?
//  - hidden: never
//  - nearby: within 15 km when both positions are known; otherwise only the
//            same district (so a donor is never exposed wider than promised)
//  - city:   anyone (the search filters already scope by city)
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

// Exact, case-insensitive province/city match that tolerates stray whitespace
// ("  Lahore ", "Dera  Ghazi Khan") but never partial matches ("Lahore" != "Lahore Cantt").
const exactAreaRegex = (v) =>
  new RegExp(`^\\s*${escapeRegex(String(v).trim().replace(/\s+/g, " ")).replace(/ /g, "\\s+")}\\s*$`, "i");

module.exports = { donorVisibleTo, distanceKm, escapeRegex, exactAreaRegex, NEARBY_RADIUS_KM };

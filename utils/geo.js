// Small geo helpers shared by the public directory endpoints.
const R = 6371; // km

const toRad = (v) => (v * Math.PI) / 180;

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const validCoord = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

// Adds `distanceKm` (1 decimal, or null when the listing has no coordinates)
// to every item when the caller sent ?lat=&lng=, and sorts nearest-first when
// ?sort=nearest. Listings without coordinates always sort last. Does nothing
// when no valid coordinates were sent, so existing clients are unaffected.
function withDistance(list, query) {
  const lat = parseFloat(query.lat);
  const lng = parseFloat(query.lng);
  if (!validCoord(lat, lng)) return list;
  const out = list.map((item) => {
    const loc = [item.location, item.currentLocation].find((l) => l && validCoord(l.latitude, l.longitude));
    const km = loc ? haversineKm(lat, lng, loc.latitude, loc.longitude) : null;
    return { ...item, distanceKm: km == null ? null : Math.round(km * 10) / 10 };
  });
  if (query.sort === "nearest") {
    out.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }
  return out;
}

module.exports = { haversineKm, withDistance, validCoord };

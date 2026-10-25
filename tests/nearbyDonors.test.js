// Run with:  node --test tests/
// Pure-logic tests (no MongoDB needed): the model/blocks modules that
// utils/donorMatching.js imports are stubbed so only the rules are exercised.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");

const stub = (rel, exports) => {
  const file = path.join(__dirname, "..", rel);
  const m = new Module(file);
  m.filename = file;
  m.loaded = true;
  m.exports = exports;
  require.cache[file] = m;
};
stub("models/formModel.js", { Donor: {}, DonationRequest: {} });
stub("utils/blocks.js", { blockedEitherWay: async () => [] });

const {
  parseNearbyParams,
  encodeCursor,
  decodeCursor,
  baseFilters,
  geoSegmentPipeline,
  areaSegmentFilter,
  kmToMongoMeters,
  shapeNearbyDonor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_OFFSET,
} = require("../utils/nearbyDonors");

const toId = (v) => `oid:${v}`;
const ctx = { currentUserId: "me", blockedIds: ["b1", "b2"], toId };
const parse = (q) => {
  const r = parseNearbyParams(q);
  assert.ok(r.ok, JSON.stringify(r));
  return r.params;
};

test("limit defaults to 25 and is clamped to 1..50", () => {
  assert.equal(parse({}).limit, DEFAULT_LIMIT);
  assert.equal(DEFAULT_LIMIT, 25);
  assert.equal(parse({ limit: "9999" }).limit, MAX_LIMIT);
  assert.equal(parse({ limit: "0" }).limit, 1);
  assert.equal(parse({ limit: "abc" }).limit, DEFAULT_LIMIT);
});

test("rejects invalid / half-supplied / (0,0) coordinates", () => {
  assert.equal(parseNearbyParams({ userLat: "95", userLng: "10" }).code, "INVALID_COORDINATES");
  assert.equal(parseNearbyParams({ userLat: "10" }).code, "INVALID_COORDINATES");
  assert.equal(parseNearbyParams({ userLat: "0", userLng: "0" }).code, "INVALID_COORDINATES");
  assert.equal(parseNearbyParams({ userLat: "31.5", userLng: "74.3", maxDistanceKm: "-3" }).code, "INVALID_DISTANCE");
  assert.equal(parse({ userLat: "31.5", userLng: "74.3" }).seeker.lat, 31.5);
  assert.equal(parse({}).seeker, null);
});

test("cursor round-trips and starts at the right segment", () => {
  const withGeo = parse({ userLat: "31.5", userLng: "74.3" });
  assert.deepEqual(decodeCursor(withGeo), { segment: "geo", skip: 0 });
  assert.deepEqual(decodeCursor(parse({})), { segment: "area", skip: 0 });

  const c = encodeCursor(withGeo, "geo", 25);
  assert.deepEqual(decodeCursor({ ...withGeo, cursor: c }), { segment: "geo", skip: 25 });
  const a = encodeCursor(withGeo, "area", 7);
  assert.deepEqual(decodeCursor({ ...withGeo, cursor: a }), { segment: "area", skip: 7 });
});

test("a cursor cannot be replayed against a different query (stale-page guard)", () => {
  const base = parse({ userLat: "31.5", userLng: "74.3", bloodType: "O+" });
  const cursor = encodeCursor(base, "geo", 25);
  for (const changed of [
    { userLat: "31.5", userLng: "74.3", bloodType: "A+", cursor },
    { userLat: "31.5", userLng: "74.3", bloodType: "O+", availableOnly: "true", cursor },
    { userLat: "33.0", userLng: "74.3", bloodType: "O+", cursor },
    { userLat: "31.5", userLng: "74.3", bloodType: "O+", limit: "10", cursor },
  ]) {
    assert.equal(decodeCursor(parse(changed)), null);
  }
  // identical query (blood groups in another order / tiny float noise) still matches
  const same = parse({ userLat: "31.500001", userLng: "74.3", bloodType: "O+", cursor });
  assert.deepEqual(decodeCursor(same), { segment: "geo", skip: 25 });
});

test("malformed, oversized or geo-without-location cursors are rejected", () => {
  const p = parse({ userLat: "31.5", userLng: "74.3" });
  assert.equal(decodeCursor({ ...p, cursor: "not-base64-json" }), null);
  assert.equal(decodeCursor({ ...p, cursor: encodeCursor(p, "geo", MAX_OFFSET + 1) }), null);
  const noLoc = parse({});
  assert.equal(decodeCursor({ ...noLoc, cursor: encodeCursor(p, "geo", 25) }), null);
});

test("base filters exclude self, blocked, suspended, hidden and apply blood/availability", () => {
  const p = parse({ bloodType: "O+, A-", availableOnly: "true", district: "Lahore", province: "Punjab" });
  const q = baseFilters(p, ctx);
  assert.deepEqual(q.userId, { $ne: "oid:me", $nin: ["oid:b1", "oid:b2"] });
  assert.deepEqual(q.bloodType, { $in: ["O+", "A-"] });
  assert.equal(q.isAvailable, true);
  assert.deepEqual(q.isSuspended, { $ne: true });
  assert.deepEqual(q.visibilityScope, { $ne: "hidden" });
  assert.ok(q.province instanceof RegExp && q.province.test("punjab"));
  assert.ok(q.$and[0].$or[0].district.test("LAHORE"));
  // regex metacharacters in user input are escaped, never executed
  const evil = baseFilters(parse({ district: ".*" }), ctx);
  assert.equal(evil.$and[0].$or[0].district.test("Lahore"), false);
});

test("geo pipeline: distance via $geoNear, 15 km 'nearby' rule, skip/limit order", () => {
  const p = parse({ userLat: "31.5", userLng: "74.3", maxDistanceKm: "20" });
  const pipe = geoSegmentPipeline(p, ctx, { skip: 25, take: 26 });
  assert.deepEqual(Object.keys(pipe[0]), ["$geoNear"]); // must be the first stage
  assert.deepEqual(pipe[0].$geoNear.near, { type: "Point", coordinates: [74.3, 31.5] });
  assert.equal(pipe[0].$geoNear.key, "geo");
  assert.ok(Math.abs(pipe[0].$geoNear.maxDistance - kmToMongoMeters(20)) < 1e-6);
  assert.ok(pipe[1].$match.$or[1].distM.$lte > 15000); // 15 km expressed in Mongo metres
  assert.deepEqual(pipe.slice(-2), [{ $skip: 25 }, { $limit: 26 }]);
  // no skip stage on the first page
  assert.equal(geoSegmentPipeline(p, ctx, { skip: 0, take: 26 }).some((s) => s.$skip !== undefined), false);
});

test("km thresholds are converted between the 6371 km app radius and Mongo's 6378.1 km", () => {
  assert.ok(Math.abs(kmToMongoMeters(15) - 15000 * (6378100 / 6371000)) < 1e-6);
  assert.ok(kmToMongoMeters(15) > 15000 && kmToMongoMeters(15) < 15020);
});

test("area segment: no GPS fix -> filters only, nearby/hidden donors excluded", () => {
  const f = areaSegmentFilter(parse({ bloodType: "O+" }), ctx);
  assert.deepEqual(f.visibilityScope, { $nin: ["hidden", "nearby"] });
  assert.equal(f["location.latitude"], undefined);
});

test("area segment with GPS: only donors without coordinates, matched by reverse-geocoded area", () => {
  const p = parse({ userLat: "31.5", userLng: "74.3", geoProvince: "Punjab", geoDistrict: "Lahore" });
  const f = areaSegmentFilter(p, ctx);
  assert.equal(f["location.latitude"], null);
  assert.ok(f.province.test("punjab"));
  assert.equal(f.$and.length, 2); // district match + "nearby" scope rule
  // nothing reverse-geocoded and no explicit filter -> nothing to match on
  assert.equal(areaSegmentFilter(parse({ userLat: "31.5", userLng: "74.3" }), ctx), null);
  // an explicit province choice wins over the reverse-geocoded one
  const explicit = areaSegmentFilter(
    parse({ userLat: "31.5", userLng: "74.3", province: "Sindh", geoProvince: "Punjab", geoDistrict: "Lahore" }),
    ctx,
  );
  assert.ok(explicit.province.test("Sindh") && !explicit.province.test("Punjab"));
});

test("shaping: allow-listed fields only, privacy band, resting window, phone gating", () => {
  const donor = {
    _id: "d1",
    userId: { _id: "u1", isOnline: true, lastSeen: "t", profilePicture: "pic" },
    fullName: "A",
    bloodType: "O+",
    province: "Punjab",
    district: "Lahore",
    isAvailable: true,
    nextAvailableDate: new Date(Date.now() + 3 * 86400000),
    mobileNumber: "0300",
    showExactDistance: false,
    location: { latitude: 1, longitude: 2 },
    geo: { type: "Point", coordinates: [2, 1] },
    email: "x@y.z",
  };
  const out = shapeNearbyDonor(donor, { request: null, now: new Date(), distanceKmValue: 3.4 });
  assert.equal(out.isAvailable, false);
  assert.ok(out.daysRemaining >= 3);
  assert.equal(out.distanceKm, null);
  assert.equal(out.distanceBand, "2–5 km");
  assert.equal(out.mobileNumber, null);
  for (const leaked of ["location", "geo", "email", "showExactDistance"]) assert.equal(leaked in out, false);
  const accepted = shapeNearbyDonor(donor, { request: { _id: "r1", status: "accepted" }, now: new Date(), distanceKmValue: null });
  assert.equal(accepted.mobileNumber, "0300");
  assert.equal(accepted.requestId, "r1");
});

test("compensation donors are excluded by the query unless the seeker opts in", () => {
  const ctx = { currentUserId: "507f1f77bcf86cd799439011", blockedIds: [], toId: (v) => v };
  const off = parseNearbyParams({ bloodType: "O+" }).params;
  assert.deepEqual(baseFilters(off, ctx).donorType, { $ne: "COMPENSATION" });
  assert.deepEqual(baseFilters(off, ctx).isBlacklisted, { $ne: true });
  const on = parseNearbyParams({ bloodType: "O+", includeCompensation: "true" }).params;
  assert.equal(baseFilters(on, ctx).donorType, undefined);
});

test("with the opt-in, voluntary donors are sorted before compensation donors", () => {
  const p = { seeker: { lat: 1, lng: 1 }, maxDistanceKm: 12, bloodGroups: [], province: "", cityOrDistrict: "", includeCompensation: true };
  const pipe = geoSegmentPipeline(p, { currentUserId: "a", blockedIds: [], toId: (v) => v }, { skip: 0, take: 26 });
  const sort = pipe.find((s) => s.$sort).$sort;
  assert.deepEqual(Object.keys(sort), ["_isComp", "distM", "_id"]);
});

test("shapeNearbyDonor exposes the resting flag and return date only while resting", () => {
  const now = new Date("2026-10-22T10:00:00Z");
  const base = { _id: "d9", userId: "u9", fullName: "R", bloodType: "A+", district: "Lahore", rating: 0, totalRatings: 0 };
  const resting = shapeNearbyDonor(
    { ...base, isAvailable: false, nextAvailableDate: new Date("2026-12-03T10:00:00Z") },
    { request: null, now, distanceKmValue: null },
  );
  assert.equal(resting.isResting, true);
  assert.equal(resting.isAvailable, false);
  assert.equal(resting.nextAvailableDate, "2026-12-03T10:00:00.000Z");
  assert.equal(resting.daysRemaining, 42);

  const lagging = shapeNearbyDonor(
    { ...base, isAvailable: false, availabilityReconciled: false, nextAvailableDate: new Date("2026-10-20T10:00:00Z") },
    { request: null, now, distanceKmValue: null },
  );
  assert.equal(lagging.isResting, false);
  assert.equal(lagging.isAvailable, true);
  assert.equal(lagging.nextAvailableDate, null);

  const active = shapeNearbyDonor({ ...base, isAvailable: true }, { request: null, now, distanceKmValue: null });
  assert.equal(active.isResting, false);
  assert.equal(active.nextAvailableDate, null);
});

test("exactAreaRegex: exact + whitespace tolerant, never partial", () => {
  const { exactAreaRegex } = require("../utils/donorMatching");
  const r = exactAreaRegex("  Dera  Ghazi Khan ");
  assert.equal(r.test("dera ghazi khan"), true);
  assert.equal(r.test(" Dera   Ghazi  Khan "), true);
  assert.equal(r.test("Dera Ghazi Khan City"), false);
  assert.equal(exactAreaRegex("Lahore").test("Lahore Cantt"), false);
});

// One-off / idempotent backfill of Donor.geo (GeoJSON) from the legacy
// Donor.location {latitude, longitude}. New and edited donors are handled by
// the pre-save hook in models/formModel.js; this covers donors saved before
// `geo` existed so they appear in the indexed nearby-donors query.
//
// Safe to run repeatedly: it only touches donors that have valid coordinates
// but no `geo` yet, and uses a single server-side update (no documents are
// loaded into Node).

const { Donor } = require("../models/formModel");

async function backfillDonorGeo() {
  const result = await Donor.collection.updateMany(
    {
      geo: { $exists: false },
      "location.latitude": { $type: "number", $gte: -90, $lte: 90 },
      "location.longitude": { $type: "number", $gte: -180, $lte: 180 },
      // (0, 0) is the "no fix" placeholder - same rule as utils/geo.validCoord.
      $nor: [{ "location.latitude": 0, "location.longitude": 0 }],
    },
    [
      {
        $set: {
          geo: { type: "Point", coordinates: ["$location.longitude", "$location.latitude"] },
        },
      },
    ],
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

module.exports = { backfillDonorGeo };

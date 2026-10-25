const mongoose = require("mongoose");
require("dotenv").config();

// maxPoolSize: default is 100, which is fine for one instance today but is
// the first thing that starts queuing requests (visible to users as random
// slow/hanging requests under load) once concurrent traffic grows — bumped
// so more requests can hit MongoDB in parallel instead of waiting in line.
// minPoolSize keeps a few connections warm so the very first requests after
// a quiet period don't pay a fresh-connection penalty.
// Both are overridable per deployment: total connections = pool size x number of server
// instances, and must stay under your MongoDB plan's connection limit.
mongoose.connect(process.env.MONGO_URI, {
  maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 200,
  minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 5,
});

const db = mongoose.connection;

db.on("connected", () => {
  console.log("MongoDB Connected Successfully!");
  seedDefaultFeatureFlags();
  backfillDonorGeoOnce();
});
db.on("disconnected", () => console.log("MongoDB Disconnected!"));
db.on("error", (err) => console.log("MongoDB connection error!"));

// Fills Donor.geo (GeoJSON, used by GET /seeker/nearby-donors) for donors saved
// before that field existed. Idempotent and cheap once everything is filled
// (the filter matches nothing). Set DONOR_GEO_BACKFILL=off to skip it.
async function backfillDonorGeoOnce() {
  if (String(process.env.DONOR_GEO_BACKFILL || "").toLowerCase() === "off") return;
  try {
    const { backfillDonorGeo } = require("../utils/donorGeo");
    const r = await backfillDonorGeo();
    if (r.modified > 0) console.log(`Donor geo backfill: ${r.modified} donor(s) updated`);
  } catch (err) {
    console.log("Donor geo backfill skipped:", err.message);
  }
}

// Feature flags were real (GET /feature-flags, FeatureFlags.tsx) but had no
// default set — an admin had to invent every key from scratch with no
// connection to any real gate in the app. These five map to actual features
// the mobile app now checks (see src/context/FeatureFlagContext.tsx). All
// default to "ga" (100%) deliberately: seeding must never silently turn off
// something that already worked — an admin explicitly dialing one down is
// the only thing that should ever disable it. Idempotent — only inserts keys
// that don't already exist, never overwrites an admin's existing setting.
async function seedDefaultFeatureFlags() {
  try {
    const FeatureFlag = require("../models/featureFlagModel");
    const defaults = [
      // Renamed from "video_calling": this app is voice-calling only (see
      // app/call/[requestId].tsx) — video was fully stripped out. Kept as a
      // fresh key rather than renaming the old one in place, since this seed
      // is intentionally idempotent/insert-only and must never silently
      // rewrite an admin's existing setting on an already-running deployment.
      { key: "voice_calling", label: "Voice Calling", status: "ga", rolloutPercent: 100 },
      { key: "live_location_search", label: "Search Donors by Live Location", status: "ga", rolloutPercent: 100 },
      { key: "directory_registration", label: "Directory Self-Registration (Hospitals/Ambulances/Blood Banks/NGOs)", status: "ga", rolloutPercent: 100 },
      { key: "donor_card_share", label: "Digital Donor Card Sharing", status: "ga", rolloutPercent: 100 },
      { key: "map_location_picker", label: "Map-Based Location Picker on Emergency Requests", status: "ga", rolloutPercent: 100 },
    ];
    for (const flag of defaults) {
      const exists = await FeatureFlag.findOne({ key: flag.key });
      if (!exists) await FeatureFlag.create(flag);
    }
  } catch (err) {
    console.log("Feature flag seed skipped:", err.message);
  }
}

module.exports = db;

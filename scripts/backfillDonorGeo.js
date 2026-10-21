// Usage:  node scripts/backfillDonorGeo.js
// Builds Donor.geo for donors saved before the nearby-donors feature.
// (The server also runs this automatically after connecting - see
// config/db.js - this script is for running it by hand.)
require("dotenv").config();
const mongoose = require("mongoose");
const { Donor } = require("../models/formModel");
const { backfillDonorGeo } = require("../utils/donorGeo");

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    await Donor.init(); // make sure the 2dsphere index exists
    const r = await backfillDonorGeo();
    console.log(`Donor.geo backfill complete - matched ${r.matched}, updated ${r.modified}`);
    process.exit(0);
  } catch (err) {
    console.error("Backfill failed:", err.message);
    process.exit(1);
  }
})();

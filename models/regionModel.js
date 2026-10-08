const mongoose = require("mongoose");

// Real backend-driven replacement for the mobile app's hardcoded province/city
// list. Adding a region here makes it immediately selectable in the mobile app's
// guided search — no app release required (exactly what the admin PDF promises).
//
// provinceUr / citiesUr: optional Urdu display names, added so the mobile app's
// Urdu language mode can show a localized label while still using `province`/
// `cities` (English) as the actual value sent to search — donor records only
// store English province/city, so search matching must keep using those.
// citiesUr is positional: citiesUr[i] is the Urdu name for cities[i]. Either
// field can be left empty; the app falls back to the English name.
const regionSchema = new mongoose.Schema(
  {
    province: { type: String, required: true, unique: true, trim: true },
    provinceUr: { type: String, trim: true, default: "" },
    cities: { type: [String], default: [] },
    citiesUr: { type: [String], default: [] },
    status: { type: String, enum: ["active", "coming_soon"], default: "active" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Region", regionSchema);

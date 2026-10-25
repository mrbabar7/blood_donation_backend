const mongoose = require("mongoose");

const featureFlagSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    label: { type: String, required: true },
    status: { type: String, enum: ["ga", "beta", "internal", "off"], default: "internal" },
    rolloutPercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FeatureFlag", featureFlagSchema);

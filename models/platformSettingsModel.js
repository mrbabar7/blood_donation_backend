const mongoose = require("mongoose");

// Singleton document (there's only ever one) — real platform configuration an
// admin can actually change, not a display-only mockup.
const platformSettingsSchema = new mongoose.Schema(
  {
    defaultLanguage: { type: String, default: "en" },
    criticalRequestAlertMinutes: { type: Number, default: 15 },
    donorDataRetentionYears: { type: Number, default: 5 },
    require2FAForAdmins: { type: Boolean, default: false },
    restrictAdminIpAllowlist: { type: Boolean, default: false },
    blockLoginsFromUnknownCountries: { type: Boolean, default: false },
    autoLockAdminSessionMinutes: { type: Number, default: 15 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlatformSettings", platformSettingsSchema);

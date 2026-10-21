const mongoose = require("mongoose");

// Written on every real admin login — genuine session/device history, not
// simulated. No geo-IP lookup is wired in (that needs an external IP-geolocation
// API), so "location" stays an honest IP address rather than a fabricated city.
const adminSessionSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
    adminName: { type: String, required: true },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    // Bumped on every authenticated admin request (adminAuthMiddleware.js) —
    // powers the "auto-lock admin session after N idle minutes" setting.
    lastActivityAt: { type: Date, default: Date.now },
    revoked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminSession", adminSessionSchema);

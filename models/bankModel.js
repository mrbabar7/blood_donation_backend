const mongoose = require("mongoose");

const BloodBankSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    formType: { type: String, default: "bloodbank" },
    name: { type: String, required: true },
    orgType: { type: String, required: true },
    timing: { type: String, required: true },
    phone: { type: String, default: "" },
    whatsapp: { type: String },
    category: { type: [String], required: true },
    operatingDays: { type: [String] },
    website: { type: String, default: "" },
    address: { type: String, required: true },
    // Admin-controlled trust badge (PDF's "Verified" pill). Defaults false — there's
    // no admin panel in this build, so flipping this to true currently means a direct
    // DB update (e.g. via MongoDB Compass/Atlas) until a real admin screen exists.
    // Base64 data-URI image uploaded from the registration form (no S3/multer setup in this project, so store inline).
    image: { type: String, default: "" },
    isVerified: { type: Boolean, default: false },

    // Base location of the facility (device GPS captured on the registration
    // form, or geocoded from the address). Powers real "distance" + "Nearest".
    location: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    // Structured opening hours, in minutes after midnight local time. The free
    // text `timing` stays for display; these make "Open now" exact.
    open24h: { type: Boolean, default: false },
    openMinutes: { type: Number, default: null, min: 0, max: 1439 },
    closeMinutes: { type: Number, default: null, min: 0, max: 1439 },
    // Live per-blood-group stock (PDF screen 29), owner-editable via the app.
    stock: {
      type: [{ bloodGroup: String, level: { type: String, enum: ["high", "medium", "low", "none"], default: "none" } }],
      default: [],
    },
  },
  { timestamps: true },
);

// Matches BloodBankDiscovery.js's find({ isVerified: true }).sort({ createdAt: -1 }).
BloodBankSchema.index({ isVerified: 1, createdAt: -1 });

module.exports = mongoose.model("BloodBank", BloodBankSchema);

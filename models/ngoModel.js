const mongoose = require("mongoose");

const NGOSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    formType: { type: String, default: "ngo" },
    name: {
      type: String,
      required: [true, "NGO name is required"],
      trim: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    orgType: {
      type: String,
      required: true,
      enum: ["Registered NGO", "Trust", "Foundation", "Volunteer Group", "Corporate Partner", "Institution", "Community Partner", "Sponsor"],
    },
    timing: { type: String, required: true },
    operatingDays: { type: [String], required: true },
    whatsapp: { type: String, required: true },
    category: { type: [String], required: true },
    website: { type: String, default: "" },
    address: { type: String, required: true },
    phone: { type: String, default: "" },
    // Base64 data-URI image uploaded from the registration form (no S3/multer setup in this project, so store inline).
    image: { type: String, default: "" },
    isVerified: { type: Boolean, default: false },

    location: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    open24h: { type: Boolean, default: false },
    openMinutes: { type: Number, default: null, min: 0, max: 1439 },
    closeMinutes: { type: Number, default: null, min: 0, max: 1439 },
  },
  { timestamps: true },
);

// Matches NgoDiscovery.js's find({ isVerified: true }).sort({ createdAt: -1 }).
NGOSchema.index({ isVerified: 1, createdAt: -1 });

module.exports = mongoose.model("NGO", NGOSchema);

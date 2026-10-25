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
    // The last four values belong to the retired "Partner" organization type. They stay
    // in the enum ONLY so legacy (archived) partner documents remain valid when re-saved;
    // new/updated NGOs are restricted to the first four in utils/directoryValidation.js.
    orgType: {
      type: String,
      required: true,
      enum: ["Registered NGO", "Trust", "Foundation", "Volunteer Group", "Corporate Partner", "Institution", "Community Partner", "Sponsor"],
    },
    timing: { type: String, required: true },
    operatingDays: { type: [String], required: true },
    category: { type: [String], required: true },
    website: { type: String, default: "" },
    address: { type: String, required: true },
    // Normalized address (Province + City + Full Address). `address` stays as the
    // composed display string ("Street, City, Province") so older clients and
    // search keep working. Coordinates live in `location` below, not here.
    // Legacy records only have `address`; migrate with scripts/migrateDirectoryRefactor.js.
    addressDetails: {
      province: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      fullAddress: { type: String, trim: true, default: "" },
      source: { type: String, enum: ["manual", "gps", "legacy"], default: "manual" },
    },
    phone: { type: String, default: "" },
    // Base64 data-URI image uploaded from the registration form (no S3/multer setup in this project, so store inline).
    image: { type: String, default: "" },
    isVerified: { type: Boolean, default: false },

    // Retired "Partner" records (formType "partner") are archived by
    // scripts/migrateDirectoryRefactor.js: kept intact in the database but hidden from the
    // public directory, My Listings and the admin pending queue. They are never reclassified.
    archived: { type: Boolean, default: false },
    archivedReason: { type: String, default: "" },
    archivedAt: { type: Date, default: null },

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

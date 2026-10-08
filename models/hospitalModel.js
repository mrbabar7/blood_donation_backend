const mongoose = require("mongoose");

const HospitalSchema = new mongoose.Schema({
  formType: {
    type: String,
    default: "Hospital",
  },
  name: {
    type: String,
    required: [true, "Hospital name is required"],
    trim: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  orgType: {
    type: String,
    required: true,
    enum: ["Private", "Government", "Semi-Government", "Trust / NGO"],
  },
  timing: {
    type: String,
    required: [true, "Operating hours / timing are required"],
    default: "24/7 Service Available",
  },
  operatingDays: {
    type: [String],
    required: [true, "Operating days are required"],
    default: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  },
  phone: {
    type: String,
    required: false,
    default: "",
  },
  whatsapp: {
    type: String,
    required: [true, "WhatsApp number is required"],
    trim: true,
  },
  category: {
    type: [String],
    required: [true, "At least one category or specialty is required"],
  },
  website: {
    type: String,
    default: "",
    trim: true,
  },
  address: {
    type: String,
    required: [true, "Address is required"],
    trim: true,
  },
  // Base64 data-URI image uploaded from the registration form.
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
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Matches HospitalDiscovery.js's find({ isVerified: true }).sort({ createdAt: -1 }).
HospitalSchema.index({ isVerified: 1, createdAt: -1 });

module.exports = mongoose.model("Hospital", HospitalSchema);

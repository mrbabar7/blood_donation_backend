const mongoose = require("mongoose");

const ipAllowlistSchema = new mongoose.Schema(
  {
    cidr: { type: String, required: true, unique: true, trim: true }, // e.g. "203.99.12.0/24"
    label: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("IpAllowlistEntry", ipAllowlistSchema);

const mongoose = require("mongoose");

// Real CMS backing for the mobile app's static pages (About/Contact/Team/Terms/
// Privacy) — replaces hardcoded screen content with admin-editable rows.
const staticPageSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true },
    contentEn: { type: String, required: true },
    contentUr: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StaticPage", staticPageSchema);

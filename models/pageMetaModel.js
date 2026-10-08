const mongoose = require("mongoose");

// Real per-page SEO metadata — genuinely served in sitemap.xml and consumable by
// a web frontend's <head> tags. What this CANNOT do without external
// integration: report real organic clicks, search position, or a "SEO score" —
// those need Google Search Console. Flagged in the controller, not faked here.
const pageMetaSchema = new mongoose.Schema(
  {
    path: { type: String, required: true, unique: true, trim: true }, // e.g. "/blood-banks/lahore"
    title: { type: String, required: true },
    description: { type: String, default: "" },
    focusKeyword: { type: String, default: "" },
    canonicalUrl: { type: String, default: "" },
    indexable: { type: Boolean, default: true },
    includeInSitemap: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PageMeta", pageMetaSchema);

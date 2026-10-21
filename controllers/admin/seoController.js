const PageMeta = require("../../models/pageMetaModel");
const Redirect = require("../../models/redirectModel");
const NotFoundLog = require("../../models/notFoundLogModel");

// GET /admin/seo/overview — real counts of what's actually configured. NO
// fabricated "SEO score", Core Web Vitals, or organic click numbers — those
// require Google Search Console / a real analytics integration. Returns what
// this backend can honestly know instead of faking a percentage.
exports.getOverview = async (req, res) => {
  try {
    const [totalPages, missingDescription, notIndexed, openRedirects404s] = await Promise.all([
      PageMeta.countDocuments(),
      PageMeta.countDocuments({ description: "" }),
      PageMeta.countDocuments({ indexable: false }),
      NotFoundLog.countDocuments(),
    ]);

    res.status(200).json({
      success: true,
      totalPages,
      issues: [
        ...(missingDescription > 0 ? [{ text: `${missingDescription} page(s) missing a meta description`, severity: "medium" }] : []),
        ...(notIndexed > 0 ? [{ text: `${notIndexed} page(s) excluded from indexing — confirm this is intentional`, severity: "low" }] : []),
        ...(openRedirects404s > 0 ? [{ text: `${openRedirects404s} distinct broken URL(s) logged`, severity: "medium" }] : []),
      ],
      note: "SEO score, Core Web Vitals, search position and organic-click numbers require a real Google Search Console / analytics integration — not shown here rather than faked. Meta coverage and sitemap health below are real.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listPageMeta = async (req, res) => {
  try {
    const pages = await PageMeta.find().sort({ path: 1 });
    res.status(200).json({ success: true, pages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.upsertPageMeta = async (req, res) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ success: false, message: "Path is required." });
    const page = await PageMeta.findOneAndUpdate({ path }, req.body, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.status(200).json({ success: true, page });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deletePageMeta = async (req, res) => {
  try {
    await PageMeta.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /sitemap.xml — PUBLIC, genuinely generated from real PageMeta docs.
exports.getSitemap = async (req, res) => {
  try {
    const baseUrl = process.env.PUBLIC_WEB_URL || "https://example.com";
    const pages = await PageMeta.find({ includeInSitemap: true, indexable: true });
    const urls = pages.map((p) => `  <url><loc>${baseUrl}${p.path}</loc></url>`).join("\n");
    res.set("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
  } catch (error) {
    res.status(500).send("");
  }
};

// GET /robots.txt — PUBLIC, real, references the real sitemap above.
exports.getRobotsTxt = async (req, res) => {
  const baseUrl = process.env.PUBLIC_WEB_URL || "https://example.com";
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\n\nSitemap: ${baseUrl}/sitemap.xml`);
};

// ---- Redirects & 404s ----
exports.listRedirects = async (req, res) => {
  try {
    const redirects = await Redirect.find().sort({ hits: -1 });
    const notFound = await NotFoundLog.find().sort({ hits: -1 }).limit(20);
    res.status(200).json({ success: true, redirects, notFound });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createRedirect = async (req, res) => {
  try {
    const { from, to, type } = req.body;
    const redirect = await Redirect.create({ from, to, type: type || 301 });
    // Clears any matching 404 log entry — this URL is fixed now.
    await NotFoundLog.deleteOne({ url: from });
    res.status(201).json({ success: true, redirect });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "A redirect for that path already exists." });
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteRedirect = async (req, res) => {
  try {
    await Redirect.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

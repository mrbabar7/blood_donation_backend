const StaticPage = require("../../models/staticPageModel");
const { writeAuditLog } = require("./auditLogController");

exports.listPages = async (req, res) => {
  try {
    const pages = await StaticPage.find().sort({ slug: 1 });
    const enCount = pages.length;
    const urCount = pages.filter((p) => p.contentUr && p.contentUr.trim().length > 0).length;
    res.status(200).json({
      success: true,
      pages,
      translationCoverage: enCount > 0 ? Math.round((urCount / enCount) * 100) : 0,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPage = async (req, res) => {
  try {
    const page = await StaticPage.findOne({ slug: req.params.slug });
    if (!page) return res.status(404).json({ success: false, message: "Page not found." });
    res.status(200).json({ success: true, page });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.upsertPage = async (req, res) => {
  try {
    const { slug } = req.params;
    const { title, contentEn, contentUr } = req.body;
    const page = await StaticPage.findOneAndUpdate(
      { slug },
      { slug, title, contentEn, contentUr },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Edited page: ${page.title} (EN)`, category: "content" });
    res.status(200).json({ success: true, page });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Public — the mobile app fetches by slug instead of hardcoding copy.
exports.getPublicPage = async (req, res) => {
  try {
    const page = await require("../../models/staticPageModel").findOne({ slug: req.params.slug });
    if (!page) return res.status(404).json({ success: false, message: "Not found." });
    res.status(200).json({ success: true, page });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const express = require("express");
const router = express.Router();
const { getPublicPage } = require("../controllers/admin/cmsController");

// GET /pages/:slug — real CMS content the mobile app can fetch instead of
// hardcoding About/Contact/Team/Terms/Privacy copy.
router.get("/:slug", getPublicPage);

module.exports = router;

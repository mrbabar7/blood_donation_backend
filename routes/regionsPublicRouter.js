const express = require("express");
const router = express.Router();
const { getPublicRegions } = require("../controllers/admin/regionsController");

// Public, read-only — the mobile app's guided-search screen calls this directly.
router.get("/", getPublicRegions);

module.exports = router;

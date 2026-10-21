const express = require("express");
const router = express.Router();
const upload = require("../utils/multerMemory");
const { protectAdmin, requirePermission, optionalAdmin } = require("../middlewares/adminAuthMiddleware");
const { PERMISSIONS } = require("../config/adminPermissions");
const {
  listHeroes, getHero, createHero, updateHero, toggleHero, deleteHero, uploadHeroImage,
} = require("../controllers/ourHeroesController");

// Mounted at /our-heroes and /api/our-heroes (server.js).
//
// Reads are public (the mobile app) but ACTIVE-ONLY: optionalAdmin only lifts
// that restriction for a valid admin token whose role can manage content.
// Every mutation requires the existing admin auth + MANAGE_CONTENT permission,
// the same one that already governs CMS pages and announcements.
const manage = [protectAdmin, requirePermission(PERMISSIONS.MANAGE_CONTENT)];

router.get("/", optionalAdmin, listHeroes);
router.post("/", ...manage, createHero);
router.post("/upload-image", ...manage, upload.single("image"), uploadHeroImage);
router.get("/:id", optionalAdmin, getHero);
router.put("/:id", ...manage, updateHero);
router.patch("/:id/toggle", ...manage, toggleHero);
router.delete("/:id", ...manage, deleteHero);

module.exports = router;

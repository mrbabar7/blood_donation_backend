const express = require("express");
const router = express.Router();
const { getActiveAnnouncements } = require("../controllers/admin/announcementsController");
const { optionalProtect } = require("../middlewares/authMiddleware");

// Public, read-only — the mobile app calls this on launch/foreground to
// render the promo/announcement popup. optionalProtect is used (not protect)
// so it still works for a signed-out guest on guest-home.tsx; req.user is
// just unused here today, kept for parity with the rest of the app's public
// endpoints and in case audience targeting grows to use it later.
//
// This app doesn't use an /api prefix anywhere (see server.js — /auth,
// /donors, /admin, etc. are all mounted at root), so this router is mounted
// at /announcements rather than /api/announcements. Both "/" and "/active"
// are exposed so existing "GET /announcements" callers keep working while
// also satisfying "GET /announcements/active".
router.get("/", optionalProtect, getActiveAnnouncements);
router.get("/active", optionalProtect, getActiveAnnouncements);

module.exports = router;

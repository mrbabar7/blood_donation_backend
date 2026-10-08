const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { getMyThread, sendMyMessage } = require("../controllers/supportController");

// Consumer-facing support chat — not yet wired into a mobile screen, but fully
// functional so the admin Support Inbox has a real counterpart to talk to.
router.get("/my-thread", protect, getMyThread);
router.post("/my-thread", protect, sendMyMessage);

module.exports = router;

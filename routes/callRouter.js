const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { getCallHistory, deleteCall, clearCallHistory } = require("../controllers/callController");

router.get("/history", protect, getCallHistory);
router.delete("/", protect, clearCallHistory);
router.delete("/:id", protect, deleteCall);

module.exports = router;

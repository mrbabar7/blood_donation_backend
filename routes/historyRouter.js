const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const {
  getActivityHistory,
} = require("../controllers/donor&seekerController/historyData");
const {
  deleteHistory,
} = require("../controllers/donor&seekerController/deleteHistory");

router.get("/activity-history", protect, getActivityHistory);
router.delete("/delete-request/:requestId", protect, deleteHistory);

module.exports = router;

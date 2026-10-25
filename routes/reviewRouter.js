const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const {
  getReviews,
  submitReview,
  getMyReview,
  updateMyReview,
  deleteMyReview,
} = require("../controllers/reviewController");

router.get("/", getReviews);
router.post("/", protect, submitReview);

// The caller's own review — scoped to the authenticated account, so these can
// never read, edit or delete somebody else's review.
router.get("/mine", protect, getMyReview);
router.put("/mine", protect, updateMyReview);
router.delete("/mine", protect, deleteMyReview);

module.exports = router;

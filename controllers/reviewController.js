const Review = require("../models/reviewModel");
const { ensureReviewIndexes } = require("../models/reviewModel");

const ROLES = ["donor", "seeker", "hospital"];

// Pulls and validates the editable review fields. Returns { error } or { value }.
function parseReviewBody(body = {}, { partial = false } = {}) {
  const value = {};

  if (body.rating !== undefined || !partial) {
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { error: "Please choose a rating from 1 to 5." };
    }
    value.rating = rating;
  }

  if (body.comment !== undefined || !partial) {
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!comment) return { error: "Please add a rating and a comment." };
    if (comment.length > 500) return { error: "Comment must be 500 characters or fewer." };
    value.comment = comment;
  }

  if (typeof body.city === "string") value.city = body.city.trim();
  if (ROLES.includes(body.role)) value.role = body.role;

  return { value };
}

const userIdOf = (req) => req.user.id || req.user._id;

// GET /reviews — public, feeds the guest-facing "What people are saying" section.
exports.getReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ isPublished: true }).sort({ createdAt: -1 }).limit(50);
    const count = reviews.length;
    const avgRating = count > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
    res.status(200).json({ success: true, reviews, avgRating: Number(avgRating.toFixed(1)), count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /reviews/mine — authenticated. The caller's own review (or null), whether or
// not it is currently in the public top-50 list, so the app can show the
// "Your Review" card instead of the posting form.
exports.getMyReview = async (req, res) => {
  try {
    const review = await Review.findOne({ userId: userIdOf(req) });
    res.status(200).json({ success: true, review: review || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /reviews — authenticated. Strictly one review per account: if the account
// already has one this is rejected with 409 (use PUT /reviews/mine to change it).
// The unique { userId } index makes this hold even when two requests race.
exports.submitReview = async (req, res) => {
  try {
    const userId = userIdOf(req);
    const parsed = parseReviewBody(req.body);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    await ensureReviewIndexes();

    const existing = await Review.findOne({ userId });
    if (existing) {
      return res.status(409).json({
        success: false,
        code: "REVIEW_EXISTS",
        message: "You have already posted a review. You can edit or delete it instead.",
        review: existing,
      });
    }

    try {
      const review = await Review.create({
        userId,
        name: req.user.name,
        city: "",
        role: "donor",
        ...parsed.value,
      });
      return res.status(201).json({ success: true, review });
    } catch (err) {
      // Lost a race against a parallel create from the same account.
      if (err && err.code === 11000) {
        const review = await Review.findOne({ userId });
        return res.status(409).json({
          success: false,
          code: "REVIEW_EXISTS",
          message: "You have already posted a review. You can edit or delete it instead.",
          review,
        });
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /reviews/mine — authenticated. Edits the caller's own review in place
// (never creates a record, never touches anyone else's).
exports.updateMyReview = async (req, res) => {
  try {
    const parsed = parseReviewBody(req.body, { partial: true });
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    if (Object.keys(parsed.value).length === 0) {
      return res.status(400).json({ success: false, message: "Nothing to update." });
    }

    const review = await Review.findOneAndUpdate(
      { userId: userIdOf(req) },
      { $set: parsed.value },
      { new: true, runValidators: true }
    );
    if (!review) {
      return res.status(404).json({ success: false, message: "You haven't posted a review yet." });
    }
    res.status(200).json({ success: true, review });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /reviews/mine — authenticated. Removes only the caller's own review.
exports.deleteMyReview = async (req, res) => {
  try {
    const result = await Review.deleteOne({ userId: userIdOf(req) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "You haven't posted a review yet." });
    }
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

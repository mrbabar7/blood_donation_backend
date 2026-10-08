const mongoose = require("mongoose");

// Powers PDF screen 36 (Reviews & Ratings) — real, user-submitted testimonials
// shown on the guest home / trust section, not hardcoded marketing copy.
//
// One review per account: the review is platform-level (there is no per-target
// field on this model), so the account's userId is the uniqueness key. The
// unique index below is the source of truth that makes that rule hold even when
// two create requests race each other.
//
// autoIndex is off for this schema on purpose: existing deployments already have
// a NON-unique `userId_1` index, and asking Mongo to turn it unique in place
// fails with an index-options conflict. `ensureReviewIndexes()` (below) cleans up
// any legacy duplicates and then syncs the indexes safely, once, on first use.
const reviewSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    city: { type: String, default: "" },
    role: { type: String, enum: ["donor", "seeker", "hospital"], default: "donor" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true, maxlength: 500 },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true, autoIndex: false }
);

reviewSchema.index({ isPublished: 1, createdAt: -1 });
reviewSchema.index({ userId: 1 }, { unique: true });

const Review = mongoose.model("Review", reviewSchema);

// Removes legacy duplicate reviews (keeps each account's most recently updated
// one), then syncs indexes so the unique { userId } index exists. Memoised, and
// retried on the next call if it fails, so a transient DB hiccup never leaves the
// app permanently without the guarantee.
let indexPromise = null;
function ensureReviewIndexes() {
  if (!indexPromise) {
    indexPromise = (async () => {
      const dupes = await Review.aggregate([
        { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
        { $group: { _id: "$userId", ids: { $push: "$_id" }, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
      ]);
      for (const g of dupes) {
        await Review.deleteMany({ _id: { $in: g.ids.slice(1) } });
      }
      await Review.syncIndexes();
    })().catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

module.exports = Review;
module.exports.ensureReviewIndexes = ensureReviewIndexes;

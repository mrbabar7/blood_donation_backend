const express = require("express");
const router = express.Router();
const {
  sendBloodRequest,
} = require("../controllers/seekerController/sendBloodRequest");
const { protect, optionalProtect } = require("../middlewares/authMiddleware");
const {
  cancelRequest,
} = require("../controllers/seekerController/cancelBloodRequest");
const {
  searchDonors,
} = require("../controllers/seekerController/seekerSearchDonor");
const {
  showLandingPageDonors,
} = require("../controllers/seekerController/showLandingPageDonors");
const {
  getNearbyDonors,
} = require("../controllers/seekerController/nearbyDonors");
const {
  getDonorDetailsForSeeker,
} = require("../controllers/seekerController/getDonorDetailsForSeeker");
const {
  completeDonation,
} = require("../controllers/seekerController/completeDonation");
const {
  getMyRequests,
} = require("../controllers/seekerController/getMyRequests");
const {
  deleteRejectedRequests,
} = require("../controllers/seekerController/deleteRejectedRequests");
const {
  deleteSingleRequest,
  clearRequestHistory,
} = require("../controllers/seekerController/requestManagement");
const lifecycleController = require("../controllers/lifecycleController");
const {
  subscribeToAvailability,
  unsubscribeFromAvailability,
} = require("../controllers/seekerController/donorAvailabilitySubscription");
const { rateLimit } = require("../middlewares/rateLimitMiddleware");
router.post("/send-request/:donorId", protect, sendBloodRequest);
router.post("/donors/:donorId/notify-available", protect, rateLimit({ windowMs: 60000, max: 30 }), subscribeToAvailability);
router.delete("/donors/:donorId/notify-available", protect, unsubscribeFromAvailability);
router.delete("/cancel-request/:donorId", protect, cancelRequest);
router.get("/search", protect, searchDonors);
router.get("/nearby-donors", protect, getNearbyDonors);
router.get("/hero/search", optionalProtect, showLandingPageDonors);
router.get("/details/:donorId", protect, getDonorDetailsForSeeker);
router.post("/complete", protect, completeDonation);
router.get("/my-requests", protect, getMyRequests);
router.delete("/delete-rejected", protect, deleteRejectedRequests);
router.delete("/delete-request/:requestId", protect, deleteSingleRequest);
router.delete("/clear-history/:status", protect, clearRequestHistory);
// Donation lifecycle (seeker side). Per-request actions are rate limited as a backstop to
// the app's per-request double-tap lock; the server state machine is what makes them safe.
const lifecycleLimit = rateLimit({ windowMs: 60000, max: 60 });
router.post("/requests/:requestId/lock", protect, lifecycleLimit, lifecycleController.lockDonor);
router.post("/requests/:requestId/release", protect, lifecycleLimit, lifecycleController.releaseDonor);
router.post("/requests/:requestId/agree", protect, lifecycleLimit, lifecycleController.agreeToDonation);
router.post("/requests/:requestId/disagree", protect, lifecycleLimit, lifecycleController.disagreeToDonation);
router.post("/requests/:requestId/report", protect, lifecycleLimit, lifecycleController.reportDonor);
router.get("/renotify-released", protect, lifecycleController.getRenotifyReleased);
router.post("/renotify-released", protect, lifecycleLimit, lifecycleController.renotifyReleased);
module.exports = router;

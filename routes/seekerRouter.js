const express = require("express");
const router = express.Router();
const {
  sendBloodRequest,
} = require("../controllers/seekerController/sendBloodRequest");
const { protect, optionalProtect } = require("../middlewares/authMiddleware");
const {
  cancelRequest,
  cancelBroadcast,
} = require("../controllers/seekerController/cancelBloodRequest");
const {
  searchDonors,
} = require("../controllers/seekerController/seekerSearchDonor");
const {
  showLandingPageDonors,
} = require("../controllers/seekerController/showLandingPageDonors");
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
const { postRequest, estimateDonors } = require("../controllers/seekerController/postRequest");
const {
  getBroadcastStatus,
} = require("../controllers/seekerController/getBroadcastStatus");
const {
  getMyBroadcasts,
} = require("../controllers/seekerController/getMyBroadcasts");
router.post("/send-request/:donorId", protect, sendBloodRequest);
router.post("/post-request", protect, postRequest);
router.get("/estimate-donors", protect, estimateDonors);
router.get("/broadcast/:id", protect, getBroadcastStatus);
router.get("/my-broadcasts", protect, getMyBroadcasts);
router.delete("/cancel-request/:donorId", protect, cancelRequest);
router.delete("/cancel-broadcast/:broadcastId", protect, cancelBroadcast);
router.get("/search", protect, searchDonors);
router.get("/hero/search", optionalProtect, showLandingPageDonors);
router.get("/details/:donorId", protect, getDonorDetailsForSeeker);
router.post("/complete", protect, completeDonation);
router.get("/my-requests", protect, getMyRequests);
router.delete("/delete-rejected", protect, deleteRejectedRequests);
router.delete("/delete-request/:requestId", protect, deleteSingleRequest);
router.delete("/clear-history/:status", protect, clearRequestHistory);
module.exports = router;

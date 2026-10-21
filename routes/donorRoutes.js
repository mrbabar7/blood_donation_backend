const express = require("express");
const router = express.Router();
const { protect, optionalProtect } = require("../middlewares/authMiddleware");
const lifecycleController = require("../controllers/lifecycleController");
const { verifyDonorCard } = require("../controllers/donorController/verifyDonorCard");

const {
  deleteProfile,
} = require("../controllers/donorController/deleteProfile");
const {
  checkDonorProfileRegister,
} = require("../controllers/donorController/checkDonorProfileRegister");
const {
  registerAsDonor,
} = require("../controllers/donorController/registerAsDonor");
const {
  updateDonorProfile,
} = require("../controllers/donorController/updateDonorProfile");
const {
  urgentBloodRequest,
} = require("../controllers/donorController/urgentBloodRequest");
const {
  acceptRequest,
} = require("../controllers/donorController/acceptBloodRequest");
const {
  markDonated,
} = require("../controllers/donorController/markDonated");
const {
  rejectRequest,
} = require("../controllers/donorController/rejectBloodRequest");
const {
  respondFromEmail,
} = require("../controllers/donorController/donorEmailResponce");
const changePassword = require("../controllers/donorController/changePassword");
const {
  getNotifications,
  markReadByRequest,
  markAsRead,
} = require("../controllers/notificationController");
const {
  getRequestContext,
} = require("../controllers/donorController/getRequestContext");
const {
  deleteAccount,
} = require("../controllers/donor&seekerController/deleteAccount");
const {
  deleteNotification,
  deleteManyNotifications,
} = require("../controllers/donor&seekerController/deleteNotification");

router.delete("/delete-profile", protect, deleteProfile);
router.put("/change-password", protect, changePassword);
router.delete("/delete-account", protect, deleteAccount);
router.get("/status", protect, checkDonorProfileRegister);
router.post("/register", protect, registerAsDonor);
router.put("/update-profile", protect, updateDonorProfile);
router.get("/my-requests", protect, urgentBloodRequest);
router.put("/accept/:requestId", protect, acceptRequest);
// Donor confirms they physically gave the blood — starts the seeker's 3-day
// confirmation window (see markDonated.js / services/chatCleanupCron.js).
router.put("/mark-donated/:requestId", protect, markDonated);
router.put("/reject/:requestId", protect, rejectRequest);
router.put("/start-donation/:requestId", protect, lifecycleController.startDonation);
router.put("/cannot-donate/:requestId", protect, lifecycleController.cannotDonate);
router.get("/respond-email/:requestId/:action", respondFromEmail);
router.get("/notifications/get-all", protect, getNotifications);
router.delete("/notifications/:id/delete", protect, deleteNotification);
// Selection-mode bulk delete (body: { ids: string[] }).
router.post("/notifications/delete-many", protect, deleteManyNotifications);
router.post("/notifications/:id/read", protect, markAsRead);
// Opening / acting on a request clears the notifications about it (idempotent).
router.post("/notifications/by-request/:requestId/read", protect, markReadByRequest);
// Authoritative, access-checked request lookup used by notification deep links.
router.get("/requests/:requestId/context", protect, getRequestContext);

router.get("/verify/:donorId", verifyDonorCard);

module.exports = router;

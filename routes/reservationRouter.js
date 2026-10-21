const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const c = require("../controllers/reservationController");

router.post("/", protect, c.createReservation);
router.get("/mine", protect, c.myReservations);
router.put("/:id/cancel", protect, c.cancelReservation);
router.get("/incoming", protect, c.incomingReservations);
router.put("/:id/respond", protect, c.respondToReservation);

module.exports = router;

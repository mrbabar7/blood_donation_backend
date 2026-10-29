// const express = require("express");
// const router = express.Router();
// const { protect } = require("../middlewares/authMiddleware");
// const {
//   getCallHistory,
//   deleteCall,
//   clearCallHistory,
//   getCallState,
//   getIceConfig,
//   acceptCallRest,
//   declineCallRest,
//   tick,
// } = require("../controllers/callController");

// router.all("/internal/tick", tick);
// router.get("/history", protect, getCallHistory);
// // Per-user, time-limited TURN credentials (replaces a static credential shipped in the app).
// router.get("/ice-config", protect, getIceConfig);
// // Authoritative call state for push/notification handling (see callController).
// router.get("/:id/state", protect, getCallState);
// router.post("/:id/accept", protect, acceptCallRest);
// router.post("/:id/decline", protect, declineCallRest);
// router.delete("/", protect, clearCallHistory);
// router.delete("/:id", protect, deleteCall);

// module.exports = router;

const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const {
  getCallHistory,
  deleteCall,
  clearCallHistory,
  getCallState,
  getIceConfig,
  acceptCallRest,
  declineCallRest,
  ringAckCall,
  tick,
} = require("../controllers/callController");

router.all("/internal/tick", tick);
router.get("/history", protect, getCallHistory);
// Per-user, time-limited TURN credentials (replaces a static credential shipped in the app).
router.get("/ice-config", protect, getIceConfig);
// Authoritative call state for push/notification handling (see callController).
router.get("/:id/state", protect, getCallState);
router.post("/:id/accept", protect, acceptCallRest);
router.post("/:id/decline", protect, declineCallRest);
router.post("/:id/ring-ack", protect, ringAckCall);
router.delete("/", protect, clearCallHistory);
router.delete("/:id", protect, deleteCall);

module.exports = router;

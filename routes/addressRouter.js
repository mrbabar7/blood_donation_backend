const express = require("express");
const addressRouter = express.Router();

// Import auth middleware (adjust relative path as needed)
const { protect } = require("../middlewares/authMiddleware");

const {
  addAddress,
  getUserAddresses,
  setPrimaryAddress,
  updateAddress,
  deleteAddress,
  getPrimaryAddress,
} = require("../controllers/authController/addressController");

// Apply auth protection to all routes
addressRouter.use(protect);

addressRouter.post("/", addAddress);
addressRouter.get("/", getUserAddresses);
addressRouter.get("/primary", getPrimaryAddress);
addressRouter.put("/:id", updateAddress);
addressRouter.put("/:id/primary", setPrimaryAddress);
addressRouter.delete("/:id", deleteAddress);

module.exports = addressRouter;

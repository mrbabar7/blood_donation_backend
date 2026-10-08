const express = require("express");
const router = express.Router();
const Provider = require("../../models/providerModel");

router.post("/register", async (req, res) => {
  try {
    const newProvider = new Provider(req.body);
    await newProvider.save();
    res
      .status(201)
      .json({ message: "Registration successful!", data: newProvider });
  } catch (error) {
    res
      .status(400)
      .json({ message: "Error saving data", error: error.message });
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");

const {
  registerNGO,
  getNGOByEmail,
  updateNGO,
  deleteNGO,
} = require("../controllers/emergency/ngo");
const {
  registerHospital,
  updateHospital,
  deleteHospital,
  getHospitalByEmail,
} = require("../controllers/emergency/hospital");
const {
  registerAmbulance,
  getAmbulanceData,
  updateAmbulance,
  deleteAmbulance,
} = require("../controllers/emergency/ambulance");
const {
  registerBank,
  getBankByEmail,
  updateBank,
  deleteBank,
} = require("../controllers/emergency/bank");

const { getNgo } = require("../controllers/emergency/NgoDiscovery");
const { getHospitals } = require("../controllers/emergency/HospitalDiscovery");
const {
  getBloodBanks,
} = require("../controllers/emergency/BloodBankDiscovery");
const { getAmbulances } = require("../controllers/emergency/AmbulanceDiscover");

// NGO ROUTES
router.post("/ngo-register", protect, registerNGO);
router.get("/get-ngo-data", protect, getNGOByEmail);
router.put("/update-ngo/:id", protect, updateNGO);
router.delete("/delete-ngo/:id", protect, deleteNGO);

// HOSPITAL ROUTES
router.post("/emergency-register", protect, registerHospital);
router.get("/get-hospital-data", protect, getHospitalByEmail);
router.put("/update-hospital/:id", protect, updateHospital);
router.delete("/delete-hospital/:id", protect, deleteHospital);

// BLOODBANK ROUTES
router.post("/bloodbank-register", protect, registerBank);
router.get("/get-bloodbank-data", protect, getBankByEmail);
router.put("/update-bloodbank/:id", protect, updateBank);
router.delete("/delete-bloodbank/:id", protect, deleteBank);

//AMBUALNCE ROUTES
router.post("/ambulance-register", protect, registerAmbulance);
router.get("/get-ambulance-data", protect, getAmbulanceData);
router.put("/update-ambulance/:id", protect, updateAmbulance);
router.delete("/delete-ambulance/:id", protect, deleteAmbulance);
// DISCOVERY ROUTES (Public)
router.get("/ngos", getNgo);
router.get("/hospitals", getHospitals);
router.get("/bloodbanks", getBloodBanks);
router.get("/ambulances", getAmbulances);
module.exports = router;

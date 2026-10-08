const AmbulanceModel = require("../../models/ambulanceModel");
const { emitToRoom } = require("../../services/socketService");
const { resolveImageField, deleteStoredImage, ImageUploadError } = require("../../utils/imageUpload");

// 1. REGISTER AMBULANCE
const registerAmbulance = async (req, res) => {
  try {
    // req.body.image previously landed in the DB as a raw base64 string
    // (spread straight in below) — now decoded to disk under
    // public/images/ambulance instead, same as the other directory types.
    const { image, ...rest } = req.body;
    const savedImageUrl = (await resolveImageField(image, null, "ambulance")) || "";

    const newEntry = new AmbulanceModel({
      ...rest,
      image: savedImageUrl,
      user: req.user.id,
    });

    await newEntry.save();
    res.status(201).json({ success: true, data: newEntry });
  } catch (error) {
    if (error instanceof ImageUploadError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET ALL AMBULANCES FOR LOGGED-IN USER
const getAmbulanceData = async (req, res) => {
  try {
    // Returns ALL ambulance records created by the user (newest first)
    const data = await AmbulanceModel.find({ user: req.user.id }).sort({
      createdAt: -1,
    });

    if (!data || data.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No records found" });
    }

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. GET SINGLE AMBULANCE BY ID
const getAmbulanceById = async (req, res) => {
  try {
    const ambulance = await AmbulanceModel.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!ambulance) {
      return res
        .status(404)
        .json({ success: false, message: "Ambulance not found" });
    }

    res.json({ success: true, data: ambulance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. UPDATE AMBULANCE
const updateAmbulance = async (req, res) => {
  try {
    const id = req.params.id;

    const existing = await AmbulanceModel.findOne({ _id: id, user: req.user.id });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Record not found or unauthorized" });
    }

    const updateBody = { ...req.body };
    // Only touches the field when the app actually sent a new photo (a fresh
    // base64 data URI) or an explicit clear — otherwise leaves it untouched
    // (also covers the location-only PUTs, which never send `image`).
    const resolvedImage = await resolveImageField(req.body.image, existing.image, "ambulance");
    if (resolvedImage !== undefined) updateBody.image = resolvedImage;
    else delete updateBody.image;

    const updated = await AmbulanceModel.findByIdAndUpdate(existing._id, { $set: updateBody }, {
      new: true,
      runValidators: true,
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof ImageUploadError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. DELETE AMBULANCE
const deleteAmbulance = async (req, res) => {
  try {
    const ambulance = await AmbulanceModel.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!ambulance) {
      return res
        .status(404)
        .json({ success: false, message: "Record not found or unauthorized" });
    }

    if (ambulance.image) {
      await deleteStoredImage(ambulance.image);
    }

    res.json({ success: true, message: "Deleted Successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. UPDATE LIVE LOCATION (PDF screen 34) — only the ambulance's registering
// user can push updates, e.g. while riding along on a dispatch with the app open.
const updateAmbulanceLocation = async (req, res) => {
  try {
    const { latitude, longitude, trackingStatus } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: "latitude and longitude are required." });
    }

    const updated = await AmbulanceModel.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      {
        $set: {
          currentLocation: { latitude, longitude, updatedAt: new Date() },
          ...(trackingStatus ? { trackingStatus } : {}),
        },
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Ambulance not found or unauthorized" });
    }

    emitToRoom(`ambulance_${updated._id}`, "ambulance:location", {
      ambulanceId: updated._id,
      currentLocation: updated.currentLocation,
      trackingStatus: updated.trackingStatus,
    });

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 7. PUBLIC TRACKING READ — anyone with the ambulance's ID can view its live status,
// same as tapping "Track" from the public directory (no login required).
const getAmbulanceTracking = async (req, res) => {
  try {
    const ambulance = await AmbulanceModel.findById(req.params.id).select(
      "name phone trackingStatus currentLocation"
    );
    if (!ambulance) {
      return res.status(404).json({ success: false, message: "Ambulance not found" });
    }
    res.status(200).json({ success: true, data: ambulance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  registerAmbulance,
  getAmbulanceData,
  getAmbulanceById,
  updateAmbulance,
  deleteAmbulance,
  updateAmbulanceLocation,
  getAmbulanceTracking,
};

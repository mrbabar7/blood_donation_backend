const AmbulanceModel = require("../../models/ambulanceModel");
const { resolveImageField, deleteStoredImage, ImageUploadError } = require("../../utils/imageUpload");
const { ORG_TYPES, validateDirectoryInput, errorMessage, pick } = require("../../utils/directoryValidation");

// Fields an owner may write on create/update. Anything else in the body (isVerified, user,
// formType, the removed whatsapp field and the removed live-tracking fields) is ignored.
const WRITABLE = ["name", "orgType", "timing", "startTime", "endTime", "operatingDays", "image", "open24h", "openMinutes", "closeMinutes"];

const sendInvalid = (res, errors) =>
  res.status(400).json({ success: false, message: errorMessage(errors), errors });

// 1. REGISTER AMBULANCE
const registerAmbulance = async (req, res) => {
  try {
    // Phone (required), website (optional), categories and the normalized
    // Province + City + Full Address (+ coordinates) — see utils/directoryValidation.js.
    const check = validateDirectoryInput(req.body);
    if (!check.ok) return sendInvalid(res, check.errors);

    // The photo is decoded to disk under public/images/ambulance, same as the
    // other directory types.
    const { image, ...rest } = pick(req.body, WRITABLE);
    const savedImageUrl = (await resolveImageField(image, null, "ambulance")) || "";

    const newEntry = new AmbulanceModel({
      ...rest,
      ...check.clean,
      image: savedImageUrl,
      user: req.user.id,
      formType: ORG_TYPES.ambulance,
    });

    await newEntry.save();
    res.status(201).json({ success: true, data: newEntry });
  } catch (error) {
    if (error instanceof ImageUploadError || error.name === "ValidationError") {
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

    // Same validation as create, but only for the field groups actually sent.
    const check = validateDirectoryInput(req.body, { isUpdate: true });
    if (!check.ok) return sendInvalid(res, check.errors);
    const updateBody = { ...pick(req.body, WRITABLE), ...check.clean };
    // Only touches the field when the app actually sent a new photo (a fresh
    // base64 data URI) or an explicit clear — otherwise leaves it untouched.
    const resolvedImage = await resolveImageField(req.body.image, existing.image, "ambulance");
    if (resolvedImage !== undefined) updateBody.image = resolvedImage;
    else delete updateBody.image;

    const updated = await AmbulanceModel.findByIdAndUpdate(existing._id, { $set: updateBody }, {
      new: true,
      runValidators: true,
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof ImageUploadError || error.name === "ValidationError") {
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

module.exports = {
  registerAmbulance,
  getAmbulanceData,
  getAmbulanceById,
  updateAmbulance,
  deleteAmbulance,
};

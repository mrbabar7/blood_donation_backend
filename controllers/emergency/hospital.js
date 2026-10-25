const Hospital = require("../../models/hospitalModel");
const { resolveImageField, deleteStoredImage, ImageUploadError } = require("../../utils/imageUpload");
const { ORG_TYPES, validateDirectoryInput, errorMessage, pick } = require("../../utils/directoryValidation");

// Fields an owner may write on create/update. Anything else in the body
// (isVerified, email, formType, the removed whatsapp field...) is ignored.
const WRITABLE = ["name", "orgType", "timing", "operatingDays", "image", "open24h", "openMinutes", "closeMinutes"];

const sendInvalid = (res, errors) =>
  res.status(400).json({ success: false, message: errorMessage(errors), errors });

exports.registerHospital = async (req, res) => {
  try {
    const email = req.user.email;
    const { name, timing, operatingDays, image, open24h, openMinutes, closeMinutes, orgType } = req.body;

    // Phone (required), website (optional), categories and the normalized
    // Province + City + Full Address (+ coordinates) — see utils/directoryValidation.js.
    const check = validateDirectoryInput(req.body);
    if (!check.ok) return sendInvalid(res, check.errors);
    const { phone, website, category, address, addressDetails, location } = check.clean;

    // Decodes the base64 photo (if any) to disk under public/images/hospital
    // and returns the URL to store — see utils/imageUpload.js.
    const savedImageUrl = (await resolveImageField(image, null, "hospital")) || "";

    // Create a new hospital entry for this user
    const newHospital = await Hospital.create({
      formType: ORG_TYPES.hospital,
      name,
      email,
      phone,
      orgType,
      timing: timing || "24/7 Service Available",
      category,
      website,
      address,
      addressDetails,
      operatingDays: Array.isArray(operatingDays)
        ? operatingDays
        : [operatingDays],
      image: savedImageUrl,
      ...(location ? { location } : {}),
      open24h,
      openMinutes,
      closeMinutes,
    });

    res.status(201).json({
      success: true,
      message: "Hospital registered successfully!",
      data: newHospital,
    });
  } catch (error) {
    console.error("Hospital Registration Error:", error);
    if (error instanceof ImageUploadError || error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({
      success: false,
      message: "Server error while registering hospital.",
      error: error.message,
    });
  }
};

/**
 * Get ALL hospitals registered by the currently logged-in user
 */
exports.getHospitalByEmail = async (req, res) => {
  try {
    const email = req.user.email;
    const hospitals = await Hospital.find({ email }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: hospitals.length,
      data: hospitals,
    });
  } catch (error) {
    console.error("Fetch User Hospitals Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch hospitals.",
      error: error.message,
    });
  }
};

/**
 * Update a specific hospital record by ID
 */
exports.updateHospital = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await Hospital.findOne({ _id: id, email: req.user.email });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Hospital record not found or unauthorized.",
      });
    }

    // Same validation as create, but only for the field groups actually sent.
    const check = validateDirectoryInput(req.body, { isUpdate: true });
    if (!check.ok) return sendInvalid(res, check.errors);
    const updateData = { ...pick(req.body, WRITABLE), ...check.clean };
    // Only touches the field when the app actually sent a new photo (a fresh
    // base64 data URI) or an explicit clear — otherwise leaves it untouched.
    const resolvedImage = await resolveImageField(req.body.image, existing.image, "hospital");
    if (resolvedImage !== undefined) updateData.image = resolvedImage;
    else delete updateData.image;

    const updatedHospital = await Hospital.findByIdAndUpdate(existing._id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "Hospital record updated successfully!",
      data: updatedHospital,
    });
  } catch (error) {
    console.error("Hospital Update Error:", error);
    if (error instanceof ImageUploadError || error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({
      success: false,
      message: "Update failed.",
      error: error.message,
    });
  }
};

/**
 * Delete a specific hospital record by ID
 */
exports.deleteHospital = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedHospital = await Hospital.findOneAndDelete({
      _id: id,
      email: req.user.email,
    });

    if (!deletedHospital) {
      return res.status(404).json({
        success: false,
        message: "Hospital record not found or unauthorized.",
      });
    }

    if (deletedHospital.image) {
      await deleteStoredImage(deletedHospital.image);
    }

    res.status(200).json({
      success: true,
      message: "Hospital record deleted successfully.",
    });
  } catch (error) {
    console.error("Hospital Delete Error:", error);
    res.status(500).json({
      success: false,
      message: "Delete operation failed.",
      error: error.message,
    });
  }
};

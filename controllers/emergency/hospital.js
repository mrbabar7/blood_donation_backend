const Hospital = require("../../models/hospitalModel");
const { resolveImageField, deleteStoredImage, ImageUploadError } = require("../../utils/imageUpload");

exports.registerHospital = async (req, res) => {
  try {
    const email = req.user.email;
    const {
      name,
      phone,
      orgType,
      timing,
      category,
      website,
      address,
      operatingDays,
      whatsapp,
      image,
      location,
      open24h,
      openMinutes,
      closeMinutes,
    } = req.body;

    // Check if WhatsApp number is used by ANOTHER user account
    const existingWithWhatsapp = await Hospital.findOne({ whatsapp });
    if (existingWithWhatsapp && existingWithWhatsapp.email !== email) {
      return res.status(400).json({
        success: false,
        message:
          "This WhatsApp number is already registered under a different account.",
      });
    }

    // Decodes the base64 photo (if any) to disk under public/images/hospital
    // and returns the URL to store — see utils/imageUpload.js.
    const savedImageUrl = (await resolveImageField(image, null, "hospital")) || "";

    // Create a new hospital entry for this user
    const newHospital = await Hospital.create({
      name,
      email,
      phone: phone || "",
      orgType,
      timing: timing || "24/7 Service Available",
      category: Array.isArray(category) ? category : [category],
      website: website || "",
      address,
      operatingDays: Array.isArray(operatingDays)
        ? operatingDays
        : [operatingDays],
      whatsapp,
      image: savedImageUrl,
      location,
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
    if (error instanceof ImageUploadError) {
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

    const updateData = { ...req.body };
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
    if (error instanceof ImageUploadError) {
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

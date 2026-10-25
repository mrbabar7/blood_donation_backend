const NGO = require("../../models/ngoModel");
const { resolveImageField, deleteStoredImage, ImageUploadError } = require("../../utils/imageUpload");
const {
  ORG_TYPES,
  NGO_ORG_SUBTYPES,
  validateDirectoryInput,
  errorMessage,
  pick,
} = require("../../utils/directoryValidation");

// Fields an owner may write on update. Anything else (isVerified, user, email, formType,
// archived*, the removed whatsapp field...) is ignored.
const WRITABLE = ["name", "timing", "operatingDays", "image", "open24h", "openMinutes", "closeMinutes"];

const sendInvalid = (res, errors) =>
  res.status(400).json({ success: false, message: errorMessage(errors), errors });

exports.registerNGO = async (req, res) => {
  try {
    const { name, timing, operatingDays, image, open24h, openMinutes, closeMinutes } = req.body;

    // Phone (required), website (optional), categories, the NGO sub-type and the
    // normalized Province + City + Full Address (+ coordinates).
    const check = validateDirectoryInput(req.body, { orgSubtypes: NGO_ORG_SUBTYPES });
    if (!check.ok) return sendInvalid(res, check.errors);
    const { phone, website, category, orgType, address, addressDetails, location } = check.clean;

    // Decodes the base64 photo (if any) to disk under public/images/ngo and
    // returns the URL to store — see utils/imageUpload.js.
    const savedImageUrl = (await resolveImageField(image, null, "ngo")) || "";

    const newNGO = new NGO({
      user: req.user.id,
      email: req.user.email,
      name,
      orgType,
      timing,
      operatingDays,
      category,
      website,
      address,
      addressDetails,
      phone,
      image: savedImageUrl,
      ...(location ? { location } : {}),
      open24h,
      openMinutes,
      closeMinutes,
      // The "Partner" type is retired: formType is fixed server-side and cannot be chosen.
      formType: ORG_TYPES.ngo,
    });

    await newNGO.save();

    res.status(201).json({
      success: true,
      message: "NGO Registered Successfully",
      data: newNGO,
    });
  } catch (error) {
    if (error instanceof ImageUploadError || error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// Fetch all NGOs registered by the authenticated user
exports.getNGOByEmail = async (req, res) => {
  try {
    // Archived legacy "Partner" records are hidden from My Listings (see ngoModel.js).
    const data = await NGO.find({
      $or: [{ user: req.user.id }, { email: req.user.email }],
      archived: { $ne: true },
    }).sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update a specific NGO facility owned by the user
exports.updateNGO = async (req, res) => {
  try {
    const existing = await NGO.findOne({
      _id: req.params.id,
      $or: [{ user: req.user.id }, { email: req.user.email }],
      archived: { $ne: true },
    });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "NGO record not found or unauthorized.",
      });
    }

    // Same validation as create, but only for the field groups actually sent.
    const check = validateDirectoryInput(req.body, { isUpdate: true, orgSubtypes: NGO_ORG_SUBTYPES });
    if (!check.ok) return sendInvalid(res, check.errors);
    const updateBody = { ...pick(req.body, WRITABLE), ...check.clean };
    // Only touches the field when the app actually sent a new photo (a fresh
    // base64 data URI) or an explicit clear — otherwise leaves it untouched.
    const resolvedImage = await resolveImageField(req.body.image, existing.image, "ngo");
    if (resolvedImage !== undefined) updateBody.image = resolvedImage;
    else delete updateBody.image;

    const updated = await NGO.findByIdAndUpdate(existing._id, { $set: updateBody }, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "NGO Profile Updated!",
      data: updated,
    });
  } catch (error) {
    if (error instanceof ImageUploadError || error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a specific NGO facility owned by the user
exports.deleteNGO = async (req, res) => {
  try {
    const deletedNGO = await NGO.findOneAndDelete({
      _id: req.params.id,
      $or: [{ user: req.user.id }, { email: req.user.email }],
    });

    if (!deletedNGO) {
      return res.status(404).json({
        success: false,
        message: "NGO record not found or unauthorized.",
      });
    }

    if (deletedNGO.image) {
      await deleteStoredImage(deletedNGO.image);
    }

    res.status(200).json({
      success: true,
      message: "NGO record deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

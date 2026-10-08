const BloodBankModel = require("../../models/bankModel");
const { resolveImageField, deleteStoredImage, ImageUploadError } = require("../../utils/imageUpload");

const registerBank = async (req, res) => {
  try {
    const {
      name,
      orgType,
      timing,
      phone,
      whatsapp,
      category,
      operatingDays,
      website,
      address,
      image,
      location,
      open24h,
      openMinutes,
      closeMinutes,
      formType = "bloodbank",
    } = req.body;

    // Decodes the base64 photo (if any) to disk under public/images/bloodbank
    // and returns the URL to store — see utils/imageUpload.js.
    const savedImageUrl = (await resolveImageField(image, null, "bloodbank")) || "";

    const newEntry = new BloodBankModel({
      user: req.user.id,
      name,
      orgType,
      timing,
      phone,
      whatsapp,
      category,
      operatingDays,
      website,
      address,
      image: savedImageUrl,
      location,
      open24h,
      openMinutes,
      closeMinutes,
      formType,
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

// Fetch all blood bank facilities registered by the authenticated user
const getBankByEmail = async (req, res) => {
  try {
    const type = req.query.type || "bloodbank";

    const data = await BloodBankModel.find({
      user: req.user.id,
      formType: type,
    }).sort({ createdAt: -1 });

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update a specific blood bank facility owned by the user
const updateBank = async (req, res) => {
  try {
    const existing = await BloodBankModel.findOne({ _id: req.params.id, user: req.user.id });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Blood bank record not found or unauthorized.",
      });
    }

    const updateBody = { ...req.body };
    // Only touches the field when the app actually sent a new photo (a fresh
    // base64 data URI) or an explicit clear — otherwise leaves it untouched.
    // (Also covers the stock-only PUT from manage-stock, which never sends `image`.)
    const resolvedImage = await resolveImageField(req.body.image, existing.image, "bloodbank");
    if (resolvedImage !== undefined) updateBody.image = resolvedImage;
    else delete updateBody.image;

    const updated = await BloodBankModel.findByIdAndUpdate(existing._id, { $set: updateBody }, {
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

// Delete a specific blood bank facility owned by the user
const deleteBank = async (req, res) => {
  try {
    const deleted = await BloodBankModel.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Blood bank record not found or unauthorized.",
      });
    }

    if (deleted.image) {
      await deleteStoredImage(deleted.image);
    }

    res.json({ success: true, message: "Blood bank deleted successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { registerBank, getBankByEmail, updateBank, deleteBank };

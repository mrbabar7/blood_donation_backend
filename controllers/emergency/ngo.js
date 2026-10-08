const NGO = require("../../models/ngoModel");
const { resolveImageField, deleteStoredImage, ImageUploadError } = require("../../utils/imageUpload");

exports.registerNGO = async (req, res) => {
  try {
    const {
      name,
      orgType,
      timing,
      operatingDays,
      whatsapp,
      category,
      website,
      address,
      phone,
      image,
      location,
      open24h,
      openMinutes,
      closeMinutes,
      formType = "ngo",
    } = req.body;

    // Decodes the base64 photo (if any) to disk under public/images/ngo and
    // returns the URL to store — see utils/imageUpload.js.
    const savedImageUrl = (await resolveImageField(image, null, "ngo")) || "";

    // Partners share the NGO collection/endpoints; only these two values are accepted.
    const safeFormType = formType === "partner" ? "partner" : "ngo";

    const newNGO = new NGO({
      user: req.user.id,
      email: req.user.email,
      name,
      orgType,
      timing,
      operatingDays,
      whatsapp,
      category,
      website,
      address,
      phone,
      image: savedImageUrl,
      location,
      open24h,
      openMinutes,
      closeMinutes,
      formType: safeFormType,
    });

    await newNGO.save();

    res.status(201).json({
      success: true,
      message: "NGO Registered Successfully",
      data: newNGO,
    });
  } catch (error) {
    if (error instanceof ImageUploadError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// Fetch all NGOs registered by the authenticated user
exports.getNGOByEmail = async (req, res) => {
  try {
    const data = await NGO.find({
      $or: [{ user: req.user.id }, { email: req.user.email }],
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
    });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "NGO record not found or unauthorized.",
      });
    }

    const updateBody = { ...req.body };
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
    if (error instanceof ImageUploadError) {
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

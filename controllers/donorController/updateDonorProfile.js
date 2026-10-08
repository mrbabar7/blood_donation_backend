const { Donor } = require("../../models/formModel");
const { localize } = require("../../utils/localizedMessages");

exports.updateDonorProfile = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const donor = await Donor.findOne({ userId });

    if (!donor) {
      return res
        .status(404)
        .json({ success: false, message: localize(req, "donorProfileNotFound") });
    }

    const updatedData = req.body;
    const today = new Date();
    const nextAvailable = donor.nextAvailableDate
      ? new Date(donor.nextAvailableDate)
      : null;

    // Prevent bypassing 90-day recovery lock
    if (nextAvailable && nextAvailable > today) {
      if (
        updatedData.isAvailable === true ||
        updatedData.isAvailable === "true"
      ) {
        return res.status(403).json({
          success: false,
          message: localize(req, "availabilityLocked90Days"),
        });
      }
    }

    Object.keys(updatedData).forEach((key) => {
      if (!["nextAvailableDate", "userId", "donorCode", "cardIssuedAt", "cardVerifiedAt"].includes(key)) {
        donor[key] = updatedData[key];
      }
    });

    await donor.save();

    res.status(200).json({
      success: true,
      message: localize(req, "profileUpdatedSuccess"),
      donor,
    });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

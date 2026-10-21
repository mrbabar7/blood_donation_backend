const { Donor, DonationRequest } = require("../../models/formModel");

const bell = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const donor = await Donor.findOne({ userId });

    if (!donor) {
      return res.json({ isDonor: false, count: 0, isAvailable: false });
    }

    const requestCount = await DonationRequest.countDocuments({
      donorId: donor._id,
      status: "pending",
    });

    res.json({
      success: true,
      isDonor: true,
      count: requestCount,
      isAvailable: donor.isAvailable,
      nextAvailableDate: donor.nextAvailableDate,
    });
  } catch (err) {
    console.error("Error in Bell Controller:", err);
    res.status(500).json({ isDonor: false, count: 0 });
  }
};

const updateSettings = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { field, value } = req.body;

    const allowedFields = ["isAvailable"];
    if (!allowedFields.includes(field)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid field update" });
    }

    const updatedDonor = await Donor.findOneAndUpdate(
      { userId },
      { [field]: value },
      { new: true },
    );

    if (!updatedDonor) {
      return res
        .status(404)
        .json({ success: false, message: "Donor record not found" });
    }

    res.json({
      success: true,
      message: "Settings updated successfully",
      donor: updatedDonor,
    });
  } catch (err) {
    console.error("Update Settings Error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { bell, updateSettings };

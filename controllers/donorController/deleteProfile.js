const { Donor } = require("../../models/formModel");
const userModel = require("../../models/userMode");

const deleteProfile = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await userModel.findById(userId);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    await Donor.findOneAndDelete({ userId });
    res.json({ success: true, message: "Donor profile deleted successfully" });
  } catch (err) {
    console.error("Delete Profile Error:", err);
    res
      .status(500)
      .json({ success: false, error: "Server error during deletion" });
  }
};

module.exports = { deleteProfile };

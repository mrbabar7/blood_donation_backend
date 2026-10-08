const bcrypt = require("bcrypt");
const Donor = require("../../models/userMode");
const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const donorId = req.user.id;

    const donor = await Donor.findById(donorId);
    if (!donor) {
      return res
        .status(404)
        .json({ success: false, message: "User nahi mila" });
    }

    const isMatch = await bcrypt.compare(oldPassword, donor.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({ success: false, message: "Purana password sahi nahi hai" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    donor.password = hashedPassword;
    await donor.save();

    res
      .status(200)
      .json({ success: true, message: "Password kamyabi se badal gaya" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = changePassword;

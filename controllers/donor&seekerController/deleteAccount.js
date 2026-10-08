const User = require("../../models/userMode");

const deleteAccount = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    console.log("deletion process", user);
    if (!user) return res.status(404).json({ message: "User not found!" });

    const { Donor } = require("../../models/formModel");
    await Donor.findOneAndDelete({ userId: userId });

    await User.findByIdAndDelete(userId);

    res.clearCookie("token");
    res.status(200).json({ success: true, message: "Account deleted." });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = { deleteAccount };

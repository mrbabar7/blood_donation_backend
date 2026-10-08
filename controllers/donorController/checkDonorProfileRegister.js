const { Donor } = require("../../models/formModel");

exports.checkDonorProfileRegister = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const donor = await Donor.findOne({ userId: userId });
    // Donors registered before the card existed get their code + issue date
    // the first time they are read (validateBeforeSave off: older documents
    // must never fail on unrelated fields).
    if (donor && (!donor.donorCode || !donor.cardIssuedAt)) {
      if (!donor.donorCode) donor.donorCode = await Donor.generateDonorCode(donor.district);
      if (!donor.cardIssuedAt) donor.cardIssuedAt = donor.createdAt || new Date();
      await donor.save({ validateBeforeSave: false });
    }
    res.status(200).json({ registered: !!donor, donor });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

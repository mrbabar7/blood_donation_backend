const { Donor } = require("../../models/formModel");
const { localize } = require("../../utils/localizedMessages");

exports.registerAsDonor = async (req, res) => {
  try {
    const userIdFromToken = req.user.id || req.user._id;
    const existingDonor = await Donor.findOne({ userId: userIdFromToken });

    if (existingDonor) {
      return res
        .status(400)
        .json({ success: false, message: localize(req, "alreadyRegisteredDonor") });
    }

    const { donorCode, cardIssuedAt, cardVerifiedAt, ...body } = req.body;
    const newDonor = new Donor({ ...body, userId: userIdFromToken });
    await newDonor.save();

    res
      .status(201)
      .json({
        success: true,
        message: localize(req, "donorProfileCreated"),
        donor: newDonor,
      });
  } catch (error) {
    console.error("Register Donor Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: localize(req, "errorRegisteringDonor"),
        error: error.message,
      });
  }
};

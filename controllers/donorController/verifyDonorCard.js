const { Donor } = require("../../models/formModel");

// GET /donors/verify/:donorId — what a partner blood bank hits when they scan a
// donor's QR digital donor card (PDF screen 32), for paperless check-in.
exports.verifyDonorCard = async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.donorId).select(
      "fullName bloodType district livesSaved isAvailable lastDonationDate donorCode cardIssuedAt cardVerifiedAt"
    );
    if (!donor) {
      return res.status(404).json({ success: false, message: "No donor found for this card." });
    }
    // A scan is a verification: remember when it last happened (shown on the card).
    Donor.updateOne({ _id: donor._id }, { $set: { cardVerifiedAt: new Date() } }).catch(() => {});
    res.status(200).json({ success: true, donor });
  } catch (error) {
    res.status(500).json({ success: false, message: "Invalid donor card", error: error.message });
  }
};

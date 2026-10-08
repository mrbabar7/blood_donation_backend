const { Donor, DonationRequest } = require("../../models/formModel");

exports.getDonorDetailsForSeeker = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const donor = await Donor.findById(req.params.donorId).populate(
      "userId",
      "isOnline lastSeen email",
    );

    if (!donor) {
      return res
        .status(404)
        .json({ success: false, message: "Donor not found" });
    }

    let activeRequest = await DonationRequest.findOne({
      seekerId,
      donorId: donor._id,
    }).sort({ createdAt: -1 });
    // Cancelled broadcast request -> profile shows the normal "Notify" state.
    if (activeRequest && activeRequest.status === "cancelled_by_seeker") activeRequest = null;

    const donorData = {
      ...donor.toObject(),
      isOnline: donor.userId ? donor.userId.isOnline : false,
      lastSeen: donor.userId ? donor.userId.lastSeen : null,
      requestStatus: activeRequest ? activeRequest.status : null,
      mobileNumber:
        activeRequest && activeRequest.status === "accepted"
          ? donor.mobileNumber
          : null,
    };

    res.status(200).json({ success: true, donor: donorData });
  } catch (error) {
    console.error("Get Donor Details Error:", error);
    res.status(500).json({ success: false, message: "Error fetching profile" });
  }
};

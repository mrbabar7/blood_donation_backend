const { Donor, DonationRequest } = require("../../models/formModel");

exports.urgentBloodRequest = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    // 1. Verify current user's donor profile
    const donor = await Donor.findOne({ userId });
    if (!donor) {
      return res
        .status(404)
        .json({ success: false, message: "Donor profile not found" });
    }

    // 2. Dynamic filtering based on query params
    const query = { donorId: donor._id };
    if (req.query.status && req.query.status !== "ALL") {
      query.status = req.query.status;
    }

    // 3. Fetch requests and populate seeker info
    const requests = await DonationRequest.find(query)
      .sort({ createdAt: -1 })
      .populate("seekerId", "email profilePicture");

    // 4. Format requests with seeker details
    const formattedRequests = requests.map((reqItem) => {
      const itemObj = reqItem.toObject();

      return {
        ...itemObj,
        seekerId: {
          _id: itemObj.seekerId?._id,
          fullName: itemObj.seekerName || "Blood Seeker",
          phone: itemObj.seekerPhone || "",
          email: itemObj.seekerId?.email || "",
          profilePicture: itemObj.seekerId?.profilePicture || "",
          location: itemObj.seekerLocation
            ? `${itemObj.seekerLocation.addressLine}, ${itemObj.seekerLocation.city}, ${itemObj.seekerLocation.province}`
            : "Location details unavailable",
          city: itemObj.seekerLocation?.city || "",
          province: itemObj.seekerLocation?.province || "",
          addressLine: itemObj.seekerLocation?.addressLine || "",
        },
      };
    });

    res
      .status(200)
      .json({
        success: true,
        count: formattedRequests.length,
        requests: formattedRequests,
      });
  } catch (error) {
    console.error("Donor Request Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error fetching requests",
        error: error.message,
      });
  }
};

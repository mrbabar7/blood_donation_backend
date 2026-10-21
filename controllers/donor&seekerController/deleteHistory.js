const { DonationRequest } = require("../../models/formModel");

exports.deleteHistory = async (req, res) => {
  try {
    const { requestId } = req.params;
    await DonationRequest.findByIdAndDelete(requestId);
    res.status(200).json({ success: true, message: "Record deleted" });
  } catch (error) {
    res.status(500).json({ message: "Delete failed" });
  }
};

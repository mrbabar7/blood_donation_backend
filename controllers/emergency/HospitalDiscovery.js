const { withDistance } = require("../../utils/geo");
const Hospital = require("../../models/hospitalModel");
// Public directory — must only show admin-verified listings. This used to
// return everything (find() with no filter), so a freshly-submitted,
// unreviewed org was visible to seekers immediately, ahead of the 24-48h
// verification the app promises and ahead of the admin verification queue
// ever seeing it.
const getHospitals = async (req, res) => {
  try {
    const hospitals = await Hospital.find({ isVerified: true }).sort({ createdAt: -1 }).lean();
    const items = withDistance(hospitals, req.query);
    res
      .status(200)
      .json({ success: true, count: items.length, data: items });
  } catch (err) {
    console.error("Error fetching hospitals:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = { getHospitals };

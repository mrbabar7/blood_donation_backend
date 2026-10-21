const { withDistance } = require("../../utils/geo");
const Ambulance = require("../../models/ambulanceModel");
const { cached } = require("../../utils/ttlCache");
// Same list for every user; a newly verified listing appears within a minute. Concurrent
// requests share one query (see utils/ttlCache.js).
const DIRECTORY_CACHE_MS = 60_000;


// Public directory — must only show admin-verified listings. This used to
// return everything (find() with no filter), so a freshly-submitted,
// unreviewed org was visible to seekers immediately, ahead of the 24-48h
// verification the app promises and ahead of the admin verification queue
// ever seeing it.
const getAmbulances = async (req, res) => {
  try {
    const ambulances = await cached("directory:ambulances", DIRECTORY_CACHE_MS, () => Ambulance.find({ isVerified: true }).sort({ createdAt: -1 }).lean());
    const items = withDistance(ambulances, req.query);

    res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  }
};

module.exports = { getAmbulances };

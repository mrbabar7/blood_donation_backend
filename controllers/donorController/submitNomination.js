const Nomination = require("../../models/nominationModel");

// POST /donors/nominate — authenticated. Max 5 nominations per person per day
// so the form can't be used to spam the review queue.
exports.submitNomination = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { donorName, donorContact, city, story } = req.body || {};

    if (!donorName || !String(donorName).trim() || !story || !String(story).trim()) {
      return res.status(400).json({ success: false, message: "Please add the donor's name and tell us how they helped." });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await Nomination.countDocuments({ userId, createdAt: { $gte: since } });
    if (recent >= 5) {
      return res.status(429).json({ success: false, message: "You've sent a few nominations today. Please try again tomorrow." });
    }

    const nomination = await Nomination.create({
      userId,
      nominatorName: req.user.name || "",
      donorName,
      donorContact: donorContact || "",
      city: city || "",
      story,
    });

    res.status(201).json({ success: true, nomination: { _id: nomination._id } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

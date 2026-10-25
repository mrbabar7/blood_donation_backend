const userModel = require("../../models/userMode");
const Block = require("../../models/blockModel");
const { Donor } = require("../../models/formModel");
const { readPrefs, readQuiet, DEFAULT_PREFS } = require("../../utils/notificationPrefs");

const shape = (user) => ({ notificationPrefs: readPrefs(user), quietHours: readQuiet(user) });

// GET /user/preferences
exports.getPreferences = async (req, res) => {
  try {
    const user = await userModel.findById(req.user.id || req.user._id).select("notificationPrefs quietHours");
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    res.status(200).json({ success: true, ...shape(user) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load preferences." });
  }
};

// PUT /user/preferences   { notificationPrefs?: {...}, quietHours?: {...} }
// Only known keys with valid values are written; anything else is ignored.
exports.updatePreferences = async (req, res) => {
  try {
    const $set = {};
    const prefs = req.body.notificationPrefs;
    if (prefs && typeof prefs === "object") {
      Object.keys(DEFAULT_PREFS).forEach((k) => {
        if (typeof prefs[k] === "boolean") $set[`notificationPrefs.${k}`] = prefs[k];
      });
    }
    const q = req.body.quietHours;
    if (q && typeof q === "object") {
      if (typeof q.enabled === "boolean") $set["quietHours.enabled"] = q.enabled;
      ["startHour", "endHour"].forEach((k) => {
        const v = Number(q[k]);
        if (Number.isInteger(v) && v >= 0 && v <= 23) $set[`quietHours.${k}`] = v;
      });
    }
    if (Object.keys($set).length === 0) {
      return res.status(400).json({ success: false, message: "Nothing to update." });
    }
    const user = await userModel
      .findByIdAndUpdate(req.user.id || req.user._id, { $set }, { new: true })
      .select("notificationPrefs quietHours");
    res.status(200).json({ success: true, ...shape(user) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to save preferences." });
  }
};

// GET /user/blocked — people I have blocked (with a display name).
exports.listBlocked = async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    const rows = await Block.find({ blockerId: me }).sort({ createdAt: -1 }).lean();
    const ids = rows.map((r) => r.blockedId);
    const [users, donors] = await Promise.all([
      userModel.find({ _id: { $in: ids } }).select("name profilePicture").lean(),
      Donor.find({ userId: { $in: ids } }).select("userId fullName bloodType district").lean(),
    ]);
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    const dMap = new Map(donors.map((d) => [String(d.userId), d]));
    const blocked = rows.map((r) => {
      const u = uMap.get(String(r.blockedId));
      const d = dMap.get(String(r.blockedId));
      return {
        userId: r.blockedId,
        name: (d && d.fullName) || (u && u.name) || "User",
        bloodType: d ? d.bloodType : null,
        city: d ? d.district : null,
        blockedAt: r.createdAt,
      };
    });
    res.status(200).json({ success: true, count: blocked.length, blocked });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load blocked users." });
  }
};

// POST /user/block/:userId
exports.blockUser = async (req, res) => {
  try {
    const me = String(req.user.id || req.user._id);
    const target = req.params.userId;
    if (!/^[a-f\d]{24}$/i.test(target)) return res.status(400).json({ success: false, message: "Invalid user." });
    if (target === me) return res.status(400).json({ success: false, message: "You can't block yourself." });
    if (!(await userModel.exists({ _id: target }))) return res.status(404).json({ success: false, message: "User not found." });
    await Block.updateOne({ blockerId: me, blockedId: target }, { $setOnInsert: { blockerId: me, blockedId: target } }, { upsert: true });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to block user." });
  }
};

// DELETE /user/block/:userId
exports.unblockUser = async (req, res) => {
  try {
    const me = req.user.id || req.user._id;
    await Block.deleteOne({ blockerId: me, blockedId: req.params.userId });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to unblock user." });
  }
};

const Region = require("../../models/regionModel");
const { Donor } = require("../../models/formModel");
const { writeAuditLog } = require("./auditLogController");

// GET /regions — PUBLIC. The mobile app's guided-search screen calls this instead
// of a hardcoded list, so adding a region here is live in the app immediately.
exports.getPublicRegions = async (req, res) => {
  try {
    const regions = await Region.find({ status: "active" }).sort({ province: 1 });
    res.status(200).json({ success: true, regions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /admin/regions — includes real donor-base counts per province for the
// admin table (PDF: "18,204 donors" etc.)
exports.getAdminRegions = async (req, res) => {
  try {
    const regions = await Region.find().sort({ province: 1 }).lean();
    const withCounts = await Promise.all(
      regions.map(async (r) => ({
        ...r,
        donorBase: await Donor.countDocuments({ province: new RegExp(`^${r.province}$`, "i") }),
      }))
    );
    res.status(200).json({ success: true, regions: withCounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createRegion = async (req, res) => {
  try {
    const { province, provinceUr, cities, citiesUr, status } = req.body;
    if (!province) return res.status(400).json({ success: false, message: "Province is required." });

    const region = await Region.create({
      province,
      provinceUr: provinceUr || "",
      cities: cities || [],
      citiesUr: citiesUr || [],
      status: status || "active",
    });
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Added region: ${province}`, category: "platform" });
    res.status(201).json({ success: true, region });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "That province already exists." });
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateRegion = async (req, res) => {
  try {
    const region = await Region.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!region) return res.status(404).json({ success: false, message: "Region not found." });
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Updated region: ${region.province}`, category: "platform" });
    res.status(200).json({ success: true, region });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteRegion = async (req, res) => {
  try {
    const region = await Region.findByIdAndDelete(req.params.id);
    if (!region) return res.status(404).json({ success: false, message: "Region not found." });
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Removed region: ${region.province}`, category: "platform" });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const Hospital = require("../../models/hospitalModel");
const BloodBank = require("../../models/bankModel");
const Ambulance = require("../../models/ambulanceModel");
const NGO = require("../../models/ngoModel");
const { writeAuditLog } = require("./auditLogController");

const MODELS = { hospitals: Hospital, bloodbanks: BloodBank, ambulances: Ambulance, ngos: NGO };

// Admin directory management bypasses the consumer routes' ownership check
// (routes/formRouter.js's updates are scoped to `user: req.user.id`) — an admin
// can manage any facility, not just ones they personally registered.
exports.listAll = async (req, res) => {
  try {
    const Model = MODELS[req.params.type];
    if (!Model) return res.status(400).json({ success: false, message: "Unknown directory type." });
    const { search } = req.query;
    const filter = search ? { name: new RegExp(search, "i") } : {};
    const docs = await Model.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: docs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateEntry = async (req, res) => {
  try {
    const Model = MODELS[req.params.type];
    if (!Model) return res.status(400).json({ success: false, message: "Unknown directory type." });
    const doc = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Updated ${req.params.type} entry: ${doc.name}`, category: "verification" });
    res.status(200).json({ success: true, data: doc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteEntry = async (req, res) => {
  try {
    const Model = MODELS[req.params.type];
    if (!Model) return res.status(400).json({ success: false, message: "Unknown directory type." });
    const doc = await Model.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Removed ${req.params.type} entry: ${doc.name}`, category: "verification" });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

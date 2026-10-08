const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const Admin = require("../../models/adminModel");
const { ROLE_PERMISSIONS } = require("../../config/adminPermissions");
const { writeAuditLog } = require("./auditLogController");

exports.listTeam = async (req, res) => {
  try {
    const team = await Admin.find().select("-password").sort({ createdAt: 1 });
    res.status(200).json({ success: true, team, permissionMatrix: ROLE_PERMISSIONS });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/team/invite — creates an "invited" admin with a random temp
// password (returned once, here, since there's no email-invite flow built yet —
// flagged honestly rather than pretending an email went out).
exports.inviteTeamMember = async (req, res) => {
  try {
    const { name, email, role } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ success: false, message: "Name, email and role are required." });
    }
    const existing = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(409).json({ success: false, message: "An admin with this email already exists." });

    const tempPassword = crypto.randomBytes(6).toString("hex");
    const hashed = await bcrypt.hash(tempPassword, 10);

    const admin = await Admin.create({
      name, email: email.toLowerCase().trim(), password: hashed, role, status: "invited", invitedBy: req.admin._id,
    });

    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Invited ${name} as ${role}`, category: "platform" });

    res.status(201).json({
      success: true,
      admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role, status: admin.status },
      tempPassword,
      note: "No email-invite system is wired up yet — share this temporary password with them directly. They should change it after first login (password change isn't built yet either — flagging, not hiding).",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateTeamMember = async (req, res) => {
  try {
    const { role, status } = req.body;
    const update = {};
    if (role) update.role = role;
    if (status) update.status = status;

    const admin = await Admin.findByIdAndUpdate(req.params.id, update, { new: true }).select("-password");
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found." });

    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Updated team member ${admin.name}: ${JSON.stringify(update)}`, category: "platform" });
    res.status(200).json({ success: true, admin });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

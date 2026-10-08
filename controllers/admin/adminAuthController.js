const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const JWT_SECRET = require("../../config/jwtSecret");
const Admin = require("../../models/adminModel");
const AdminSession = require("../../models/adminSessionModel");
const IpAllowlistEntry = require("../../models/ipAllowlistModel");
const PlatformSettings = require("../../models/platformSettingsModel");
const { cidrMatch } = require("../../utils/ipUtils");
const { generateSecret, verifyTOTP, buildOtpAuthUri } = require("../../utils/totp");
const { ROLE_PERMISSIONS } = require("../../config/adminPermissions");
const { writeAuditLog } = require("./auditLogController");

const signAdminToken = (admin, sessionId) =>
  jwt.sign({ adminId: admin._id, isAdmin: true, role: admin.role, sessionId }, JWT_SECRET, {
    expiresIn: "12h",
  });

// POST /admin/auth/bootstrap — creates the FIRST platform admin. Deliberately
// self-disabling: refuses once any admin account exists, so this can't be used to
// mint a rogue admin later. Run this once after deploying, then never again.
exports.bootstrapFirstAdmin = async (req, res) => {
  try {
    const existingCount = await Admin.countDocuments();
    if (existingCount > 0) {
      return res.status(403).json({
        success: false,
        message: "An admin account already exists. Bootstrap only works on a completely empty Admin collection.",
      });
    }

    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ success: false, message: "Name, email and an 8+ character password are required." });
    }

    const hashed = await bcrypt.hash(password, 10);
    const admin = await Admin.create({ name, email, password: hashed, role: "platform_admin", status: "active" });

    res.status(201).json({
      success: true,
      message: "First platform admin created. You can now log in.",
      admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email: email?.toLowerCase().trim() });

    if (!admin) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }
    if (admin.status !== "active") {
      return res.status(403).json({ success: false, message: "This admin account is not active yet. Ask a Platform Admin to activate it." });
    }

    const match = await bcrypt.compare(password, admin.password);
    if (!match) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    // Real IP allowlist enforcement — only active if a Platform Admin has both
    // turned it on in Settings AND added at least one range, so it can never
    // silently lock everyone out by existing-but-unconfigured.
    const settings = await PlatformSettings.findOne();
    if (settings?.restrictAdminIpAllowlist) {
      const ranges = await IpAllowlistEntry.find();
      const clientIp = req.ip || req.connection?.remoteAddress || "";
      if (ranges.length > 0 && !ranges.some((r) => cidrMatch(clientIp, r.cidr))) {
        await writeAuditLog({ actorId: admin._id, actorName: admin.name, action: `Blocked login from disallowed IP ${clientIp}`, category: "security" });
        return res.status(403).json({ success: false, message: "Sign-in blocked: your network isn't on the admin IP allowlist." });
      }
    }

    // Real 2FA (TOTP) enforcement — this toggle existed and was saved for a
    // long time with an explicit note that "no TOTP challenge is wired into
    // login yet." It's wired in now: an admin who has completed 2FA setup
    // (see setupTwoFactor/confirmTwoFactor below) MUST supply a valid code.
    // An admin who hasn't set it up yet can still log in even if
    // require2FAForAdmins is on globally — this can't retroactively force
    // enrollment without locking someone out of an account they haven't
    // configured yet; Settings/SecurityCenter surface who still needs to
    // enroll (see getSecurityOverview).
    const adminWithSecret = await Admin.findById(admin._id).select("+totpSecret");
    if (adminWithSecret.totpEnabled) {
      const { otpToken } = req.body;
      if (!otpToken) {
        return res.status(401).json({ success: false, requiresOtp: true, message: "Enter your 6-digit authenticator code." });
      }
      const valid = verifyTOTP(adminWithSecret.totpSecret, otpToken);
      if (!valid) {
        await writeAuditLog({ actorId: admin._id, actorName: admin.name, action: `Failed 2FA code`, category: "security" });
        return res.status(401).json({ success: false, requiresOtp: true, message: "That code is wrong or expired. Try the current one from your app." });
      }
    }

    admin.lastLoginAt = new Date();
    await admin.save();

    const session = await AdminSession.create({
      adminId: admin._id,
      adminName: admin.name,
      ipAddress: req.ip || req.connection?.remoteAddress || "",
      userAgent: req.headers["user-agent"] || "",
    });

    const token = signAdminToken(admin, session._id.toString());
    await writeAuditLog({ actorId: admin._id, actorName: admin.name, action: `Signed in`, category: "security" });

    res.status(200).json({
      success: true,
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions: ROLE_PERMISSIONS[admin.role] || [],
        totpEnabled: admin.totpEnabled,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMe = async (req, res) => {
  res.status(200).json({
    success: true,
    admin: {
      id: req.admin._id,
      name: req.admin.name,
      email: req.admin.email,
      role: req.admin.role,
      permissions: ROLE_PERMISSIONS[req.admin.role] || [],
      totpEnabled: req.admin.totpEnabled,
    },
  });
};

// POST /admin/auth/2fa/setup — generates a NEW secret and returns it as both
// the raw base32 (for manual entry) and an otpauth:// URI (for a QR code the
// frontend renders). Stored in totpTempSecret, not totpSecret — it isn't
// "live" (required at login) until confirmTwoFactor proves the admin can
// actually generate a matching code with it.
exports.setupTwoFactor = async (req, res) => {
  try {
    const secret = generateSecret();
    req.admin.totpTempSecret = secret;
    await req.admin.save();

    const otpauthUri = buildOtpAuthUri({ secret, accountName: req.admin.email, issuer: "BloodDonationAdmin" });
    res.status(200).json({ success: true, secret, otpauthUri });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/auth/2fa/confirm — proves the admin's authenticator app is
// actually producing matching codes before 2FA becomes required at login.
exports.confirmTwoFactor = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id).select("+totpTempSecret");
    if (!admin.totpTempSecret) {
      return res.status(400).json({ success: false, message: "Start setup first — no pending 2FA setup found." });
    }
    const { otpToken } = req.body;
    if (!verifyTOTP(admin.totpTempSecret, otpToken)) {
      return res.status(400).json({ success: false, message: "That code doesn't match. Double-check your authenticator app and try again." });
    }
    admin.totpSecret = admin.totpTempSecret;
    admin.totpTempSecret = null;
    admin.totpEnabled = true;
    await admin.save();
    await writeAuditLog({ actorId: admin._id, actorName: admin.name, action: `Enabled 2FA`, category: "security" });
    res.status(200).json({ success: true, message: "2FA is now required on this account's future logins." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/auth/2fa/disable — requires the current password again (not
// just an active session) since this lowers the account's security bar.
exports.disableTwoFactor = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id).select("+password");
    const { password } = req.body;
    const match = await bcrypt.compare(password || "", admin.password);
    if (!match) {
      return res.status(401).json({ success: false, message: "Incorrect password." });
    }
    admin.totpEnabled = false;
    admin.totpSecret = null;
    admin.totpTempSecret = null;
    await admin.save();
    await writeAuditLog({ actorId: admin._id, actorName: admin.name, action: `Disabled 2FA`, category: "security" });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

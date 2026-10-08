const jwt = require("jsonwebtoken");
const JWT_SECRET = require("../config/jwtSecret");
const Admin = require("../models/adminModel");
const AdminSession = require("../models/adminSessionModel");
const PlatformSettings = require("../models/platformSettingsModel");
const IpAllowlistEntry = require("../models/ipAllowlistModel");
const { roleHasPermission } = require("../config/adminPermissions");

// Minimal IPv4 CIDR match — no third-party dep, deliberately conservative:
// anything not a clean IPv4/CIDR match (IPv6, malformed input) is treated as
// "doesn't match" rather than throwing, so a bad entry can't 500 the login path.
function ipToInt(ip) {
  const parts = ip.trim().split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}
function ipMatchesCidr(ip, cidr) {
  const [range, bitsStr] = cidr.includes("/") ? cidr.split("/") : [cidr, "32"];
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  const bits = Number(bitsStr);
  if (ipInt === null || rangeInt === null || Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}
// Strip a leading "::ffff:" IPv4-mapped-IPv6 prefix (common behind proxies).
function normalizeIp(ip) {
  return (ip || "").replace(/^::ffff:/, "");
}

// Deliberately separate from middlewares/authMiddleware.js (consumer auth). Tokens
// here carry { adminId, isAdmin: true } and are verified against the Admin
// collection, not User — an admin token can never be reused as a consumer token
// or vice versa, even though both are signed with the same JWT_SECRET.
const protectAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : req.cookies?.adminToken;

    if (!token) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ success: false, message: "Not an admin token" });
    }

    const admin = await Admin.findById(decoded.adminId).select("-password");
    if (!admin || admin.status !== "active") {
      return res.status(401).json({ success: false, message: "Admin account not active" });
    }

    req.admin = admin;
    req.adminSessionId = decoded.sessionId || null;

    const settings = await PlatformSettings.findOne().select("restrictAdminIpAllowlist autoLockAdminSessionMinutes");

    // Idle-session auto-lock — autoLockAdminSessionMinutes was a real, saved
    // setting with no field in Settings.tsx and nothing checking it anywhere.
    // 0/unset = disabled (fail open). Tokens minted before this shipped have
    // no sessionId, so they're exempt until they re-login — never mid-air
    // logged out by a settings change alone.
    if (req.adminSessionId && settings?.autoLockAdminSessionMinutes) {
      const session = await AdminSession.findById(req.adminSessionId);
      if (session && !session.revoked) {
        const idleMinutes = (Date.now() - new Date(session.lastActivityAt).getTime()) / 60000;
        if (idleMinutes > settings.autoLockAdminSessionMinutes) {
          session.revoked = true;
          await session.save();
          return res.status(401).json({ success: false, message: "Session locked after inactivity — please sign in again." });
        }
        session.lastActivityAt = new Date();
        await session.save();
      } else if (session?.revoked) {
        return res.status(401).json({ success: false, message: "Session locked after inactivity — please sign in again." });
      }
    }

    // IP allowlist enforcement — settings + entries were real and saved
    // before this, but nothing ever checked them (SecurityCenter.tsx said so
    // explicitly). Fail open by design: only enforce when the toggle is on
    // AND there's at least one entry, so a misconfigured/empty list can never
    // lock every admin out of their own dashboard.
    if (settings?.restrictAdminIpAllowlist) {
      const entries = await IpAllowlistEntry.find().select("cidr");
      if (entries.length > 0) {
        const clientIp = normalizeIp(req.ip);
        const allowed = entries.some((e) => ipMatchesCidr(clientIp, e.cidr));
        if (!allowed) {
          return res.status(403).json({
            success: false,
            message: "Your network isn't on the admin IP allowlist. Contact a super-admin if this is unexpected.",
          });
        }
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired admin session" });
  }
};

// Server-side permission gate — the actual security boundary, not just a hidden
// sidebar link. Usage: requirePermission(PERMISSIONS.APPROVE_VERIFICATION)
const requirePermission = (permission) => (req, res, next) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: "Not authenticated" });
  }
  if (!roleHasPermission(req.admin.role, permission)) {
    return res.status(403).json({ success: false, message: "Your role doesn't have permission to do this." });
  }
  next();
};

module.exports = { protectAdmin, requirePermission };

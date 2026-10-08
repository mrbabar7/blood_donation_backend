const express = require("express");
const router = express.Router();
const { protectAdmin, requirePermission } = require("../middlewares/adminAuthMiddleware");
const { PERMISSIONS } = require("../config/adminPermissions");

const { bootstrapFirstAdmin, adminLogin, getMe, setupTwoFactor, confirmTwoFactor, disableTwoFactor } = require("../controllers/admin/adminAuthController");
const { getDashboard } = require("../controllers/admin/dashboardController");
const {
  listDonors, getDonorDetail, updateDonorControls, flagDonor, suspendDonor, reinstateDonor,
} = require("../controllers/admin/donorsController");
const { listRequests, getRequestDetail, rebroadcastRequest } = require("../controllers/admin/requestsController");
const { getVerificationQueue, approveVerification, rejectVerification } = require("../controllers/admin/verificationController");
const { getAdminRegions, createRegion, updateRegion, deleteRegion } = require("../controllers/admin/regionsController");
const { getAuditLog } = require("../controllers/admin/auditLogController");
const { listAll, updateEntry, deleteEntry } = require("../controllers/admin/directoriesController");
const { listConversations, getThread, reply, markResolved } = require("../controllers/admin/supportController");
const { getAnalytics } = require("../controllers/admin/analyticsController");
const { listBroadcasts, sendAnnouncement } = require("../controllers/admin/broadcastsController");
const { listPages, getPage, upsertPage } = require("../controllers/admin/cmsController");
const { listTeam, inviteTeamMember, updateTeamMember } = require("../controllers/admin/teamController");
const { getSettings, updateSettings } = require("../controllers/admin/settingsController");
const {
  getOverview, listPageMeta, upsertPageMeta, deletePageMeta, listRedirects, createRedirect, deleteRedirect,
} = require("../controllers/admin/seoController");
const { getSecurityOverview, addAllowlistEntry, removeAllowlistEntry } = require("../controllers/admin/securityController");
const { getPublicFlags, listFlags, upsertFlag, deleteFlag } = require("../controllers/admin/featureFlagsController");
const { getPrivacyOverview, logDataRequest, fulfillDataRequest } = require("../controllers/admin/privacyController");
const { getFraudOverview, mergeDonors } = require("../controllers/admin/fraudController");
const { getPlatformHealth, createIncident, resolveIncident } = require("../controllers/admin/platformHealthController");
const { listBackups, triggerBackup } = require("../controllers/admin/backupsController");
const {
  listAnnouncements, getAnnouncement, createAnnouncement, updateAnnouncement, toggleAnnouncement, deleteAnnouncement,
} = require("../controllers/admin/announcementsController");

// ---- Auth (unauthenticated) ----
router.post("/auth/bootstrap", bootstrapFirstAdmin);
router.post("/auth/login", adminLogin);

router.use(protectAdmin);

router.get("/auth/me", getMe);
router.post("/auth/2fa/setup", setupTwoFactor);
router.post("/auth/2fa/confirm", confirmTwoFactor);
router.post("/auth/2fa/disable", disableTwoFactor);
router.get("/dashboard", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), getDashboard);

// Donors
router.get("/donors", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), listDonors);
router.get("/donors/:id", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), getDonorDetail);
router.patch("/donors/:id/controls", requirePermission(PERMISSIONS.MANAGE_DONORS), updateDonorControls);
router.post("/donors/:id/flag", requirePermission(PERMISSIONS.MANAGE_DONORS), flagDonor);
router.post("/donors/:id/suspend", requirePermission(PERMISSIONS.MANAGE_DONORS), suspendDonor);
router.post("/donors/:id/reinstate", requirePermission(PERMISSIONS.MANAGE_DONORS), reinstateDonor);

// Requests
router.get("/requests", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), listRequests);
router.get("/requests/:id", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), getRequestDetail);
router.post("/requests/:id/rebroadcast", requirePermission(PERMISSIONS.SEND_BROADCASTS), rebroadcastRequest);

// Verification
router.get("/verification-queue", requirePermission(PERMISSIONS.APPROVE_VERIFICATION), getVerificationQueue);
router.post("/verification-queue/:type/:id/approve", requirePermission(PERMISSIONS.APPROVE_VERIFICATION), approveVerification);
router.post("/verification-queue/:type/:id/reject", requirePermission(PERMISSIONS.APPROVE_VERIFICATION), rejectVerification);

// Directory management (ongoing, all statuses — not just new submissions)
router.get("/directories/:type", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), listAll);
router.put("/directories/:type/:id", requirePermission(PERMISSIONS.MANAGE_DIRECTORIES), updateEntry);
router.delete("/directories/:type/:id", requirePermission(PERMISSIONS.MANAGE_DIRECTORIES), deleteEntry);

// Regions
router.get("/regions", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), getAdminRegions);
router.post("/regions", requirePermission(PERMISSIONS.MANAGE_REGIONS), createRegion);
router.put("/regions/:id", requirePermission(PERMISSIONS.MANAGE_REGIONS), updateRegion);
router.delete("/regions/:id", requirePermission(PERMISSIONS.MANAGE_REGIONS), deleteRegion);

// Support inbox
router.get("/support/conversations", requirePermission(PERMISSIONS.SUPPORT_INBOX), listConversations);
router.get("/support/conversations/:userId", requirePermission(PERMISSIONS.SUPPORT_INBOX), getThread);
router.post("/support/conversations/:userId/reply", requirePermission(PERMISSIONS.SUPPORT_INBOX), reply);
router.post("/support/conversations/:userId/resolve", requirePermission(PERMISSIONS.SUPPORT_INBOX), markResolved);

// Analytics
router.get("/analytics", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), getAnalytics);

// Broadcasts
router.get("/broadcasts", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), listBroadcasts);
router.post("/broadcasts/announcement", requirePermission(PERMISSIONS.SEND_BROADCASTS), sendAnnouncement);

// CMS
router.get("/cms/pages", requirePermission(PERMISSIONS.MANAGE_CONTENT), listPages);
router.get("/cms/pages/:slug", requirePermission(PERMISSIONS.MANAGE_CONTENT), getPage);
router.put("/cms/pages/:slug", requirePermission(PERMISSIONS.MANAGE_CONTENT), upsertPage);

// Team & roles
router.get("/team", requirePermission(PERMISSIONS.MANAGE_TEAM), listTeam);
router.post("/team/invite", requirePermission(PERMISSIONS.MANAGE_TEAM), inviteTeamMember);
router.patch("/team/:id", requirePermission(PERMISSIONS.MANAGE_TEAM), updateTeamMember);

// Settings
router.get("/settings", requirePermission(PERMISSIONS.EDIT_SETTINGS), getSettings);
router.put("/settings", requirePermission(PERMISSIONS.EDIT_SETTINGS), updateSettings);

// SEO
router.get("/seo/overview", requirePermission(PERMISSIONS.MANAGE_CONTENT), getOverview);
router.get("/seo/pages", requirePermission(PERMISSIONS.MANAGE_CONTENT), listPageMeta);
router.put("/seo/pages", requirePermission(PERMISSIONS.MANAGE_CONTENT), upsertPageMeta);
router.delete("/seo/pages/:id", requirePermission(PERMISSIONS.MANAGE_CONTENT), deletePageMeta);
router.get("/seo/redirects", requirePermission(PERMISSIONS.MANAGE_CONTENT), listRedirects);
router.post("/seo/redirects", requirePermission(PERMISSIONS.MANAGE_CONTENT), createRedirect);
router.delete("/seo/redirects/:id", requirePermission(PERMISSIONS.MANAGE_CONTENT), deleteRedirect);

// Security
router.get("/security", requirePermission(PERMISSIONS.MANAGE_SECURITY), getSecurityOverview);
router.post("/security/allowlist", requirePermission(PERMISSIONS.MANAGE_SECURITY), addAllowlistEntry);
router.delete("/security/allowlist/:id", requirePermission(PERMISSIONS.MANAGE_SECURITY), removeAllowlistEntry);

// Privacy & compliance
router.get("/privacy", requirePermission(PERMISSIONS.MANAGE_SECURITY), getPrivacyOverview);
router.post("/privacy/requests", requirePermission(PERMISSIONS.MANAGE_SECURITY), logDataRequest);
router.post("/privacy/requests/:id/fulfill", requirePermission(PERMISSIONS.MANAGE_SECURITY), fulfillDataRequest);

// Fraud & abuse
router.get("/fraud", requirePermission(PERMISSIONS.MANAGE_SECURITY), getFraudOverview);
router.post("/fraud/merge", requirePermission(PERMISSIONS.MANAGE_DONORS), mergeDonors);

// Platform health
router.get("/health", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), getPlatformHealth);
router.post("/health/incidents", requirePermission(PERMISSIONS.MANAGE_SECURITY), createIncident);
router.post("/health/incidents/:id/resolve", requirePermission(PERMISSIONS.MANAGE_SECURITY), resolveIncident);

// Backups
router.get("/backups", requirePermission(PERMISSIONS.MANAGE_SECURITY), listBackups);
router.post("/backups/trigger", requirePermission(PERMISSIONS.MANAGE_SECURITY), triggerBackup);

// Feature flags
router.get("/feature-flags", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), listFlags);
router.put("/feature-flags", requirePermission(PERMISSIONS.EDIT_SETTINGS), upsertFlag);
router.delete("/feature-flags/:id", requirePermission(PERMISSIONS.EDIT_SETTINGS), deleteFlag);

router.get("/audit-log", requirePermission(PERMISSIONS.VIEW_DONORS_REQUESTS), getAuditLog);

// Announcements / promo popups (mobile app's home-open popup). Reuses
// MANAGE_CONTENT — the same permission that already governs the CMS pages
// above — since this is content in the same sense, just time-boxed and
// pushed as a popup instead of a static page.
router.get("/announcements", requirePermission(PERMISSIONS.MANAGE_CONTENT), listAnnouncements);
router.get("/announcements/:id", requirePermission(PERMISSIONS.MANAGE_CONTENT), getAnnouncement);
router.post("/announcements", requirePermission(PERMISSIONS.MANAGE_CONTENT), createAnnouncement);
router.put("/announcements/:id", requirePermission(PERMISSIONS.MANAGE_CONTENT), updateAnnouncement);
router.patch("/announcements/:id/toggle", requirePermission(PERMISSIONS.MANAGE_CONTENT), toggleAnnouncement);
router.delete("/announcements/:id", requirePermission(PERMISSIONS.MANAGE_CONTENT), deleteAnnouncement);

module.exports = router;

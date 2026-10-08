// Single source of truth for the role-permission matrix shown on the Team & Roles
// screen — and, critically, enforced here server-side. The UI hiding a button is a
// convenience; this file is the actual security boundary (per the TODO's own
// "world-class practices" checklist).
const PERMISSIONS = {
  VIEW_DONORS_REQUESTS: "view_donors_requests",
  MANAGE_DONORS: "manage_donors", // suspend/flag/edit
  APPROVE_VERIFICATION: "approve_verification",
  SEND_BROADCASTS: "send_broadcasts",
  MANAGE_TEAM: "manage_team",
  EDIT_SETTINGS: "edit_settings",
  MANAGE_CONTENT: "manage_content",
  MANAGE_REGIONS: "manage_regions",
  SUPPORT_INBOX: "support_inbox",
  MANAGE_DIRECTORIES: "manage_directories",
  MANAGE_SECURITY: "manage_security",
};

const ROLE_PERMISSIONS = {
  platform_admin: Object.values(PERMISSIONS), // full access
  engineering_admin: [
    PERMISSIONS.VIEW_DONORS_REQUESTS,
    PERMISSIONS.EDIT_SETTINGS,
    PERMISSIONS.MANAGE_REGIONS,
    PERMISSIONS.MANAGE_SECURITY,
  ],
  medical_reviewer: [
    PERMISSIONS.VIEW_DONORS_REQUESTS,
    PERMISSIONS.APPROVE_VERIFICATION,
  ],
  support_agent: [
    PERMISSIONS.VIEW_DONORS_REQUESTS, // read-only by convention in controllers
    PERMISSIONS.SUPPORT_INBOX,
  ],
};

function roleHasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, roleHasPermission };

const mongoose = require("mongoose");

// Admin/staff accounts are deliberately separate from the consumer User model —
// dedicated credentials, own auth flow, own permission system (PDF: "dedicated
// sign-in, separate credentials from the consumer app").
const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["platform_admin", "engineering_admin", "medical_reviewer", "support_agent"],
      default: "support_agent",
    },
    status: { type: String, enum: ["active", "invited", "disabled"], default: "invited" },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    lastLoginAt: { type: Date, default: null },
    // 2FA (TOTP) — totpSecret is only set once the admin has verified a code
    // during setup; totpTempSecret holds an in-progress, unconfirmed setup so
    // a secret is never "live" (i.e. required at login) until proven to work.
    totpEnabled: { type: Boolean, default: false },
    totpSecret: { type: String, default: null, select: false },
    totpTempSecret: { type: String, default: null, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Admin", adminSchema);

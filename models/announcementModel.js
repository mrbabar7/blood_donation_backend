const mongoose = require("mongoose");

// Backend-driven in-app announcement / promo popup (the "JazzCash-style"
// promo modal shown on app open/foreground). Admins create/edit these from
// the admin dashboard's Content area; the mobile app fetches whatever is
// currently active via GET /announcements (alias: GET /announcements/active)
// and renders them without needing an app update to change copy, images, or
// the offer being promoted.
const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },

    // Hosted image (banner) for the popup. Optional — if omitted, the
    // mobile app falls back to rendering `icon` on a gradient banner
    // instead, so an announcement can go out with just a headline.
    imageUrl: { type: String, default: "" },
    // Emoji/icon fallback shown when there's no imageUrl.
    icon: { type: String, default: "🎉" },
    // Gradient the modal's banner renders when there's no imageUrl —
    // stored as two hex colors so the admin can theme each promo
    // (e.g. red for an urgent blood-drive push, teal for a routine tip).
    gradientFrom: { type: String, default: "#4F46E5" },
    gradientTo: { type: String, default: "#0EA5A4" },

    // What the CTA button does:
    // - "navigate": in-app route, e.g. "/directory/ambulances" — the app
    //   calls router.push(actionTarget).
    // - "link": external URL — the app opens it via Linking.openURL.
    // - "none": no CTA button is rendered, only the close icon.
    actionType: { type: String, enum: ["navigate", "link", "none"], default: "none" },
    // Screen path (for "navigate") or full URL (for "link"). Unused when
    // actionType is "none".
    actionTarget: { type: String, default: "" },
    // CTA button label, e.g. "Explore Ambulances", "Donate Now".
    actionText: { type: String, default: "" },

    // Who should see it. "all" shows regardless of the app's current
    // donor/seeker role toggle (see RoleContext on the client) — lets an
    // announcement target "urgent donor updates" vs "urgent seeker updates"
    // as described in the feature goal.
    audience: { type: String, enum: ["all", "donor", "seeker"], default: "all" },

    // Scheduling window. Both optional — an announcement with neither set
    // is live immediately and indefinitely (until toggled off).
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },

    isActive: { type: Boolean, default: true },

    // Higher shows first when more than one announcement is live at once —
    // the client renders them as a swipeable stack, highest priority first.
    priority: { type: Number, default: 0 },

    // How often a user who has dismissed it should see it again:
    // - "once_per_session": shown once per app session (in-memory on the
    //   client — resets on next cold start / app relaunch).
    // - "once_per_day": shown at most once per rolling 24h, tracked per
    //   announcement id with a timestamp in local storage ("don't show
    //   again today").
    // - "always": shown every time the modal mounts / app foregrounds, no
    //   dismissal memory at all.
    displayFrequency: {
      type: String,
      enum: ["once_per_session", "once_per_day", "always"],
      default: "once_per_session",
    },

    // Always dismissible via the close icon per the spec; kept as a field
    // (rather than hard-coded) so a truly urgent, non-skippable notice can
    // still be sent without a code change.
    dismissible: { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

// The public endpoint's core query (active + within window) runs on every
// app open, so it's worth an index.
announcementSchema.index({ isActive: 1, startDate: 1, endDate: 1, priority: -1 });

module.exports = mongoose.model("Announcement", announcementSchema);

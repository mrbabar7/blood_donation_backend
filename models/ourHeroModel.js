const mongoose = require("mongoose");

// "Our Heroes" — an admin-curated directory of notable charity, hospitality and
// healthcare personalities. Managed from the admin dashboard; the mobile app only
// ever reads ACTIVE records (enforced in controllers/ourHeroesController.js).
const ourHeroSchema = new mongoose.Schema(
  {
    // Hosted image URL (Cloudinary, via utils/imageUpload.js). Never raw bytes.
    imageUrl: { type: String, required: true, trim: true, maxlength: 2048 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    address: { type: String, required: true, trim: true, maxlength: 250 },
    // Optional phone number shown behind the "Contact Now" button.
    contact: { type: String, default: "", trim: true, maxlength: 30 },
    shortDescription: { type: String, required: true, trim: true, maxlength: 300 },
    fullDescription: { type: String, required: true, trim: true, maxlength: 5000 },
    specialties: { type: [String], default: [] },
    activities: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Public list: active records, newest first. Admin list sorts the same way.
ourHeroSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model("OurHero", ourHeroSchema);

const mongoose = require("mongoose");

// "Nominate a donor" (Heroes wall): someone tells us who helped them, so the
// team can recognise that donor. Stored for the admin team to review.
const nominationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    nominatorName: { type: String, default: "" },
    donorName: { type: String, required: true, trim: true, maxlength: 80 },
    donorContact: { type: String, default: "", trim: true, maxlength: 40 },
    city: { type: String, default: "", trim: true, maxlength: 60 },
    story: { type: String, required: true, trim: true, maxlength: 600 },
    status: { type: String, enum: ["new", "reviewed", "featured", "dismissed"], default: "new" },
  },
  { timestamps: true }
);

nominationSchema.index({ status: 1, createdAt: -1 });
nominationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Nomination", nominationSchema);

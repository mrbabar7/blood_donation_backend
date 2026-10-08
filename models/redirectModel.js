const mongoose = require("mongoose");

const redirectSchema = new mongoose.Schema(
  {
    from: { type: String, required: true, unique: true, trim: true },
    to: { type: String, required: true, trim: true },
    type: { type: Number, enum: [301, 302], default: 301 },
    hits: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Redirect", redirectSchema);

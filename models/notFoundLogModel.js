const mongoose = require("mongoose");

// Written automatically by the real 404 logging middleware in server.js —
// genuine broken-link data, not simulated.
const notFoundLogSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    hits: { type: Number, default: 1 },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NotFoundLog", notFoundLogSchema);

const Redirect = require("../models/redirectModel");
const NotFoundLog = require("../models/notFoundLogModel");

// Real redirect serving — checked before any route match, so a redirect created
// in the admin Redirects screen takes effect immediately without a deploy.
async function serveRedirects(req, res, next) {
  try {
    const redirect = await Redirect.findOne({ from: req.path });
    if (redirect) {
      redirect.hits += 1;
      await redirect.save();
      return res.redirect(redirect.type, redirect.to);
    }
    next();
  } catch (error) {
    next(); // never let redirect lookup break the app
  }
}

// Mounted last, after all real routes — anything that reaches here is a genuine
// 404, logged for the admin Redirects & 404s screen's "recent 404s" table.
async function log404(req, res) {
  try {
    await NotFoundLog.findOneAndUpdate(
      { url: req.originalUrl },
      { $inc: { hits: 1 }, $set: { lastSeenAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    // logging failure shouldn't crash the 404 response itself
  }
  res.status(404).json({ success: false, message: "Not found" });
}

module.exports = { serveRedirects, log404 };

const { SupportMessage, SupportConversation } = require("../models/supportMessageModel");

// Consumer-facing (mobile app would call these via /support/*, protected by the
// normal `protect` middleware) — not yet wired into a mobile screen this pass,
// but fully functional so the admin side has real data to work with end-to-end.
exports.getMyThread = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const messages = await SupportMessage.find({ userId }).sort({ createdAt: 1 });
    res.status(200).json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendMyMessage = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { text, subject } = req.body;
    if (!text) return res.status(400).json({ success: false, message: "Message required." });

    await SupportConversation.findOneAndUpdate(
      { userId },
      { userId, subject: subject || undefined, status: "open", lastMessageAt: new Date() },
      { upsert: true }
    );
    const message = await SupportMessage.create({ userId, senderType: "user", senderName: req.user.name, text });
    res.status(201).json({ success: true, message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

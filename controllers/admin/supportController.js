const { SupportMessage, SupportConversation } = require("../../models/supportMessageModel");
const { writeAuditLog } = require("./auditLogController");

exports.listConversations = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status && status !== "all" ? { status } : {};
    const conversations = await SupportConversation.find(filter)
      .populate("userId", "name email")
      .sort({ lastMessageAt: -1 });
    res.status(200).json({ success: true, conversations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getThread = async (req, res) => {
  try {
    const messages = await SupportMessage.find({ userId: req.params.userId }).sort({ createdAt: 1 });
    res.status(200).json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.reply = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, message: "Message required." });

    const message = await SupportMessage.create({
      userId: req.params.userId, senderType: "admin", senderName: req.admin.name, text,
    });
    await SupportConversation.findOneAndUpdate({ userId: req.params.userId }, { lastMessageAt: new Date() });
    res.status(201).json({ success: true, message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markResolved = async (req, res) => {
  try {
    await SupportConversation.findOneAndUpdate({ userId: req.params.userId }, { status: "resolved" });
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Marked support conversation resolved`, category: "platform" });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

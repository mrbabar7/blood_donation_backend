const { SupportMessage, SupportConversation } = require("../../models/supportMessageModel");
const { writeAuditLog } = require("./auditLogController");
const { sendToUser } = require("../../email-sender/mailer");
const { createNotification } = require("../notificationController");

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
    sendToUser(req.params.userId, "supportReply", { agent: req.admin.name, text });
    createNotification({
      userId: req.params.userId,
      title: "New reply from support",
      message: String(text).slice(0, 140),
      link: "/(tabs)/profile",
      emailCopy: false,
    });
    res.status(201).json({ success: true, message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markResolved = async (req, res) => {
  try {
    await SupportConversation.findOneAndUpdate({ userId: req.params.userId }, { status: "resolved" });
    sendToUser(req.params.userId, "supportResolved", {});
    createNotification({
      userId: req.params.userId,
      title: "Support conversation resolved",
      message: "We've marked your support conversation as resolved. Message us again anytime if you still need help.",
      link: "/(tabs)/profile",
      emailCopy: false,
    });
    await writeAuditLog({ actorId: req.admin._id, actorName: req.admin.name, action: `Marked support conversation resolved`, category: "platform" });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

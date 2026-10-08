const mongoose = require("mongoose");
const Message = require("../models/messageModel");
const ChatDeletion = require("../models/chatDeletionModel");
const { DonationRequest, Donor } = require("../models/formModel");
const userModel = require("../models/userMode");
const {
  emitToUser,
  emitToRoom,
  sendPushNotification,
  isUserInChatRoom,
  isUserConnected,
  markMessagesRead,
} = require("../services/socketService");
const { sendChatPush } = require("../services/chatPushService");
const { chatPushAllowed } = require("../utils/notificationPrefs");
const { isBlockedBetween } = require("../utils/blocks");
const {
  isDataUri,
  saveBase64Image,
  deleteStoredImage,
  ImageUploadError,
} = require("../utils/imageUpload");
const { purgeMessagesForRequests } = require("../services/chatCleanupService");

const DELETE_FOR_EVERYONE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const serializeMessage = (msg, viewerId) => {
  const m = msg.toObject ? msg.toObject() : msg;
  if (m.deletedForEveryone) {
    return {
      _id: m._id,
      requestId: m.requestId,
      senderId: m.senderId,
      receiverId: m.receiverId,
      deletedForEveryone: true,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }
  delete m.deletedFor;
  return m;
};

// Messages are now read with .lean() (plain objects — no per-document Mongoose
// hydration, which is real CPU on a 500-1000 message thread). A hydrated doc
// fills schema defaults for fields missing on OLD documents; lean doesn't, so
// re-apply the same defaults to keep the API response shape identical.
const withMessageDefaults = (m) => {
  if (m.reactions === undefined) m.reactions = [];
  if (m.deletedFor === undefined) m.deletedFor = [];
  if (m.isRead === undefined) m.isRead = false;
  if (m.deletedForEveryone === undefined) m.deletedForEveryone = false;
  return m;
};

const visibleToViewer = (msg, viewerId) =>
  !(msg.deletedFor || []).some((id) => id.toString() === viewerId.toString());

const ALLOWED_REACTIONS = [
  "\u2764\uFE0F",
  "\u{1F44D}",
  "\u{1F62E}",
  "\u{1F622}",
  "\u{1F64F}",
];
const normalizeEmoji = (e) => String(e || "").replace(/\uFE0F/g, "");
const isAllowedReaction = (e) =>
  ALLOWED_REACTIONS.some((a) => normalizeEmoji(a) === normalizeEmoji(e));

const serializeReactions = (reactions) =>
  (reactions || []).map((r) => ({ userId: String(r.userId), emoji: r.emoji }));

const toReplyPreview = (original, fallbackId) => {
  if (!original || original.deletedForEveryone) {
    return {
      messageId: original?._id || fallbackId,
      senderId: original?.senderId,
      deleted: true,
    };
  }
  return {
    messageId: original._id,
    senderId: original.senderId,
    text: (original.text || "").slice(0, 200),
    type: original.image?.url
      ? "image"
      : original.location
        ? "location"
        : "text",
  };
};

// Adds `replyPreview` to every serialized message that has a replyToMessageId,
// using one query for the whole batch. Mutates and returns `items`.
const attachReplyPreviews = async (items) => {
  const ids = [
    ...new Set(
      items
        .filter((m) => m.replyToMessageId)
        .map((m) => String(m.replyToMessageId)),
    ),
  ];
  if (ids.length === 0) return items;
  const originals = await Message.find({ _id: { $in: ids } })
    .select("senderId text image location deletedForEveryone")
    .lean();
  const byId = new Map(originals.map((o) => [String(o._id), o]));
  for (const m of items) {
    if (m.replyToMessageId) {
      m.replyPreview = toReplyPreview(
        byId.get(String(m.replyToMessageId)),
        m.replyToMessageId,
      );
    }
  }
  return items;
};

const resolveParticipants = async (requestId, currentUserId) => {
  const request = await DonationRequest.findById(requestId)
    .populate({ path: "donorId", populate: { path: "userId", select: "name" } })
    .populate("seekerId", "name")
    .lean();
  if (!request) return null;

  const donorUserId = request.donorId?.userId?._id?.toString();
  const seekerUserId = request.seekerId?._id?.toString();
  const me = currentUserId.toString();

  if (me !== donorUserId && me !== seekerUserId) return null;

  const meIsSeeker = me === seekerUserId;

  return {
    request,
    otherUserId: meIsSeeker ? donorUserId : seekerUserId,
    otherName: meIsSeeker
      ? request.donorId?.fullName || request.donorId?.userId?.name || "Donor"
      : request.seekerName || request.seekerId?.name || "Seeker",
  };
};

// Peer presence for the chat header ("Online" / "Offline"). Best-effort: a
// lookup failure just omits the fields and the client shows "Offline".
const getPeerPresence = async (otherUserId) => {
  try {
    if (!otherUserId) return {};
    const peer = await userModel
      .findById(otherUserId)
      .select("isOnline lastSeen")
      .lean();
    if (!peer) return {};
    return {
      otherIsOnline: !!peer.isOnline || isUserConnected(otherUserId),
      otherLastSeen: peer.lastSeen,
    };
  } catch (e) {
    return {};
  }
};

const getDeletionCutoff = async (userId, otherUserId) => {
  const rec = await ChatDeletion.findOne({ userId, otherUserId }).lean();
  return rec?.deletedAt || null;
};

exports.getMessages = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { requestId } = req.params;

    const ctx = await resolveParticipants(requestId, userId);
    if (!ctx) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You are not part of this conversation.",
        });
    }
    if (!["accepted", "completed"].includes(ctx.request.status)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Chat unlocks once this request is accepted.",
        });
    }
    if (await isBlockedBetween(userId, ctx.otherUserId)) {
      return res
        .status(403)
        .json({ success: false, message: "This conversation is unavailable." });
    }

    // Independent lookups run together instead of one after another.
    const [rawMessages, cutoff, presence] = await Promise.all([
      Message.find({ requestId }).sort({ createdAt: 1 }).limit(500).lean(),
      getDeletionCutoff(userId, ctx.otherUserId),
      getPeerPresence(ctx.otherUserId),
    ]);
    let messages = rawMessages.map(withMessageDefaults);
    if (cutoff) {
      messages = messages.filter((m) => m.createdAt > cutoff);
    }

    // Hide anything this user deleted just for themselves, and strip the
    // content of anything deleted for everyone.
    const payload = messages
      .filter((m) => visibleToViewer(m, userId))
      .map((m) => serializeMessage(m, userId));

    await attachReplyPreviews(payload);

    res.status(200).json({
      success: true,
      messages: payload,
      otherUserId: ctx.otherUserId,
      otherName: ctx.otherName,
      // Lets the chat screen tell "nobody's said anything yet" apart from
      // "this history was deleted" — see services/chatCleanupService.js.
      chatDeletedAt: ctx.request.chatDeletedAt,
      chatDeletedReason: ctx.request.chatDeletedReason,
      ...presence,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { requestId } = req.params;
    const { text, location, image, replyToMessageId } = req.body;

    if (!text && !location && !image) {
      return res
        .status(400)
        .json({ success: false, message: "Message can't be empty." });
    }

    const ctx = await resolveParticipants(requestId, userId);
    if (!ctx) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You are not part of this conversation.",
        });
    }
    if (!["accepted", "completed"].includes(ctx.request.status)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Chat unlocks once this request is accepted.",
        });
    }
    if (await isBlockedBetween(userId, ctx.otherUserId)) {
      return res
        .status(403)
        .json({ success: false, message: "You can't message this user." });
    }
    let locationPayload = location || undefined;
    if (location?.isLive) {
      const durationMinutes = Math.min(
        Math.max(Number(location.durationMinutes) || 15, 1),
        480,
      );
      locationPayload = {
        label: location.label,
        latitude: location.latitude,
        longitude: location.longitude,
        isLive: true,
        expiresAt: new Date(Date.now() + durationMinutes * 60 * 1000),
      };
    }
    let imagePayload;
    if (image) {
      if (!isDataUri(image.dataUri || image)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Invalid image data. Please choose the photo again.",
          });
      }
      try {
        const url = await saveBase64Image(image.dataUri || image, "chat");
        imagePayload = {
          url,
          width: Number(image.width) || undefined,
          height: Number(image.height) || undefined,
        };
      } catch (err) {
        if (err instanceof ImageUploadError) {
          return res
            .status(err.status || 400)
            .json({ success: false, message: err.message });
        }
        throw err;
      }
    }

    let replyTarget = null;
    if (replyToMessageId) {
      if (!mongoose.isValidObjectId(replyToMessageId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid message to reply to." });
      }
      replyTarget = await Message.findById(replyToMessageId).select(
        "senderId receiverId deletedForEveryone",
      );
      const pair = [String(userId), String(ctx.otherUserId)];
      if (
        !replyTarget ||
        replyTarget.deletedForEveryone ||
        !pair.includes(String(replyTarget.senderId)) ||
        !pair.includes(String(replyTarget.receiverId))
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message: "The message you're replying to is no longer available.",
          });
      }
    }

    const recipientInRoom = isUserInChatRoom(ctx.otherUserId, requestId);
    const recipientOnline = recipientInRoom || isUserConnected(ctx.otherUserId);
    const sentAt = new Date();

    const message = await Message.create({
      requestId,
      senderId: userId,
      receiverId: ctx.otherUserId,
      text: text || "",
      location: locationPayload,
      image: imagePayload,
      replyToMessageId: replyTarget ? replyTarget._id : undefined,
      deliveredAt: recipientOnline ? sentAt : undefined,
      isRead: recipientInRoom,
      readAt: recipientInRoom ? sentAt : undefined,
    });

    const messageOut = message.toObject();
    await attachReplyPreviews([messageOut]);

    emitToUser(ctx.otherUserId, "chat_message", {
      requestId,
      message: messageOut,
    });

    // Reply to the sender NOW. The push below talks to Expo/FCM over the
    // network (hundreds of ms, occasionally seconds) and used to sit in front
    // of this response, so every "send" waited on a third party before the
    // sender's bubble could confirm. The message is already saved and has
    // already been delivered over the socket; the push is a background
    // courtesy for an offline recipient and has its own error handling.
    res.status(201).json({ success: true, message: messageOut });

    if (!isUserInChatRoom(ctx.otherUserId, requestId)) {
      try {
        const recipient = await userModel
          .findById(ctx.otherUserId)
          .select(
            "fcmToken pushToken expoPushToken notificationPrefs quietHours",
          );
        if (recipient && chatPushAllowed(recipient)) {
          const senderName = req.user.name || "New message";
          const body = imagePayload
            ? text
              ? `📷 ${text}`
              : "📷 Photo"
            : text
              ? text
              : "📍 Shared a location";

          await sendChatPush({
            recipient,
            senderId: userId,
            senderName,
            body,
            requestId,
          });
        }
      } catch (err) {
        console.error("Error sending chat push notification:", err.message);
      }
    }
  } catch (error) {
    // The response may already have gone out (push work runs after it).
    if (res.headersSent) return;
    res.status(500).json({ success: false, message: error.message });
  }
};

const getRequestRows = async (userId) => {
  // Seeker-side requests and the donor-profile lookup don't depend on each
  // other, so fetch them together; .lean() skips document hydration (only
  // plain field reads happen below).
  const [asSeeker, donorDoc] = await Promise.all([
    DonationRequest.find({
      seekerId: userId,
      status: { $in: ["accepted", "completed"] },
    })
      .populate({
        path: "donorId",
        populate: { path: "userId", select: "name" },
      })
      .lean(),
    Donor.findOne({ userId }).select("_id").lean(),
  ]);
  const asDonor = donorDoc
    ? await DonationRequest.find({
        donorId: donorDoc._id,
        status: { $in: ["accepted", "completed"] },
      })
        .populate("seekerId", "name")
        .lean()
    : [];

  return [
    ...asSeeker.map((r) => ({
      requestId: r._id,
      otherUserId: r.donorId?.userId?._id,
      otherName: r.donorId?.fullName || r.donorId?.userId?.name || "Donor",
      status: r.status,
      updatedAt: r.updatedAt,
    })),
    ...asDonor.map((r) => ({
      requestId: r._id,
      otherUserId: r.seekerId?._id,
      otherName: r.seekerName || r.seekerId?.name || "Seeker",
      status: r.status,
      updatedAt: r.updatedAt,
    })),
  ].filter((row) => row.otherUserId);
};

exports.getConversations = async (req, res) => {
  try {
    const userId = (req.user.id || req.user._id).toString();

    const rows = await getRequestRows(userId);

    const byOtherUser = new Map();
    for (const row of rows) {
      const key = row.otherUserId.toString();
      if (!byOtherUser.has(key)) byOtherUser.set(key, []);
      byOtherUser.get(key).push(row);
    }

    // One query for all of this user's "deleted chat" cutoffs instead of one
    // per conversation (this endpoint also backs the tab-bar unread badge, so
    // it is hit constantly).
    const deletions = await ChatDeletion.find({ userId })
      .select("otherUserId deletedAt")
      .lean();
    const cutoffByOther = new Map(
      deletions.map((d) => [String(d.otherUserId), d.deletedAt]),
    );

    const conversations = await Promise.all(
      Array.from(byOtherUser.entries()).map(async ([otherUserId, group]) => {
        const requestIds = group.map((r) => r.requestId);
        const cutoff = cutoffByOther.get(String(otherUserId)) || null;
        const messageFilter = { requestId: { $in: requestIds } };
        if (cutoff) messageFilter.createdAt = { $gt: cutoff };
        // A message this user deleted just for themselves must not keep
        // surfacing as their inbox preview.
        messageFilter.deletedFor = { $ne: userId };

        const [lastMessage, unreadCount] = await Promise.all([
          Message.findOne(messageFilter)
            .sort({
              createdAt: -1,
            })
            .lean(),
          Message.countDocuments({
            ...messageFilter,
            receiverId: userId,
            isRead: false,
          }),
        ]);
        // The most recently updated request stands in for the group — it's
        // what the "Chats" list navigates to / sends new messages through.
        const activeRow = [...group].sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )[0];

        if (cutoff && !lastMessage) return null;

        return {
          requestId: activeRow.requestId,
          otherUserId,
          otherName: activeRow.otherName,
          status: activeRow.status,
          lastMessage: lastMessage?.deletedForEveryone
            ? "🚫 This message was deleted"
            : lastMessage?.image
              ? lastMessage.text
                ? `📷 ${lastMessage.text}`
                : "📷 Photo"
              : lastMessage?.text ||
                (lastMessage?.location ? "📍 Shared a location" : ""),
          lastMessageAt: lastMessage?.createdAt || activeRow.updatedAt,
          unreadCount,
          // Lets the Chats list draw the same sent/delivered/read ticks as
          // the thread when the last message is our own.
          lastMessageSenderId: lastMessage ? String(lastMessage.senderId) : undefined,
          lastMessageIsRead: lastMessage ? !!lastMessage.isRead : undefined,
          lastMessageDeliveredAt: lastMessage?.deliveredAt,
        };
      }),
    );

    const visibleConversations = conversations.filter(Boolean);
    visibleConversations.sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime(),
    );

    res
      .status(200)
      .json({ success: true, conversations: visibleConversations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /chat/user/:otherUserId/messages — full message history with one
// person, merged across every accepted/completed request you've shared with
// them. Backs the "Chats" tab bar so opening it shows the complete
// conversation instead of just whichever single request you tapped.
exports.getUserMessages = async (req, res) => {
  try {
    const userId = (req.user.id || req.user._id).toString();
    const { otherUserId } = req.params;

    const rows = await getRequestRows(userId);
    const shared = rows.filter(
      (row) => row.otherUserId.toString() === otherUserId,
    );

    if (shared.length === 0) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You are not part of this conversation.",
        });
    }

    const requestIds = shared.map((r) => r.requestId);
    // New messages sent from this merged view go through whichever shared
    // request was updated most recently.
    const sortedShared = [...shared].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const activeRequestId = sortedShared[0].requestId;
    const otherName = sortedShared[0].otherName;

    const [rawMessages, cutoff, presence] = await Promise.all([
      Message.find({ requestId: { $in: requestIds } })
        .sort({ createdAt: 1 })
        .limit(1000)
        .lean(),
      getDeletionCutoff(userId, otherUserId),
      getPeerPresence(otherUserId),
    ]);
    let messages = rawMessages.map(withMessageDefaults);
    if (cutoff) {
      messages = messages.filter((m) => m.createdAt > cutoff);
    }

    // Same effect as before (everything addressed to this user in these
    // threads becomes read), plus the senders are told live so their ticks
    // turn blue.
    await markMessagesRead({ readerId: userId, requestIds });

    const payload = messages
      .filter((m) => visibleToViewer(m, userId))
      .map((m) => serializeMessage(m, userId));

    await attachReplyPreviews(payload);

    res
      .status(200)
      .json({
        success: true,
        messages: payload,
        otherUserId,
        otherName,
        requestIds,
        activeRequestId,
        ...presence,
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateLiveLocation = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { requestId, messageId } = req.params;
    const { latitude, longitude } = req.body;

    if (latitude == null || longitude == null) {
      return res
        .status(400)
        .json({
          success: false,
          message: "latitude and longitude are required.",
        });
    }

    const ctx = await resolveParticipants(requestId, userId);
    if (!ctx) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You are not part of this conversation.",
        });
    }

    const message = await Message.findOne({
      _id: messageId,
      requestId,
      senderId: userId,
    });
    if (!message || !message.location?.isLive) {
      return res
        .status(404)
        .json({ success: false, message: "No active live share found." });
    }
    if (
      message.location.expiresAt &&
      message.location.expiresAt.getTime() <= Date.now()
    ) {
      return res
        .status(410)
        .json({ success: false, message: "This live share has expired." });
    }

    message.location.latitude = latitude;
    message.location.longitude = longitude;
    await message.save();

    emitToRoom(`chat_${requestId}`, "chat_location_update", {
      requestId,
      messageId: message._id,
      latitude,
      longitude,
      isLive: true,
      expiresAt: message.location.expiresAt,
    });

    res.status(200).json({ success: true, message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /chat/:requestId/messages/:messageId/stop-location — sender ends a
// live share early (the "Stop sharing" button). Auto-expiry via expiresAt
// handles the rest of the cases, so this just needs to flip isLive off and
// tell anyone watching right now.
exports.stopLiveLocation = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { requestId, messageId } = req.params;

    const message = await Message.findOne({
      _id: messageId,
      requestId,
      senderId: userId,
    });
    if (!message || !message.location?.isLive) {
      return res
        .status(404)
        .json({ success: false, message: "No active live share found." });
    }

    message.location.isLive = false;
    await message.save();

    emitToRoom(`chat_${requestId}`, "chat_location_update", {
      requestId,
      messageId: message._id,
      latitude: message.location.latitude,
      longitude: message.location.longitude,
      isLive: false,
      expiresAt: message.location.expiresAt,
    });

    res.status(200).json({ success: true, message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteConversation = async (req, res) => {
  try {
    const userId = (req.user.id || req.user._id).toString();
    const { otherUserId } = req.params;
    const forEveryone = !!req.body?.forEveryone;

    const rows = await getRequestRows(userId);
    const shared = rows.filter(
      (row) => row.otherUserId.toString() === otherUserId,
    );
    if (shared.length === 0) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You are not part of this conversation.",
        });
    }

    const requestIds = shared.map((r) => r.requestId);

    if (forEveryone) {
      await purgeMessagesForRequests(requestIds);
      // Also clear any lingering "deleted for me" cutoffs on both sides —
      // nothing is left for either of them to hide anymore.
      await ChatDeletion.deleteMany({
        $or: [
          { userId, otherUserId },
          { userId: otherUserId, otherUserId: userId },
        ],
      });
      emitToUser(otherUserId, "chat_deleted", {
        otherUserId: userId,
        forEveryone: true,
      });
    } else {
      await ChatDeletion.findOneAndUpdate(
        { userId, otherUserId },
        { deletedAt: new Date() },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const userId = (req.user.id || req.user._id).toString();
    const { requestId, messageId } = req.params;
    const forEveryone = !!req.body?.forEveryone;

    const ctx = await resolveParticipants(requestId, userId);
    if (!ctx) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You are not part of this conversation.",
        });
    }

    const message = await Message.findOne({ _id: messageId, requestId });
    if (!message) {
      return res
        .status(404)
        .json({ success: false, message: "Message not found." });
    }

    if (!forEveryone) {
      if (!message.deletedFor.some((id) => id.toString() === userId)) {
        message.deletedFor.push(userId);
        await message.save();
      }
      return res
        .status(200)
        .json({ success: true, forEveryone: false, messageId });
    }

    // --- delete for everyone ---
    if (message.senderId.toString() !== userId) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You can only delete your own messages for everyone.",
        });
    }
    if (message.deletedForEveryone) {
      return res
        .status(200)
        .json({ success: true, forEveryone: true, messageId });
    }
    if (
      Date.now() - new Date(message.createdAt).getTime() >
      DELETE_FOR_EVERYONE_WINDOW_MS
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This message is too old to delete for everyone. You can still delete it for yourself.",
      });
    }

    // Image messages: hard-delete the document, then free the file on disk.
    // The document goes first so a failed unlink can only ever leave an
    // orphaned file (harmless), never a message pointing at a missing file.
    if (message.image?.url) {
      const imageUrl = message.image.url;
      await Message.deleteOne({ _id: message._id });
      try {
        await deleteStoredImage(imageUrl);
      } catch (err) {
        console.error("Error removing chat image from disk:", err.message);
      }

      emitToUser(ctx.otherUserId, "chat_message_deleted", {
        requestId: String(message.requestId),
        messageId,
        forEveryone: true,
        removed: true,
      });

      return res
        .status(200)
        .json({ success: true, forEveryone: true, messageId, removed: true });
    }

    message.text = "";
    message.image = undefined;
    message.location = undefined;
    message.deletedForEveryone = true;
    message.deletedAt = new Date();
    await message.save();

    // Live update on the other device, so the tombstone appears immediately
    // rather than on their next refresh.
    emitToUser(ctx.otherUserId, "chat_message_deleted", {
      requestId,
      messageId,
      forEveryone: true,
    });

    res.status(200).json({ success: true, forEveryone: true, messageId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /chat/:requestId/mark-read — call when opening a thread so the Chats
// tab's unread badge clears.
exports.markThreadRead = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { requestId } = req.params;
    await markMessagesRead({ readerId: userId, requestIds: [requestId] });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.reactToMessage = async (req, res) => {
  try {
    const userId = (req.user.id || req.user._id).toString();
    const { requestId, messageId } = req.params;
    const emoji = req.body?.emoji ? String(req.body.emoji) : "";

    if (emoji && !isAllowedReaction(emoji)) {
      return res
        .status(400)
        .json({ success: false, message: "That reaction isn't supported." });
    }

    const ctx = await resolveParticipants(requestId, userId);
    if (!ctx) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You are not part of this conversation.",
        });
    }
    if (!["accepted", "completed"].includes(ctx.request.status)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Chat unlocks once this request is accepted.",
        });
    }

    const message = await Message.findOne({ _id: messageId, requestId }).select(
      "reactions deletedForEveryone",
    );
    if (!message) {
      return res
        .status(404)
        .json({ success: false, message: "Message not found." });
    }
    if (message.deletedForEveryone) {
      return res
        .status(400)
        .json({
          success: false,
          message: "You can't react to a deleted message.",
        });
    }

    const existing = (message.reactions || []).find(
      (r) => String(r.userId) === userId,
    );
    const removeOnly =
      !emoji ||
      (existing && normalizeEmoji(existing.emoji) === normalizeEmoji(emoji));

    // Atomic pull/push (not a read-modify-save of the whole array) so two
    // people reacting at the same instant can't overwrite each other.
    await Message.updateOne(
      { _id: messageId },
      { $pull: { reactions: { userId } } },
    );
    if (!removeOnly) {
      await Message.updateOne(
        { _id: messageId },
        { $push: { reactions: { userId, emoji } } },
      );
    }

    const fresh = await Message.findById(messageId).select("reactions");
    const payload = {
      requestId: String(requestId),
      messageId: String(messageId),
      reactions: serializeReactions(fresh?.reactions),
    };

    emitToUser(ctx.otherUserId, "message_reaction", payload);
    emitToUser(userId, "message_reaction", payload);

    res.status(200).json({ success: true, ...payload });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

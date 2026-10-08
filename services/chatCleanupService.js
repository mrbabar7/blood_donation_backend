const Message = require("../models/messageModel");
const { deleteStoredImage } = require("../utils/imageUpload");
const { emitToUser } = require("./socketService");
const { createNotification } = require("../controllers/notificationController");

// ============================================================================
// Chat storage cleanup — the reason this exists at all: the product decision
// is that once a request's job is done (donation completed, or unconfirmed
// long enough to give up on), there is no ongoing reason to keep its chat
// history in the database. This is a genuine hard delete, not a per-user
// hide — see chatController.js's `deleteConversation`/`deleteMessage` for
// the user-initiated, reversible-for-one-side version of "delete".
//
// Used from two places:
//   1. seekerController/completeDonation.js — the moment a donation is
//      confirmed complete.
//   2. services/chatCleanupCron.js — 3 days after a donor marks a request
//      donated with no seeker confirmation yet.
// ============================================================================

// Deletes every message for one request: the documents themselves, and any
// uploaded photo file each one was carrying (or the upload just becomes an
// orphaned file on disk forever — exactly the storage leak this whole
// feature exists to avoid). Any "delete for me" cutoff either participant
// had set (chatDeletionModel.js) is left untouched on purpose — it's scoped
// to their whole conversation with the other person, not this one request,
// and the same two people may still share other, still-active requests.
// Same as purgeMessagesForRequest, but for every request in a conversation at
// once — used by chatController.js's deleteConversation (forEveryone), which
// spans every shared request between two people, not just one.
const purgeMessagesForRequests = async (requestIds) => {
  const messages = await Message.find({ requestId: { $in: requestIds } }).select("image");
  await Promise.all(
    messages
      .filter((m) => m.image?.url)
      .map((m) => deleteStoredImage(m.image.url).catch((err) => {
        console.error("Error deleting chat image during conversation delete:", err.message);
      })),
  );
  const { deletedCount } = await Message.deleteMany({ requestId: { $in: requestIds } });
  return deletedCount;
};

const purgeMessagesForRequest = async (requestId) => {
  const messages = await Message.find({ requestId }).select("image");
  await Promise.all(
    messages
      .filter((m) => m.image?.url)
      .map((m) => deleteStoredImage(m.image.url).catch((err) => {
        console.error(`Error deleting chat image for request ${requestId}:`, err.message);
      })),
  );
  const { deletedCount } = await Message.deleteMany({ requestId });
  return deletedCount;
};

// Full flow for one request: purge its messages, stamp the request with
// when/why, notify both participants (so this never looks like a silent bug
// to either of them — REQUIREMENT: "show customer your chat history is
// deleted"), and push a live socket event so an open chat screen updates
// immediately instead of the thread just going blank with no explanation.
//
// `request` must already be the DonationRequest document (not just an id) —
// callers already have it loaded in both call sites, and this needs several
// of its fields (seekerId, donorId->userId, etc).
const deleteChatForRequest = async (request, reason, { donorUserId, seekerId } = {}) => {
  await purgeMessagesForRequest(request._id);

  request.chatDeletedAt = new Date();
  request.chatDeletedReason = reason;
  await request.save();

  const isCompleted = reason === "completed";
  const title = isCompleted ? "Chat history deleted" : "Chat history deleted";
  const message = isCompleted
    ? "This donation was completed successfully, so its chat history has been deleted to keep things tidy."
    : "This chat wasn't confirmed as completed within 3 days, so its history has been automatically deleted.";

  const recipients = [seekerId, donorUserId].filter(Boolean);
  await Promise.all(
    recipients.map((userId) =>
      createNotification({
        userId,
        title,
        message,
        link: "/(tabs)/requests",
      }).catch((err) => {
        console.error(`Error notifying ${userId} of chat deletion:`, err.message);
      }),
    ),
  );

  const payload = { requestId: request._id.toString(), reason };
  recipients.forEach((userId) => emitToUser(userId, "chat_history_deleted", payload));
};

module.exports = { purgeMessagesForRequest, purgeMessagesForRequests, deleteChatForRequest };

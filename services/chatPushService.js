const userModel = require("../models/userMode");
const { sendExpoPush } = require("./expoPushService");
const { sendPushNotification } = require("./socketService");

// Chat message push for a recipient who is not looking at the thread.
//
// Transport choice (one per message, never both, so no duplicate banners):
//   1. Expo push via expo-server-sdk — when the recipient has registered an
//      Expo push token (User.expoPushToken).
//   2. Firebase Cloud Messaging — the app's existing push path — when there is
//      no Expo token, or Expo rejected the message outright (bad credentials,
//      dead token, ...). This keeps chat notifications working on any device
//      that could receive them before this feature existed.
//
// Deep-link payload: `type/chatRoomId/senderId` as specified, plus the
// `link/params` pair the app's existing tap handler already understands.
// In this codebase a chat room IS the accepted donation request, so
// chatRoomId === requestId and the screen is app/chat/[requestId].tsx.
const sendChatPush = async ({ recipient, senderId, senderName, body, requestId }) => {
  if (!recipient) return;

  const data = {
    type: "chat",
    chatRoomId: String(requestId),
    senderId: String(senderId),
    link: "/chat/[requestId]",
    params: { requestId: String(requestId) },
  };

  // CHAT_PUSH_TRANSPORT=fcm forces the existing FCM path (kill-switch for the
  // Expo transport); any other value / unset = prefer Expo when available.
  if (recipient.expoPushToken && process.env.CHAT_PUSH_TRANSPORT !== "fcm") {
    const result = await sendExpoPush(
      recipient.expoPushToken,
      { title: senderName, body, data },
      // Expo reported the token dead (e.g. app uninstalled) — stop using it.
      async (deadToken) => {
        await userModel.updateOne(
          { _id: recipient._id, expoPushToken: deadToken },
          { $set: { expoPushToken: null } },
        );
      },
    );
    if (result.sent) return;
  }

  const fcmToken = recipient.fcmToken || recipient.pushToken;
  if (fcmToken) {
    await sendPushNotification(fcmToken, senderName, body, data);
  }
};

module.exports = { sendChatPush };

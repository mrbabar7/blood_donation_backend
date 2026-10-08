# WhatsApp-style chat + chat push — change notes

Additive only. Files touched: `models/messageModel.js`, `models/userMode.js`,
`controllers/chatController.js`, `routes/chatRouter.js`, `routes/authRouter.js`,
`services/socketService.js`. New: `services/expoPushService.js`,
`services/chatPushService.js`, `controllers/authController/saveExpoPushToken.js`.

## Data model
- `Message.deliveredAt`, `Message.readAt` — status ticks (existing `isRead` reused).
- `Message.replyToMessageId` — quoted message. The preview (`replyPreview`) is
  resolved at read time, so a message deleted for everyone never leaks via a quote.
- `Message.reactions: [{ userId, emoji }]` — one reaction per user per message.
- `User.expoPushToken` — optional; chat falls back to `fcmToken` when absent.

## HTTP
- `POST /chat/:requestId/messages` — now accepts `replyToMessageId`.
- `POST /chat/:requestId/messages/:messageId/reaction` `{ emoji }` — add / replace / remove.
- `POST /auth/save-expo-push-token` `{ token }`.

## Socket events
| Event | Direction | Payload |
|---|---|---|
| `message_read` | client → server | `{ requestId \| requestIds, messageIds? }` |
| `messages_marked_read` | server → sender | `{ requestId, messageIds, readerId, readAt }` |
| `message_delivered` | server → sender | `{ requestId, messageIds, deliveredAt }` |
| `message_reaction` | server → both users | `{ requestId, messageId, reactions }` |

Ticks: single = sent, double grey = delivered (recipient's app was connected, or
connected later), double blue = read.

## Push
Sent only when the recipient is not in the chat room (the app leaves the room when
backgrounded). Payload data: `{ type: "chat", chatRoomId, senderId, link, params }`.
Transport per message (never both): Expo (`expo-server-sdk`) when the recipient has an
Expo token and Expo accepts it, otherwise the existing FCM path.
`CHAT_PUSH_TRANSPORT=fcm` forces FCM; `EXPO_ACCESS_TOKEN` is optional.

`chatRoomId` is the accepted request's id — the app's chat screen is
`app/chat/[requestId].tsx`, so the route was kept rather than renamed.

## Typing indicator + peer presence (additive)
| Event | Direction | Payload |
|---|---|---|
| `typing` | client → server | `{ toUserId, requestId? }` |
| `stop_typing` | client → server | `{ toUserId, requestId? }` |
| `user_typing` | server → peer's personal room | `{ fromUserId, requestId?, isTyping }` |

Relay only — nothing is stored. Sent to the peer's personal room (not the chat
room) so the open thread header and the Chats list both receive it.
`GET /chat/:requestId/messages` and `GET /chat/user/:id/messages` now also return
`otherIsOnline` / `otherLastSeen`; `GET /chat/conversations` rows gained
`lastMessageSenderId`, `lastMessageIsRead`, `lastMessageDeliveredAt` (own-message ticks).

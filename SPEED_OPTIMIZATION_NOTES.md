# Speed / scale optimisation — change notes

Performance-only changes. No API shape, route, event name or feature was changed.

## Backend
- `models/messageModel.js` — compound indexes `{requestId,createdAt}`, `{receiverId,isRead,requestId}`, `{receiverId,deliveredAt,createdAt}` (thread history, unread counts, mark-read, delivered backfill were scanning/sorting in memory).
- `models/callModel.js` — `{callerId,createdAt}`, `{calleeId,createdAt}` for call history.
- `models/formModel.js` — `{broadcastId}` on requests.
- `controllers/chatController.js`
  - `sendMessage` now answers the sender right after the message is saved and delivered over the socket; the Expo/FCM push runs after the response instead of blocking it.
  - `getConversations`: per-conversation "deleted chat" lookups batched into one query; last-message + unread-count run in parallel; lean reads.
  - `getMessages` / `getUserMessages`: lean reads (schema defaults re-applied so the JSON is unchanged), cutoff + presence fetched in parallel with the messages.
  - `resolveParticipants`, `getRequestRows`, presence lookups: lean + parallel.
- `services/socketService.js`
  - `join_room` + `register_user` (both emitted on every connect) no longer repeat the DB writes / global presence broadcast / delivered backfill.
  - Presence: a 5 s grace period before flipping a user offline (cancelled on quick reconnect) and no re-broadcast when the user already has another live socket. Override with `PRESENCE_OFFLINE_GRACE_MS`.
  - `updateOne` instead of `findByIdAndUpdate` (no full document round-trip). Per-connection log lines only with `SOCKET_DEBUG=1`.
- `controllers/seekerController/showLandingPageDonors.js` — N+1 (one query per donor) replaced by one batched query; result capped at `HERO_SEARCH_MAX` (default 1000).
- `controllers/seekerController/getMyBroadcasts.js` — N+1 replaced by one batched query.
- `controllers/statsController.js` — public `/stats` result cached for 60 s (`STATS_CACHE_MS`).

## Frontend
- `src/hooks/useTabCounts.ts` — the two badge requests run in parallel; socket-triggered refreshes are coalesced (1 s) instead of two API calls per event.
- `app/(tabs)/chats.tsx` — socket-triggered list reloads coalesced (400 ms); FlatList windowing.

## Still recommended before very large scale (infrastructure, not code)
- Run multiple server instances behind a load balancer with the Socket.IO Redis adapter (`@socket.io/redis-adapter`) and sticky sessions; the in-memory rate limiter and presence timers are per-process.
- Cache the per-request user lookup in `middlewares/authMiddleware.js` in Redis (needs shared invalidation on logout/login, so it was left untouched).
- Presence is still broadcast to all clients (`donor_status_changed`); moving it to per-peer rooms needs a small client change.

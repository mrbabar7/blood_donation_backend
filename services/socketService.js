const { Server } = require("socket.io");
const { callPushAllowed } = require("../utils/notificationPrefs");
const { messaging } = require("../config/firebaseAdmin");
const callState = require("./callStateService");
const callPush = require("./callPushService");
const callLifecycle = require("./callLifecycleService");
const callAuth = require("./callAuthService");
const apnsVoip = require("./apnsVoipService");
const presenceFactory = require("./presence");
const redisConfig = require("../config/redis");

let io;

const getUserModel = () => {
  try {
    return require("../models/userMode");
  } catch (e) {
    return require("../models/userMode");
  }
};

const getDonorModel = () => {
  try {
    const donorModule = require("../models/formModel");
    return donorModule.Donor || donorModule;
  } catch (e) {
    return null;
  }
};

const setUserOnlineStatus = async (userId, isOnline) => {
  if (!userId) return;
  const now = new Date();

  try {
    const User = getUserModel();
    const Donor = getDonorModel();

    // updateOne (not findByIdAndUpdate): same write, but MongoDB no longer
    // ships the whole previous user/donor document back on every connect and
    // disconnect — pure wasted bandwidth at scale.
    const updates = [
      User.updateOne({ _id: userId }, { $set: { isOnline, lastSeen: now } }),
    ];

    if (Donor) {
      updates.push(
        Donor.updateOne(
          { userId: userId },
          { $set: { isOnline, lastSeen: now } },
        ),
      );
    }

    await Promise.all(updates);

    if (io) {
      io.emit("donor_status_changed", {
        userId: userId.toString(),
        isOnline,
        lastSeen: now,
      });
    }
  } catch (err) {
    console.error(`Error updating status for user ${userId}:`, err.message);
  }
};

// A mobile app drops and re-establishes its socket constantly (network switch,
// brief signal loss, screen lock). Flipping the user offline->online on every
// blip means two DB writes plus a broadcast to EVERY connected client each
// time. Instead the "offline" flip waits a few seconds and is cancelled if the
// user reconnects in that window — so a quick reconnect costs nothing.
const OFFLINE_GRACE_MS = Number(process.env.PRESENCE_OFFLINE_GRACE_MS) || 5000;
const pendingOffline = new Map();

const cancelPendingOffline = (userRoom) => {
  const t = pendingOffline.get(userRoom);
  if (t) {
    clearTimeout(t);
    pendingOffline.delete(userRoom);
    return true;
  }
  return false;
};

// Reconnect reconciliation: a callee whose socket was down while a call came in
// (or who just woke up from a notification) is told about a call that is STILL
// ringing and unexpired — the same call:invite the live path emits. The client
// de-duplicates by requestId, so a replay never rings twice.
const replayRingingCall = async (socket, userId) => {
  try {
    const call = await callState.findRingingForCallee({ calleeId: userId });
    if (!call) return;
    const caller = await getUserModel().findById(call.callerId).select("name");
    socket.emit("call:invite", {
      requestId: String(call.requestId),
      fromName: caller?.name || "",
      fromUserId: String(call.callerId),
      callId: String(call._id),
      expiresAt: call.expiresAt ? call.expiresAt.toISOString() : undefined,
      replay: true,
    });
  } catch (err) {
    console.error("Error replaying ringing call:", err.message);
  }
};

// Fastest legitimate typing-event cadence is ~2.5 s (client throttle); 800 ms leaves headroom.
const TYPING_MIN_GAP_MS = Number(process.env.TYPING_MIN_GAP_MS) || 800;

// True once the Redis adapter is attached: rooms/emits then span every server instance.
let clusterMode = false;
const presence = presenceFactory.create({
  getIo: () => io,
  isCluster: () => clusterMode,
});

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  });

  // Several server instances: with REDIS_URL set, rooms and emits are shared through
  // Redis (the app connects over websocket only, so no sticky sessions are needed).
  // Without REDIS_URL — or if the packages/Redis are unavailable — this stays a normal
  // single-instance server exactly as before.
  const bus = redisConfig.createPubSub();
  if (bus) {
    try {
      const { createAdapter } = require("@socket.io/redis-adapter");
      io.adapter(createAdapter(bus.pub, bus.sub));
      clusterMode = true;
      console.log("🔗 Socket.IO Redis adapter enabled (multi-instance mode)");
    } catch (err) {
      console.error(
        "Socket.IO Redis adapter unavailable, running single-instance:",
        err.message,
      );
    }
  }

  io.on("connection", (socket) => {
    if (process.env.SOCKET_DEBUG)
      console.log("⚡ New Client Connected:", socket.id);

    const handleUserConnect = async (userId) => {
      if (!userId) return;
      const userRoom = userId.toString();
      socket.join(userRoom);
      // The app emits both `join_room` and `register_user` on every connect.
      // Both land here — once this socket is registered for the user, the
      // second call has nothing left to do (it used to repeat the DB writes,
      // the global presence broadcast and the delivered-backfill).
      if (socket.userId === userRoom) return;
      socket.userId = userRoom;
      socket.data.userId = userRoom; // visible to other instances through fetchSockets()
      // Online status only needs writing/broadcasting when it actually
      // changes: not if a reconnect beat the offline grace timer, and not if
      // the user already has another live socket (second device / screen).
      const hadPendingOffline = cancelPendingOffline(userRoom);
      const alreadyOnline = (await presence.count(userRoom)) > 1;
      if (!hadPendingOffline && !alreadyOnline) {
        await setUserOnlineStatus(userId, true);
      }
      markMessagesDelivered(userRoom).catch((err) =>
        console.error("Error marking messages delivered:", err.message),
      );
      replayRingingCall(socket, userRoom);
    };

    socket.on("join_room", handleUserConnect);
    socket.on("register_user", handleUserConnect);

    // A user currently looking at a given chat thread (app/chat/[requestId].tsx)
    // joins this room for as long as that screen is mounted. chatController's
    // sendMessage checks isUserInChatRoom() before sending a push for a new
    // message — so someone actively reading the thread doesn't also get an OS
    // notification for it, while a backgrounded/closed app (whose socket has
    // dropped, same as the isOnline tracking above) or a different screen still
    // does.
    socket.on("join_chat", (requestId) => {
      if (requestId) socket.join(`chat_${requestId}`);
    });
    socket.on("leave_chat", (requestId) => {
      if (requestId) socket.leave(`chat_${requestId}`);
    });

    // ---- Typing indicator (relay only; nothing is persisted) ----
    // The chat screen emits `typing` while the user is typing (throttled
    // client-side) and `stop_typing` when they pause / blur / leave. We relay
    // both to the peer's personal room as `user_typing` so it works for the
    // open thread AND for the Chats list, which has no chat room joined.
    // Same routing guard as the call signaling below: sender must be
    // registered and the target must be somebody else.
    // Server-side guard: the app already throttles to one "typing" per 2.5 s, so
    // anything faster than TYPING_MIN_GAP_MS is a buggy or abusive client and is
    // dropped here instead of fanning out to the peer. Per-socket state, freed with
    // the socket; bounded so a client cycling target ids cannot grow it.
    const lastTypingRelay = new Map();
    const allowTypingRelay = (toUserId, isTyping) => {
      const key = `${toUserId}:${isTyping ? 1 : 0}`;
      const now = Date.now();
      const last = lastTypingRelay.get(key);
      if (last !== undefined && now - last < TYPING_MIN_GAP_MS) return false;
      if (lastTypingRelay.size >= 50) lastTypingRelay.clear();
      lastTypingRelay.set(key, now);
      return true;
    };
    const relayTyping = (isTyping) => (payload) => {
      try {
        const p = payload || {};
        const toUserId = p.toUserId;
        if (!socket.userId || !toUserId || String(toUserId) === socket.userId) {
          return;
        }
        if (!allowTypingRelay(String(toUserId), isTyping)) return;
        io.to(String(toUserId)).emit("user_typing", {
          fromUserId: socket.userId,
          requestId: p.requestId ? String(p.requestId) : undefined,
          isTyping,
        });
      } catch (err) {
        console.error("Error relaying typing event:", err.message);
      }
    };
    socket.on("typing", relayTyping(true));
    socket.on("stop_typing", relayTyping(false));

    // WhatsApp-style read receipts. The chat screen emits this when the user
    // is actually looking at incoming messages ({ requestId | requestIds,
    // messageIds? }). The server flips those messages to read and relays
    // `messages_marked_read` to the sender(s) so their ticks turn blue.
    socket.on("message_read", async (payload) => {
      try {
        if (!socket.userId) return;
        const p = payload || {};
        const requestIds = Array.isArray(p.requestIds)
          ? p.requestIds
          : p.requestId
            ? [p.requestId]
            : [];
        if (requestIds.length === 0) return;
        await markMessagesRead({
          readerId: socket.userId,
          requestIds,
          messageIds: Array.isArray(p.messageIds) ? p.messageIds : undefined,
        });
      } catch (err) {
        console.error("Error handling message_read:", err.message);
      }
    });

    // ---- In-app call signaling relay (PDF screen 28) ----
    // Pure relay: forwards whatever payload the caller sends to the other
    // participant's room. Enough to ring/notify and to carry WebRTC
    // offer/answer/ICE payloads once a WebRTC layer is wired in on the client.
    //
    // REQUIREMENT 3.2 also asks this layer to keep an accurate call history
    // across both devices — every call:invite below creates a Call
    // document (models/callModel.js) that call:accept / call:reject /
    // call:end / the safety-net timeout further down then update in place.
    // getCallHistory (controllers/callController.js) is what the Calls tab
    // reads back out. This bookkeeping is deliberately best-effort: it never
    // throws into the socket handler and never blocks the relay/push above
    // it, so a DB hiccup degrades to "history entry missing", not "the call
    // itself breaks".
    //
    // Routing guard shared by every signaling event below. A signal is only
    // relayed when (a) the sending socket has actually registered a user id —
    // otherwise `fromUserId` would be undefined and the receiving side could
    // not tell who it came from — and (b) it is addressed to somebody OTHER
    // than the sender. Relaying a self-addressed signal delivers the caller's
    // own offer/ICE straight back to the caller's own room, i.e. the caller
    // ends up "in a call" with themselves and hears their own microphone
    // while the real recipient hears nothing.
    const canRelaySignal = (toUserId) =>
      !!socket.userId && !!toUserId && String(toUserId) !== socket.userId;

    // Membership guard for every call:* event: the two users must be exactly the seeker and
    // the donor of that request (services/callAuthService.js). Cached per request, so ICE
    // bursts don't cost a query each. Lookup failure = deny (and log), never relay.
    const pairOk = async (toUserId, requestId) => {
      if (!canRelaySignal(toUserId)) return false;
      try {
        return await callAuth.isCallPair({
          requestId,
          userA: socket.userId,
          userB: String(toUserId),
        });
      } catch (err) {
        console.error("[call] authorization lookup failed:", err.message);
        return false;
      }
    };

    socket.on("call:invite", async ({ toUserId, requestId, fromName }) => {
      let allowed = false;
      if (canRelaySignal(toUserId)) {
        try {
          allowed = (
            await callAuth.canInvite({
              requestId,
              callerId: socket.userId,
              calleeId: String(toUserId),
            })
          ).ok;
        } catch (err) {
          console.error("[call] invite authorization failed:", err.message);
        }
      }
      if (!allowed) {
        // Tell the caller straight away (their call screen leaves on call:end)
        // instead of letting them ring for the full no-answer window.
        socket.emit("call:end", { requestId, fromUserId: toUserId });
        return;
      }
      // Foreground ring first, exactly as before — never delayed by the DB.
      emitToUser(toUserId, "call:invite", {
        requestId,
        fromName,
        fromUserId: socket.userId,
      });

      // Backend-authoritative record: status "ringing" with expiresAt =
      // now + 45 s (services/callStateService.js). Expiry is NOT an in-memory
      // timer any more — the durable sweeper (callLifecycleService) turns an
      // unanswered call into "missed" even across restarts/instances.
      let created = null;
      try {
        // A re-dial / duplicate invite closes the earlier ringing attempt.
        const superseded = await callState.supersedeRinging({
          callerId: socket.userId,
          calleeId: toUserId,
        });
        superseded.forEach((c) => publishCallUpdate(c));
        created = await callState.createRingingCall({
          requestId,
          callerId: socket.userId,
          calleeId: toUserId,
        });
        // Not awaited on purpose: pushing the new row to both Calls tabs must
        // never delay the ring/push notification below it.
        publishCallUpdate(created);
        callLifecycle.scheduleExpiry(created);
      } catch (err) {
        console.error("Error creating call history entry:", err.message);
      }

      // The emit above only reaches an already-connected socket. For a
      // backgrounded / killed / offline callee send a push too:
      //  - iOS with a PushKit token  -> VoIP push (CallKit), falling back to a
      //    normal alert push if that send fails;
      //  - everyone else             -> HIGH-priority data-only FCM that the
      //    app turns into a Notifee notification with Accept / Decline.
      // The push is re-validated against the DB immediately before sending
      // (still ringing, unexpired) and carries a TTL <= the ring window.
      try {
        const User = getUserModel();
        const callee = await User.findById(toUserId).select(
          "fcmToken pushToken voipPushToken notificationPrefs",
        );
        if (callee && !callPushAllowed(callee)) {
          // Recipient turned off "Incoming calls" push: the live socket ring above
          // still reaches an open app; only the app-closed push is skipped.
        } else if (created) {
          let voipSent = false;
          if (callee?.voipPushToken) {
            const voipRes = await sendVoipPushNotification(
              callee.voipPushToken,
              {
                requestId,
                fromName: fromName || "",
                fromUserId: socket.userId,
                callId: created._id,
                expiresAt: created.expiresAt.toISOString(),
              },
            );
            voipSent = !!voipRes;
          }
          if (!voipSent) {
            const pushRes = await callPush.sendIncomingCallPush({
              callId: created._id,
              callee,
              callerName: fromName || "",
              // A live socket means the in-app ring is handling it: no visible fallback needed.
              isCalleeOnline: async () =>
                (await presence.count(String(toUserId))) > 0,
            });
            console.log(
              "[call] incoming-call push result for",
              String(toUserId),
              JSON.stringify(pushRes),
            );
          }
        } else {
          // DB unavailable: keep the legacy notification so the call still rings.
          const token = callee?.fcmToken || callee?.pushToken;
          if (token) {
            await sendPushNotification(
              token,
              fromName ? `${fromName} is calling…` : "Incoming call",
              "Tap to answer",
              {
                link: "/call/[requestId]",
                params: {
                  requestId,
                  toUserId: socket.userId,
                  toUserName: fromName || "",
                },
              },
            );
          }
        }
      } catch (err) {
        console.error("Error sending call push notification:", err.message);
      }
    });
    // Callee -> server, once they tap "Accept" (native CallKit answer or the
    // in-app IncomingCallOverlay — see SocketContext.tsx). The server decides:
    // only a call that is still ringing and unexpired can be accepted. A late
    // accept (expired / caller cancelled / answered elsewhere) gets
    // "call:invalid" instead of being relayed to the caller.
    socket.on("call:accept", async ({ toUserId, requestId }) => {
      if (!(await pairOk(toUserId, requestId))) {
        socket.emit("call:invalid", { requestId, reason: "forbidden" });
        return;
      }
      let invalidReason = null;
      try {
        const call = await callState.findLatestForPair({
          requestId,
          callerId: toUserId,
          calleeId: socket.userId,
        });
        if (call) {
          const res = await callState.acceptCall({
            callId: call._id,
            calleeId: socket.userId,
          });
          if (res.changed) publishCallUpdate(res.call);
          // A repeat accept of a call this user already answered is harmless.
          else if (!(res.call && res.call.status === "accepted"))
            invalidReason = res.reason || "not_ringing";
        }
        // No record at all (legacy / DB hiccup): fail open — behave as before.
      } catch (err) {
        console.error("Error recording call:accept:", err.message);
      }
      if (invalidReason) {
        socket.emit("call:invalid", { requestId, reason: invalidReason });
        return;
      }
      emitToUser(toUserId, "call:accept", {
        requestId,
        fromUserId: socket.userId,
      });
    });
    // Callee -> server, once they tap "Decline". Relayed to the caller as
    // call:end — the exact same event/effect a decline has always had on the
    // caller's screen — while the authoritative state becomes "rejected".
    socket.on("call:reject", async ({ toUserId, requestId }) => {
      if (!(await pairOk(toUserId, requestId))) return;
      emitToUser(toUserId, "call:end", {
        requestId,
        fromUserId: socket.userId,
      });
      try {
        const call = await callState.findLatestForPair({
          requestId,
          callerId: toUserId,
          calleeId: socket.userId,
        });
        if (!call) return;
        const res = await callState.declineCall({
          callId: call._id,
          calleeId: socket.userId,
        });
        if (res.changed)
          await callLifecycle.onCallDeclined(res.call, { relay: false });
      } catch (err) {
        console.error("Error recording call:reject:", err.message);
      }
    });
    // Callee -> caller: "my call screen has mounted and is listening for an
    // offer now". The caller waits for this before creating/sending its SDP
    // offer, so the offer is never emitted into a screen that isn't open yet
    // to receive it (which was silently dropping the call before).
    socket.on("call:ready", async ({ toUserId, requestId }) => {
      if (!(await pairOk(toUserId, requestId))) return;
      emitToUser(toUserId, "call:ready", {
        requestId,
        fromUserId: socket.userId,
      });
    });
    socket.on("call:offer", async ({ toUserId, requestId, sdp }) => {
      if (!(await pairOk(toUserId, requestId))) return;
      emitToUser(toUserId, "call:offer", {
        requestId,
        sdp,
        fromUserId: socket.userId,
      });
    });
    socket.on("call:answer", async ({ toUserId, requestId, sdp }) => {
      if (!(await pairOk(toUserId, requestId))) return;
      emitToUser(toUserId, "call:answer", {
        requestId,
        sdp,
        fromUserId: socket.userId,
      });
    });
    socket.on(
      "call:ice-candidate",
      async ({ toUserId, requestId, candidate }) => {
        if (!(await pairOk(toUserId, requestId))) return;
        emitToUser(toUserId, "call:ice-candidate", {
          requestId,
          candidate,
          fromUserId: socket.userId,
        });
      },
    );
    socket.on("call:end", async ({ toUserId, requestId }) => {
      if (!(await pairOk(toUserId, requestId))) return;
      emitToUser(toUserId, "call:end", {
        requestId,
        fromUserId: socket.userId,
      });
      // Finalize the authoritative record. Accepted -> completed (+duration);
      // still ringing -> missed when the CALLER cancels (and the callee gets a
      // cancel push + MISSED_CALL), or rejected when the CALLEE ends it from
      // the native call UI. Already-terminal calls are left untouched.
      try {
        const open = await callState.findLatestOpenForUser({
          requestId,
          userId: socket.userId,
        });
        if (!open) return;
        const res = await callState.endCall({
          callId: open._id,
          userId: socket.userId,
        });
        if (!res.changed) return;
        publishCallUpdate(res.call);
        if (res.outcome === "missed")
          await callLifecycle.onCallMissed(res.call, {
            reason: "caller_cancelled",
          });
        else if (res.outcome === "rejected")
          await callLifecycle.onCallDeclined(res.call, { relay: false });
      } catch (err) {
        console.error("Error finalizing call on call:end:", err.message);
      }
    });
    // Callee -> caller: "I'm already on another call". Lets the caller find
    // out immediately instead of ringing uselessly for the full no-answer
    // window — matters more here than in a typical chat app, since this is
    // blood-donation/emergency calling and the caller may need to move on to
    // another donor right away.
    socket.on("call:busy", async ({ toUserId, requestId }) => {
      if (!(await pairOk(toUserId, requestId))) return;
      emitToUser(toUserId, "call:busy", {
        requestId,
        fromUserId: socket.userId,
      });
      // Neither side emits call:end for a busy response, so record it here —
      // otherwise the entry would sit at "ringing" until expiry mislabels it.
      try {
        const call = await callState.findLatestForPair({
          requestId,
          callerId: toUserId,
          calleeId: socket.userId,
        });
        if (!call) return;
        const res = await callState.busyCall({
          callId: call._id,
          calleeId: socket.userId,
        });
        if (res.changed) publishCallUpdate(res.call);
      } catch (err) {
        console.error("Error recording call:busy:", err.message);
      }
    });

    socket.on("disconnect", async () => {
      const userId = socket.userId;
      if (userId) {
        if ((await presence.count(userId)) === 0) {
          // Wait out brief reconnect blips before telling everyone (and the
          // DB) the user went offline; handleUserConnect cancels this timer.
          cancelPendingOffline(userId);
          const timer = setTimeout(async () => {
            pendingOffline.delete(userId);
            if ((await presence.count(userId)) === 0) {
              await setUserOnlineStatus(userId, false);
            }
          }, OFFLINE_GRACE_MS);
          pendingOffline.set(userId, timer);
        }
      }
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    console.warn("⚠️ Warning: getIO() called before socket initialization!");
  }
  return io;
};

const emitToUser = (userId, event, payload) => {
  if (io && userId) {
    io.to(userId.toString()).emit(event, payload);
  }
};

// Real-time call history (Calls tab). Called AFTER a Call document has been
// created/updated in the database, and pushes the finished row to BOTH
// participants over their personal socket rooms — each one shaped from their
// own point of view (direction / "missed" differ per side) by the same
// serializer GET /calls/history uses.
//
// Why this exists instead of the client just re-fetching on call:* events:
// those events are relayed to the peer before the DB write lands, so a
// re-fetch triggered by them raced the write and returned stale data. This
// event is only ever emitted once the write is done, and it also reaches the
// side that *caused* the change (the caller on invite, whoever hangs up or
// declines), which never receives its own call:* events.
//
// Best-effort like the rest of the call-history bookkeeping: it never throws
// into a socket handler, so a failure here can't affect the call itself.
const publishCallUpdate = async (call) => {
  try {
    if (!io || !call) return;
    const { serializeCallForUser } = require("../controllers/callController");
    const User = getUserModel();
    const callerId = call.callerId.toString();
    const calleeId = call.calleeId.toString();
    const users = await User.find({
      _id: { $in: [callerId, calleeId] },
    }).select("name profilePicture");
    const byId = new Map(users.map((u) => [u._id.toString(), u]));
    const plain = typeof call.toObject === "function" ? call.toObject() : call;
    // A user who deleted this call from their own history must not have it
    // pop back when a later state change (e.g. hang-up) is pushed.
    const hiddenFor = (plain.deletedFor || []).map((x) => x.toString());
    if (!hiddenFor.includes(callerId)) {
      emitToUser(callerId, "call:history:update", {
        call: serializeCallForUser(plain, callerId, byId),
      });
    }
    if (!hiddenFor.includes(calleeId)) {
      emitToUser(calleeId, "call:history:update", {
        call: serializeCallForUser(plain, calleeId, byId),
      });
    }
  } catch (err) {
    console.error("Error publishing call history update:", err.message);
  }
};

// True if `userId` currently has at least one live socket connected (i.e. the
// app is open and online on some screen). Used for the "Delivered" tick.
const isUserConnected = (userId) => {
  if (!io || !userId) return false;
  const room = io.sockets.adapter.rooms.get(userId.toString());
  return !!room && room.size > 0;
};

// Groups message docs by sender + request so each sender gets one socket event
// per thread instead of one per message.
const groupBySenderAndRequest = (docs) => {
  const groups = new Map();
  for (const m of docs) {
    const key = `${m.senderId}|${m.requestId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        senderId: String(m.senderId),
        requestId: String(m.requestId),
        messageIds: [],
      });
    }
    groups.get(key).messageIds.push(String(m._id));
  }
  return [...groups.values()];
};

// Marks the reader's unread INCOMING messages as read (optionally limited to
// specific threads / message ids) and tells each original sender live, so
// their ticks turn blue. Only ever touches messages addressed to `readerId`.
// Used by the `message_read` socket event and by the REST endpoints that
// already marked threads read (chatController.markThreadRead/getUserMessages).
const markMessagesRead = async ({ readerId, requestIds, messageIds }) => {
  if (!readerId) return [];
  const Message = require("../models/messageModel");
  const filter = { receiverId: readerId, isRead: false };
  if (requestIds && requestIds.length) filter.requestId = { $in: requestIds };
  if (messageIds && messageIds.length) filter._id = { $in: messageIds };

  const unread = await Message.find(filter)
    .select("_id senderId requestId")
    .lean();
  if (unread.length === 0) return [];

  const readAt = new Date();
  const ids = unread.map((m) => m._id);
  await Message.updateMany(
    { _id: { $in: ids } },
    { $set: { isRead: true, readAt } },
  );
  // Read implies delivered — backfill for messages that never got a delivery stamp.
  await Message.updateMany(
    { _id: { $in: ids }, deliveredAt: null },
    { $set: { deliveredAt: readAt } },
  );

  for (const g of groupBySenderAndRequest(unread)) {
    emitToUser(g.senderId, "messages_marked_read", {
      requestId: g.requestId,
      messageIds: g.messageIds,
      readerId: String(readerId),
      readAt,
    });
  }
  return unread.map((m) => String(m._id));
};

// When a user's app connects, everything sent to them while they were offline
// becomes "delivered" — flip the senders' single tick to a double tick live.
const markMessagesDelivered = async (userId) => {
  if (!userId) return;
  const Message = require("../models/messageModel");
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const pending = await Message.find({
    receiverId: userId,
    deliveredAt: null,
    isRead: false,
    createdAt: { $gte: since },
  })
    .select("_id senderId requestId")
    .limit(500)
    .lean();
  if (pending.length === 0) return;

  const deliveredAt = new Date();
  await Message.updateMany(
    { _id: { $in: pending.map((m) => m._id) } },
    { $set: { deliveredAt } },
  );
  for (const g of groupBySenderAndRequest(pending)) {
    emitToUser(g.senderId, "message_delivered", {
      requestId: g.requestId,
      messageIds: g.messageIds,
      deliveredAt,
    });
  }
};

// Generic room emit — used for the chat room's live-location updates
// (chatController's chat_location_update), where several participants need the
// same broadcast rather than a single userId.
const emitToRoom = (room, event, payload) => {
  if (io && room) {
    io.to(room).emit(event, payload);
  }
};

// True if `userId` has a live socket currently sitting in chat_<requestId>
// (see join_chat/leave_chat above) — i.e. they're actively looking at that
// thread right now, not just online somewhere else in the app.
const isUserInChatRoom = (userId, requestId) => {
  if (!io || !userId || !requestId) return false;
  const room = io.sockets.adapter.rooms.get(`chat_${requestId}`);
  if (!room) return false;
  for (const socketId of room) {
    if (io.sockets.sockets.get(socketId)?.userId === userId.toString()) {
      return true;
    }
  }
  return false;
};

/**
 * Sends a real-time push notification using Firebase Cloud Messaging (FCM)
 */
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) {
    console.log("[Push Notification Skipped] Missing FCM Token");
    return;
  }

  // FCM data values MUST strictly be strings
  const formattedData = {};
  for (const key in data) {
    if (data[key] !== undefined && data[key] !== null) {
      formattedData[key] =
        typeof data[key] === "object"
          ? JSON.stringify(data[key])
          : String(data[key]);
    }
  }

  const pushTitle = title || "Blood Donation Alert";
  const pushBody = body || "";

  const messagePayload = {
    token: fcmToken,
    notification: {
      title: pushTitle,
      body: pushBody,
    },
    data: formattedData,
    android: {
      priority: "high", // Delivers immediately across lock/doze states
      notification: {
        title: pushTitle,
        body: pushBody,
        sound: "default",
        channelId: "high_importance_v1", // High priority channel for drop-down banner
        priority: "max", // Enables Android heads-up drop-down banner
        visibility: "public", // Displays on locked screen
        defaultVibrateTimings: true,
        defaultLightSettings: true,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          contentAvailable: true,
        },
      },
    },
  };

  try {
    const response = await messaging.send(messagePayload);
    if (process.env.SOCKET_DEBUG)
      console.log("🔥 FCM Push Notification Sent Successfully:", response);
    return response;
  } catch (error) {
    console.error(
      "❌ Error sending FCM push notification:",
      error.message || error,
    );
  }
};

const notifyUser = async ({
  userId,
  fcmToken,
  title,
  body,
  data,
  socketEvent,
  socketPayload,
}) => {
  if (socketEvent) {
    emitToUser(userId, socketEvent, socketPayload);
  }
  if (fcmToken) {
    await sendPushNotification(fcmToken, title, body, data);
  }
};

// A regular push (sendPushNotification above) is what's used everywhere else
// in this app, and it works for calls too *while iOS still has some process
// time left* (backgrounded but not yet suspended/killed). It does NOT reliably
// wake an iOS app that's already been killed — which is exactly when an
// incoming call notification matters most. PushKit VoIP pushes are Apple's
// mechanism for that specific case: the OS wakes the app for a VoIP push even
// from fully killed, no matter what, provided the payload is actually used to
// report a call via CallKit (Apple can throttle/revoke VoIP push privileges
// for an app that accepts VoIP pushes without displaying a CallKit call, so
// the client-side CallKeep wiring in src/services/callKeepService.ts must
// stay in lock-step with this).
//
// IMPORTANT — this depends on the Firebase project's APNs credentials being a
// token-based .p8 Auth Key (Firebase Console → Project Settings → Cloud
// Messaging → Apple app configuration). A .p8 key can send to any APNs topic
// for the app, including the required "<bundleId>.voip" VoIP topic used below.
// A legacy .p12 certificate is typically scoped to standard push only and
// won't deliver this. This is the one piece of this integration that cannot
// be verified without an actual VoIP-registered iOS build on a real device —
// confirm it end-to-end there before relying on it.
const sendVoipPushNotification = async (voipToken, data = {}) => {
  if (!voipToken) return;

  const formattedData = {};
  for (const key of Object.keys(data)) {
    if (data[key] !== undefined && data[key] !== null) {
      formattedData[key] =
        typeof data[key] === "object"
          ? JSON.stringify(data[key])
          : String(data[key]);
    }
  }

  const bundleId = process.env.IOS_BUNDLE_ID || "com.blooddonation.app";

  // Preferred path: talk to APNs directly (a PushKit token is not an FCM token,
  // so FCM can't deliver it). Active only once the APNS_* env vars are set — see
  // services/apnsVoipService.js. On any failure fall through to the previous
  // behaviour; the caller then falls back to a normal alert push.
  if (apnsVoip.isConfigured()) {
    const direct = await apnsVoip.sendVoip(voipToken, formattedData);
    if (direct.sent) {
      console.log("📞 VoIP push sent via APNs");
      return direct;
    }
    console.error("❌ APNs VoIP push failed:", direct.reason);
  }

  try {
    const response = await messaging.send({
      token: voipToken,
      data: formattedData,
      apns: {
        headers: {
          "apns-push-type": "voip",
          "apns-topic": `${bundleId}.voip`,
          "apns-priority": "10",
          "apns-expiration": "0",
        },
        payload: {
          aps: {
            // VoIP payloads carry no visible "notification" of their own —
            // the app is woken silently and is responsible for calling
            // RNCallKeep.displayIncomingCall itself (see callKeepService.ts),
            // which is what actually produces the native ringing UI.
            "content-available": 1,
          },
        },
      },
    });
    console.log("📞 VoIP push sent:", response);
    return response;
  } catch (error) {
    console.error(
      "❌ Error sending VoIP push notification:",
      error.message || error,
    );
  }
};

module.exports = {
  initSocket,
  getIO,
  emitToUser,
  emitToRoom,
  publishCallUpdate,
  isUserInChatRoom,
  isUserConnected,
  // Cluster-aware versions (correct across several server instances) — prefer these.
  isUserConnectedAsync: (userId) => presence.userConnected(userId),
  isUserInChatRoomAsync: (userId, requestId) =>
    presence.inChatRoom(userId, requestId),
  markMessagesRead,
  markMessagesDelivered,
  sendPushNotification,
  sendVoipPushNotification,
  notifyUser,
};

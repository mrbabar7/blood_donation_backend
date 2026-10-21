// "Is this user / chat room live right now?" — correct on one instance AND across many.
//
// On a single instance the answer comes straight from Socket.IO's in-memory rooms
// (fast path, same as before). With the Redis adapter ("cluster mode") a room's members
// are spread over several servers and the local map only knows its own, so the question
// is put to the whole cluster with fetchSockets(). `io` and the cluster flag are passed
// in as getters so this is unit-testable with a fake io.
const create = ({ getIo, isCluster }) => {
  const localCount = (room) => {
    const io = getIo();
    const r = io && io.sockets && io.sockets.adapter && io.sockets.adapter.rooms.get(String(room));
    return r ? r.size : 0;
  };

  // Number of live sockets in a room (cluster-wide in cluster mode).
  const count = async (room) => {
    const io = getIo();
    if (!io || !room) return 0;
    if (!isCluster()) return localCount(room);
    try {
      return (await io.in(String(room)).fetchSockets()).length;
    } catch {
      return localCount(room); // cluster query failed: best local answer
    }
  };

  const userConnected = async (userId) => !!userId && (await count(String(userId))) > 0;

  // True if the user has a socket inside chat_<requestId> (looking at that thread now).
  const inChatRoom = async (userId, requestId) => {
    const io = getIo();
    if (!io || !userId || !requestId) return false;
    const uid = String(userId);
    const room = `chat_${requestId}`;
    const ofSocket = (s) => (s.data && s.data.userId) || s.userId;
    if (isCluster()) {
      try {
        return (await io.in(room).fetchSockets()).some((s) => ofSocket(s) === uid);
      } catch {
        /* fall through to local */
      }
    }
    const members = io.sockets.adapter.rooms.get(room);
    if (!members) return false;
    for (const id of members) {
      const s = io.sockets.sockets.get(id);
      if (s && ofSocket(s) === uid) return true;
    }
    return false;
  };

  return { count, userConnected, inChatRoom };
};

module.exports = { create };

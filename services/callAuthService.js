// Authorization for call signaling (Socket.IO call:* events).
//
// Before this existed, any authenticated socket could ring any user id, or relay SDP /
// ICE to any user id, with any requestId. A call is only legitimate between the two
// participants of one DonationRequest (its seeker and its donor's user), and only while
// that request is in a state where the chat (and therefore a call) is open.
//
// Pure + injectable (tests use fakes). The default export is wired to the real models.
const { cached } = require("../utils/ttlCache");
const { CHAT_STATUSES } = require("./donationLifecycle/constants");

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const PARTICIPANT_TTL_MS = Number(process.env.CALL_AUTH_CACHE_MS) || 30_000;
const str = (v) => (v == null ? "" : String(v));

function createCallAuth({ DonationRequest, Donor, cache = cached }) {
  // Always a fresh read: status + the two participants' user ids.
  async function fetchRequest(requestId) {
    const id = str(requestId);
    if (!OBJECT_ID.test(id)) return null;
    const r = await DonationRequest.findById(id).select("seekerId donorId status").lean();
    if (!r) return null;
    const donor = r.donorId ? await Donor.findById(r.donorId).select("userId").lean() : null;
    if (!donor || !donor.userId) return null;
    return { seekerId: str(r.seekerId), donorUserId: str(donor.userId), status: r.status };
  }

  // Participants never change for a request, so signaling (dozens of ICE candidates per
  // call) is served from a short single-flight cache instead of one query per message.
  // A failed lookup is not cached (ttlCache stores successes only).
  const participants = async (requestId) => {
    const id = str(requestId);
    if (!OBJECT_ID.test(id)) return null;
    return cache(`callauth:${id}`, PARTICIPANT_TTL_MS, async () => fetchRequest(id));
  };

  /** True only when {userA, userB} are exactly the two participants of the request. */
  async function isCallPair({ requestId, userA, userB }) {
    const a = str(userA);
    const b = str(userB);
    if (!a || !b || a === b) return false;
    const p = await participants(requestId);
    if (!p) return false;
    return (a === p.seekerId && b === p.donorUserId) || (a === p.donorUserId && b === p.seekerId);
  }

  /** Starting a call: participants AND the request must be in a chat-open status (fresh read). */
  async function canInvite({ requestId, callerId, calleeId }) {
    const caller = str(callerId);
    const callee = str(calleeId);
    if (!caller || !callee || caller === callee) return { ok: false, reason: "invalid_pair" };
    const p = await fetchRequest(requestId);
    if (!p) return { ok: false, reason: "no_request" };
    const pair =
      (caller === p.seekerId && callee === p.donorUserId) || (caller === p.donorUserId && callee === p.seekerId);
    if (!pair) return { ok: false, reason: "not_participants" };
    if (!CHAT_STATUSES.includes(p.status)) return { ok: false, reason: "request_not_open" };
    return { ok: true };
  }

  return { isCallPair, canInvite, participants, fetchRequest };
}

let instance = null;
const get = () => {
  if (!instance) {
    const { DonationRequest, Donor } = require("../models/formModel");
    instance = createCallAuth({ DonationRequest, Donor });
  }
  return instance;
};

module.exports = {
  createCallAuth,
  isCallPair: (args) => get().isCallPair(args),
  canInvite: (args) => get().canInvite(args),
};

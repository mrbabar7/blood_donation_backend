const test = require("node:test");
const assert = require("node:assert/strict");

const C = require("../services/donationLifecycle/constants");
const sm = require("../services/donationLifecycle/stateMachine");
const { render } = require("../services/donationLifecycle/messages");
const { createLifecycleService } = require("../services/donationLifecycle/service");

const { STATUS } = C;
const H = C.HOUR_MS;

// ------------------------------------------------------------------ in-memory fake ----
const same = (a, b) => {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return String(a) === String(b);
};
const cmp = (a, b) => new Date(a).getTime() - new Date(b).getTime();
const matchField = (val, cond) => {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, v]) => {
      switch (op) {
        case "$in": return v.some((x) => (x === null ? val == null : same(val, x)));
        case "$ne": return v === null ? val != null : !(val != null && same(val, v));
        case "$gt": return val != null && cmp(val, v) > 0;
        case "$gte": return val != null && cmp(val, v) >= 0;
        case "$lt": return val != null && cmp(val, v) < 0;
        case "$lte": return val != null && cmp(val, v) <= 0;
        default: throw new Error(`fake: unsupported operator ${op}`);
      }
    });
  }
  if (cond === null) return val == null;
  return val != null && same(val, cond);
};
const matches = (doc, filter) =>
  Object.entries(filter).every(([k, cond]) => {
    if (k === "$or") return cond.some((f) => matches(doc, f));
    if (k === "$and") return cond.every((f) => matches(doc, f));
    return matchField(doc[k], cond);
  });

class Query {
  constructor(run) { this.run = run; }
  select() { return this; }
  lean() { return this; }
  sort() { return this; }
  limit(n) { this.n = n; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run(this.n)).then(res, rej); }
}

class FakeModel {
  constructor() { this.docs = []; }
  add(doc) { this.docs.push({ ...doc }); return doc; }
  get(id) { return this.docs.find((d) => same(d._id, id)); }
  _apply(doc, update) {
    for (const [k, v] of Object.entries(update.$set || {})) doc[k] = v;
    for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
    for (const [k, v] of Object.entries(update.$max || {})) if (doc[k] == null || cmp(v, doc[k]) > 0) doc[k] = v;
  }
  findOneAndUpdate(filter, update, opts = {}) {
    return new Query(async () => {
      await Promise.resolve(); // yield, so concurrent callers genuinely interleave
      const doc = this.docs.find((d) => matches(d, filter));
      if (!doc) return null;
      const before = { ...doc };
      this._apply(doc, update); // synchronous = atomic, like a single Mongo write
      return opts.new ? { ...doc } : before;
    });
  }
  updateOne(filter, update) {
    return new Query(async () => {
      await Promise.resolve();
      const doc = this.docs.find((d) => matches(d, filter));
      if (doc) this._apply(doc, update);
      return { modifiedCount: doc ? 1 : 0 };
    });
  }
  updateMany(filter, update) {
    return new Query(async () => {
      this.docs.filter((d) => matches(d, filter)).forEach((d) => this._apply(d, update));
    });
  }
  findOne(filter) {
    return new Query(async () => {
      await Promise.resolve();
      const d = this.docs.find((x) => matches(x, filter));
      return d ? { ...d } : null;
    });
  }
  findById(id) { return this.findOne({ _id: id }); }
  find(filter) {
    return new Query(async (n) => {
      await Promise.resolve();
      const out = this.docs.filter((d) => matches(d, filter)).map((d) => ({ ...d }));
      return n ? out.slice(0, n) : out;
    });
  }
}

// ------------------------------------------------------------------------- harness ----
const T0 = new Date("2026-10-20T00:00:00.000Z");

function harness() {
  const state = { now: new Date(T0) };
  const DonationRequest = new FakeModel();
  const Donor = new FakeModel();
  const notes = [];
  const events = [];
  const svc = createLifecycleService({
    DonationRequest,
    Donor,
    now: () => new Date(state.now),
    notifyUser: async (n) => { notes.push(n); },
    emitStatus: (e) => { events.push(e); },
    markNotificationsRead: async () => [],
  });
  let seq = 0;
  const donor = (id, extra = {}) =>
    Donor.add({ _id: id, userId: `u-${id}`, fullName: `Donor ${id}`, isAvailable: true, activeDonationRequestId: null, ...extra });
  const request = (seekerId, donorId, extra = {}) =>
    DonationRequest.add({
      _id: `r${++seq}`, seekerId, donorId, status: STATUS.PENDING,
      requestedAt: new Date(state.now), expiresAt: sm.expiresAtFor(state.now), ...extra,
    });
  const at = (ms) => { state.now = new Date(T0.getTime() + ms); };
  return { svc, DonationRequest, Donor, notes, events, donor, request, state, at };
}
const keys = (notes) => notes.map((n) => n.key);

// ================================================================ state machine ====
test("expiry is exactly requestedAt + 12 hours", () => {
  assert.equal(sm.expiresAtFor(T0).getTime() - T0.getTime(), 12 * H);
  assert.equal(C.REQUEST_TTL_MS, 12 * H);
});

test("isPastExpiry: before / at / after the deadline", () => {
  const exp = sm.expiresAtFor(T0);
  assert.equal(sm.isPastExpiry(exp, new Date(exp.getTime() - 1)), false);
  assert.equal(sm.isPastExpiry(exp, new Date(exp)), true);
  assert.equal(sm.isPastExpiry(exp, new Date(exp.getTime() + 1)), true);
});

test("transition table: terminal states are closed; only released may return to pending", () => {
  for (const s of C.TERMINAL_STATUSES) {
    if (s === STATUS.RELEASED) assert.deepEqual(C.TRANSITIONS[s], [STATUS.PENDING]);
    else assert.deepEqual(C.TRANSITIONS[s], [], s);
  }
  assert.ok(sm.canTransition(STATUS.ACCEPTED, STATUS.LOCKED));
  assert.ok(!sm.canTransition(STATUS.EXPIRED, STATUS.ACCEPTED), "expired can never be revived");
  assert.ok(!sm.canTransition(STATUS.ACCEPTED, STATUS.DONATION_STARTED), "must be locked first");
  assert.ok(!sm.canTransition(STATUS.DONATION_STARTED, STATUS.COMPLETED), "must be agreed first");
  assert.ok(!sm.canTransition(STATUS.AUTO_RELEASED, STATUS.LOCKED), "auto release is permanent");
});

test("every status is covered by a group and every transition target is a known status", () => {
  const all = new Set(Object.values(STATUS));
  for (const [from, tos] of Object.entries(C.TRANSITIONS)) {
    assert.ok(all.has(from));
    tos.forEach((t) => assert.ok(all.has(t), `${from}->${t}`));
  }
  for (const s of all) assert.ok(C.ACTIVE_STATUSES.includes(s) || C.TERMINAL_STATUSES.includes(s), s);
});

test("notification texts match the product copy (en) and exist in ur", () => {
  assert.equal(render("donorLocked", "en").body, "Seeker has locked you for donation.");
  assert.equal(
    render("donorReleased", "en").body,
    "Seeker has released you. Thank you so much for your willingness to help! May Allah reward you.",
  );
  assert.equal(render("donationStarted", "en").body, "Donor has started his donation, do you agree?");
  assert.equal(
    render("onHold", "en").body,
    "Donor is currently busy with another seeker's donation process. Your request has been put On Hold. You will be notified as soon as the donor is free.",
  );
  assert.equal(render("holdReverted", "en").body, "Donor is now available again, you can continue your donation process.");
  assert.equal(
    render("renotify", "en").body,
    "Seeker needs your help again. Their previous donation could not be completed. If you are still available, please accept the request. May Allah reward you.",
  );
  for (const k of ["donorLocked", "donorReleased", "donationStarted", "onHold", "holdReverted", "renotify", "autoReleased"]) {
    assert.match(render(k, "ur").body, /[\u0600-\u06FF]/);
  }
});

// ===================================================================== expiry ======
test("expiry: 11:59:59 stays pending, 12:00:00 expires, repeated sweeps are idempotent", async () => {
  const h = harness();
  h.donor("d1");
  const r = h.request("s1", "d1");
  h.at(12 * H - 1000);
  assert.equal(await h.svc.expireDue(), 0);
  assert.equal(h.DonationRequest.get(r._id).status, STATUS.PENDING);
  h.at(12 * H);
  assert.equal(await h.svc.expireDue(), 1);
  assert.equal(h.DonationRequest.get(r._id).status, STATUS.EXPIRED);
  assert.equal(await h.svc.expireDue(), 0, "second run is a no-op");
  h.at(13 * H);
  assert.equal(await h.svc.expireDue(), 0);
  assert.equal(keys(h.notes).filter((k) => k === "requestExpired").length, 1, "seeker told exactly once");
});

test("expiry: two workers sweeping at once expire and notify exactly once", async () => {
  const h = harness();
  h.donor("d1");
  h.request("s1", "d1");
  h.at(12 * H);
  const [a, b, c] = await Promise.all([h.svc.expireDue(), h.svc.expireDue(), h.svc.expireDue()]);
  assert.equal(a + b + c, 1);
  assert.equal(keys(h.notes).filter((k) => k === "requestExpired").length, 1);
});

test("late accept never revives an expired request (even before the worker ran)", async () => {
  const h = harness();
  h.donor("d1");
  const r = h.request("s1", "d1");
  h.at(12 * H + 5000); // deadline passed, worker has NOT run yet
  const res = await h.svc.acceptRequest({ donorUserId: "u-d1", requestId: r._id });
  assert.equal(res.ok, false);
  assert.equal(res.code, "REQUEST_EXPIRED");
  assert.equal(res.status, 409);
  assert.equal(h.DonationRequest.get(r._id).status, STATUS.EXPIRED, "state was flipped, not accepted");
  const again = await h.svc.acceptRequest({ donorUserId: "u-d1", requestId: r._id });
  assert.equal(again.code, "REQUEST_EXPIRED");
});

test("accept exactly at the deadline is rejected; one second before is accepted", async () => {
  const h = harness();
  h.donor("d1");
  const early = h.request("s1", "d1");
  h.at(12 * H - 1000);
  assert.equal((await h.svc.acceptRequest({ donorUserId: "u-d1", requestId: early._id })).ok, true);
  const h2 = harness();
  h2.donor("d1");
  const r2 = h2.request("s1", "d1");
  h2.at(12 * H);
  assert.equal((await h2.svc.acceptRequest({ donorUserId: "u-d1", requestId: r2._id })).code, "REQUEST_EXPIRED");
});

test("after expiry the seeker can notify the same donor again (no open request blocks it)", async () => {
  const h = harness();
  h.donor("d1");
  h.request("s1", "d1");
  assert.ok(await h.svc.findOpenRequest("s1", "d1"), "pending blocks a duplicate");
  h.at(12 * H);
  await h.svc.expireDue();
  assert.equal(await h.svc.findOpenRequest("s1", "d1"), null);
  const stamp = h.svc.stampRequest(new Date(h.state.now));
  assert.equal(stamp.expiresAt.getTime() - stamp.requestedAt.getTime(), 12 * H);
});

test("only the addressed donor can accept / reject", async () => {
  const h = harness();
  h.donor("d1"); h.donor("d2");
  const r = h.request("s1", "d1");
  assert.equal((await h.svc.acceptRequest({ donorUserId: "u-d2", requestId: r._id })).status, 404);
  assert.equal((await h.svc.rejectRequest({ donorUserId: "u-d2", requestId: r._id })).status, 404);
  assert.equal(h.DonationRequest.get(r._id).status, STATUS.PENDING);
});

// ============================================================ lock / release ======
const accepted = (h, seeker, donorId, extra = {}) => h.request(seeker, donorId, { status: STATUS.ACCEPTED, ...extra });

test("multiple accepted requests coexist; locking one does not release the others", async () => {
  const h = harness();
  h.donor("d1"); h.donor("d2"); h.donor("d3");
  const a = accepted(h, "s1", "d1"), b = accepted(h, "s1", "d2"), c = accepted(h, "s1", "d3");
  const res = await h.svc.lock({ seekerId: "s1", requestId: a._id });
  assert.equal(res.ok, true);
  assert.equal(h.DonationRequest.get(a._id).status, STATUS.LOCKED);
  assert.equal(h.DonationRequest.get(a._id).lockedBy, "s1");
  assert.ok(h.DonationRequest.get(a._id).lockedAt);
  assert.equal(h.DonationRequest.get(b._id).status, STATUS.ACCEPTED);
  assert.equal(h.DonationRequest.get(c._id).status, STATUS.ACCEPTED);
  const n = h.notes.find((x) => x.key === "donorLocked");
  assert.equal(n.userId, "u-d1");
  assert.equal(n.critical, true, "high priority");
});

test("lock is single-winner and needs Accepted; another seeker cannot lock my request", async () => {
  const h = harness();
  h.donor("d1");
  const a = accepted(h, "s1", "d1");
  assert.equal((await h.svc.lock({ seekerId: "s2", requestId: a._id })).status, 404);
  const [x, y] = await Promise.all([
    h.svc.lock({ seekerId: "s1", requestId: a._id }),
    h.svc.lock({ seekerId: "s1", requestId: a._id }),
  ]);
  assert.equal([x, y].filter((r) => r.ok).length, 1);
  assert.equal(keys(h.notes).filter((k) => k === "donorLocked").length, 1, "one lock notification");
  const pending = h.request("s1", "d1", { status: STATUS.PENDING });
  assert.equal((await h.svc.lock({ seekerId: "s1", requestId: pending._id })).code, "INVALID_STATE");
});

test("lock is refused for a donor in the 90-day recovery", async () => {
  const h = harness();
  h.donor("d1", { nextAvailableDate: new Date(T0.getTime() + 30 * 24 * H) });
  const a = accepted(h, "s1", "d1");
  assert.equal((await h.svc.lock({ seekerId: "s1", requestId: a._id })).code, "DONOR_RESTING");
  assert.equal(h.DonationRequest.get(a._id).status, STATUS.ACCEPTED);
});

test("release: records actor/time/reason, notifies, and the seeker can notify again", async () => {
  const h = harness();
  h.donor("d1");
  const a = accepted(h, "s1", "d1");
  const res = await h.svc.release({ seekerId: "s1", requestId: a._id });
  assert.equal(res.ok, true);
  const row = h.DonationRequest.get(a._id);
  assert.equal(row.status, STATUS.RELEASED);
  assert.equal(row.releaseReason, "seeker_released");
  assert.equal(row.releasedBy, "s1");
  assert.ok(row.releasedAt);
  assert.ok(keys(h.notes).includes("donorReleased"));
  assert.equal(await h.svc.findOpenRequest("s1", "d1"), null, "Notify / Re-notify is available again");
  assert.equal((await h.svc.release({ seekerId: "s1", requestId: a._id })).code, "INVALID_STATE", "no double release");
});

// =========================================== one active donation (the mutex) ======
function twoSeekersLockedOnOneDonor() {
  const h = harness();
  h.donor("d1");
  const A = h.request("sA", "d1", { status: STATUS.LOCKED, lockedAt: T0, lockedBy: "sA" });
  const B = h.request("sB", "d1", { status: STATUS.LOCKED, lockedAt: T0, lockedBy: "sB" });
  return { h, A, B };
}

test("concurrent Donation Started for one donor: exactly one succeeds", async () => {
  const { h, A, B } = twoSeekersLockedOnOneDonor();
  const results = await Promise.all([
    h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id }),
    h.svc.startDonation({ donorUserId: "u-d1", requestId: B._id }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  const loser = results.find((r) => !r.ok);
  assert.equal(loser.code, "DONOR_BUSY");
  const rows = [h.DonationRequest.get(A._id), h.DonationRequest.get(B._id)];
  assert.equal(rows.filter((r) => r.status === STATUS.DONATION_STARTED).length, 1);
  assert.equal(rows.filter((r) => r.status === STATUS.ON_HOLD).length, 1, "the other seeker is On Hold");
  const winner = rows.find((r) => r.status === STATUS.DONATION_STARTED);
  assert.equal(String(h.Donor.get("d1").activeDonationRequestId), String(winner._id));
});

test("stress: 25 seekers race for one donor, exactly one starts", async () => {
  const h = harness();
  h.donor("d1");
  const rows = Array.from({ length: 25 }, (_, i) => h.request(`s${i}`, "d1", { status: STATUS.LOCKED, lockedAt: T0 }));
  const results = await Promise.all(rows.map((r) => h.svc.startDonation({ donorUserId: "u-d1", requestId: r._id })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(h.DonationRequest.docs.filter((d) => d.status === STATUS.DONATION_STARTED).length, 1);
  assert.equal(h.DonationRequest.docs.filter((d) => d.status === STATUS.ON_HOLD).length, 24);
});

test("start: seeker A active, B On Hold + notified; Donation Started disabled for B", async () => {
  const { h, A, B } = twoSeekersLockedOnOneDonor();
  assert.equal((await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id })).ok, true);
  assert.equal(h.DonationRequest.get(B._id).status, STATUS.ON_HOLD);
  assert.equal(String(h.DonationRequest.get(B._id).onHoldByRequestId), String(A._id));
  assert.ok(h.notes.some((n) => n.key === "onHold" && n.userId === "sB"));
  assert.ok(h.notes.some((n) => n.key === "donationStarted" && n.userId === "sA"));
  const blocked = await h.svc.startDonation({ donorUserId: "u-d1", requestId: B._id });
  assert.equal(blocked.code, "DONOR_BUSY");
  assert.equal(h.DonationRequest.get(B._id).status, STATUS.ON_HOLD);
});

test("start requires Locked: an Accepted request cannot start", async () => {
  const h = harness();
  h.donor("d1");
  const a = accepted(h, "s1", "d1");
  assert.equal((await h.svc.startDonation({ donorUserId: "u-d1", requestId: a._id })).code, "INVALID_STATE");
  assert.equal(h.Donor.get("d1").activeDonationRequestId, null);
});

test("a stale mutex (crash between the two writes) heals instead of blocking the donor", async () => {
  const h = harness();
  const stale = h.request("sX", "d1", { status: STATUS.RELEASED });
  h.donor("d1", { activeDonationRequestId: stale._id });
  const A = h.request("sA", "d1", { status: STATUS.LOCKED, lockedAt: T0 });
  const res = await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id });
  assert.equal(res.ok, true);
  assert.equal(String(h.Donor.get("d1").activeDonationRequestId), String(A._id));
});

test("locking while the donor is busy lands On Hold, never Locked", async () => {
  const { h, A } = twoSeekersLockedOnOneDonor();
  await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id });
  const C3 = accepted(h, "sC", "d1");
  const res = await h.svc.lock({ seekerId: "sC", requestId: C3._id });
  assert.equal(res.ok, true);
  assert.equal(h.DonationRequest.get(C3._id).status, STATUS.ON_HOLD);
});

// ============================================== cancel / disagree / agreement =======
test("seeker says Not Yet: explicit seeker_not_yet state, donor stays engaged and can never re-start", async () => {
  const { h, A, B } = twoSeekersLockedOnOneDonor();
  await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id });
  assert.equal(h.DonationRequest.get(B._id).status, STATUS.ON_HOLD);
  const res = await h.svc.disagree({ seekerId: "sA", requestId: A._id });
  assert.equal(res.ok, true);
  assert.equal(res.seekerNotYetCount, 1);
  const row = h.DonationRequest.get(A._id);
  assert.equal(row.status, STATUS.SEEKER_NOT_YET);
  assert.equal(row.seekerNotYetCount, 1);
  assert.ok(row.seekerNotYetAt);
  assert.ok(row.donationStartedAt, "the start timestamp is kept (no wipe)");
  assert.equal(h.Donor.get("d1").activeDonationRequestId, A._id, "donor is still engaged with this request");
  assert.equal(h.DonationRequest.get(B._id).status, STATUS.ON_HOLD, "other seekers stay On Hold");
  assert.ok(h.notes.some((n) => n.key === "donationNotAgreed" && n.userId === "u-d1"));
  // Donation Started can never be pressed again for this request, nor for another one
  const again = await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id });
  assert.equal(again.ok, false);
  assert.equal(again.code, "INVALID_STATE");
  assert.equal((await h.svc.startDonation({ donorUserId: "u-d1", requestId: B._id })).ok, false);
});

test("second Not Yet is counted; Agree afterwards moves on to donation_agreed", async () => {
  const { h, A } = twoSeekersLockedOnOneDonor();
  await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id });
  await h.svc.disagree({ seekerId: "sA", requestId: A._id });
  const second = await h.svc.disagree({ seekerId: "sA", requestId: A._id });
  assert.equal(second.ok, true);
  assert.equal(second.seekerNotYetCount, 2);
  assert.ok(second.seekerNotYetCount >= C.ESCALATE_AFTER_NOT_YET);
  assert.equal(h.DonationRequest.get(A._id).status, STATUS.SEEKER_NOT_YET);
  assert.equal((await h.svc.disagree({ seekerId: "sB", requestId: A._id })).status, 404, "only that seeker");
  // completion controls stay gated until the seeker really agrees
  assert.equal((await h.svc.markDonated({ donorUserId: "u-d1", requestId: A._id })).code, "NOT_AGREED");
  assert.equal((await h.svc.claimCompletion({ seekerId: "sA", requestId: A._id, rating: 5 })).code, "NOT_AGREED");
  assert.equal((await h.svc.agree({ seekerId: "sA", requestId: A._id })).ok, true);
  assert.equal(h.DonationRequest.get(A._id).status, STATUS.DONATION_AGREED);
  assert.equal((await h.svc.disagree({ seekerId: "sA", requestId: A._id })).code, "INVALID_STATE");
});

test("transition table: not-yet is reachable only from donation_started and leads on to agreed", () => {
  assert.ok(sm.canTransition(STATUS.DONATION_STARTED, STATUS.SEEKER_NOT_YET));
  assert.ok(sm.canTransition(STATUS.SEEKER_NOT_YET, STATUS.DONATION_AGREED));
  assert.ok(!sm.canTransition(STATUS.SEEKER_NOT_YET, STATUS.LOCKED), "never back to a startable state");
  assert.ok(!sm.canTransition(STATUS.SEEKER_NOT_YET, STATUS.DONATION_STARTED));
  assert.ok(!sm.canTransition(STATUS.LOCKED, STATUS.SEEKER_NOT_YET));
  assert.ok(C.ACCEPTED_FAMILY.includes(STATUS.SEEKER_NOT_YET), "chat + contact stay available");
  assert.ok(C.ACTIVE_STATUSES.includes(STATUS.SEEKER_NOT_YET));
});

// ================================================================ nudge / reminder ===
const notYetRow = async () => {
  const { h, A } = twoSeekersLockedOnOneDonor();
  await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id });
  await h.svc.disagree({ seekerId: "sA", requestId: A._id });
  h.notes.length = 0;
  return { h, A };
};

test("nudge: allowed in seeker_not_yet, notifies the seeker once, then a 10 min server cooldown", async () => {
  const { h, A } = await notYetRow();
  const first = await h.svc.nudgeSeeker({ donorUserId: "u-d1", requestId: A._id });
  assert.equal(first.ok, true);
  assert.equal(first.retryAfterSec, 600);
  assert.equal(h.notes.filter((n) => n.key === "donorNudge" && n.userId === "sA").length, 1);
  assert.equal(h.DonationRequest.get(A._id).nudgeCount, 1);
  // immediately again: rejected by the SERVER, no second notification
  const blocked = await h.svc.nudgeSeeker({ donorUserId: "u-d1", requestId: A._id });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.code, "NUDGE_COOLDOWN");
  assert.equal(blocked.retryAfterSec, 600);
  h.at(9 * 60 * 1000 + 59 * 1000);
  assert.equal((await h.svc.nudgeSeeker({ donorUserId: "u-d1", requestId: A._id })).code, "NUDGE_COOLDOWN");
  assert.equal(h.notes.filter((n) => n.key === "donorNudge").length, 1);
  h.at(10 * 60 * 1000);
  assert.equal((await h.svc.nudgeSeeker({ donorUserId: "u-d1", requestId: A._id })).ok, true);
  assert.equal(h.notes.filter((n) => n.key === "donorNudge").length, 2);
  assert.equal(h.DonationRequest.get(A._id).nudgeCount, 2);
});

test("nudge: concurrent taps / devices send exactly one reminder", async () => {
  const { h, A } = await notYetRow();
  const results = await Promise.all([1, 2, 3].map(() => h.svc.nudgeSeeker({ donorUserId: "u-d1", requestId: A._id })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(h.notes.filter((n) => n.key === "donorNudge").length, 1);
});

test("nudge: only the request's donor, only in seeker_not_yet", async () => {
  const { h, A } = await notYetRow();
  h.donor("d2");
  assert.equal((await h.svc.nudgeSeeker({ donorUserId: "u-d2", requestId: A._id })).status, 404, "another donor");
  assert.equal((await h.svc.nudgeSeeker({ donorUserId: "u-nobody", requestId: A._id })).status, 404);
  const L = h.request("sZ", "d1", { status: STATUS.LOCKED });
  assert.equal((await h.svc.nudgeSeeker({ donorUserId: "u-d1", requestId: L._id })).code, "INVALID_STATE");
  const S = h.request("sZ", "d1", { status: STATUS.DONATION_STARTED });
  assert.equal((await h.svc.nudgeSeeker({ donorUserId: "u-d1", requestId: S._id })).code, "INVALID_STATE");
  assert.equal(h.notes.filter((n) => n.key === "donorNudge").length, 0);
});

test("nudge notification copy exists in en + ur", () => {
  assert.match(render("donorNudge", "en", { name: "Ali" }).body, /Ali/);
  assert.match(render("donorNudge", "ur", { name: "Ali" }).body, /[\u0600-\u06FF]/);
  assert.equal(render("donorNudge", "en").type, "donor_nudge");
  assert.equal(sm.nudgeCooldownRemainingMs(null), 0);
  assert.equal(sm.nudgeCooldownRemainingMs(T0, new Date(T0.getTime() + 4 * 60 * 1000)), 6 * 60 * 1000);
});

test("report / can't-donate from seeker_not_yet free the donor and restore the held requests", async () => {
  const a = await notYetRow();
  const B = a.h.DonationRequest.docs.find((d) => d.seekerId === "sB");
  assert.equal(B.status, STATUS.ON_HOLD);
  const res = await a.h.svc.donorUnable({ donorUserId: "u-d1", requestId: a.A._id, message: "Not feeling well" });
  assert.equal(res.ok, true);
  assert.equal(a.h.Donor.get("d1").activeDonationRequestId, null);
  assert.equal(a.h.DonationRequest.get(B._id).status, STATUS.LOCKED);

  const b = await notYetRow();
  b.h.at(C.policy().reportMinWaitMs + 1000);
  const rep = await b.h.svc.reportDonor({ seekerId: "sA", requestId: b.A._id, reason: "no response" });
  assert.equal(rep.ok, true);
  assert.equal(b.h.Donor.get("d1").activeDonationRequestId, null);
});

// ============================================================ dismiss expired card ===
test("dismissing an expired card is per-donor, idempotent and never deletes the request", async () => {
  const h = harness();
  h.donor("d1"); h.donor("d2");
  const R = h.request("sA", "d1");
  h.at(12 * H);
  await h.svc.expireDue();
  assert.equal(h.DonationRequest.get(R._id).status, STATUS.EXPIRED);
  assert.equal((await h.svc.dismissExpired({ donorUserId: "u-d2", requestId: R._id })).status, 404, "another donor");
  const first = await h.svc.dismissExpired({ donorUserId: "u-d1", requestId: R._id });
  assert.equal(first.ok, true);
  const row = h.DonationRequest.get(R._id);
  assert.ok(row.donorDismissedAt);
  assert.equal(row.status, STATUS.EXPIRED, "request itself is untouched");
  assert.equal(row.seekerId, "sA");
  const stamp = new Date(row.donorDismissedAt).getTime();
  h.at(13 * H);
  const second = await h.svc.dismissExpired({ donorUserId: "u-d1", requestId: R._id });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyDismissed, true);
  assert.equal(new Date(h.DonationRequest.get(R._id).donorDismissedAt).getTime(), stamp, "not re-stamped");
  const P = h.request("sA", "d1", { status: STATUS.ACCEPTED });
  assert.equal((await h.svc.dismissExpired({ donorUserId: "u-d1", requestId: P._id })).code, "INVALID_STATE");
});

test("agreement gates the completion controls", async () => {
  const { h, A } = twoSeekersLockedOnOneDonor();
  await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id });
  assert.equal((await h.svc.markDonated({ donorUserId: "u-d1", requestId: A._id })).code, "NOT_AGREED");
  assert.equal((await h.svc.claimCompletion({ seekerId: "sA", requestId: A._id, rating: 5 })).code, "NOT_AGREED");
  assert.equal((await h.svc.agree({ seekerId: "sB", requestId: A._id })).status, 404, "only that seeker can agree");
  assert.equal((await h.svc.agree({ seekerId: "sA", requestId: A._id })).ok, true);
  assert.ok(h.DonationRequest.get(A._id).seekerAgreedAt);
  assert.equal((await h.svc.markDonated({ donorUserId: "u-d1", requestId: A._id })).ok, true);
  assert.equal((await h.svc.agree({ seekerId: "sA", requestId: A._id })).code, "INVALID_STATE", "agree is one-shot");
});

// ============================================================ inability / report ===
test("donor 'I can't donate' during an active attempt: not an allegation, frees donor, restores holds", async () => {
  const { h, A, B } = twoSeekersLockedOnOneDonor();
  await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id });
  assert.equal((await h.svc.donorUnable({ donorUserId: "u-d1", requestId: A._id, message: "  " })).code, "REASON_REQUIRED");
  const res = await h.svc.donorUnable({ donorUserId: "u-d1", requestId: A._id, message: "I am unwell today, sorry" });
  assert.equal(res.ok, true);
  const row = h.DonationRequest.get(A._id);
  assert.equal(row.status, STATUS.DONOR_UNABLE);
  assert.equal(row.releaseReason, "donor_unable");
  assert.equal(row.donorUnableReason, "I am unwell today, sorry");
  assert.ok(row.failedAt);
  assert.equal(row.reportedAt, undefined, "no allegation");
  assert.equal(h.Donor.get("d1").acceptBlockedUntil, undefined, "no restriction for a voluntary withdrawal");
  assert.equal(h.Donor.get("d1").activeDonationRequestId, null);
  assert.equal(h.DonationRequest.get(B._id).status, STATUS.LOCKED);
  assert.ok(h.notes.some((n) => n.key === "donorUnable" && n.userId === "sA" && n.params.message.includes("unwell")));
});

test("report: allegation persisted, donor temporarily restricted, cannot accept; distinct from donor_unable", async () => {
  const h = harness();
  h.donor("d1"); h.donor("d2");
  const A = h.request("sA", "d1", { status: STATUS.LOCKED, lockedAt: T0, lockedBy: "sA" });
  h.at(10 * C.MIN_MS);
  assert.equal((await h.svc.reportDonor({ seekerId: "sA", requestId: A._id, reason: "no response" })).code, "REPORT_TOO_EARLY");
  h.at(45 * C.MIN_MS);
  assert.equal((await h.svc.reportDonor({ seekerId: "sA", requestId: A._id, reason: "" })).code, "REASON_REQUIRED");
  const res = await h.svc.reportDonor({ seekerId: "sA", requestId: A._id, reason: "Agreed in chat but never came" });
  assert.equal(res.ok, true);
  const row = h.DonationRequest.get(A._id);
  assert.equal(row.status, STATUS.REPORTED);
  assert.equal(row.reportedBy, "sA");
  assert.equal(row.reportReason, "Agreed in chat but never came");
  assert.ok(row.reportedAt && row.failedAt);
  assert.equal(row.releaseReason, "seeker_reported");
  const until = h.Donor.get("d1").acceptBlockedUntil;
  assert.equal(until.getTime() - h.state.now.getTime(), C.policy().donorReportBlockMs);
  const other = h.request("sZ", "d1");
  assert.equal((await h.svc.acceptRequest({ donorUserId: "u-d1", requestId: other._id })).code, "DONOR_RESTRICTED");
  h.at(45 * C.MIN_MS + C.policy().donorReportBlockMs + 1000);
  assert.equal((await h.svc.acceptRequest({ donorUserId: "u-d1", requestId: other._id })).code, "REQUEST_EXPIRED");
});

test("report after the donor already marked 'donated' is refused", async () => {
  const h = harness();
  h.donor("d1");
  const A = h.request("sA", "d1", { status: STATUS.DONATION_AGREED, lockedAt: T0, donorMarkedDonatedAt: T0 });
  h.at(2 * H);
  assert.equal((await h.svc.reportDonor({ seekerId: "sA", requestId: A._id, reason: "late" })).code, "INVALID_STATE");
});

// ================================================= completion / auto-release =======
test("completion: atomic (double tap counts once) and permanently auto-releases other locked/on-hold; accepted-unlocked untouched", async () => {
  const h = harness();
  h.donor("d1");
  const A = h.request("sA", "d1", { status: STATUS.LOCKED, lockedAt: T0 });
  const B = h.request("sB", "d1", { status: STATUS.LOCKED, lockedAt: T0 });
  const D = accepted(h, "sD", "d1");
  await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id }); // B -> on hold
  await h.svc.agree({ seekerId: "sA", requestId: A._id });
  await h.svc.markDonated({ donorUserId: "u-d1", requestId: A._id });

  const [c1, c2] = await Promise.all([
    h.svc.claimCompletion({ seekerId: "sA", requestId: A._id, rating: 5 }),
    h.svc.claimCompletion({ seekerId: "sA", requestId: A._id, rating: 5 }),
  ]);
  assert.equal([c1, c2].filter((r) => r.ok).length, 1, "livesSaved can only be incremented once");
  const ok1 = c1.ok ? c1 : c2;
  const released = await h.svc.afterCompletion({ request: ok1.request, donorUserId: "u-d1" });
  assert.equal(released, 1);
  assert.equal(h.DonationRequest.get(A._id).status, STATUS.COMPLETED);
  assert.equal(h.DonationRequest.get(B._id).status, STATUS.AUTO_RELEASED);
  assert.equal(h.DonationRequest.get(B._id).releaseReason, "auto_other_donation");
  assert.equal(h.DonationRequest.get(D._id).status, STATUS.ACCEPTED, "unrelated accepted request left alone");
  assert.equal(h.Donor.get("d1").activeDonationRequestId, null);
  assert.ok(h.notes.some((n) => n.key === "autoReleased" && n.userId === "sB"));
  // permanent: B can never come back
  assert.equal((await h.svc.disagree({ seekerId: "sB", requestId: B._id })).ok, false);
  assert.equal((await h.svc.startDonation({ donorUserId: "u-d1", requestId: B._id })).ok, false);
  assert.equal(sm.canTransition(STATUS.AUTO_RELEASED, STATUS.LOCKED), false);
});

test("lock that races with a completed donation is auto-released, not left Locked", async () => {
  const h = harness();
  h.donor("d1", { nextAvailableDate: new Date(T0.getTime() + 90 * 24 * H) });
  const a = accepted(h, "s1", "d1");
  const res = await h.svc.lock({ seekerId: "s1", requestId: a._id });
  assert.equal(res.code, "DONOR_RESTING");
  assert.equal(h.DonationRequest.get(a._id).status, STATUS.ACCEPTED);
});

// =============================================================== bulk re-notify ====
function renotifyWorld() {
  const h = harness();
  ["d1", "d2", "d3", "d4", "d5"].forEach((d) => h.donor(d));
  h.at(1 * H);
  const rel = (donorId, extra = {}) =>
    h.request("s1", donorId, {
      status: STATUS.RELEASED, releaseReason: "seeker_released", releasedAt: new Date(h.state.now), releasedBy: "s1", ...extra,
    });
  return { h, rel };
}

test("Re-notify count: needs a failure (donor_unable or reported) AND a normally released donor", async () => {
  const { h, rel } = renotifyWorld();
  rel("d1"); rel("d2");
  assert.equal((await h.svc.renotifyInfo({ seekerId: "s1" })).count, 0, "no failure yet -> hidden");
  h.at(2 * H);
  h.request("s1", "d3", { status: STATUS.DONOR_UNABLE, failedAt: new Date(h.state.now) });
  const info = await h.svc.renotifyInfo({ seekerId: "s1" });
  assert.equal(info.count, 2);
  assert.equal(info.visible, true);
});

test("Re-notify excludes allegation / auto-released / donor_unable rows, stale (>12h) releases and donors already re-requested", async () => {
  const { h, rel } = renotifyWorld();
  rel("d1"); // eligible
  rel("d2", { reportedAt: new Date(h.state.now) }); // allegation related
  h.request("s1", "d3", { status: STATUS.AUTO_RELEASED, releaseReason: "auto_other_donation", releasedAt: new Date(h.state.now) });
  h.request("s1", "d4", { status: STATUS.RELEASED, releaseReason: "seeker_released", releasedAt: new Date(T0.getTime() - 11 * H) }); // older than 12h at check time
  rel("d5");
  h.request("s1", "d5", { status: STATUS.PENDING }); // already re-notified individually
  h.at(2 * H);
  h.request("s1", "dX", { status: STATUS.REPORTED, failedAt: new Date(h.state.now), reportedAt: new Date(h.state.now) });
  const info = await h.svc.renotifyInfo({ seekerId: "s1" });
  assert.deepEqual(info.eligible.map((r) => r.donorId), ["d1"]);
});

test("Re-notify window: a release older than 12 hours and a stale failure no longer count", async () => {
  const { h, rel } = renotifyWorld();
  rel("d1");
  h.at(1.5 * H);
  h.request("s1", "d3", { status: STATUS.DONOR_UNABLE, failedAt: new Date(h.state.now) });
  assert.equal((await h.svc.renotifyInfo({ seekerId: "s1" })).count, 1);
  h.at(1 * H + 12 * H + 1000); // release is now just over 12 h old
  assert.equal((await h.svc.renotifyInfo({ seekerId: "s1" })).count, 0);
});

test("Bulk re-notify: rows return to Pending with a fresh server 12h window, donors notified once; repeat is a no-op", async () => {
  const { h, rel } = renotifyWorld();
  const r1 = rel("d1"), r2 = rel("d2");
  h.at(2 * H);
  h.request("s1", "d3", { status: STATUS.DONOR_UNABLE, failedAt: new Date(h.state.now) });
  const res = await h.svc.bulkRenotify({ seekerId: "s1" });
  assert.equal(res.ok, true);
  assert.equal(res.renotified, 2);
  for (const r of [r1, r2]) {
    const row = h.DonationRequest.get(r._id);
    assert.equal(row.status, STATUS.PENDING);
    assert.equal(row.requestedAt.getTime(), h.state.now.getTime());
    assert.equal(row.expiresAt.getTime() - row.requestedAt.getTime(), 12 * H);
    assert.equal(row.releaseReason, null);
    assert.equal(row.renotifyCount, 1);
  }
  assert.equal(keys(h.notes).filter((k) => k === "renotify").length, 2);
  const again = await h.svc.bulkRenotify({ seekerId: "s1" });
  assert.equal(again.ok, false);
  assert.equal(again.code, "NOTHING_TO_RENOTIFY");
  assert.equal(keys(h.notes).filter((k) => k === "renotify").length, 2, "no duplicate notifications");
});

test("Bulk re-notify: concurrent double tap transitions and notifies each donor once", async () => {
  const { h, rel } = renotifyWorld();
  rel("d1"); rel("d2");
  h.at(2 * H);
  h.request("s1", "d3", { status: STATUS.REPORTED, failedAt: new Date(h.state.now), reportedAt: new Date(h.state.now) });
  const results = await Promise.all([h.svc.bulkRenotify({ seekerId: "s1" }), h.svc.bulkRenotify({ seekerId: "s1" })]);
  const total = results.reduce((n, r) => n + (r.ok ? r.renotified : 0), 0);
  assert.equal(total, 2);
  assert.equal(keys(h.notes).filter((k) => k === "renotify").length, 2);
});

test("Bulk re-notify: unavailable donors are skipped (partial result), the rest proceed; expired donors can answer", async () => {
  const { h, rel } = renotifyWorld();
  h.Donor.get("d2").isAvailable = false;
  rel("d1"); const r2 = rel("d2");
  h.at(2 * H);
  h.request("s1", "d3", { status: STATUS.DONOR_UNABLE, failedAt: new Date(h.state.now) });
  const res = await h.svc.bulkRenotify({ seekerId: "s1" });
  assert.equal(res.renotified, 1);
  assert.equal(res.skipped, 1);
  assert.equal(h.DonationRequest.get(r2._id).status, STATUS.RELEASED, "skipped row stays released");
});

test("Bulk re-notify is refused while the seeker has an unconfirmed finished donation", async () => {
  const { h, rel } = renotifyWorld();
  rel("d1");
  h.request("s1", "d3", { status: STATUS.DONOR_UNABLE, failedAt: new Date(h.state.now) });
  h.request("s1", "d4", { status: STATUS.DONATION_AGREED, donorMarkedDonatedAt: new Date(T0.getTime()) });
  h.at(1 * H + C.policy().seekerCompleteBlockAfterMs + 1000);
  assert.equal((await h.svc.bulkRenotify({ seekerId: "s1" })).code, "SEEKER_BLOCKED");
});

// ===================================================== reminders / seeker block ====
test("reminders: every 6 hours, never duplicated across workers, stop on completion", async () => {
  const h = harness();
  h.donor("d1");
  const A = h.request("sA", "d1", { status: STATUS.LOCKED, lockedAt: T0 });
  await h.svc.startDonation({ donorUserId: "u-d1", requestId: A._id });
  await h.svc.agree({ seekerId: "sA", requestId: A._id });
  await h.svc.markDonated({ donorUserId: "u-d1", requestId: A._id });
  const sent = () => h.notes.filter((n) => n.key === "completeReminder").length;

  h.at(6 * H - 1000);
  assert.equal(await h.svc.sendDueReminders(), 0);
  h.at(6 * H);
  const [a, b] = await Promise.all([h.svc.sendDueReminders(), h.svc.sendDueReminders()]);
  assert.equal(a + b, 1, "two workers, one reminder");
  assert.equal(sent(), 1);
  h.at(6 * H + 1000);
  assert.equal(await h.svc.sendDueReminders(), 0);
  h.at(12 * H);
  assert.equal(await h.svc.sendDueReminders(), 1);
  assert.equal(h.DonationRequest.get(A._id).reminderCount, 2);

  const done = await h.svc.claimCompletion({ seekerId: "sA", requestId: A._id, rating: 5 });
  assert.equal(done.ok, true);
  h.at(30 * H);
  assert.equal(await h.svc.sendDueReminders(), 0, "stopped immediately after completion");
});

test("reminders stop when the request is no longer donation_agreed (e.g. cancelled)", async () => {
  const h = harness();
  h.donor("d1");
  h.request("sA", "d1", { status: STATUS.REPORTED, donorMarkedDonatedAt: T0, nextReminderAt: T0 });
  h.request("sB", "d1", { status: STATUS.DONATION_AGREED, donorMarkedDonatedAt: null, nextReminderAt: T0 });
  h.at(7 * H);
  assert.equal(await h.svc.sendDueReminders(), 0);
});

test("mark donated is idempotent and does not restart the reminder clock", async () => {
  const h = harness();
  h.donor("d1");
  const A = h.request("sA", "d1", { status: STATUS.DONATION_AGREED, lockedAt: T0 });
  const first = await h.svc.markDonated({ donorUserId: "u-d1", requestId: A._id });
  h.at(3 * H);
  const second = await h.svc.markDonated({ donorUserId: "u-d1", requestId: A._id });
  assert.equal(first.ok, true);
  assert.equal(second.alreadyMarked, true);
  assert.equal(h.DonationRequest.get(A._id).nextReminderAt.getTime(), T0.getTime() + 6 * H);
});

test("seeker block: only after the configured wait, and lifted the moment the request is completed", async () => {
  const h = harness();
  h.donor("d1");
  const A = h.request("sA", "d1", { status: STATUS.DONATION_AGREED, donorMarkedDonatedAt: T0 });
  h.at(C.policy().seekerCompleteBlockAfterMs - 1000);
  assert.equal(await h.svc.seekerCompletionBlock("sA"), null);
  h.at(C.policy().seekerCompleteBlockAfterMs + 1000);
  assert.equal(await h.svc.seekerCompletionBlock("sA"), String(A._id));
  assert.equal(await h.svc.seekerCompletionBlock("sOther"), null);
  await h.svc.claimCompletion({ seekerId: "sA", requestId: A._id, rating: 4 });
  assert.equal(await h.svc.seekerCompletionBlock("sA"), null);
});

test("completion rejects non-owners and wrong states", async () => {
  const h = harness();
  h.donor("d1");
  const A = h.request("sA", "d1", { status: STATUS.DONATION_AGREED });
  assert.equal((await h.svc.claimCompletion({ seekerId: "intruder", requestId: A._id, rating: 5 })).code, "FORBIDDEN");
  const P = h.request("sA", "d1", { status: STATUS.PENDING });
  assert.equal((await h.svc.claimCompletion({ seekerId: "sA", requestId: P._id, rating: 5 })).code, "INVALID_STATE");
});

test("backfill clears legacy TTL on live requests (they must never be purged mid-lifecycle)", async () => {
  const h = harness();
  h.donor("d1");
  const A = h.request("sA", "d1", { status: STATUS.ACCEPTED, expireAt: new Date(T0.getTime() + 7 * 24 * H) });
  const R = h.request("sA", "d2", { status: STATUS.REJECTED, expireAt: new Date(T0.getTime() + 7 * 24 * H) });
  await h.svc.backfill();
  assert.equal(h.DonationRequest.get(A._id).expireAt, null);
  assert.ok(h.DonationRequest.get(R._id).expireAt, "rejected rows keep their 7-day retention");
});

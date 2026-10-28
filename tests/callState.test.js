// // Run with:  node --test tests/callState.test.js     (npm run test:calls)
// // Pure logic: no MongoDB, no Firebase. A tiny in-memory Call model implements
// // exactly the query operators callStateService uses.
// const test = require("node:test");
// const assert = require("node:assert/strict");
// const state = require("../services/callStateService");
// const push = require("../services/callPushService");

// // ---------------------------------------------------------------- fake model
// const matches = (doc, filter) =>
//   Object.entries(filter).every(([k, cond]) => {
//     if (k === "$or") return cond.some((f) => matches(doc, f));
//     const v = doc[k];
//     if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
//       return Object.entries(cond).every(([op, x]) => {
//         if (op === "$gt") return v != null && v > x;
//         if (op === "$lte") return v != null && v <= x;
//         if (op === "$in") return x.map(String).includes(String(v));
//         if (op === "$exists") return x ? v !== undefined : v === undefined;
//         throw new Error("unsupported op " + op);
//       });
//     }
//     return String(v) === String(cond);
//   });

// const makeModel = () => {
//   const docs = [];
//   let n = 0;
//   const clone = (d) => (d ? { ...d } : null);
//   const q = (list) => {
//     const p = Promise.resolve(list);
//     p.sort = (spec) => {
//       const [[f, dir]] = Object.entries(spec);
//       return Promise.resolve([...list].sort((a, b) => (a[f] > b[f] ? dir : -dir)));
//     };
//     return p;
//   };
//   const one = (list) => {
//     const first = list[0];
//     const p = Promise.resolve(clone(first));
//     p.sort = (spec) => {
//       const [[f, dir]] = Object.entries(spec);
//       return Promise.resolve(clone([...list].sort((a, b) => (a[f] > b[f] ? -dir : dir))[0]));
//     };
//     return p;
//   };
//   return {
//     docs,
//     async create(d) {
//       n += 1;
//       const doc = { _id: `c${n}`, createdAt: new Date(Date.now() + n), ...d };
//       docs.push(doc);
//       return clone(doc);
//     },
//     find: (f) => q(docs.filter((d) => matches(d, f)).map(clone)),
//     findById: (id) => one(docs.filter((d) => d._id === String(id))),
//     findOne: (f) => one(docs.filter((d) => matches(d, f))),
//     async findOneAndUpdate(f, upd, opts = {}) {
//       let list = docs.filter((d) => matches(d, f));
//       if (opts.sort) {
//         const [[k, dir]] = Object.entries(opts.sort);
//         list = [...list].sort((a, b) => (a[k] > b[k] ? dir : -dir));
//       }
//       const hit = list[0];
//       if (!hit) return null;
//       Object.assign(hit, upd.$set || {});
//       return clone(hit);
//     },
//     async updateMany() {
//       return {};
//     },
//   };
// };

// const T0 = new Date("2026-10-17T10:00:00.000Z");
// const at = (ms) => new Date(T0.getTime() + ms);
// const seed = async (Call, extra = {}) =>
//   state.createRingingCall({ requestId: "r1", callerId: "A", calleeId: "B", now: T0, Call, ...extra });

// // ------------------------------------------------------------- state machine
// test("new call is ringing with expiresAt = start + 45s", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   assert.equal(c.status, "ringing");
//   assert.equal(c.expiresAt.getTime() - c.startedAt.getTime(), 45_000);
//   assert.equal(state.RING_WINDOW_MS, 45_000);
//   assert.equal(state.isRinging(c, at(44_999)), true);
//   assert.equal(state.isRinging(c, at(45_000)), false);
// });

// test("accept inside the window wins; a repeat accept is a no-op, not an error state", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   const a = await state.acceptCall({ callId: c._id, calleeId: "B", now: at(5_000), Call });
//   assert.equal(a.changed, true);
//   assert.equal(a.call.status, "accepted");
//   const again = await state.acceptCall({ callId: c._id, calleeId: "B", now: at(6_000), Call });
//   assert.equal(again.changed, false);
//   assert.equal(again.call.status, "accepted");
// });

// test("late accept after expiry is refused and the call stays ringing until swept", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   const late = await state.acceptCall({ callId: c._id, calleeId: "B", now: at(46_000), Call });
//   assert.equal(late.changed, false);
//   assert.equal(late.reason, "expired");
//   const swept = await state.expireDueCalls({ now: at(46_000), Call });
//   assert.equal(swept.length, 1);
//   assert.equal(swept[0].status, "missed");
//   assert.equal(swept[0].endReason, "expired");
//   const after = await state.acceptCall({ callId: c._id, calleeId: "B", now: at(47_000), Call });
//   assert.equal(after.reason, "not_ringing");
// });

// test("only the callee can accept/decline", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   for (const fn of [state.acceptCall, state.declineCall]) {
//     const r = await fn({ callId: c._id, calleeId: "A", now: at(1_000), Call });
//     assert.equal(r.changed, false);
//     assert.equal(r.reason, "not_participant");
//   }
//   assert.equal((await state.acceptCall({ callId: "nope", calleeId: "B", Call })).reason, "not_found");
// });

// test("simultaneous accept + decline: exactly one winner", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   const [a, d] = await Promise.all([
//     state.acceptCall({ callId: c._id, calleeId: "B", now: at(2_000), Call }),
//     state.declineCall({ callId: c._id, calleeId: "B", now: at(2_000), Call }),
//   ]);
//   assert.equal([a, d].filter((r) => r.changed).length, 1);
// });

// test("decline then late accept: accept is refused", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   const d = await state.declineCall({ callId: c._id, calleeId: "B", now: at(2_000), Call });
//   assert.equal(d.call.status, "rejected");
//   const late = await state.acceptCall({ callId: c._id, calleeId: "B", now: at(3_000), Call });
//   assert.equal(late.changed, false);
//   assert.equal(late.reason, "not_ringing");
// });

// test("expiry is idempotent across concurrent sweepers / timers", async () => {
//   const Call = makeModel();
//   await seed(Call);
//   const runs = await Promise.all([
//     state.expireDueCalls({ now: at(50_000), Call }),
//     state.expireDueCalls({ now: at(50_000), Call }),
//     state.expireDueCalls({ now: at(50_000), Call }),
//   ]);
//   assert.equal(runs.flat().length, 1);
//   assert.equal((await state.expireDueCalls({ now: at(60_000), Call })).length, 0);
// });

// test("sweeper never touches a call that was accepted before expiry", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   await state.acceptCall({ callId: c._id, calleeId: "B", now: at(44_000), Call });
//   assert.equal((await state.expireDueCalls({ now: at(60_000), Call })).length, 0);
//   assert.equal((await Call.findById(c._id)).status, "accepted");
// });

// test("MISSED_CALL notification is claimed exactly once per call", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   const [m] = await state.expireDueCalls({ now: at(50_000), Call });
//   const claims = await Promise.all([1, 2, 3].map(() => state.claimMissedNotification({ callId: m._id, now: at(50_000), Call })));
//   assert.equal(claims.filter(Boolean).length, 1);
//   // A call that never went missed can't be claimed.
//   const c2 = await seed(Call, { requestId: "r2" });
//   assert.equal(await state.claimMissedNotification({ callId: c2._id, Call }), false);
// });

// test("endCall: caller cancel => missed; callee end => rejected; accepted => completed; repeat => noop", async () => {
//   const Call = makeModel();
//   const a = await seed(Call);
//   const cancel = await state.endCall({ callId: a._id, userId: "A", now: at(3_000), Call });
//   assert.equal(cancel.outcome, "missed");
//   assert.equal(cancel.call.endReason, "caller_cancelled");
//   assert.equal((await state.endCall({ callId: a._id, userId: "A", Call })).outcome, "noop");

//   const b = await seed(Call, { requestId: "r2" });
//   assert.equal((await state.endCall({ callId: b._id, userId: "B", now: at(3_000), Call })).outcome, "rejected");

//   const c = await seed(Call, { requestId: "r3" });
//   await state.acceptCall({ callId: c._id, calleeId: "B", now: at(1_000), Call });
//   const done = await state.endCall({ callId: c._id, userId: "A", now: at(31_000), Call });
//   assert.equal(done.outcome, "completed");
//   assert.equal(done.call.durationSeconds, 30);
// });

// test("re-dial supersedes the earlier ringing attempt without a missed-call notification", async () => {
//   const Call = makeModel();
//   const first = await seed(Call);
//   const closed = await state.supersedeRinging({ callerId: "A", calleeId: "B", now: at(10_000), Call });
//   assert.equal(closed.length, 1);
//   assert.equal(closed[0]._id, first._id);
//   assert.equal(await state.claimMissedNotification({ callId: first._id, Call }), false);
// });

// test("reconnect replay finds only a ringing, unexpired call for the callee", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   assert.equal((await state.findRingingForCallee({ calleeId: "B", now: at(10_000), Call }))._id, c._id);
//   assert.equal(await state.findRingingForCallee({ calleeId: "B", now: at(46_000), Call }), null);
//   assert.equal(await state.findRingingForCallee({ calleeId: "A", now: at(10_000), Call }), null);
// });

// // ----------------------------------------------------- foreground regression
// test("REGRESSION foreground happy path: invite -> accept -> end => completed with duration", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   assert.equal((await state.acceptCall({ callId: c._id, calleeId: "B", now: at(4_000), Call })).changed, true);
//   const end = await state.endCall({ callId: c._id, userId: "B", now: at(64_000), Call });
//   assert.equal(end.call.status, "completed");
//   assert.equal(end.call.durationSeconds, 60);
// });

// test("REGRESSION foreground decline: invite -> reject => rejected (caller sees call:end)", async () => {
//   const Call = makeModel();
//   const c = await seed(Call);
//   const r = await state.declineCall({ callId: c._id, calleeId: "B", now: at(2_000), Call });
//   assert.equal(r.call.status, "rejected");
// });

// // ------------------------------------------------------------ push payloads
// const ringing = () => ({ _id: "c1", requestId: "r1", callerId: "A", calleeId: "B", status: "ringing", startedAt: T0, expiresAt: at(45_000) });

// test("incoming-call push is data-only, high priority, TTL <= remaining ring window", () => {
//   const now = at(10_000);
//   const m = push.buildIncomingCallMessage({ token: "tok", call: ringing(), callerName: "Ali", now });
//   assert.equal(m.notification, undefined);
//   assert.equal(m.android.priority, "high");
//   assert.equal(m.android.ttl, 35_000);
//   assert.ok(m.android.ttl <= state.RING_WINDOW_MS);
//   assert.equal(m.android.collapseKey, "call_c1");
//   assert.equal(m.data.type, "INCOMING_CALL");
//   assert.equal(m.data.callId, "c1");
//   assert.equal(m.data.callerName, "Ali");
//   assert.equal(m.data.expiresAt, at(45_000).toISOString());
//   assert.ok(Object.values(m.data).every((v) => typeof v === "string"), "FCM data values must be strings");
//   assert.equal(m.apns.headers["apns-expiration"], String(Math.floor(at(45_000).getTime() / 1000)));
// });

// test("incoming-call push is NOT sent for stale / non-ringing / nearly-expired calls", async () => {
//   const sent = [];
//   const messaging = { send: async (msg) => (sent.push(msg), "id") };
//   const callee = { fcmToken: "tok" };
//   const run = (call, now) => push.sendIncomingCallPush({ callId: "c1", callee, callerName: "Ali", now, fetchCall: async () => call, messaging });

//   assert.equal((await run(ringing(), at(5_000))).sent, true);
//   assert.equal((await run(ringing(), at(46_000))).reason, "not_ringing");
//   assert.equal((await run({ ...ringing(), status: "accepted" }, at(5_000))).reason, "not_ringing");
//   assert.equal((await run({ ...ringing(), status: "missed" }, at(5_000))).reason, "not_ringing");
//   assert.equal((await run(null, at(5_000))).reason, "no_call");
//   assert.equal((await run(ringing(), at(43_000))).reason, "too_late");
//   assert.equal(sent.length, 1);
//   assert.equal((await push.sendIncomingCallPush({ callId: "c1", callee: {}, fetchCall: async () => ringing(), messaging })).reason, "no_token");
// });

// test("MISSED_CALL notification carries { type, callerId, callerName, timestamp } and never links to the call screen", () => {
//   const call = { ...ringing(), status: "missed", endedAt: at(45_100) };
//   const payload = state.buildMissedCallPayload({ call, callerName: "Ali" });
//   assert.deepEqual(
//     { type: payload.type, callerId: payload.callerId, callerName: payload.callerName, timestamp: payload.timestamp },
//     { type: "MISSED_CALL", callerId: "A", callerName: "Ali", timestamp: at(45_100).toISOString() },
//   );
//   const m = push.buildMissedCallMessage({ token: "tok", payload });
//   assert.equal(m.data.type, "MISSED_CALL");
//   assert.equal(m.data.link, undefined);
//   assert.equal(m.data.url, undefined);
//   assert.ok(!JSON.stringify(m).includes("/call/"));
//   assert.equal(m.notification.title, "Missed call");
// });

// test("cancel push is data-only so the client can remove the ringing notification", () => {
//   const m = push.buildCancelMessage({ token: "tok", call: ringing(), reason: "expired" });
//   assert.equal(m.notification, undefined);
//   assert.equal(m.data.type, "CALL_CANCELLED");
//   assert.equal(m.data.callId, "c1");
//   assert.equal(m.android.priority, "high");
// });

// Run with:  node --test tests/callState.test.js     (npm run test:calls)
// Pure logic: no MongoDB, no Firebase. A tiny in-memory Call model implements
// exactly the query operators callStateService uses.
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../services/callStateService");
const push = require("../services/callPushService");

// ---------------------------------------------------------------- fake model
const matches = (doc, filter) =>
  Object.entries(filter).every(([k, cond]) => {
    if (k === "$or") return cond.some((f) => matches(doc, f));
    const v = doc[k];
    if (
      cond &&
      typeof cond === "object" &&
      !(cond instanceof Date) &&
      !Array.isArray(cond)
    ) {
      return Object.entries(cond).every(([op, x]) => {
        if (op === "$gt") return v != null && v > x;
        if (op === "$lte") return v != null && v <= x;
        if (op === "$in") return x.map(String).includes(String(v));
        if (op === "$exists") return x ? v !== undefined : v === undefined;
        throw new Error("unsupported op " + op);
      });
    }
    return String(v) === String(cond);
  });

const makeModel = () => {
  const docs = [];
  let n = 0;
  const clone = (d) => (d ? { ...d } : null);
  const q = (list) => {
    const p = Promise.resolve(list);
    p.sort = (spec) => {
      const [[f, dir]] = Object.entries(spec);
      return Promise.resolve(
        [...list].sort((a, b) => (a[f] > b[f] ? dir : -dir)),
      );
    };
    return p;
  };
  const one = (list) => {
    const first = list[0];
    const p = Promise.resolve(clone(first));
    p.sort = (spec) => {
      const [[f, dir]] = Object.entries(spec);
      return Promise.resolve(
        clone([...list].sort((a, b) => (a[f] > b[f] ? -dir : dir))[0]),
      );
    };
    return p;
  };
  return {
    docs,
    async create(d) {
      n += 1;
      const doc = { _id: `c${n}`, createdAt: new Date(Date.now() + n), ...d };
      docs.push(doc);
      return clone(doc);
    },
    find: (f) => q(docs.filter((d) => matches(d, f)).map(clone)),
    findById: (id) => one(docs.filter((d) => d._id === String(id))),
    findOne: (f) => one(docs.filter((d) => matches(d, f))),
    async findOneAndUpdate(f, upd, opts = {}) {
      let list = docs.filter((d) => matches(d, f));
      if (opts.sort) {
        const [[k, dir]] = Object.entries(opts.sort);
        list = [...list].sort((a, b) => (a[k] > b[k] ? dir : -dir));
      }
      const hit = list[0];
      if (!hit) return null;
      Object.assign(hit, upd.$set || {});
      return clone(hit);
    },
    async updateMany() {
      return {};
    },
  };
};

const T0 = new Date("2026-10-17T10:00:00.000Z");
const at = (ms) => new Date(T0.getTime() + ms);
const seed = async (Call, extra = {}) =>
  state.createRingingCall({
    requestId: "r1",
    callerId: "A",
    calleeId: "B",
    now: T0,
    Call,
    ...extra,
  });

// ------------------------------------------------------------- state machine
test("new call is ringing with expiresAt = start + 45s", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  assert.equal(c.status, "ringing");
  assert.equal(c.expiresAt.getTime() - c.startedAt.getTime(), 45_000);
  assert.equal(state.RING_WINDOW_MS, 45_000);
  assert.equal(state.isRinging(c, at(44_999)), true);
  assert.equal(state.isRinging(c, at(45_000)), false);
});

test("accept inside the window wins; a repeat accept is a no-op, not an error state", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  const a = await state.acceptCall({
    callId: c._id,
    calleeId: "B",
    now: at(5_000),
    Call,
  });
  assert.equal(a.changed, true);
  assert.equal(a.call.status, "accepted");
  const again = await state.acceptCall({
    callId: c._id,
    calleeId: "B",
    now: at(6_000),
    Call,
  });
  assert.equal(again.changed, false);
  assert.equal(again.call.status, "accepted");
});

test("late accept after expiry is refused and the call stays ringing until swept", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  const late = await state.acceptCall({
    callId: c._id,
    calleeId: "B",
    now: at(46_000),
    Call,
  });
  assert.equal(late.changed, false);
  assert.equal(late.reason, "expired");
  const swept = await state.expireDueCalls({ now: at(46_000), Call });
  assert.equal(swept.length, 1);
  assert.equal(swept[0].status, "missed");
  assert.equal(swept[0].endReason, "expired");
  const after = await state.acceptCall({
    callId: c._id,
    calleeId: "B",
    now: at(47_000),
    Call,
  });
  assert.equal(after.reason, "not_ringing");
});

test("only the callee can accept/decline", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  for (const fn of [state.acceptCall, state.declineCall]) {
    const r = await fn({ callId: c._id, calleeId: "A", now: at(1_000), Call });
    assert.equal(r.changed, false);
    assert.equal(r.reason, "not_participant");
  }
  assert.equal(
    (await state.acceptCall({ callId: "nope", calleeId: "B", Call })).reason,
    "not_found",
  );
});

test("simultaneous accept + decline: exactly one winner", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  const [a, d] = await Promise.all([
    state.acceptCall({ callId: c._id, calleeId: "B", now: at(2_000), Call }),
    state.declineCall({ callId: c._id, calleeId: "B", now: at(2_000), Call }),
  ]);
  assert.equal([a, d].filter((r) => r.changed).length, 1);
});

test("decline then late accept: accept is refused", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  const d = await state.declineCall({
    callId: c._id,
    calleeId: "B",
    now: at(2_000),
    Call,
  });
  assert.equal(d.call.status, "rejected");
  const late = await state.acceptCall({
    callId: c._id,
    calleeId: "B",
    now: at(3_000),
    Call,
  });
  assert.equal(late.changed, false);
  assert.equal(late.reason, "not_ringing");
});

test("expiry is idempotent across concurrent sweepers / timers", async () => {
  const Call = makeModel();
  await seed(Call);
  const runs = await Promise.all([
    state.expireDueCalls({ now: at(50_000), Call }),
    state.expireDueCalls({ now: at(50_000), Call }),
    state.expireDueCalls({ now: at(50_000), Call }),
  ]);
  assert.equal(runs.flat().length, 1);
  assert.equal(
    (await state.expireDueCalls({ now: at(60_000), Call })).length,
    0,
  );
});

test("sweeper never touches a call that was accepted before expiry", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  await state.acceptCall({
    callId: c._id,
    calleeId: "B",
    now: at(44_000),
    Call,
  });
  assert.equal(
    (await state.expireDueCalls({ now: at(60_000), Call })).length,
    0,
  );
  assert.equal((await Call.findById(c._id)).status, "accepted");
});

test("MISSED_CALL notification is claimed exactly once per call", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  const [m] = await state.expireDueCalls({ now: at(50_000), Call });
  const claims = await Promise.all(
    [1, 2, 3].map(() =>
      state.claimMissedNotification({ callId: m._id, now: at(50_000), Call }),
    ),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  // A call that never went missed can't be claimed.
  const c2 = await seed(Call, { requestId: "r2" });
  assert.equal(
    await state.claimMissedNotification({ callId: c2._id, Call }),
    false,
  );
});

test("endCall: caller cancel => missed; callee end => rejected; accepted => completed; repeat => noop", async () => {
  const Call = makeModel();
  const a = await seed(Call);
  const cancel = await state.endCall({
    callId: a._id,
    userId: "A",
    now: at(3_000),
    Call,
  });
  assert.equal(cancel.outcome, "missed");
  assert.equal(cancel.call.endReason, "caller_cancelled");
  assert.equal(
    (await state.endCall({ callId: a._id, userId: "A", Call })).outcome,
    "noop",
  );

  const b = await seed(Call, { requestId: "r2" });
  assert.equal(
    (await state.endCall({ callId: b._id, userId: "B", now: at(3_000), Call }))
      .outcome,
    "rejected",
  );

  const c = await seed(Call, { requestId: "r3" });
  await state.acceptCall({
    callId: c._id,
    calleeId: "B",
    now: at(1_000),
    Call,
  });
  const done = await state.endCall({
    callId: c._id,
    userId: "A",
    now: at(31_000),
    Call,
  });
  assert.equal(done.outcome, "completed");
  assert.equal(done.call.durationSeconds, 30);
});

test("re-dial supersedes the earlier ringing attempt without a missed-call notification", async () => {
  const Call = makeModel();
  const first = await seed(Call);
  const closed = await state.supersedeRinging({
    callerId: "A",
    calleeId: "B",
    now: at(10_000),
    Call,
  });
  assert.equal(closed.length, 1);
  assert.equal(closed[0]._id, first._id);
  assert.equal(
    await state.claimMissedNotification({ callId: first._id, Call }),
    false,
  );
});

test("reconnect replay finds only a ringing, unexpired call for the callee", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  assert.equal(
    (await state.findRingingForCallee({ calleeId: "B", now: at(10_000), Call }))
      ._id,
    c._id,
  );
  assert.equal(
    await state.findRingingForCallee({ calleeId: "B", now: at(46_000), Call }),
    null,
  );
  assert.equal(
    await state.findRingingForCallee({ calleeId: "A", now: at(10_000), Call }),
    null,
  );
});

// ----------------------------------------------------- foreground regression
test("REGRESSION foreground happy path: invite -> accept -> end => completed with duration", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  assert.equal(
    (
      await state.acceptCall({
        callId: c._id,
        calleeId: "B",
        now: at(4_000),
        Call,
      })
    ).changed,
    true,
  );
  const end = await state.endCall({
    callId: c._id,
    userId: "B",
    now: at(64_000),
    Call,
  });
  assert.equal(end.call.status, "completed");
  assert.equal(end.call.durationSeconds, 60);
});

test("REGRESSION foreground decline: invite -> reject => rejected (caller sees call:end)", async () => {
  const Call = makeModel();
  const c = await seed(Call);
  const r = await state.declineCall({
    callId: c._id,
    calleeId: "B",
    now: at(2_000),
    Call,
  });
  assert.equal(r.call.status, "rejected");
});

// ------------------------------------------------------------ push payloads
const ringing = () => ({
  _id: "c1",
  requestId: "r1",
  callerId: "A",
  calleeId: "B",
  status: "ringing",
  startedAt: T0,
  expiresAt: at(45_000),
});

test("incoming-call push shows a system notification, high priority, TTL <= remaining ring window", () => {
  const now = at(10_000);
  const m = push.buildIncomingCallMessage({
    token: "tok",
    call: ringing(),
    callerName: "Ali",
    now,
  });
  assert.equal(m.notification.title, "Ali is calling…");
  assert.equal(m.android.notification.channelId, "high_importance_v1");
  assert.equal(m.android.priority, "high");
  assert.equal(m.android.ttl, 35_000);
  assert.ok(m.android.ttl <= state.RING_WINDOW_MS);
  assert.equal(m.android.collapseKey, "call_c1");
  assert.equal(m.data.type, "INCOMING_CALL");
  assert.equal(m.data.callId, "c1");
  assert.equal(m.data.callerName, "Ali");
  assert.equal(m.data.expiresAt, at(45_000).toISOString());
  assert.ok(
    Object.values(m.data).every((v) => typeof v === "string"),
    "FCM data values must be strings",
  );
  assert.equal(
    m.apns.headers["apns-expiration"],
    String(Math.floor(at(45_000).getTime() / 1000)),
  );
});

test("incoming-call push is NOT sent for stale / non-ringing / nearly-expired calls", async () => {
  const sent = [];
  const messaging = { send: async (msg) => (sent.push(msg), "id") };
  const callee = { fcmToken: "tok" };
  const run = (call, now) =>
    push.sendIncomingCallPush({
      callId: "c1",
      callee,
      callerName: "Ali",
      now,
      fetchCall: async () => call,
      messaging,
    });

  assert.equal((await run(ringing(), at(5_000))).sent, true);
  assert.equal((await run(ringing(), at(46_000))).reason, "not_ringing");
  assert.equal(
    (await run({ ...ringing(), status: "accepted" }, at(5_000))).reason,
    "not_ringing",
  );
  assert.equal(
    (await run({ ...ringing(), status: "missed" }, at(5_000))).reason,
    "not_ringing",
  );
  assert.equal((await run(null, at(5_000))).reason, "no_call");
  assert.equal((await run(ringing(), at(43_000))).reason, "too_late");
  assert.equal(sent.length, 1);
  assert.equal(
    (
      await push.sendIncomingCallPush({
        callId: "c1",
        callee: {},
        fetchCall: async () => ringing(),
        messaging,
      })
    ).reason,
    "no_token",
  );
});

test("MISSED_CALL notification carries { type, callerId, callerName, timestamp } and never links to the call screen", () => {
  const call = { ...ringing(), status: "missed", endedAt: at(45_100) };
  const payload = state.buildMissedCallPayload({ call, callerName: "Ali" });
  assert.deepEqual(
    {
      type: payload.type,
      callerId: payload.callerId,
      callerName: payload.callerName,
      timestamp: payload.timestamp,
    },
    {
      type: "MISSED_CALL",
      callerId: "A",
      callerName: "Ali",
      timestamp: at(45_100).toISOString(),
    },
  );
  const m = push.buildMissedCallMessage({ token: "tok", payload });
  assert.equal(m.data.type, "MISSED_CALL");
  assert.equal(m.data.link, undefined);
  assert.equal(m.data.url, undefined);
  assert.ok(!JSON.stringify(m).includes("/call/"));
  assert.equal(m.notification.title, "Missed call");
});

test("cancel push is data-only so the client can remove the ringing notification", () => {
  const m = push.buildCancelMessage({
    token: "tok",
    call: ringing(),
    reason: "expired",
  });
  assert.equal(m.notification, undefined);
  assert.equal(m.data.type, "CALL_CANCELLED");
  assert.equal(m.data.callId, "c1");
  assert.equal(m.android.priority, "high");
});

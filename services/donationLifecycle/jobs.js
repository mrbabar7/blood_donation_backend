// Durable background work for the donation lifecycle. State lives in MongoDB, never in
// process memory, so a restart loses nothing; every unit of work is claimed atomically
// (see service.js), so running this on several instances, or twice, is harmless.
//   * 12 h expiry of unanswered requests        -> Expired
//   * 6-hourly "Mark Complete" reminders        -> until completed / cancelled
const lifecycle = require("./service");
const C = require("./constants");

let timer = null;
let running = false;

const tick = async () => {
  if (running) return; // never overlap with ourselves
  running = true;
  try {
    const expired = await lifecycle.expireDue();
    const reminders = await lifecycle.sendDueReminders();
    if (expired || reminders) console.log(`[donationLifecycle] expired=${expired} reminders=${reminders}`);
  } catch (err) {
    console.error("[donationLifecycle] worker tick failed:", err.message);
  } finally {
    running = false;
  }
};

const initDonationLifecycleJobs = () => {
  if (timer) return;
  const run = async () => {
    try {
      await lifecycle.backfill();
    } catch (err) {
      console.error("[donationLifecycle] backfill failed:", err.message);
    }
    tick();
    timer = setInterval(tick, C.policy().workerIntervalMs);
    if (typeof timer.unref === "function") timer.unref();
  };
  // Wait for the DB connection (config/db connects asynchronously at require time).
  const mongoose = require("mongoose");
  if (mongoose.connection.readyState === 1) run();
  else mongoose.connection.once("open", run);
};

module.exports = { initDonationLifecycleJobs, tick };

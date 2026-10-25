const cron = require("node-cron");
const { reconcileExpiredRecoveries } = require("./donorAvailabilityService");

// Every 15 minutes: donors whose recovery window ended go back to available
// and their "notify me" subscribers are told once. Also runs once shortly
// after boot so a server that was down when a window ended catches up.
// Profile views and request sends reconcile on read as well, so this job only
// bounds how stale the SEARCH LISTS can be.
let running = false;
async function run() {
  if (running) return;
  running = true;
  try {
    const n = await reconcileExpiredRecoveries();
    if (n > 0) console.log(`[availability] ${n} donor(s) returned to available`);
  } catch (err) {
    console.error("[availability] cron error:", err.message);
  } finally {
    running = false;
  }
}

const initDonorAvailabilityCron = () => {
  cron.schedule("*/15 * * * *", run);
  setTimeout(run, 15000).unref?.();
};

module.exports = initDonorAvailabilityCron;
module.exports.run = run;

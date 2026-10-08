const cron = require("node-cron");
const { DonationRequest, Donor } = require("../models/formModel");
const { deleteChatForRequest } = require("./chatCleanupService");

// REQUIREMENT: "if donor gives blood but the seeker doesn't complete the
// status, notify the seeker to complete, otherwise the chat is deleted
// after 3 days if they still haven't confirmed."
//
// Two passes, both in the same daily run — same schedule/registration
// pattern as services/autoRejectService.js:
//
//   1. WARNING pass — a request marked donated 2+ days ago, with no warning
//      sent yet, gets one: "confirm soon or this chat gets deleted
//      tomorrow". Gives the seeker a real chance to act instead of the
//      deletion being their first and only signal that a clock was running.
//   2. DELETION pass — a request marked donated 3+ days ago and *still*
//      not completed gets its chat purged (see chatCleanupService.js) and
//      both sides are told plainly why.
//
// Deliberately never touches `request.status` — a request that times out
// here stays exactly "accepted" (not auto-completed, not auto-rejected).
// Only its chat history is gone; the donation record itself, and every
// status-driven stat/screen elsewhere in the app, is untouched. If the
// seeker does eventually confirm after this point, completeDonation.js
// still runs normally — deleteChatForRequest is a no-op the second time
// since there are no messages left to purge.
const WARNING_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
const DELETE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

const runWarningPass = async () => {
  const cutoff = new Date(Date.now() - WARNING_AFTER_MS);
  const dueForWarning = await DonationRequest.find({
    status: "accepted",
    donorMarkedDonatedAt: { $ne: null, $lte: cutoff },
    chatDeleteWarningSentAt: null,
    chatDeletedAt: null,
  });

  if (dueForWarning.length === 0) return 0;

  const { createNotification } = require("../controllers/notificationController");

  for (const request of dueForWarning) {
    try {
      await createNotification({
        userId: request.seekerId,
        title: "Confirm your donation",
        message:
          "This donor marked your donation as given but it hasn't been confirmed yet. Please confirm within the next 24 hours, or this chat's history will be automatically deleted.",
        link: "/(tabs)/requests",
      });
      request.chatDeleteWarningSentAt = new Date();
      await request.save();
    } catch (err) {
      console.error(`Error sending chat-deletion warning for request ${request._id}:`, err.message);
    }
  }
  return dueForWarning.length;
};

const runDeletionPass = async () => {
  const cutoff = new Date(Date.now() - DELETE_AFTER_MS);
  const dueForDeletion = await DonationRequest.find({
    status: "accepted",
    donorMarkedDonatedAt: { $ne: null, $lte: cutoff },
    chatDeletedAt: null,
  });

  if (dueForDeletion.length === 0) return 0;

  for (const request of dueForDeletion) {
    try {
      const donor = await Donor.findById(request.donorId).select("userId");
      await deleteChatForRequest(request, "unconfirmed_timeout", {
        seekerId: request.seekerId,
        donorUserId: donor?.userId,
      });
    } catch (err) {
      console.error(`Error auto-deleting chat for request ${request._id}:`, err.message);
    }
  }
  return dueForDeletion.length;
};

const initChatCleanupCron = () => {
  // Once a day is enough precision for a 3-day window (same cadence as
  // autoRejectService.js's 7-day one) — a request doesn't need to be
  // cleaned up to the minute, just reliably within roughly a day of
  // crossing the threshold.
  cron.schedule("30 0 * * *", async () => {
    try {
      console.log("--- Starting Chat Cleanup Cron ---");
      const warned = await runWarningPass();
      const deleted = await runDeletionPass();
      console.log(`--- Chat Cleanup Cron: ${warned} warned, ${deleted} chat(s) deleted ---`);
    } catch (error) {
      console.error("Chat Cleanup Cron Error:", error);
    }
  });
};

module.exports = initChatCleanupCron;

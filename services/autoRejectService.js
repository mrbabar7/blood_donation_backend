const cron = require("node-cron");
const { DonationRequest } = require("../models/formModel");
const userModel = require("../models/userMode");
const { createNotification } = require("../controllers/notificationController");

const initAutoRejectCron = () => {
  cron.schedule("0 0 * * *", async () => {
    try {
      console.log("--- Starting Auto-Reject System ---");

      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const expiredRequests = await DonationRequest.find({
        status: "pending",
        createdAt: { $lt: oneWeekAgo },
      });

      if (expiredRequests.length === 0) return;

      for (const request of expiredRequests) {
        request.status = "rejected";
        await request.save();

        await createNotification({
          userId: request.seekerId,
          title: "Blood Request Expired",
      category: "status",
          message: "Your blood request has expired after 7 days of no response. Please try requesting other donors.",
          link: "/(tabs)/requests",
        });
      }

      console.log(
        `--- Auto-rejected and notified ${expiredRequests.length} seekers ---`,
      );
    } catch (error) {
      console.error("Cron Job Error:", error);
    }
  });
};

module.exports = initAutoRejectCron;

const { sendingEmail } = require("../../email-sender/emailService");
const {
  seekerUpdateTemplate,
} = require("../../email-sender/seekerResponceEmailTemplate");
const { COLORS, APP_NAME, APP_URL } = require("../../email-sender/brand");
const { DonationRequest, Donor } = require("../../models/formModel");
const userModel = require("../../models/userMode");

exports.respondFromEmail = async (req, res) => {
  try {
    const { requestId, action } = req.params;
    const statusUpdate = action === "accept" ? "accepted" : "rejected";

    const request = await DonationRequest.findById(requestId);

    if (!request) {
      return res.send(
        "<h1 style='text-align:center; margin-top:50px;'>Error: Request not found.</h1>",
      );
    }

    if (request.status !== "pending") {
      return res.send(
        `<h1 style='text-align:center; margin-top:50px;'>Notice: This request has already been ${request.status}.</h1>`,
      );
    }

    request.status = statusUpdate;
    await request.save();

    const donor = await Donor.findById(request.donorId).populate("userId");
    const seeker = await userModel.findById(request.seekerId);

    let emailSubject = "";
    let emailHtml = "";

    if (statusUpdate === "accepted") {
      emailSubject = "🩸 Good News: Your Blood Request was Accepted!";

      const donorDetailsHtml = `
        <div style="background:#f1f5f9; border-radius:16px; padding:20px; text-align:left; margin-top:20px; border-left: 5px solid ${COLORS.success};">
          <div style="font-weight:bold; margin-bottom:12px; color:#1e293b; font-size:16px;">DONOR CONTACT DETAILS:</div>
          <div style="margin-bottom:8px; font-size:14px;"><b>👤 Name:</b> ${donor.fullName}</div>
          <div style="margin-bottom:8px; font-size:14px;"><b>📞 Phone:</b> ${donor.mobileNumber}</div>
          <div style="margin-bottom:8px; font-size:14px;"><b>📧 Email:</b> ${donor.userId.email}</div>
        </div>
      `;

      emailHtml = seekerUpdateTemplate
        .replace("{badgeColor}", COLORS.success)
        .replace("{statusText}", "REQUEST ACCEPTED")
        .replace("{seekerName}", seeker.name)
        .replace(
          "{mainMessage}",
          `Great news! <b>${donor.fullName}</b> has accepted your request via email. Contact them as soon as possible.`,
        )
        .replace("{donorDetailsHtml}", donorDetailsHtml);
    } else {
      emailSubject = "Update: Your Blood Request Status";
      emailHtml = seekerUpdateTemplate
        .replace("{badgeColor}", COLORS.slate)
        .replace("{statusText}", "REQUEST DECLINED")
        .replace("{seekerName}", seeker.name)
        .replace(
          "{mainMessage}",
          `We regret to inform you that the donor has declined your request via email. Please check the dashboard for other donors.`,
        )
        .replace("{donorDetailsHtml}", "");
    }

    // Seeker may be a phone-only account (no email) — skip the email send
    // rather than crash; the in-app notification below still reaches them.
    if (seeker.email) {
      await sendingEmail(seeker.email, emailSubject, emailHtml);
    }

    res.send(`
      <div style="text-align:center; padding:50px; font-family:Arial;">
        <h1 style="color:${statusUpdate === "accepted" ? COLORS.success : COLORS.slate};">
          Response Recorded: ${statusUpdate.toUpperCase()}
        </h1>
        <p>Thank you for your response. The seeker has been notified.</p>
        <p>Redirecting to ${APP_NAME}...</p>
        <script>
          setTimeout(() => { window.location.href = "${APP_URL}"; }, 3000);
        </script>
      </div>
    `);
  } catch (error) {
    console.error("Email Response Logic Error:", error);
    res.status(500).send("<h1>Internal Server Error</h1>");
  }
};

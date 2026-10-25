const mongoose = require("mongoose");
const { DonationRequest } = require("../../models/formModel");

// GET /donors/requests/:requestId/context
//
// The authoritative answer to "what is this request to ME?" for notification
// deep links. A push payload is only a routing hint, so the app calls this
// before navigating. Access is enforced here: the caller must be the seeker
// who made the request or the donor it was sent to. Anything else — missing,
// deleted, or someone else's — gets the same 404, so the endpoint can't be used
// to probe which request ids exist.
//
// Returns only what routing needs (no contact details).
exports.getRequestContext = async (req, res) => {
  const notFound = () =>
    res.status(404).json({
      success: false,
      code: "REQUEST_NOT_AVAILABLE",
      message: "This request is no longer available.",
    });

  try {
    const { requestId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(requestId)) return notFound();

    const userId = String(req.user.id || req.user._id);
    const request = await DonationRequest.findById(requestId)
      .select("seekerId donorId status requestedBloodType")
      .populate({ path: "donorId", select: "userId" })
      .lean();
    if (!request) return notFound();

    const isSeeker = String(request.seekerId) === userId;
    const isDonor = !!request.donorId && String(request.donorId.userId) === userId;
    if (!isSeeker && !isDonor) return notFound();

    // A user can't be both sides of one request; if data ever says so, honour
    // the role the app asked about.
    const hint = req.query.role === "donor" || req.query.role === "seeker" ? req.query.role : null;
    const role = isSeeker && isDonor ? hint || "seeker" : isSeeker ? "seeker" : "donor";

    res.status(200).json({
      success: true,
      requestId: String(request._id),
      role,
      requestType: "direct",
      status: request.status,
    });
  } catch (error) {
    console.error("Get request context error:", error);
    res.status(500).json({ success: false, message: "Could not load this request." });
  }
};

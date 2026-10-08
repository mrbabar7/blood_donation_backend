const { DonationRequest, Donor } = require("../../models/formModel");
const { isBlockedBetween } = require("../../utils/blocks");
const userModel = require("../../models/userMode");
const Address = require("../../models/addressModel");
const { createNotification } = require("../notificationController");
const { localize } = require("../../utils/localizedMessages");
const { emitToUser } = require("../../services/socketService");

require("dotenv").config();

const BACKEND_SERVER = process.env.BACKEND_SERVER;

exports.sendBloodRequest = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const { donorId } = req.params;
    const { requestedBloodType, addressId, seekerName, seekerPhone, seekerLocation } = req.body;

    // 1. Resolve which address this request should use. Three ways a client
    // can supply one, checked in order:
    //   a) addressId — seeker picked one of their saved addresses from the list.
    //   b) seekerName/seekerPhone/seekerLocation — seeker typed a brand-new
    //      address (or used live location) on this screen without saving it.
    //   c) neither provided — fall back to the saved primary address, for
    //      backward compatibility with older app builds that never sent either.
    // Only when none of these resolve to real data do we ask the seeker to
    // add an address.
    let activeAddress = null;

    if (addressId) {
      activeAddress = await Address.findOne({ _id: addressId, user: seekerId });
      if (!activeAddress) {
        return res.status(400).json({
          success: false,
          requiresAddress: true,
          message: localize(req, "addressRequired"),
        });
      }
    } else if (
      seekerName &&
      seekerName.trim() &&
      seekerPhone &&
      seekerPhone.trim() &&
      seekerLocation &&
      seekerLocation.province &&
      seekerLocation.city &&
      seekerLocation.addressLine &&
      seekerLocation.addressLine.trim()
    ) {
      // Not a saved Address document — just the plain fields the seeker typed
      // (or that were filled in from live location) on this screen.
      activeAddress = {
        fullName: seekerName.trim(),
        phone: seekerPhone.trim(),
        province: seekerLocation.province,
        city: seekerLocation.city,
        addressLine: seekerLocation.addressLine.trim(),
      };
    } else {
      activeAddress = await Address.findOne({
        user: seekerId,
        isPrimary: true,
      });
    }

    if (!activeAddress) {
      return res.status(400).json({
        success: false,
        requiresAddress: true,
        message: localize(req, "addressRequired"),
      });
    }

    // 2. Prevent Duplicate Pending Requests
    const existing = await DonationRequest.findOne({
      seekerId,
      donorId,
      status: "pending",
    });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: localize(req, "alreadyRequested") });
    }

    // 3. Fetch Donor Record
    const donor = await Donor.findById(donorId).populate("userId");
    if (!donor) {
      return res
        .status(404)
        .json({ success: false, message: localize(req, "donorNotFound") });
    }
    if (await isBlockedBetween(seekerId, donor.userId._id || donor.userId)) {
      return res
        .status(403)
        .json({ success: false, message: localize(req, "donorNotAccepting") });
    }
    if (donor.isSuspended) {
      return res
        .status(403)
        .json({ success: false, message: localize(req, "donorNotAccepting") });
    }

    // 3b. Block requests to a donor who is resting (post-donation recovery
    // window) or has otherwise marked themselves unavailable. Mirrors the
    // same availability computation seekerSearchDonor.js's shapeDonor() uses
    // for the "Resting" label, so a donor hidden/labelled as resting in the
    // list can never still be notified via a direct call to this endpoint.
    const isCurrentlyResting =
      donor.nextAvailableDate && new Date(donor.nextAvailableDate) > new Date();
    if (!donor.isAvailable || isCurrentlyResting) {
      return res
        .status(403)
        .json({ success: false, message: localize(req, "donorResting") });
    }

    // 4. Create New Donation Request
    const seekerLocationString = `${activeAddress.addressLine}, ${activeAddress.city}, ${activeAddress.province}`;

    // Set 7-day expiration date
    const expireAt = new Date();
    expireAt.setDate(expireAt.getDate() + 7);

    const newRequest = new DonationRequest({
      seekerId,
      donorId,
      requestedBloodType,
      status: "pending",
      seekerName: activeAddress.fullName,
      seekerPhone: activeAddress.phone,
      seekerLocation: {
        province: activeAddress.province,
        city: activeAddress.city,
        addressLine: activeAddress.addressLine,
      },
      expireAt,
    });

    const savedRequest = await newRequest.save();
    const targetUserId = donor.userId._id || donor.userId;

    await createNotification({
      userId: targetUserId,
      title: "Urgent Blood Requirement!",
      category: "requests",
      message: `${activeAddress.fullName} from ${activeAddress.city} needs ${requestedBloodType} blood.`,
      link: "/(tabs)/home", // Donor dashboard is rendered by (tabs)/home based on role — see src/screens/DonorDashboard.tsx
    });

    // ================= REAL-TIME SOCKET EMIT (new incoming request) =================
    // createNotification above already emits "new_notification_received" for the
    // bell badge, but nothing told the Donor Dashboard / Requests tab's pending
    // request LIST about this new request — those only ever refetched on
    // mount/focus/pull-to-refresh, so a donor sitting on the home screen never saw
    // an incoming request appear until they navigated away and back. Emitting this
    // dedicated event, shaped exactly like urgentBloodRequest.js's formatted list
    // items (same seekerId sub-object shape the UI already reads), lets those
    // screens just prepend it to their existing list with no refetch needed.
    const seekerUser = await userModel
      .findById(seekerId)
      .select("email profilePicture");

    const formattedRequestForSocket = {
      ...savedRequest.toObject(),
      seekerId: {
        _id: seekerId,
        fullName: activeAddress.fullName,
        phone: activeAddress.phone,
        email: seekerUser?.email || "",
        profilePicture: seekerUser?.profilePicture || "",
        location: seekerLocationString,
        city: activeAddress.city,
        province: activeAddress.province,
        addressLine: activeAddress.addressLine,
      },
    };

    emitToUser(targetUserId, "new_blood_request_received", formattedRequestForSocket);

    res.status(200).json({
      success: true,
      message: localize(req, "requestSent"),
      request: savedRequest,
    });
  } catch (error) {
    console.error("Send Request Error:", error);
    res.status(500).json({
      success: false,
      message: localize(req, "requestFailed"),
      error: error.message,
    });
  }
};

const { Donor, DonationRequest } = require("../../models/formModel");
const Address = require("../../models/addressModel");
const mongoose = require("mongoose");
const Broadcast = require("../../models/broadcastModel");
const { createNotification } = require("../notificationController");
const { findBroadcastDonors } = require("../../utils/donorMatching");

// Case-insensitive exact-match regex with user input safely escaped.
const exactCI = (v) => {
  const escaped = String(v).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped + "$", "i");
};

// POST /seeker/post-request
// Implements PDF screen 14 (Post a Request) + fans out to matching nearby donors,
// producing the live-trackable broadcast used by screen 17 (Emergency Broadcast).
exports.postRequest = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const {
      requestedBloodType,
      units,
      urgency,
      latitude,
      longitude,
      addressId,
      saveToAddressBook,
      neededBy,
      hospitalContact,
    } = req.body;
    let { fullName, phone, province, city, addressLine } = req.body;

    // If the seeker picked one of their saved addresses, resolve it (scoped to
    // this seeker) so its details fill any missing contact fields below. An
    // unknown / foreign / malformed id is simply ignored and the request falls
    // back to the typed fields, exactly as before.
    let savedAddress = null;
    if (addressId && mongoose.isValidObjectId(addressId)) {
      savedAddress = await Address.findOne({ _id: addressId, user: seekerId });
    }

    if (savedAddress) {
      fullName = fullName || savedAddress.fullName;
      phone = phone || savedAddress.phone;
      province = province || savedAddress.province;
      city = city || savedAddress.city;
      addressLine = addressLine || savedAddress.addressLine;
    }

    if (!requestedBloodType || !fullName || !phone || !province || !city || !addressLine) {
      return res.status(400).json({
        success: false,
        message: "Please fill in blood group and your contact details.",
      });
    }

    // Address book handling:
    //  - Picked an existing saved address (addressId) -> use it as-is; never
    //    create a copy or change which address is primary.
    //  - Typed a new address AND ticked "Save to my address book" -> add it
    //    (skipping the insert if an identical entry already exists), and make
    //    it the primary address like addAddress does.
    //  - Typed a new address without ticking it -> use it for this request only.
    const shouldSave = saveToAddressBook === true || saveToAddressBook === "true";
    if (!savedAddress && shouldSave) {
      const same = exactCI;
      const duplicate = await Address.findOne({
        user: seekerId,
        fullName: same(fullName),
        phone: String(phone).trim(),
        province: same(province),
        city: same(city),
        addressLine: same(addressLine),
      });
      if (!duplicate) {
        await Address.updateMany({ user: seekerId }, { $set: { isPrimary: false } });
        await Address.create({ user: seekerId, fullName, phone, province, city, addressLine, isPrimary: true });
      }
    }

    const broadcast = await Broadcast.create({
      seekerId,
      requestedBloodType,
      units: Number(units) || 1,
      urgency: urgency === "critical" ? "critical" : "within_24h",
      neededBy: neededBy && !Number.isNaN(new Date(neededBy).getTime()) ? new Date(neededBy) : null,
      hospitalContact: hospitalContact ? String(hospitalContact).trim().slice(0, 40) : "",
      seekerName: fullName,
      seekerPhone: phone,
      seekerLocation: {
        province,
        city,
        addressLine,
        latitude: latitude != null ? Number(latitude) : null,
        longitude: longitude != null ? Number(longitude) : null,
      },
    });

    // Match available donors of the right blood type near the seeker, honouring
    // each donor's privacy scope and any block between the two accounts. The
    // same helper backs GET /seeker/estimate-donors, so the "This will alert N
    // donors" number shown on the form is exactly who gets notified here.
    const donors = await findBroadcastDonors({
      seekerId,
      bloodType: requestedBloodType,
      province,
      city,
      lat: latitude,
      lng: longitude,
    });

    const expireAt = new Date();
    expireAt.setDate(expireAt.getDate() + 7);

    if (donors.length > 0) {
      await DonationRequest.insertMany(
        donors.map((d) => ({
          seekerId,
          donorId: d._id,
          broadcastId: broadcast._id,
          requestedBloodType,
          status: "pending",
          urgency: broadcast.urgency,
          units: broadcast.units,
          neededBy: broadcast.neededBy,
          hospitalContact: broadcast.hospitalContact,
          seekerName: fullName,
          seekerPhone: phone,
          seekerLocation: { province, city, addressLine },
          expireAt,
        }))
      );
    }

    broadcast.donorsNotified = donors.length;
    await broadcast.save();

    await Promise.all(
      donors.map((d) =>
        createNotification({
          userId: d.userId,
          title: urgency === "critical" ? "🚨 Urgent Blood Requirement!" : "Blood Requirement Nearby",
          message: `${fullName} needs ${requestedBloodType} in ${city}.`,
          link: "/(tabs)/home",
          // Emergency (critical) alerts can't be switched off or held for quiet
          // hours; a routine "within 24 h" broadcast follows the donor's
          // "Nearby broadcasts" preference and quiet hours.
          ...(urgency === "critical" ? { critical: true } : { category: "nearby" }),
        })
      )
    );

    res.status(201).json({
      success: true,
      message:
        donors.length > 0
          ? `Broadcast sent to ${donors.length} nearby donor(s).`
          : "Request posted, but no matching donors were found nearby yet.",
      broadcastId: broadcast._id,
      donorsNotified: donors.length,
    });
  } catch (error) {
    console.error("Post Request Error:", error);
    res.status(500).json({ success: false, message: "Failed to post request", error: error.message });
  }
};

// GET /seeker/estimate-donors?bloodType=&province=&city=&latitude=&longitude=
// "This will alert N donors within 12 km of ..." on the emergency form.
exports.estimateDonors = async (req, res) => {
  try {
    const seekerId = req.user.id || req.user._id;
    const { bloodType, province, city, latitude, longitude } = req.query;
    if (!bloodType || !province || !city) {
      return res.status(200).json({ success: true, count: 0 });
    }
    const donors = await findBroadcastDonors({ seekerId, bloodType, province, city, lat: latitude, lng: longitude });
    res.status(200).json({ success: true, count: donors.length });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to estimate donors", error: error.message });
  }
};

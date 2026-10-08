const BankReservation = require("../models/reservationModel");
const BloodBank = require("../models/bankModel");
const userModel = require("../models/userMode");
const { createNotification } = require("./notificationController");
const { isBlockedBetween } = require("../utils/blocks");

const GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

// POST /reservations   { bankId, bloodGroup, units }
exports.createReservation = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { bankId, bloodGroup } = req.body;
    const units = Math.min(Math.max(parseInt(req.body.units, 10) || 1, 1), 20);
    if (!/^[a-f\d]{24}$/i.test(String(bankId || ""))) return res.status(400).json({ success: false, message: "Choose a blood bank." });
    if (!GROUPS.includes(bloodGroup)) return res.status(400).json({ success: false, message: "Choose a valid blood group." });

    const bank = await BloodBank.findById(bankId);
    if (!bank) return res.status(404).json({ success: false, message: "Blood bank not found." });
    if (String(bank.user) === String(userId)) return res.status(400).json({ success: false, message: "You can't reserve from your own listing." });
    if (await isBlockedBetween(userId, bank.user)) return res.status(403).json({ success: false, message: "This blood bank isn't available to you." });

    // One open reservation per bank + blood group keeps the owner's queue clean.
    const dup = await BankReservation.findOne({ userId, bankId, bloodGroup, status: "pending" });
    if (dup) return res.status(400).json({ success: false, message: "You already have a pending reservation for this blood group at this bank." });

    const me = await userModel.findById(userId).select("name phone");
    const reservation = await BankReservation.create({
      userId,
      bankId,
      bankName: bank.name,
      bloodGroup,
      units,
      requesterName: (me && me.name) || "",
      requesterPhone: (me && me.phone) || "",
    });

    await createNotification({
      userId: bank.user,
      title: "New blood reservation",
      message: `${(me && me.name) || "Someone"} asked to reserve ${units} unit(s) of ${bloodGroup} at ${bank.name}.`,
      link: "/bank-reservations",
      category: "requests",
    });

    res.status(201).json({ success: true, reservation });
  } catch (error) {
    console.error("Create reservation error:", error);
    res.status(500).json({ success: false, message: "Failed to create reservation." });
  }
};

// GET /reservations/mine — the requester's own reservations (Requests tab).
exports.myReservations = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const reservations = await BankReservation.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
    res.status(200).json({ success: true, reservations });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load reservations." });
  }
};

// PUT /reservations/:id/cancel — requester withdraws a pending reservation.
exports.cancelReservation = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const r = await BankReservation.findOneAndUpdate(
      { _id: req.params.id, userId, status: "pending" },
      { status: "cancelled", respondedAt: new Date() },
      { new: true }
    );
    if (!r) return res.status(404).json({ success: false, message: "Reservation not found or already answered." });
    res.status(200).json({ success: true, reservation: r });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to cancel reservation." });
  }
};

// GET /reservations/incoming — reservations for banks I own.
exports.incomingReservations = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const banks = await BloodBank.find({ user: userId }).select("_id").lean();
    const reservations = await BankReservation.find({ bankId: { $in: banks.map((b) => b._id) } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.status(200).json({ success: true, reservations });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load reservations." });
  }
};

// PUT /reservations/:id/respond   { action: "confirm" | "decline" }
exports.respondToReservation = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const action = req.body.action;
    if (!["confirm", "decline"].includes(action)) return res.status(400).json({ success: false, message: "Invalid action." });
    const r = await BankReservation.findById(req.params.id);
    if (!r) return res.status(404).json({ success: false, message: "Reservation not found." });
    const bank = await BloodBank.findOne({ _id: r.bankId, user: userId }).select("_id name");
    if (!bank) return res.status(403).json({ success: false, message: "You don't manage this blood bank." });
    if (r.status !== "pending") return res.status(400).json({ success: false, message: "This reservation was already answered." });

    r.status = action === "confirm" ? "confirmed" : "declined";
    r.respondedAt = new Date();
    await r.save();

    await createNotification({
      userId: r.userId,
      title: action === "confirm" ? "Reservation confirmed" : "Reservation declined",
      message:
        action === "confirm"
          ? `${r.bankName} confirmed your ${r.bloodGroup} reservation (${r.units} unit${r.units > 1 ? "s" : ""}).`
          : `${r.bankName} couldn't hold ${r.bloodGroup} for you. Try another blood bank.`,
      link: "/(tabs)/requests",
      category: "status",
    });
    res.status(200).json({ success: true, reservation: r });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to answer reservation." });
  }
};

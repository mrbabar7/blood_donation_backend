const Address = require("../../models/addressModel");

// 1. Add New Address
// Automatically makes the newly added address the Primary / Selected address
exports.addAddress = async (req, res) => {
  try {
    const { fullName, phone, province, city, addressLine } = req.body;

    if (!fullName || !phone || !province || !city || !addressLine) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide all required fields (Name, Phone, Province, City, Address)",
      });
    }

    // Demote all existing user addresses from being primary
    await Address.updateMany(
      { user: req.user.id },
      { $set: { isPrimary: false } },
    );

    // Create new address and mark it as primary automatically
    const newAddress = new Address({
      user: req.user.id,
      fullName,
      phone,
      province,
      city,
      addressLine,
      isPrimary: true,
    });

    await newAddress.save();

    res.status(201).json({
      success: true,
      message: "Address added successfully and set as primary.",
      data: newAddress,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Get All Addresses of Authenticated User
exports.getUserAddresses = async (req, res) => {
  try {
    const addresses = await Address.find({ user: req.user.id }).sort({
      isPrimary: -1, // Primary address will always appear first
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: addresses.length,
      data: addresses,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Set Specific Address as Primary / Selected
exports.setPrimaryAddress = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const targetAddress = await Address.findOne({ _id: id, user: req.user.id });
    if (!targetAddress) {
      return res.status(404).json({
        success: false,
        message: "Address not found or unauthorized.",
      });
    }

    // Reset all user addresses to non-primary
    await Address.updateMany(
      { user: req.user.id },
      { $set: { isPrimary: false } },
    );

    // Set target address as primary
    targetAddress.isPrimary = true;
    await targetAddress.save();

    res.status(200).json({
      success: true,
      message: "Primary address updated successfully.",
      data: targetAddress,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Update Existing Address
exports.updateAddress = async (req, res) => {
  try {
    const { id } = req.params;

    const updatedAddress = await Address.findOneAndUpdate(
      { _id: id, user: req.user.id },
      { $set: req.body },
      { new: true, runValidators: true },
    );

    if (!updatedAddress) {
      return res.status(404).json({
        success: false,
        message: "Address record not found or unauthorized.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Address updated successfully.",
      data: updatedAddress,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Delete Address
// If deleted address was primary, automatically promotes the latest remaining address
exports.deleteAddress = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedAddress = await Address.findOneAndDelete({
      _id: id,
      user: req.user.id,
    });

    if (!deletedAddress) {
      return res.status(404).json({
        success: false,
        message: "Address record not found or unauthorized.",
      });
    }

    // If deleted address was primary, select the most recent remaining address as primary
    if (deletedAddress.isPrimary) {
      const latestAddress = await Address.findOne({ user: req.user.id }).sort({
        createdAt: -1,
      });

      if (latestAddress) {
        latestAddress.isPrimary = true;
        await latestAddress.save();
      }
    }

    res.status(200).json({
      success: true,
      message: "Address deleted successfully.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Get Current Primary / Active Address (Helper endpoint for Blood Request validation)
exports.getPrimaryAddress = async (req, res) => {
  try {
    const primaryAddress = await Address.findOne({
      user: req.user.id,
      isPrimary: true,
    });

    if (!primaryAddress) {
      return res.status(404).json({
        success: false,
        hasAddress: false,
        message: "No primary address found. Please add an address first.",
      });
    }

    res.status(200).json({
      success: true,
      hasAddress: true,
      data: primaryAddress,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

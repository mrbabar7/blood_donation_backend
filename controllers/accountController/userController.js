const userModel = require("../../models/userMode"); // Adjust path if model name is userModel or userMode
const { Donor } = require("../../models/formModel");
const bcrypt = require("bcryptjs");

// Import your existing email service and template
const { sendingEmail } = require("../../email-sender/emailService");
const { APP_NAME } = require("../../email-sender/brand");
const {
  useTemplate,
} = require("../../email-sender/otpVerificationEmailTemplate");
const { resolveImageField, ImageUploadError } = require("../../utils/imageUpload");

/**
 * 1. GET USER PROFILE
 */
exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await userModel
      .findById(userId)
      .select("-password -emailChangeOtp");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const donorProfile = await Donor.findOne({ userId });

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        fullName: user.fullName || user.name,
        email: user.email,
        phone: user.phone || "",
        profilePicture: user.profilePicture || "",
        isDonor: !!donorProfile,
      },
    });
  } catch (error) {
    console.error("Get Profile Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error fetching profile." });
  }
};

/**
 * 2. UPDATE PERSONAL INFO (Name, Phone)
 */
exports.updatePersonalInfo = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { fullName, phone } = req.body;

    if (!fullName) {
      return res
        .status(400)
        .json({ success: false, message: "Full Name is required." });
    }

    // Contact number is optional here (kept separate from email, which has
    // its own verified change flow below) — only touch it if the request
    // actually included it, so calls that only send fullName keep working
    // exactly as before.
    const update = { fullName, name: fullName };
    let unsetPhone = false;
    if (typeof phone === "string") {
      const trimmedPhone = phone.trim();
      if (trimmedPhone) {
        const existingPhone = await userModel.findOne({ phone: trimmedPhone, _id: { $ne: userId } });
        if (existingPhone) {
          return res.status(400).json({
            success: false,
            message: "This phone number is already registered to another account.",
          });
        }
        update.phone = trimmedPhone;
      } else {
        // `phone` has a `unique: true, sparse: true` index — sparse only
        // excludes documents where the field is entirely *absent* from the
        // uniqueness check, not documents holding an empty string. Writing
        // "" here would make the next user who also has no phone number
        // collide with a duplicate-key error the moment they save their
        // profile. Unset it instead so a cleared/never-set phone stays
        // genuinely absent.
        unsetPhone = true;
      }
    }

    const updateOperation = unsetPhone
      ? { $set: update, $unset: { phone: "" } }
      : update;

    const updatedUser = await userModel
      .findByIdAndUpdate(userId, updateOperation, { new: true })
      .select("-password -emailChangeOtp");

    // Sync in Donor document if exists (Donor's name field is `fullName`,
    // not `name` — was previously written as `name`, which the Donor schema
    // doesn't have, so it never actually reached the donor listing).
    const donorSync = { fullName };
    if (typeof update.phone === "string") donorSync.mobileNumber = update.phone;
    await Donor.findOneAndUpdate({ userId }, donorSync);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: {
        id: updatedUser._id,
        fullName: updatedUser.fullName || updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone || "",
        profilePicture: updatedUser.profilePicture || "",
      },
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error updating profile." });
  }
};

/**
 * 2b. UPDATE PROFILE PICTURE
 * Body: { image: "data:image/jpeg;base64,..." } (or "" to remove it).
 * Uploads to Firebase Storage (see utils/imageUpload.js) and deletes the
 * previous picture, exactly like the org-registration photo fields do.
 */
exports.updateProfilePicture = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { image } = req.body;

    const existing = await userModel.findById(userId).select("profilePicture");
    if (!existing) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const resolvedImage = await resolveImageField(image, existing.profilePicture, "profile");
    if (resolvedImage === undefined) {
      return res.status(400).json({ success: false, message: "No image provided." });
    }

    const updatedUser = await userModel
      .findByIdAndUpdate(userId, { profilePicture: resolvedImage }, { new: true })
      .select("-password -emailChangeOtp");

    return res.status(200).json({
      success: true,
      message: "Profile picture updated successfully.",
      user: { id: updatedUser._id, profilePicture: updatedUser.profilePicture || "" },
    });
  } catch (error) {
    if (error instanceof ImageUploadError) {
      return res.status(error.status || 400).json({ success: false, message: error.message });
    }
    console.error("Update Profile Picture Error:", error);
    return res.status(500).json({ success: false, message: "Server error updating profile picture." });
  }
};

/**
 * 3. UPDATE PASSWORD
 */
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Both current and new passwords are required.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters long.",
      });
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        field: "currentPassword",
        message: "Incorrect current password.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password updated successfully.",
    });
  } catch (error) {
    console.error("Change Password Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error updating password." });
  }
};

/**
 * 4. REQUEST EMAIL CHANGE (STEP 1)
 */
exports.requestEmailChange = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { newEmail } = req.body;

    if (!newEmail) {
      return res
        .status(400)
        .json({ success: false, message: "New email address is required." });
    }

    const formattedEmail = newEmail.trim().toLowerCase();

    // Basic format check so we never generate/send an OTP for something
    // that isn't a valid email address in the first place.
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(formattedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    // Check if new email is already in use
    const existingUser = await userModel.findOne({ email: formattedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "This email address is already registered to another account.",
      });
    }

    const user = await userModel.findById(userId);
    if (user.email === formattedEmail) {
      return res.status(400).json({
        success: false,
        message: "New email cannot be identical to your current email.",
      });
    }

    // Generate 6-digit OTP (5-min expiration)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    // Send BEFORE persisting: if the mail server rejects/fails, the account
    // is left exactly as it was (no dangling pendingEmail/OTP the user could
    // otherwise get stuck behind with no way to retry from a clean state).
    const userName = user.fullName || user.name || "User";
    const subject = `🩸 ${APP_NAME} – Verify Your New Email Address`;
    const htmlContent = useTemplate
      .replace("{name}", userName)
      .replace("{verificationCode}", otp);

    try {
      await sendingEmail(formattedEmail, subject, htmlContent);
    } catch (sendError) {
      console.error("Request Email Change - Send Failed:", sendError);
      return res.status(502).json({
        success: false,
        message:
          "Couldn't send the verification code to that address. Please check it and try again.",
      });
    }

    user.pendingEmail = formattedEmail;
    user.emailChangeOtp = otp;
    user.emailChangeOtpExpires = expires;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `A 6-digit verification code has been sent to ${formattedEmail}.`,
    });
  } catch (error) {
    console.error("Request Email Change Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error initiating email change.",
    });
  }
};

/**
 * 5. RESEND EMAIL CHANGE OTP (OPTIONAL STEP)
 */
exports.resendEmailChangeOtp = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await userModel.findById(userId);

    if (!user || !user.pendingEmail) {
      return res.status(400).json({
        success: false,
        message: "No pending email change request found.",
      });
    }

    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const userName = user.fullName || user.name || "User";
    const subject = `🩸 ${APP_NAME} – New Verification Code`;
    const htmlContent = useTemplate
      .replace("{name}", userName)
      .replace("{verificationCode}", newOtp);

    try {
      await sendingEmail(user.pendingEmail, subject, htmlContent);
    } catch (sendError) {
      console.error("Resend Email Change OTP - Send Failed:", sendError);
      // Previous OTP (if still unexpired) stays valid since we haven't
      // overwritten it yet.
      return res.status(502).json({
        success: false,
        message: "Couldn't resend the verification code. Please try again shortly.",
      });
    }

    user.emailChangeOtp = newOtp;
    user.emailChangeOtpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    return res.status(200).json({
      success: true,
      message: "A new OTP code has been sent to your new email address.",
    });
  } catch (error) {
    console.error("Resend Email Change OTP Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error resending OTP." });
  }
};

/**
 * 6. VERIFY EMAIL CHANGE OTP (STEP 2)
 */
exports.verifyEmailChange = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { otp } = req.body;

    if (!otp) {
      return res
        .status(400)
        .json({ success: false, message: "Verification OTP is required." });
    }

    const user = await userModel.findById(userId);
    if (!user || !user.pendingEmail || !user.emailChangeOtp) {
      return res.status(400).json({
        success: false,
        message: "No pending email change request found. Please request again.",
      });
    }

    if (new Date() > user.emailChangeOtpExpires) {
      user.pendingEmail = undefined;
      user.emailChangeOtp = undefined;
      user.emailChangeOtpExpires = undefined;
      await user.save();

      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new email change.",
      });
    }

    if (user.emailChangeOtp !== otp.trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP code provided. Please try again.",
      });
    }

    const updatedEmail = user.pendingEmail;

    // Re-check uniqueness right before committing: someone else could have
    // registered/claimed this exact address in the window between the
    // original request and this verification.
    const stillAvailable = await userModel.findOne({
      email: updatedEmail,
      _id: { $ne: userId },
    });
    if (stillAvailable) {
      user.pendingEmail = undefined;
      user.emailChangeOtp = undefined;
      user.emailChangeOtpExpires = undefined;
      await user.save();

      return res.status(400).json({
        success: false,
        message:
          "This email address was just taken by another account. Please request the change again with a different address.",
      });
    }

    user.email = updatedEmail;
    user.pendingEmail = undefined;
    user.emailChangeOtp = undefined;
    user.emailChangeOtpExpires = undefined;
    await user.save();

    // Sync email in Donor record if present
    await Donor.findOneAndUpdate({ userId }, { email: updatedEmail });

    return res.status(200).json({
      success: true,
      message: "Email address updated successfully.",
      newEmail: updatedEmail,
    });
  } catch (error) {
    console.error("Verify Email Change Error:", error);
    if (error && error.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "This email address was just taken by another account. Please request the change again with a different address.",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Server error verifying email change.",
    });
  }
};

/**
 * 7. DELETE ACCOUNT
 */
exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password verification is required to delete account.",
      });
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Incorrect password. Account deletion aborted.",
      });
    }

    // Cascade Delete Donor Record
    await Donor.findOneAndDelete({ userId });

    // Delete User
    await userModel.findByIdAndDelete(userId);

    return res.status(200).json({
      success: true,
      message: "Your account and donor profile have been permanently deleted.",
    });
  } catch (error) {
    console.error("Delete Account Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error deleting account." });
  }
};

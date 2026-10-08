// Tiny message localizer for API responses that reach a user-facing alert in
// the mobile app. Scoped intentionally to the messages actually shown to the
// user (see sendBloodRequest.js) rather than translating every backend error
// string — most backend errors are logged/dev-facing, not shown as-is in the UI.
//
// The mobile app sends the current language on every request as the "X-Lang"
// header (see src/api/client.ts), so req.getLang(req) below just reads that.
const messages = {
  addressRequired: {
    en: "You must save and select a primary contact address before requesting blood.",
    ur: "خون کی درخواست دینے سے پہلے آپ کو ایک بنیادی رابطہ پتہ محفوظ اور منتخب کرنا ہوگا۔",
  },
  alreadyRequested: {
    en: "Already requested",
    ur: "پہلے ہی درخواست دی جا چکی ہے",
  },
  donorNotFound: {
    en: "Donor not found",
    ur: "عطیہ دہندہ نہیں ملا",
  },
  donorNotAccepting: {
    en: "This donor is not currently accepting requests.",
    ur: "یہ عطیہ دہندہ فی الحال درخواستیں قبول نہیں کر رہا۔",
  },
  donorResting: {
    en: "This donor is currently resting (recent donation) and isn't taking new requests.",
    ur: "یہ عطیہ دہندہ فی الحال آرام کر رہا ہے (حالیہ عطیہ) اور نئی درخواستیں قبول نہیں کر رہا۔",
  },
  requestSent: {
    en: "Request sent! Donor notified via Push & Email.",
    ur: "درخواست بھیج دی گئی! عطیہ دہندہ کو پش اور ای میل کے ذریعے مطلع کر دیا گیا ہے۔",
  },
  requestFailed: {
    en: "Request failed",
    ur: "درخواست ناکام ہو گئی",
  },

  // Signup (controllers/authController/signUp.js)
  userAlreadyExists: {
    en: "User already exists",
    ur: "صارف پہلے سے موجود ہے",
  },
  passwordTooShort: {
    en: "Password must be at least 6 characters",
    ur: "پاس ورڈ کم از کم 6 حروف کا ہونا چاہیے",
  },
  signupSuccessOtpSent: {
    en: "Signup Successful! OTP sent to your email.",
    ur: "سائن اپ کامیاب! آپ کی ای میل پر OTP بھیج دیا گیا ہے۔",
  },
  serverErrorSignup: {
    en: "Server error during signup",
    ur: "سائن اپ کے دوران سرور میں خرابی",
  },

  // Login (controllers/authController/logIn.js)
  emailNotFound: {
    en: "Email not found",
    ur: "ای میل نہیں ملی",
  },
  useGoogleToLogin: {
    en: "Please use 'Continue with Google' to log in.",
    ur: "لاگ ان کرنے کے لیے براہ کرم 'گوگل کے ساتھ جاری رکھیں' استعمال کریں۔",
  },
  emailNotVerifiedOtpSent: {
    en: "Email not verified. OTP sent.",
    ur: "ای میل کی تصدیق نہیں ہوئی۔ OTP بھیج دیا گیا ہے۔",
  },
  invalidPassword: {
    en: "Invalid Password",
    ur: "غلط پاس ورڈ",
  },
  loginSuccess: {
    en: "Login Successfully!",
    ur: "لاگ ان کامیاب!",
  },
  internalServerError: {
    en: "Internal Server Error",
    ur: "سرور میں اندرونی خرابی",
  },

  // OTP verify/resend (controllers/authController/otpVarify.js)
  userNotFound: {
    en: "User not found",
    ur: "صارف نہیں ملا",
  },
  invalidOtp: {
    en: "Invalid OTP",
    ur: "غلط OTP",
  },
  otpExpired: {
    en: "OTP Expired",
    ur: "OTP کی میعاد ختم ہو گئی",
  },
  accountVerifiedSuccess: {
    en: "Account verified successfully!",
    ur: "اکاؤنٹ کامیابی سے تصدیق ہو گیا!",
  },
  serverErrorVerification: {
    en: "Server error during verification",
    ur: "تصدیق کے دوران سرور میں خرابی",
  },
  newOtpSent: {
    en: "New OTP sent to your email",
    ur: "نیا OTP آپ کی ای میل پر بھیج دیا گیا",
  },
  serverErrorResend: {
    en: "Server error during resend",
    ur: "دوبارہ بھیجنے کے دوران سرور میں خرابی",
  },

  // Phone auth (controllers/authController/phoneAuthController.js)
  enterValidPhone: {
    en: "Enter a valid phone number, including country code (e.g. +923001234567).",
    ur: "ملکی کوڈ سمیت ایک درست فون نمبر درج کریں (مثلاً +923001234567)۔",
  },
  smsCodeSent: {
    en: "A verification code has been sent via SMS.",
    ur: "تصدیقی کوڈ SMS کے ذریعے بھیج دیا گیا ہے۔",
  },
  couldntSendSmsCode: {
    en: "Couldn't send the verification code. Please try again.",
    ur: "تصدیقی کوڈ نہیں بھیجا جا سکا۔ براہ کرم دوبارہ کوشش کریں۔",
  },
  phoneAndCodeRequired: {
    en: "Phone number and code are required.",
    ur: "فون نمبر اور کوڈ درکار ہیں۔",
  },
  incorrectOrExpiredCode: {
    en: "Incorrect or expired code.",
    ur: "غلط یا میعاد ختم کوڈ۔",
  },
  couldntVerifyCode: {
    en: "Couldn't verify the code. Please try again.",
    ur: "کوڈ کی تصدیق نہیں ہو سکی۔ براہ کرم دوبارہ کوشش کریں۔",
  },

  // Donor registration (controllers/donorController/registerAsDonor.js)
  alreadyRegisteredDonor: {
    en: "Already registered as a donor!",
    ur: "پہلے سے ہی عطیہ دہندہ کے طور پر رجسٹرڈ ہیں!",
  },
  donorProfileCreated: {
    en: "Donor profile created successfully",
    ur: "عطیہ دہندہ پروفائل کامیابی سے بن گئی",
  },
  errorRegisteringDonor: {
    en: "Error registering donor",
    ur: "عطیہ دہندہ رجسٹر کرنے میں خرابی",
  },

  // Update donor profile (controllers/donorController/updateDonorProfile.js)
  donorProfileNotFound: {
    en: "Donor profile not found",
    ur: "عطیہ دہندہ پروفائل نہیں ملی",
  },
  availabilityLocked90Days: {
    en: "Action Blocked: You cannot toggle availability during your 90-day post-donation recovery period.",
    ur: "کارروائی روک دی گئی: آپ اپنے 90 دن کے عطیہ کے بعد کی بحالی کی مدت کے دوران دستیابی تبدیل نہیں کر سکتے۔",
  },
  profileUpdatedSuccess: {
    en: "Profile updated successfully",
    ur: "پروفائل کامیابی سے اپڈیٹ ہو گئی",
  },
};

// Reads the app's language selection off the request. Defaults to English
// for older app builds or any client that doesn't send the header.
function getLang(req) {
  const header = (req.headers["x-lang"] || req.headers["X-Lang"] || "").toString().toLowerCase();
  return header === "ur" ? "ur" : "en";
}

function localize(req, key) {
  const lang = getLang(req);
  return messages[key]?.[lang] ?? messages[key]?.en ?? key;
}

module.exports = { localize, getLang };

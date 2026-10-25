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
    en: "Action Blocked: You cannot toggle availability during your post-donation recovery period.",
    ur: "کارروائی روک دی گئی: آپ اپنے عطیہ کے بعد کی بحالی کی مدت کے دوران دستیابی تبدیل نہیں کر سکتے۔",
  },
  // Donation lifecycle API errors (controllers/lifecycleController.js)
  lc_NOT_FOUND: { en: "This request is no longer available.", ur: "یہ درخواست اب دستیاب نہیں ہے۔" },
  lc_DONOR_NOT_FOUND: { en: "Donor profile not found.", ur: "ڈونر پروفائل نہیں ملا۔" },
  lc_INVALID_STATE: {
    en: "This request has already changed. Please refresh and try again.",
    ur: "یہ درخواست پہلے ہی تبدیل ہو چکی ہے۔ براہِ کرم ریفریش کر کے دوبارہ کوشش کریں۔",
  },
  lc_REQUEST_EXPIRED: {
    en: "This request has expired and can no longer be answered.",
    ur: "یہ درخواست ختم ہو چکی ہے اور اب اس کا جواب نہیں دیا جا سکتا۔",
  },
  lc_REQUEST_CANCELLED: { en: "This request was cancelled by the seeker.", ur: "یہ درخواست سیکر نے منسوخ کر دی تھی۔" },
  lc_DONOR_BUSY: {
    en: "You are already in another donation process. Finish or cancel it first.",
    ur: "آپ پہلے ہی کسی اور عطیے کے عمل میں ہیں۔ پہلے اسے مکمل یا منسوخ کریں۔",
  },
  lc_DONOR_RESTING: {
    en: "This donor is currently in recovery after a donation.",
    ur: "یہ ڈونر عطیے کے بعد صحت یابی کے دورانیے میں ہے۔",
  },
  lc_DONOR_RESTRICTED: {
    en: "You can't accept new requests right now because a seeker reported a delay.",
    ur: "ایک سیکر کی جانب سے تاخیر کی اطلاع کی وجہ سے آپ ابھی نئی درخواستیں قبول نہیں کر سکتے۔",
  },
  lc_SEEKER_BLOCKED: {
    en: "You cannot send new requests until you complete your previous request.",
    ur: "جب تک آپ اپنی پچھلی درخواست مکمل نہیں کرتے، آپ نئی درخواستیں نہیں بھیج سکتے۔",
  },
  lc_NOT_AGREED: {
    en: "The seeker has not agreed to proceed yet.",
    ur: "سیکر نے ابھی آگے بڑھنے کی منظوری نہیں دی۔",
  },
  lc_ALREADY_COMPLETED: { en: "This request is already completed.", ur: "یہ درخواست پہلے ہی مکمل ہو چکی ہے۔" },
  lc_FORBIDDEN: { en: "You are not allowed to do that.", ur: "آپ کو اس کی اجازت نہیں ہے۔" },
  lc_REASON_REQUIRED: { en: "Please enter a short message.", ur: "براہِ کرم ایک مختصر پیغام لکھیں۔" },
  lc_REPORT_TOO_EARLY: {
    en: "You can report a delay {minutes} minutes after locking the donor.",
    ur: "ڈونر کو لاک کرنے کے {minutes} منٹ بعد آپ تاخیر کی اطلاع دے سکتے ہیں۔",
  },
  lc_NUDGE_COOLDOWN: {
    en: "You can send another reminder in {minutes} min.",
    ur: "آپ {minutes} منٹ بعد دوبارہ یاد دہانی بھیج سکتے ہیں۔",
  },
  lc_NOTHING_TO_RENOTIFY: {
    en: "There are no released donors to re-notify right now.",
    ur: "اس وقت دوبارہ اطلاع دینے کے لیے کوئی فارغ کیا گیا ڈونر موجود نہیں۔",
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

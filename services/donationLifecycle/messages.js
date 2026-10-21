// Notification texts for the donation lifecycle, in the RECIPIENT's language
// (User.language, "en" | "ur"; falls back to English). The English strings for the
// seeker/donor-facing copy are the exact wording from the product brief.
//
// `{name}` placeholders are filled by format().
const M = {
  donorLocked: {
    type: "donor_locked",
    en: { title: "Locked for donation", body: "Seeker has locked you for donation." },
    ur: { title: "عطیے کے لیے لاک", body: "سیکر نے آپ کو خون کے عطیے کے لیے لاک کر دیا ہے۔" },
  },
  donorReleased: {
    type: "donor_released",
    en: {
      title: "Released",
      body: "Seeker has released you. Thank you so much for your willingness to help! May Allah reward you.",
    },
    ur: {
      title: "درخواست ختم",
      body: "سیکر نے آپ کو فارغ کر دیا ہے۔ مدد کے جذبے کا بہت شکریہ! اللہ آپ کو جزائے خیر دے۔",
    },
  },
  donationStarted: {
    type: "donation_started",
    en: { title: "Donation started", body: "Donor has started his donation, do you agree?" },
    ur: { title: "عطیہ شروع", body: "ڈونر نے اپنا عطیہ شروع کر دیا ہے، کیا آپ متفق ہیں؟" },
  },
  donationAgreed: {
    type: "donation_agreed",
    en: {
      title: "Seeker agreed",
      body: "Seeker has agreed. You can mark your donation as given once it is done.",
    },
    ur: {
      title: "سیکر متفق ہے",
      body: "سیکر نے رضامندی دے دی ہے۔ عطیہ مکمل ہونے کے بعد آپ اسے مارک کر سکتے ہیں۔",
    },
  },
  donationNotAgreed: {
    type: "donation_not_agreed",
    en: {
      title: "Waiting for the seeker",
      body: "Seeker has not agreed to proceed yet. Please wait for their go-ahead before starting again.",
    },
    ur: {
      title: "سیکر کا انتظار",
      body: "سیکر نے ابھی آگے بڑھنے کی منظوری نہیں دی۔ دوبارہ شروع کرنے سے پہلے ان کی اجازت کا انتظار کریں۔",
    },
  },
  onHold: {
    type: "donation_on_hold",
    en: {
      title: "Request on hold",
      body: "Donor is currently busy with another seeker's donation process. Your request has been put On Hold. You will be notified as soon as the donor is free.",
    },
    ur: {
      title: "درخواست روک دی گئی",
      body: "ڈونر اس وقت کسی اور سیکر کے عطیے کے عمل میں مصروف ہے۔ آپ کی درخواست روک دی گئی ہے۔ ڈونر کے فارغ ہوتے ہی آپ کو اطلاع دی جائے گی۔",
    },
  },
  holdReverted: {
    type: "donor_available_again",
    en: {
      title: "Donor available again",
      body: "Donor is now available again, you can continue your donation process.",
    },
    ur: {
      title: "ڈونر دوبارہ دستیاب",
      body: "ڈونر اب دوبارہ دستیاب ہے، آپ اپنا عطیے کا عمل جاری رکھ سکتے ہیں۔",
    },
  },
  autoReleased: {
    type: "donor_auto_released",
    en: {
      title: "Donor donated elsewhere",
      body: "This donor donated to another seeker and is now in recovery. Your request has been released.",
    },
    ur: {
      title: "ڈونر نے کہیں اور عطیہ دیا",
      body: "اس ڈونر نے کسی اور سیکر کو عطیہ دے دیا ہے اور اب صحت یابی کے دورانیے میں ہے۔ آپ کی درخواست ختم کر دی گئی ہے۔",
    },
  },
  renotify: {
    type: "request_renotified",
    en: {
      title: "Seeker needs your help again",
      body: "Seeker needs your help again. Their previous donation could not be completed. If you are still available, please accept the request. May Allah reward you.",
    },
    ur: {
      title: "سیکر کو دوبارہ آپ کی مدد درکار ہے",
      body: "سیکر کو دوبارہ آپ کی مدد کی ضرورت ہے۔ ان کا پچھلا عطیہ مکمل نہیں ہو سکا۔ اگر آپ اب بھی دستیاب ہیں تو براہِ کرم درخواست قبول کر لیں۔ اللہ آپ کو جزائے خیر دے۔",
    },
  },
  requestExpired: {
    type: "request_expired",
    en: {
      title: "Blood Request Expired",
      body: "Your request to {name} expired after 12 hours without a response. You can notify the donor again.",
    },
    ur: {
      title: "خون کی درخواست ختم ہو گئی",
      body: "{name} کو بھیجی گئی آپ کی درخواست 12 گھنٹے تک جواب نہ ملنے پر ختم ہو گئی۔ آپ ڈونر کو دوبارہ اطلاع دے سکتے ہیں۔",
    },
  },
  donorUnable: {
    type: "donor_unable",
    en: { title: "Donor can't donate right now", body: "{name} can't donate at this time. Message: {message}" },
    ur: { title: "ڈونر اس وقت عطیہ نہیں دے سکتا", body: "{name} اس وقت عطیہ نہیں دے سکتے۔ پیغام: {message}" },
  },
  donorReported: {
    type: "donor_reported",
    en: {
      title: "A delay was reported",
      body: "A seeker reported a delay with your donation. You can't accept new requests for the next {hours} hours.",
    },
    ur: {
      title: "تاخیر کی اطلاع دی گئی",
      body: "ایک سیکر نے آپ کے عطیے میں تاخیر کی اطلاع دی ہے۔ آپ اگلے {hours} گھنٹے تک نئی درخواستیں قبول نہیں کر سکتے۔",
    },
  },
  completeReminder: {
    type: "donation_reminder",
    en: {
      title: "Please mark the donation complete",
      body: "The donor marked the donation as given. Please tap Mark Complete to confirm.",
    },
    ur: {
      title: "براہِ کرم عطیہ مکمل کریں",
      body: "ڈونر نے عطیہ دینا مارک کر دیا ہے۔ تصدیق کے لیے براہِ کرم «مکمل کریں» دبائیں۔",
    },
  },
};

const format = (text, params = {}) =>
  String(text).replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined || params[k] === null ? "" : String(params[k])));

/** { type, title, body } for `key` in `lang`, placeholders filled. */
const render = (key, lang, params) => {
  const m = M[key];
  if (!m) throw new Error(`Unknown lifecycle message "${key}"`);
  const l = lang === "ur" ? m.ur : m.en;
  return { type: m.type, title: format(l.title, params), body: format(l.body, params) };
};

/** All notification types this module can emit (registered in notificationController). */
const MESSAGE_TYPES = Array.from(new Set(Object.values(M).map((m) => m.type)));

module.exports = { render, format, MESSAGE_TYPES, M };

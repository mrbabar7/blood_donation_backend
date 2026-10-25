const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getStorage } = require("firebase-admin/storage");

let serviceAccount;

if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
) {
  serviceAccount = {
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/^"|"$/g, ""),
  };
}

// 1. Load from Base64 env variable (Local .env or Railway)
if (!serviceAccount && process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  try {
    const decodedJson = Buffer.from(
      process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
      "base64",
    ).toString("utf8");
    serviceAccount = JSON.parse(decodedJson);
  } catch (err) {
    console.error("❌ Failed to parse Base64 Firebase config:", err.message);
  }
}

// 2. Fallback to raw JSON string env variable
if (!serviceAccount && process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount =
      typeof process.env.FIREBASE_SERVICE_ACCOUNT === "string"
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
  } catch (err) {
    console.error("❌ Failed to parse JSON Firebase config:", err.message);
  }
}

// 3. Fix private key newlines if necessary
if (serviceAccount && serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
}

// 4. Initialize Firebase Admin
if (getApps().length === 0) {
  if (serviceAccount && serviceAccount.project_id) {
    initializeApp({
      credential: cert(serviceAccount),
      // Needed by Firebase Storage (utils/imageUpload.js). Harmless for FCM.
      ...(process.env.FIREBASE_STORAGE_BUCKET
        ? { storageBucket: process.env.FIREBASE_STORAGE_BUCKET }
        : {}),
    });
    console.log("🔥 Firebase Admin SDK initialized successfully.");
  } else {
    console.error("⚠️ Firebase Admin missing valid credentials!");
  }
}

let messaging;
if (getApps().length > 0) {
  messaging = getMessaging();
} else {
  messaging = {
    send: async () => {
      throw new Error(
        "Firebase Admin not initialized — push notification skipped.",
      );
    },
  };
}

const getStorageBucket = () => {
  if (getApps().length === 0) {
    throw new Error(
      "Firebase Storage is not configured — set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.",
    );
  }
  if (!process.env.FIREBASE_STORAGE_BUCKET) {
    throw new Error(
      "Firebase Storage is not configured — set FIREBASE_STORAGE_BUCKET (e.g. your-project.firebasestorage.app).",
    );
  }
  return getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
};

module.exports = { messaging, getStorageBucket };

// const fs = require("fs");
// const path = require("path");
// const crypto = require("crypto");
// const { getStorageBucket } = require("../config/firebaseAdmin");

// // backend/public/images — only used now to clean up LEGACY locally-stored files.
// const IMAGES_ROOT = path.join(__dirname, "..", "public", "images");

// const STORAGE_PREFIX = "images";

// // Folders an upload may target (also enforced by the upload endpoint).
// const ALLOWED_FOLDERS = [
//   "chat",
//   "profile",
//   "hospital",
//   "bloodbank",
//   "ngo",
//   "ambulance",
// ];

// // Allowed formats: jpg/jpeg, png, webp.
// const MIME_TO_EXT = {
//   "image/jpeg": "jpg",
//   "image/jpg": "jpg",
//   "image/png": "png",
//   "image/webp": "webp",
// };
// const EXT_TO_MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

// // First few bytes of each format — used to confirm the file actually is
// // what its declared type claims to be.
// const SIGNATURES = {
//   jpg: [[0xff, 0xd8, 0xff]],
//   png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
//   // WEBP = "RIFF" .... "WEBP" (bytes 8-11), so we check both anchors.
//   webp: [[0x52, 0x49, 0x46, 0x46]],
// };

// const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB decoded

// const DATA_URI_REGEX =
//   /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/;

// class ImageUploadError extends Error {
//   constructor(message, status = 400) {
//     super(message);
//     this.name = "ImageUploadError";
//     this.status = status;
//   }
// }

// const bufferMatchesSignature = (buffer, ext) => {
//   const candidates = SIGNATURES[ext];
//   if (!candidates) return false;
//   return candidates.some((sig) => sig.every((byte, i) => buffer[i] === byte));
// };

// const bufferLooksLikeWebp = (buffer) =>
//   buffer.length > 12 &&
//   buffer.toString("ascii", 0, 4) === "RIFF" &&
//   buffer.toString("ascii", 8, 12) === "WEBP";

// const getPublicBaseUrl = () => {
//   const fromEnv =
//     process.env.PUBLIC_API_URL || process.env.BACKEND_SERVER || "";
//   return fromEnv.replace(/\/+$/, "");
// };

// const isDataUri = (value) =>
//   typeof value === "string" && DATA_URI_REGEX.test(value);

// /** Builds the public Firebase download URL for an uploaded object. */
// const buildDownloadUrl = (bucketName, objectPath, token) =>
//   `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
//     objectPath,
//   )}?alt=media&token=${token}`;

// const saveImageBuffer = async (buffer, declaredMime, folder) => {
//   if (!ALLOWED_FOLDERS.includes(folder)) {
//     throw new ImageUploadError("Invalid upload destination.");
//   }

//   const ext = MIME_TO_EXT[String(declaredMime || "").toLowerCase()];
//   if (!ext) {
//     throw new ImageUploadError(
//       "Unsupported image format. Please upload a JPG, PNG, or WEBP image.",
//     );
//   }

//   if (!buffer || !buffer.length) {
//     throw new ImageUploadError("The uploaded image appears to be empty.");
//   }
//   if (buffer.length > MAX_IMAGE_BYTES) {
//     throw new ImageUploadError(
//       "Image is too large. Please use an image under 5MB.",
//     );
//   }

//   const validSignature =
//     ext === "webp"
//       ? bufferLooksLikeWebp(buffer)
//       : bufferMatchesSignature(buffer, ext);
//   if (!validSignature) {
//     throw new ImageUploadError(
//       "This file doesn't look like a valid image. Please try a different photo.",
//     );
//   }

//   let bucket;
//   try {
//     bucket = getStorageBucket();
//   } catch (err) {
//     console.error("Firebase Storage unavailable:", err.message);
//     throw new ImageUploadError(
//       "Image storage is not available right now. Please try again later.",
//       503,
//     );
//   }

//   const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
//   const objectPath = `${STORAGE_PREFIX}/${folder}/${filename}`;
//   const token = crypto.randomUUID();

//   try {
//     await bucket.file(objectPath).save(buffer, {
//       resumable: false,
//       metadata: {
//         contentType: EXT_TO_MIME[ext],
//         cacheControl: "public, max-age=604800",
//         // This token is what makes the download URL work without opening the
//         // whole bucket to the public (same mechanism the Firebase console uses).
//         metadata: { firebaseStorageDownloadTokens: token },
//       },
//     });
//   } catch (err) {
//     console.error("Firebase Storage upload failed:", err.message);
//     throw new ImageUploadError(
//       "Couldn't upload the image. Please try again.",
//       502,
//     );
//   }

//   return buildDownloadUrl(bucket.name, objectPath, token);
// };

// const saveBase64Image = async (dataUri, folder) => {
//   const match = DATA_URI_REGEX.exec(dataUri);
//   if (!match) {
//     throw new ImageUploadError(
//       "Invalid image data. Please choose the photo again.",
//     );
//   }
//   return saveImageBuffer(Buffer.from(match[2], "base64"), match[1], folder);
// };

// const parseFirebaseObjectPath = (imageUrl) => {
//   let url;
//   try {
//     url = new URL(imageUrl);
//   } catch {
//     return null;
//   }
//   if (url.hostname !== "firebasestorage.googleapis.com") return null;

//   const m = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
//   if (!m) return null;

//   const configuredBucket = process.env.FIREBASE_STORAGE_BUCKET;
//   if (configuredBucket && m[1] !== configuredBucket) return null; // someone else's bucket

//   let objectPath;
//   try {
//     objectPath = decodeURIComponent(m[2]);
//   } catch {
//     return null;
//   }
//   // Never delete anything this module didn't create.
//   if (!objectPath.startsWith(`${STORAGE_PREFIX}/`) || objectPath.includes(".."))
//     return null;
//   return objectPath;
// };

// /** Removes a file from the legacy local public/images folder (path-traversal safe). */
// const deleteLegacyLocalImage = async (imageUrl) => {
//   const marker = "/images/";
//   const idx = imageUrl.indexOf(marker);
//   if (idx === -1) return;

//   const relative = imageUrl.slice(idx + marker.length); // "ngo/xxx.jpg"
//   const resolved = path.join(IMAGES_ROOT, relative);
//   if (!resolved.startsWith(IMAGES_ROOT + path.sep)) return;

//   try {
//     await fs.promises.unlink(resolved);
//   } catch (err) {
//     if (err.code !== "ENOENT") {
//       console.error("Failed to delete old image:", err.message);
//     }
//   }
// };

// const deleteStoredImage = async (imageUrl) => {
//   if (!imageUrl || typeof imageUrl !== "string") return;

//   const objectPath = parseFirebaseObjectPath(imageUrl);
//   if (objectPath) {
//     try {
//       await getStorageBucket()
//         .file(objectPath)
//         .delete({ ignoreNotFound: true });
//     } catch (err) {
//       console.error("Failed to delete Firebase image:", err.message);
//     }
//     return;
//   }

//   // Not a Firebase URL — may be a pre-migration local file.
//   if (!/^https?:\/\/firebasestorage\.googleapis\.com/.test(imageUrl)) {
//     await deleteLegacyLocalImage(imageUrl);
//   }
// };

// const resolveImageField = async (newValue, oldValue, folder) => {
//   if (newValue === undefined) return undefined;

//   if (newValue === null || newValue === "") {
//     if (oldValue) await deleteStoredImage(oldValue);
//     return "";
//   }

//   if (isDataUri(newValue)) {
//     const savedUrl = await saveBase64Image(newValue, folder);
//     if (oldValue) await deleteStoredImage(oldValue);
//     return savedUrl;
//   }

//   // Unchanged existing URL echoed back from the edit form (or an external URL).
//   return newValue;
// };

// module.exports = {
//   ImageUploadError,
//   IMAGES_ROOT,
//   ALLOWED_FOLDERS,
//   MAX_IMAGE_BYTES,
//   isDataUri,
//   saveBase64Image,
//   saveImageBuffer,
//   deleteStoredImage,
//   resolveImageField,
//   getPublicBaseUrl,
// };

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

// backend/public/images — only used to clean up LEGACY locally-stored files.
const IMAGES_ROOT = path.join(__dirname, "..", "public", "images");

// Folders an upload may target.
const ALLOWED_FOLDERS = [
  "chat",
  "profile",
  "hospital",
  "bloodbank",
  "ngo",
  "ambulance",
];

// Allowed formats: jpg/jpeg, png, webp.
const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const EXT_TO_MIME = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// First few bytes of each format — used to confirm the file actually is
// what its declared type claims to be.
const SIGNATURES = {
  jpg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],

  // WEBP = "RIFF" .... "WEBP" (bytes 8-11),
  // so we check both anchors separately.
  webp: [[0x52, 0x49, 0x46, 0x46]],
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

const DATA_URI_REGEX =
  /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/;

class ImageUploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ImageUploadError";
    this.status = status;
  }
}

const bufferMatchesSignature = (buffer, ext) => {
  const candidates = SIGNATURES[ext];

  if (!candidates) return false;

  return candidates.some((sig) => sig.every((byte, i) => buffer[i] === byte));
};

const bufferLooksLikeWebp = (buffer) =>
  buffer.length > 12 &&
  buffer.toString("ascii", 0, 4) === "RIFF" &&
  buffer.toString("ascii", 8, 12) === "WEBP";

const getPublicBaseUrl = () => {
  const fromEnv =
    process.env.PUBLIC_API_URL || process.env.BACKEND_SERVER || "";

  return fromEnv.replace(/\/+$/, "");
};

const isDataUri = (value) =>
  typeof value === "string" && DATA_URI_REGEX.test(value);

/**
 * Configure Cloudinary once when this module is loaded.
 *
 * Required environment variables:
 * CLOUDINARY_CLOUD_NAME
 * CLOUDINARY_API_KEY
 * CLOUDINARY_API_SECRET
 */
const configureCloudinary = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new ImageUploadError(
      "Image storage is not available right now. Please try again later.",
      503,
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });

  return cloudinary;
};

/**
 * Upload a Buffer to Cloudinary.
 *
 * The public_id is generated ourselves so that deletion can later be
 * performed safely using the Cloudinary public_id extracted from the URL.
 */
const uploadBufferToCloudinary = (buffer, mimeType, folder, filename) => {
  return new Promise((resolve, reject) => {
    let uploader;

    try {
      const cloudinaryClient = configureCloudinary();

      uploader = cloudinaryClient.uploader.upload_stream(
        {
          folder: `images/${folder}`,
          public_id: filename,
          resource_type: "image",
          format: MIME_TO_EXT[mimeType],
          overwrite: false,
          use_filename: false,
          unique_filename: false,
        },
        (error, result) => {
          if (error) {
            return reject(error);
          }

          if (!result?.secure_url) {
            return reject(new Error("Cloudinary did not return an image URL."));
          }

          resolve(result.secure_url);
        },
      );
    } catch (error) {
      reject(error);
      return;
    }

    uploader.end(buffer);
  });
};

const saveImageBuffer = async (buffer, declaredMime, folder) => {
  if (!ALLOWED_FOLDERS.includes(folder)) {
    throw new ImageUploadError("Invalid upload destination.");
  }

  const mimeType = String(declaredMime || "").toLowerCase();
  const ext = MIME_TO_EXT[mimeType];

  if (!ext) {
    throw new ImageUploadError(
      "Unsupported image format. Please upload a JPG, PNG, or WEBP image.",
    );
  }

  if (!buffer || !buffer.length) {
    throw new ImageUploadError("The uploaded image appears to be empty.");
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ImageUploadError(
      "Image is too large. Please use an image under 5MB.",
    );
  }

  const validSignature =
    ext === "webp"
      ? bufferLooksLikeWebp(buffer)
      : bufferMatchesSignature(buffer, ext);

  if (!validSignature) {
    throw new ImageUploadError(
      "This file doesn't look like a valid image. Please try a different photo.",
    );
  }

  // Cloudinary public_id must not contain the extension when format is
  // supplied separately.
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;

  try {
    return await uploadBufferToCloudinary(buffer, mimeType, folder, filename);
  } catch (err) {
    console.error("Cloudinary image upload failed:", err.message);

    throw new ImageUploadError(
      "Couldn't upload the image. Please try again.",
      502,
    );
  }
};

const saveBase64Image = async (dataUri, folder) => {
  const match = DATA_URI_REGEX.exec(dataUri);

  if (!match) {
    throw new ImageUploadError(
      "Invalid image data. Please choose the photo again.",
    );
  }

  const mimeType = match[1].toLowerCase();

  return saveImageBuffer(Buffer.from(match[2], "base64"), mimeType, folder);
};

/**
 * Extracts the Cloudinary public_id from one of our Cloudinary URLs.
 *
 * Example URL:
 *
 * https://res.cloudinary.com/demo/image/upload/v1234567890/images/chat/123-abc.jpg
 *
 * Returns:
 *
 * images/chat/123-abc
 */
const parseCloudinaryPublicId = (imageUrl) => {
  let url;

  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "res.cloudinary.com") {
    return null;
  }

  const pathname = decodeURIComponent(url.pathname);

  // Expected Cloudinary delivery URL:
  //
  // /<resource_type>/<delivery_type>/<version>/<public_id>.<format>
  //
  // We only support URLs created under:
  //
  // images/<allowed-folder>/...
  const marker = "/image/upload/";

  const markerIndex = pathname.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  let publicPath = pathname.slice(markerIndex + marker.length);

  // Remove transformation segments if they ever appear before the version.
  // For our generated URLs this normally isn't needed, but it keeps parsing
  // safer if Cloudinary transformations are added later.
  const parts = publicPath.split("/");

  if (parts[0]?.startsWith("v") && /^\d+$/.test(parts[0].slice(1))) {
    parts.shift();
  }

  publicPath = parts.join("/");

  // Remove the file extension from the public_id.
  publicPath = publicPath.replace(/\.(jpg|jpeg|png|webp)$/i, "");

  // Never delete anything outside our own images folder.
  if (!publicPath.startsWith("images/")) {
    return null;
  }

  const folder = publicPath.split("/")[1];

  if (!ALLOWED_FOLDERS.includes(folder)) {
    return null;
  }

  if (publicPath.includes("..")) {
    return null;
  }

  return publicPath;
};

/**
 * Removes a Cloudinary image.
 */
const deleteCloudinaryImage = async (imageUrl) => {
  const publicId = parseCloudinaryPublicId(imageUrl);

  if (!publicId) {
    return false;
  }

  try {
    const cloudinaryClient = configureCloudinary();

    await cloudinaryClient.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true,
    });

    return true;
  } catch (err) {
    console.error("Failed to delete Cloudinary image:", err.message);

    return false;
  }
};

/**
 * Removes a file from the legacy local public/images folder
 * (path-traversal safe).
 */
const deleteLegacyLocalImage = async (imageUrl) => {
  const marker = "/images/";
  const idx = imageUrl.indexOf(marker);

  if (idx === -1) return;

  const relative = imageUrl.slice(idx + marker.length);

  const resolved = path.join(IMAGES_ROOT, relative);

  if (!resolved.startsWith(IMAGES_ROOT + path.sep)) {
    return;
  }

  try {
    await fs.promises.unlink(resolved);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("Failed to delete old local image:", err.message);
    }
  }
};

const deleteStoredImage = async (imageUrl) => {
  if (!imageUrl || typeof imageUrl !== "string") {
    return;
  }

  // New Cloudinary images.
  if (imageUrl.includes("res.cloudinary.com")) {
    await deleteCloudinaryImage(imageUrl);
    return;
  }

  // Legacy local images.
  await deleteLegacyLocalImage(imageUrl);
};

const resolveImageField = async (newValue, oldValue, folder) => {
  if (newValue === undefined) {
    return undefined;
  }

  if (newValue === null || newValue === "") {
    if (oldValue) {
      await deleteStoredImage(oldValue);
    }

    return "";
  }

  if (isDataUri(newValue)) {
    const savedUrl = await saveBase64Image(newValue, folder);

    if (oldValue) {
      await deleteStoredImage(oldValue);
    }

    return savedUrl;
  }

  // Existing URL echoed back from the edit form
  // (or another external URL).
  return newValue;
};

module.exports = {
  ImageUploadError,
  IMAGES_ROOT,
  ALLOWED_FOLDERS,
  MAX_IMAGE_BYTES,
  isDataUri,
  saveBase64Image,
  saveImageBuffer,
  deleteStoredImage,
  resolveImageField,
  getPublicBaseUrl,
};

/**
 * multerMemory.js
 * ---------------------------------------------------------------------------
 * Shared multer instance for multipart image uploads (routes/uploadRouter.js).
 * Buffers files in memory only — nothing touches local disk — since every
 * upload is forwarded straight to Firebase Storage via utils/imageUpload.js.
 * ---------------------------------------------------------------------------
 */
const multer = require("multer");
const { MAX_IMAGE_BYTES } = require("./imageUpload");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

module.exports = upload;

const {
  saveImageBuffer,
  saveBase64Image,
  ImageUploadError,
  ALLOWED_FOLDERS,
} = require("../utils/imageUpload");

exports.uploadImage = async (req, res) => {
  try {
    const folder = req.body?.folder || req.query?.folder;
    if (!folder || !ALLOWED_FOLDERS.includes(folder)) {
      return res.status(400).json({
        success: false,
        message: `Invalid or missing "folder". Expected one of: ${ALLOWED_FOLDERS.join(", ")}.`,
      });
    }

    let url;
    if (req.file) {
      // Multipart upload (multer memory storage).
      url = await saveImageBuffer(req.file.buffer, req.file.mimetype, folder);
    } else if (typeof req.body?.image === "string" && req.body.image) {
      // Base64 data-URI upload.
      url = await saveBase64Image(req.body.image, folder);
    } else {
      return res.status(400).json({
        success: false,
        message:
          'No image provided. Send a multipart "image" file or a base64 "image" data URI.',
      });
    }

    return res.status(200).json({ success: true, url });
  } catch (error) {
    if (error instanceof ImageUploadError) {
      return res
        .status(error.status || 400)
        .json({ success: false, message: error.message });
    }
    console.error("Image upload error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error uploading image." });
  }
};

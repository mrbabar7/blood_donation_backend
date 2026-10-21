const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const upload = require("../utils/multerMemory");
const { uploadImage } = require("../controllers/uploadController");

// Accepts EITHER a multipart "image" file OR a JSON { image: <base64 data URI> }
// body — multer simply no-ops (req.file stays undefined) when the request
// isn't multipart, so one route handles both without any content-type branching.
router.post("/image", protect, upload.single("image"), uploadImage);

module.exports = router;

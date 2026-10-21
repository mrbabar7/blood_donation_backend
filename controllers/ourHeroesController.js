const mongoose = require("mongoose");
const OurHero = require("../models/ourHeroModel");
const { writeAuditLog } = require("./admin/auditLogController");
const { roleHasPermission, PERMISSIONS } = require("../config/adminPermissions");
const {
  saveImageBuffer,
  saveBase64Image,
  isDataUri,
  deleteStoredImage,
  ImageUploadError,
} = require("../utils/imageUpload");

const IMAGE_FOLDER = "hero";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const LIMITS = {
  name: 120,
  address: 250,
  contact: 30,
  shortDescription: 300,
  fullDescription: 5000,
  specialty: 60,
  specialties: 20,
  activity: 200,
  activities: 30,
};

// ---- helpers ---------------------------------------------------------------
const fail = (res, status, message, errors) =>
  res.status(status).json({ success: false, message, ...(errors ? { errors } : {}) });

// Strips tags / control characters and collapses whitespace so stored text can
// never carry markup into the app or the admin dashboard.
const clean = (value) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseBool = (v) => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1" || v === 1) return true;
  if (v === "false" || v === "0" || v === 0) return false;
  return undefined;
};

const isHttpUrl = (v) => {
  if (typeof v !== "string" || v.length > 2048) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

// Digits with optional leading +, spaces, dashes, brackets. 7-15 digits (E.164 max).
const validContact = (v) => {
  if (!/^\+?[0-9\s\-()]{7,30}$/.test(v)) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
};

const cleanList = (value, { maxItems, maxLength, label }, errors) => {
  if (!Array.isArray(value)) {
    errors[label] = `${label} must be a list of text items.`;
    return undefined;
  }
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string") {
      errors[label] = `${label} must only contain text.`;
      return undefined;
    }
    const item = clean(raw);
    if (!item) continue;
    if (item.length > maxLength) {
      errors[label] = `Each item in ${label} can be at most ${maxLength} characters.`;
      return undefined;
    }
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  if (out.length > maxItems) {
    errors[label] = `${label} can have at most ${maxItems} items.`;
    return undefined;
  }
  return out;
};

// Validates the writable fields. `partial` (PUT) only validates what was sent;
// otherwise (POST) the required ones must be present.
const validateBody = (body, { partial }) => {
  const errors = {};
  const data = {};
  const b = body && typeof body === "object" ? body : {};

  const text = (field, max, required) => {
    if (b[field] === undefined) {
      if (!partial && required) errors[field] = `${field} is required.`;
      return;
    }
    if (typeof b[field] !== "string") {
      errors[field] = `${field} must be text.`;
      return;
    }
    const v = clean(b[field]);
    if (!v && required) errors[field] = `${field} is required.`;
    else if (v.length > max) errors[field] = `${field} can be at most ${max} characters.`;
    else data[field] = v;
  };

  text("name", LIMITS.name, true);
  text("address", LIMITS.address, true);
  text("shortDescription", LIMITS.shortDescription, true);
  text("fullDescription", LIMITS.fullDescription, true);

  if (b.contact !== undefined && b.contact !== null) {
    if (typeof b.contact !== "string") errors.contact = "contact must be text.";
    else {
      const v = clean(b.contact);
      if (v && !validContact(v)) errors.contact = "Enter a valid phone number (7-15 digits).";
      else data.contact = v;
    }
  } else if (b.contact === null) {
    data.contact = "";
  }

  if (b.specialties !== undefined) {
    const list = cleanList(b.specialties, { maxItems: LIMITS.specialties, maxLength: LIMITS.specialty, label: "specialties" }, errors);
    if (list) data.specialties = list;
  }
  if (b.activities !== undefined) {
    const list = cleanList(b.activities, { maxItems: LIMITS.activities, maxLength: LIMITS.activity, label: "activities" }, errors);
    if (list) data.activities = list;
  }

  if (b.isActive !== undefined) {
    const v = parseBool(b.isActive);
    if (v === undefined) errors.isActive = "isActive must be true or false.";
    else data.isActive = v;
  }

  return { data, errors };
};

// Resolves the incoming image to a stored URL. Accepts either an already-hosted
// `imageUrl` (e.g. from POST /our-heroes/upload-image) or a base64 `image` data
// URI, which is uploaded through the existing Cloudinary service. Only the URL
// is ever stored.
const resolveImage = async (body, errors, { required }) => {
  const b = body || {};
  if (typeof b.image === "string" && b.image) {
    if (!isDataUri(b.image)) {
      errors.image = "image must be a base64 image data URI.";
      return undefined;
    }
    return { url: await saveBase64Image(b.image, IMAGE_FOLDER), uploaded: true };
  }
  if (b.imageUrl !== undefined) {
    if (!isHttpUrl(b.imageUrl)) {
      errors.imageUrl = "imageUrl must be a valid http(s) URL.";
      return undefined;
    }
    return { url: b.imageUrl.trim(), uploaded: false };
  }
  if (required) errors.imageUrl = "A hero image is required.";
  return undefined;
};

// Admin visibility: a valid admin token (see optionalAdmin) whose role may
// manage content. Everyone else — guests and regular users — only ever sees
// active heroes, whatever query string they send.
const adminCanSeeInactive = (req) =>
  !!req.admin && roleHasPermission(req.admin.role, PERMISSIONS.MANAGE_CONTENT);

const parseId = (req, res) => {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id) || String(new mongoose.Types.ObjectId(id)) !== String(id)) {
    fail(res, 400, "Invalid hero id.");
    return null;
  }
  return id;
};

const audit = (req, action) =>
  writeAuditLog({
    actorId: req.admin._id,
    actorName: req.admin.name,
    action,
    category: "content",
  }).catch(() => {});

// ---- public + admin reads --------------------------------------------------
// GET /our-heroes (alias /api/our-heroes)
//   ?isActive=true|false (admin only; ignored for the public)
//   ?search=<name or address>   ?page=1&limit=20 (max 50)
exports.listHeroes = async (req, res) => {
  try {
    const filter = {};
    if (adminCanSeeInactive(req)) {
      const active = parseBool(req.query.isActive);
      if (active !== undefined) filter.isActive = active;
    } else {
      filter.isActive = true; // enforced server-side even if the client omits ?isActive=true
    }

    const search = clean(req.query.search ?? req.query.q ?? "").slice(0, 80);
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: rx }, { address: rx }];
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));

    const [heroes, total] = await Promise.all([
      OurHero.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-__v")
        .lean(),
      OurHero.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      heroes,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("listHeroes error:", error);
    fail(res, 500, "Server error loading heroes.");
  }
};

// GET /our-heroes/:id — inactive records answer 404 to the public (no leak).
exports.getHero = async (req, res) => {
  try {
    const id = parseId(req, res);
    if (!id) return;
    const filter = { _id: id };
    if (!adminCanSeeInactive(req)) filter.isActive = true;
    const hero = await OurHero.findOne(filter).select("-__v").lean();
    if (!hero) return fail(res, 404, "Hero not found.");
    res.status(200).json({ success: true, hero });
  } catch (error) {
    console.error("getHero error:", error);
    fail(res, 500, "Server error loading hero.");
  }
};

// ---- admin mutations (routes apply protectAdmin + MANAGE_CONTENT) -----------
exports.createHero = async (req, res) => {
  try {
    const { data, errors } = validateBody(req.body, { partial: false });
    const image = await resolveImage(req.body, errors, { required: true });
    if (Object.keys(errors).length) return fail(res, 400, "Please fix the highlighted fields.", errors);

    const hero = await OurHero.create({ ...data, imageUrl: image.url });
    await audit(req, `Created hero: ${hero.name}`);
    res.status(201).json({ success: true, hero });
  } catch (error) {
    if (error instanceof ImageUploadError) return fail(res, error.status || 400, error.message);
    console.error("createHero error:", error);
    fail(res, 500, "Server error creating hero.");
  }
};

exports.updateHero = async (req, res) => {
  try {
    const id = parseId(req, res);
    if (!id) return;
    const existing = await OurHero.findById(id);
    if (!existing) return fail(res, 404, "Hero not found.");

    const { data, errors } = validateBody(req.body, { partial: true });
    const image = await resolveImage(req.body, errors, { required: false });
    if (Object.keys(errors).length) return fail(res, 400, "Please fix the highlighted fields.", errors);
    if (!Object.keys(data).length && !image) return fail(res, 400, "Nothing to update.");

    const oldImage = existing.imageUrl;
    existing.set(data);
    if (image) existing.imageUrl = image.url;
    await existing.save();

    // Replaced photo: drop the old Cloudinary asset (best-effort).
    if (image && oldImage && oldImage !== image.url) await deleteStoredImage(oldImage).catch(() => {});

    await audit(req, `Updated hero: ${existing.name}`);
    res.status(200).json({ success: true, hero: existing });
  } catch (error) {
    if (error instanceof ImageUploadError) return fail(res, error.status || 400, error.message);
    console.error("updateHero error:", error);
    fail(res, 500, "Server error updating hero.");
  }
};

// PATCH /our-heroes/:id/toggle — quick activate / deactivate from the admin table.
exports.toggleHero = async (req, res) => {
  try {
    const id = parseId(req, res);
    if (!id) return;
    const hero = await OurHero.findById(id);
    if (!hero) return fail(res, 404, "Hero not found.");
    hero.isActive = !hero.isActive;
    await hero.save();
    await audit(req, `${hero.isActive ? "Activated" : "Deactivated"} hero: ${hero.name}`);
    res.status(200).json({ success: true, hero });
  } catch (error) {
    console.error("toggleHero error:", error);
    fail(res, 500, "Server error updating hero.");
  }
};

exports.deleteHero = async (req, res) => {
  try {
    const id = parseId(req, res);
    if (!id) return;
    const hero = await OurHero.findByIdAndDelete(id);
    if (!hero) return fail(res, 404, "Hero not found.");
    if (hero.imageUrl) await deleteStoredImage(hero.imageUrl).catch(() => {});
    await audit(req, `Deleted hero: ${hero.name}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("deleteHero error:", error);
    fail(res, 500, "Server error deleting hero.");
  }
};

// POST /our-heroes/upload-image (multipart "image") — admin photo upload with
// preview support: returns the hosted URL to send back as `imageUrl`.
exports.uploadHeroImage = async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, 'No image provided. Send a multipart "image" file.');
    const url = await saveImageBuffer(req.file.buffer, req.file.mimetype, IMAGE_FOLDER);
    res.status(200).json({ success: true, url });
  } catch (error) {
    if (error instanceof ImageUploadError) return fail(res, error.status || 400, error.message);
    console.error("uploadHeroImage error:", error);
    fail(res, 500, "Server error uploading image.");
  }
};

exports._internals = { validateBody, clean, validContact, escapeRegex };

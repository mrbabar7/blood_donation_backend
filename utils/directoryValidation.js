// Shared validation + normalization for the four directory (organization) types:
// Hospital, Ambulance, Blood Bank and NGO. The "Partner" type has been retired
// (see docs/DIRECTORY_REFACTOR.md) and is intentionally NOT accepted here.
//
// Pure functions only (no DB, no Express) so they are unit-testable in isolation
// — see tests/directoryValidation.test.js.
const { validCoord } = require("./geo");

// Canonical `formType` stored on each document. These match the existing
// schema defaults so already-stored records keep matching their queries.
const ORG_TYPES = Object.freeze({
  hospital: "Hospital",
  ambulance: "ambulance",
  bloodbank: "bloodbank",
  ngo: "ngo",
});

// Sub-type (`orgType`) values a NEW or UPDATED NGO may carry. The NGO schema
// enum still lists the retired partner-flavoured values so legacy documents
// stay valid when they are re-saved; new writes are restricted to these.
const NGO_ORG_SUBTYPES = Object.freeze(["Registered NGO", "Trust", "Foundation", "Volunteer Group"]);

const ADDRESS_SOURCES = Object.freeze(["manual", "gps"]);

const LIMITS = Object.freeze({
  province: 80,
  city: 80,
  fullAddress: 300,
  fullAddressMin: 5,
  website: 200,
  category: 20, // max tags
  categoryLength: 60,
});

const str = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

// Phone Number is the only required contact number. Accepts the usual local /
// international spellings ("0300 1234567", "+92 300 1234567", "(042) 111-222-333").
function validatePhone(raw) {
  const phone = str(raw);
  if (!phone) return { error: "Phone number is required." };
  if (!/^[+()\-\s\d]{7,20}$/.test(phone) || phone.replace(/\D/g, "").length < 7) {
    return { error: "Enter a valid phone number." };
  }
  return { value: phone };
}

// Website stays optional. A scheme is not required (people type "example.org").
function validateWebsite(raw) {
  const website = str(raw);
  if (!website) return { value: "" };
  if (website.length > LIMITS.website || /\s/.test(website) || !/^(https?:\/\/)?[^\s/.]+\.[^\s]+$/i.test(website)) {
    return { error: "Enter a valid website address or leave it empty." };
  }
  return { value: website };
}

function validateCategory(raw) {
  const list = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map(str).filter(Boolean);
  if (list.length === 0) return { error: "At least one category is required." };
  if (list.length > LIMITS.category || list.some((c) => c.length > LIMITS.categoryLength)) {
    return { error: "Too many or too long categories." };
  }
  return { value: Array.from(new Set(list)) };
}

// Builds the display string kept in the legacy top-level `address` field, so
// older clients, search, and directions keep working: "Street, City, Province".
// City / province are skipped when the street text already contains them.
function composeAddress({ fullAddress, city, province }) {
  const lower = fullAddress.toLowerCase();
  const parts = [fullAddress];
  if (city && !lower.includes(city.toLowerCase())) parts.push(city);
  if (province && !lower.includes(province.toLowerCase())) parts.push(province);
  return parts.join(", ");
}

// Coordinates are stored on the existing `location` field (it already powers
// distance / "Nearest" / maps) rather than duplicated inside the address object.
function readCoords(body) {
  // An explicit `location: null` means "forget the stored coordinates" (e.g. the
  // person changed the province after a GPS fix, so the old fix no longer applies).
  if (body && body.location === null) return { provided: false, clear: true };
  const loc = body && typeof body.location === "object" && body.location !== null ? body.location : null;
  if (!loc || (loc.latitude == null && loc.longitude == null)) return { provided: false };
  const latitude = Number(loc.latitude);
  const longitude = Number(loc.longitude);
  if (!validCoord(latitude, longitude)) return { provided: true, valid: false };
  return { provided: true, valid: true, value: { latitude, longitude } };
}

// Validates the normalized address (Province + City + Full Address) and the
// optional coordinates. When `source` is "gps", valid coordinates are mandatory:
// pressing "Use my location" alone never bypasses validation.
function validateAddress(body) {
  const raw = body && typeof body.addressDetails === "object" && body.addressDetails !== null ? body.addressDetails : null;
  if (!raw) return { error: "Province, city and full address are required." };

  const province = str(raw.province);
  const city = str(raw.city);
  const fullAddress = str(raw.fullAddress);
  const source = ADDRESS_SOURCES.includes(raw.source) ? raw.source : "manual";

  const fieldErrors = {};
  if (!province) fieldErrors.province = "Province is required.";
  else if (province.length > LIMITS.province) fieldErrors.province = "Province is too long.";
  if (!city) fieldErrors.city = "City is required.";
  else if (city.length > LIMITS.city) fieldErrors.city = "City is too long.";
  if (!fullAddress) fieldErrors.fullAddress = "Full address is required.";
  else if (fullAddress.length < LIMITS.fullAddressMin) fieldErrors.fullAddress = "Enter a more complete street address.";
  else if (fullAddress.length > LIMITS.fullAddress) fieldErrors.fullAddress = "Full address is too long.";

  const coords = readCoords(body);
  if (coords.provided && !coords.valid) fieldErrors.location = "Location coordinates are invalid.";
  if (source === "gps" && !(coords.provided && coords.valid)) {
    fieldErrors.location = fieldErrors.location || "Valid location coordinates are required when the address comes from GPS.";
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  return {
    value: {
      address: composeAddress({ fullAddress, city, province }),
      addressDetails: { province, city, fullAddress, source },
      ...(coords.provided
        ? { location: coords.value }
        : coords.clear
          ? { location: { latitude: null, longitude: null } }
          : {}),
    },
  };
}

// Validates a create/update body and returns only the fields this module owns
// (phone, website, category, address). Controllers merge the result into their
// own whitelisted payload. `isUpdate` makes every group optional, but a group
// that IS sent is still fully validated.
function validateDirectoryInput(body, { isUpdate = false, orgSubtypes } = {}) {
  const errors = {};
  const clean = {};
  const b = body || {};

  if (!isUpdate || "phone" in b) {
    const r = validatePhone(b.phone);
    if (r.error) errors.phone = r.error;
    else clean.phone = r.value;
  }

  if (!isUpdate || "website" in b) {
    const r = validateWebsite(b.website);
    if (r.error) errors.website = r.error;
    else clean.website = r.value;
  }

  if (!isUpdate || "category" in b) {
    const r = validateCategory(b.category);
    if (r.error) errors.category = r.error;
    else clean.category = r.value;
  }

  if (orgSubtypes && (!isUpdate || "orgType" in b)) {
    if (!orgSubtypes.includes(b.orgType)) errors.orgType = "Unsupported organization sub-type.";
    else clean.orgType = b.orgType;
  }

  if (!isUpdate || "addressDetails" in b || "address" in b) {
    // Old clients sent a single `address` string. Reading such records is still
    // supported; WRITING that shape is not, because it cannot satisfy the
    // province + city + full address requirement.
    const r = validateAddress(b);
    if (r.error) errors.address = r.error;
    else if (r.fieldErrors) Object.assign(errors, { address: r.fieldErrors });
    else Object.assign(clean, r.value);
  }

  return { errors, clean, ok: Object.keys(errors).length === 0 };
}

// Flattens validator errors into one readable message for the API response.
function errorMessage(errors) {
  const flat = [];
  for (const v of Object.values(errors)) {
    if (typeof v === "string") flat.push(v);
    else if (v && typeof v === "object") flat.push(...Object.values(v));
  }
  return flat.join(" ");
}

// Picks only the keys an owner may write. Anything else in the request body —
// including `isVerified`, `user`, `email`, `formType`, the removed `whatsapp`
// field and the removed tracking fields — is dropped.
function pick(body, keys) {
  const out = {};
  for (const k of keys) if (body && body[k] !== undefined) out[k] = body[k];
  return out;
}

module.exports = {
  ORG_TYPES,
  NGO_ORG_SUBTYPES,
  ADDRESS_SOURCES,
  validateDirectoryInput,
  validateAddress,
  validatePhone,
  validateWebsite,
  validateCategory,
  composeAddress,
  errorMessage,
  pick,
};

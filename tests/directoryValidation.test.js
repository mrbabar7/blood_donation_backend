const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ORG_TYPES,
  NGO_ORG_SUBTYPES,
  validateDirectoryInput,
  validatePhone,
  validateWebsite,
  validateCategory,
  composeAddress,
  errorMessage,
  pick,
} = require("../utils/directoryValidation");
const { chooseStaticLocation } = require("../scripts/migrateDirectoryRefactor");

const goodAddress = { province: "Punjab", city: "Lahore", fullAddress: "12 Mall Road, Gulberg", source: "manual" };
const base = (over = {}) => ({
  phone: "0300 1234567",
  category: ["Emergency", " Trauma "],
  website: "",
  addressDetails: goodAddress,
  ...over,
});

test("only the four supported organization types exist, Partner is gone", () => {
  assert.deepEqual(Object.keys(ORG_TYPES).sort(), ["ambulance", "bloodbank", "hospital", "ngo"]);
  assert.ok(!JSON.stringify(ORG_TYPES).toLowerCase().includes("partner"));
  assert.ok(NGO_ORG_SUBTYPES.every((s) => !/partner|sponsor|institution/i.test(s)));
});

test("a complete manual address validates and is normalized", () => {
  const r = validateDirectoryInput(base());
  assert.equal(r.ok, true);
  assert.deepEqual(r.clean.addressDetails, goodAddress);
  assert.equal(r.clean.address, "12 Mall Road, Gulberg, Lahore, Punjab");
  assert.deepEqual(r.clean.category, ["Emergency", "Trauma"]);
  assert.equal(r.clean.location, undefined); // no coordinates sent -> none stored
});

test("each missing address part is reported separately", () => {
  for (const missing of ["province", "city", "fullAddress"]) {
    const r = validateDirectoryInput(base({ addressDetails: { ...goodAddress, [missing]: "  " } }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.address[missing], `expected an error for ${missing}`);
  }
});

test("address text is bounded and must be reasonably complete", () => {
  assert.equal(validateDirectoryInput(base({ addressDetails: { ...goodAddress, fullAddress: "ab" } })).ok, false);
  assert.equal(validateDirectoryInput(base({ addressDetails: { ...goodAddress, fullAddress: "x".repeat(301) } })).ok, false);
});

test("a missing addressDetails object is rejected on create", () => {
  assert.equal(validateDirectoryInput({ phone: "0300 1234567", category: ["a"] }).ok, false);
});

test("the legacy single `address` string alone can no longer be written", () => {
  const r = validateDirectoryInput({ phone: "0300 1234567", category: ["a"], address: "Somewhere in Lahore" });
  assert.equal(r.ok, false);
  const u = validateDirectoryInput({ address: "Somewhere in Lahore" }, { isUpdate: true });
  assert.equal(u.ok, false);
});

test("GPS source requires valid coordinates; pressing the button alone does not bypass validation", () => {
  const gps = { ...goodAddress, source: "gps" };
  assert.equal(validateDirectoryInput(base({ addressDetails: gps })).ok, false); // no coordinates
  assert.equal(validateDirectoryInput(base({ addressDetails: gps, location: { latitude: 0, longitude: 0 } })).ok, false); // null island
  assert.equal(validateDirectoryInput(base({ addressDetails: gps, location: { latitude: 95, longitude: 10 } })).ok, false); // out of range
  assert.equal(validateDirectoryInput(base({ addressDetails: gps, location: { latitude: "abc", longitude: 10 } })).ok, false);
  const ok = validateDirectoryInput(base({ addressDetails: gps, location: { latitude: 31.5204, longitude: 74.3587 } }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.clean.location, { latitude: 31.5204, longitude: 74.3587 });
  assert.equal(ok.clean.addressDetails.source, "gps");
});

test("GPS source still needs a complete address (partial geocoding must be completed)", () => {
  const partial = { province: "Punjab", city: "", fullAddress: "", source: "gps" };
  const r = validateDirectoryInput(base({ addressDetails: partial, location: { latitude: 31.5, longitude: 74.3 } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.address.city && r.errors.address.fullAddress);
});

test("manual source accepts optional valid coordinates, rejects invalid ones", () => {
  assert.equal(validateDirectoryInput(base({ location: { latitude: 24.86, longitude: 67.0 } })).ok, true);
  assert.equal(validateDirectoryInput(base({ location: { latitude: 200, longitude: 67.0 } })).ok, false);
});

test("location: null explicitly clears stored coordinates (manual source only)", () => {
  const r = validateDirectoryInput(base({ location: null }), { isUpdate: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.clean.location, { latitude: null, longitude: null });
  const gps = validateDirectoryInput(base({ addressDetails: { ...goodAddress, source: "gps" }, location: null }), { isUpdate: true });
  assert.equal(gps.ok, false);
});

test("an unknown address source falls back to manual", () => {
  const r = validateDirectoryInput(base({ addressDetails: { ...goodAddress, source: "hacked" } }));
  assert.equal(r.clean.addressDetails.source, "manual");
});

test("phone is the only required contact number", () => {
  assert.equal(validateDirectoryInput(base({ phone: "" })).ok, false);
  assert.equal(validateDirectoryInput(base({ phone: undefined })).ok, false);
  assert.equal(validateDirectoryInput(base({ phone: "abc" })).ok, false);
  assert.equal(validatePhone("+92 300 1234567").value, "+92 300 1234567");
  assert.equal(validatePhone("(042) 111-222-333").value, "(042) 111-222-333");
  assert.ok(validatePhone("12345").error);
});

test("a whatsapp value in the body is ignored, never required, never stored", () => {
  const withWa = validateDirectoryInput(base({ whatsapp: "0300 0000000" }));
  assert.equal(withWa.ok, true);
  assert.ok(!("whatsapp" in withWa.clean));
  assert.deepEqual(pick({ name: "A", whatsapp: "1", trackingStatus: "en_route", isVerified: true }, ["name"]), { name: "A" });
});

test("website is optional but validated when present", () => {
  assert.equal(validateWebsite("").value, "");
  assert.equal(validateWebsite(undefined).value, "");
  assert.equal(validateWebsite("example.org").value, "example.org");
  assert.equal(validateWebsite("https://www.example.org/a?b=1").value, "https://www.example.org/a?b=1");
  assert.ok(validateWebsite("not a url").error);
  assert.ok(validateWebsite("nodots").error);
});

test("categories: at least one, de-duplicated, bounded", () => {
  assert.ok(validateCategory([]).error);
  assert.ok(validateCategory(["  ", ""]).error);
  assert.deepEqual(validateCategory("Trauma").value, ["Trauma"]);
  assert.deepEqual(validateCategory(["a", "a", "b"]).value, ["a", "b"]);
  assert.ok(validateCategory(Array.from({ length: 21 }, (_, i) => `c${i}`)).error);
});

test("NGO sub-type: the retired partner-flavoured values are rejected for new writes", () => {
  const opts = { orgSubtypes: NGO_ORG_SUBTYPES };
  assert.equal(validateDirectoryInput(base({ orgType: "Trust" }), opts).ok, true);
  for (const retired of ["Corporate Partner", "Community Partner", "Sponsor", "Institution", "Partner"]) {
    assert.equal(validateDirectoryInput(base({ orgType: retired }), opts).ok, false, retired);
  }
});

test("partial updates validate only the groups that were sent (stock-only PUT passes)", () => {
  assert.equal(validateDirectoryInput({ stock: [{ bloodGroup: "A+", level: "high" }] }, { isUpdate: true }).ok, true);
  assert.equal(validateDirectoryInput({ phone: "" }, { isUpdate: true }).ok, false);
  assert.equal(validateDirectoryInput({ website: "bad url" }, { isUpdate: true }).ok, false);
  assert.equal(validateDirectoryInput({ category: [] }, { isUpdate: true }).ok, false);
});

test("composeAddress avoids repeating a city/province already typed in the street text", () => {
  assert.equal(composeAddress({ fullAddress: "Main Blvd, Lahore", city: "Lahore", province: "Punjab" }), "Main Blvd, Lahore, Punjab");
  assert.equal(composeAddress({ fullAddress: "House 4", city: "Quetta", province: "Balochistan" }), "House 4, Quetta, Balochistan");
});

test("errorMessage flattens nested field errors", () => {
  const r = validateDirectoryInput({ phone: "", category: [], addressDetails: { province: "", city: "", fullAddress: "" } });
  const msg = errorMessage(r.errors);
  assert.match(msg, /Phone number is required/);
  assert.match(msg, /Province is required/);
});

test("migration helper: keeps a valid static location, rescues currentLocation only when needed", () => {
  const valid = { latitude: 31.5, longitude: 74.3 };
  assert.equal(chooseStaticLocation({ location: valid, currentLocation: { latitude: 1, longitude: 2 } }), null);
  assert.deepEqual(
    chooseStaticLocation({ location: { latitude: null, longitude: null }, currentLocation: valid }),
    valid,
  );
  assert.deepEqual(chooseStaticLocation({ currentLocation: valid }), valid);
  assert.equal(chooseStaticLocation({ location: { latitude: null, longitude: null }, currentLocation: { latitude: 0, longitude: 0 } }), null);
  assert.equal(chooseStaticLocation({}), null);
});

// Run with:  node --test tests/ourHeroes.test.js
// Pure validation/sanitising checks (no database, no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const { _internals } = require("../controllers/ourHeroesController");
const { validateBody, clean, validContact, escapeRegex } = _internals;

const valid = {
  name: "  Dr. Amina Khan ",
  address: "Lahore, Pakistan",
  shortDescription: "Founder of a free clinic.",
  fullDescription: "Runs a free clinic for families.",
};

test("clean strips tags and control characters", () => {
  assert.equal(clean("<b>Hi</b>\u0000 there"), "Hi  there".replace("  ", " "));
  assert.equal(clean(null), "");
});

test("validateBody accepts a complete body and trims", () => {
  const { data, errors } = validateBody({ ...valid, contact: "+92 300 1234567", specialties: ["Cardiology", " cardiology ", "Care"], activities: ["Free camps"], isActive: "false" }, { partial: false });
  assert.deepEqual(errors, {});
  assert.equal(data.name, "Dr. Amina Khan");
  assert.deepEqual(data.specialties, ["Cardiology", "Care"]); // de-duplicated, case-insensitive
  assert.equal(data.isActive, false);
});

test("create requires the mandatory fields, update does not", () => {
  const created = validateBody({}, { partial: false });
  assert.ok(created.errors.name && created.errors.address && created.errors.shortDescription && created.errors.fullDescription);
  const updated = validateBody({ name: "New" }, { partial: true });
  assert.deepEqual(updated.errors, {});
  assert.deepEqual(updated.data, { name: "New" });
});

test("rejects bad contact, bad lists and bad isActive", () => {
  assert.ok(validateBody({ ...valid, contact: "abc" }, { partial: false }).errors.contact);
  assert.ok(validateBody({ ...valid, contact: "123" }, { partial: false }).errors.contact);
  assert.ok(validateBody({ ...valid, specialties: "x" }, { partial: false }).errors.specialties);
  assert.ok(validateBody({ ...valid, activities: [1] }, { partial: false }).errors.activities);
  assert.ok(validateBody({ ...valid, isActive: "maybe" }, { partial: false }).errors.isActive);
  assert.ok(validateBody({ ...valid, name: "x".repeat(121) }, { partial: false }).errors.name);
});

test("empty contact is allowed (optional)", () => {
  assert.deepEqual(validateBody({ ...valid, contact: "" }, { partial: false }).errors, {});
  assert.equal(validateBody({ ...valid, contact: null }, { partial: true }).data.contact, "");
});

test("validContact / escapeRegex", () => {
  assert.equal(validContact("0300-1234567"), true);
  assert.equal(validContact("+1 (555) 123-4567"), true);
  assert.equal(validContact("12"), false);
  assert.equal(escapeRegex("a.b*c"), "a\\.b\\*c");
});

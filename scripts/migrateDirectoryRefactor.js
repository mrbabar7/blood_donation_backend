// One-off, OPT-IN migration for the directory refactor (see docs/DIRECTORY_REFACTOR.md):
//
//   node scripts/migrateDirectoryRefactor.js                  # dry run: prints what would change
//   node scripts/migrateDirectoryRefactor.js --apply          # performs the migration
//   node scripts/migrateDirectoryRefactor.js --apply --keep-whatsapp
//
// What it does (every step is idempotent — safe to run repeatedly, and safe across restarts):
//   1. Address: legacy records only have the single `address` string. Copies it, unchanged, into
//      `addressDetails.fullAddress` (source "legacy"). Province and city are left EMPTY on purpose —
//      they are never guessed. The person is asked for them the next time they edit the listing.
//      `address` itself and `isVerified` are never touched.
//   2. Ambulances: if the legacy live-tracking field `currentLocation` holds the only valid
//      coordinates, they are copied into `location` (the static facility location that drives distance
//      and directions), then `trackingStatus` / `currentLocation` are removed.
//   3. Partner: NGO-collection records with formType "partner" are ARCHIVED (archived=true + reason),
//      not deleted and not reclassified. Their `isVerified` and every other field stay as they were.
//      Archived records are hidden from the public directory, My Listings and the admin pending queue.
//   4. WhatsApp: the removed `whatsapp` field is $unset on all four collections. The values are first
//      written to backups/directory-whatsapp-<timestamp>.json so the step is reversible.
//      Pass --keep-whatsapp to skip this step.
const fs = require("fs");
const path = require("path");
const { validCoord } = require("../utils/geo");

// Which coordinates should an ambulance keep as its static location?
// Returns the coordinates to write to `location`, or null when `location` is already fine / nothing usable.
function chooseStaticLocation(doc) {
  const loc = doc && doc.location;
  if (loc && validCoord(loc.latitude, loc.longitude)) return null; // already has a valid static location
  const cur = doc && doc.currentLocation;
  if (cur && validCoord(cur.latitude, cur.longitude)) return { latitude: cur.latitude, longitude: cur.longitude };
  return null;
}

async function main() {
  // Loaded here (not at the top) so the pure helper above can be unit-tested without them.
  require("dotenv").config();
  const mongoose = require("mongoose");
  const apply = process.argv.includes("--apply");
  const keepWhatsapp = process.argv.includes("--keep-whatsapp");
  const tag = apply ? "" : "[dry run] ";

  const Hospital = require("../models/hospitalModel");
  const BloodBank = require("../models/bankModel");
  const Ambulance = require("../models/ambulanceModel");
  const NGO = require("../models/ngoModel");
  const targets = { hospitals: Hospital, bloodbanks: BloodBank, ambulances: Ambulance, ngos: NGO };

  await mongoose.connect(process.env.MONGO_URI);

  // 1. Address backfill ------------------------------------------------------------------------
  for (const [label, Model] of Object.entries(targets)) {
    const filter = {
      address: { $type: "string", $ne: "" },
      $or: [{ addressDetails: { $exists: false } }, { "addressDetails.fullAddress": { $in: [null, ""] } }],
    };
    const n = await Model.collection.countDocuments(filter);
    console.log(`${tag}${label}: ${n} record(s) need addressDetails.fullAddress backfilled from the legacy address.`);
    if (apply && n > 0) {
      await Model.collection.updateMany(filter, [
        { $set: { addressDetails: { province: "", city: "", fullAddress: "$address", source: "legacy" } } },
      ]);
    }
  }

  // 2. Ambulance tracking cleanup ----------------------------------------------------------------
  const ambCol = Ambulance.collection;
  const legacyAmb = await ambCol
    .find({ $or: [{ currentLocation: { $exists: true } }, { trackingStatus: { $exists: true } }] })
    .project({ location: 1, currentLocation: 1 })
    .toArray();
  const toCopy = legacyAmb.map((d) => ({ _id: d._id, coords: chooseStaticLocation(d) })).filter((x) => x.coords);
  console.log(`${tag}ambulances: ${legacyAmb.length} carry tracking fields; ${toCopy.length} need currentLocation copied into location first.`);
  if (apply) {
    if (toCopy.length > 0) {
      await ambCol.bulkWrite(toCopy.map((x) => ({ updateOne: { filter: { _id: x._id }, update: { $set: { location: x.coords } } } })));
    }
    if (legacyAmb.length > 0) {
      await ambCol.updateMany({}, { $unset: { trackingStatus: "", currentLocation: "" } });
    }
  }

  // 3. Partner archive -----------------------------------------------------------------------------
  const partnerFilter = { formType: "partner", archived: { $ne: true } };
  const partners = await NGO.collection.countDocuments(partnerFilter);
  const partnersVerified = await NGO.collection.countDocuments({ ...partnerFilter, isVerified: true });
  console.log(`${tag}ngos: ${partners} Partner record(s) to archive (${partnersVerified} of them verified). They are kept, not deleted or reclassified.`);
  if (apply && partners > 0) {
    await NGO.collection.updateMany(partnerFilter, {
      $set: { archived: true, archivedReason: "partner_type_removed", archivedAt: new Date() },
    });
  }

  // 4. WhatsApp removal (with backup) -------------------------------------------------------------------
  if (keepWhatsapp) {
    console.log("WhatsApp step skipped (--keep-whatsapp).");
  } else {
    const backup = {};
    let total = 0;
    for (const [label, Model] of Object.entries(targets)) {
      const rows = await Model.collection.find({ whatsapp: { $exists: true } }).project({ whatsapp: 1 }).toArray();
      backup[label] = rows.map((r) => ({ _id: String(r._id), whatsapp: r.whatsapp }));
      total += rows.length;
    }
    console.log(`${tag}whatsapp: ${total} record(s) still carry the removed field.`);
    if (apply && total > 0) {
      const dir = path.join(__dirname, "..", "backups");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `directory-whatsapp-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(file, JSON.stringify(backup, null, 2));
      console.log(`Backup written to ${file}`);
      for (const Model of Object.values(targets)) {
        await Model.collection.updateMany({ whatsapp: { $exists: true } }, { $unset: { whatsapp: "" } });
      }
    }
  }

  if (!apply) console.log("\nNothing was changed. Re-run with --apply to perform the migration.");
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { chooseStaticLocation };

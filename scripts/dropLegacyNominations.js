// One-off, OPT-IN cleanup: drops the orphaned `nominations` collection left behind
// by the removed "Nominate a Donor" feature. Nothing else reads or writes it.
//
//   node scripts/dropLegacyNominations.js          # dry run (prints what it would do)
//   node scripts/dropLegacyNominations.js --apply  # actually drops the collection
//
// Safe to run repeatedly; does nothing if the collection no longer exists.
require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const exists = (await db.listCollections({ name: "nominations" }).toArray()).length > 0;
  if (!exists) {
    console.log("No `nominations` collection found — nothing to do.");
  } else {
    const count = await db.collection("nominations").countDocuments();
    if (!apply) console.log(`[dry run] would drop \`nominations\` (${count} documents). Re-run with --apply.`);
    else {
      await db.collection("nominations").drop();
      console.log(`Dropped \`nominations\` (${count} documents).`);
    }
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

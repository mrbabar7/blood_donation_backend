// One-off/rerunnable seed script for the Region collection — the actual,
// live source of truth for the mobile app's province/city pickers (see
// controllers/admin/regionsController.js: GET /regions is what
// guided-search.tsx, FilterSheet.tsx, post-request.tsx, edit-profile.tsx and
// profile.tsx all call before falling back to the bundled
// src/data/pakistanLocations.ts list on the frontend).
//
// Previously only 8-10 major cities existed per province here (or the
// collection was empty and every screen was silently running on the
// frontend's short fallback list). This loads the same comprehensive
// district + tehsil/taluka dataset that now ships in
// frontend/src/data/pakistanLocations.ts, so "only a handful of cities show
// up" is fixed for the live app too, not just the offline fallback.
//
// Safe to run more than once:
//   - Never deletes or overwrites an existing region document.
//   - Adds any new city names to an existing province's `cities` array via
//     $addToSet (so an admin's own manually-added cities are kept, and
//     re-running this script never duplicates entries).
//   - Only ever creates a province document if it doesn't exist yet.
//
// Run from the backend/ directory:
//   node scripts/seedRegions.js
//
// Requires the same MONGO_URI used by the rest of the app (.env).

require("dotenv").config();
const mongoose = require("mongoose");
const Region = require("../models/regionModel");

// Kept in sync with frontend/src/data/pakistanLocations.ts — same province
// keys, same city lists. If that file is updated with more cities, mirror
// the change here (and re-run this script) so the live/admin-editable list
// doesn't drift back out of sync with the bundled fallback.
const REGIONS = {
  Punjab: [
    "Rawalpindi", "Gujar Khan", "Kahuta", "Kallar Sayedan", "Kotli Sattian", "Murree", "Taxila",
    "Attock", "Fateh Jang", "Hassan Abdal", "Hazro", "Jand", "Pindi Gheb",
    "Jhelum", "Dina", "Pind Dadan Khan", "Sohawa",
    "Chakwal", "Choa Saidan Shah", "Kallar Kahar", "Lawa", "Talagang",
    "Sargodha", "Bhalwal", "Bhera", "Kot Momin", "Shahpur", "Sillanwali",
    "Bhakkar", "Darya Khan", "Kalur Kot", "Mankera",
    "Khushab", "Naushera", "Nurpur", "Quaidabad",
    "Mianwali", "Isa Khel", "Piplan",
    "Faisalabad", "Chak Jhumra", "Faisalabad Saddar", "Jaranwala", "Sammundri", "Tandlianwala",
    "Jhang", "18-Hazari", "Ahmedpur Sial", "Shorkot",
    "Chiniot", "Bhawana", "Lalian",
    "Toba Tek Singh", "Gojra", "Kamalia", "Pir Mahal",
    "Gujranwala", "Kamoke", "Nowshera Virkan", "Wazirabad",
    "Hafizabad", "Pindi Bhattian",
    "Mandi Bahauddin", "Malikwal", "Phalia",
    "Gujrat", "Kharian", "Sarai Alamgir",
    "Sialkot", "Daska", "Pasrur", "Sambrial",
    "Narowal", "Shakargarh", "Zafarwal",
    "Lahore", "Raiwind", "Shalimar", "Model Town",
    "Kasur", "Chunian", "Kot Radha Kishan", "Pattoki",
    "Sheikhupura", "Ferozewala", "Muridke", "Safdarabad", "Sharaqpur",
    "Nankana Sahib", "Sangla Hill", "Shahkot",
    "Sahiwal", "Chichawatni",
    "Okara", "Depalpur", "Renala Khurd",
    "Pakpattan", "Arifwala",
    "Multan", "Jalalpur Pirwala", "Shujabad",
    "Vehari", "Burewala", "Mailsi",
    "Lodhran", "Dunyapur", "Kahror Pacca",
    "Khanewal", "Jahanian", "Kabirwala", "Mian Channu",
    "Dera Ghazi Khan", "Taunsa", "Kot Chutta",
    "Rajanpur", "Jampur", "Rojhan",
    "Layyah", "Chaubara", "Karor Lal Esan",
    "Muzaffargarh", "Alipur", "Jatoi", "Kot Addu",
    "Bahawalpur", "Ahmadpur East", "Hasilpur", "Khairpur Tamewali", "Yazman",
    "Bahawalnagar", "Chishtian", "Fort Abbas", "Haroonabad", "Minchinabad",
    "Rahim Yar Khan", "Khanpur", "Liaquatpur", "Sadiqabad",
  ],
  Sindh: [
    "Larkana", "Bakrani", "Dokri", "Ratodero",
    "Kashmore", "Kandhkot", "Tangwani",
    "Shikarpur", "Garhi Yasin", "Lakhi",
    "Jacobabad", "Garhi Khairo", "Thul",
    "Kambar", "Shahdadkot", "Kubo Saeed Khan", "Miro Khan", "Nasirabad", "Warah",
    "Sukkur", "New Sukkur", "Pano Aqil", "Rohri", "Salehpat",
    "Ghotki", "Daharki", "Khangarh", "Mirpur Mathelo", "Ubauro",
    "Khairpur", "Faiz Ganj", "Gambat", "Kingri", "Kot Diji",
    "Naushahro Feroze", "Kandiaro", "Moro", "Bhiria",
    "Hyderabad", "Latifabad", "Qasimabad", "Kotri", "Jamshoro", "Sehwan",
    "Thatta", "Mirpur Sakro", "Keti Bunder", "Ghorabari",
    "Sujawal", "Jati", "Mirpur Bathoro", "Shah Bandar",
    "Badin", "Matli", "Talhar", "Tando Bago", "Golarchi",
    "Tando Muhammad Khan", "Tando Allahyar", "Matiari", "Hala",
    "Dadu", "Johi", "Khairpur Nathan Shah", "Mehar",
    "Shaheed Benazirabad", "Nawabshah", "Sakrand", "Daur",
    "Mirpurkhas", "Digri", "Jhuddo",
    "Umerkot", "Kunri", "Samaro",
    "Mithi", "Islamkot", "Chachro", "Diplo", "Nagarparkar",
    "Sanghar", "Shahdadpur", "Sinjhoro", "Tando Adam",
    "Karachi", "Karachi East", "Karachi West", "Karachi Central", "Karachi South",
    "Malir", "Korangi", "Keamari", "Clifton", "Saddar",
    "Gulshan-e-Iqbal", "Nazimabad", "North Nazimabad", "Landhi",
    "Orangi Town", "Baldia Town", "SITE Town", "New Karachi",
    "Gulistan-e-Johar", "Shah Faisal Town", "Lyari",
  ],
  "Khyber Pakhtunkhwa": [
    "Peshawar", "Charsadda", "Nowshera",
    "Landi Kotal", "Jamrud", "Ghalanai",
    "Mardan", "Swabi",
    "Swat", "Mingora", "Saidu Sharif",
    "Buner", "Daggar",
    "Chitral", "Booni",
    "Lower Dir", "Timergara", "Upper Dir", "Dir",
    "Malakand", "Batkhela",
    "Shangla", "Alpuri",
    "Bajaur", "Khar",
    "Abbottabad", "Haripur", "Mansehra", "Battagram",
    "Torghar", "Kolai-Palas", "Upper Kohistan", "Lower Kohistan", "Dassu", "Pattan",
    "Kohat", "Hangu", "Karak",
    "Kurram", "Parachinar", "Orakzai", "Kalaya",
    "Bannu", "Lakki Marwat", "North Waziristan", "Miranshah",
    "Dera Ismail Khan", "Tank", "South Waziristan", "Wana",
    "Khyber", "Mohmand",
  ],
  Balochistan: [
    "Quetta", "Pishin", "Killa Abdullah", "Chaman",
    "Qila Saifullah", "Zhob", "Sherani", "Loralai", "Musakhel", "Barkhan",
    "Kohlu", "Dera Bugti", "Sibi", "Ziarat", "Harnai",
    "Nasirabad", "Jaffarabad", "Usta Muhammad", "Jhal Magsi", "Sohbatpur",
    "Bolan", "Dhadar", "Kachhi",
    "Khuzdar", "Mastung", "Kalat", "Surab",
    "Kharan", "Washuk", "Chagai", "Dalbandin", "Nushki",
    "Awaran", "Lasbela", "Uthal", "Hub",
    "Gwadar", "Turbat", "Kech", "Panjgur",
  ],
  "Islamabad Capital Territory": ["Islamabad"],
  "Azad Kashmir": [
    "Muzaffarabad", "Neelum", "Athmuqam", "Hattian Bala",
    "Bagh", "Haveli", "Forward Kahuta",
    "Poonch", "Rawalakot", "Sudhnoti", "Pallandri",
    "Kotli", "Mirpur", "Bhimber",
  ],
  "Gilgit-Baltistan": [
    "Gilgit", "Hunza", "Karimabad", "Aliabad", "Nagar",
    "Ghizer", "Gahkuch",
    "Skardu", "Shigar", "Kharmang", "Roundu", "Ghanche", "Khaplu",
    "Astore", "Diamer", "Chilas", "Darel", "Tangir",
  ],
};

async function seedRegions() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected — seeding regions...");

  for (const [province, cities] of Object.entries(REGIONS)) {
    const existing = await Region.findOne({ province });
    if (!existing) {
      await Region.create({ province, cities, status: "active" });
      console.log(`Created ${province} with ${cities.length} cities.`);
      continue;
    }
    const before = existing.cities.length;
    await Region.updateOne({ _id: existing._id }, { $addToSet: { cities: { $each: cities } } });
    const after = (await Region.findById(existing._id)).cities.length;
    console.log(`${province}: ${before} -> ${after} cities (${after - before} added).`);
  }

  console.log("Done.");
  await mongoose.disconnect();
}

seedRegions().catch((err) => {
  console.error("Region seed failed:", err);
  process.exit(1);
});

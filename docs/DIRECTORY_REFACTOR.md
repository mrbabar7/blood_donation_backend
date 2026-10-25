# Directory refactor: four organization types, structured address, no live tracking

## What changed
- **Types:** only Hospital, Ambulance, Blood Bank and NGO can be created. `formType` is set by the server and can no longer be chosen by the client.
- **Address:** requests carry `addressDetails { province, city, fullAddress, source: "manual" | "gps" }`. Coordinates stay in `location`.
  The legacy `address` string is still stored (composed as "Street, City, Province") so older clients, search and directions keep working.
  Province, city and full address are all required; `source: "gps"` additionally requires valid coordinates. Sending `location: null` on update clears stored coordinates.
- **Phone** is the only required contact number. Website is optional. WhatsApp is removed from schema, validation, payloads and UI.
- **Updates use a field whitelist** (`utils/directoryValidation.js` `pick`). Owner requests can no longer write `isVerified`, `formType`, `user`, `email`, or the removed fields. The admin verification flow is unchanged.
- **Ambulance live tracking removed:** endpoints `POST /ambulances/:id/location` and `GET /ambulances/:id/track`, socket events `join_ambulance_room` / `leave_ambulance_room`, the `trackingStatus` / `currentLocation` fields, and the frontend Live Tracking / Manage Tracking screens.
  Kept on purpose: `emitToRoom` and chat live-location (chat feature), `expo-location` / `react-native-maps` (static maps, directions, address autofill).
  Background location was already disabled in `app.json`.

## Migration (run once per environment, after deploying the backend)
```
node scripts/migrateDirectoryRefactor.js            # dry run
node scripts/migrateDirectoryRefactor.js --apply    # perform (add --keep-whatsapp to retain old WhatsApp data)
```
Idempotent and safe to re-run. It:
1. copies each legacy `address` into `addressDetails.fullAddress` (source `legacy`); province and city stay empty and are requested the next time the owner edits the listing;
2. copies an ambulance's `currentLocation` into `location` when that is its only valid coordinate, then removes the tracking fields;
3. **archives** NGO-collection records with `formType: "partner"` (`archived: true`) instead of deleting or reclassifying them; `isVerified` is untouched;
4. backs up `whatsapp` values to `backups/directory-whatsapp-<timestamp>.json`, then removes the field.

Until it has run, legacy records still read correctly (`utils/geo.js` falls back to `currentLocation` for distance).

## Partner records policy (product decision to confirm)
Archived Partner records are hidden from the public directory, My Listings and the admin pending queue. To reverse, set `archived: false`. To reclassify, decide a mapping and do it explicitly.
The NGO schema enum still lists the old partner-flavoured sub-types so archived documents stay valid; new writes are limited to Registered NGO, Trust, Foundation, Volunteer Group.

## Tests
`npm run test:directory` runs `tests/directoryValidation.test.js`.

# Backend — Phase 1 status

No backend code changes were needed for Phase 1 of the app (splash, onboarding,
login/OTP, role select, guest home, donor & seeker dashboards, notifications, profile
& donor registration) — your existing routes already covered all of it:

/auth/signup, /auth/verify-otp, /auth/resend-otp, /auth/login, /auth/logout
/donors/status, /donors/register, /donors/my-requests, /donors/accept/:id, /donors/reject/:id
/donors/notifications/get-all, /donors/notifications/:id/read
/seeker/search, /seeker/hero/search, /seeker/my-requests, /seeker/send-request/:donorId

Your real `.env` was removed from this zip for safety (secrets should never be shared
in a chat/export) and replaced with `.env.example` listing the required keys with
blank values — copy it to `.env` and refill your real values before running.

## Phase 2 — added

- `models/broadcastModel.js` — new `Broadcast` model (one per "Post a Request").
- `models/formModel.js` — `DonationRequest` gained an optional `broadcastId` field linking
  fan-out requests back to their broadcast. Fully backward compatible (defaults to `null`,
  existing documents and the Phase 1 direct-request flow are untouched).
- `controllers/seekerController/postRequest.js` — `POST /seeker/post-request`: saves the
  seeker's address, creates a `Broadcast`, finds matching available donors by blood type +
  district/province, fans out a `DonationRequest` + push notification to each.
- `controllers/seekerController/getBroadcastStatus.js` — `GET /seeker/broadcast/:id`:
  elapsed-safe live status (responded count, on-the-way donors) for the tracker screen.
- `controllers/seekerController/getMyBroadcasts.js` — `GET /seeker/my-broadcasts`: list for
  the seeker's "My Requests" tab, with matched/completed counts per broadcast.
- `routes/seekerRouter.js` — registered the three routes above.

No existing endpoint, model field, or controller was removed or changed — only added to.

## What Phase 3+ will need added here (not built yet)

- 4 directories with photos & live stock (blood banks, hospitals, ambulances, NGOs): new
  models/routes — nothing for these exists yet.
- In-app chat & calling: new message model + routes; `services/socketService.js` already
  gives you the real-time transport to build this on top of.
- Live ambulance tracking: new ambulance/location model + routes.
- Leaderboard, "Our Heroes", reviews: new read-only aggregation routes over existing Donor data.
- Digital donor QR card: can be generated client-side from existing donor data — no backend needed.
- Provider self-registration (hospitals/blood banks/ambulances/NGOs): new model + routes.

Tell me which of these to build next and I'll add real routes/controllers/models the
same way — verified against your actual code, not guessed.

## Phase 3 — no backend changes

Directories (blood banks/hospitals/ambulances/NGOs) and provider self-registration
already existed in full (`models/bankModel.js`, `hospitalModel.js`, `ambulanceModel.js`,
`ngoModel.js`, `controllers/emergency/*`, `routes/formRouter.js`) — the app now simply
consumes them. Nothing was added or changed here this round.

If you want PDF screen 29 (photo gallery + live per-blood-group stock on each listing),
that needs two additions to `models/bankModel.js` / `hospitalModel.js` /
`ambulanceModel.js` / `ngoModel.js`: a `photos: [String]` field and, for blood banks
specifically, a `stock: { O_pos: String, O_neg: String, ... }` field (or a separate
`Stock` collection keyed by bank ID) — say the word and I'll add it plus the endpoints.

## Phase 4 — added

- `models/messageModel.js` — new `Message` model, scoped to an accepted `DonationRequest`.
- `controllers/chatController.js` — `getMessages` / `sendMessage`, both check the
  requester is actually the seeker or donor on that request AND that it's `accepted`/
  `completed` before allowing access (mirrors the app's "numbers stay hidden until
  accepted" trust model).
- `routes/chatRouter.js` — `GET|POST /chat/:requestId/messages`, mounted at `/chat` in `server.js`.
- `services/socketService.js` — added five relay events for call signaling
  (`call:invite`, `call:offer`, `call:answer`, `call:ice-candidate`, `call:end`). These
  are pure relays (forward payload to the other user's room) — no media handling, since
  that needs a WebRTC layer on the client (see the app's README for what that requires).

Nothing existing was changed — only additive.

## Phase 5 — added

- `controllers/donorController/getLeaderboard.js` — `GET /donors/leaderboard?city=&limit=`,
  ranks donors by cumulative `livesSaved` (see the app README for why this is all-time,
  not monthly — the schema has no per-donation date log to group by). Also computes the
  logged-in user's own rank if they're a donor.
- `controllers/donorController/verifyDonorCard.js` — `GET /donors/verify/:donorId`, public
  lookup a partner facility would call after scanning a donor's QR digital card.
- `routes/donorRoutes.js` — registered both routes (leaderboard uses `optionalProtect` so
  guests can view it; verify is public since a scanning partner won't have a donor's login).

To get a true monthly leaderboard later: add a lightweight `Donation` log collection
(`donorId`, `date`) written whenever a request is marked `completed`, then group by month
instead of using the cumulative `livesSaved` field. Say the word and I'll add that.

## Phase 6 — added

- `models/reviewModel.js` + `controllers/reviewController.js` + `routes/reviewRouter.js`
  — new `Review` model, `GET/POST /reviews` (one review per user, upserts on resubmit).
- `controllers/statsController.js` + `routes/statsRouter.js` — new public `GET /stats`:
  real counts (`totalDonors`, `livesSupported`, `partnerFacilities`) so the app never
  has to fabricate marketing numbers.
- **No change needed** for Contact Us — `handleContactInquiry` + `POST /auth/contact`
  already existed and worked; this phase only built the app screen for it.

Nothing existing was changed — only additive.

## Phase 7 — added (final phase)

- `controllers/seekerController/seekerSearchDonor.js` — `bloodType` now accepts a
  comma-separated list (`$in` match) instead of only one value; added `availableOnly=true`
  query param. Fully backward compatible — old single-value calls behave identically.
- `models/ambulanceModel.js` — added `trackingStatus` (`idle|en_route|arrived`) and
  `currentLocation {latitude, longitude, updatedAt}`, both optional with safe defaults.
- `controllers/emergency/ambulance.js` — added `updateAmbulanceLocation` (owner-only,
  matches existing `user: req.user.id` ownership pattern already used by this file) and
  `getAmbulanceTracking` (public read).
- `routes/formRouter.js` — registered `POST /forms/ambulances/:id/location` and
  `GET /forms/ambulances/:id/track`.
- `services/socketService.js` — added `emitToRoom()` (generic room broadcast, alongside
  the existing per-user `emitToUser()`) and `join_ambulance_room` / `leave_ambulance_room`
  socket handlers, so many anonymous trackers can watch one ambulance's live position.

Nothing existing was changed in a breaking way — every addition here is either a new
optional field, a new route, or an additive query-param on an existing route.

## Summary across all 7 phases

Every route, model, and controller added across this build is listed phase-by-phase
above. Total new backend surface: 3 models (`Broadcast`, `Message`, `Review`), ~20 new
routes, 0 breaking changes to anything that existed when this started. The `.env` in
this zip is still the safe blank `.env.example` from Phase 1 — refill your real secrets
before running.

## Phase 8 — closing the flagged gaps

- `controllers/seekerController/seekerSearchDonor.js` — added a real haversine-distance
  branch (`userLat`/`userLng`/`maxDistanceKm` query params). Falls back to the original
  text-based city/province query exactly as before when those params are absent — fully
  backward compatible.
- `controllers/donorController/registerAsDonor.js` — **no change needed**, it already
  spreads `...req.body`, so the new `location {latitude, longitude}` field just works
  once the client sends it.
- `models/bankModel.js`, `hospitalModel.js`, `ngoModel.js`, `ambulanceModel.js` — added
  `isVerified: Boolean` (default false) to all four. `bankModel.js` also got a real
  `stock: [{bloodGroup, level}]` field.
- `routes/formRouter.js` — **no change needed** for stock updates; the existing
  `PUT /update-bloodbank/:id` already does `$set: req.body`, so `{ stock: [...] }` just
  works.
- `models/donationLogModel.js` — new model, one row per completed donation.
- `controllers/seekerController/completeDonation.js` — now writes a `DonationLog` entry
  alongside its existing logic. Nothing existing was removed or changed.
- `controllers/donorController/getLeaderboard.js` — rewritten to aggregate a real
  current-month ranking from `DonationLog`, with a same-request fallback to the
  all-time `livesSaved` ranking when there's nothing logged this month yet.

## isVerified still has no admin path

Every org model now has a real `isVerified` field, but nothing in this codebase can set
it to `true` except a direct database edit — there's no admin authentication or panel
built. Two honest options if you want a real path to this without a full admin build:
1. A hardcoded allowlist of admin emails checked inside `updateBank`/`updateHospital`/
   `updateAmbulance`/`updateNGO` before allowing `isVerified` to be set — minimal, but
   real and immediately usable.
2. A proper `role: "admin"` field on `User` plus an `isAdmin` middleware — more correct
   long-term, more work now.
Say which and I'll build it.

## Admin Dashboard backend — full 29-screen build

Every screen in the admin PDF now has a real backing endpoint. Summary of what was
added across this pass (on top of the Phase 1 admin API from the previous round):

**New models**: `Admin`, `AuditLog`, `Region`, `SupportMessage`/`SupportConversation`,
`StaticPage`, `PlatformSettings` (singleton), `PageMeta`, `Redirect`, `NotFoundLog`,
`AdminSession`, `IpAllowlistEntry`, `DataRequest`, `Incident`, `BackupLog`, `FeatureFlag`.

**New middleware**: `adminAuthMiddleware.js` (separate admin JWT auth + a real
server-side permission matrix in `config/adminPermissions.js`), `redirectMiddleware.js`
(real redirect serving + real 404 logging, mounted first/last in `server.js`),
`rateLimitMiddleware.js` (dependency-free in-memory limiter).

**New public endpoints** (no admin auth): `GET /regions` (mobile guided-search reads
this live), `GET /pages/:slug` (CMS), `GET /sitemap.xml`, `GET /robots.txt`,
`GET /feature-flags`.

**Consequential real actions** — these aren't just status labels: approving/rejecting
verification really flips `isVerified`; fulfilling a "deletion" data request really
deletes the User+Donor records; merging duplicate donors really reassigns their
requests and deletes the duplicate; triggering a backup really shells out to
`mongodump`; the IP allowlist really blocks admin logins once enabled.

**What still needs external infrastructure to be "real" in the fullest sense** (flagged
in each controller's code comments and in the admin dashboard's README, not hidden):
Google Search Console for SEO metrics, a monitoring/paging service for Platform
Health, a TOTP library + challenge flow for real 2FA enforcement, a geo-IP service for
Security Center's "impossible travel" style checks, and CNIC collection at donor
registration for true duplicate-ID fraud detection (currently proxied via phone number).

Nothing existing was changed in a breaking way — every addition is a new model, a new
route, or an additive field.

## Email templates — audit + full re-brand + real bug fixes

Checked all 5 email flows (OTP/verification, donor request, seeker response,
contact form, plus the underlying send service). All existed, but every single
one was red/rose-themed with "BloodDonation"/"PakBlood" branding — directly
contradicting the app-wide rule established from the first PDF ("teal replaces
red as the dominant brand color; coral is an urgency accent only, never
dominant"). Fixed properly, not just cosmetically:

- **New `email-sender/brand.js`** — single shared source for colors, the
  header/footer markup, and the outer document shell. Every template now
  composes from this instead of duplicating its own CSS, so a future brand
  tweak is a one-file change instead of five.
- **Real bug**: the OTP email said "expires in 1 minute" — the actual expiry
  (checked in `signUp.js`/`otpVarify.js`/`logIn.js`) is 5 minutes. Fixed to say
  the true number. This one template is reused by all 5 real OTP-adjacent
  flows (signup, login, forgot-password, email-change, resend-email-change-OTP)
  — verified every `.replace("{name}"...)` / `.replace("{verificationCode}"...)`
  call site still matches exactly, so nothing broke.
- **Real bug**: two places hardcoded `localhost:5173`/`localhost:3000` redirect
  links that would be dead in production. Replaced with `PUBLIC_APP_URL` (new
  env var, added to `.env.example`), with an obviously-fake-if-unconfigured
  fallback domain rather than a silent broken link.
- Every subject line still saying "BloodDonation" was found via a repo-wide
  grep and fixed to "Rah-e-Hayat" (6 lines across `signUp.js`, `logIn.js`,
  `otpVarify.js`, `forgotPassword.js`, `userController.js`).
- `email-sender/donorRequestEmailTemplate.js` was fixed and re-branded too,
  but flagged in its own file comment as **currently unused** — nothing calls
  it. It looks like it was meant to back a "request-specific donor email with
  Accept/Decline links" flow that was never wired to a controller. Say the
  word if you want that flow actually built.

## Rename to "Blood Donation"

Renamed the product from "Rah-e-Hayat" throughout — every email template,
every auth-flow subject line, the sender name, and the `.env.example`
public-URL fallback comments — via a single new `APP_NAME` constant exported
from `email-sender/brand.js`, so it's a one-line change going forward instead
of hunting through files again. Verified with a repo-wide grep that zero
references to the old name remain in any `.js`/`.json` file.

## Google Sign-In wired + real Phone OTP sign-in added

- **Google OAuth**: no backend change needed for the OAuth logic itself — it
  already worked (`routes/googleSignup.js`, `config/passport.js`). Fixed:
  the mount path (`server.js`: was `app.use("/fuck", googleSignup)`, now
  `app.use("/auth", googleSignup)`, matching the callback URL passport.js
  already expected), and a leftover `pakblood.vercel.app` hardcoded fallback
  domain (now `PUBLIC_WEB_URL`).
- **Phone OTP — new, real**: `utils/smsService.js` (Twilio Verify wrapper —
  no OTP storage of our own needed, Twilio manages it), `controllers/
  authController/phoneAuthController.js` (`requestPhoneOtp`/`verifyPhoneOtp`),
  two new routes on the existing `/auth` router. **Requires your own Twilio
  account** — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_VERIFY_SERVICE_SID` in `.env` (added to `.env.example`). Without
  those, both endpoints return a clear `501 "not configured"` error rather
  than silently failing or faking success.
- **`models/userMode.js`**: `email` changed from `required: true` to
  optional+sparse-unique, and a new `phone` field (optional+sparse-unique)
  added, so a phone-only account can exist without an email. Verified this is
  safe: the existing email/password signup and login routes still require
  email via their own Joi validation middleware (`authValidation.js`),
  completely separate from the new phone routes — nothing about existing
  signup/login behavior changed. Also audited every place that emails a user
  and guarded the one spot (`donorEmailResponce.js`) that would have crashed
  on a phone-only account with no email.

## Calls tab — real-time call history

Fixes the Calls tab not updating live and hardens redial. Changed files:
`services/socketService.js` and `controllers/callController.js` — nothing else.

- **`services/socketService.js`**: new `publishCallUpdate()`. After every Call
  document is created or updated (`call:invite`, `call:accept`, `call:reject`,
  `call:busy`, `call:end`, and the 50s missed safety-net), it emits a new
  `call:history:update` event to BOTH participants' rooms, each row shaped from
  that user's own point of view. It runs after the database write (the old
  `call:*` relays fire before it, which is what made a client re-fetch read
  stale data), it also reaches the side that caused the change (who never got
  their own `call:*` event), and it is fire-and-forget so it can never delay
  the ring or the push notification. Existing events are unchanged.
- **`controllers/callController.js`**: row shaping moved into a shared
  `serializeCallForUser()` so `GET /calls/history` and the live event always
  return the same shape. Response gained an `updatedAt` field (additive).

**Deployment — the backend needs a redeploy for the live updates.** The new
event only exists once this backend is running; no new environment variables,
routes, or database migrations are required. Until it is redeployed, the app
still works: the Calls tab falls back to a debounced re-fetch on the old
`call:*` events (slower, and subject to the stale-read race described above),
so deploying the backend first or together with the app update gives the
intended instant behavior.

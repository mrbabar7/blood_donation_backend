# Donation request lifecycle

Manual donor notification is the **only** request flow (the seeker finds donors through the
Home flow - 12 km location search / guided search - and notifies them one by one). The former
Emergency Broadcast (`/seeker/post-request`, `Broadcast` model, `/flow/*` wave engine and its
duplicate `FlowMessage` chat) has been removed; there is a single chat (`/chat/:requestId`).

All logic lives in `services/donationLifecycle/` and is exposed by
`controllers/lifecycleController.js`. The state is **one field**, `DonationRequest.status`;
the app only renders it.

## States

| status | meaning |
|---|---|
| `pending` | Notified. Expires exactly 12 h after the server-stamped `requestedAt` |
| `accepted` | Donor accepted. Seeker: Message / Lock / Release |
| `locked` | Locked by Seeker (donor may press Donation Started) |
| `on_hold` | Locked, but the donor is busy with another seeker's donation |
| `donation_started` | Donor started; waiting for the seeker's *Yes, Agree* (the brief's `waiting_for_seeker_agreement`) |
| `seeker_not_yet` | Seeker pressed *Not Yet*. The donor stays engaged (mutex kept), can message / send a reminder, can never press *Donation Started* again; the seeker can still *Yes, Agree* |
| `donation_agreed` | Seeker agreed (persisted `seekerAgreedAt`); *I have donated blood* / *Mark Complete* enabled |
| `completed` | Seeker confirmed. 90-day recovery applied |
| `rejected` / `expired` | Donor declined / 12 h passed |
| `released` | Normal release by the seeker (`releaseReason=seeker_released`) |
| `auto_released` | Donor donated for another seeker (permanent) |
| `donor_unable` | Donor chose *I can't donate at this time* (not an allegation) |
| `reported` | Seeker allegation (delay); never bulk re-notified |

Legal transitions: `constants.js -> TRANSITIONS`. Every change is a conditional
`findOneAndUpdate` (compare-and-set), so concurrent calls cannot both win.

## Endpoints

Seeker: `POST /seeker/requests/:id/{lock,release,agree,disagree,report}`,
`GET|POST /seeker/renotify-released`, existing `POST /seeker/complete`, `GET /seeker/my-requests`
(also returns `renotifyReleased{count,visible}` and `sendBlocked`).
Donor: `PUT /donors/start-donation/:id`, `PUT /donors/cannot-donate/:id` (`{message}`),
`POST /donors/requests/:id/nudge-seeker` (reminder, 10 min server cooldown, 429 `NUDGE_COOLDOWN`
with `retryAfterSec` / `nextNudgeAt`), `POST /donors/requests/:id/dismiss` (hide an *expired* card
from that donor's list only), existing accept / reject / `mark-donated`.
`GET /donors/my-requests` also returns `serverTime` and omits requests the donor dismissed.

## Not Yet, reminders and dismissal

Allowed path: `pending -> accepted -> locked -> donation_started -> (seeker_not_yet)* -> donation_agreed -> completed`;
`expired` is reachable only from `pending`. `seekerNotYetCount` / `seekerNotYetAt` record each *Not Yet*
(the 2nd one switches on the donor's escalation guidance). `lastNudgeAt` / `nudgeCount` back the reminder:
the cooldown is a compare-and-set (`lastNudgeAt` null or <= now-10 min -> now), so concurrent taps or two
devices cannot send two reminders. `donationStartedAt` is no longer wiped by *Not Yet* (it is the brief's
`lastDonationStartedAt`); no `donationStartAttempts` counter is needed because a second start is impossible.
`donorDismissedAt` is per request == per donor (a request belongs to one donor); nothing is deleted.

## Guarantees

* **12 h expiry** - `expiresAt = requestedAt + 12 h` (server clock). `jobs.js` sweeps every
  15 s (`LIFECYCLE_WORKER_INTERVAL_SEC`); each row is claimed atomically, so it is idempotent,
  multi-instance safe and survives restarts. Accept/reject also check `expiresAt > now`, so a late
  accept cannot revive an expired request. Partial index `{expiresAt} where status=pending`.
  `expiresAt` is deliberately separate from the legacy TTL field `expireAt`, which deletes documents.
* **One active donation per donor** - mutex `Donor.activeDonationRequestId`, claimed with
  `{activeDonationRequestId:null} -> id`; a stale claim (crash between writes) is healed.
  Starting for A moves the donor's other `locked` requests to `on_hold`; cancel / not-agree /
  can't-donate / report restore them to `locked`; completion auto-releases them permanently.
  Unlocked `accepted` requests are never touched.
* **Reminders** - after *I have donated blood*, `nextReminderAt` is claimed (moved +6 h) *before*
  sending, so workers never duplicate; leaving `donation_agreed` stops them instantly.
* **Bulk re-notify** - eligible = `released` + `seeker_released`, released <= 12 h ago, not
  allegation-related, no open request to that donor, **and** a `donor_unable`/`reported` failure
  <= 12 h ago that happened after the release. Per-row compare-and-set makes repeats no-ops.

## Configuration - FLAGGED FOR PRODUCT CONFIRMATION

No existing policy covered these, so they are environment-configurable (defaults in brackets):

| env | default | meaning |
|---|---|---|
| `DONOR_REPORT_BLOCK_HOURS` | 24 | a reported donor cannot accept new requests for this long |
| `SEEKER_COMPLETE_BLOCK_AFTER_HOURS` | 24 | after the donor marks "donated", an unconfirmed seeker is blocked from new requests (lifted the moment they complete) |
| `REPORT_MIN_WAIT_MINUTES` | 30 | minimum time after locking before a delay can be reported (0 disables) |
| `LIFECYCLE_WORKER_INTERVAL_SEC` | 15 | worker cadence |

The 12 h expiry, 6 h reminder cadence and 12 h re-notify window are fixed product rules.

## Tests

`npm run test:lifecycle` (in-memory fake of the Mongo operators used; no database needed).

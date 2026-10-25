# Our Heroes (admin-managed)

Replaces the old rank / leaderboard / "Nominate a Donor" content. Records are curated
by admins; the mobile app only ever reads **active** heroes.

## Model — `models/ourHeroModel.js`
`imageUrl`, `name`, `address`, `contact` (optional phone), `shortDescription`,
`fullDescription`, `specialties: string[]`, `activities: string[]`, `isActive`,
`createdAt`, `updatedAt`.

## Endpoints (mounted at `/our-heroes` and `/api/our-heroes`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | public / admin | Public: **always active-only** (even without `?isActive=true`). Admin token with `manage_content`: `?isActive=true\|false` filters, no filter = all. `?search=` (name/address), `?page=1&limit=20` (max 50). Returns `{ success, heroes, pagination }`. |
| GET | `/:id` | public / admin | Inactive heroes answer **404** to the public. |
| POST | `/` | admin + `manage_content` | JSON. Required: `name`, `address`, `shortDescription`, `fullDescription`, plus `imageUrl` **or** base64 `image`. |
| PUT | `/:id` | admin + `manage_content` | Partial update; same validation. Replacing the photo deletes the old Cloudinary asset. |
| PATCH | `/:id/toggle` | admin + `manage_content` | Activate / deactivate. |
| DELETE | `/:id` | admin + `manage_content` | Also deletes the Cloudinary asset (best-effort). |
| POST | `/upload-image` | admin + `manage_content` | multipart field `image` (jpg/png/webp, 5 MB) → `{ url }` for the form preview; send that URL back as `imageUrl`. |

Admin calls use the existing admin token (`Authorization: Bearer <adminToken>` or the `adminToken` cookie).
Errors follow the existing `{ success:false, message }` shape; validation failures add `errors: { field: message }`.

## Limits / sanitising
name 120, address 250, contact 7-15 digits, shortDescription 300, fullDescription 5000,
specialties ≤20 × 60 chars, activities ≤30 × 200 chars. HTML tags/control characters are stripped.

## Legacy cleanup
Removed: `GET /donors/leaderboard`, `POST /donors/nominate`, the Nomination model, the
`leaderboard` notification preference. `DonationLog` and `/stats` are shared and untouched.
The orphaned `nominations` collection can be dropped with
`node scripts/dropLegacyNominations.js --apply` (dry run without `--apply`).

Tests: `npm run test:heroes`.

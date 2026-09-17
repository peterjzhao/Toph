# Farm accounts and onboarding

This release adds persisted accounts and farms without changing the supplied Bays Ranch
employees, April logs, map, stable record IDs, or four sample `is_new` flags. The sample is
opened deliberately through the sample-farm entry. Missing authentication never selects it.

The user chose **name-only access** for this project: no email, password, or verification.
A name is normalized with Unicode NFKC, trimmed, repeated whitespace collapsed, and lowercased
for a globally unique key. Display casing is retained. Someone who knows another person's
name can sign in as them; session enforcement does not make that name a secret credential.
This should not be described as production identity verification.

## Accounts and sessions

Each account has one farm and one role. Web signup atomically creates a farm, its sole admin,
a random 12-character join code, and an empty workspace. No sample employees, fields, messages,
assignments, logs, or metrics are copied. The active-worker count starts at one for the admin.
Mobile signup creates a worker only after validating that farm's code; a worker may join
before fields are configured, but must wait for a field before submitting/processing a log.

Admins use the web dashboard; workers use mobile. Mobile bootstrap returns only the signed-in
worker. Log submission, history, profile edits, and transcription context must match that
worker's employee ID. A worker can download only their own recording bytes; the farm admin
can download all recordings for their farm. Database service functions still accept a trusted
`FarmContext` for operator scripts/tests; every HTTP route resolves it from the actual session.
`TOPH_FARM_ID` no longer chooses a visitor's farm.

Sessions use 32 random bytes, with only their SHA-256 hash stored in PostgreSQL. Sessions expire
after 30 days and are revoked on logout or worker deactivation. Web sessions use a host-only,
HttpOnly, SameSite=Lax cookie (`Secure` on HTTPS/production). Native sessions use a bearer token
stored by the app. Cookies and bearer sessions have distinct client types. Browser writes
must match `APP_ORIGIN`; mobile writes require `X-Toph-Client: toph-mobile` and reject foreign
browser origins. That header is a client marker, not a credential.

There is no account impersonation switch. Changing a worker's profile name updates the unique
login name, normalized employee record and workspace roster in one transaction; collisions
return `409 NAME_TAKEN`. Admin roster edits cannot invent new profiles or change their login
names. Active/Inactive edits synchronize normalized membership and revoke inactive sessions;
the removal endpoint deactivates rather than deleting historical work. Reactivation permits a
fresh login, without restoring revoked sessions.

## HTTP contract

Shared serializable types are in `src/contracts/accounts.ts`. Success payloads use `data`;
errors use the existing `{error:{code,message,fields?}}` envelope. Missing/expired/revoked
sessions return 401; the wrong role returns 403. All responses use no-store caching.

| Endpoint | Body / result |
| --- | --- |
| `GET /api/auth/session` | `{data:{account:{id,name,role,employeeId},farm:{id,name,timezone,isSample,setupComplete},joinCode?}}`; only admins receive the join code |
| `POST /api/auth/signup` | `{name,farmName,timezone?,client?:"web"}` creates an empty farm and admin; returns session plus cookie |
| `POST /api/auth/join` | `{name,code,client:"mobile"}` creates a worker; returns session plus `data.token` |
| `POST /api/auth/login` | `{name,client?:"web"|"mobile"}`; cookie for web, `data.token` for native |
| `POST /api/auth/sample` | `{client?:"web"|"mobile"}` selects the sample admin on web or Isaac on mobile |
| `POST /api/auth/logout` | Revokes the presented session and expires the web cookie |
| `GET /api/farm/members` | Admin list of `{id,name,employeeId,role,active}` |
| `DELETE /api/farm/members/:accountId` | Deactivate a worker in the admin's farm; preserve their work |
| `POST /api/farm/invite` | Replace the farm join code; current members stay joined |
| `GET /api/farm/setup` | `{data:{image:{url,width,height}|null,fields:[{id,label,boundary}],setupComplete}}` |
| `POST /api/farm/setup` | `{image?:{dataUrl,width,height},fields:[{id?,label,boundary}]}` confirms setup atomically |
| `GET /api/farm/image` | Current farm's authenticated raster bytes, available to its admin/workers |
| `POST /api/logs/:logId/review` | Admin marks a real farm log reviewed; returns `{data:{logId,isNew}}` |

Existing dashboard, log, tag and workspace routes require an admin session.
Existing `/api/mobile/v1` routes require a worker session except recording download, which
also allows the same farm's admin cookie. `GET /api/health` remains a connection health check.

## Farm images and confirmed fields

The backend performs **no segmentation inference**. The farmer's client supplies reviewed
boundaries. Browser-model feasibility is tracked separately in `field-segmentation.md`.
Manual boundaries can complete onboarding while that experiment is evaluated.

Farm images are private PostgreSQL bytea rows, maximum 2 MiB decoded. Only JPEG, PNG and WebP
are accepted. MIME signatures, header dimensions, supplied dimensions, base64 encoding and
dimensions 1–8192 are checked; SVG is not accepted. The browser resizes its upload before
submitting. The server streams stored raster bytes with their validated content type,
`X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`.

Confirmation requires 1–26 fields with unique uppercase A–Z labels. Each boundary has 3–200
unique normalized `{x,y}` points in `[0,1]`, area above 0.0001 of the image, and no self-crossing
segments. Field IDs remain stable when fields are renamed or edited. A foreign ID is rejected.
Fields with recorded work cannot be removed; an image with recorded work cannot be replaced,
preserving the original coordinate basis. Initial upload and boundary confirmation are one
transaction; an invalid polygon never leaves a half-written image or field set.

`DashboardFieldDto` adds optional `boundary` and `mapImageUrl` metadata to filter fields and
log fields. New farm fields point to `/api/farm/image` even before the first log. Sample fields
keep their original asset paths and DTO values.

## Shared review status and live updates

For real farms, `is_new` means the admin has not opened the log for review. The first review
stores `reviewed_by` and `reviewed_at`; subsequent reviews preserve that attribution. The
review operation is farm-scoped and idempotent. The sample farm preserves its original
sample flags rather than changing the reference on each presentation.

Every farm's open dashboard refreshes by polling its authenticated dashboard and workspace
routes every two seconds (`src/lib/live/poller.ts`). Reads never overlap, pause while the tab
is hidden, and run at once on focus or reconnect. Migration 0010 removed the earlier Supabase
Realtime signals and their anonymous receive policy, so no farm data or change signal goes
through Supabase's public API.

## Operator rollout and verification

The hosted database has all migrations through `0010` (applied September 17, 2026). For a
new migration, run the following with `DATABASE_MIGRATION_URL` set to the hosted owner/session
connection:

```sh
npm run db:migrate
npm run db:enable-mobile
```

`db:migrate` applies versioned SQL and updated account/onboarding/review grants for
`DATABASE_APP_ROLE`. Mobile audio/profile writes still need the explicit mobile grants.
Set `TOPH_MOBILE_ENABLED=true` on the runtime server and set `APP_ORIGIN` to that server's
browser origin. The mobile app must be rebuilt to receive name-based login, secure token
storage and authenticated requests; an older native build will receive 401 from the new API.
Never put migration credentials in a browser/native environment or Vercel application build.

For an existing Bays Ranch database, migration 0008 registers its admin and existing employees
without reseeding. For a fresh database, run `npm run db:seed` explicitly to install the sample
farm and its identities. Normal signup never calls the seed routine.

Verification uses the guarded separate PostgreSQL `toph_test` database. The account suite
covers empty-farm signup, normalization/collision rollback (including simultaneous signup),
real restricted-role grants, raster/geometry validation and persistence, role/farm/worker
scope, private recording downloads, shared first-review attribution, unchanged sample flags,
code rotation, status synchronization and session revocation. Provider calls are not needed
or made in these tests. The full backend suite passed before the additional recording/policy
edge checks; both expanded suites passed afterward. Web/native UI checks are reported by
their respective owners.

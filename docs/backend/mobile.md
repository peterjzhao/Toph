# Mobile API

The Expo app in `mobile/` calls the same Next.js backend and PostgreSQL database as the
website. Canonical endpoints live under `/api/mobile/v1`; service code is in
`src/server/mobile/`, and shared types are in `src/contracts/mobile.ts`.

The existing farm accounts are shared profiles without sign-in. Selecting an account
chooses the author of a log; it is not authentication. All reads and writes are scoped to
the server's configured farm. The database and uploaded recordings are real persisted data.

## Endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /api/mobile/v1/accounts` | Farm, active employee accounts, fields, defaults, revision, upload limit |
| `PATCH /api/mobile/v1/accounts/:id` | Edit name, role, contact details, photo and defaults; reject stale revision |
| `GET /api/mobile/v1/logs?accountId=…` | Up to 100 recent logs for an active farm account |
| `POST /api/mobile/v1/logs` | Atomically save the reviewed log, all clips, treatment, tags and retry receipt |
| `GET /api/mobile/v1/recordings/:id` | Farm recording with byte-range playback support |
| `POST /api/mobile/v1/transcriptions` | Transcript and structured form suggestions; see [recording processing](transcription.md) |

`TOPH_MOBILE_ENABLED=true` enables mobile access. Writes require `X-Toph-Client: toph-mobile`
and reject foreign browser origins. This is a deliberate-client check, not a secret or
user authentication. Submissions use contract version `1`. The old demo routes, environment
setting, client header, submission version, and native sample-recording branches have been
removed. Both client and server must use the current API. Applied SQL migrations retain
their original filenames and contents so the migration ledger stays valid.

## Account and recording behavior

Tap the avatar to select an account or edit it. Photos use the system picker, crop to a
square, resize to 256 pixels and compress to JPEG. The server accepts bounded JPEG/PNG data
URLs (128 KB decoded). Profile edits update the website's roster and normalized log avatars;
field/activity defaults and thumbnails persist in `toph.mobile_profiles`.

Switching accounts first saves incomplete work on the device with its original author.
Save log keeps a durable local copy, uploads all clips, and stores a verified server receipt.
Failures retain the draft for Sync log. Identical retries return the same dashboard log ID;
changed content under an already committed draft ID returns 409. Synced logs are read-only.

Small audio clips are stored as binary PostgreSQL rows transactionally with their log.
Limits are eight clips and 3.8 MB combined audio per log, 100 MB stored audio and 1,000 mobile
submissions per farm. Over-limit recordings remain on the device and can be shared. Larger
production uploads can move to private object storage without changing the log concepts.

The seed contains eleven employee profiles plus a separate web administrator, not an extra
Peter employee. Migration `0005` corrects the earlier roster and refuses to delete recorded
history. Migration `0006` adds distributed transcription counters.

## Setup and checks

Use the owner's connection locally to run `npm run db:migrate`, followed by
`npm run db:enable-mobile` for the restricted runtime role. Do not reseed an existing farm.
Set `TOPH_MOBILE_ENABLED=true` on Vercel Production; the app's default origin is
`https://toph-rho.vercel.app`. Keep all database and OpenAI credentials on the server.

Only the user commits and pushes. Vercel then builds the root application. Run
`npm run check:mobile-server` after it shows Ready. Rebuild the phone app when native code,
app JavaScript, or its bundled configuration changes. Server-only updates need no rebuild.

Unit tests exercise validation and client behavior. PostgreSQL integration tests exercise
profile persistence, photos, field/account scoping, transactional multi-clip uploads,
idempotent retries, rejection of obsolete contracts, and transcription quotas. Mocked provider tests
do not establish live OpenAI behavior; use the separate live check documented below.

# Mobile demo connection

The September 16 mobile request explicitly selects the existing farm demo accounts, without
separate sign-in. The app uses `https://toph-rho.vercel.app` and the opt-in
`/api/mobile/demo/v1` API. These are shared sample-workspace profiles, **not authentication or
private user accounts**. The original `/api/mobile/v1/logs` endpoint remains disabled, and
the existing production transcription guard is unchanged.

## Account and recording behavior

- The avatar opens Account: switch/search the active employee roster, edit name, role, email,
  phone, field/activity defaults, choose a photo using the system photo picker, or remove it.
- Photos are cropped to a square, resized to 256 px, and compressed to JPEG on the device.
  The server accepts bounded JPEG/PNG data URLs (128 KB decoded); URLs to arbitrary hosts,
  filesystem paths, and other content types are rejected.
- Contact details update the same PostgreSQL workspace roster the website uses. Defaults and
  thumbnails persist in `toph.mobile_profiles`. Existing normalized employees receive the
  edited name/photo, so dashboard API responses include them too. Saves use the workspace revision and
  reject stale edits with 409. The form retains pending edits on failure.
- Account selection and the last successfully loaded roster are cached per API origin. Drafts
  retain their employee/farm IDs. Switching accounts saves incomplete in-progress work locally
  before changing identity; it never reassigns a draft. Save errors prevent the switch.
- Save log first copies every recording to device storage, then attempts an explicit upload.
  Offline/network failures leave the draft available for Sync log. A verified server receipt
  is stored with the local draft; audio is retained. The same draft UUID is reused on retries.
- The server commits the normalized dashboard log, ordered audio clips, treatment metadata,
  tags, and deduplication receipt in one PostgreSQL transaction. Repeated identical requests
  return the same log ID; changed content under a committed draft ID returns 409. Synced logs
  are read-only in the mobile app. The library shows device drafts and up to 100 recent server
  logs for the selected account. Every appended clip is accessible on both mobile and web.

## Demo media tradeoff

This demo stores small recordings as binary rows in the private PostgreSQL schema, with
at most eight clips and **3.8 MB combined audio per submission**, under Vercel's 4.5 MB request
limit. The farm has a 100 MB demo media quota and 1,000 submitted-log limit. Over-limit uploads
retain the original local draft; nothing is truncated. The original production design's private
object storage and signed direct uploads remain the path for longer recordings and private
authenticated accounts. The shared demo routes deliberately make sample recordings available
to the shared workspace; they do not promise per-user confidentiality.

PostgreSQL media is served with byte-range support, no-store, MIME types and nosniff. Server-side
validation checks the byte signature, declared type, metadata, active farm account and field,
and unambiguous farm-local work times. `X-Toph-Client: mobile-demo` requires deliberate native
writes and cross-origin browser writes are rejected; the header is not a secret or auth token.

## Enable the existing Vercel server

1. Apply `drizzle/0004_mobile_demo.sql` with the existing migration runner, using the schema
   owner's connection **only locally**. Do not reseed or change the original sample dates.
2. Run `npm run db:enable-mobile-demo` against that same database with
   `DATABASE_APP_ROLE=toph_app`. This grants only the additional demo inserts/profile updates;
   the normal web grant script remains unchanged.
3. Add `TOPH_MOBILE_DEMO_ENABLED=true` to the existing Vercel project's Production environment.
   Keep the runtime database connection, packaged CA, `DATABASE_POOL_MAX=1`, and
   `APP_ORIGIN=https://toph-rho.vercel.app` from the website deployment guide. No Supabase owner
   credentials, OpenAI key, or local transcription token belong in the app bundle.
4. Commit and push the complete change to `main`, including the contracts, routes,
   service/schema, migration and journal, and native app source. The existing Vercel Git
   integration deploys the root Next.js app; it does not build or distribute the native app.
5. Wait for Vercel to show Ready, then run `npm run check:mobile-server` from the root.
   This is read-only: it checks database health, accounts, and the selected account's logs.
   Reopen Toph on the phone; verify profile/photo persistence and a short log submission.
   Until deployment, the app displays a server/deployment error and retains drafts.

Native dependencies changed: run Expo prebuild with `--no-clean` and rebuild the installed app.
`mobile/.env` uses the hosted origin. Development-only transcription can still be configured
separately; hosted transcription remains unavailable until a separately authorized setup.

## Prepared release — September 16, 2026

Supabase migration `0004` and the additional restricted runtime grants are applied. The
original 11 logs and 12 normalized employees remain intact. Both owner and runtime
connections pass the read-only database check with verified TLS, five recorded migrations,
and the mobile save/profile privileges. Vercel Production has the database settings,
`APP_ORIGIN`, `DATABASE_SSL_CA_PATH`, and `TOPH_MOBILE_DEMO_ENABLED=true`. The current
production health endpoint returns 200 with `database: "connected"`.

Only the user should commit and push. No commit, push, or deployment was performed for this
release. The mobile endpoints are new code and will return 404 on the existing deployment
until that push finishes building. No migration, reseed, or additional Vercel setup is
needed for this prepared database.

The updated iOS Release binary was built and installed on the connected iPhone 17 Pro,
preserving its app data. Automatic launch was blocked because the phone was locked;
unlock it and open Toph after the server is ready. The binary uses the hosted origin and
does not require Metro or the Mac to be running.

## Verification commands

- Root: `npm run typecheck`, `npm run test:unit`.
- Mobile: `npm test -- --runInBand`, `npm run typecheck`.
- Isolated PostgreSQL: `npx vitest run --config tests/backend/vitest.config.mts tests/backend/integration/mobile-demo.test.ts`
  with guarded `TEST_DATABASE_URL` / `TEST_DATABASE_APP_URL` set to a separate test database.
- Tests cover server gating, photos, revision conflicts, cross-farm/inactive-account rejection,
  persisted account changes, transactional note/audio/treatment saves, concurrent duplicate
  retries, DST ambiguity, and ordered multi-clip retention. UI tests cover account search,
  asynchronous save failure, and photo changes. Fake-network tests are not hosted verification.

References: [Expo ImagePicker SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/),
[Expo ImageManipulator SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/),
[Vercel request limits](https://vercel.com/docs/functions/limitations#request-body-size).

## Verification recorded September 16, 2026

- All 119 root backend tests passed against the separate local `toph_mobile_test` PostgreSQL
  database, including the existing web regression tests. Both TypeScript checks passed.
- All 78 mobile tests passed, including preserving an incomplete draft while switching
  accounts and keeping each account's library separate.
- A production Next.js build was created in an isolated temporary directory, preserving the
  running development server's build output. A production HTTP server against the isolated
  test database passed account PATCH, actual multipart MP3 upload, identical retry, account
  listing, dashboard log lookup, and audio 206/416 range checks.
- An iOS Release build with ImagePicker/ImageManipulator succeeded and was installed on the
  iPhone 17 simulator. The account editor rendered and the native Photos picker opened. Full
  photo cropping/persistence through the simulator UI has not yet been verified.
- Hosted database, environment, and physical-device preparation are recorded above.
  End-to-end checks against the deployed mobile routes remain pending the user's push.
- A fresh checkout of the staged files passed `npm ci` in both packages, the default
  production Next.js build, both TypeScript checks, all 37 root unit tests, all 8 frontend
  tests, and all 78 mobile tests. Each mobile route's deployment trace includes the TLS CA.
- That production build was run locally against the actual hosted Supabase runtime role:
  health, the roster (12 accounts / 11 fields), and account log reads passed. These were
  read-only checks; they did not add or edit sample logs or profiles.
- The mobile `.env` points to the hosted origin and has no bundled transcription token.

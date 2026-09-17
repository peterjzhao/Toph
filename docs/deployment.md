# Vercel deployment

Target: **peterjzhao/Toph**, branch **main**, existing project serving
**https://toph-rho.vercel.app**. This guide prepares a website/backend deployment; it does not
deploy the separate native app. No build or startup command runs migrations or loads data.

## Project settings before pushing

In the existing Vercel project, open **Settings → Build and Deployment**:

| Setting | Value |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | `./` (repository root) |
| Node.js Version | `24.x` (also pinned in `package.json`) |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | Leave the framework default; do not set `out` |

Under **Settings → Git**, confirm the connected repository is `peterjzhao/Toph` and the
production branch is `main`. Keep the existing `toph-rho.vercel.app` domain. Saving settings
does not update the existing deployment. The next user-initiated push to `main` will build
and deploy through the existing Git integration; no CLI deploy or redeploy is necessary.

## Production environment variables

In **Settings → Environment Variables**, select **Production** for these server-only values:

| Name | Value/action |
| --- | --- |
| `DATABASE_URL` | Keep the existing restricted `toph_app` transaction-pooler connection on port `6543`. Do not substitute the owner or `postgres` login. |
| `DATABASE_POOL_MAX` | `1` |
| `TOPH_FARM_ID` | `00000000-0000-4000-8000-000000000001` |
| `APP_ORIGIN` | `https://toph-rho.vercel.app` (no trailing slash) |
| `DATABASE_SSL_CA_PATH` | `certs/supabase-prod-ca-2021.crt` |
| `TOPH_MOBILE_ENABLED` | `true` (shared farm profiles and log sync) |
| `TOPH_TRANSCRIPTION_ENABLED` | `true` when the server key is configured and recording processing is wanted |
| `OPENAI_API_KEY` | Server-only project key for speech and structured extraction; store as a Vercel secret |

The certificate is public, not a credential. `next.config.ts` explicitly includes it in
`/api/**` output traces, so that relative path exists in the deployed server function.
It is outside `public/`. No path under `/Users/...` belongs in Vercel configuration.
The driver uses `rejectUnauthorized: true` and Node's default hostname verification.
Remote `sslmode=disable` is rejected; even `sslmode=require` cannot turn verification off.
Prepared statements are disabled for compatibility with the transaction pooler.

Do **not** add `DATABASE_MIGRATION_URL`, `DATABASE_APP_ROLE`, `TEST_DATABASE_URL`,
`TEST_DATABASE_APP_URL`, Supabase admin/service-role/secret keys, or
`TOPH_TRANSCRIPTION_DEV_TOKEN` to this deployment. None of the runtime variables above
uses `NEXT_PUBLIC_`. Do not disable TLS with `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Preview URLs have different origins: do not reuse the production origin and database for a
writable preview. If a preview is needed later, give it an isolated database and set
`APP_ORIGIN` to its exact stable HTTPS origin. This release needs only Production settings.

## Database and access boundary

Apply migrations through `0006_recording_processing` locally using the owner connection,
then run `npm run db:enable-mobile` for the runtime role. Migration `0005` corrects the
employee roster; `0006` adds shared transcription usage counters. Applied migration files
keep their original names. The user performs the commit/push that updates Vercel.
Do not rerun migration or seed commands as a Vercel build step. Future migrations are an
explicit operator action using credentials kept locally, following [database setup](backend/setup.md).

This is an interview submission with shared sample data. Profile selection and Log Out
change browser state; they do **not** authenticate a user. All visitors can read the farm,
and writes that pass the origin check share its data. The origin check prevents cross-site
browser writes, not direct API access. Keep private data out until authentication and
authorization are implemented. Messages/support requests are saved records, not delivery.

The app uses `/api/mobile/v1/accounts`, `/logs`, `/recordings/:id`, and `/transcriptions`.
See [mobile setup](backend/mobile.md) and [transcription setup](backend/transcription.md).
Old `/api/mobile/demo/v1/*` URLs and the old mobile flag remain compatibility aliases.
Transcription runs in production when the server key and its separate enable flag are set;
it returns speech plus validated form fields. `/design-check` and `/design-reference/*`
continue to return 404 in production.

## Checks before and after the user's deployment

Verify the exact Git index in a separate temporary directory with `git checkout-index`.
Run `npm ci`, `npm run build`, `npm run typecheck`, `npm run test:unit`, and
`npm run test:frontend` there. Inspect the generated API `.nft.json` traces for the CA file.
`npm run test:backend` requires a separate disposable test database; it drops its test
schemas. Never run that suite against the hosted runtime database.

Keep local `.env*` (except `.env.example`), generated native projects, signing files,
agent instructions, reference captures, `node_modules`,
and build outputs out of newly staged files. `shared/design/tokens.ts` is a website runtime
dependency and must be included. Include `mobile/` source, configuration, package lock,
assets, tests, and README; Vercel still builds only the root package.
Existing tracked design exports and the sample playback
audio remain in history; they were not added by this preparation.

After the user commits and pushes, check:

- `/` loads the dashboard and `/activity-logs`, `/employees`, and `/settings` load.
- `/api/health` returns 200 with `database: "connected"`.
- `/api/dashboard` and `/api/workspace` return stored data, not database configuration errors.
- A deliberate sample-data edit survives reload; check its origin if writes return 403.
- `npm run check:mobile-server` passes against the production URL: health, accounts,
  and account logs all return 200.
- Reopen the updated phone app, choose an account, save a profile/photo change, and save a
  short log. Confirm the saved details survive reopening and the log appears on the website.
- With the OpenAI key configured, `npm run check:recording -- public/assets/sample-recording.mp3`
  returns speech and structured fields. This uses the live provider without saving a log.
- Design comparison URLs return 404 in production.

Sources: the installed Next.js `output` and environment-variable docs under
`node_modules/next/dist/docs`, [Vercel project settings](https://vercel.com/docs/project-configuration/project-settings),
[Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), and
[Vercel environment variables](https://vercel.com/docs/environment-variables).

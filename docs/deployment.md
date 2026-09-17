# Vercel deployment

Target: **peterjzhao/Toph**, branch **main**, existing project serving
**https://toph-rho.vercel.app**. This guide prepares a website/backend deployment; it does not
deploy the separate native app. No build or startup command runs migrations or loads data.

## Messaging release

Commit all staged messaging source, tests, docs, and `vercel.json`, then push to `main`.
The checked-in Vercel config pins Next.js, `npm ci`, and `npm run build`; the existing Git
integration deploys the root website/API. Messaging uses the existing database and auth
configuration, with no additional environment variable, webhook, push service, or migration.

The hosted Supabase database was checked read-only during messaging release preparation:
all nine migrations through 0008 are applied; `toph_app` can read accounts/sessions/workspace
and update workspace payload/revision. The public CA committed in `certs/` successfully
verifies its TLS connection. No hosted data or configuration was changed by this check.
The live website still served the preceding anonymous API and no messaging routes at that
time; the next successful deployment must include the account and messaging source together.

After Vercel reports Ready, run `npm run check:mobile-server`. It verifies PostgreSQL health
and that account/inbox routes require authentication. Optionally supply `TOPH_MOBILE_TOKEN`
as an environment variable containing an existing worker session to verify their private
bootstrap, logs and inbox; the script never logs tokens, sends messages, or marks them read.
The anonymous check alone does not prove two-way delivery.

**The iPhone Release app also needs the new Inbox JavaScript. A Git push does not update an
already installed binary.** With the phone connected, run from the repository root:

```sh
npm --prefix mobile ci
npm --prefix mobile run ios:release
```

Choose the connected phone when prompted. Install in place to retain local recordings and
drafts. The default server URL is already `https://toph-rho.vercel.app`; no mobile secret or
new messaging dependency is required. Android's corresponding command is
`npm --prefix mobile run android:release`. This release does not add EAS Update or APNs.

On the updated app, sign in as a worker and open Inbox. Send from the web Messages page;
the worker receives it on the next five-second foreground refresh, can reply, and both sides
see read receipts. Closed apps receive their saved messages when reopened, without OS push
notifications. See [worker inboxes](backend/messages.md) for privacy and storage limits.

Release preparation verified the exact staged source in a separate clean checkout using
Node 24: `npm ci` and the production build passed, and all 29 API traces include the database
CA. The production build was then run locally against the guarded disposable PostgreSQL
test database: admin-to-worker delivery, worker reply, both read receipts, identical-send
retry, and the authenticated deployment checker passed. Backend (176), frontend (40), and
native (92) tests passed, as did both typechecks. No commit, push, hosted deployment, or
native installation was performed by this preparation.

## Account release prerequisite (September 17)

The account/onboarding release requires migrations through **0008_farm_accounts** before
serving the new application. Run `npm run db:migrate` from the reviewed checkout with
`DATABASE_MIGRATION_URL` set to the intended Supabase owner/session connection and
`DATABASE_APP_ROLE=toph_app`; this also applies the current runtime grants. A Git push or
Vercel build does not perform this step. Do not seed a new farm; signup creates empty data.
The migration registers the existing Bays Ranch sample profiles without rewriting its logs.

The local Docker and hosted databases are migrated through 0008 (the hosted state was
verified read-only during messaging preparation). See [accounts](backend/accounts.md) for sessions, roles, and verification.
Keep `TOPH_MOBILE_ENABLED=true` for authenticated worker routes. Rebuild the native app for
its new SecureStore dependency; OTA JavaScript alone cannot add a native module.

Browser field inference uses ONNX Runtime Web and an exported 512px FP32 Delineate Anything
v2 model. The 248 MB model is intentionally excluded from Git. Serve it from a static
HTTPS URL with CORS enabled, then set `NEXT_PUBLIC_FIELD_MODEL_URL` before building. Local
development uses the ignored `public/models/delineate-v2-512-fp32.onnx` artifact. No model
artifact was published by this task. [Browser segmentation](backend/browser-segmentation.md)
records the reproducible export, model license, benchmarks, and hosting requirements.
Manual field outlining remains available if model download/inference fails; it never sends
an image to a server-side inference fallback.

The historical setup notes below describe the preceding release; where account/session
behavior differs, the current accounts guide and contracts are authoritative.

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
| `OPENAI_API_KEY` | Server-only project key for speech and structured extraction; store as a Vercel secret |
| `SUPABASE_URL` | Optional, for [dashboard live updates](backend/realtime.md): `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Optional, with the URL above: the project's publishable key (`sb_publishable_…`) or legacy `anon` key. Public by design; the server refuses to pass on a secret or `service_role` key |

The certificate is public, not a credential. `next.config.ts` explicitly includes it in
`/api/**` output traces, so that relative path exists in the deployed server function.
It is outside `public/`. No path under `/Users/...` belongs in Vercel configuration.
The driver uses `rejectUnauthorized: true` and Node's default hostname verification.
Remote `sslmode=disable` is rejected; even `sslmode=require` cannot turn verification off.
Prepared statements are disabled for compatibility with the transaction pooler.

Do **not** add `DATABASE_MIGRATION_URL`, `DATABASE_APP_ROLE`, `TEST_DATABASE_URL`,
`TEST_DATABASE_APP_URL`, or Supabase admin/service-role/secret keys to this deployment. None of the runtime variables above
uses `NEXT_PUBLIC_`. Do not disable TLS with `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Preview URLs have different origins: do not reuse the production origin and database for a
writable preview. If a preview is needed later, give it an isolated database and set
`APP_ORIGIN` to its exact stable HTTPS origin. This release needs only Production settings.

## Database and access boundary

Apply migrations through `0007_realtime_notifications` locally using the owner connection,
then run `npm run db:enable-mobile` for the runtime role. Migration `0005` corrects the
employee roster; `0006` adds shared transcription usage counters; `0007` signals committed
changes to open dashboards. Applied migration files
keep their original names. The user performs the commit/push that updates Vercel.
Do not rerun migration or seed commands as a Vercel build step. Future migrations are an
explicit operator action using credentials kept locally, following [database setup](backend/setup.md).

For a new database, run `npm run db:enable-realtime` after migrating to let the public `anon`
role receive those signals. **The existing hosted database is already prepared as of
September 17, 2026:** migrations through `0007`, mobile grants, and the realtime receive
policy are applied. Vercel Production has both `SUPABASE_*` values, and their read-back
matches the project tested locally. The values take effect in the next deployment. See
[dashboard live updates](backend/realtime.md) for the hosted verification.

This is an interview submission with shared sample data. Profile selection and Log Out
change browser state; they do **not** authenticate a user. All visitors can read the farm,
and writes that pass the origin check share its data. The origin check prevents cross-site
browser writes, not direct API access. Keep private data out until authentication and
authorization are implemented. Messages/support requests are saved records, not delivery.

The app uses `/api/mobile/v1/accounts`, `/logs`, `/recordings/:id`, and `/transcriptions`.
See [mobile setup](backend/mobile.md) and [transcription setup](backend/transcription.md).
Only the current mobile API is served; the old demo URLs and configuration are removed.
Transcription runs in production when the server OpenAI key is set;
it returns speech plus validated form fields. `/design-check` and `/design-reference/*`
continue to return 404 in production.

## Checks before and after the user's deployment

Pre-deployment verification on September 17 used the staged source in a separate directory:
clean `npm ci`, Node 24 production build, TypeScript, 148 backend tests against the guarded
local PostgreSQL database, 34 frontend tests, and 51 mobile tests all passed. All 13 API
function traces contain the Supabase CA certificate. The production build, running locally
against hosted Supabase, received a mobile upload and updated an open dashboard without a
reload; profile/photo updates also appeared live. Temporary verification data was isolated
from Bays Ranch and removed afterward. A concurrent web profile save now merges only edited
fields, preserving newer mobile contact/name changes.

The live-provider check also passed after the user added `OPENAI_API_KEY` to ignored root
`.env.local`. A synthesized M4A recording went through real OpenAI speech transcription and
structured extraction, returned all ten expected fields with no missing values, and was
saved through the mobile API. The real hosted database retained the transcript, treatment,
tags, and byte-identical audio. The open production dashboard received the live update and
showed the extracted details without reloading. See [the recorded result](backend/transcription.md#follow-up-verification-september-17-2026).

The staged source is ready for the user's commit and push to `main`. No commit, push,
deployment, or new native install was performed during this check. This was a local
production server using real OpenAI and hosted Supabase; repeat the checks below after
Vercel reports Ready to verify the deployed environment, then build/install the latest
mobile Release and try a recording from the phone. Its configured origin already targets
`https://toph-rho.vercel.app`; no OpenAI key belongs in the app.

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
- With live updates configured, `/api/realtime` reports `enabled: true`, and a phone log or
  profile change appears on an already-open dashboard without reloading it.
- Design comparison URLs return 404 in production.

Sources: the installed Next.js `output` and environment-variable docs under
`node_modules/next/dist/docs`, [Vercel project settings](https://vercel.com/docs/project-configuration/project-settings),
[Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), and
[Vercel environment variables](https://vercel.com/docs/environment-variables).

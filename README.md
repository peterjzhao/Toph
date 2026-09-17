# Toph

Toph is a work log for farms. Workers record what they did in the field on their phone, by
voice or by typing, and the farm admin sees those logs on a web dashboard.

The repo has two apps that share one backend:

- a Next.js web dashboard for the admin, which also serves the API (`src/`)
- an Expo app for workers on iOS and Android (`mobile/`)

Data lives in PostgreSQL (Supabase in production), and the web app is deployed on Vercel.

## The phone app

A worker signs in with their name, or joins a farm with the code the admin gives them.
From there they can:

- record a voice note about the job, or write one
- review the log before saving it: field, activity, date, start and end time, notes, and any
  product, amount and unit that was applied
- keep drafts on the phone when there's no signal and sync them later
- look back through their own logs
- message the farm admin
- edit their profile photo and their default field and activity

When a recording is processed, the server sends the audio to OpenAI for transcription, then
asks a second model to pull the log fields out of the transcript. Anything the worker didn't
say stays empty. The worker checks the suggestions before saving, so nothing turns into a
log without them confirming it.

## The dashboard

An admin creates a farm by signing up on the web. The first step is setting up the farm's
fields. They upload an aerial image, a segmentation model running in the browser suggests
field outlines, and the admin picks the ones that are real fields and gives each a letter.
After that the admin shares a join code with their workers.

The dashboard shows incoming logs with their recording, transcript, tags and a map of the
field. New logs stay marked until the admin opens them. The sidebar also has pages for
activity logs, the field map, employees, performance, schedule, reports, messages and
settings.

An open dashboard checks the API every two seconds, so a log saved on a phone appears
without a page reload. Messages are checked every five seconds on both sides.

Bays Ranch is a sample farm seeded from the original Figma design. It keeps the design's
eleven workers, logs and card values, and it can't be edited like a real farm.

## How it fits together

```text
phone app ──HTTPS──> /api/mobile/v1/*  ─┐
                                         ├─> server code (src/server) ──> PostgreSQL
web dashboard ─────> /api/*            ─┘                         └────> OpenAI
```

The phone never talks to the database or to OpenAI directly. Every request goes through the
Next.js API, which checks the session and scopes the query to that account's farm. Admins
use a cookie session and workers use a bearer token. Accounts are name-only by design (no
passwords), so this is not meant as real identity verification.

| Path | What's there |
| --- | --- |
| `src/app/` | Pages and API routes |
| `src/components/` | Dashboard and workspace UI |
| `src/server/` | Database access, accounts, transcription, validation |
| `src/contracts/` | Types shared by the API, the web app and the phone app |
| `mobile/` | The Expo app ([its README](mobile/README.md)) |
| `shared/design/` | Colors, type and spacing used by both apps |
| `drizzle/` | SQL migrations |
| `scripts/db/` | Migrate, seed and check the database |
| `tests/` | Backend and frontend tests |
| `docs/` | Longer notes on the API, database and deployment |
| `design/reference/` | The original Figma exports |

## Running it locally

You need Node 24. There is one database: the hosted Supabase one that production uses.
Copy `.env.example` to `.env.local`, fill in the Supabase connection strings and the OpenAI
key, then:

```sh
npm ci
npm run dev
```

The local dev server reads and writes the production data, so be careful with test edits.
Schema changes go through `npm run db:migrate`.

The dashboard runs at http://127.0.0.1:3000. Log in as `Ranch Admin` to open the sample
farm, or create a new farm. For the phone app, see [mobile/README.md](mobile/README.md).
[Database setup](docs/backend/setup.md) has more detail on the database roles.

If the sample farm gets messed up, `npm run db:reset-sample -- --yes` puts Bays Ranch back to
its seeded state. It deletes every change made to that farm and signs out its sessions, and
leaves other farms alone. It runs against production through `DATABASE_MIGRATION_URL`.

## Tests

```sh
npm run typecheck
npm run test:unit
npm run test:frontend
npm run test:db:up     # disposable Docker Postgres, only for the backend tests
npm run test:backend
```

The phone app has its own tests: `cd mobile && npx jest`.

More documentation is listed in [docs/README.md](docs/README.md).

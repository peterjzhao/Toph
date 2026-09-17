# Backend setup

Database, migrations, initial data, roles, and tests for the Toph backend. Commands run from
the project root with `npm`. See [Vercel deployment](../deployment.md) for hosted runtime settings;
the migration and test commands below are operator tools, not deployment build steps.

## Prerequisites

- Node.js 24 LTS (the pinned Vercel runtime) and npm.
- The hosted Supabase database. It is the only application database; local development uses it too.
- Docker (OrbStack on this machine), only for the disposable backend test database.
- No Postgres client tools are required; the scripts use the bundled `postgres` driver.

## Environment variables

Copy `.env.example` to `.env.local` (git-ignored; Next.js loads it automatically). All keys are
server-only. Nothing may use a `NEXT_PUBLIC_` prefix.

| Key | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | App runtime (`/api/*`) | Restricted role (`toph_app`): reads plus the tag and workspace write paths. |
| `DATABASE_MIGRATION_URL` | `db:migrate`, `db:seed`, `db:reset-sample`, `db:check` | Owner role with DDL privileges. Session or direct connection, never the transaction pooler. |
| `TEST_DATABASE_URL` | `test:backend` | Separate disposable database. The database name must contain `test`; tests refuse to run if it matches the runtime database. |
| `TEST_DATABASE_APP_URL` | `test:backend` (optional) | The same test database as the restricted role, used to verify grants. Those tests are skipped when unset. |
| `DATABASE_APP_ROLE` | `db:migrate`, `db:check` | Role that receives runtime grants after migrations (default `toph_app`; empty skips grants). |
| `DATABASE_SSL_CA_PATH` | all connections | Optional PEM file for a hosted database certificate. Remote hosts always verify TLS. |
| `DATABASE_POOL_MAX` | App runtime | Pooled connections per server process (default 5). |
| `TOPH_FARM_ID` | App runtime | UUID of the farm this deployment serves. Missing, malformed, or absent from the database answers 503 `NOT_CONFIGURED`. |
| `APP_ORIGIN` | App runtime | Browser origin required on `POST`, `PATCH`, and `DELETE` requests, e.g. `http://127.0.0.1:3000`. |

## Backend test database

`compose.db.yaml` starts a disposable `postgres:17-alpine` bound to `127.0.0.1:54329`, with
the database `toph_test`. On first initialization `scripts/db/docker-init/01-local-roles.sql`
creates the restricted role `toph_app`. The credentials are test-only placeholders and are
already filled in `.env.example`. It holds no application data; each test run rebuilds it.

```bash
npm run test:db:up
```

```bash
npm run test:backend
```

Stop it with `npm run test:db:stop`, or wipe it with
`docker compose -f compose.db.yaml down -v`. If Docker commands fail with a socket error, start
OrbStack with `orbctl start` and retry.

`db:migrate` applies the SQL under `drizzle/` and grants `DATABASE_APP_ROLE` its runtime
privileges. `db:seed` loads the Bays Ranch initial dataset and is idempotent: it inserts what is
missing and never overwrites existing rows or tags. `db:check` reports connectivity, migration
state, data state, and the runtime role's effective privileges without printing secrets.

## Supabase

Existing installations may still have the older twelve-employee seed. Migration `0005`
removes the extra seeded Peter profile; the eleven employees plus the separate administrator
account give twelve active workers. These steps document provisioning; do not repeat them
just to deploy the website. Keep owner credentials in local configuration only.

1. In the SQL editor, create the restricted runtime role:

   ```sql
   CREATE ROLE toph_app LOGIN PASSWORD '<strong-password>'
     NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
   ```

2. Set `DATABASE_MIGRATION_URL` to the session pooler (port `5432`, user
   `postgres.<project-ref>`) or the direct connection. Set `DATABASE_URL` to the transaction
   pooler (port `6543`, user `toph_app.<project-ref>`). Prepared statements are already disabled
   in the driver configuration, as the transaction pooler requires.
3. TLS and hostname verification are enabled for every non-loopback host. Set
   `DATABASE_SSL_CA_PATH=certs/supabase-prod-ca-2021.crt` to use the bundled public Supabase CA.
   The same relative path works in Vercel API bundles; an absolute local path also works
   for operator scripts. Remote `sslmode=disable` is rejected.
4. Run `npm run db:migrate` and `npm run db:seed`. The migration step also revokes every
   privilege on the `toph` schema from `anon`, `authenticated`, and `service_role`, and sets
   default privileges so future tables stay private.
5. Leave `toph` out of the Data API "Exposed schemas" list. The application never uses the
   Supabase client libraries; Drizzle connects directly.

## Database roles and privileges

- Migration/owner role (`DATABASE_MIGRATION_URL`): owns the `toph` schema, runs DDL, loads data,
  applies grants. Supabase: `postgres`; test container: `toph_owner`.
- Runtime role (`DATABASE_URL`): what the Next.js server uses: `toph_app`.

Grants applied by `db:migrate` (see `src/server/db/grants.ts`):

```sql
GRANT USAGE ON SCHEMA toph TO toph_app;
GRANT SELECT ON ALL TABLES IN SCHEMA toph TO toph_app;            -- includes the dashboard_logs view
GRANT INSERT ON toph.tags TO toph_app;
GRANT INSERT, DELETE ON toph.work_log_tags TO toph_app;
GRANT UPDATE (updated_at) ON toph.work_logs TO toph_app;          -- also enables SELECT ... FOR UPDATE
GRANT INSERT, UPDATE (payload, revision, updated_at) ON toph.workspace_state TO toph_app;
GRANT EXECUTE ON FUNCTION toph.waveform_peaks_valid(jsonb) TO toph_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA toph GRANT SELECT ON TABLES TO toph_app;
REVOKE ALL ON SCHEMA toph FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA toph FROM PUBLIC;
-- plus the same revokes for anon, authenticated, service_role when present
```

The runtime role cannot insert, update, or delete farms, employees, fields, work logs (other
than `updated_at`), or tag catalog rows, cannot delete workspace rows, and cannot create objects.
The test suite verifies this when `TEST_DATABASE_APP_URL` is set.

## Migrations

Schema source: `src/server/db/schema.ts`. Reviewed SQL under `drizzle/`:

| Migration | Contents |
| --- | --- |
| `0000_initial_toph_schema.sql` | Tables, constraints, indexes, `waveform_peaks_valid`, `dashboard_logs` view |
| `0001_workspace_state.sql` | `workspace_state` (sidebar pages) |
| `0002_remove_demo_scaffolding.sql` | Drops the metric snapshot table and the farm/recording provenance columns; recreates the view |
| `0003_employee_avatar.sql` | Adds `employees.avatar_path` and exposes it in the view |
| `0004_mobile_demo.sql` | Adds shared mobile profile, submission, and recording storage |
| `0005_remove_extra_worker.sql` | Removes the extra seeded Peter profile and its workspace references; refuses to delete recorded work |
| `0006_recording_processing.sql` | Adds shared transcription/extraction usage counters |
| `0007_realtime_notifications.sql` | Added database live-update signals for Supabase Realtime (removed by `0010`) |
| `0009_rename_sample_farm.sql` | Renames `farm_access.is_demo` to `is_sample` |
| `0010_remove_realtime_notifications.sql` | Drops the live-update triggers, `toph.notify_farm_change()`, and the Realtime receive policy; dashboards poll instead |

Applied migrations are recorded in `drizzle.__drizzle_migrations`, outside the application
schema. After changing the schema run `npm run db:generate`, review the SQL (hand-written
objects such as the function are not managed by drizzle-kit), then `npm run db:migrate`.

## Initial data

`npm run db:seed` loads Bays Ranch: the farm, eleven employees, eleven fields, and eleven work
logs with deterministic IDs (`src/server/db/initial-data.ts`). Every log references the
recording and waveform assets under `public/assets`. The tag catalog starts empty. Re-running
inserts nothing and changes nothing; nothing is loaded at application startup.

`npm run db:reset-sample -- --yes` restores Bays Ranch to that seeded state. It deletes the
farm's logs, tags, recordings, messages, workspace edits, accounts and sessions, then seeds
again, including the admin's Figma photo in the workspace settings. Other farms are not
touched. Without `--yes` it only prints which database it would reset.

The administrator is the existing separate account shown in Switch User, not a twelfth
employee profile. `activeWorkers` includes this account once. Run `npm run db:migrate` on
an existing database to remove the obsolete seeded Peter ID from normalized employees,
mobile profile preferences, and workspace employee/schedule/message entries. This preserves
the other eleven employees, logs, settings, and edits. A changed workspace gets a new revision
so an older browser cannot restore the removed profile through a stale update. If Peter has
recorded work, the migration stops instead of deleting that history.

## Tests

```bash
npm run test:backend
```

The suite runs only against `TEST_DATABASE_URL`. It drops and recreates the `toph` and `drizzle`
schemas in that database, applies the migrations, loads the dataset plus a second test-only farm,
and exercises migrations, constraints, loading, services, HTTP route handlers, grants,
concurrency, workspace persistence, and persistence across separate Node processes. Files run
serially. The suite never touches `DATABASE_URL` and never restarts the frontend's dev server.

```bash
npm run typecheck
```

## Running the app

The `npm run dev` server reads `.env.local` and serves the API routes. Verify with:

```bash
curl -s http://127.0.0.1:3000/api/health
```

A `503` from `/api/health` or any data route means the database is unconfigured, unreachable,
or the farm is not set up; the error `code` says which. Data routes never fall back to fixtures.

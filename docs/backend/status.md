# Backend status

As of September 16, 2026 (local; nothing deployed). Updated after the demo framing was removed
from the data model at the user's request.

## Implemented

- Private `toph` schema: `farms`, `employees`, `fields`, `work_logs`, `tags`, `work_log_tags`,
  `workspace_state`, the `waveform_peaks_valid` function, and the one-row-per-log
  `dashboard_logs` view. Migrations `0000` to `0002` under `drizzle/`.
- Contract v2 in `src/contracts/dashboard.ts`.
- Server-only services: dashboard, detail, tag catalog (`src/server/services/dashboard.ts`),
  tag add/remove (`src/server/services/tags.ts`), workspace (`src/server/workspace/`), all scoped
  through `src/server/farm-context.ts` (`TOPH_FARM_ID`, verified in the database per request).
- Route Handlers: `GET /api/dashboard`, `GET /api/logs/:logId`, `GET /api/tags`,
  `POST /api/logs/:logId/tags`, `DELETE /api/logs/:logId/tags/:tagId`, `GET /api/health`,
  `GET`/`PATCH /api/workspace`, with validation, envelopes, `no-store`, body limits, JSON-only
  writes, and the `Origin` check.
- Metrics computed per request from the farm's data; `responseAccuracy` is null.
- Idempotent initial-data loader (`npm run db:seed`), restricted runtime role grants, lazy
  bounded pool, TLS verification for remote hosts, sanitized 503/500 handling.
- Isolated local PostgreSQL via `compose.db.yaml`, `.env.example`, scripts `db:up`, `db:stop`,
  `db:generate`, `db:migrate`, `db:seed`, `db:check`, `test:backend`.

## Verified against PostgreSQL 17.11 (Docker, local)

`npm run test:backend`: 14 files, 102 tests passing. The suite rebuilds the `toph_test` schema
from the three migrations and checks constraints and cross-farm foreign keys, the exact initial
rows (names, activities, dates, farm-local times, new flags, deterministic IDs, Isaac's summary
verbatim, recording on every log), idempotent loading that preserves edits and tags, search
with literal wildcards, filters, `all`/`this-month`/`custom` periods, sorting, pagination,
computed metrics, matching dashboard and detail records, tag persistence through new
connections and separate Node processes, twelve concurrent duplicate adds, sixteen concurrent
adds against the ten-tag cap, rollback on 409, idempotent removal, a second farm invisible and
immutable through the API, malformed requests, origin handling, `NOT_CONFIGURED` for a missing
or unknown farm, missing and unreachable database (sanitized 503), body limits, health, the
restricted role's privileges, and the workspace revision protocol.

Migration `0003_employee_avatar.sql` adds `employees.avatar_path`, exposed as `employee.avatarUrl`
(null until set; there is no upload endpoint yet).

Also verified: `npm run db:migrate` (4 migrations), `npm run db:seed`, and `npm run db:check`
against the rebuilt local runtime database; `npm run db:generate` reports no drift.

## Repository cleanup and prepared mobile boundary

The obsolete `recording.isDemo` adapter reference has been removed. Web typechecking and
`npm run build` pass after the feature-folder moves and route-type regeneration.

The new mobile log client and draft adapter remain unwired. `POST /api/mobile/v1/logs`
always returns 503 `MOBILE_SYNC_DISABLED` without auth, storage, or database access. See
[mobile.md](mobile.md) for the contract, code example, and work required to enable it.

Cleanup checks: root `npm run test:unit` passed 28 tests; mobile typechecking and all 59 mobile
tests passed, including fake-network submission checks. The final adapter adjustment also
passed its 12 targeted tests and mobile typechecking. No PostgreSQL integration suite was
rerun during this cleanup; the database results above belong to the prior backend milestone.

## Not verified

- Supabase: no credentials were available; the hosted path is documented in `setup.md` only.
- Deployment is out of scope.

## Environment notes

- The local runtime database (`toph`) was rebuilt from scratch on the new schema because its
  rows carried the old demo text and a metrics snapshot. The previously saved local workspace
  row was dropped with it; the workspace re-initializes on its first read.
- OrbStack provides Docker on this machine; container `toph-postgres`, volume
  `toph_toph-postgres-data`. `.env.local` holds the local container credentials (git-ignored).
- Dependencies (exact versions): `drizzle-orm` 0.45.2, `postgres` 3.4.9, `zod` 4.6.5,
  `server-only` 0.0.1; dev: `drizzle-kit` 0.31.10, `vitest` 4.1.11, `tsx` 4.23.13,
  `dotenv` 17.4.2.

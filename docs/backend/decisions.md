# Backend decisions

Concise rationale for the implementation choices. The schema and API originally followed
`docs/backend-spec.md`; the September 16 follow-up removed the demo framing from the data model
so the database reads as an ordinary production store for one farm. The differences from the
spec are listed at the end.

## Structure

- Route Handlers under `src/app/api/**` stay thin: parse and validate, resolve the trusted farm
  context, call a service, serialize. Validation, farm scoping, queries, and transactions live in
  `src/server/**`, marked `server-only`, so Server Components can call them without an HTTP hop
  and they can never be bundled for the browser.
- `src/contracts/dashboard.ts` holds the plain DTO types (contract v2) with no server imports.
- Drizzle with the `postgres` driver: typed schema, generated-and-reviewed SQL migrations, and
  explicit SQL fragments where the query builder would obscure the SQL (search, sort expressions,
  the view). Prepared statements are disabled because Supabase's transaction pooler does not
  support them.
- Zod validates the dashboard query and workspace payloads; identifiers and the tag body use
  small hand-written checks.

## Relational model

- Everything lives in the private `toph` schema. The Supabase Data API only exposes listed
  schemas, and the grant script additionally revokes all access from `anon`, `authenticated`,
  `service_role`, and `PUBLIC`.
- Composite foreign keys `(farm_id, employee_id)`, `(farm_id, field_id)`,
  `(farm_id, work_log_id)`, and `(farm_id, tag_id)` reference `UNIQUE (farm_id, id)` on the
  parent tables, so a log can never point at another farm's employee, field, or tag even if the
  application layer is bypassed. The suite proves this with a second farm.
- `dashboard_logs` is a plain view with one row per log: employee and field names are joined
  from their owning rows and tags are aggregated by a correlated subquery into a JSON array. The
  service reads this view, so the page-to-database mapping is visible in any SQL client.
- `work_date` is the business date in the farm timezone, stored separately from the
  `timestamptz` instants. The loader derives each instant from the farm-local wall time with an
  Intl-based helper and asserts the stored date matches; the DTO returns UTC timestamps and the
  UI formats them in `farm.timezone`.
- Check constraints: end after start, non-empty names and labels, 40-character labels,
  positive finite recording durations that require a recording path, and waveform peaks
  validated by a small immutable SQL function (`toph.waveform_peaks_valid`) hand-written at the
  top of the first migration because drizzle-kit does not manage functions.
- Deletes are restricted for farms, employees, and fields while referenced. Deleting a log or a
  tag cascades only its join rows. No endpoint deletes parent records.
- `workspace_state` (one JSONB document per farm with a revision counter) backs the sidebar
  pages; see `workspace.md`.

## Metrics

The dashboard cards are computed on each request rather than stored: recordings today and new
recordings count the farm's logs dated today in the farm timezone, and active workers counts
employees with `is_active`. Response accuracy has no measured source in the data, so it is
returned as `null` and the UI shows a placeholder. There is no metrics table.

## Tags

- Labels are normalized on the server: control characters rejected, NFC applied, trimmed,
  internal whitespace collapsed, 1–40 characters, readable casing kept. The uniqueness key is
  the lowercase form, enforced by `UNIQUE (farm_id, normalized_label)`.
- Every mutation runs in one transaction that first locks the farm-scoped log row with
  `SELECT ... FOR UPDATE`, serializing association changes per log so the ten-tag limit holds
  under concurrent requests and duplicate requests converge on one association.
- The catalog entry is resolved with `INSERT ... ON CONFLICT DO NOTHING RETURNING id` and a
  `SELECT` on conflict, which needs no `UPDATE` privilege on `tags` and handles two logs adding
  the same new label in parallel.
- Hitting the limit rolls the transaction back, including a catalog entry created in it.
  `updated_at` on the log changes only when an association is actually added or removed.
  Removal deletes the association only; removing an absent tag is an idempotent success.

## Access boundary

- The farm is resolved on the server from `TOPH_FARM_ID` and loaded from the database on every
  request. Query parameters never select a farm; an unknown parameter such as `farmId` is a 400.
- Writes require an `Origin` header matching `APP_ORIGIN` (canonicalized). Browsers send
  `Origin` on `POST`, `PATCH`, and `DELETE`, so the app must be opened at the `APP_ORIGIN` host.
  This is a CSRF guard, not authentication; per-user authorization is a later milestone.
- The runtime role holds only the privileges the code needs (see `setup.md`).
- TLS: the driver turns `sslmode=require` into an unverified connection, so the connection
  factory always passes explicit `{ rejectUnauthorized: true }` for non-loopback hosts and
  supports a CA bundle via `DATABASE_SSL_CA_PATH`. Loopback connections use no TLS unless asked.
- The pool is created lazily on first use, bounded, and cached on `globalThis` so development
  hot reloads do not leak connections. Importing a route with no database configured does
  nothing; the first request answers a documented 503.

## Errors

- One envelope: `{ "error": { "code", "message", "fields"? } }` with `Cache-Control: no-store`.
- `NOT_CONFIGURED` (503) when the farm setting is missing, malformed, or the farm row does not
  exist; `DATABASE_UNAVAILABLE` (503) when the database is unconfigured or unreachable.
- Driver failures are mapped through the error `cause` chain to a generic 503; messages never
  include hosts, ports, credentials, or SQL. Unexpected errors are logged server-side with
  connection strings redacted and answered as a sanitized 500.

## Initial dataset

The Bays Ranch dataset (`src/server/db/initial-data.ts`) is the farm's history as loaded on day
one: eleven employees, eleven fields, and eleven April 2026 work logs with deterministic IDs.
Isaac's log keeps its original guided voice-log summary verbatim; the other logs carry short
written summaries of the work done. Every log references `/assets/sample-recording.mp3`
(13.384671 s, read from the file's container metadata) and `/assets/waveform.svg`, and every
field references `/assets/field-map.svg`. The loader only inserts missing records, so edits and
tags made afterwards survive re-runs. The default dashboard period is `all` so the history is
visible regardless of the current month; `this-month` uses the real calendar month.

## Verification approach

- All persistence checks run against real PostgreSQL 17 in an isolated Docker container, using
  a separate `toph_test` database that the suite may reset. Nothing is verified with mocks,
  browser storage, or JSON files.
- The "survives restart" check spawns separate Node processes (each with its own connection)
  that add, read, and remove a tag.
- Concurrency is exercised with parallel service calls (twelve duplicate additions, sixteen
  distinct additions against the ten-tag cap, competing workspace revisions).

## Differences from `docs/backend-spec.md`

- No `dashboard_metric_snapshots` table; metrics are computed and `responseAccuracy` is null.
- `farms` has no `demo_reference_date` or `is_demo`; `work_logs` has no `recording_is_demo` or
  `waveform_source`.
- Configuration uses `TOPH_FARM_ID` and `APP_ORIGIN` only; there are no demo-mode or
  write-enable flags. Writes are always on, guarded by the origin check.
- Periods are `all` (default), `this-month`, and `custom`; the pinned April 2026 month is gone.
- Contract v2 (`recording` without `isDemo`/`waveformSource`, `metrics` without `source`, `meta`
  without `mode`/`demoReferenceDate`).
- Every log has the recording; the other ten summaries are plain work summaries rather than
  labeled samples. There is no seed repair mode.

## Out of scope

User authentication, per-user authorization, Supabase Auth/RLS integration, media uploads,
transcription, a live map provider, and deployment.

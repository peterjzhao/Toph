# Database and backend specification

Status: implementation handoff for Claude Fable. Scope: the local backend for the approved Toph interview demo. This file specifies intended behavior; it is not a report of completed backend work.

## 1. Deliverable and structure

Implement PostgreSQL persistence using Drizzle inside the existing Next.js application. Keep route handlers thin and put validation, farm scoping, queries, and transactions in server-only services. The frontend agent retains ownership of the UI.

Suggested structure:

```text
src/contracts/dashboard.ts             # Plain serializable DTOs; safe for browser imports
src/server/db/schema.ts                # Drizzle schema
src/server/db/client.ts                # Lazy database connection
src/server/demo-context.ts             # Trusted demo farm context
src/server/validation/                 # Query/body schemas
src/server/services/dashboard.ts       # Dashboard and detail queries
src/server/services/tags.ts            # Tag transactions
src/app/api/dashboard/route.ts
src/app/api/logs/[logId]/route.ts
src/app/api/logs/[logId]/tags/route.ts
src/app/api/logs/[logId]/tags/[tagId]/route.ts
src/app/api/tags/route.ts
src/app/api/health/route.ts
drizzle/                              # Reviewed SQL migrations and migration metadata
scripts/db/                           # Seed and database utilities
tests/backend/                        # Meaningful unit/integration tests
docs/backend/                         # Setup, decisions, integration notes, status
drizzle.config.ts
compose.db.yaml                        # Optional isolated local PostgreSQL
.env.example                          # Placeholders only
```

Use the Node runtime for PostgreSQL-backed Route Handlers. Read the installed Next.js route-handler, data-fetching, and data-security guides first, including asynchronous route parameters. Do not add Server Actions that duplicate every endpoint. The services can be reused by a future Server Component or action without making an HTTP request back into the same application.

Expected service exports, or equivalent documented names: `getDashboard`, `getLog`, `listTags`, `addLogTag`, and `removeLogTag`. Services must receive or resolve a trusted server context. A client-supplied farm ID is never an authorization context.

## 2. Relational model

Use a private PostgreSQL schema named `toph`, ordinary UUID primary keys, and `timestamptz` audit columns. Put the following definitions and their SQL migrations under version control. Required columns are non-null unless marked nullable below. Name timestamps `created_at` and `updated_at` where listed.

| Table | Columns and purpose |
| --- | --- |
| `farms` | `id uuid PK`, `name text`, `avatar_path text nullable`, `timezone text`, `demo_reference_date date`, `is_demo boolean default false`, `created_at timestamptz`, `updated_at timestamptz` |
| `employees` | `id uuid PK`, `farm_id uuid FK`, `display_name text`, `is_active boolean default true`, `created_at`, `updated_at` |
| `fields` | `id uuid PK`, `farm_id uuid FK`, `name text`, `map_image_path text nullable`, `created_at`, `updated_at` |
| `work_logs` | `id uuid PK`, `farm_id uuid FK`, `employee_id uuid`, `field_id uuid`, `activity text`, `work_date date`, `start_at timestamptz`, `end_at timestamptz`, `summary text`, `transcript text nullable`, `is_new boolean default false`, `recording_path text nullable`, `recording_duration_seconds double precision nullable`, `recording_is_demo boolean default false`, `waveform_asset_path text nullable`, `waveform_peaks jsonb nullable`, `waveform_source text nullable`, `created_at`, `updated_at` |
| `tags` | `id uuid PK`, `farm_id uuid FK`, `label text`, `normalized_label text`, `created_at` |
| `work_log_tags` | `farm_id uuid FK`, `work_log_id uuid`, `tag_id uuid`, `created_at`; composite PK `(work_log_id, tag_id)` |
| `dashboard_metric_snapshots` | `id uuid PK`, `farm_id uuid FK`, `as_of_date date`, `recordings_today integer`, `new_recordings integer`, `active_workers integer`, `response_accuracy numeric(5,2) nullable`, `source text`, `source_notes text`, `created_at`; unique `(farm_id, as_of_date)` |

Constraints:

- Add `UNIQUE (farm_id, id)` on employees, fields, work_logs, and tags so composite foreign keys can enforce farm consistency.
- `work_logs (farm_id, employee_id)` references `employees (farm_id, id)`, and `(farm_id, field_id)` references `fields (farm_id, id)`.
- `work_log_tags (farm_id, work_log_id)` and `(farm_id, tag_id)` reference their matching farm-scoped parents. A tag or employee from another farm must fail even if application validation is bypassed.
- `end_at > start_at`. `work_date` is the activity's business date in the farm timezone. Check consistency when constructing fixtures or future log writes; database timezone defaults must not alter the displayed date.
- Names, activity, and tag labels are nonempty after trimming. Limit tag labels to 40 characters. Store a deterministic normalized label for case-insensitive uniqueness: `UNIQUE (farm_id, normalized_label)`.
- Snapshot counts are nonnegative; `new_recordings <= recordings_today`; accuracy is null or between 0 and 100.
- Recording duration, when supplied, is finite and positive. A non-null duration requires a non-null recording path. A path may have an unknown/null duration.
- `waveform_source` is null, `design_reference`, or `audio`. Peaks are null or an array of finite numbers between 0 and 1, capped at 2,048 samples; validate array contents on the server. A supplied illustration is not measured audio peaks.
- Restrict deletion of farms, employees, and fields while referenced. Deleting a log or tag may cascade only its join-table associations. No public parent-record deletion endpoints are in scope.
- Index work logs on `(farm_id, work_date, id)`, `(farm_id, employee_id)`, `(farm_id, field_id)`, and `(farm_id, activity)`. Index reverse tag association lookup `(farm_id, tag_id, work_log_id)`. Avoid speculative search extensions for eleven records.

Provide a non-materialized `toph.dashboard_logs` SQL view exposing `id`, `farm_id`, `employee_id`, `employee_name`, `activity`, `work_date`, `field_id`, `field_name`, `start_at`, `end_at`, `summary`, `is_new`, and media references. It should have one row per log. Join names without duplicating stored employee identities. Aggregate tags separately or through a subquery so multiple tags never multiply log rows. This view makes the page-to-backend mapping visible in a database inspector. Keep the view private too.

## 3. Contract with the frontend

Create these plain TypeScript types in `src/contracts/dashboard.ts`. No database clients, environment reads, or server-only imports belong in that module. This is contract v1; preserve these field names. Any unavoidable change must be called out before UI integration.

```ts
export type TagDto = { id: string; label: string };

export type LogDto = {
  id: string;
  employee: { id: string; name: string };
  activity: string;
  date: string; // YYYY-MM-DD, business date; UI formats it as April 19, 2026
  field: { id: string; name: string; mapImageUrl: string | null };
  startAt: string; // ISO-8601 timestamp including offset or Z
  endAt: string;
  summary: string;
  isNew: boolean;
  recording: {
    url: string;
    durationSeconds: number | null;
    isDemo: boolean;
    waveformAssetUrl: string | null;
    waveformPeaks: number[] | null;
    waveformSource: "design_reference" | "audio" | null;
  } | null;
  tags: TagDto[];
  updatedAt: string;
};

export type DashboardData = {
  farm: {
    id: string;
    name: string;
    avatarUrl: string | null;
    timezone: string;
  };
  metrics: {
    recordingsToday: number;
    newRecordings: number;
    activeWorkers: number;
    responseAccuracy: number | null;
    asOf: string; // YYYY-MM-DD
    source: string; // "figma_demo" for this seed
  };
  newLogCount: number; // New records matching the current filters, before pagination
  logs: LogDto[];
  filterOptions: {
    activities: string[];
    fields: Array<{ id: string; name: string }>;
  };
};

export type DashboardQuery = {
  q?: string;
  activities?: string[];
  fieldIds?: string[];
  period?: "demo-month" | "all" | "custom";
  from?: string;
  to?: string;
  sort?: "date-asc" | "date-desc" | "employee-asc" | "activity-asc";
  limit?: number;
  offset?: number;
};
```

Return JSON-safe values: no JavaScript `Date`, `BigInt`, database row objects, credentials, filesystem paths, or connection information. Convert numeric database values to JSON numbers explicitly. Static asset URLs may be application-relative `/assets/...` paths. Do not persist expiring signed download URLs as durable database values.

HTTP success envelopes use `{ "data": ... }`. Dashboard responses additionally include `meta` with `contractVersion: "1"`, `mode: "demo"`, `demoReferenceDate: "2026-04-29"`, applied filters, and `pagination: { total, limit, offset, hasMore }`. `total` is the count after filtering but before pagination. `getDashboard` should expose a typed result containing the data and meta so pagination is computed once. Details and tag changes do not need pagination metadata.

Metrics represent the farm-wide reference snapshot and do not change when a user searches or filters logs. `newLogCount` follows the log filters. `filterOptions` are farm-wide choices and do not shrink with the active filters. Expansion does not mark a log read or change the dataset.

Load the latest snapshot with `as_of_date <= demo_reference_date`. A missing required snapshot is a documented configuration/seed error, not permission to manufacture metric values.

## 4. HTTP endpoints

| Method and path | Request | Success response |
| --- | --- | --- |
| `GET /api/dashboard` | Validated query below | `200 { data: DashboardData, meta: ... }` |
| `GET /api/logs/:logId` | UUID path parameter | `200 { data: LogDto }` |
| `GET /api/tags` | No farm selector | `200 { data: TagDto[] }`, sorted by normalized label |
| `POST /api/logs/:logId/tags` | JSON `{ "label": "Needs review" }` | `200 { data: { logId, tags: TagDto[] } }` after commit |
| `DELETE /api/logs/:logId/tags/:tagId` | UUID path parameters | `200 { data: { logId, tags: TagDto[] } }` after commit |
| `GET /api/health` | None | `200 { data: { status: "ok", database: "connected" } }` only after a database check; otherwise sanitized `503` |

For dashboard query strings, use `q`, repeatable `activity`, repeatable `fieldId`, `period`, `from`, `to`, `sort`, `limit`, and `offset`. Reject invalid values and unknown query parameters with 400. In particular, do not accept `farmId` as a scope override.

- `q`: trimmed, at most 200 characters; case-insensitive literal substring match across employee name, activity, field name, and assigned tag label. Escape SQL LIKE wildcards so `%` and `_` in user input stay literal. Use parameterized queries.
- Activity and field lists use OR within each list, AND across filter categories; maximum 25 values per list. An unmatched but valid value yields no results. Validate field IDs as UUIDs.
- `period` defaults to `demo-month`, derived from the farm's fixed demo reference date: April 1 through April 30, 2026. `all` removes the date restriction. `custom` requires both `from` and `to` as real calendar dates with `from <= to`, inclusive. Reject `from`/`to` for other periods to avoid ambiguous behavior.
- `sort` defaults to `date-asc`. Sort dates by `work_date`, then `start_at` in the same direction, then ID ascending as the stable tie-breaker. Name/activity sorts are case-insensitive ascending, then date/start ascending, then ID ascending. Sort keys map to an allowlist, never raw SQL from a request.
- `limit` defaults to 50 and is an integer between 1 and 100. `offset` defaults to 0 and is an integer between 0 and 100,000. All eleven demo logs therefore arrive on the initial response.
- No matches return empty `logs`, `newLogCount: 0`, and `pagination.total: 0`, with normal metrics and filter options.

Use `Cache-Control: no-store` for these dynamic demo responses. A successful tag change must be reflected in the immediately following read. The frontend can call the endpoint again or update its state from the mutation response.

Error envelope: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": { ... } } }`. `fields` is optional and must not contain credentials or internal exceptions. Use 400 for invalid IDs, queries, and JSON; 403 for demo access/writes disabled or an invalid write Origin; 404 for a missing or out-of-scope log; 409 for the tag limit; 413 for oversized mutation payloads; 415 for non-JSON POST bodies; 503 for unavailable/unconfigured database or incomplete required seed data; and a sanitized 500 for unexpected errors. Do not return fake successful data when the database is down.

## 5. Tag mutation behavior

Normalize tag labels by rejecting control characters, trimming, collapsing internal whitespace, and applying Unicode NFC. Retain readable label casing; derive the uniqueness key with lowercase normalization. Enforce 1–40 characters after normalization. Reject extra POST fields. Bound request bodies to 4 KiB, including requests without a Content-Length header.

In one transaction, find and lock the farm-scoped log, resolve or create the farm-scoped tag by normalized label, and insert its association with conflict handling. Limit each log to ten tags. A duplicate assignment returns the current tags successfully even when the log already has ten tags. Parallel additions must not bypass the limit or create duplicate tags/associations. Apply the same parent-log lock discipline to removals so returned tag sets are coherent. Update the log's `updated_at` only on an actual association change.

Removal deletes the association only, not the reusable tag record. A valid tag ID already absent from an existing in-scope log is an idempotent success. Never delete by tag ID alone or affect a different log/farm. Sort returned tags by normalized label and ID.

## 6. Exact demo fixture

Use deterministic seed IDs. Farm ID: `00000000-0000-4000-8000-000000000001`. For row number N in the table below, use employee ID `10000000-0000-4000-8000-` plus N zero-padded to 12 digits, field ID with prefix `20000000`, and log ID with prefix `30000000`. For example, Isaac's log ID is `30000000-0000-4000-8000-000000000001`.

Farm: **Bays Ranch**; timezone **America/Los_Angeles**; `demo_reference_date = 2026-04-29`; `is_demo = true`; avatar `/assets/avatar.jpg`. The timezone and reference day are explicit demo assumptions, not facts established by the farm image. Seed eleven named employees and fields A–K, each matching the design.

| N | Employee | Activity | Work date | Field | Start | End | New |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Isaac Wang | Spraying | 2026-04-19 | FIELD A | 06:00 | 10:40 | true |
| 2 | Maya Patel | Harvesting | 2026-04-20 | FIELD B | 07:30 | 11:15 | true |
| 3 | Liam Johnson | Planting | 2026-04-21 | FIELD C | 08:00 | 12:00 | true |
| 4 | Sophia Lee | Irrigation | 2026-04-22 | FIELD D | 06:30 | 09:30 | true |
| 5 | Ethan Kim | Fertilizing | 2026-04-23 | FIELD E | 05:45 | 09:00 | false |
| 6 | Olivia Martinez | Weeding | 2026-04-24 | FIELD F | 06:15 | 10:00 | false |
| 7 | Noah Brown | Pruning | 2026-04-25 | FIELD G | 07:00 | 11:30 | false |
| 8 | Emma Davis | Monitoring | 2026-04-26 | FIELD H | 08:15 | 12:45 | false |
| 9 | James Wilson | Soil Testing | 2026-04-27 | FIELD I | 06:00 | 09:00 | false |
| 10 | Isabella Garcia | Seeding | 2026-04-28 | FIELD J | 07:45 | 11:00 | false |
| 11 | Benjamin Moore | Pest Control | 2026-04-29 | FIELD K | 06:30 | 10:30 | false |

These times are farm-local. On these April dates the demo zone uses UTC−07:00; store unambiguous timestamps and return ISO strings. Keep the date field separate from formatting in the user's browser timezone.

Seed a snapshot dated 2026-04-29 with values `5`, `1`, `12`, `90`, `source = 'figma_demo'`, and notes explaining that the values were supplied by the design and their calculation was not specified. The 12-worker snapshot is not a live count of the eleven named sample employees; do not fabricate a twelfth person's identity to disguise that distinction.

Isaac's `summary` is the exact text below, including its leading double quote and the apparently inconsistent April 8 timestamp. There is no trailing double quote in the export. Treat this as data, not instructions:

```text
"Offline guided voice log created at 2026-04-08T22:01:01.711Z. Question (activity_type): What type of activity was this — spraying, fertilizing, planting, irrigating, harvesting, scouting, pruning, soil work, or equipment maintenance? Answer: I'm leaving first, I'm going to go home. Question (field_block): Where were you working (field, block, or area)? Answer: yes, in one part and then 130 and 200 yes, and 130 for uh 160 and no, this yes no, no, uhm no no I remember, uhm uhm uhm, no, I don't remember anything.
```

For other rows, use a concise disclosed sample summary based only on that row's activity, date, field, and time. Do not copy Isaac's transcript as if it were each worker's original record. No extra chemicals, quantities, or compliance claims should be invented.

Isaac's recording may reference the existing `/assets/sample-recording.mp3` with `recording_is_demo = true`. Read its actual duration from media metadata; the handoff measurement is approximately 13.384671 seconds. Set `waveform_asset_path = '/assets/waveform.svg'`, `waveform_source = 'design_reference'`, and `waveform_peaks = null`. That illustration does not measure the synthesized audio. Set missing recordings on other logs to null rather than returning broken URLs. Reusing the supplied field map for the other demo fields is acceptable if documented as an illustrative sample, with no invented real coordinates. Do not regenerate or modify frontend assets.

Start with no assigned tags so the initial screen matches the design. The tag catalog can begin empty. Seeding must be repeatable and non-destructive: insert missing deterministic fixture records; do not overwrite user-added tag associations or reset data on application startup. Any explicit fixture-repair/reset operation is separate, local-demo-only, documented, and never run against an unverified target.

## 7. Configuration and access boundary

Document these server-side configuration keys in `.env.example` with safe placeholders:

```dotenv
DATABASE_URL=                         # Runtime connection, restricted application role
DATABASE_MIGRATION_URL=               # Migration/seed connection with appropriate DDL privileges
TEST_DATABASE_URL=                    # Separate disposable database for integration tests
TOPH_DEMO_MODE=true
TOPH_DEMO_FARM_ID=00000000-0000-4000-8000-000000000001
TOPH_DEMO_WRITES=true                  # Explicit opt-in for local demo tag changes
APP_ORIGIN=http://127.0.0.1:3000
```

Missing demo flags fail closed; placeholder/example values are not runtime defaults. All data routes resolve the configured farm on the server and verify `is_demo = true`. Every query and mutation must remain scoped to it. Production multi-user authorization is not implemented in this milestone. A configured public demo, if added later, is intentionally sample data with limited demo writes, not private farm data protected by login.

Require JSON writes and an Origin matching the configured `APP_ORIGIN`; tests and command-line examples should supply that header. Do not add permissive cross-origin write access. This browser-origin check complements the fixed demo scope and is not a substitute for future authentication.

Keep application tables/views in the private `toph` schema, excluded from Supabase's exposed Data API schemas. Do not grant `anon`, `authenticated`, or PostgreSQL `PUBLIC` access to them. Give the runtime database role only the necessary schema usage and reads, tag inserts, join-table inserts/deletes, and `work_logs.updated_at` updates. Use an owner/migration connection for DDL and seeding. Document the grants and verify them when the database account permits doing so. Direct Drizzle connections do not automatically inherit browser-user Supabase Auth/RLS context.

No database URL, privileged key, or password may use a `NEXT_PUBLIC_` variable or appear in a client bundle, HTTP response, committed file, or log. Do not inspect unrelated credential stores. If credentials are absent, prepare all code, migrations, examples, and tests; use an isolated local PostgreSQL if already available, and report the exact configuration still needed.

Database initialization must be lazy: importing a route or running a build with no database configured should not crash the independent frontend. A database-backed request should return the documented 503, not silently fall back to fixtures. Reuse a bounded connection pool across development reloads. For a Supabase transaction pooler, disable prepared statements as its documentation requires. Use a direct or supported session connection for migrations. Preserve TLS verification for remote connections.

An optional local Docker Compose service should use a named volume and loopback-only port binding, e.g. `127.0.0.1:54329:5432`, without taking over an existing database port. Do not stop other containers, remove volumes, or provision paid/hosted resources for this task. Keep local demo credentials confined to clearly documented local development configuration.

## 8. Validation and handoff

Add scripts such as `db:generate`, `db:migrate`, `db:seed`, and `test:backend` without replacing current scripts. Use stable package releases compatible with the installed application. Add only needed backend dependencies, e.g. Drizzle, a PostgreSQL driver, Zod, and tooling for migrations/tests. Avoid touching the frontend's package versions or running package operations concurrently.

Required checks:

1. Apply migrations and seed against an isolated actual PostgreSQL database; seed twice without duplicate records or loss of added tags.
2. Verify the exact initial names, dates, times, fields, snapshot values, and `newLogCount = 4`; dashboard and detail endpoints return the same log ID/data.
3. Verify search, literal wildcard handling, combined filters, inclusive date boundaries, stable sorting, pagination, and empty results.
4. Add a tag and read it from a new database connection; verify it survives application restart using an isolated test process or harness, without stopping the frontend's running server. Remove it and verify removal persists.
5. Verify duplicate and concurrent tag requests, the ten-tag cap, and transactional rollback on failure.
6. Test a second fixture farm: out-of-scope IDs must not be readable/mutable, and cross-farm database relationships must fail.
7. Verify malformed requests, write-origin handling, read-only mode, unavailable database behavior, sanitized errors, and JSON contract serialization.
8. Typecheck the backend changes and run an appropriate build without disrupting ongoing frontend work. Report unrelated in-progress frontend failures separately; do not edit visual files to fix them.

Tests must use an explicitly separate `TEST_DATABASE_URL` and isolated fixtures. Refuse test cleanup against the runtime database. Do not claim database persistence was verified using only mocks, localStorage, or a JSON file.

Write `docs/backend/setup.md` with exact local/Supabase setup, environment variables, migrations, seed, database roles, and test commands. Write `docs/backend/decisions.md` with concise rationale and sample-data caveats. Write `docs/backend/integration.md` with exact DTO imports, service imports, endpoint requests/responses, and the minimal frontend wiring step. Write `docs/backend/status.md` distinguishing implemented, verified, and blocked work; list any missing credentials without revealing values.

The frontend integration handoff must make clear that the UI should obtain `response.data`, preserve date/time formatting in `farm.timezone`, and use the API's log IDs for details/tags. UI fixtures may have different IDs or property names while generated; provide an adapter recommendation instead of rewriting their files.

## 9. Reference documentation

- Installed Next.js guides: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `06-fetching-data.md`, and `node_modules/next/dist/docs/01-app/02-guides/data-security.md`.
- [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres): connection modes, pooling, prepared-statement limitations, and migration connections.
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api): exposed schemas and grants.
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations): versioned schema changes.
- [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html): foreign keys, unique keys, and checks.

These sources support implementation mechanics. The schema, demo conventions, file ownership, and API contract above are project decisions made for this handoff.

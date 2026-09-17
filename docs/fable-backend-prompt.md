You are implementing the database and backend for Toph in `/Users/peter/Desktop/Toph`. Another agent is actively building the React frontend in the same workspace. Complete the backend independently without disrupting that work.

First read `AGENTS.md`, `docs/project-context.md`, and `docs/backend-spec.md` in full. Also read `docs/architecture.md` and `docs/design-review.md` for rationale and source context. Follow the installed Next.js guides under `node_modules/next/dist/docs/` before writing Next.js code; this project uses a recent version with changed APIs. Inspect the current workspace before editing because the frontend agent may have added files since this prompt was written.

PROJECT GOAL

Toph is an interview-submission dashboard for farm activity logs. The user approved an interview demo with persistent sample data. The finished app must reproduce the supplied Figma and have backend data reflecting the shape of the data displayed on the page. Every employee-log row must correspond to a stored record, and its expanded summary, audio, map reference, and tags belong to that same log ID. Real database persistence is required. Deployment is a later phase; keep this work local.

APPROVED STACK

Use the existing Next.js App Router application, React, TypeScript, PostgreSQL, and Drizzle. Supabase is the intended managed PostgreSQL host; an isolated local PostgreSQL instance is fine for development and verification. Use Next.js Route Handlers over server-only service functions. Preserve npm and the existing framework versions. Do not switch to Firebase, SQLite, a JSON-file database, a separate Express app, or a different starter.

YOUR OWNERSHIP

You own `src/server/**`, `src/contracts/**`, `src/app/api/**`, `drizzle/**`, `drizzle.config.ts`, `scripts/db/**`, `tests/backend/**`, `compose.db.yaml`, `.env.example`, and `docs/backend/**`.

Do not edit `src/components/**`, `src/lib/**`, the page/layout, styles, `public/**`, or `design/reference/**`. The frontend agent owns those files. Do not overwrite unrelated changes, reset git state, delete build output, stop the existing localhost server, or restart the app to perform your tests. If necessary, run an isolated test process on a different available port and stop only the process you started.

You may minimally add backend dependencies and scripts to `package.json` and refresh `package-lock.json`. Re-read them before editing, preserve existing versions/scripts, and wait if another package installation is active. Do not change shared Next.js or TypeScript configuration without a concrete blocker; report any required shared change for coordination.

IMPLEMENTATION

1. Implement the private `toph` PostgreSQL schema specified in `docs/backend-spec.md`: farms, employees, fields, work_logs, tags, work_log_tags, dashboard_metric_snapshots, and the one-row-per-log dashboard_logs view. Use versioned Drizzle/SQL migrations, appropriate indexes, constraints, and composite foreign keys that prevent relationships across farms.

2. Implement contract v1 in `src/contracts/dashboard.ts` exactly as specified. Keep that module browser-safe. The backend must return employee, activity, date, field, start/end times, summary, recording metadata, and tags in the page-shaped DTO. HTTP responses use `{ data: ... }`, with the specified dashboard metadata. Do not serialize database internals or secrets.

3. Implement GET `/api/dashboard`, GET `/api/logs/:logId`, GET `/api/tags`, POST `/api/logs/:logId/tags`, DELETE `/api/logs/:logId/tags/:tagId`, and GET `/api/health`. Include the documented filtering, sorting, pagination, validation, status codes, and no-store behavior. Put domain operations in reusable server-only services, not duplicated route logic.

4. Seed Bays Ranch and all eleven exact reference rows from the specification, with deterministic UUIDs. Preserve April 2026 dates and the four-new-log convention. Seed the supplied 5 / 1 / 12 / 90 KPI values as an attributed `figma_demo` snapshot, not as invented live calculations. Preserve Isaac's provided summary exactly. The default four visible rows are a frontend viewport choice, not a backend result limit.

5. Reference the existing assets without modifying them. The MP3 is a synthesized demo clip, not an original farm recording. The waveform SVG is a design illustration, not measured audio peaks. Preserve that distinction in metadata and documentation. Missing recordings must be null, not broken URLs or fabricated media. Do not invent real field coordinates or chemical-use facts.

6. Make tagging persist in PostgreSQL. Normalize labels, prevent case-insensitive duplicates, use transactions and row locking, enforce the ten-tag limit under concurrency, and make duplicate adds/removals idempotent as specified. Do not reseed or reset saved user changes when the app starts or a request arrives.

7. Resolve the demo farm on the server. Require explicit demo configuration and verify the farm is marked as demo. Scope every query/mutation. Keep the private schema inaccessible through Supabase's public Data API, and document a restricted runtime role separately from migration privileges. Keep credentials server-only. This is a sample-data demo, not a production multi-user auth implementation.

8. Initialize database connections lazily so missing credentials do not break the frontend build or page. Database-backed requests must fail honestly with sanitized 503 errors when unavailable; do not silently substitute mock persistence. Use a bounded reusable pool and the appropriate Supabase connection settings.

CONFIGURATION AND TESTING

Provide safe `.env.example` placeholders and exact setup commands. If an isolated local PostgreSQL runtime is available, use it without disturbing existing databases, containers, ports, or volumes. Otherwise implement everything possible and clearly report the missing database connection. Do not provision hosted resources, deploy, or request unrelated credentials.

Test against actual PostgreSQL when available. Cover migrations, repeatable seeding, exact fixture output, matching dashboard/detail IDs, search/filter/sort/date/pagination behavior, persistent tags across new connections and an isolated process restart, concurrent duplicate tags and limits, cross-farm denial/constraints, and invalid input/error paths. Tests must use a separate `TEST_DATABASE_URL` and must never reset the runtime database. Distinguish verified database behavior from unrun tests or mocks.

Add useful database/test scripts without replacing current scripts. Typecheck your changes and validate the build when feasible. If the concurrently edited frontend causes unrelated failures, report them separately and leave its files alone.

HANDOFF

Write `docs/backend/setup.md`, `docs/backend/decisions.md`, `docs/backend/integration.md`, and `docs/backend/status.md`. Include exact contract/service import paths, endpoint examples, seed/test commands, completed checks, and remaining configuration. Inspect the frontend fixture shape read-only and describe any minimal adapter needed; do not wire or redesign the UI yourself while it is being generated.

Proceed with implementation, not just another plan. Complete the work possible within this backend scope. In your final response, distinguish what is implemented, what was verified against PostgreSQL, what the frontend agent needs to connect, and any specific blocker. Never claim persistence or hosting is complete without verifying it.

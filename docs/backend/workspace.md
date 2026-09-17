# Workspace pages backend

The September 16 request expands the dashboard into working sidebar pages. `/api/workspace`
stores their editable data in actual PostgreSQL. It runs locally with the existing Next.js
server and the trusted farm context (`TOPH_FARM_ID`). There is no deployment or external message delivery.

## Contract

Browser-safe types are in `src/contracts/workspace.ts`. The dashboard contract is documented
in `integration.md`. `GET /api/workspace` responds with `{ data: WorkspaceState, revision: number }` and
`Cache-Control: no-store`.

`WorkspaceState` has seven sections: `employees`, `schedule`, `reviews`, `reports`, `messages`,
`tickets`, and `settings`. A write replaces only the supplied sections:

```ts
const response = await fetch("/api/workspace", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    expectedRevision: current.revision,
    patch: { settings: { ...current.data.settings, contactName: "Ranch Admin" } },
  }),
});
```

Successful writes return the entire committed state and incremented revision. An outdated
revision returns 409 with `error.code = "REVISION_CONFLICT"`; reload the latest state and let
the user retry instead of automatically replaying a stale whole-section replacement. The
server locks the farm's row for each write. Multiple section changes can be committed together.

PATCH requires the same `APP_ORIGIN` origin check as tag writes. Both
methods reject query parameters; no request field can choose a different farm. Errors use the
existing `{ error: { code, message, fields? } }` envelope. JSON body limit: 512 KiB. Each section
has bounded arrays/text lengths, and the whole workspace is capped at 1 MiB. Invalid IDs,
duplicate IDs, unknown keys, invalid dates/timezones, backwards report periods, and reversed
assignment times return 400. Schedule times are same-day `HH:mm`; overnight assignments are
outside this contract.

## Persistence and relationships

Versioned migration `drizzle/0001_workspace_state.sql` adds `toph.workspace_state`, one row per
farm with a JSONB payload, integer revision, timestamps, foreign key, and size/type checks.
Run the existing `npm run db:migrate`; it also grants the restricted app role insert and
column-scoped updates on this table. It cannot delete workspace rows, change their farm IDs,
or write original employee/log/field/metric records.

First GET initializes the workspace transactionally if the farm has no row. Concurrent first
reads use `ON CONFLICT DO NOTHING`, and subsequent requests never reseed or overwrite edits.
Ordinary reads of existing workspaces do not mutate it. The employee and field IDs are read
from PostgreSQL during bootstrap.

Historical employees must remain in the roster and can be archived with `status: "Inactive"`.
New employees use new UUIDs and may be referenced immediately by assignments and messages.
Assignments reference a workspace employee and an existing farm field. Reviews reference an
existing farm log. Messages reference a workspace employee. IDs belonging to another farm's
original employee records are rejected.

Profile/settings changes are workspace overlays that preserve the underlying employee and
log records. Frontend pages should use the
workspace roster/settings to display edits. The existing `/api/dashboard` remains unchanged;
the frontend can overlay edited employee names and farm settings when displaying live data.

The JSONB aggregate is a deliberate bounded design: it matches the page sections and allows
one atomic revision. The core logs stay normalized relational records. A production
multi-user product would split high-volume messages, assignments, and tickets into their own
tables and expose narrower, authorized mutation operations.

## Initial workspace state

- The eleven employee IDs/names come from the farm's employee records.
- Roles default to `Farm worker`, join dates to `2026-04-01`, and three assignments dated
  April 29/30 plus notification preferences are created on first read. Contact fields begin blank.
- Two incoming messages are created on first read.
- Reviews, saved report definitions, and support tickets start empty. Pending is a frontend
  default for logs without a stored review.
- Saved reports store their definition/date range; export contents are generated from farm
  logs by the frontend.
- Message and support actions save database records only. No email, SMS, push, ticketing
  system, or external recipient is contacted. Notification settings store preferences only.

## Verification performed

Applied the additive migration to the existing local PostgreSQL database without reseeding or
resetting any live data. Live `GET /api/workspace` returned 11 employees, 3 assignments,
2 messages, and revision 0 after initialization. A live PATCH saved the current settings
unchanged, a subsequent GET observed revision 1, and replaying revision 0 correctly returned
409. No temporary test records were inserted into the live workspace.

The workspace tests in `npm run test:backend` use the separate guarded test database and cover
concurrent initialization, durable writes across new connections, revision races/conflicts,
section edits, new employees, original-record preservation, cross-farm/orphan rejection, strict
validation, HTTP origin and size rules, no-store envelopes, and restricted-role permissions. `npm run typecheck`
also passed after these changes.

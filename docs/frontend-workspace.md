# Frontend workspace

The September 16, 2026 request expanded the Figma dashboard into working pages for every
sidebar destination. This document describes that implementation and supersedes the earlier
dashboard-only frontend preview. Run on [localhost](http://127.0.0.1:3000) during development;
see [Vercel deployment](deployment.md) for hosted settings. Production authentication is not
implemented.

## Pages and controls

| Route | Implemented behavior |
| --- | --- |
| `/` | Original dashboard composition; search, sorting, filtering, selection, expanded records, attached audio playback, persistent tag addition/removal, enlarged map, and metric-card navigation. |
| `/activity-logs` | Full activity list with the same record details; `?log=<UUID>` opens a specific entry. |
| `/map` | Field search/selection, reference-image zoom/enlargement, activity totals, and links to related logs; accepts `?field=<UUID>`. |
| `/audit-manager` | Search/filter reviews, inspect summaries, and save Pending/Approved/Flagged decisions with notes. |
| `/reports` | Activity, compliance, and hours CSV exports; save report definitions, search, download again, or delete them. |
| `/schedule` | Calendar/list views, month and employee filters, assignment creation/editing, completion/reopening, and deletion. |
| `/employees` | Search/filter profiles, view related work, add/edit details, set Active/Inactive status, and open conversations. |
| `/performance` | Date-filtered recorded hours, activity chart, sortable employee breakdown, and CSV export. |
| `/messages` | Employee conversations, persistent read state, saved messages, and per-conversation drafts; accepts `?employee=<UUID>`. |
| `/settings` | Farm/admin details, display timezone, and stored notification preferences. |
| `/support` | Searchable help articles plus saved requests that can be opened, closed, and reopened. |
| `/switch-user`, `/login` | Select a shared farm account; Log Out clears the selected browser session and opens the profile-entry page. |

The shared sidebar keeps the original design assets and links the profile to Settings and
inbox to Messages. New destinations extend the dashboard's typography, spacing, rounded
panels, and restrained colors; the supplied Figma defines the dashboard states, not these
additional page designs.

## Data flow

Dashboard filter update (September 16, 2026): Activity and Field use styled, keyboard-accessible
select controls with green selection states. The date pill opens Today, This Week, This Month,
Last Month, All Time, and an inclusive custom range. Its × clears only the date restriction.
Relative presets use `metrics.asOf`, the backend's farm business date; weeks run Monday–Sunday.
When no records fall in the current month, the initial filter uses the latest recorded month
and names it explicitly (currently April 2026). The Figma-only comparison fixture has a fixed
April reference date, so its original This Month resting state remains unchanged.

Menus fit the viewport and support keyboard navigation, Escape, and outside-click dismissal.
Date-boundary tests run with `npm run test:frontend`.

`WorkspaceProvider` loads `/api/dashboard?period=all` and `/api/workspace`. The live pages do
not substitute fixture data if PostgreSQL is unavailable; they show an error with a retry action.

- Dashboard contract v2 is in `src/contracts/dashboard.ts`. A collapsed row, expansion,
  review, and deep link use the same stored log UUID. Tags use the existing POST/DELETE log-tag
  endpoints, and the UI adopts the committed tag list returned by the server.
- Workspace types are in `src/contracts/workspace.ts`. Employees, schedule, reviews, reports,
  messages, tickets, and settings persist through `PATCH /api/workspace` with
  `{ patch, expectedRevision }`. Provided sections replace their previous values; successful
  responses return `{ data, revision }`.
- The provider serializes saves within the browser. On a 409 revision conflict it fetches the
  latest state, preserves the unsaved form for the user, and asks them to save again. It does
  not silently overwrite another session's committed revision.
- Employee names and farm settings are display overlays on original reference records. The
  provider applies those edits across pages. Display timezone affects rendered work times;
  original business dates and stored timestamps remain intact.
- The provider re-reads both APIs in the background every two seconds while the tab is
  visible (a phone log, a profile or photo edit, another browser's save) and immediately on
  focus or reconnect; reads never overlap. These reads never show the
  loading state, so filters, sort, the open row, scroll position, dialogs, and unsaved form
  drafts stay as they are; a short notice names what arrived. Because the background read
  also advances the known revision, a save made afterwards is accepted instead of answering
  409: item-level updates merge into the latest roster, while a draft of the *same* item or
  of Settings still replaces what was there (the notice is the warning in that case). The
  409 path above remains for a save that races a change not yet received.
- All logs are loaded by following `meta.pagination.hasMore` (100 per request). Employee
  photos set in the mobile app come from `log.employee.avatarUrl` and replace initials on the
  team pages.

See [backend integration](backend/integration.md) and [workspace backend](backend/workspace.md)
for validation limits, exact envelopes, configured farm scope, permissions, and schema decisions.
Workspace JSONB state is a bounded aggregate with optimistic revision checking; the core
activity logs and their employee/field/tag relationships remain normalized in PostgreSQL.

## Shared workspace boundaries

- Browser storage holds only the selected farm account. All profiles share the farm's data
  and permissions. This is not authentication, authorization, an invitation flow, or a
  secure logout from a private account.
- Messages and support requests save local records only. No email, SMS, external support
  service, or recipient is contacted. Notification controls persist preferences without
  scheduling external delivery.
- The same original map image illustrates multiple fields. Zoom enlarges the image; it is
  not a live map provider or geospatial field editor.
- Seeded logs reference synthesized sample audio; the waveform is the original design
  illustration, not measured audio data.
- Live dashboard metrics are computed from stored records; response accuracy is unset. The
  development-only fixture preserves the 5 / 1 / 12 / 90 Figma values. Performance computes
  durations from stored logs, not payroll or worker productivity. Supplemental roster details,
  assignments, and incoming messages are synthetic fixtures documented by the backend.
- Saved reports store export settings. Each download uses the currently loaded matching logs
  and reviews rather than a frozen historical report file. Message drafts, filters, and open
  dialogs are transient interface state.

## Setup, ownership, and review

Use the [README](../README.md) and [database setup guide](backend/setup.md). Keep
`APP_ORIGIN=http://127.0.0.1:3000` aligned with the browser address for writes. Reuse the
running local server; migrations and first-read workspace initialization are additive and
do not reset existing user data.

Frontend routes live under `src/app/(workspace)/`; components/styles are in
`src/components/workspace/` and `src/components/dashboard/`. Backend services,
validation, grants, API handlers, and migrations remain server-owned. Browser components
import shared types and call HTTP endpoints; they never import database clients. Concurrent
work must preserve these boundaries and existing package versions.

The fixture in `src/fixtures/dashboard.ts` remains for development-only visual comparisons:
`/design-check?view=default` and `/design-check?view=expanded`, with `&overlay=off` optional.
Use the original 1676 × 955 viewport. Those comparison routes are isolated from persistent
workspace pages and disabled outside development. They retain the earlier preview's scope.

Run `npm run typecheck` and `npm run build` for static/build checks. `npm run test:backend`
exercises actual PostgreSQL using the separate guarded test database. Backend verification
results are recorded in [workspace backend](backend/workspace.md); this document makes no
claim of a completed browser test for every new page or control.

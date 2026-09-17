# Dashboard API integration

How the UI connects to the backend. The sidebar pages use `GET` / `PATCH /api/workspace`; see
[workspace.md](workspace.md). This file covers the dashboard contract, now **v2**.

## Accounts and farm scope (September 17)

HTTP reads and writes now require a server session. Admins obtain an HttpOnly cookie via
`/api/auth/login`, `/api/auth/signup`, or the explicit `/api/auth/demo` entry. The session
selects the farm; unauthenticated requests no longer default to Bays Ranch. Native worker
sessions use bearer tokens and cannot call admin dashboard/workspace APIs. See
[accounts](accounts.md) for signup, invites, setup, and deployment details.

`DashboardFieldDto` optionally includes normalized `boundary` points and `mapImageUrl`,
including fields with no logs. New-farm clients use these saved field shapes, not the sample
farm's illustrated regions. Opening a new-farm log calls `POST /api/logs/:logId/review`;
its `isNew` state then remains false across sessions. The demo keeps its sample flags and
uses explicitly identified reference card values in the web adapter. New farms use computed
metrics and count their admin once.

## What changed in contract v2

The demo framing was removed from the data model. Frontend code compiled against v1 needs
these adjustments:

- `LogDto.recording` no longer has `isDemo` or `waveformSource`. It is `{ url, durationSeconds,
  waveformAssetUrl, waveformPeaks } | null`, and every log in the initial dataset has one.
  The dashboard adapter and display types have been updated to omit those removed fields.
- `metrics` no longer has `source`. Values are computed from the data as of today in the farm
  timezone: `recordingsToday` and `newRecordings` count today's logs, `activeWorkers` counts
  active employees plus the farm's separate administrator account, and `responseAccuracy` is `null` until a measured source exists (the card
  already renders a dash for null).
- `meta` no longer has `mode` or `demoReferenceDate`; `meta.contractVersion` is `"2"`.
- Additive: `LogDto.employee` now carries `avatarUrl: string | null` (the employee's image, from
  `employees.avatar_path`; null until one is set).
- Periods are `all` (default), `this-month` (the real current calendar month in the farm
  timezone), and `custom`. `demo-month` is rejected with 400. The provider already requests
  `period=all`, which is now also the default.

## Contract types

```ts
import type {
  DashboardResponse, // GET /api/dashboard: { data: DashboardData, meta: DashboardMeta }
  DashboardData,
  DashboardMeta,
  DashboardQuery,
  LogDto,
  TagDto,
  LogResponse, // GET /api/logs/:logId: { data: LogDto }
  TagsResponse, // GET /api/tags: { data: TagDto[] }
  LogTagsResponse, // POST/DELETE tag routes: { data: { logId, tags } }
  AddTagRequest, // { label: string }
  ApiErrorResponse, // { error: { code, message, fields? } }
} from "@/contracts/dashboard";
```

`src/contracts/dashboard.ts` is browser-safe. Every successful response wraps its payload in
`data`; read `response.data`, not the response root.

## Server-side use

Server Components and Server Actions can call the services directly. These modules are
`server-only`; never import them from a `"use client"` file.

```ts
import { resolveFarmContext } from "@/server/farm-context";
import { getDashboard, getLog, listTags } from "@/server/services/dashboard";
import { addLogTag, removeLogTag } from "@/server/services/tags";
import { isApiError } from "@/server/errors";
```

```tsx
export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const ctx = await resolveFarmContext();
    const { data, meta } = await getDashboard(ctx); // same result as GET /api/dashboard
    return <Dashboard data={data} meta={meta} />;
  } catch (error) {
    if (isApiError(error)) return <DatabaseUnavailable code={error.code} message={error.message} />;
    throw error;
  }
}
```

`getDashboard(ctx, query)` accepts a `DashboardQuery` object and returns `{ data, meta }`.
`getLog(ctx, id)` returns a `LogDto`. Mutations return `{ logId, tags }`. All throw `ApiError`
(`status`, `code`, `message`, `fields`).

## HTTP endpoints

Base URL during development: `http://127.0.0.1:3000`. Every response carries
`Cache-Control: no-store`; use `fetch(url, { cache: "no-store" })` on the client.

### GET /api/dashboard

Query parameters (all optional): `q`, repeatable `activity`, repeatable `fieldId`, `period`
(`all` default, `this-month`, `custom` with `from` and `to`), `sort` (`date-asc` default,
`date-desc`, `employee-asc`, `activity-asc`), `limit` (1–100, default 50), `offset`
(0–100000). Unknown parameters are rejected.

```bash
curl -s "http://127.0.0.1:3000/api/dashboard?q=isaac&sort=date-desc"
```

```json
{
  "data": {
    "farm": { "id": "00000000-0000-4000-8000-000000000001", "name": "Bays Ranch", "avatarUrl": "/assets/avatar.jpg", "timezone": "America/Los_Angeles" },
    "metrics": { "recordingsToday": 0, "newRecordings": 0, "activeWorkers": 12, "responseAccuracy": null, "asOf": "2026-09-16" },
    "newLogCount": 1,
    "logs": [
      {
        "id": "30000000-0000-4000-8000-000000000001",
        "employee": { "id": "10000000-0000-4000-8000-000000000001", "name": "Isaac Wang", "avatarUrl": null },
        "activity": "Spraying",
        "date": "2026-04-19",
        "field": { "id": "20000000-0000-4000-8000-000000000001", "name": "FIELD A", "mapImageUrl": "/assets/field-map.svg" },
        "startAt": "2026-04-19T13:00:00.000Z",
        "endAt": "2026-04-19T17:40:00.000Z",
        "summary": "\"Offline guided voice log created at 2026-04-08T22:01:01.711Z. ...",
        "isNew": true,
        "recording": { "url": "/assets/sample-recording.mp3", "durationSeconds": 13.384671, "waveformAssetUrl": "/assets/waveform.svg", "waveformPeaks": null },
        "tags": [],
        "updatedAt": "2026-09-16T23:40:12.345Z"
      }
    ],
    "filterOptions": {
      "activities": ["Fertilizing", "Harvesting", "Irrigation", "Monitoring", "Pest Control", "Planting", "Pruning", "Seeding", "Soil Testing", "Spraying", "Weeding"],
      "fields": [{ "id": "20000000-0000-4000-8000-000000000001", "name": "FIELD A" }]
    }
  },
  "meta": {
    "contractVersion": "2",
    "filters": { "q": "isaac", "activities": [], "fieldIds": [], "period": "all", "dateRange": null, "sort": "date-desc" },
    "pagination": { "total": 1, "limit": 50, "offset": 0, "hasMore": false }
  }
}
```

With no query, all eleven logs arrive in one response (`total: 11`) and `newLogCount` is `4`.
Filtered and unfiltered result lists use the available screen space; do not pass `limit=4`
or constrain the table to four visible rows. `newLogCount` is separate from the total matching count.

### GET /api/logs/:logId

`{ data: LogDto }`, exactly the object the dashboard listed for that ID.

### GET /api/tags

`{ data: TagDto[] }`, the farm's catalog sorted by normalized label.

### POST /api/logs/:logId/tags

Body `{ "label": "Needs review" }` (JSON only, at most 4 KiB, no other fields). Requires an
`Origin` header matching `APP_ORIGIN`; browsers add it automatically to `fetch` `POST`
requests, so the app must be opened at `http://127.0.0.1:3000` unless `APP_ORIGIN` is changed.

```bash
curl -s -X POST http://127.0.0.1:3000/api/logs/30000000-0000-4000-8000-000000000001/tags \
  -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  -d '{"label":"Needs review"}'
```

```json
{ "data": { "logId": "30000000-0000-4000-8000-000000000001", "tags": [{ "id": "…", "label": "Needs review" }] } }
```

### DELETE /api/logs/:logId/tags/:tagId

Same `Origin` requirement. Removes the association only and returns the remaining tags.
Removing a tag that is already absent is a `200`.

### GET /api/health

`{ "data": { "status": "ok", "database": "connected" } }` after a real database round trip,
otherwise a `503` error envelope.

### Errors

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Bad query, ID, JSON, label, or extra body fields (`fields` names them) |
| 403 | `FORBIDDEN` | Missing or mismatched `Origin` on a write |
| 404 | `NOT_FOUND` | Log not in the configured farm |
| 409 | `TAG_LIMIT_REACHED` / `REVISION_CONFLICT` | Ten tags already / stale workspace revision |
| 413 | `PAYLOAD_TOO_LARGE` | Body over the limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` is not `application/json` |
| 503 | `DATABASE_UNAVAILABLE` / `NOT_CONFIGURED` | Database missing or unreachable / farm not configured or not in the database |
| 500 | `INTERNAL_ERROR` | Unexpected failure (sanitized) |

## Client-side mutation example

```ts
import type { LogTagsResponse, ApiErrorResponse } from "@/contracts/dashboard";

export async function addTag(logId: string, label: string) {
  const response = await fetch(`/api/logs/${logId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
    cache: "no-store",
  });
  const body = (await response.json()) as LogTagsResponse | ApiErrorResponse;
  if (!response.ok || "error" in body) throw body;
  return body.data.tags; // authoritative committed list
}
```

Local prerequisites for the UI to see data: the Docker database is running (`npm run db:up`),
`.env.local` exists, and `npm run db:migrate` plus `npm run db:seed` have been run
(`setup.md`). `GET /api/health` confirms it.

## Messaging

The web Messages page and native Inbox tab use authenticated two-way messaging. See
[worker inboxes](messages.md) for the narrow send/read APIs, recipient scope, five-second
foreground refresh, read receipts, and limits. `messages` is read-only through
`/api/workspace`; use `/api/messages` or `/api/mobile/v1/messages` to send.

## Mobile

The native app uses the canonical `/api/mobile/v1` routes for the shared farm's accounts,
profile edits, recordings, and log sync. These write the same PostgreSQL records this
dashboard reads. [Recording processing](transcription.md) returns speech and typed form
suggestions; it saves no work log until the worker confirms Save. See the [mobile API](mobile.md)
and [system map](../system-map.md). The web's existing write-origin check remains in place.

### Administrator photo

`WorkspaceSettings.adminAvatar` is an optional nullable JPEG data URL, saved through
the existing revision-checked workspace settings API in PostgreSQL. The settings
page crops and resizes uploads to 256×256 and caps the encoded photo at 150,000
characters. The server limits size, encoding and JPEG signatures. No migration is
needed for this optional JSONB field. Missing or removed photos use the gray
`/assets/avatar-default.svg` in both workspace navigation and dashboard adaptation.

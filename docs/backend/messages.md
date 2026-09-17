# Worker inboxes

The website's Messages page and the native app's Inbox tab share persisted, two-way
conversations. Each conversation connects the farm administrator with one worker. Workers
see only their own conversation; admins see their farm's conversations. This also works
before the admin finishes setting up fields. Inactive accounts cannot receive new messages
or access the inbox; existing history is retained.

## Delivery without APNs

Messages are saved in PostgreSQL before a send succeeds. Both clients fetch the authenticated
inbox every five seconds while visible/active and catch up on focus, app resume, or reconnect.
The native tab and web navigation show unread counts. Opening a conversation acknowledges
only the incoming message IDs the client actually fetched. The sender sees Sent / Read.
Failures retain the unsent composer text while the workspace remains mounted; drafts are
not a background outbox and are not promised to survive terminating the app.

No webhook, APNs, Expo notification service, new package, or device permission is needed.
There are no lock-screen banners, OS badges, sounds, or notifications while the app is closed.
A webhook is a server-to-server callback; it would not deliver a closed-app iOS notification.
APNs could be added later to alert workers to new persisted messages without replacing this
inbox. Private message content never enters the sample farm's Supabase broadcast channel.

## HTTP contract

Browser-safe DTOs: `src/contracts/messages.ts` and `Message` in `src/contracts/workspace.ts`.
All successful responses are `{ data: { messages: Message[], revision: number } }` with
`Cache-Control: no-store`. The revision is the farm workspace revision; clients ignore older
snapshots. Worker responses contain only that worker's messages and no roster/settings.

| Admin route | Worker route | Request |
| --- | --- | --- |
| `GET /api/messages` | `GET /api/mobile/v1/messages` | No query parameters |
| `POST /api/messages` | `POST /api/mobile/v1/messages` | `{id, employeeId, body}` |
| `POST /api/messages/read` | `POST /api/mobile/v1/messages/read` | `{employeeId, messageIds}` |

Admin routes require the web admin session; worker routes require the mobile worker session.
Writes keep the existing browser origin / mobile client checks. The worker's employee ID
must match their session. The server derives farm, sender, creation time, and read timestamp;
clients cannot supply those properties. Admin sends require an active worker account in the
same farm. Messages cannot be replaced, removed, or forged through `PATCH /api/workspace`.

Send IDs are client UUIDs used for retries. The same ID, recipient, sender and trimmed body
return the original committed message, retaining its time and read status. Changed content
under an existing ID returns `409 MESSAGE_CONFLICT`. Read acknowledgements are idempotent
and reject outgoing, missing, or other-conversation IDs. A newer message arriving during an
acknowledgement remains unread.

## Persistence and existing data

This bounded implementation uses the existing `toph.workspace_state` JSONB column in actual
PostgreSQL. A transaction locks the farm row and appends messages or marks specific IDs read;
it preserves all other sections and increments the revision. Simultaneous sends require no
client revision and cannot overwrite each other. Whole-section workspace edits retain their
existing optimistic revision check. Limits remain 4,000 characters per message, 2,000 messages
per farm, and 1 MiB total workspace storage. A full workspace fails explicitly and retains the
composer draft. Higher-volume use should move messages into a separate paginated table.

No messaging migration or additional database grants are necessary on an account-enabled
installation. Existing conversations and sample message text/dates are preserved. The earlier
admin-only composer used `read: true` to mean saved; legacy outgoing messages without a
`readAt` timestamp are treated as unread until the worker acknowledges them. New sends use
`read: false, readAt: null`; recipient acknowledgement stores the server timestamp.

Development remains local. The hosted backend and installed phone build need the updated
code before they expose these inbox routes/UI. Existing account migration 0008 and mobile
access configuration are still prerequisites; see [accounts](accounts.md). No messaging
deployment was performed.

## Verification

`tests/backend/integration/messages.test.ts` uses the guarded, separate PostgreSQL test
database, including the restricted runtime role. It covers cross-connection persistence,
two-way delivery, concurrent sends, duplicate retries, private farm/worker scope, role and
origin validation, deactivation, recipient-only reads, legacy flags, and preservation of
unrelated workspace edits. Native hook/component tests cover foreground polling, reconnect,
out-of-order responses, read retries, failed-send drafts, and edits during a slow send.

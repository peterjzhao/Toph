# Recording transcription and form filling

`POST /api/mobile/v1/transcriptions` processes a recording in two steps:

1. OpenAI `gpt-4o-transcribe` returns the speech as text.
2. OpenAI `gpt-4.1-mini` uses strict Structured Outputs to extract the work-log fields.

The shared Zod schema is `extractedLogSchema` in `src/contracts/transcription.ts`.
`ExtractedLogFields` is inferred from that schema, the TypeScript equivalent of a validated
Python dataclass/Pydantic model. It contains field ID, activity, work date, start/end times,
notes, product, amount, unit, and tags. Field IDs come from the configured farm's database;
activities, units, and tags share the native form's vocabulary in `src/contracts/recording.ts`.

Missing or ambiguous facts are null. The model must not invent times, field identities,
products or doses. Relative dates use the supplied reference date and the farm timezone.
The server validates the output again, including the field catalog and calendar date.
The worker reviews and edits the suggestions before Save log. Explicit edits win over
later AI suggestions, including appended recordings; a spoken correction can clear an
earlier automatic suggestion. No work log is created by the processing endpoint.

## Setup

Set these server-only values in root `.env.local` for local testing and in Vercel Production
for the hosted app:

```dotenv
OPENAI_API_KEY=your-project-api-key
TOPH_TRANSCRIPTION_ENABLED=true
TOPH_MOBILE_ENABLED=true
```

Keep `.env.local` ignored. Never put the OpenAI key in mobile environment variables or
`NEXT_PUBLIC_*`. A separate bundled transcription token is no longer used. Apply migration
`0006_recording_processing.sql` with the migration runner and run `npm run db:enable-mobile`.
The application uses the restricted database role, not the schema owner.

The farm has a shared allowance of 12 processing requests per minute and 120 per UTC day,
including failed provider attempts and extraction retries. Atomic PostgreSQL counters
apply across Vercel instances. This bounds usage for the explicitly chosen shared-account
application; it does not add user sign-in. The flag is a separate opt-in for paid AI calls.

## Request and response

Initial request is multipart `file` plus JSON `context` containing `accountId`,
`referenceDate` (`YYYY-MM-DD`), and optional `previousTranscript`. Audio is limited to 3.8 MB
and checked for supported MIME/container signatures before forwarding. Supported formats:
M4A/MP4, MP3, WAV, WebM. Uploads live only in request memory.

Response is `{ data: { text, transcript, fields, missingFields, extractionError } }`.
`text` is this clip's speech; `transcript` combines all clips in order. `fields` is the
validated object, or null if extraction failed. An extraction failure retains successful
speech. The client can retry with JSON `{ context, transcript }` to run extraction alone,
without uploading or transcribing completed audio again. Errors and responses are no-store.

The app applies suggestions only to untouched fields. Appending audio re-extracts one work
log from the entire transcript. Cancel aborts the request and retains audio/completed text;
stale responses cannot change another draft or account. Raw audio is saved to PostgreSQL
only by the separate log-save endpoint. Extraction uses `store: false` with OpenAI Responses.

## Testing

- `npm run test:unit` checks provider requests, schema validation, malformed/oversize uploads,
  configuration, refusals, incomplete results, cancellation and sanitized errors.
- `npm run test:backend` requires the guarded disposable test database and checks real
  persistence and distributed limits. Provider responses in that suite are mocked.
- In `mobile/`, `npm test -- --runInBand` checks all-category form filling, manual edits,
  spoken corrections, append/retry, and transcript retention after extraction failure.
- After deployment and key configuration, run
  `npm run check:recording -- public/assets/sample-recording.mp3` to call the live hosted
  endpoint. The sample is synthesized speech identified in the repository, not a private
  farm recording. The script prints the transcript and fields and does not save a work log.
  Pass another audio path, and optionally another server origin, to test your own recording.

A missing key is a real test blocker; passing mocked tests must not be described as a live
OpenAI verification. See [architecture](../system-map.md) for how the two apps share a server.

## Verification recorded September 16, 2026

The production Next.js build and both TypeScript checks pass. Backend tests pass against
the separate local PostgreSQL test database, including atomic quotas, field validation,
transcript retention, extraction retries, and legacy mobile receipts. Native tests pass,
including filling every category in the actual review form and preserving worker edits.
The updated iOS Release binary built and installed on the connected iPhone.

Supabase migrations through `0006` and the restricted runtime grants are applied. A local
production build connected to that hosted database and loaded 11 accounts, 11 fields, and
account logs. Vercel Production has `TOPH_MOBILE_ENABLED=true` and
`TOPH_TRANSCRIPTION_ENABLED=true`; the old demo flag was replaced. No deployment was
triggered by this task. `OPENAI_API_KEY` is still absent both locally and on Vercel, so the
real recording smoke check returns 503 at configuration validation. No live OpenAI call
or transcription result has been verified yet.

Sources: [OpenAI speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text)
and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

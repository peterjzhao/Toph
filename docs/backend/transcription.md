# Recording transcription and form filling

`POST /api/mobile/v1/transcriptions` processes a recording in two steps:

1. OpenAI `gpt-4o-transcribe` returns the speech as text.
2. OpenAI `gpt-4.1-mini` uses strict Structured Outputs to extract the work-log fields.

Transcription requests set `language: "en"` and an English-only transcription prompt.
This configures recognition for English recordings; the language hint and prompt are not
a strict rejection filter for non-English audio or a guaranteed translation service.

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
TOPH_MOBILE_ENABLED=true
```

Keep `.env.local` ignored. Never put the OpenAI key in mobile environment variables or
`NEXT_PUBLIC_*`. A separate bundled transcription token is no longer used. Apply migration
`0006_recording_processing.sql` with the migration runner and run `npm run db:enable-mobile`.
The application uses the restricted database role, not the schema owner.

The farm has a shared allowance of 12 processing requests per minute and 120 per UTC day,
including failed provider attempts and extraction retries. Atomic PostgreSQL counters
apply across Vercel instances. This bounds usage for the explicitly chosen shared-account
application; it does not add user sign-in. Configuring the OpenAI key enables paid AI calls.

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

During append/retry, completed recordings, existing speech, and green fields remain
visible. Missing orange fields and clips without completed speech show blank skeletons. Initial processing
still uses the full review skeleton. After successful extraction, every field (including
the tags group) uses brand green when the parser found a value and shared warning orange
when it did not. Defaults and manual edits do not count as model extraction. Accessibility
hints explain the colors; the visible legend and success instruction have been removed.
The native form now selects required inputs by activity, independently of extraction status;
see [native activity forms](../../mobile/README.md#activity-forms-and-device-choices).
The latest successful parse remains visible during processing or failure, refreshes after
each successful extraction, and resets when starting or loading another draft/account.
These indicators are session state and are not persisted with saved drafts.

Extraction uses shared activity definitions from `src/contracts/recording.ts`. The product
field represents the activity's item (including crops, trees and seeds), not only chemicals.
New names do not require an existing device dropdown choice. Quantities use the shared work
units, including plants, trays, rows, seeds, bins, crates and bunches. Validation no longer
clears planting/harvest items or deletes a known amount just because its unit is missing.
Unspecified quantities remain null. The native client remembers extracted item names locally.

The summary covers all clips and final corrected facts, with an “Online voice log created.”
introduction and a detailed factual narrative. No creation timestamp is fabricated. Existing
Figma fixtures are unchanged. A local live-provider check verified an oak-tree amendment
with no stated count, then a correction to 25 trees, retaining Field A and September 16,
06:00–08:00. These checks used synthetic text and made no database writes; they verified
extraction, not physical microphone input or a newly deployed server.

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
transcript retention, extraction retries, and idempotent mobile receipts. Native tests pass,
including filling every category in the actual review form and preserving worker edits.
The updated iOS Release binary built and installed on the connected iPhone.

Supabase migrations through `0006` and the restricted runtime grants are applied. A local
production build connected to that hosted database and loaded 11 accounts, 11 fields, and
account logs. Vercel Production has `TOPH_MOBILE_ENABLED=true`. Transcription is available
when `OPENAI_API_KEY` is configured; no separate transcription flag is used. No deployment was
triggered by this task. `OPENAI_API_KEY` is now configured as an unreadable Vercel Production
secret; at this point it was still absent locally. The live site was serving an older successful deployment
and returns 404 for the current mobile API after the latest deployment failed on missing
Git files. A successful deployment is required before the live recording smoke check can
run. No live OpenAI call had been verified at this point; see the completed follow-up below.

Sources: [OpenAI speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text)
and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Follow-up verification September 17, 2026

The hosted database is now migrated through `0007`, and live dashboard updates are enabled.
A clean production build passed alongside 148 backend, 34 frontend, and 51 mobile tests.
Real hosted tests verified the reviewed-form save, durable transcript/treatment/tags/audio,
idempotent retries, matching dashboard record ID, and live browser updates. See
[the realtime test results](realtime.md#hosted-verification-recorded-september-17-2026).

The initial run supplied reviewed form values directly. After the user added the OpenAI key
to ignored root `.env.local`, the complete live-provider flow passed against the same tested
production build. A 14.42-second synthesized M4A clip explicitly mentioned every category;
`gpt-4o-transcribe` returned the speech and `gpt-4.1-mini` returned these validated fields:

| Field | Verified value |
| --- | --- |
| Field ID | The temporary farm's actual `FIELD A` UUID |
| Activity | Spraying |
| Work date | 2026-09-16 |
| Start / end | 06:00 / 08:00 |
| Notes | Sprayed neem oil. Irrigation valve leaking, needs follow-up. |
| Product / amount / unit | neem oil / 2 / L |
| Tags | Needs review, Equipment, Follow-up |

All ten schema fields were filled; `missingFields` was `[]` and `extractionError` was `null`.
The result was submitted through the real mobile multipart endpoint with its audio. The
stored transcript, notes, treatment, tags, and recording bytes matched; retry returned the
same receipt. Hosted Supabase delivered the change signal and the already-open dashboard
showed the new row and expanded details without a reload. The temporary farm and all test
records were removed. No Bays Ranch logs were added or edited.

This verifies the real provider calls and hosted persistence/realtime through a local
production server. It does not stand in for a newly deployed Vercel function or physical
microphone test. The final release still needs the user's commit/push and native rebuild;
none was performed during this follow-up. After Vercel is Ready, run
`npm run check:recording -- <audio-file>` or make a phone recording with the dashboard open.
The key remains server-only and ignored locally; it is not present in mobile environment
files or staged source.

## Phone upload fix verified September 17, 2026

After the user's deployment, the live Vercel production endpoint passed both
`check:mobile-server` and `check:recording`. The phone's exact error,
`Unsupported FormDataPart implementation`, was a client serialization failure: Expo 57's
fetch rejects the legacy React Native `{ uri, name, type }` upload object. The earlier
Node multipart smoke checks and permissive native fetch mocks did not exercise that path.

The app now appends `expo-file-system` `File` objects for both transcription and log saving.
Submission metadata uses each file's actual MIME type, including iOS `audio/x-m4a`, which
the deployed backend already accepts. Regression tests reproduce the original rejection
and verify both fixed clients through the installed Expo multipart serializer. Recorder
checks also cover permission preflight, denial, cancellation, and distinct appended files.
All 59 mobile tests and the mobile TypeScript check pass; the production iOS JavaScript
bundle export succeeds.

A second live processing request used Expo's installed FormData patch and multipart
serializer, with a Node adapter supplying bytes from the same synthesized M4A sample.
Vercel returned HTTP 200 in approximately 6 seconds, the speech transcript, all ten fields,
`missingFields: []`, and `extractionError: null`. This was a live OpenAI request through the
deployed server; it did not create a work log. The local receipt is ignored under
`.local/mobile-release/expo-upload-receipt.json`.

The fix is mobile code, so the user must rebuild and reinstall the Release app to receive
it. No commit, push, server deployment, native binary build, or phone installation was
performed for this fix. A physical microphone-to-review/save check remains to be performed
on that new app. “Connecting…” was local microphone setup, not a server connection; it is
now labeled “Starting microphone…” and existing permission is checked before the tap.

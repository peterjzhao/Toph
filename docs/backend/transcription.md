# Mobile transcription

`POST /api/mobile/v1/transcriptions` accepts multipart `file` and returns
`{ "data": { "text": "…" } }`. It forwards audio to OpenAI's `gpt-4o-transcribe`
using the server-only `OPENAI_API_KEY`. It sends no category prompt and does no
structured extraction, note generation, or database mutation. The mobile review
screen displays the text in a dedicated Transcript section and saves it alongside
the device draft when the user saves.

## Local setup

Root `.env.local`:

```dotenv
OPENAI_API_KEY=your-openai-api-key
TOPH_TRANSCRIPTION_DEV_TOKEN=use-a-random-token-of-at-least-32-characters
```

`mobile/.env`:

```dotenv
EXPO_PUBLIC_TOPH_API_URL=http://127.0.0.1:3000
EXPO_PUBLIC_TOPH_TRANSCRIPTION_TOKEN=the-same-local-token
```

Use `openssl rand -hex 32` to generate a token. Both env files are gitignored.
Only the separate development token is bundled into Expo; never use an OpenAI key
as the public token. The route rejects production execution. Real authenticated
user access, distributed rate limits, and deployment-specific upload limits are
required before enabling it outside local development.

The existing server is loopback-bound. iOS Simulator can use the origin above;
Android Emulator uses `http://10.0.2.2:3000`. A phone needs a reachable Mac LAN
origin and an explicitly LAN-bound Next.js development process. Reload Expo after
changing public variables; rebuild release apps to update embedded configuration.

## Behavior and bounds

- Authentication and configuration checks run before reading the upload.
- Exactly one nonempty file, up to 25,000,000 bytes; body limits also apply without
  Content-Length. Accepted formats: M4A/MP4, MP3, WAV, WebM, with MIME/extension and
  container-signature checks. OpenAI performs the final audio decoding validation.
- Two in-flight requests and twelve admitted requests per minute per process.
- OpenAI timeout: 60 seconds; mobile upload/response timeout: 90 seconds.
- Abort signals propagate to fetch. Completed upstream work may still incur usage
  when a request is cancelled; stale results never replace the active mobile log.
- Uploads exist in memory for the request only. They are not retained on the server.
- Response: no-store JSON. Errors are sanitized `{ error: { code, message } }` with
  400/413/415 for uploads, 401 for wrong local token, 503 for missing configuration
  or production mode, 422 for no speech, 429 for throttling, 502/504 for provider
  failure/timeout, and 499 for cancellation observed by the provider call.
- Appended recordings are separate playable/shareable clips within one device log.
  Transcripts are joined in recording order; already completed clips are not sent
  again. Cancel retains clips and completed transcript text for retry/manual review.
- Device drafts are the existing local prototype storage, not PostgreSQL-backed
  mobile sync. The dashboard database and its API contracts are unchanged.

## Verification

Run root `npm run test:unit` and `npm run typecheck`; then in `mobile/`, run
`npm test -- --runInBand` and `npm run typecheck`. Tests use fake provider responses,
not live OpenAI. They cover upload validation, server credential boundaries, errors,
request aborts, stale responses, ordered append/retry, and local multi-clip saving.
A real end-to-end speech test requires `OPENAI_API_KEY`; none was present during
implementation. No PostgreSQL persistence claim is made for mobile drafts.

Reference: [official OpenAI transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text).

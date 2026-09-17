import type { TranscriptionResponse } from "@/contracts/transcription";
import { authorizeTranscription, readAudioUpload, transcribeAudio, TranscriptionError } from "@/server/transcription";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
let active = 0;
let windowStart = 0;
let requests = 0;

/** Ephemeral transcription only: no database, retained upload, or category parsing. */
export async function POST(request: Request): Promise<Response> {
  let admitted = false;
  try {
    const key = authorizeTranscription(request);
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requests = 0; }
    if (active >= 2 || requests >= 12) throw new TranscriptionError(429, "RATE_LIMITED", "Transcription is busy. Try again in a moment.");
    requests += 1;
    active += 1;
    admitted = true;
    const file = await readAudioUpload(request);
    const text = await transcribeAudio(file, key, request.signal);
    return Response.json({ data: { text } } satisfies TranscriptionResponse, { headers });
  } catch (cause) {
    const error = cause instanceof TranscriptionError ? cause : new TranscriptionError(500, "TRANSCRIPTION_FAILED", "Transcription could not be completed. Please try again.");
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
  } finally { if (admitted) active -= 1; }
}

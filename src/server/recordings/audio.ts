import "server-only";

export const MAX_AUDIO_BYTES = 3_800_000;
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 80_000;
const MODEL = "gpt-4o-transcribe";

export class TranscriptionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Bound the stream itself, including chunked requests with no Content-Length. */
export async function readAudioUpload(request: Request): Promise<{ file: File; context: unknown }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new TranscriptionError(415, "UNSUPPORTED_MEDIA_TYPE", "Upload a recording as multipart form data.");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new TranscriptionError(413, "PAYLOAD_TOO_LARGE", "The recording must be smaller than 3.8 MB.");
  }
  if (!request.body) throw new TranscriptionError(400, "INVALID_AUDIO", "Add a recording to transcribe.");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new TranscriptionError(413, "PAYLOAD_TOO_LARGE", "The recording must be smaller than 3.8 MB.");
      }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(new Blob(chunks), { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new TranscriptionError(400, "INVALID_AUDIO", "The audio upload could not be read."); }
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1 || [...form.keys()].some(key => key !== "file" && key !== "context") || !file.size) {
    throw new TranscriptionError(400, "INVALID_AUDIO", "Upload exactly one non-empty recording.");
  }
  if (file.size > MAX_AUDIO_BYTES) throw new TranscriptionError(413, "PAYLOAD_TOO_LARGE", "The recording must be smaller than 3.8 MB.");
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = new TextDecoder().decode(header);
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mime = file.type.toLowerCase().split(";")[0];
  const valid = ((extension === "m4a" || extension === "mp4") && ["audio/mp4", "audio/m4a", "audio/x-m4a", "video/mp4"].includes(mime) && ascii.slice(4, 8) === "ftyp") ||
    (extension === "mp3" && ["audio/mpeg", "audio/mp3"].includes(mime) && (ascii.startsWith("ID3") || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0))) ||
    (extension === "wav" && ["audio/wav", "audio/x-wav"].includes(mime) && ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") ||
    (extension === "webm" && ["audio/webm", "video/webm"].includes(mime) && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3);
  if (!valid) throw new TranscriptionError(415, "INVALID_AUDIO", "Use an M4A, MP3, WAV, or WebM audio recording.");
  if (form.getAll("context").length !== 1 || typeof form.get("context") !== "string") {
    throw new TranscriptionError(400, "INVALID_CONTEXT", "Include the account and recording date.");
  }
  let context: unknown;
  try { context = JSON.parse(form.get("context") as string); }
  catch { throw new TranscriptionError(400, "INVALID_CONTEXT", "The recording context could not be read."); }
  return { file, context };
}

export async function transcribeAudio(file: File, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  body.append("model", MODEL);
  body.append("response_format", "json");
  const timeout = AbortSignal.timeout(60_000);
  const combined = AbortSignal.any([signal, timeout]);
  try {
    const response = await fetcher("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body, signal: combined,
    });
    if (!response.ok) {
      if (response.status === 429) throw new TranscriptionError(429, "RATE_LIMITED", "Transcription is busy. Try again in a moment.");
      throw new TranscriptionError(502, "TRANSCRIPTION_FAILED", "The transcription service could not process this recording. Please try again.");
    }
    const payload: unknown = await response.json();
    const text = typeof payload === "object" && payload !== null && "text" in payload && typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) throw new TranscriptionError(422, "NO_SPEECH", "No speech was recognized. You can append a recording or write a note.");
    return text;
  } catch (cause) {
    if (signal.aborted) throw new TranscriptionError(499, "CANCELLED", "Transcription cancelled.");
    if (timeout.aborted) throw new TranscriptionError(504, "TIMEOUT", "Transcription timed out. Please try again.");
    if (cause instanceof TranscriptionError) throw cause;
    throw new TranscriptionError(502, "TRANSCRIPTION_FAILED", "The transcription service could not be reached. Please try again.");
  }
}

/** The OpenAI credential lives only on the Next.js server. */
import type { RecordingAudio } from "./local-drafts";

export const missingConfigurationMessage = "Transcription is not enabled for this connection. You can still save your recording and add notes.";
export type TranscribeOptions = { baseUrl?: string; token?: string; fetcher?: typeof fetch; signal?: AbortSignal; timeoutMs?: number };

export async function transcribeRecording(audio: RecordingAudio, options: TranscribeOptions = {}): Promise<string> {
  if (options.signal?.aborted) throw new Error("Transcription cancelled.");
  const baseUrl = (options.baseUrl ?? process.env.EXPO_PUBLIC_TOPH_API_URL ?? "").trim();
  const token = (options.token ?? process.env.EXPO_PUBLIC_TOPH_TRANSCRIPTION_TOKEN ?? "").trim();
  if (!baseUrl || !token) throw new Error(missingConfigurationMessage);
  let origin: URL;
  try { origin = new URL(baseUrl); } catch { throw new Error(missingConfigurationMessage); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error("Use the local server's origin without paths or credentials.");
  }
  const body = new FormData();
  // Native FormData reads the local URI and supplies the multipart boundary.
  body.append("file", { uri: audio.uri, name: `recording.${audio.extension}`, type: audio.mimeType } as unknown as Blob);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel);
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 90_000);
  try {
    if (controller.signal.aborted) throw new Error("Cancelled");
    const response = await (options.fetcher ?? fetch)(`${origin.origin}/api/mobile/v1/transcriptions`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, body,
      signal: controller.signal, credentials: "omit", redirect: "error",
    });
    const payload = await response.json().catch(() => null);
    if (controller.signal.aborted) throw new Error("Cancelled");
    if (!response.ok) throw new Error(typeof payload?.error?.message === "string" ? payload.error.message : "Transcription failed. Please try again.");
    const text = typeof payload?.data?.text === "string" ? payload.data.text.trim() : "";
    if (!text) throw new Error("No speech was recognized in the recording.");
    return text;
  } catch (cause) {
    if (controller.signal.aborted) throw new Error(timedOut ? "Transcription timed out. Check your connection and try again." : "Transcription cancelled.");
    if (cause instanceof TypeError) throw new Error("The transcription server could not be reached. Check your connection and try again.");
    throw cause;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

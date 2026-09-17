/** OpenAI credentials and extraction instructions live only on the server. */
import { File } from "expo-file-system";
import type { TranscriptionContext, TranscriptionResult } from "@toph/contracts/transcription";
import { apiOrigin } from "@/lib/api/mobile-client";
import { sessionHeaders } from "@/lib/api/session-token";
import type { RecordingAudio } from "./local-drafts";

export type TranscribeOptions = {
  context: TranscriptionContext; baseUrl?: string; fetcher?: typeof fetch;
  signal?: AbortSignal; timeoutMs?: number;
};

async function request(body: BodyInit, options: TranscribeOptions, json = false): Promise<TranscriptionResult> {
  if (options.signal?.aborted) throw new Error("Transcription cancelled.");
  const origin = apiOrigin(options.baseUrl);
  if (!options.context.accountId || !options.context.referenceDate) throw new Error("Choose an account and recording date first.");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel);
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 120_000);
  try {
    if (controller.signal.aborted) throw new Error("Cancelled");
    const response = await (options.fetcher ?? fetch)(`${origin}/api/mobile/v1/transcriptions`, {
      method: "POST", headers: { "X-Toph-Client": "toph-mobile", Accept: "application/json", ...sessionHeaders(origin), ...(json ? { "Content-Type": "application/json" } : {}) }, body,
      signal: controller.signal, credentials: "omit", redirect: "error",
    });
    const payload = await response.json().catch(() => null);
    if (controller.signal.aborted) throw new Error("Cancelled");
    if (!response.ok) throw new Error(typeof payload?.error?.message === "string" ? payload.error.message : "Transcription failed. Please try again.");
    const data = payload?.data;
    if (typeof data?.text !== "string" || !data.text.trim() || typeof data.transcript !== "string" || !data.transcript.trim()) throw new Error("No speech was recognized in the recording.");
    if (!Array.isArray(data.missingFields) || (data.fields === null ? typeof data.extractionError !== "string" : typeof data.fields !== "object" || data.extractionError !== null)) throw new Error("The server returned unreadable recording details.");
    return { ...data, text: data.text.trim(), transcript: data.transcript.trim() };
  } catch (cause) {
    if (controller.signal.aborted) throw new Error(timedOut ? "Transcription timed out. Check your connection and try again." : "Transcription cancelled.");
    if (cause instanceof TypeError) throw new Error("The transcription server could not be reached. Check your connection and try again.");
    throw cause;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

export async function transcribeRecording(audio: RecordingAudio, options: TranscribeOptions): Promise<TranscriptionResult> {
  const body = new FormData();
  // Expo 57 fetch serializes File bytes; the older React Native URI object is unsupported.
  body.append("file", new File(audio.uri));
  body.append("context", JSON.stringify(options.context));
  return request(body, options);
}

/** Retry only extraction after speech succeeded, avoiding another audio upload/provider charge. */
export function extractRecordingDetails(transcript: string, options: TranscribeOptions): Promise<TranscriptionResult> {
  return request(JSON.stringify({ transcript, context: options.context }), options, true);
}

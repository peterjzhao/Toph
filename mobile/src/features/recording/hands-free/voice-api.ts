/** Hands-free requests to the Toph server, plus the SDP exchange with OpenAI. No OpenAI key is on the phone. */
import { File } from "expo-file-system";
import type { ExtractedLogFields } from "@toph/contracts/transcription";
import { MAX_SPEECH_CHARS, type VoiceCheckResult, type VoiceConfirmResult, type VoiceSession, type VoiceSessionRequest, type VoiceStateResult } from "@toph/contracts/voice";
import { apiOrigin, MobileApiError } from "@/lib/api/mobile-client";
import { sessionHeaders } from "@/lib/api/session-token";
import type { RecordingAudio } from "../local-drafts";

export type VoiceContext = VoiceSessionRequest["context"];
export type VoiceApiOptions = { baseUrl?: string; fetcher?: typeof fetch; headers?: (origin: string) => Record<string, string> };
const unreachable = "Cannot reach Toph. Check your connection and try again.";

export function createVoiceApi({ baseUrl, fetcher = fetch, headers = sessionHeaders }: VoiceApiOptions = {}) {
  async function send(path: string, body: BodyInit, json: boolean, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const origin = apiOrigin(baseUrl);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel);
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(cancel, timeoutMs);
    try {
      const response = await fetcher(`${origin}${path}`, {
        method: "POST", body, signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store",
        headers: { "X-Toph-Client": "toph-mobile", ...headers(origin), ...(json ? { "Content-Type": "application/json" } : {}) },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new MobileApiError(typeof payload?.error?.message === "string" ? payload.error.message : "Voice mode is unavailable.", payload?.error?.code || "HTTP_ERROR", response.status);
      }
      return response;
    } catch (cause) {
      if (controller.signal.aborted) throw new Error(signal?.aborted ? "Cancelled." : "The server took too long.");
      if (cause instanceof TypeError) throw new Error(unreachable);
      throw cause;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  async function data<T>(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const payload = await (await send(path, JSON.stringify(body), true, timeoutMs, signal)).json().catch(() => null);
    if (!payload || typeof payload.data !== "object" || payload.data === null) throw new Error("The server returned an unreadable response.");
    return payload.data as T;
  }

  return {
    async session(context: VoiceContext, signal?: AbortSignal): Promise<VoiceSession> {
      const session = await data<VoiceSession>("/api/mobile/v1/voice/session", { context }, 20_000, signal);
      if (typeof session.clientSecret !== "string" || !session.clientSecret || typeof session.connectUrl !== "string" || typeof session.dataChannel !== "string") throw new Error("The server returned an unreadable voice session.");
      return session;
    },
    state: (context: VoiceContext, transcript: string, turn: number, signal?: AbortSignal) =>
      data<VoiceStateResult<ExtractedLogFields>>("/api/mobile/v1/voice/state", { context, transcript, turn }, 50_000, signal),
    check: (fields: unknown, signal?: AbortSignal) => data<VoiceCheckResult<ExtractedLogFields>>("/api/mobile/v1/voice/check", { fields }, 15_000, signal),
    /** What the spoken reply to the read-back means. The clip is classified on the server and not stored. */
    async confirm(audio: RecordingAudio, context: VoiceContext, signal?: AbortSignal): Promise<VoiceConfirmResult> {
      const body = new FormData();
      body.append("file", new File(audio.uri));
      body.append("context", JSON.stringify(context));
      const payload = await (await send("/api/mobile/v1/voice/confirm", body, false, 60_000, signal)).json().catch(() => null);
      const result = payload?.data;
      if (typeof result?.transcript !== "string" || !["save", "change", "cancel", "unclear"].includes(result.intent)) throw new Error("The server returned an unreadable reply.");
      return result as VoiceConfirmResult;
    },
    /** MP3 bytes for one prompt. Throws on 429 or when offline; the caller then speaks on the device. */
    async speech(text: string, signal?: AbortSignal): Promise<Uint8Array> {
      if (!text.trim() || text.length > MAX_SPEECH_CHARS) throw new Error("This prompt cannot be spoken by the server.");
      const response = await send("/api/mobile/v1/speech", JSON.stringify({ text }), true, 35_000, signal);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new Error("The server returned no audio.");
      return bytes;
    },
  };
}
export type VoiceApi = ReturnType<typeof createVoiceApi>;

/** Offer to OpenAI, answer back. The ephemeral secret is used once here and never stored. */
export async function exchangeSdp(session: Pick<VoiceSession, "connectUrl" | "clientSecret">, offer: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  const url = new URL(session.connectUrl);
  if (url.protocol !== "https:") throw new Error("The voice service address is not secure.");
  const response = await fetcher(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" }, body: offer, signal, credentials: "omit" });
  const answer = await response.text();
  if (!response.ok || !answer.trim()) throw new Error("The voice service refused the call.");
  return answer;
}

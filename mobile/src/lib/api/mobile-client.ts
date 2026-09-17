import type { MobileLogReceipt, MobileLogResponse, MobileLogSubmission } from "@toph/contracts/mobile";

export type UploadAudio = { uri: string; mimeType: string; extension: string };
export type PreparedSubmission = { metadata: MobileLogSubmission; audio: UploadAudio | null };

export class MobileApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

type Options = {
  /** No default URL and no environment-variable activation. Construction makes no requests. */
  baseUrl?: string;
  /** Supply a fresh user access token from the future sign-in provider on every request. */
  getAccessToken?: () => Promise<string | null>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  /** Explicit local development opt-in; production requests require HTTPS. */
  allowInsecureHttp?: boolean;
};

function apiOrigin(options: Options): string {
  if (!options.baseUrl?.trim()) {
    throw new MobileApiError("NOT_CONFIGURED", "Mobile sync is not connected. Your draft is still on this device.");
  }
  let url: URL;
  try { url = new URL(options.baseUrl); }
  catch { throw new MobileApiError("INVALID_URL", "Use an absolute API origin."); }
  if ((url.protocol !== "https:" && !(options.allowInsecureHttp && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new MobileApiError("INVALID_URL", "Use an HTTPS API origin without credentials, paths, or query parameters.");
  }
  return url.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readReceipt(value: unknown, draftId: string): MobileLogReceipt {
  const data = isRecord(value) ? value.data : null;
  if (!isRecord(data) || data.clientDraftId !== draftId ||
      typeof data.logId !== "string" || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(data.logId) ||
      typeof data.savedAt !== "string" || !Number.isFinite(Date.parse(data.savedAt))) {
    throw new MobileApiError("INVALID_RESPONSE", "The server did not confirm this draft was saved.");
  }
  return (value as MobileLogResponse).data;
}

/**
 * Inert until submitLog is explicitly called with a URL and a user token provider.
 * Not imported by any screen. No automatic retries, background sync, or draft deletion.
 */
export function createMobileApiClient(options: Options = {}) {
  return {
    async submitLog(submission: PreparedSubmission, signal?: AbortSignal): Promise<MobileLogReceipt> {
      const origin = apiOrigin(options);
      if (signal?.aborted) throw new MobileApiError("CANCELLED", "Submission cancelled. Your draft is still on this device.");
      const token = await options.getAccessToken?.();
      if (!token?.trim()) throw new MobileApiError("UNAUTHENTICATED", "Sign in before sending a work log.");
      if (Boolean(submission.metadata.recording) !== Boolean(submission.audio)) {
        throw new MobileApiError("INVALID_SUBMISSION", "Recording metadata and audio must be supplied together.");
      }
      const body = new FormData();
      body.append("metadata", JSON.stringify(submission.metadata));
      if (submission.audio) {
        // Native FormData reads the local file URI. Never serialize a device URI into metadata.
        body.append("audio", {
          uri: submission.audio.uri,
          name: `recording.${submission.audio.extension}`,
          type: submission.audio.mimeType,
        } as unknown as Blob);
      }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel);
      if (signal?.aborted) controller.abort();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 30_000);
      try {
        if (controller.signal.aborted) throw new Error("Aborted");
        const response = await (options.fetcher ?? fetch)(`${origin}/api/mobile/v1/logs`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "Idempotency-Key": submission.metadata.clientDraftId,
          },
          // The native transport supplies the multipart boundary; do not set Content-Type.
          body,
          signal: controller.signal,
          credentials: "omit",
          redirect: "error",
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
          const code = typeof error?.code === "string" ? error.code : "HTTP_ERROR";
          const message = typeof error?.message === "string" ? error.message : `The server rejected the work log (${response.status}).`;
          throw new MobileApiError(code, message, response.status);
        }
        return readReceipt(payload, submission.metadata.clientDraftId);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new MobileApiError(timedOut ? "TIMEOUT" : "CANCELLED", timedOut
            ? "The request timed out. Keep this draft and retry with the same ID."
            : "Submission cancelled. Your draft is still on this device.");
        }
        if (error instanceof MobileApiError) throw error;
        throw new MobileApiError("NETWORK_ERROR", "The server could not be reached. Your draft is still on this device.");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    },
  };
}

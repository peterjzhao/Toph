import { File } from "expo-file-system";
import type { MobileAccountEdit, MobileBootstrap, MobileLogReceipt, MobileLogSubmission, MobileRemoteLog } from "@toph/contracts/mobile";
import type { AccountSession, AuthResponse } from "@toph/contracts/accounts";
import type { MessageInbox, SendMessageRequest, ReadMessagesRequest } from "@toph/contracts/messages";
import { sessionHeaders } from "./session-token";
import { draftClips, type RecordingDraft } from "@/features/recording/local-drafts";
import { isTreatment, validateDetails } from "@/features/recording/recording-utils";

export const defaultApiOrigin = "https://toph-rho.vercel.app";
export function apiOrigin(value = process.env.EXPO_PUBLIC_TOPH_API_URL || defaultApiOrigin) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("The Toph server address is invalid."); }
  const local = ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local && __DEV__)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Use the secure Toph server address.");
  return url.origin;
}
export const assetUrl = (url: string | null) => url?.startsWith("/") ? `${apiOrigin()}${url}` : url;
export function assetHeaders(url: string): Record<string, string> {
  try { return new URL(url).origin === apiOrigin() ? sessionHeaders(apiOrigin()) : {}; }
  catch { return {}; }
}

export class MobileApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}
export function createMobileClient({ baseUrl, fetcher = fetch, headers = sessionHeaders }: { baseUrl?: string; fetcher?: typeof fetch; headers?: (origin: string) => Record<string, string> } = {}) {
  async function request<T>(path: string, init: RequestInit = {}, timeout = 30_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const origin = apiOrigin(baseUrl);
      const response = await fetcher(`${origin}${path}`, { ...init, headers: { Accept: "application/json", "X-Toph-Client": "toph-mobile", ...headers(origin), ...init.headers }, signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new MobileApiError(body?.error?.message || (response.status === 404 ? "The mobile connection is waiting for the updated server deployment." : "The server could not save your changes. Please try again."), body?.error?.code || "HTTP_ERROR", response.status);
      if (!body || !("data" in body)) throw new Error("The server returned an unreadable response.");
      return body.data as T;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("The server took too long. Your draft is still on this device. Retry to check the save.");
      if (error instanceof TypeError) throw new Error("Cannot reach Toph. Check your connection and try again.");
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {
    session: () => request<AccountSession>("/api/auth/session"),
    login: (name: string, password: string) => request<AuthResponse["data"]>("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), password, client: "mobile" }) }),
    join: (name: string, password: string, code: string) => request<AuthResponse["data"]>("/api/auth/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), password, code: code.trim(), client: "mobile" }) }),
    logout: () => request<unknown>("/api/auth/logout", { method: "POST" }),
    accounts: () => request<MobileBootstrap>("/api/mobile/v1/accounts"),
    messages: () => request<MessageInbox>("/api/mobile/v1/messages", {}, 15_000),
    sendMessage: (message: SendMessageRequest) => request<MessageInbox>("/api/mobile/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) }, 15_000),
    readMessages: (body: ReadMessagesRequest) => request<MessageInbox>("/api/mobile/v1/messages/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, 15_000),
    updateAccount: (id: string, profile: MobileAccountEdit, expectedRevision: number) => request<MobileBootstrap>(`/api/mobile/v1/accounts/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile, expectedRevision }) }),
    logs: (accountId: string) => request<MobileRemoteLog[]>(`/api/mobile/v1/logs?accountId=${encodeURIComponent(accountId)}`),
    async submit(draft: RecordingDraft, bootstrap: MobileBootstrap): Promise<MobileLogReceipt> {
      const clips = draftClips(draft);
      const problem = validateDetails(draft, clips.length > 0);
      if (problem) throw new Error(problem);
      const field = bootstrap.fields.find(item => item.name === draft.field);
      if (!field || draft.farmId !== bootstrap.farm.id || !bootstrap.accounts.some(item => item.id === draft.employee.id)) throw new Error("Reload accounts and choose this log’s original account and field.");
      if (clips.length > 8) throw new Error("A synced log can contain up to eight recording clips.");
      const files = clips.map(clip => new File(clip.audio.uri));
      if (files.some(file => !file.exists)) throw new Error("A recording file is missing. Your log has not been uploaded.");
      if (files.reduce((sum, file) => sum + file.size, 0) > bootstrap.maxAudioBytes) throw new Error("This recording is too large to sync (3.8 MB limit). Keep the draft or share its audio.");
      const treatment = isTreatment(draft.activity);
      const metadata: MobileLogSubmission = { contractVersion: "1", accountId: draft.employee.id, clientDraftId: draft.id, fieldId: field.id,
        activity: draft.activity, workDate: draft.workDate, startTime: draft.startTime, endTime: draft.endTime, notes: draft.notes.trim(), transcript: draft.transcript.trim() || null,
        treatment: treatment && (draft.product.trim() || draft.amount) ? { product: draft.product.trim() || null, amount: draft.amount ? Number(draft.amount) : null, unit: draft.amount ? draft.unit : null } : null,
        tags: draft.tags, recordings: clips.map((clip, index) => ({ mimeType: files[index].type, durationSeconds: clip.durationSeconds })) };
      const body = new FormData();
      body.append("metadata", JSON.stringify(metadata));
      files.forEach((file, index) => body.append(`audio${index}`, file));
      const receipt = await request<MobileLogReceipt>("/api/mobile/v1/logs", { method: "POST", headers: { "Idempotency-Key": draft.id }, body }, 60_000);
      if (receipt.clientDraftId !== draft.id || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(receipt.logId) || !Number.isFinite(Date.parse(receipt.savedAt))) throw new Error("The server receipt could not be verified. Keep this draft and retry.");
      return receipt;
    },
  };
}

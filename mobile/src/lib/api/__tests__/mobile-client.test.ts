import { createMobileApiClient, type PreparedSubmission } from "../mobile-client";

class NativeFormData {
  values = new Map<string, unknown>();
  append(key: string, value: unknown) { this.values.set(key, value); }
  get(key: string) { return this.values.get(key); }
}
const originalFormData = globalThis.FormData;
beforeAll(() => { (globalThis as { FormData: unknown }).FormData = NativeFormData; });
afterAll(() => { globalThis.FormData = originalFormData; });
afterEach(() => { jest.useRealTimers(); });

const submission: PreparedSubmission = {
  metadata: {
    contractVersion: "1", clientDraftId: "40000000-0000-4000-8000-000000000001",
    fieldId: "20000000-0000-4000-8000-000000000001", activity: "Spraying",
    workDate: "2026-04-19", startTime: "06:00", endTime: "10:40", notes: "Finished field A.",
    transcript: null, treatment: null, tags: [], recording: { mimeType: "audio/mp4", durationSeconds: 12 },
  },
  audio: { uri: "file:///drafts/log.m4a", mimeType: "audio/mp4", extension: "m4a" },
};
const receipt = { clientDraftId: submission.metadata.clientDraftId, logId: "30000000-0000-4000-8000-000000000001", savedAt: "2026-09-16T23:00:00Z" };
const respond = (status: number, payload: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as Response;
const configured = { baseUrl: "https://toph.example", getAccessToken: async () => "user-token" };

test("construction and missing configuration never perform network IO", async () => {
  const fetcher = jest.fn();
  const client = createMobileApiClient({ fetcher });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(client.submitLog(submission)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  await expect(createMobileApiClient({ baseUrl: configured.baseUrl, fetcher }).submitLog(submission)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(fetcher).not.toHaveBeenCalled();
});

test.each(["postgres://db.example", "http://toph.example", "https://user:pass@toph.example", "https://toph.example/api", "https://toph.example?key=secret"])("rejects unsafe or ambiguous origin %s before fetching", async baseUrl => {
  const fetcher = jest.fn();
  await expect(createMobileApiClient({ ...configured, baseUrl, fetcher }).submitLog(submission)).rejects.toMatchObject({ code: "INVALID_URL" });
  expect(fetcher).not.toHaveBeenCalled();
});

test("sends native audio and metadata, refreshes the token, and keeps a stable retry key", async () => {
  const fetcher = jest.fn(async () => respond(201, { data: receipt }));
  const getAccessToken = jest.fn().mockResolvedValueOnce("first-token").mockResolvedValueOnce("renewed-token");
  const client = createMobileApiClient({ ...configured, getAccessToken, fetcher });
  expect(await client.submitLog(submission)).toEqual(receipt);
  expect(await client.submitLog(submission)).toEqual(receipt);
  const [url, request] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
  expect(url).toBe("https://toph.example/api/mobile/v1/logs");
  expect(request.headers).toEqual({ Accept: "application/json", Authorization: "Bearer renewed-token", "Idempotency-Key": submission.metadata.clientDraftId });
  const form = request.body as unknown as NativeFormData;
  expect(JSON.parse(form.get("metadata") as string)).toEqual(submission.metadata);
  expect(form.get("audio")).toEqual({ uri: submission.audio!.uri, name: "recording.m4a", type: "audio/mp4" });
  expect(getAccessToken).toHaveBeenCalledTimes(2);
});

test("supports notes-only submissions and explicit local HTTP opt-in", async () => {
  const fetcher = jest.fn(async () => respond(201, { data: receipt }));
  await createMobileApiClient({ ...configured, baseUrl: "http://127.0.0.1:3000", allowInsecureHttp: true, fetcher })
    .submitLog({ metadata: { ...submission.metadata, recording: null }, audio: null });
  const [, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect((request.body as unknown as NativeFormData).get("audio")).toBeUndefined();
});

test.each([401, 403, 409, 413, 503])("preserves HTTP error status and code (%s)", async status => {
  const fetcher = jest.fn(async () => respond(status, { error: { code: "MOBILE_SYNC_DISABLED", message: "Keep your draft." } }));
  await expect(createMobileApiClient({ ...configured, fetcher }).submitLog(submission)).rejects.toMatchObject({ status, code: "MOBILE_SYNC_DISABLED" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test.each([null, { data: { ...receipt, clientDraftId: "different" } }, { data: { ...receipt, logId: "" } }, { data: { ...receipt, savedAt: "tomorrow" } }])("rejects malformed or unrelated success receipts", async payload => {
  await expect(createMobileApiClient({ ...configured, fetcher: jest.fn(async () => respond(201, payload)) }).submitLog(submission)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("reports network errors without losing the submission or retrying automatically", async () => {
  const before = JSON.stringify(submission);
  const fetcher = jest.fn(async () => { throw new TypeError("offline"); });
  await expect(createMobileApiClient({ ...configured, fetcher }).submitLog(submission)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  expect(JSON.stringify(submission)).toBe(before);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("honors a pre-cancelled request without fetching", async () => {
  const controller = new AbortController(); controller.abort();
  const fetcher = jest.fn();
  await expect(createMobileApiClient({ ...configured, fetcher }).submitLog(submission, controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
  expect(fetcher).not.toHaveBeenCalled();
});

test("bounds a stalled request and releases its timer", async () => {
  jest.useFakeTimers();
  const fetcher = jest.fn((_url: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  const result = createMobileApiClient({ ...configured, fetcher, timeoutMs: 100 }).submitLog(submission);
  const check = expect(result).rejects.toMatchObject({ code: "TIMEOUT" });
  await jest.advanceTimersByTimeAsync(101);
  await check;
  expect(jest.getTimerCount()).toBe(0);
});

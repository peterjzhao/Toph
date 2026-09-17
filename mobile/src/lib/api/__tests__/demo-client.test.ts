import { apiOrigin, createDemoClient, DemoApiError } from "../demo-client";
import type { RecordingDraft } from "@/features/recording/local-drafts";
import type { MobileBootstrap } from "@toph/contracts/mobile-demo";
jest.mock("expo-file-system", () => require("@/features/recording/__tests__/fake-file-system").createFakeFileSystem());
const id = "10000000-0000-4000-8000-000000000001";
const draftId = "30000000-0000-4000-8000-000000000001";
const bootstrap: MobileBootstrap = { mode: "demo", revision: 0, maxAudioBytes: 3_800_000, farm: { id, name: "Farm", timezone: "UTC" }, fields: [{ id, name: "FIELD A" }], accounts: [{ id, name: "Isaac", role: "Worker", email: "", phone: "", avatarUrl: null, defaultField: "FIELD A", defaultActivity: "Monitoring" }] };
const draft: RecordingDraft = { id: draftId, employee: { id, name: "Isaac" }, farmId: id, createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-16T00:00:00Z", field: "FIELD A", activity: "Monitoring", workDate: "2026-09-16", startTime: "06:00", endTime: "07:00", notes: "Water flowing", transcript: "", product: "", amount: "", unit: "L", tags: [], audio: null, clips: [], durationSeconds: 0, isDemo: false };

test("rejects credentials, paths and insecure remote server addresses", () => {
  for (const value of ["http://farm.example", "https://user:password@farm.example", "https://farm.example/path", "https://farm.example?token=secret"]) expect(() => apiOrigin(value)).toThrow();
  expect(apiOrigin("https://toph.example")).toBe("https://toph.example");
});
test("keeps the draft key and owner stable across retries and verifies the receipt", async () => {
  const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { clientDraftId: draftId, logId: draftId, savedAt: "2026-09-16T20:00:00Z" } }) });
  const api = createDemoClient({ baseUrl: "https://toph.example", fetcher });
  const first = await api.submit(draft, bootstrap); expect(await api.submit(draft, bootstrap)).toEqual(first);
  const [, init] = fetcher.mock.calls[0];
  expect(init.headers).toMatchObject({ "Idempotency-Key": draftId, "X-Toph-Client": "mobile-demo" });
  const metadata = JSON.parse(init.body.get("metadata"));
  expect(metadata.accountId).toBe(id); expect(metadata.clientDraftId).toBe(draftId);
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ data: { ...first, clientDraftId: id } }) });
  await expect(api.submit(draft, bootstrap)).rejects.toThrow("receipt");
});
test("surfaces server conflicts and deployment errors without fake success", async () => {
  const fetcher = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: "REVISION_CONFLICT", message: "Reload accounts" } }) });
  const api = createDemoClient({ baseUrl: "https://toph.example", fetcher });
  await expect(api.updateAccount(id, bootstrap.accounts[0], 0)).rejects.toBeInstanceOf(DemoApiError);
  fetcher.mockResolvedValue({ ok: false, status: 404, json: async () => { throw new Error(); } });
  await expect(api.accounts()).rejects.toThrow("deployment");
});

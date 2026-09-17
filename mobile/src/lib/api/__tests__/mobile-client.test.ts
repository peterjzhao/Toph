import { apiOrigin, createMobileClient, MobileApiError } from "../mobile-client";
import type { RecordingDraft } from "@/features/recording/local-drafts";
import type { MobileBootstrap } from "@toph/contracts/mobile";
jest.mock("expo-file-system", () => require("@/features/recording/__tests__/fake-file-system").createFakeFileSystem());
const id = "10000000-0000-4000-8000-000000000001";
const draftId = "30000000-0000-4000-8000-000000000001";
const bootstrap: MobileBootstrap = { mode: "shared", revision: 0, maxAudioBytes: 3_800_000, farm: { id, name: "Farm", timezone: "UTC" }, fields: [{ id, name: "FIELD A" }], accounts: [{ id, name: "Isaac", role: "Worker", email: "", phone: "", avatarUrl: null, defaultField: "FIELD A", defaultActivity: "Monitoring" }] };
const draft: RecordingDraft = { id: draftId, employee: { id, name: "Isaac" }, farmId: id, createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-16T00:00:00Z", field: "FIELD A", activity: "Monitoring", workDate: "2026-09-16", startTime: "06:00", endTime: "07:00", notes: "Water flowing", transcript: "", product: "", amount: "", unit: "L", tags: [], audio: null, clips: [], durationSeconds: 0 };

test("rejects credentials, paths and insecure remote server addresses", () => {
  for (const value of ["http://farm.example", "https://user:password@farm.example", "https://farm.example/path", "https://farm.example?token=secret"]) expect(() => apiOrigin(value)).toThrow();
  expect(apiOrigin("https://toph.example")).toBe("https://toph.example");
});
test("keeps the draft key and owner stable across retries and verifies the receipt", async () => {
  const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { clientDraftId: draftId, logId: draftId, savedAt: "2026-09-16T20:00:00Z" } }) });
  const api = createMobileClient({ baseUrl: "https://toph.example", fetcher });
  const first = await api.submit(draft, bootstrap); expect(await api.submit(draft, bootstrap)).toEqual(first);
  const [, init] = fetcher.mock.calls[0];
  expect(init.headers).toMatchObject({ "Idempotency-Key": draftId, "X-Toph-Client": "toph-mobile" });
  const metadata = JSON.parse(init.body.get("metadata"));
  expect(metadata.accountId).toBe(id); expect(metadata.clientDraftId).toBe(draftId);
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ data: { ...first, clientDraftId: id } }) });
  await expect(api.submit(draft, bootstrap)).rejects.toThrow("receipt");
});
test("surfaces server conflicts and deployment errors without fake success", async () => {
  const fetcher = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: "REVISION_CONFLICT", message: "Reload accounts" } }) });
  const api = createMobileClient({ baseUrl: "https://toph.example", fetcher });
  await expect(api.updateAccount(id, bootstrap.accounts[0], 0)).rejects.toBeInstanceOf(MobileApiError);
  fetcher.mockResolvedValue({ ok: false, status: 404, json: async () => { throw new Error(); } });
  await expect(api.accounts()).rejects.toThrow("deployment");
});

test("native auth sends the client type and authenticated requests carry the bearer session", async () => {
  const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: bootstrap }) });
  const api = createMobileClient({ baseUrl: "https://toph.example", fetcher, headers: (origin): Record<string, string> => origin === "https://toph.example" ? { Authorization: "Bearer native-token" } : {} });
  await api.login(" New Worker ");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ name: "New Worker", client: "mobile" });
  await api.join(" New Worker ", " CODE12 ");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ name: "New Worker", code: "CODE12", client: "mobile" });
  await api.accounts();
  await api.logs(id);
  for (const [, init] of fetcher.mock.calls) expect(init.headers).toMatchObject({ "X-Toph-Client": "toph-mobile", Authorization: "Bearer native-token" });
  expect(fetcher.mock.calls[2][0]).toBe("https://toph.example/api/mobile/v1/accounts");
  expect(fetcher.mock.calls[3][0]).toContain(`/api/mobile/v1/logs?accountId=${id}`);
});

test("messaging uses the private mobile routes and never supplies sender or read state", async () => {
  const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { messages: [], revision: 1 } }) });
  const api = createMobileClient({ baseUrl: "https://toph.example", fetcher, headers: () => ({ Authorization: "Bearer worker-session" }) });
  await api.messages();
  await api.sendMessage({ id: draftId, employeeId: id, body: "Gate checked" });
  await api.readMessages({ employeeId: id, messageIds: [draftId] });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://toph.example/api/mobile/v1/messages", "https://toph.example/api/mobile/v1/messages", "https://toph.example/api/mobile/v1/messages/read"]);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ id: draftId, employeeId: id, body: "Gate checked" });
  for (const [, init] of fetcher.mock.calls) expect(init.headers).toMatchObject({ Authorization: "Bearer worker-session", "X-Toph-Client": "toph-mobile" });
});

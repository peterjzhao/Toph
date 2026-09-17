import { File } from "expo-file-system";
import { transcribeRecording } from "@/features/recording/transcribe";
import { transcriptResult, transcriptionContext } from "@/features/recording/__tests__/transcription-fixture";
import { createMobileClient } from "../mobile-client";
import type { MobileBootstrap } from "@toph/contracts/mobile";
import type { RecordingDraft } from "@/features/recording/local-drafts";

jest.mock("expo-file-system", () => require("@/features/recording/__tests__/fake-file-system").createFakeFileSystem());

// Exercise the installed Expo 57 serializer, not a permissive fetch/FormData stand-in.
const { TextDecoder, TextEncoder } = require("node:util");
const { convertFormDataAsync } = jest.requireActual("expo/src/winter/fetch/convertFormData") as {
  convertFormDataAsync(form: FormData): Promise<{ body: Uint8Array; boundary: string }>;
};
const { installFormDataPatch } = jest.requireActual("expo/src/winter/FormData");
const ExpoFormData = installFormDataPatch(jest.requireActual("react-native/Libraries/Network/FormData").default);
const previousFormData = globalThis.FormData;
beforeAll(() => {
  globalThis.FormData = ExpoFormData;
  globalThis.TextEncoder ??= TextEncoder as typeof globalThis.TextEncoder;
});
afterAll(() => { globalThis.FormData = previousFormData; });
beforeEach(() => { jest.requireMock("expo-file-system").reset(); });

const audio = { uri: "file:///cache/recording.m4a", mimeType: "audio/mp4", extension: "m4a" };
const id = "10000000-0000-4000-8000-000000000001";
const bootstrap: MobileBootstrap = { mode: "shared", revision: 0, maxAudioBytes: 3_800_000,
  farm: { id, name: "Farm", timezone: "UTC" }, fields: [{ id, name: "FIELD A" }],
  accounts: [{ id, name: "Isaac", role: "Worker", email: "", phone: "", avatarUrl: null, defaultField: "FIELD A", defaultActivity: "Monitoring" }] };

test("reproduces the phone's rejection of legacy URI-only FormData parts", async () => {
  const body = new FormData();
  body.append("file", { uri: audio.uri, name: "recording.m4a", type: audio.mimeType } as unknown as Blob);
  await expect(convertFormDataAsync(body)).rejects.toThrow("Unsupported FormDataPart implementation");
});

test("transcription serializes file bytes, filename, MIME and context with Expo's actual converter", async () => {
  new File(audio.uri).write("test audio bytes");
  let serialized = "";
  const fetcher: typeof fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { body } = await convertFormDataAsync(init!.body as FormData);
    serialized = new TextDecoder().decode(body);
    return { ok: true, json: async () => ({ data: transcriptResult("Field A checked.") }) } as Response;
  });
  await transcribeRecording(audio, { context: transcriptionContext, baseUrl: "https://toph.example", fetcher });
  expect(serialized).toContain('name="file"; filename="recording.m4a"');
  expect(serialized).toContain("content-type: audio/x-m4a");
  expect(serialized).toContain("test audio bytes");
  expect(serialized).toContain(transcriptionContext.accountId);
});

test("saving every clip uses serialized files whose MIME matches submission metadata", async () => {
  new File(audio.uri).write("first clip bytes");
  const secondAudio = { ...audio, uri: "file:///cache/append.m4a" };
  new File(secondAudio.uri).write("second clip bytes");
  const draft: RecordingDraft = { id, employee: { id, name: "Isaac" }, farmId: id, createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-16T00:00:00Z", field: "FIELD A", activity: "Monitoring", workDate: "2026-09-16", startTime: "06:00", endTime: "07:00", notes: "Water flowing", transcript: "", product: "", amount: "", unit: "L", tags: [], audio, clips: [{ audio, durationSeconds: 2, transcript: "" }, { audio: secondAudio, durationSeconds: 3, transcript: "" }], durationSeconds: 5 };
  const fetcher: typeof fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const form = init!.body as FormData;
    const metadata = JSON.parse(form.get("metadata") as string);
    const { body } = await convertFormDataAsync(form);
    const serialized = new TextDecoder().decode(body);
    for (let index = 0; index < 2; index++) {
      expect(metadata.recordings[index].mimeType).toBe((form.get(`audio${index}`) as Blob).type);
      expect(serialized).toContain(`name="audio${index}"; filename=`);
    }
    expect(serialized).toContain("first clip bytes");
    expect(serialized).toContain("second clip bytes");
    return { ok: true, json: async () => ({ data: { clientDraftId: id, logId: id, savedAt: "2026-09-17T00:00:00Z" } }) } as Response;
  });
  await createMobileClient({ baseUrl: "https://toph.example", fetcher }).submit(draft, bootstrap);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

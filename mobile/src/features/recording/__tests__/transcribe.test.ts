import { transcriptResult, transcriptionContext } from "./transcription-fixture";
import { transcribeRecording } from "../transcribe";
import { File } from "expo-file-system";

jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystem());

const audio = { uri: "file:///cache/recording.m4a", mimeType: "audio/mp4", extension: "m4a" };
const options = { baseUrl: "http://127.0.0.1:3000", context: transcriptionContext };
class FakeFormData {
  entries = new Map<string, unknown>();
  append(key: string, value: unknown) { this.entries.set(key, value); }
  get(key: string) { return this.entries.get(key); }
}
const originalFormData = globalThis.FormData;
beforeAll(() => { (globalThis as { FormData: unknown }).FormData = FakeFormData; });
afterAll(() => { globalThis.FormData = originalFormData; });
function respond(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

test("uploads audio to Toph without bundling an OpenAI key, model, or category prompt", async () => {
  const fetcher = jest.fn(async () => respond(200, { data: transcriptResult("Sprayed Field A.") }));
  await expect(transcribeRecording(audio, { ...options, fetcher })).resolves.toEqual(transcriptResult("Sprayed Field A."));
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://127.0.0.1:3000/api/mobile/v1/transcriptions");
  expect(init.headers).toEqual({ "X-Toph-Client": "toph-mobile", Accept: "application/json" });
  expect((init.body as unknown as FakeFormData).entries.size).toBe(2);
  expect((init.body as unknown as FakeFormData).get("file")).toBeInstanceOf(File);
  expect((init.body as unknown as FakeFormData).get("file")).toMatchObject({ uri: audio.uri, name: "recording.m4a", type: "audio/x-m4a" });
});

test("missing configuration and pre-cancellation never send audio", async () => {
  const fetcher = jest.fn();
  await expect(transcribeRecording(audio, { ...options, context: { ...transcriptionContext, accountId: "" }, fetcher })).rejects.toThrow("Choose an account");
  const controller = new AbortController(); controller.abort();
  await expect(transcribeRecording(audio, { ...options, fetcher, signal: controller.signal })).rejects.toThrow("cancelled");
  expect(fetcher).not.toHaveBeenCalled();
});

test("reports server errors and rejects empty speech", async () => {
  await expect(transcribeRecording(audio, { ...options, fetcher: jest.fn(async () => respond(503, { error: { message: "Server is not configured." } })) })).rejects.toThrow("Server is not configured.");
  await expect(transcribeRecording(audio, { ...options, fetcher: jest.fn(async () => respond(200, { data: { text: " " } })) })).rejects.toThrow("No speech");
});

test("cancel aborts the upload, removes its listener, and is not described as a timeout", async () => {
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  const fetcher = jest.fn((_url, init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  const pending = transcribeRecording(audio, { ...options, fetcher, signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow("Transcription cancelled.");
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

test("timeout covers the response body as well as upload", async () => {
  jest.useFakeTimers();
  const fetcher = jest.fn(async (_url, init) => ({ ok: true, json: () => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))) } as Response));
  const pending = transcribeRecording(audio, { ...options, fetcher, timeoutMs: 10 });
  const check = expect(pending).rejects.toThrow("timed out");
  await jest.advanceTimersByTimeAsync(11);
  await check;
  jest.useRealTimers();
});

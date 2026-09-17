import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mobile/v1/transcriptions/route";
import { authorizeTranscription, MAX_AUDIO_BYTES, readAudioUpload, transcribeAudio } from "@/server/transcription";

const token = "local-test-token-012345678901234567890";
const file = () => new File([new Uint8Array([0, 0, 0, 20]), "ftypM4A ", "test audio bytes"], "recording.m4a", { type: "audio/mp4" });
function upload(audio: File = file()) {
  const body = new FormData(); body.append("file", audio);
  return new Request("http://localhost/api/mobile/v1/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
}
function configure() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TOPH_TRANSCRIPTION_DEV_TOKEN", token);
  vi.stubEnv("OPENAI_API_KEY", "test-server-key");
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("local transcription boundary", () => {
  it("fails closed before reading uploads when missing credentials, unauthorized, or deployed", async () => {
    vi.stubEnv("TOPH_TRANSCRIPTION_DEV_TOKEN", "");
    expect((await POST(upload())).status).toBe(503);
    configure();
    expect(() => authorizeTranscription(new Request("http://localhost"))).toThrow("Reconnect");
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST(upload())).status).toBe(503);
  });

  it("accepts native M4A multipart uploads and sends only audio/model/format to OpenAI", async () => {
    configure();
    const fetcher = vi.fn(async () => Response.json({ text: "  Checked Field A.  " }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(upload());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { text: "Checked Field A." } });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.headers).toEqual({ Authorization: "Bearer test-server-key" });
    const body = init.body as FormData;
    expect([...body.keys()]).toEqual(["file", "model", "response_format"]);
    expect(body.get("model")).toBe("gpt-4o-transcribe");
  });

  it("validates multipart, nonempty audio, signature, and extra fields", async () => {
    await expect(readAudioUpload(new Request("http://localhost", { method: "POST", body: '{}' }))).rejects.toMatchObject({ status: 415 });
    await expect(readAudioUpload(upload(new File([], "empty.m4a", { type: "audio/mp4" })))).rejects.toMatchObject({ status: 400 });
    await expect(readAudioUpload(upload(new File(["not audio"], "fake.m4a", { type: "audio/mp4" })))).rejects.toMatchObject({ status: 415 });
    const form = new FormData(); form.append("file", file()); form.append("model", "user-supplied-model");
    await expect(readAudioUpload(new Request("http://localhost", { method: "POST", body: form }))).rejects.toMatchObject({ status: 400 });
  });

  it("bounds chunked bodies with no Content-Length", async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_AUDIO_BYTES + 16_385)); controller.close(); } });
    const request = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=x" }, body, duplex: "half" } as RequestInit);
    await expect(readAudioUpload(request)).rejects.toMatchObject({ status: 413 });
  });

  it("sanitizes upstream failures and distinguishes no speech, cancellation, and throttling", async () => {
    const signal = new AbortController().signal;
    await expect(transcribeAudio(file(), "key", signal, vi.fn(async () => Response.json({ error: { message: "secret provider details" } }, { status: 401 })))).rejects.toMatchObject({ status: 502, code: "TRANSCRIPTION_FAILED" });
    await expect(transcribeAudio(file(), "key", signal, vi.fn(async () => Response.json({ text: " " })))).rejects.toMatchObject({ status: 422 });
    await expect(transcribeAudio(file(), "key", signal, vi.fn(async () => new Response(null, { status: 429 })))).rejects.toMatchObject({ status: 429 });
    const controller = new AbortController(); controller.abort();
    await expect(transcribeAudio(file(), "key", controller.signal, vi.fn(async () => { throw new Error("aborted"); }))).rejects.toMatchObject({ status: 499 });
  });
});

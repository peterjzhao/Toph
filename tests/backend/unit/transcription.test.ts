import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mobile/v1/transcriptions/route";
import { MAX_AUDIO_BYTES, readAudioUpload, transcribeAudio } from "@/server/recordings/audio";
import { transcriptionKey } from "@/server/recordings/process";

const file = () => new File([new Uint8Array([0, 0, 0, 20]), "ftypM4A ", "test audio bytes"], "recording.m4a", { type: "audio/mp4" });
function upload(audio: File = file()) {
  const body = new FormData(); body.append("file", audio);
  body.append("context", JSON.stringify({ accountId: "10000000-0000-4000-8000-000000000001", referenceDate: "2026-09-16" }));
  return new Request("http://localhost/api/mobile/v1/transcriptions", { method: "POST", headers: { "X-Toph-Client": "toph-mobile" }, body });
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("recording transcription boundary", () => {
  it("requires explicit configuration before uploads, and supports production when enabled", async () => {
    vi.stubEnv("TOPH_MOBILE_ENABLED", "true"); vi.stubEnv("TOPH_TRANSCRIPTION_ENABLED", "false");
    expect((await POST(upload())).status).toBe(503);
    vi.stubEnv("TOPH_TRANSCRIPTION_ENABLED", "true"); vi.stubEnv("OPENAI_API_KEY", "");
    expect((await POST(upload())).status).toBe(503);
    vi.stubEnv("OPENAI_API_KEY", "server-key"); vi.stubEnv("NODE_ENV", "production");
    expect(transcriptionKey()).toBe("server-key");
    expect((await POST(new Request("http://localhost", { method: "POST" }))).status).toBe(403);
  });
  it("accepts native M4A and sends only audio/model/format to OpenAI", async () => {
    const { file: audio, context } = await readAudioUpload(upload());
    expect(context).toMatchObject({ referenceDate: "2026-09-16" });
    const fetcher = vi.fn(async () => Response.json({ text: "  Checked Field A.  " }));
    expect(await transcribeAudio(audio, "test-server-key", new AbortController().signal, fetcher)).toBe("Checked Field A.");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.headers).toEqual({ Authorization: "Bearer test-server-key" });
    const body = init.body as FormData;
    expect([...body.keys()]).toEqual(["file", "model", "response_format"]);
    expect(body.get("model")).toBe("gpt-4o-transcribe");
  });
  it("validates multipart, nonempty audio, signature, context and extra fields", async () => {
    await expect(readAudioUpload(new Request("http://localhost", { method: "POST", body: '{}' }))).rejects.toMatchObject({ status: 415 });
    await expect(readAudioUpload(upload(new File([], "empty.m4a", { type: "audio/mp4" })))).rejects.toMatchObject({ status: 400 });
    await expect(readAudioUpload(upload(new File(["not audio"], "fake.m4a", { type: "audio/mp4" })))).rejects.toMatchObject({ status: 415 });
    const form = new FormData(); form.append("file", file()); form.append("model", "user-supplied-model");
    await expect(readAudioUpload(new Request("http://localhost", { method: "POST", body: form }))).rejects.toMatchObject({ status: 400 });
  });
  it("bounds chunked uploads below Vercel's request limit", async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_AUDIO_BYTES + 80_001)); controller.close(); } });
    const request = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=x" }, body, duplex: "half" } as RequestInit);
    await expect(readAudioUpload(request)).rejects.toMatchObject({ status: 413 });
  });
  it("sanitizes provider failures and distinguishes no speech, cancellation, and throttling", async () => {
    const signal = new AbortController().signal;
    await expect(transcribeAudio(file(), "key", signal, vi.fn(async () => Response.json({ error: { message: "secret provider details" } }, { status: 401 })))).rejects.toMatchObject({ status: 502, code: "TRANSCRIPTION_FAILED" });
    await expect(transcribeAudio(file(), "key", signal, vi.fn(async () => Response.json({ text: " " })))).rejects.toMatchObject({ status: 422 });
    await expect(transcribeAudio(file(), "key", signal, vi.fn(async () => new Response(null, { status: 429 })))).rejects.toMatchObject({ status: 429 });
    const controller = new AbortController(); controller.abort();
    await expect(transcribeAudio(file(), "key", controller.signal, vi.fn(async () => { throw new Error("aborted"); }))).rejects.toMatchObject({ status: 499 });
  });
});

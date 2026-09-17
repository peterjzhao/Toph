import { createVoiceApi, exchangeSdp } from "../voice-api";
import { transcriptionContext } from "../../__tests__/transcription-fixture";

jest.mock("expo-file-system", () => require("../../__tests__/fake-file-system").createFakeFileSystem());
const headers = () => ({ Authorization: "Bearer worker-session" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("voice requests carry the mobile client header and the worker session, and unwrap data", async () => {
  const fetcher = jest.fn(async () => json({ data: { turn: 2, stateNote: "LOG STATE" } }));
  const api = createVoiceApi({ baseUrl: "https://toph.example", fetcher, headers });
  expect(await api.state(transcriptionContext, "Worker: hello", 2)).toMatchObject({ turn: 2, stateNote: "LOG STATE" });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://toph.example/api/mobile/v1/voice/state");
  expect(init.headers).toMatchObject({ "X-Toph-Client": "toph-mobile", Authorization: "Bearer worker-session", "Content-Type": "application/json" });
  expect(JSON.parse(init.body as string)).toEqual({ context: transcriptionContext, transcript: "Worker: hello", turn: 2 });
  expect(init.credentials).toBe("omit");
});

test("the tool call's argument string is forwarded untouched as fields", async () => {
  const fetcher = jest.fn(async () => json({ data: { status: "needs_fields", saveRequested: false } }));
  await createVoiceApi({ baseUrl: "https://toph.example", fetcher, headers }).check("{\"activity\":\"Spraying\"}");
  expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ fields: "{\"activity\":\"Spraying\"}" });
});

test("server errors keep their code and status so a 429 can fall back to on-device speech", async () => {
  const api = createVoiceApi({ baseUrl: "https://toph.example", fetcher: async () => json({ error: { code: "RATE_LIMITED", message: "Too many prompts." } }, 429), headers });
  await expect(api.speech("What did you work on?")).rejects.toMatchObject({ message: "Too many prompts.", code: "RATE_LIMITED", status: 429 });
  await expect(api.speech("x".repeat(601))).rejects.toThrow("cannot be spoken");
  await expect(createVoiceApi({ baseUrl: "https://toph.example", fetcher: async () => { throw new TypeError("offline"); }, headers }).session(transcriptionContext)).rejects.toThrow("Cannot reach Toph");
});

test("speech returns the MP3 bytes and a session without a secret is refused", async () => {
  const api = createVoiceApi({ baseUrl: "https://toph.example", fetcher: async () => new Response(new Uint8Array([73, 68, 51]), { headers: { "Content-Type": "audio/mpeg" } }), headers });
  expect(Array.from(await api.speech("Saved."))).toEqual([73, 68, 51]);
  const broken = createVoiceApi({ baseUrl: "https://toph.example", fetcher: async () => json({ data: { connectUrl: "https://api.openai.com/v1/realtime/calls" } }), headers });
  await expect(broken.session(transcriptionContext)).rejects.toThrow("unreadable voice session");
});

test("the SDP offer goes to OpenAI with only the ephemeral secret", async () => {
  const fetcher = jest.fn(async () => new Response("v=0 answer"));
  expect(await exchangeSdp({ connectUrl: "https://api.openai.com/v1/realtime/calls", clientSecret: "ek_test" }, "v=0 offer", fetcher)).toBe("v=0 answer");
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.openai.com/v1/realtime/calls");
  expect(init).toMatchObject({ method: "POST", body: "v=0 offer", headers: { Authorization: "Bearer ek_test", "Content-Type": "application/sdp" } });
  await expect(exchangeSdp({ connectUrl: "http://example.test/calls", clientSecret: "ek_test" }, "offer", fetcher)).rejects.toThrow("not secure");
  await expect(exchangeSdp({ connectUrl: "https://api.openai.com/v1/realtime/calls", clientSecret: "ek_test" }, "offer", async () => new Response("no", { status: 401 }))).rejects.toThrow("refused");
});

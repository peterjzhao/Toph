import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as speech } from "@/app/api/mobile/v1/speech/route";
import { POST as confirm } from "@/app/api/mobile/v1/voice/confirm/route";
import { allLogFields, logFormCatalog, requiredLogDetailKeys, resolveLogForm, spokenAsk } from "@/contracts/log-form";
import { buildVoiceGuidance, classifyVoiceIntent, MAX_SPEECH_CHARS, missingLogFields, type VoiceLogFields } from "@/contracts/voice";
import { confirmVoice } from "@/server/recordings/confirm";
import { reserveSpeech } from "@/server/recordings/quota";
import { speakText, synthesizeSpeech } from "@/server/recordings/speech";
import type { FarmContext } from "@/server/farm-context";

const form = resolveLogForm();
const farmFields = [{ id: "field-a", name: "FIELD A" }];
const complete = (): VoiceLogFields => ({ fieldId: "field-a", activity: "Spraying", workDate: "2026-09-16", startTime: "06:00", endTime: "14:30",
  tags: ["Follow-up"], details: { product: "neem oil", amount: 2, unit: "L" } });
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Toph-Client": "toph-mobile", ...headers }, body: JSON.stringify(body) });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("missing fields", () => {
  it("requires the activity's default details the farm has not hidden, and nothing optional", () => {
    expect(requiredLogDetailKeys(form, "Spraying")).toEqual(["product", "amount", "unit"]);
    expect(requiredLogDetailKeys(form, "Irrigation")).toEqual(["product"]);
    expect(requiredLogDetailKeys(form, "Scouting")).toEqual([]);
    const farm = resolveLogForm({ enabled: { Spraying: ["applicationMethod"] }, hidden: { Spraying: ["amount"] }, custom: [{ key: "custom_tank", label: "Tank", type: "text", activities: ["Spraying"] }] });
    expect(requiredLogDetailKeys(farm, "Spraying")).toEqual(["product"]);
  });
  it("lists null core facts first, then missing details of the extracted activity", () => {
    expect(missingLogFields(complete(), form)).toEqual([]);
    expect(missingLogFields({ ...complete(), endTime: null, details: { product: "neem oil" } }, form)).toEqual(["endTime", "amount", "unit"]);
    expect(missingLogFields({ ...complete(), activity: null, details: {} }, form)).toEqual(["activity"]);
    expect(missingLogFields({ ...complete(), activity: "Monitoring", details: {} }, form)).toEqual([]);
  });
  it("has spoken wording for every catalog field", () => {
    for (const [activity, def] of Object.entries(logFormCatalog)) for (const field of def.defaults) expect(spokenAsk(field.key, activity, field)).toMatch(/^(what|which|how) /);
    for (const field of allLogFields(resolveLogForm({ enabled: Object.fromEntries(Object.entries(logFormCatalog).map(([activity, def]) => [activity, def.suggested.map(item => item.key)])), hidden: {}, custom: [] }))) {
      expect(spokenAsk(field.key, null, field)).not.toMatch(/[()/]/);
    }
    expect(spokenAsk("custom_tank", "Spraying", { label: "Tank" })).toBe("what was the tank");
  });
});

describe("voice prompts", () => {
  it("asks for at most two missing facts and folds the unit into the quantity question", () => {
    const guidance = buildVoiceGuidance({ ...complete(), fieldId: null, endTime: null, details: {} }, { fields: farmFields, form });
    expect(guidance).toEqual({ status: "needs_fields", prompt: "Which field was this in, and what time did you finish?", missingFields: ["fieldId", "endTime", "product", "amount", "unit"] });
    expect(buildVoiceGuidance({ ...complete(), details: { product: "neem oil" } }, { fields: farmFields, form }).prompt).toBe("How much did you apply?");
    expect(buildVoiceGuidance({ ...complete(), details: { product: "neem oil", amount: 2 } }, { fields: farmFields, form }).prompt).toBe("What unit was that amount in?");
    expect(buildVoiceGuidance({ ...complete(), activity: "Planting", details: {} }, { fields: farmFields, form }).prompt).toBe("What crop or variety did you plant, and how many did you plant?");
  });
  it("reads a complete log back and asks for confirmation", () => {
    expect(buildVoiceGuidance(complete(), { fields: farmFields, form })).toEqual({ status: "ready_to_confirm", missingFields: [],
      prompt: "Spraying in Field A on September 16, from 6 AM to 2:30 PM. Neem oil, 2 liters. Tagged follow-up. Say save, or tell me what to change." });
    const farm = resolveLogForm({ enabled: { Spraying: ["applicationMethod", "windSpeedMph"] }, hidden: {}, custom: [] });
    const spoken = buildVoiceGuidance({ ...complete(), tags: [], details: { ...complete().details, applicationMethod: "Plane", windSpeedMph: 4 } }, { fields: farmFields, form: farm }).prompt;
    expect(spoken).toContain("Neem oil, 2 liters, applied by Plane, wind speed 4.");
    expect(spoken.length).toBeLessThanOrEqual(MAX_SPEECH_CHARS);
  });
});

describe("spoken confirmation", () => {
  it.each([
    ["Save.", "save"], ["yeah save it", "save"], ["Yes, that's correct.", "save"], ["Looks good, go ahead", "save"], ["No changes, save it.", "save"], ["nothing to change", "save"],
    ["No wait, change the end time to four", "change"], ["Save it, but the field should be Field B", "change"], ["Actually it was three liters", "change"],
    ["correct the start time", "change"], ["That's not right", "change"], ["the end time is 4 pm", "change"], ["add a note that the valve leaks", "change"],
    ["Never mind.", "cancel"], ["cancel", "cancel"], ["Don't save that", "cancel"], ["forget it", "cancel"], ["Stop.", "cancel"],
    ["", "unclear"], ["um", "unclear"], ["no", "unclear"], ["what did you say", "unclear"], ["never mind, save it", "unclear"],
  ])("%j is %s", (spoken, intent) => expect(classifyVoiceIntent(spoken)).toBe(intent));

  const ctx = { farmId: "farm", sql: vi.fn(async () => [{ farm_id: "farm" }]) } as unknown as FarmContext;
  it("classifies a transcript without a provider call or quota", async () => {
    const fetcher = vi.fn();
    expect(await confirmVoice(json("/api/mobile/v1/voice/confirm", { transcript: " yeah save it " }), ctx, fetcher)).toEqual({ transcript: "yeah save it", intent: "save" });
    await expect(confirmVoice(json("/api/mobile/v1/voice/confirm", { transcript: "x".repeat(2001) }), ctx, fetcher)).rejects.toMatchObject({ status: 400, code: "INVALID_TRANSCRIPT" });
    await expect(confirmVoice(json("/api/mobile/v1/voice/confirm", { transcript: "save", model: "x" }), ctx, fetcher)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled(); expect(ctx.sql).not.toHaveBeenCalled();
  });
  it("transcribes an audio reply from the farm allowance and treats silence as unclear", async () => {
    vi.stubEnv("OPENAI_API_KEY", "server-key");
    const upload = () => {
      const body = new FormData();
      body.append("file", new File([new Uint8Array([0, 0, 0, 20]), "ftypM4A ", "bytes"], "reply.m4a", { type: "audio/mp4" })); body.append("context", "{}");
      return new Request("http://localhost/api/mobile/v1/voice/confirm", { method: "POST", body });
    };
    expect(await confirmVoice(upload(), ctx, vi.fn(async () => Response.json({ text: "No wait, change the end time to four." })))).toEqual({ transcript: "No wait, change the end time to four.", intent: "change" });
    expect(await confirmVoice(upload(), ctx, vi.fn(async () => Response.json({ text: " " })))).toEqual({ transcript: "", intent: "unclear" });
    expect(ctx.sql).toHaveBeenCalledTimes(2);
  });
  it("mirrors the mobile client, origin, enabled and session checks", async () => {
    vi.stubEnv("TOPH_MOBILE_ENABLED", "false");
    expect((await confirm(json("/api/mobile/v1/voice/confirm", { transcript: "save" }))).status).toBe(503);
    vi.stubEnv("TOPH_MOBILE_ENABLED", "true"); vi.stubEnv("APP_ORIGIN", "https://toph.example");
    expect((await confirm(json("/api/mobile/v1/voice/confirm", { transcript: "save" }, { "X-Toph-Client": "browser" }))).status).toBe(403);
    expect((await confirm(json("/api/mobile/v1/voice/confirm", { transcript: "save" }, { Origin: "https://elsewhere.example" }))).status).toBe(403);
    const response = await confirm(json("/api/mobile/v1/voice/confirm", { transcript: "save" }));
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("speech", () => {
  const signal = new AbortController().signal;
  const mp3 = () => new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), { headers: { "Content-Type": "audio/mpeg" } });
  it("requests a short MP3 from OpenAI with the server key", async () => {
    const fetcher = vi.fn(async () => mp3());
    expect((await synthesizeSpeech("What time did you finish?", "server-key", signal, fetcher)).byteLength).toBe(4);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init.headers).toEqual({ Authorization: "Bearer server-key", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "gpt-4o-mini-tts", voice: "sage", input: "What time did you finish?", response_format: "mp3" });
  });
  it("sanitizes provider failures, empty audio, throttling and cancellation", async () => {
    await expect(synthesizeSpeech("Hi", "key", signal, vi.fn(async () => Response.json({ error: { message: "secret provider details" } }, { status: 401 })))).rejects.toMatchObject({ status: 502, code: "SPEECH_FAILED" });
    await expect(synthesizeSpeech("Hi", "key", signal, vi.fn(async () => new Response(null, { status: 429 })))).rejects.toMatchObject({ status: 429 });
    await expect(synthesizeSpeech("Hi", "key", signal, vi.fn(async () => new Response(new Uint8Array())))).rejects.toMatchObject({ status: 502 });
    await expect(synthesizeSpeech("Hi", "key", signal, vi.fn(async () => { throw new TypeError("network"); }))).rejects.toMatchObject({ status: 502 });
    const controller = new AbortController(); controller.abort();
    await expect(synthesizeSpeech("Hi", "key", controller.signal, vi.fn(async () => { throw new Error("aborted"); }))).rejects.toMatchObject({ status: 499 });
  });
  it("validates the text before spending quota or calling the provider", async () => {
    const fetcher = vi.fn(async () => mp3());
    for (const body of [{}, { text: "" }, { text: "   " }, { text: 5 }, { text: "x".repeat(MAX_SPEECH_CHARS + 1) }, { text: "Hi", voice: "user-voice" }]) {
      await expect(speakText(json("/api/mobile/v1/speech", body), "farm-validate", "key", fetcher)).rejects.toMatchObject({ status: 400, code: "INVALID_TEXT" });
    }
    await expect(speakText(new Request("http://localhost", { method: "POST", body: "text" }), "farm-validate", "key", fetcher)).rejects.toMatchObject({ status: 415 });
    await expect(speakText(json("/api/mobile/v1/speech", { text: "x".repeat(5000) }), "farm-validate", "key", fetcher)).rejects.toMatchObject({ status: 413 });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await speakText(json("/api/mobile/v1/speech", { text: "x".repeat(MAX_SPEECH_CHARS) }), "farm-validate", "key", fetcher)).byteLength).toBe(4);
  });
  it("limits speech per farm in its own bucket, per minute", () => {
    const start = 1_800_000_000_000 - (1_800_000_000_000 % 60_000);
    for (let count = 0; count < 40; count += 1) reserveSpeech("farm-limit", start);
    expect(() => reserveSpeech("farm-limit", start + 59_000)).toThrow("speech limit");
    expect(() => reserveSpeech("other-farm", start)).not.toThrow();
    expect(() => reserveSpeech("farm-limit", start + 60_000)).not.toThrow();
  });
  it("mirrors the mobile client, enabled and session checks", async () => {
    vi.stubEnv("TOPH_MOBILE_ENABLED", "false");
    expect((await speech(json("/api/mobile/v1/speech", { text: "Hi" }))).status).toBe(503);
    vi.stubEnv("TOPH_MOBILE_ENABLED", "true");
    expect((await speech(json("/api/mobile/v1/speech", { text: "Hi" }, { "X-Toph-Client": "browser" }))).status).toBe(403);
    expect((await speech(json("/api/mobile/v1/speech", { text: "Hi" }))).status).toBe(401);
  });
});

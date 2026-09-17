import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as check } from "@/app/api/mobile/v1/voice/check/route";
import { POST as session } from "@/app/api/mobile/v1/voice/session/route";
import { POST as state } from "@/app/api/mobile/v1/voice/state/route";
import { resolveLogForm } from "@/contracts/log-form";
import { buildLogStateNote, type VoiceLogFields } from "@/contracts/voice";
import type { FarmContext } from "@/server/farm-context";
import { reserveVoiceSession, reserveVoiceState } from "@/server/recordings/quota";
import { checkVoiceLog, checkVoiceRequest, mintVoiceSecret, voiceInstructions, voiceSessionBody, voiceState, voiceTool } from "@/server/recordings/realtime";

const form = resolveLogForm({ enabled: { Spraying: ["applicationMethod"] }, hidden: {}, custom: [] });
const farmFields = [{ id: "11111111-1111-4111-8111-111111111111", name: "NORTH 40" }, { id: "22222222-2222-4222-8222-222222222222", name: "Field B" }];
const context = { fields: farmFields, form, referenceDate: "2026-09-17", timezone: "America/Los_Angeles" };
const accountId = "33333333-3333-4333-8333-333333333333";
const args = () => ({ fieldId: farmFields[0].id, activity: "Spraying", workDate: "2026-09-17", startTime: "08:00", endTime: "10:30", notes: null, tags: [],
  details: { product: "Neem oil", amount: 2, unit: "L" }, confirmed: false });
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Toph-Client": "toph-mobile", ...headers }, body: JSON.stringify(body) });
const signal = new AbortController().signal;
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("realtime session", () => {
  it("writes instructions from the farm's fields, form and spoken wording", () => {
    const text = voiceInstructions(context);
    expect(text).toContain("Today is 2026-09-17 in America/Los_Angeles");
    expect(text).toContain(`- NORTH 40 (id ${farmFields[0].id})`);
    expect(text).toContain("which field was this in; what kind of work did you do; what day was this; what time did you start; what time did you finish");
    expect(text).toContain('- Spraying: ask "what product did you use", "how much did you apply"; optional if mentioned: applicationMethod (');
    expect(text).toContain('- Planting: ask "what crop or variety did you plant", "how many did you plant"');
    expect(text).toContain("- Scouting: no required details");
    expect(text).toMatch(/at most two missing things/);
    expect(text).toMatch(/LOG STATE.*authoritative.*Never read them aloud/);
    expect(text).toContain("Only say the log is saved after a tool result contains saved true");
  });
  it("derives the tool from the extraction schema, with this farm's field IDs", () => {
    const tool = voiceTool(context) as unknown as { type: string; name: string; strict?: boolean; parameters: { $schema?: string; required: string[]; properties: Record<string, { anyOf?: { enum?: string[] }[] }> & { details: { properties: Record<string, unknown> } } } };
    expect(tool).toMatchObject({ type: "function", name: "check_log" });
    expect(tool.strict).toBeUndefined(); expect(tool.parameters.$schema).toBeUndefined();
    expect(tool.parameters.properties.fieldId.anyOf?.[0].enum).toEqual(farmFields.map(field => field.id));
    expect(Object.keys(tool.parameters.properties)).toEqual(["fieldId", "activity", "workDate", "startTime", "endTime", "notes", "tags", "details", "confirmed"]);
    expect(Object.keys(tool.parameters.properties.details.properties)).toEqual(expect.arrayContaining(["product", "amount", "unit", "applicationMethod"]));
    expect(tool.parameters.required).toContain("confirmed");
  });
  it("asks for a short-lived secret with semantic VAD, noise reduction and input transcription", () => {
    expect(voiceSessionBody(context)).toMatchObject({
      expires_after: { anchor: "created_at", seconds: 120 },
      session: { type: "realtime", model: "gpt-realtime-2.1", output_modalities: ["audio"], tool_choice: "auto",
        audio: { input: { transcription: { model: "gpt-4o-transcribe", language: "en" }, noise_reduction: { type: "far_field" }, turn_detection: { type: "semantic_vad" } }, output: { voice: "sage" } } },
    });
  });
  it("mints with the server key and returns only what the phone needs", async () => {
    const fetcher = vi.fn(async () => Response.json({ value: "ek_test", expires_at: 1_790_000_000, session: { id: "sess_1", instructions: "…" } }));
    expect(await mintVoiceSecret(context, "hashed", "server-key", signal, fetcher)).toEqual({ clientSecret: "ek_test", expiresAt: new Date(1_790_000_000_000).toISOString(), model: "gpt-realtime-2.1",
      connectUrl: "https://api.openai.com/v1/realtime/calls", dataChannel: "oai-events", toolName: "check_log", maxSessionSeconds: 300 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(init.headers).toEqual({ Authorization: "Bearer server-key", "Content-Type": "application/json", "OpenAI-Safety-Identifier": "hashed" });
    expect(JSON.parse(init.body as string).session.tools).toHaveLength(1);
  });
  it("sanitizes provider failures, malformed secrets, throttling and cancellation", async () => {
    await expect(mintVoiceSecret(context, "id", "key", signal, vi.fn(async () => Response.json({ error: { message: "secret provider details" } }, { status: 401 })))).rejects.toMatchObject({ status: 502, code: "VOICE_SESSION_FAILED", message: expect.not.stringContaining("secret") });
    await expect(mintVoiceSecret(context, "id", "key", signal, vi.fn(async () => new Response(null, { status: 429 })))).rejects.toMatchObject({ status: 429 });
    await expect(mintVoiceSecret(context, "id", "key", signal, vi.fn(async () => Response.json({ client_secret: { value: "old-shape" } })))).rejects.toMatchObject({ status: 502 });
    await expect(mintVoiceSecret(context, "id", "key", signal, vi.fn(async () => { throw new TypeError("network"); }))).rejects.toMatchObject({ status: 502 });
    const controller = new AbortController(); controller.abort();
    await expect(mintVoiceSecret(context, "id", "key", controller.signal, vi.fn(async () => { throw new Error("aborted"); }))).rejects.toMatchObject({ status: 499 });
  });
  it("limits sessions and state checks per farm in their own buckets", () => {
    const start = 1_800_000_000_000 - (1_800_000_000_000 % 60_000);
    for (let count = 0; count < 6; count += 1) reserveVoiceSession("farm-limit", start);
    expect(() => reserveVoiceSession("farm-limit", start + 59_000)).toThrow("voice session limit");
    expect(() => reserveVoiceSession("other-farm", start)).not.toThrow();
    expect(() => reserveVoiceSession("farm-limit", start + 60_000)).not.toThrow();
    for (let count = 0; count < 30; count += 1) reserveVoiceState("farm-limit", start);
    expect(() => reserveVoiceState("farm-limit", start)).toThrow(expect.objectContaining({ status: 429 }));
    // The daily cap holds across minutes.
    for (let count = 0; count < 100; count += 1) reserveVoiceSession("farm-day", start + count * 60_000);
    expect(() => reserveVoiceSession("farm-day", start + 100 * 60_000)).toThrow("voice session limit");
  });
});

describe("tool call check", () => {
  it("accepts a complete log, as an object or the data channel's JSON string", () => {
    const result = checkVoiceLog(args(), context);
    expect(result).toMatchObject({ status: "ready_to_confirm", missingFields: [], problems: [], saveRequested: false,
      prompt: "Spraying in North 40 on September 17, from 8 AM to 10:30 AM. Neem oil, 2 liters. Say save, or tell me what to change.",
      fields: { fieldId: farmFields[0].id, details: { product: "Neem oil", amount: 2, unit: "L" }, product: "Neem oil", amount: 2, unit: "L" } });
    expect(checkVoiceLog(JSON.stringify(args()), context)).toEqual(result);
    expect(checkVoiceLog({ ...args(), confirmed: true }, context).saveRequested).toBe(true);
  });
  it("tolerates partial, loosely typed arguments and resolves names to IDs", () => {
    const result = checkVoiceLog({ fieldId: "north 40", activity: "spraying", startTime: "8:00", endTime: "", details: { product: " Neem oil ", amount: "2", unit: null }, tags: ["Follow-up", "Made up"], confirmed: true }, context);
    expect(result).toMatchObject({ status: "needs_fields", missingFields: ["workDate", "endTime", "unit"], problems: [], saveRequested: false, prompt: "What day was this, and what time did you finish?",
      fields: { fieldId: farmFields[0].id, activity: "Spraying", startTime: "08:00", endTime: null, tags: ["Follow-up"], details: { product: "Neem oil", amount: 2 } } });
    expect(checkVoiceLog({}, context)).toMatchObject({ status: "needs_fields", missingFields: ["fieldId", "activity", "workDate", "startTime", "endTime"], prompt: "Which field was this in, and what kind of work did you do?" });
  });
  it("clears and reports values it cannot accept, and never confirms them", () => {
    const result = checkVoiceLog({ ...args(), fieldId: "South paddock", workDate: "2026-02-30", endTime: "07:00", details: { product: "Neem oil", amount: "lots", unit: "buckets", applicationMethod: "Catapult" }, confirmed: true }, context);
    expect(result.status).toBe("invalid"); expect(result.saveRequested).toBe(false);
    expect(result.problems.map(problem => problem.key)).toEqual(expect.arrayContaining(["fieldId", "workDate", "endTime", "amount", "unit", "applicationMethod"]));
    expect(result.fields).toMatchObject({ fieldId: null, workDate: null, endTime: null, details: { product: "Neem oil" } });
    expect(result.prompt).toContain("Choose one of: NORTH 40, Field B."); expect(result.prompt).toMatch(/Which field was this in, and what day was this\?$/);
    for (const bad of [null, 5, [], "not json"]) expect(checkVoiceLog(bad, context)).toMatchObject({ status: "invalid", fields: null, problems: [{ key: "fields" }] });
  });
  it("validates the request without a provider call", async () => {
    const ctx = { farmId: "farm" } as unknown as FarmContext;
    const load = vi.fn(async () => context); const fetcher = vi.spyOn(globalThis, "fetch");
    expect((await checkVoiceRequest(json("/api/mobile/v1/voice/check", { fields: args(), transcript: "sprayed north 40" }), ctx, load)).status).toBe("ready_to_confirm");
    await expect(checkVoiceRequest(json("/api/mobile/v1/voice/check", { fields: args(), model: "x" }), ctx, load)).rejects.toMatchObject({ status: 400, code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("shadow state", () => {
  const log = (): VoiceLogFields => ({ fieldId: farmFields[0].id, activity: "Spraying", workDate: "2026-09-17", startTime: "08:00", endTime: null, details: { amount: 2, unit: "L" } });
  it("writes one deterministic line of filled and missing facts", () => {
    expect(buildLogStateNote(log(), context, 3)).toBe("LOG STATE (authoritative, turn 3): field=NORTH 40; activity=Spraying; date=2026-09-17; start=08:00; end=MISSING; product=MISSING; amount=2; unit=L. Ask next for: end time, product.");
    expect(buildLogStateNote({ ...log(), fieldId: null, activity: null, details: {} }, context, 0)).toBe("LOG STATE (authoritative, turn 0): field=MISSING; activity=MISSING; date=2026-09-17; start=08:00; end=MISSING. Ask next for: field, activity, end time.");
    expect(buildLogStateNote({ ...log(), endTime: "10:30", details: { product: "Neem oil", amount: 2, unit: "L" } }, context, 4)).toMatch(/unit=L\. Nothing required is missing\. Call check_log before reading the log back\.$/);
  });
  it("extracts the running transcript, echoes the turn and spends its own bucket", async () => {
    const ctx = { farmId: "farm-state", farm: { timezone: "America/Los_Angeles" }, sql: vi.fn() } as unknown as FarmContext;
    const bootstrap = vi.fn(async () => ({ fields: farmFields, logForm: form })) as never;
    const extracted = { ...args(), endTime: null, details: { product: "Neem oil", amount: 2, unit: "L", applicationMethod: null } } as Record<string, unknown>; delete extracted.confirmed;
    const details = Object.fromEntries(Object.keys((voiceTool(context).parameters as unknown as { properties: { details: { properties: object } } }).properties.details.properties).map(key => [key, (extracted.details as Record<string, unknown>)[key] ?? null]));
    const fetcher = vi.fn(async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...extracted, details }) }] }] }));
    const body = { context: { accountId, referenceDate: "2026-09-17" }, transcript: "I sprayed two liters of neem oil in north 40 from eight", turn: 7 };
    const result = await voiceState(json("/api/mobile/v1/voice/state", body), ctx, "server-key", fetcher, bootstrap);
    expect(result).toMatchObject({ turn: 7, status: "needs_fields", missingFields: ["endTime"], problems: [], prompt: "What time did you finish?", fields: { endTime: null } });
    expect(result.stateNote).toContain("(authoritative, turn 7)"); expect(result.stateNote).toContain("end=MISSING");
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("https://api.openai.com/v1/responses");
    expect(ctx.sql).not.toHaveBeenCalled();
    for (const bad of [{ ...body, turn: -1 }, { ...body, turn: 1.5 }, { ...body, transcript: " " }, { transcript: "x", turn: 1 }, { ...body, extra: true }]) {
      await expect(voiceState(json("/api/mobile/v1/voice/state", bad), ctx, "server-key", fetcher, bootstrap)).rejects.toMatchObject({ status: 400 });
    }
    await expect(voiceState(json("/api/mobile/v1/voice/state", body), ctx, "server-key", vi.fn(async () => new Response(null, { status: 500 })), bootstrap)).rejects.toMatchObject({ status: 502, code: "EXTRACTION_FAILED" });
  });
});

describe("route guards", () => {
  it.each([["session", session, { context: { accountId, referenceDate: "2026-09-17" } }], ["check", check, { fields: {} }], ["state", state, { context: { accountId, referenceDate: "2026-09-17" }, transcript: "x", turn: 0 }]] as const)(
    "%s mirrors the mobile client, origin, enabled and session checks", async (name, route, body) => {
      const url = `/api/mobile/v1/voice/${name}`;
      vi.stubEnv("TOPH_MOBILE_ENABLED", "false");
      expect((await route(json(url, body))).status).toBe(503);
      vi.stubEnv("TOPH_MOBILE_ENABLED", "true"); vi.stubEnv("APP_ORIGIN", "https://toph.example");
      expect((await route(json(url, body, { "X-Toph-Client": "browser" }))).status).toBe(403);
      expect((await route(json(url, body, { Origin: "https://elsewhere.example" }))).status).toBe(403);
      const response = await route(json(url, body));
      expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
    });
});

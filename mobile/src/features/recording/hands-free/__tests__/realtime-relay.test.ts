import type { ExtractedLogFields } from "@toph/contracts/transcription";
import type { VoiceCheckResult, VoiceStateResult } from "@toph/contracts/voice";
import { emptyExtraction } from "../../__tests__/transcription-fixture";
import { createRealtimeRelay, type RelayDeps } from "../realtime-relay";

const fields: ExtractedLogFields = { ...emptyExtraction, activity: "Spraying", notes: "Online voice log created." };
const stateResult = (turn: number, status: VoiceStateResult["status"] = "needs_fields"): VoiceStateResult<ExtractedLogFields> => ({ turn, status, missingFields: status === "ready_to_confirm" ? [] : ["endTime"], problems: [], prompt: "What time did you finish?", fields, stateNote: `LOG STATE (authoritative, turn ${turn}): end=MISSING.` });
const checkResult = (saveRequested: boolean): VoiceCheckResult<ExtractedLogFields> => ({ status: saveRequested ? "ready_to_confirm" : "needs_fields", missingFields: saveRequested ? [] : ["endTime"], problems: [], prompt: "What time did you finish?", fields, saveRequested });
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const toolCall = (call_id: string, args = "{\"activity\":\"Spraying\",\"confirmed\":false}") => ({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", name: "check_log", call_id, arguments: args }] } });

function harness(overrides: Partial<RelayDeps> = {}) {
  const sent: Record<string, any>[] = [];
  const deps: RelayDeps = {
    send: event => sent.push(event), toolName: "check_log",
    postState: jest.fn(async (_transcript: string, turn: number) => stateResult(turn)),
    postCheck: jest.fn(async () => checkResult(false)),
    onPhase: jest.fn(), onFields: jest.fn(), onReady: jest.fn(), onEnd: jest.fn(),
    ...overrides,
  };
  return { relay: createRealtimeRelay(deps), deps, sent };
}
const user = (id: string) => ({ type: "conversation.item.added", item: { id, type: "message", role: "user" } });
const assistant = (id: string) => ({ type: "conversation.item.added", item: { id, type: "message", role: "assistant" } });
const heard = (item_id: string, transcript: string) => ({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript });
const said = (item_id: string, transcript: string) => ({ type: "response.output_audio_transcript.done", item_id, transcript });
const committed = (item_id: string) => ({ type: "input_audio_buffer.committed", item_id });
const retrieved = (id: string, audio: string) => ({ type: "conversation.item.retrieved", item: { id, type: "message", role: "user", content: [{ type: "input_audio", audio, transcript: "" }] } });
const greeting = { type: "response.create", response: { instructions: "Say exactly this, and nothing else: \"Tell me what you worked on.\"" } };

test("opens straight into listening, and prompts the worker only after two seconds of silence", () => {
  jest.useFakeTimers();
  try {
    const { relay, deps, sent } = harness();
    relay.open(); relay.open();
    expect(sent).toEqual([]);
    expect(jest.mocked(deps.onPhase).mock.calls.map(call => call[0])).toEqual(["listening"]);
    jest.advanceTimersByTime(1999);
    expect(sent).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(sent).toEqual([greeting]);
    jest.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(1);
  } finally { jest.useRealTimers(); }
});

test("a worker who starts talking first is not prompted, and neither is a call that already ended", () => {
  jest.useFakeTimers();
  try {
    const talking = harness();
    talking.relay.open();
    talking.relay.handle({ type: "input_audio_buffer.speech_started" });
    jest.advanceTimersByTime(5000);
    expect(talking.sent).toEqual([]);

    const closed = harness();
    closed.relay.open(); closed.relay.close();
    jest.advanceTimersByTime(5000);
    expect(closed.sent).toEqual([]);
  } finally { jest.useRealTimers(); }
});

test("accumulates labelled lines in conversation order and injects the state note without a response", async () => {
  const { relay, deps, sent } = harness();
  relay.handle(JSON.stringify(assistant("a1")));
  relay.handle(said("a1", "What did you work on?"));
  relay.handle(user("u1")); relay.handle(assistant("a2"));
  // The assistant's next question is transcribed before the worker's slower input transcription arrives.
  relay.handle(said("a2", "What time did you start?"));
  relay.handle(heard("u1", " I sprayed field A. "));
  relay.handle(user("u2"));
  relay.handle(heard("u2", "Ten thirty."));
  await flush();
  expect(jest.mocked(deps.postState).mock.calls).toEqual([
    ["Assistant: What did you work on?\nWorker: I sprayed field A.\nAssistant: What time did you start?", 1],
    ["Assistant: What did you work on?\nWorker: I sprayed field A.\nAssistant: What time did you start?\nWorker: Ten thirty.", 2],
  ]);
  expect(relay.transcripts().worker).toBe("I sprayed field A.\n\nTen thirty.");
  const notes = sent.filter(event => event.type === "conversation.item.create");
  expect(notes).toHaveLength(2);
  expect(notes[1].item).toEqual({ type: "message", role: "system", content: [{ type: "input_text", text: stateResult(2).stateNote }] });
  expect(sent.some(event => event.type === "response.create")).toBe(false);
  expect(deps.onFields).toHaveBeenLastCalledWith(fields);
});

test("drops a state result older than the newest injected one, and skips failed extractions", async () => {
  const pending: ((value: VoiceStateResult<ExtractedLogFields>) => void)[] = [];
  const { relay, sent } = harness({ postState: jest.fn(() => new Promise<VoiceStateResult<ExtractedLogFields>>(resolve => pending.push(resolve))) });
  relay.handle(heard("u1", "First.")); relay.handle(heard("u2", "Second."));
  pending[1](stateResult(2)); await flush();
  pending[0](stateResult(1)); await flush();
  expect(sent.map(event => event.item.content[0].text)).toEqual([stateResult(2).stateNote]);

  const failing = harness({ postState: jest.fn(async () => { throw new Error("EXTRACTION_FAILED"); }) });
  failing.relay.handle(heard("u1", "Hello."));
  await flush();
  expect(failing.sent).toEqual([]);
  expect(failing.deps.onEnd).not.toHaveBeenCalled();
});

test("forwards a tool call to the check once and answers with the result, then asks for a response", async () => {
  const { relay, deps, sent } = harness();
  relay.handle(toolCall("call_1")); relay.handle(toolCall("call_1"));
  await flush();
  expect(deps.postCheck).toHaveBeenCalledTimes(1);
  expect(deps.postCheck).toHaveBeenCalledWith("{\"activity\":\"Spraying\",\"confirmed\":false}");
  expect(sent.map(event => event.type)).toEqual(["conversation.item.create", "response.create"]);
  expect(sent[0].item).toMatchObject({ type: "function_call_output", call_id: "call_1" });
  const output = JSON.parse(sent[0].item.output);
  expect(output).toMatchObject({ status: "needs_fields", saveRequested: false, prompt: "What time did you finish?" });
  expect(output.fields).not.toHaveProperty("notes");
  expect(deps.onEnd).not.toHaveBeenCalled();
  // Other tools and plain messages are ignored.
  relay.handle({ type: "response.done", response: { output: [{ type: "function_call", name: "other", call_id: "call_2", arguments: "{}" }, { type: "message" }] } });
  await flush();
  expect(deps.postCheck).toHaveBeenCalledTimes(1);
});

test("saveRequested ends the relay at once: no tool reply, no spoken goodbye requested", async () => {
  const { relay, deps, sent } = harness({ postCheck: jest.fn(async () => checkResult(true)) });
  relay.handle(heard("u1", "I sprayed field A from eight to ten with two liters of neem oil."));
  relay.handle(toolCall("call_save", "{\"confirmed\":true}"));
  await flush();
  expect(deps.onEnd).toHaveBeenCalledWith("confirmed", undefined);
  expect(sent.filter(event => event.item?.type === "function_call_output")).toHaveLength(0);
  expect(sent.some(event => event.type === "response.create")).toBe(false);
  // What was said is still available to the caller for the save.
  expect(relay.transcripts().worker).toBe("I sprayed field A from eight to ten with two liters of neem oil.");
});

test("tracks the model's audio after the end, so the caller can hang up once its last words have played", async () => {
  const { relay, deps } = harness({ postCheck: jest.fn(async () => checkResult(true)) });
  await expect(relay.quiet()).resolves.toBeUndefined();
  // The approval's reply ("Saving it now.") is still playing when its tool call is answered.
  relay.handle({ type: "output_audio_buffer.started" });
  relay.handle(toolCall("call_save", "{\"confirmed\":true}"));
  await flush();
  expect(deps.onEnd).toHaveBeenCalledWith("confirmed", undefined);
  let quiet = false;
  void relay.quiet().then(() => { quiet = true; });
  await flush();
  expect(quiet).toBe(false);
  relay.handle({ type: "output_audio_buffer.stopped" });
  await flush();
  expect(quiet).toBe(true);
  // Phases stop at the end: the screen has moved on to the save.
  expect(jest.mocked(deps.onPhase).mock.calls.map(call => call[0])).toEqual(["speaking", "thinking"]);

  const cut = harness();
  cut.relay.handle({ type: "output_audio_buffer.started" });
  const waiting = cut.relay.quiet();
  cut.relay.close();
  await expect(waiting).resolves.toBeUndefined();
});

test("silence stops the model mid-sentence", () => {
  const { relay, sent } = harness();
  relay.silence();
  expect(sent).toEqual([{ type: "response.cancel" }, { type: "output_audio_buffer.clear" }]);
});

test("reports whether the strict extraction of each turn has everything the log needs", async () => {
  let status: VoiceStateResult["status"] = "needs_fields";
  const { relay, deps } = harness({ postState: jest.fn(async (_transcript: string, turn: number) => stateResult(turn, status)) });
  relay.handle(heard("u1", "I sprayed field A."));
  await flush();
  status = "ready_to_confirm";
  relay.handle(heard("u2", "From five to six with two liters of neem oil."));
  await flush();
  expect(jest.mocked(deps.onReady).mock.calls).toEqual([[false], [true]]);
});

test("fetches each finished worker turn's audio and hands the turns back in conversation order", async () => {
  const { relay, sent } = harness();
  relay.handle(assistant("a1")); relay.handle(said("a1", "Tell me what you worked on."));
  relay.handle(committed("u1")); relay.handle(user("u1"));
  relay.handle(assistant("a2"));
  relay.handle(committed("u2"));
  expect(sent.filter(event => event.type === "conversation.item.retrieve")).toEqual([
    { type: "conversation.item.retrieve", item_id: "u1", event_id: "retrieve-u1" },
    { type: "conversation.item.retrieve", item_id: "u2", event_id: "retrieve-u2" },
  ]);
  const recording = relay.audio(1000);
  relay.handle(JSON.stringify(retrieved("u2", "BBBB")));
  expect(relay.recorded()).toEqual(["BBBB"]);
  relay.handle(retrieved("u1", "AAAA"));
  await expect(recording).resolves.toEqual(["AAAA", "BBBB"]);
});

test("noise, a failed fetch and a fetch that never arrives are left out without ending the call", async () => {
  jest.useFakeTimers();
  try {
    const { relay, deps } = harness();
    relay.handle(committed("u1")); relay.handle(committed("u2")); relay.handle(committed("u3")); relay.handle(committed("u4"));
    // Transcribed as nothing: a cough or a door, not speech.
    relay.handle(heard("u1", "")); relay.handle(retrieved("u1", "NOISE"));
    relay.handle({ type: "error", error: { type: "invalid_request_error", code: "item_not_found", message: "No such item.", event_id: "retrieve-u2" } });
    relay.handle(retrieved("u4", "DDDD"));
    expect(deps.onEnd).not.toHaveBeenCalled();
    const recording = relay.audio(3000);
    await jest.advanceTimersByTimeAsync(2999);
    let settled = false;
    void recording.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(recording).resolves.toEqual(["DDDD"]);
    // Nothing pending: answered at once.
    await expect(relay.audio(3000)).resolves.toEqual(["DDDD"]);
  } finally { jest.useRealTimers(); }
});

test("fatal errors and a failed check end the relay for the turn-based fallback; a busy response does not", async () => {
  const busy = harness();
  busy.relay.handle({ type: "error", error: { code: "conversation_already_has_active_response", message: "busy" } });
  expect(busy.deps.onEnd).not.toHaveBeenCalled();
  busy.relay.handle({ type: "error", error: { code: "session_expired", message: "Session expired." } });
  expect(busy.deps.onEnd).toHaveBeenCalledWith("failed", "Session expired.");
  busy.relay.handle(heard("u9", "Ignored after the end."));
  expect(busy.deps.postState).not.toHaveBeenCalled();

  const check = harness({ postCheck: jest.fn(async () => { throw new Error("Cannot reach Toph."); }) });
  check.relay.handle(toolCall("call_1"));
  await flush();
  expect(check.deps.onEnd).toHaveBeenCalledWith("failed", "Cannot reach Toph.");
  expect(check.sent).toEqual([]);
});

test("caps the number of worker turns and reports phases from the audio events", async () => {
  const { relay, deps } = harness({ maxTurns: 2 });
  relay.handle({ type: "input_audio_buffer.speech_started" });
  relay.handle({ type: "input_audio_buffer.speech_stopped" });
  relay.handle({ type: "output_audio_buffer.started" });
  relay.handle({ type: "output_audio_buffer.stopped" });
  expect(jest.mocked(deps.onPhase).mock.calls.map(call => call[0])).toEqual(["listening", "speaking", "listening"]);
  relay.handle(heard("u1", "One.")); relay.handle(heard("u2", "Two.")); relay.handle(heard("u3", "Three."));
  expect(deps.onEnd).toHaveBeenCalledWith("limit", undefined);
  expect(deps.postState).toHaveBeenCalledTimes(2);
  relay.handle("not json"); relay.handle(null);
});

test("close stops relaying late server replies", async () => {
  const { relay, sent } = harness();
  relay.handle(heard("u1", "Hello."));
  relay.close();
  await flush();
  expect(sent).toEqual([]);
});

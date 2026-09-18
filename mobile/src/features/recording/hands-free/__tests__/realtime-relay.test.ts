import type { ExtractedLogFields } from "@toph/contracts/transcription";
import type { VoiceCheckResult, VoiceStateResult } from "@toph/contracts/voice";
import { emptyExtraction } from "../../__tests__/transcription-fixture";
import { createRealtimeRelay, type RelayDeps } from "../realtime-relay";

const fields: ExtractedLogFields = { ...emptyExtraction, activity: "Spraying", notes: "Online voice log created." };
const stateResult = (turn: number): VoiceStateResult<ExtractedLogFields> => ({ turn, status: "needs_fields", missingFields: ["endTime"], problems: [], prompt: "What time did you finish?", fields, stateNote: `LOG STATE (authoritative, turn ${turn}): end=MISSING.` });
const checkResult = (saveRequested: boolean): VoiceCheckResult<ExtractedLogFields> => ({ status: saveRequested ? "ready_to_confirm" : "needs_fields", missingFields: saveRequested ? [] : ["endTime"], problems: [], prompt: "What time did you finish?", fields, saveRequested });
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const toolCall = (call_id: string, args = "{\"activity\":\"Spraying\",\"confirmed\":false}") => ({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", name: "check_log", call_id, arguments: args }] } });

function harness(overrides: Partial<RelayDeps> = {}) {
  const sent: Record<string, any>[] = [];
  const deps: RelayDeps = {
    send: event => sent.push(event), toolName: "check_log",
    postState: jest.fn(async (_transcript: string, turn: number) => stateResult(turn)),
    postCheck: jest.fn(async () => checkResult(false)),
    onPhase: jest.fn(), onFields: jest.fn(), onEnd: jest.fn(),
    ...overrides,
  };
  return { relay: createRealtimeRelay(deps), deps, sent };
}
const user = (id: string) => ({ type: "conversation.item.added", item: { id, type: "message", role: "user" } });
const assistant = (id: string) => ({ type: "conversation.item.added", item: { id, type: "message", role: "assistant" } });
const heard = (item_id: string, transcript: string) => ({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript });
const said = (item_id: string, transcript: string) => ({ type: "response.output_audio_transcript.done", item_id, transcript });

test("greets once when the channel opens", () => {
  const { relay, sent } = harness();
  relay.open(); relay.open();
  expect(sent).toEqual([{ type: "response.create" }]);
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

test("saveRequested hangs up at once: no tool reply, no spoken goodbye to wait for", async () => {
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
  expect(jest.mocked(deps.onPhase).mock.calls.map(call => call[0])).toEqual(["listening", "thinking", "speaking", "listening"]);
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

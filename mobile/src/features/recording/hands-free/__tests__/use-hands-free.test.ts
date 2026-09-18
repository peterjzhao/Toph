import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { ExtractedLogFields, TranscriptionResult } from "@toph/contracts/transcription";
import type { VoiceGuidance, VoiceSession } from "@toph/contracts/voice";
import type { RecordingAudio } from "../../local-drafts";
import type { RecorderStatus } from "../../use-recorder";
import { emptyExtraction, transcriptionContext } from "../../__tests__/transcription-fixture";
import { spoken } from "../turn-loop";
import { useHandsFree, type HandsFreeAdapters, type HandsFreeOptions } from "../use-hands-free";
import type { RealtimeCallbacks } from "../webrtc-adapter";

const fields: ExtractedLogFields = { ...emptyExtraction, activity: "Spraying" };
const ask: VoiceGuidance = { status: "needs_fields", prompt: "What time did you finish?", missingFields: ["endTime"] };
const readBack: VoiceGuidance = { status: "ready_to_confirm", prompt: "Spraying in Field A. Say save, or tell me what to change.", missingFields: [] };
const result = (voice: VoiceGuidance | null, text = "I sprayed field A."): TranscriptionResult => ({ text, transcript: text, fields, missingFields: [], extractionError: null, voice });
// Minted relative to now: a warmed secret is only handed to a call while it still has life left.
const session: VoiceSession = { clientSecret: "ek_test", expiresAt: new Date(Date.now() + 120_000).toISOString(), model: "gpt-realtime-2.1", connectUrl: "https://api.openai.com/v1/realtime/calls", dataChannel: "oai-events", toolName: "check_log", maxSessionSeconds: 300 };
const audio: RecordingAudio = { uri: "file:///cache/answer.m4a", mimeType: "audio/mp4", extension: "m4a" };
const callAudio: RecordingAudio = { uri: "file:///cache/call.wav", mimeType: "audio/wav", extension: "wav" };
/** 0.5 s of 24 kHz PCM16 silence, base64-encoded as a retrieved turn arrives. */
const turnAudio = btoa("\0".repeat(24_000));
const message = (event: Record<string, unknown>) => JSON.stringify(event);
const workerTurn = (id: string, transcript: string) => [
  message({ type: "input_audio_buffer.committed", item_id: id }),
  message({ type: "conversation.item.retrieved", item: { id, type: "message", role: "user", content: [{ type: "input_audio", audio: turnAudio }] } }),
  message({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript }),
];
const approval = message({ type: "response.done", response: { output: [{ type: "function_call", name: "check_log", call_id: "c1", arguments: "{\"confirmed\":true}" }] } });
const mounted: { unmount(): unknown }[] = [];
async function mount(options: HandsFreeOptions) {
  const hook = await renderHook((props: HandsFreeOptions) => useHandsFree(props), { initialProps: options });
  mounted.push(hook);
  return hook;
}
// Unmounting releases the session timers (the call's time limit), as it does in the app.
afterEach(async () => { for (const hook of mounted.splice(0)) await hook.unmount(); });
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };

function setup(overrides: { connect?: HandsFreeAdapters["connect"]; session?: () => Promise<VoiceSession>; microphone?: boolean } = {}) {
  const recorder = {
    status: "idle" as RecorderStatus, seconds: 0, metering: null as number | null, audio: null as RecordingAudio | null, error: "",
    start: jest.fn(async () => { recorder.status = "recording"; recorder.seconds = 0; recorder.audio = null; }),
    finish: jest.fn(async () => { recorder.status = "ready"; recorder.audio = audio; }),
    reset: jest.fn(() => { recorder.status = "idle"; recorder.audio = null; }),
  };
  const said: string[] = [];
  const adapters: HandsFreeAdapters = {
    api: {
      session: jest.fn(overrides.session ?? (async () => session)),
      state: jest.fn(async (_context, _transcript, turn: number) => ({ turn, status: "needs_fields" as const, missingFields: ["endTime"], problems: [], prompt: ask.prompt, fields, stateNote: `LOG STATE turn ${turn}` })),
      check: jest.fn(async () => ({ status: "ready_to_confirm" as const, missingFields: [], problems: [], prompt: readBack.prompt, fields, saveRequested: true })),
      confirm: jest.fn(async () => ({ transcript: "Save", intent: "save" as const })),
      speech: jest.fn(),
    },
    speaker: { speak: jest.fn(async (text: string) => { said.push(text); }), stop: jest.fn(async () => {}) },
    connect: overrides.connect ?? null,
    extract: jest.fn(async () => result(readBack)),
    requestMicrophone: jest.fn(async () => overrides.microphone ?? true),
    prepareCallAudio: jest.fn(async () => {}), haptic: jest.fn(), keepAwake: jest.fn(),
    writeRecording: jest.fn((_bytes: Uint8Array) => callAudio),
  };
  const options: HandsFreeOptions = {
    context: transcriptionContext, recorder, adapters, savedBannerMs: 10,
    appendClip: jest.fn(async () => result(readBack)), loadTranscript: jest.fn(), applyFields: jest.fn(),
    save: jest.fn(async () => ({ stored: true, synced: true, error: "" })), onReset: jest.fn(), onReview: jest.fn(),
    silence: { minSpeechMs: 100, silenceMs: 300 },
  };
  return { recorder, adapters, options, said };
}
type Hook = { rerender(props: HandsFreeOptions): Promise<void> | void };
/** Speaks, then falls silent, as the recorder's 100 ms level samples would report it. */
async function answer(hook: Hook, recorder: ReturnType<typeof setup>["recorder"], options: HandsFreeOptions) {
  for (const [seconds, level] of [[0.1, -20], [0.2, -20], [0.3, -20], [0.5, -58], [0.7, -58], [0.9, -58]]) {
    recorder.seconds = seconds; recorder.metering = level;
    await act(async () => { await hook.rerender({ ...options }); await flush(); });
  }
  await act(async () => { await hook.rerender({ ...options }); await flush(); });
}
function fakeCall() {
  const sent: Record<string, any>[] = [];
  const call = { send: jest.fn((event: Record<string, any>) => { sent.push(event); }), mute: jest.fn(), close: jest.fn() };
  let callbacks!: RealtimeCallbacks;
  const connect: NonNullable<HandsFreeAdapters["connect"]> = jest.fn(async (_session, given) => { callbacks = given; return call; });
  return { call, sent, connect, callbacks: () => callbacks };
}

test("without the WebRTC module the turn-based loop records until silence, confirms and saves", async () => {
  const { recorder, adapters, options, said } = setup();
  const hook = await mount(options);
  await act(async () => { void hook.result.current.start(); await flush(); });
  expect(options.onReset).toHaveBeenCalledTimes(1);
  expect(adapters.keepAwake).toHaveBeenCalledWith(true);
  expect(said).toEqual([spoken.opening]);
  expect(adapters.speaker.stop).toHaveBeenCalled(); // Playback is stopped before the microphone opens.
  expect(recorder.start).toHaveBeenCalledTimes(1);
  expect(hook.result.current).toMatchObject({ phase: "listening", transport: "turns", live: true });

  await answer(hook, recorder, options);
  expect(recorder.finish).toHaveBeenCalledTimes(1);
  expect(options.appendClip).toHaveBeenCalledWith({ audio, durationSeconds: 0.9, transcript: "" });
  expect(said.at(-1)).toBe(readBack.prompt);

  await answer(hook, recorder, options);
  expect(adapters.api.confirm).toHaveBeenCalledWith(audio, transcriptionContext);
  expect(options.save).toHaveBeenCalledTimes(1);
  expect(hook.result.current.phase).toBe("saved");
  expect(adapters.keepAwake).toHaveBeenLastCalledWith(false);
  expect(adapters.haptic).toHaveBeenCalledWith("saved");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(hook.result.current.phase).toBe("idle");
  expect(options.onReview).not.toHaveBeenCalled();
});

test("a blocked microphone is an error state and nothing is recorded", async () => {
  const { recorder, options } = setup({ microphone: false });
  const hook = await mount(options);
  await act(async () => { await hook.result.current.start(); });
  expect(hook.result.current).toMatchObject({ phase: "error", live: false });
  expect(recorder.start).not.toHaveBeenCalled();
  await act(async () => { hook.result.current.stop(); });
  expect(hook.result.current.phase).toBe("idle");
});

test("realtime: relays state and the tool call, saves on approval with the recording, and lets the model finish its sentence", async () => {
  const rtc = fakeCall();
  const { adapters, options, recorder } = setup({ connect: rtc.connect });
  const hook = await mount(options);
  await act(async () => { await hook.result.current.start(); });
  expect(adapters.prepareCallAudio).toHaveBeenCalled();
  expect(recorder.start).not.toHaveBeenCalled();
  await act(async () => { rtc.callbacks().onOpen(); });
  expect(rtc.sent).toEqual([]);
  expect(hook.result.current.transport).toBe("realtime");

  await act(async () => {
    rtc.callbacks().onMessage(message({ type: "response.output_audio_transcript.done", item_id: "a1", transcript: "What did you work on?" }));
    workerTurn("u1", "I sprayed field A.").forEach(rtc.callbacks().onMessage);
    await flush();
  });
  expect(adapters.api.state).toHaveBeenCalledWith(transcriptionContext, "Assistant: What did you work on?\nWorker: I sprayed field A.", 1);
  expect(rtc.sent).toContainEqual({ type: "conversation.item.retrieve", item_id: "u1", event_id: "retrieve-u1" });
  expect(rtc.sent.at(-1)).toMatchObject({ type: "conversation.item.create", item: { role: "system" } });

  await act(async () => {
    // The approval's reply ("Saving it now.") is still playing when its tool call arrives.
    rtc.callbacks().onMessage(message({ type: "output_audio_buffer.started" }));
    rtc.callbacks().onMessage(approval);
    await flush();
  });
  expect(adapters.api.check).toHaveBeenCalledWith("{\"confirmed\":true}");
  expect(adapters.extract).toHaveBeenCalledWith("Assistant: What did you work on?\nWorker: I sprayed field A.", transcriptionContext);
  // The worker's turn is the log's recording: one WAV, carrying the transcript so it is not transcribed again.
  const wav = jest.mocked(adapters.writeRecording).mock.calls[0][0];
  expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
  expect(options.loadTranscript).toHaveBeenCalledWith([{ audio: callAudio, durationSeconds: 0.5, transcript: "I sprayed field A." }], "");
  expect(options.applyFields).toHaveBeenCalledWith(fields);
  expect(options.save).toHaveBeenCalledTimes(1);
  expect(hook.result.current.phase).toBe("saved");
  expect(rtc.sent.find(event => event.item?.type === "function_call_output")).toBeUndefined();
  // The save does not wait for the model, and the model is not cut off: the call stays up, muted, until it finishes.
  expect(rtc.call.mute).toHaveBeenCalledTimes(1);
  expect(rtc.call.close).not.toHaveBeenCalled();
  await act(async () => { rtc.callbacks().onMessage(message({ type: "output_audio_buffer.stopped" })); await flush(); });
  expect(rtc.call.close).toHaveBeenCalledTimes(1);
});

test("realtime: a model that never reports the end of its sentence is hung up on after lastWordsMs", async () => {
  jest.useFakeTimers();
  try {
    const rtc = fakeCall();
    const { options } = setup({ connect: rtc.connect });
    const hook = await mount({ ...options, lastWordsMs: 6000 });
    await act(async () => { await hook.result.current.start(); rtc.callbacks().onOpen(); });
    await act(async () => {
      rtc.callbacks().onMessage(message({ type: "output_audio_buffer.started" }));
      rtc.callbacks().onMessage(approval);
      await flush();
    });
    expect(options.save).toHaveBeenCalledTimes(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(5999); });
    expect(rtc.call.close).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(rtc.call.close).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test("realtime: once the strict extraction has everything, a tap saves: the model stops, the call ends and the log is stored", async () => {
  const rtc = fakeCall();
  const { adapters, options } = setup({ connect: rtc.connect });
  jest.mocked(adapters.api.state).mockImplementation(async (_context, _transcript, turn: number) => ({ turn, status: "ready_to_confirm", missingFields: [], problems: [], prompt: readBack.prompt, fields, stateNote: "LOG STATE ready" }));
  const hook = await mount(options);
  await act(async () => { await hook.result.current.start(); rtc.callbacks().onOpen(); });
  expect(hook.result.current.ready).toBe(false);
  await act(async () => {
    workerTurn("u1", "I sprayed field A from five to six with two liters of neem oil.").forEach(rtc.callbacks().onMessage);
    rtc.callbacks().onMessage(message({ type: "output_audio_buffer.started" }));
    await flush();
  });
  expect(hook.result.current).toMatchObject({ phase: "speaking", ready: true });

  await act(async () => { hook.result.current.saveNow(); await flush(); });
  // Cut off on purpose: the worker asked to save.
  expect(rtc.sent.slice(-2)).toEqual([{ type: "response.cancel" }, { type: "output_audio_buffer.clear" }]);
  expect(rtc.call.mute).toHaveBeenCalled();
  expect(rtc.call.close).toHaveBeenCalledTimes(1);
  expect(adapters.extract).toHaveBeenCalledWith("Worker: I sprayed field A from five to six with two liters of neem oil.", transcriptionContext);
  expect(options.loadTranscript).toHaveBeenCalledWith([{ audio: callAudio, durationSeconds: 0.5, transcript: "I sprayed field A from five to six with two liters of neem oil." }], "");
  expect(options.save).toHaveBeenCalledTimes(1);
  expect(hook.result.current).toMatchObject({ phase: "saved", ready: false });
  expect(options.onReview).not.toHaveBeenCalled();
});

test("turn by turn, a complete log is saved by a tap without waiting for the spoken confirmation", async () => {
  const { recorder, adapters, options } = setup();
  const hook = await mount(options);
  await act(async () => { void hook.result.current.start(); await flush(); });
  expect(hook.result.current.ready).toBe(false);
  await answer(hook, recorder, options);
  // The read-back has been spoken and the microphone is open for the reply.
  expect(hook.result.current).toMatchObject({ phase: "listening", ready: true });

  await act(async () => { hook.result.current.saveNow(); await flush(); });
  expect(recorder.reset).toHaveBeenCalled();
  expect(adapters.api.confirm).not.toHaveBeenCalled();
  expect(options.save).toHaveBeenCalledTimes(1);
  expect(hook.result.current).toMatchObject({ phase: "saved", ready: false });
  expect(options.onReview).not.toHaveBeenCalled();
});

test("stopping a call hands the review form the recording along with what was said", async () => {
  const rtc = fakeCall();
  const { options } = setup({ connect: rtc.connect });
  const hook = await mount(options);
  await act(async () => { await hook.result.current.start(); rtc.callbacks().onOpen(); });
  await act(async () => { workerTurn("u1", "I sprayed field A.").forEach(rtc.callbacks().onMessage); await flush(); });
  await act(async () => { hook.result.current.stop(true); });
  expect(rtc.call.close).toHaveBeenCalledTimes(1);
  expect(options.loadTranscript).toHaveBeenCalledWith([{ audio: callAudio, durationSeconds: 0.5, transcript: "I sprayed field A." }], "");
  expect(options.onReview).toHaveBeenCalledTimes(1);
});

test("thinking and speaking take turns without a buzz; listening and the save still buzz", async () => {
  const rtc = fakeCall();
  const { adapters, options } = setup({ connect: rtc.connect });
  jest.mocked(adapters.api.check).mockResolvedValue({ status: "needs_fields", missingFields: ["endTime"], problems: [], prompt: ask.prompt, fields, saveRequested: false });
  const hook = await mount(options);
  await act(async () => { await hook.result.current.start(); });
  await act(async () => { rtc.callbacks().onOpen(); });
  const step = async (event: Record<string, unknown>) => act(async () => { rtc.callbacks().onMessage(message(event)); await flush(); });
  await step({ type: "output_audio_buffer.started" });
  await step({ type: "response.done", response: { output: [{ type: "function_call", name: "check_log", call_id: "c1", arguments: "{}" }] } });
  expect(hook.result.current.phase).toBe("thinking");
  await step({ type: "output_audio_buffer.started" });
  expect(hook.result.current.phase).toBe("speaking");
  await step({ type: "output_audio_buffer.stopped" });
  expect(jest.mocked(adapters.haptic).mock.calls.map(call => call[0])).toEqual(["connecting", "listening", "speaking", "listening"]);
});

test("realtime: details still missing at the final extraction open the form instead of saving", async () => {
  const rtc = fakeCall();
  const { adapters, options } = setup({ connect: rtc.connect });
  jest.mocked(adapters.extract).mockResolvedValue(result(ask));
  const hook = await mount(options);
  await act(async () => { await hook.result.current.start(); rtc.callbacks().onOpen(); });
  await act(async () => {
    rtc.callbacks().onMessage({ type: "response.done", response: { output: [{ type: "function_call", name: "check_log", call_id: "c1", arguments: "{}" }] } });
    await flush();
  });
  expect(options.save).not.toHaveBeenCalled();
  expect(rtc.call.close).toHaveBeenCalledTimes(1);
  expect(options.onReview).toHaveBeenCalledWith("Some details are still missing.");
  expect(hook.result.current.phase).toBe("idle");
});

test("a failed session request falls back to the turn-based loop", async () => {
  const rtc = fakeCall();
  const { recorder, options, said } = setup({ connect: rtc.connect, session: async () => { throw new Error("Voice conversation is unavailable."); } });
  const hook = await mount(options);
  await act(async () => { void hook.result.current.start(); await flush(); });
  // The microphone and offer are prepared alongside the session request, so that call is closed again.
  expect(rtc.call.close).toHaveBeenCalledTimes(1);
  expect(said).toEqual([spoken.opening]);
  expect(recorder.start).toHaveBeenCalledTimes(1);
  expect(hook.result.current.transport).toBe("turns");
});

test("a call that drops mid-session is closed and continues by turns with the transcript so far", async () => {
  const rtc = fakeCall();
  const { adapters, options, said, recorder } = setup({ connect: rtc.connect });
  jest.mocked(adapters.extract).mockResolvedValue(result(ask));
  const hook = await mount(options);
  await act(async () => { await hook.result.current.start(); rtc.callbacks().onOpen(); });
  await act(async () => {
    rtc.callbacks().onMessage({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "I sprayed field A from eight." });
    await flush();
    rtc.callbacks().onDown("The voice call was disconnected.");
    rtc.callbacks().onDown("again");
    await flush();
  });
  expect(rtc.call.close).toHaveBeenCalledTimes(1);
  expect(options.loadTranscript).toHaveBeenCalledWith([], "I sprayed field A from eight.");
  expect(adapters.extract).toHaveBeenCalledTimes(1);
  // The extraction still misses the end time, so a tap stops rather than saves.
  expect(hook.result.current.ready).toBe(false);
  expect(options.applyFields).toHaveBeenCalledWith(fields);
  expect(said).toEqual([ask.prompt]);
  expect(recorder.start).toHaveBeenCalledTimes(1);
  expect(hook.result.current).toMatchObject({ transport: "turns", phase: "listening" });
});

test("a tap, Review on screen, and unmount all close the call; what was said reaches the review form", async () => {
  const rtc = fakeCall();
  const { options } = setup({ connect: rtc.connect });
  const hook = await mount(options);
  await act(async () => { await hook.result.current.start(); rtc.callbacks().onOpen(); });
  await act(async () => { rtc.callbacks().onMessage({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "I sprayed field A." }); await flush(); });
  await act(async () => { hook.result.current.stop(true); });
  expect(rtc.call.close).toHaveBeenCalledTimes(1);
  expect(options.loadTranscript).toHaveBeenCalledWith([], "I sprayed field A.");
  expect(options.applyFields).toHaveBeenCalledWith(fields);
  expect(options.onReview).toHaveBeenCalledTimes(1);
  expect(hook.result.current.phase).toBe("idle");

  const second = fakeCall();
  const next = setup({ connect: second.connect });
  const other = await renderHook((props: HandsFreeOptions) => useHandsFree(props), { initialProps: next.options });
  await act(async () => { await other.result.current.start(); });
  await other.unmount();
  expect(second.call.close).toHaveBeenCalledTimes(1);
  expect(next.options.onReview).not.toHaveBeenCalled();
});

test("cancelling while a clip is being recorded resets the recorder", async () => {
  const { recorder, options } = setup();
  const hook = await mount(options);
  await act(async () => { void hook.result.current.start(); await flush(); });
  await act(async () => { hook.result.current.stop(); await flush(); });
  expect(recorder.reset).toHaveBeenCalledTimes(1);
  expect(options.appendClip).not.toHaveBeenCalled();
  expect(options.onReview).not.toHaveBeenCalled();
  expect(hook.result.current.phase).toBe("idle");
});

test("leaving the foreground hangs up; the permission prompt's inactive state does not", async () => {
  const subscribe = jest.spyOn(AppState, "addEventListener");
  const rtc = fakeCall();
  const { options } = setup({ connect: rtc.connect });
  const hook = await mount(options);
  await act(async () => { await hook.result.current.start(); rtc.callbacks().onOpen(); });
  const listeners = subscribe.mock.calls.map(call => call[1] as (state: string) => void);
  await act(async () => { listeners.forEach(listener => listener("inactive")); });
  expect(rtc.call.close).not.toHaveBeenCalled();
  await act(async () => { listeners.forEach(listener => listener("background")); });
  expect(rtc.call.close).toHaveBeenCalledTimes(1);
  expect(hook.result.current.phase).toBe("idle");
});

test("the call is ended at the server's session limit and the form opens with what was said", async () => {
  jest.useFakeTimers();
  try {
    const rtc = fakeCall();
    const { options } = setup({ connect: rtc.connect, session: async () => ({ ...session, maxSessionSeconds: 60 }) });
    const hook = await mount(options);
    await act(async () => { await hook.result.current.start(); rtc.callbacks().onOpen(); });
    await act(async () => { jest.advanceTimersByTime(59_000); });
    expect(rtc.call.close).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(rtc.call.close).toHaveBeenCalledTimes(1);
    expect(options.onReview).toHaveBeenCalledWith("The voice conversation reached its time limit.");
  } finally { jest.useRealTimers(); }
});

test("a data channel that never opens falls back to the turn-based loop", async () => {
  jest.useFakeTimers();
  try {
    const rtc = fakeCall();
    const { options, said } = setup({ connect: rtc.connect });
    const hook = await mount({ ...options, connectTimeoutMs: 5000 });
    await act(async () => { await hook.result.current.start(); });
    await act(async () => { jest.advanceTimersByTime(5001); await flush(); });
    expect(rtc.call.close).toHaveBeenCalledTimes(1);
    expect(said).toEqual([spoken.opening]);
    expect(hook.result.current.transport).toBe("turns");
  } finally { jest.useRealTimers(); }
});

test("a session warmed before the tap is used for the call instead of minting on the tap", async () => {
  const rtc = fakeCall();
  const { adapters, options } = setup({ connect: rtc.connect });
  const hook = await mount(options);
  await act(async () => { hook.result.current.prewarm(); hook.result.current.prewarm(); await flush(); });
  expect(adapters.api.session).toHaveBeenCalledTimes(1);
  // The audio route is configured while the worker is still deciding, not on the tap.
  expect(adapters.prepareCallAudio).toHaveBeenCalled();

  await act(async () => { await hook.result.current.start(); });
  expect(adapters.api.session).toHaveBeenCalledTimes(1);
  await act(async () => { rtc.callbacks().onOpen(); });
  expect(hook.result.current).toMatchObject({ transport: "realtime", phase: "listening" });
});

test("a failed prewarm still lets the tap start a call, by minting a fresh session", async () => {
  const rtc = fakeCall();
  let minted = 0;
  const { adapters, options } = setup({
    connect: rtc.connect,
    session: async () => { minted += 1; if (minted === 1) throw new Error("Voice conversation is busy."); return session; },
  });
  const hook = await mount(options);
  await act(async () => { hook.result.current.prewarm(); await flush(); });
  await act(async () => { await hook.result.current.start(); rtc.callbacks().onOpen(); });
  expect(adapters.api.session).toHaveBeenCalledTimes(2);
  expect(hook.result.current).toMatchObject({ transport: "realtime", phase: "listening" });
});

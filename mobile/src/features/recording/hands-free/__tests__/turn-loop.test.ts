import type { TranscriptionResult } from "@toph/contracts/transcription";
import type { VoiceConfirmResult, VoiceGuidance } from "@toph/contracts/voice";
import type { RecordingClip } from "../../local-drafts";
import { emptyExtraction } from "../../__tests__/transcription-fixture";
import { runTurnLoop, spoken, type SaveOutcome, type TurnLoopDeps } from "../turn-loop";

const ask: VoiceGuidance = { status: "needs_fields", prompt: "What time did you finish?", missingFields: ["endTime"] };
const readBack: VoiceGuidance = { status: "ready_to_confirm", prompt: "Spraying in Field A. Say save, or tell me what to change.", missingFields: [] };
const result = (voice: VoiceGuidance | null, text = "speech"): TranscriptionResult => ({ text, transcript: text, fields: voice ? { ...emptyExtraction } : null, missingFields: [], extractionError: voice ? null : "Details could not be filled.", voice });
let clipNumber = 0;
const clip = (): RecordingClip => ({ audio: { uri: `file:///clip-${++clipNumber}.m4a`, mimeType: "audio/mp4", extension: "m4a" }, durationSeconds: 2, transcript: "" });
const stored: SaveOutcome = { stored: true, synced: true, error: "" };

function harness(script: { clips?: (RecordingClip | null)[]; results?: (TranscriptionResult | null)[]; replies?: VoiceConfirmResult[]; save?: SaveOutcome }) {
  const log: string[] = [];
  const clips = [...(script.clips ?? [])], results = [...(script.results ?? [])], replies = [...(script.replies ?? [])];
  let recording = false;
  const deps: TurnLoopDeps = {
    record: jest.fn(async () => { recording = true; log.push("record"); const next = clips.length ? clips.shift()! : clip(); recording = false; return next; }),
    process: jest.fn(async () => { log.push("process"); return results.shift() ?? null; }),
    confirm: jest.fn(async () => { log.push("confirm"); return replies.shift()!; }),
    speak: jest.fn(async text => { expect(recording).toBe(false); log.push(`say:${text}`); }),
    save: jest.fn(async () => { log.push("save"); return script.save ?? stored; }),
    onPhase: jest.fn(), stopped: () => false,
  };
  return { deps, log };
}
beforeEach(() => { clipNumber = 0; });

test("asks for missing facts, reads the log back, and saves on a spoken save", async () => {
  const { deps, log } = harness({ results: [result(ask), result(readBack)], replies: [{ transcript: "Save", intent: "save" }] });
  expect(await runTurnLoop(deps)).toEqual({ end: "saved", message: "" });
  expect(log).toEqual([`say:${spoken.opening}`, "record", "process", `say:${ask.prompt}`, "record", "process", `say:${readBack.prompt}`, "record", "confirm", "save", `say:${spoken.saved}`]);
  expect(jest.mocked(deps.onPhase).mock.calls.map(call => call[0])).toEqual(["speaking", "listening", "thinking", "speaking", "listening", "thinking", "speaking", "listening", "thinking", "speaking"]);
});

test("a correction is appended with its transcript, re-extracted, and read back again", async () => {
  const { deps, log } = harness({ results: [result(readBack), result(readBack)], replies: [{ transcript: "Actually it ended at four", intent: "change" }, { transcript: "Yes", intent: "save" }] });
  expect((await runTurnLoop(deps)).end).toBe("saved");
  expect(jest.mocked(deps.process).mock.calls[1][0]).toMatchObject({ transcript: "Actually it ended at four", audio: { uri: "file:///clip-2.m4a" } });
  expect(log.filter(entry => entry === "confirm")).toHaveLength(2);
});

test("cancel keeps the draft and never saves", async () => {
  const { deps, log } = harness({ results: [result(readBack)], replies: [{ transcript: "Never mind", intent: "cancel" }] });
  expect((await runTurnLoop(deps)).end).toBe("cancelled");
  expect(deps.save).not.toHaveBeenCalled();
  expect(log.at(-1)).toBe(`say:${spoken.cancelled}`);
});

test("an unclear or silent reply is asked again twice, then the review form takes over", async () => {
  const { deps, log } = harness({ clips: [clip(), clip(), null, clip()], results: [result(readBack)], replies: [{ transcript: "Hmm", intent: "unclear" }, { transcript: "", intent: "unclear" }] });
  expect((await runTurnLoop(deps)).end).toBe("review");
  expect(log.filter(entry => entry === `say:${spoken.confirmAgain}`)).toHaveLength(2);
  expect(deps.confirm).toHaveBeenCalledTimes(2); // The silent reply is not uploaded.
  expect(deps.save).not.toHaveBeenCalled();
  expect(log.at(-1)).toBe(`say:${spoken.review}`);
});

test("follow-up questions are capped", async () => {
  const { deps } = harness({ results: Array(10).fill(result(ask)) });
  expect((await runTurnLoop({ ...deps, limits: { maxFollowUps: 2 } })).end).toBe("review");
  expect(deps.process).toHaveBeenCalledTimes(3);
});

test("no guidance, a failed transcription, or a thrown error all fall back to the review form", async () => {
  const none = harness({ results: [result(null)] });
  expect(await runTurnLoop(none.deps)).toEqual({ end: "review", message: "Details could not be filled." });
  const older = harness({ results: [{ ...result(ask), voice: undefined }] });
  expect((await runTurnLoop(older.deps)).end).toBe("review");
  const failed = harness({ results: [null] });
  expect((await runTurnLoop(failed.deps)).end).toBe("review");
  const thrown = harness({ results: [result(readBack)] });
  thrown.deps.confirm = jest.fn(async () => { throw new Error("Cannot reach Toph."); });
  expect(await runTurnLoop(thrown.deps)).toEqual({ end: "review", message: "Cannot reach Toph." });
});

test("a failed save opens the review form; a device-only save is said aloud", async () => {
  const failed = harness({ results: [result(readBack)], replies: [{ transcript: "Save", intent: "save" }], save: { stored: false, synced: false, error: "Choose product." } });
  expect(await runTurnLoop(failed.deps)).toEqual({ end: "review", message: "Choose product." });
  const offline = harness({ results: [result(readBack)], replies: [{ transcript: "Save", intent: "save" }], save: { stored: true, synced: false, error: "Saved on this device." } });
  expect((await runTurnLoop(offline.deps)).end).toBe("saved");
  expect(offline.log.at(-1)).toBe(`say:${spoken.savedOnDevice}`);
});

test("continues a dropped realtime call from its guidance, and stops quietly when cancelled", async () => {
  const carried = harness({ results: [result(readBack)], replies: [{ transcript: "Save", intent: "save" }] });
  expect((await runTurnLoop(carried.deps, ask)).end).toBe("saved");
  expect(carried.log[0]).toBe(`say:${ask.prompt}`);
  const stopped = harness({});
  let calls = 0;
  expect((await runTurnLoop({ ...stopped.deps, stopped: () => ++calls > 1 })).end).toBe("stopped");
  expect(stopped.deps.record).not.toHaveBeenCalled();
});

test("silence at the very start ends the session without a review form", async () => {
  const { deps } = harness({ clips: [null, null, null] });
  expect((await runTurnLoop(deps)).end).toBe("cancelled");
  expect(deps.process).not.toHaveBeenCalled();
});

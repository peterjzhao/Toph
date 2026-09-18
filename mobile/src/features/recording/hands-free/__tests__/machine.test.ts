import { idleState, isLive, phaseDisplay, phaseHint, reduceHandsFree, type HandsFreeEvent, type HandsFreeState } from "../machine";
import { createSilenceDetector } from "../silence";

const play = (events: HandsFreeEvent[], from: HandsFreeState = idleState) => events.reduce(reduceHandsFree, from);

test("a session moves through connecting, listening, thinking, speaking and saved", () => {
  expect(play([{ type: "start" }])).toEqual({ phase: "connecting", transport: null, message: "", ready: false });
  const speaking = play([{ type: "start" }, { type: "transport", transport: "realtime" }, { type: "listening" }, { type: "thinking" }, { type: "speaking", text: "Which field?" }]);
  expect(speaking).toEqual({ phase: "speaking", transport: "realtime", message: "Which field?", ready: false });
  expect(play([{ type: "listening" }], speaking).message).toBe("");
  expect(play([{ type: "saved" }], speaking).phase).toBe("saved");
  expect(play([{ type: "saved" }, { type: "end" }], speaking)).toEqual(idleState);
});

test("late adapter events cannot revive an idle, saved or failed session", () => {
  expect(play([{ type: "listening" }, { type: "speaking", text: "late" }])).toEqual(idleState);
  const failed = play([{ type: "start" }, { type: "fail", message: "Microphone access is blocked." }]);
  expect(failed).toMatchObject({ phase: "error", message: "Microphone access is blocked." });
  expect(play([{ type: "listening" }, { type: "saved" }], failed)).toBe(failed);
  expect(play([{ type: "start" }], failed).phase).toBe("connecting");
});

test("once every detail is in, the tap saves instead of stopping, until the log is saved or the call ends", () => {
  const listening = play([{ type: "start" }, { type: "transport", transport: "realtime" }, { type: "listening" }]);
  expect(phaseHint(listening)).toBe("Speak now. Tap anywhere to stop");
  const ready = play([{ type: "ready", ready: true }], listening);
  expect(ready.ready).toBe(true);
  expect(phaseHint(ready)).toBe("Speak now. Tap anywhere to save");
  expect(phaseHint(play([{ type: "thinking" }], ready))).toBe("Tap anywhere to save");
  expect(phaseHint(play([{ type: "speaking", text: "Spraying in Field A." }], ready))).toBe("Tap anywhere to save");
  // A correction that leaves something missing goes back to stopping.
  expect(phaseHint(play([{ type: "ready", ready: false }], ready))).toBe("Speak now. Tap anywhere to stop");

  const saving = play([{ type: "saving" }], ready);
  expect(saving).toMatchObject({ phase: "saving", ready: false });
  expect(phaseHint(saving)).toBe(phaseDisplay.saving.hint);
  expect(play([{ type: "saved" }], saving)).toMatchObject({ phase: "saved", ready: false });
  // Saving and saved are the same black screen.
  expect(phaseDisplay.saving.background).toBe(phaseDisplay.saved.background);
  // A late verdict cannot mark an ended session ready.
  expect(play([{ type: "ready", ready: true }])).toBe(idleState);
  expect(play([{ type: "ready", ready: true }], saving)).toBe(saving);
});

test("start is ignored while a session is live, and every phase has a distinct readable display", () => {
  const listening = play([{ type: "start" }, { type: "listening" }]);
  expect(reduceHandsFree(listening, { type: "start" })).toBe(listening);
  expect(["connecting", "listening", "thinking", "speaking"].every(phase => isLive(phase as HandsFreeState["phase"]))).toBe(true);
  expect(isLive("saved") || isLive("error") || isLive("idle")).toBe(false);
  for (const display of Object.values(phaseDisplay)) expect(display.label && display.hint && display.background !== display.foreground).toBeTruthy();
  expect(new Set(["listening", "speaking", "saved", "error"].map(phase => phaseDisplay[phase as HandsFreeState["phase"]].background)).size).toBe(4);
});

describe("silence detector", () => {
  const feed = (detector: ReturnType<typeof createSilenceDetector>, levels: (number | null)[], stepMs = 100) => {
    let verdict = "continue", elapsed = 0;
    for (const level of levels) { verdict = detector.push(level, elapsed); elapsed += stepMs; if (verdict !== "continue") break; }
    return { verdict, elapsed };
  };
  test("stops after speech is followed by sustained silence", () => {
    const result = feed(createSilenceDetector({ silenceMs: 1000 }), [...Array(10).fill(-20), ...Array(30).fill(-55)]);
    expect(result.verdict).toBe("stop");
    expect(result.elapsed).toBeLessThanOrEqual(2200);
  });
  test("a pause shorter than the threshold does not end the clip", () => {
    expect(feed(createSilenceDetector({ silenceMs: 1000 }), [...Array(10).fill(-20), ...Array(6).fill(-55), ...Array(5).fill(-20), ...Array(6).fill(-55)]).verdict).toBe("continue");
  });
  test("reports an empty clip when nobody speaks, and caps the clip length", () => {
    expect(feed(createSilenceDetector({ noSpeechMs: 2000 }), Array(40).fill(-58)).verdict).toBe("empty");
    expect(feed(createSilenceDetector({ maxClipMs: 3000 }), Array(60).fill(-20)).verdict).toBe("stop");
  });
  test("without an input level the clip ends at a fixed length", () => {
    expect(feed(createSilenceDetector({ unmeteredClipMs: 1500 }), Array(30).fill(null)).verdict).toBe("stop");
  });
});

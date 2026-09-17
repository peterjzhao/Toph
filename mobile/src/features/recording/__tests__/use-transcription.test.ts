import { act, renderHook } from "@testing-library/react-native";
import type { RecordingClip } from "../local-drafts";
import { transcribeRecording } from "../transcribe";
import { useTranscription } from "../use-transcription";

jest.mock("../transcribe", () => ({ transcribeRecording: jest.fn() }));
const transcribe = jest.mocked(transcribeRecording);
const clip = (name: string, transcript = ""): RecordingClip => ({ audio: { uri: `file:///${name}.m4a`, extension: "m4a", mimeType: "audio/mp4" }, durationSeconds: 3, transcript });
beforeEach(() => transcribe.mockReset());

test("append preserves previous clips and concatenates transcripts in order", async () => {
  transcribe.mockResolvedValueOnce("First.").mockResolvedValueOnce("Second.");
  const { result } = await renderHook(() => useTranscription());
  await act(async () => { await result.current.append(clip("first")); });
  await act(async () => { await result.current.append(clip("second")); });
  expect(result.current.transcript).toEqual({ status: "done", text: "First.\n\nSecond.", message: "" });
  expect(result.current.clips).toHaveLength(2);
  expect(transcribe).toHaveBeenCalledTimes(2);
});

test("cancellation retains audio and late results cannot replace a newer recording", async () => {
  let finishOld!: (text: string) => void;
  transcribe.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const { result } = await renderHook(() => useTranscription());
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.append(clip("old")); });
  const signal = transcribe.mock.calls[0][1]!.signal!;
  await act(async () => { result.current.cancel(); });
  expect(signal.aborted).toBe(true);
  expect(result.current.clips).toHaveLength(1);
  expect(result.current.transcript.status).toBe("cancelled");
  await act(async () => { result.current.load([clip("new", "New transcript.")]); finishOld("Stale transcript."); await pending; });
  expect(result.current.transcript.text).toBe("New transcript.");
});

test("retry skips completed clips after a later clip fails", async () => {
  transcribe.mockResolvedValueOnce("First.").mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce("Second.");
  const { result } = await renderHook(() => useTranscription());
  await act(async () => { await result.current.run([clip("one"), clip("two")]); });
  expect(result.current.transcript).toMatchObject({ status: "error", text: "First." });
  await act(async () => { await result.current.run(); });
  expect(transcribe).toHaveBeenCalledTimes(3);
  expect(transcribe.mock.calls[2][0].uri).toBe("file:///two.m4a");
  expect(result.current.transcript.text).toBe("First.\n\nSecond.");
});

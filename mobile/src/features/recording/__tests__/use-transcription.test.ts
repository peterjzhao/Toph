import { act, renderHook } from "@testing-library/react-native";
import type { TranscriptionResult } from "@toph/contracts/transcription";
import type { RecordingClip } from "../local-drafts";
import { extractRecordingDetails, transcribeRecording } from "../transcribe";
import { useTranscription } from "../use-transcription";
import { transcriptResult, transcriptionContext } from "./transcription-fixture";

jest.mock("../transcribe", () => ({ transcribeRecording: jest.fn(), extractRecordingDetails: jest.fn() }));
const transcribe = jest.mocked(transcribeRecording);
const extract = jest.mocked(extractRecordingDetails);
const clip = (name: string, transcript = ""): RecordingClip => ({ audio: { uri: `file:///${name}.m4a`, extension: "m4a", mimeType: "audio/mp4" }, durationSeconds: 3, transcript });
const options = () => ({ context: transcriptionContext, onFields: jest.fn() });
beforeEach(() => { transcribe.mockReset(); extract.mockReset(); });

test("append combines all clips and applies structured suggestions", async () => {
  transcribe.mockResolvedValueOnce(transcriptResult("First.")).mockResolvedValueOnce(transcriptResult("Second.", "First.\n\nSecond."));
  const callbacks = options();
  const { result } = await renderHook(() => useTranscription(callbacks));
  await act(async () => { await result.current.append(clip("first")); });
  await act(async () => { await result.current.append(clip("second")); });
  expect(result.current.transcript).toMatchObject({ status: "done", text: "First.\n\nSecond." });
  expect(result.current.clips).toHaveLength(2);
  expect(transcribe.mock.calls[1][1].context.previousTranscript).toBe("First.");
  expect(callbacks.onFields).toHaveBeenCalledTimes(2);
  expect(extract).not.toHaveBeenCalled();
});
test("cancellation retains audio and late results cannot replace a newer recording or form", async () => {
  let finishOld!: (result: TranscriptionResult) => void;
  transcribe.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const callbacks = options();
  const { result } = await renderHook(() => useTranscription(callbacks));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.append(clip("old")); });
  const signal = transcribe.mock.calls[0][1].signal!;
  await act(async () => { result.current.cancel(); });
  expect(signal.aborted).toBe(true);
  expect(result.current.clips).toHaveLength(1);
  await act(async () => { result.current.load([clip("new", "New transcript.")]); finishOld(transcriptResult("Stale transcript.")); await pending; });
  expect(result.current.transcript.text).toBe("New transcript.");
  expect(callbacks.onFields).not.toHaveBeenCalled();
});
test("retry skips completed clips after a later clip fails", async () => {
  transcribe.mockResolvedValueOnce(transcriptResult("First.")).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(transcriptResult("Second.", "First.\n\nSecond."));
  const { result } = await renderHook(() => useTranscription(options()));
  await act(async () => { await result.current.run([clip("one"), clip("two")]); });
  expect(result.current.transcript).toMatchObject({ status: "error", text: "First." });
  await act(async () => { await result.current.run(); });
  expect(transcribe).toHaveBeenCalledTimes(3);
  expect(transcribe.mock.calls[2][0].uri).toBe("file:///two.m4a");
  expect(result.current.transcript.text).toBe("First.\n\nSecond.");
});
test("an extraction failure retains speech and retries without uploading audio again", async () => {
  transcribe.mockResolvedValueOnce({ ...transcriptResult("Good speech."), fields: null, extractionError: "Try again" });
  extract.mockResolvedValueOnce(transcriptResult("Good speech."));
  const callbacks = options();
  const { result } = await renderHook(() => useTranscription(callbacks));
  await act(async () => { await result.current.append(clip("one")); });
  expect(result.current.transcript).toMatchObject({ status: "error", text: "Good speech." });
  expect(callbacks.onFields).not.toHaveBeenCalled();
  await act(async () => { await result.current.run(); });
  expect(transcribe).toHaveBeenCalledTimes(1);
  expect(extract).toHaveBeenCalledTimes(1);
  expect(result.current.transcript.status).toBe("done");
});

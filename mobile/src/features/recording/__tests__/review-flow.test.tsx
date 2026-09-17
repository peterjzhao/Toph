import { act, fireEvent, render, screen } from "@testing-library/react-native";
import RecordingWorkspace from "../RecordingWorkspace";
import { transcribeRecording } from "../transcribe";
import type { RecorderStatus } from "../use-recorder";
import type { RecordingAudio } from "../local-drafts";

jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystem());
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("../AccountSheet", () => ({ __esModule: true, default: () => null }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../AudioReview", () => {
  const { Text } = require("react-native");
  return { __esModule: true, default: () => <Text>Recording player</Text> };
});
jest.mock("../transcribe", () => ({ transcribeRecording: jest.fn() }));
jest.mock("../use-recorder", () => ({ useRecorder: () => mockRecorder }));
jest.mock("@/lib/api/demo-client", () => ({
  apiOrigin: () => "https://toph.example", assetUrl: (value: string) => value,
  createDemoClient: () => ({ accounts: async () => { throw new Error("Test offline"); } }),
}));

const audio = { uri: "file:///cache/one.m4a", extension: "m4a", mimeType: "audio/mp4" };
const mockRecorder = {
  status: "recording" as RecorderStatus, audio: null as RecordingAudio | null,
  seconds: 3, levels: [3, 7, 9], isDemo: false, error: "",
  start: jest.fn(async () => { mockRecorder.status = "recording"; mockRecorder.audio = null; }),
  finish: jest.fn(async () => { mockRecorder.status = "stopping"; }),
  reset: jest.fn(() => { mockRecorder.status = "idle"; mockRecorder.audio = null; mockRecorder.seconds = 0; }),
  load: jest.fn(), pause: jest.fn(), resume: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRecorder.status = "recording";
  mockRecorder.audio = null;
  mockRecorder.seconds = 3;
});

test.each(["recording", "paused", "requesting"] as const)("cancel from %s resets the recording and clock", async (status) => {
  mockRecorder.status = status;
  await render(<RecordingWorkspace />);
  await fireEvent.press(screen.getByRole("button", { name: "Cancel recording" }));
  expect(mockRecorder.reset).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("0 seconds recorded")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Return to review" })).toBeNull();
});

test("paused recording offers Finish on the main button", async () => {
  mockRecorder.status = "paused";
  await render(<RecordingWorkspace />);
  expect(screen.getByText("Finish")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Resume recording" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  expect(mockRecorder.finish).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Review log")).toBeTruthy();
});

test("Back discards all clips, transcript and notes and resets the clock", async () => {
  jest.mocked(transcribeRecording).mockResolvedValue("Recorded work");
  const view = await render(<RecordingWorkspace />);
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace />);
  await screen.findByText("Recorded work");
  await fireEvent.changeText(screen.getByLabelText("Notes"), "Discard these notes");
  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(mockRecorder.reset).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("0 seconds recorded")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Return to review" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Write a note" }));
  expect(screen.queryByText("Recording player")).toBeNull();
  expect(screen.queryByText("Recorded work")).toBeNull();
  expect(screen.getByLabelText("Notes")).toHaveProp("value", "");
});

test("finish immediately shows the shared review skeleton, then the transcript without changing notes", async () => {
  let complete!: (text: string) => void;
  jest.mocked(transcribeRecording).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const view = await render(<RecordingWorkspace />);
  expect(screen.queryByText("Finish")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  expect(screen.getByText("Review log")).toBeTruthy();
  expect(screen.getByText("Finishing recording…")).toBeTruthy();
  expect(screen.getAllByTestId("review-skeleton").length).toBeGreaterThan(5);
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace />);
  expect(transcribeRecording).toHaveBeenCalledWith(audio, { signal: expect.anything() });
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Append recording" })).toBeEnabled();
  expect(screen.queryByLabelText("Notes")).toBeNull();
  await act(async () => { complete("I checked the irrigation in Field A."); });
  expect(screen.queryByTestId("review-skeleton")).toBeNull();
  expect(screen.getByText("I checked the irrigation in Field A.")).toBeTruthy();
  expect(screen.getByLabelText("Notes")).toHaveProp("value", "");
  expect(screen.queryByText("Transcription not set up")).toBeNull();
});

test("cancel keeps the recording and offers retry; append goes back to recording", async () => {
  jest.mocked(transcribeRecording).mockImplementation(() => new Promise(() => {}));
  const view = await render(<RecordingWorkspace />);
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace />);
  const signal = jest.mocked(transcribeRecording).mock.calls[0][1]!.signal!;
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByText("Recording player")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try transcribing again" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Append recording" }));
  expect(mockRecorder.start).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Finish recording" })).toBeTruthy();
});

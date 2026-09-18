import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { File } from "expo-file-system";
import type { TranscriptionResult } from "@toph/contracts/transcription";
import type { VoiceGuidance } from "@toph/contracts/voice";
import RecordingWorkspace from "../../RecordingWorkspace";
import { listDrafts, type RecordingAudio } from "../../local-drafts";
import { transcribeRecording } from "../../transcribe";
import type { RecorderStatus } from "../../use-recorder";
import { emptyExtraction } from "../../__tests__/transcription-fixture";
import { workerBootstrap, workspaceProps } from "../../__tests__/workspace-fixture";
import { spoken } from "../turn-loop";

jest.mock("expo-file-system", () => require("../../__tests__/fake-file-system").createFakeFileSystem());
jest.mock("expo-crypto", () => ({ randomUUID: () => "30000000-0000-4000-8000-000000000009" }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("../../AccountSheet", () => ({ __esModule: true, default: () => null }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../AudioReview", () => ({ __esModule: true, default: () => null }));
jest.mock("../../transcribe", () => ({ transcribeRecording: jest.fn(), extractRecordingDetails: jest.fn() }));
jest.mock("../../use-recorder", () => ({ useRecorder: () => mockRecorder }));
jest.mock("@/lib/api/mobile-client", () => ({
  apiOrigin: () => "https://toph.example", assetUrl: (value: string) => value,
  createMobileClient: () => ({ accounts: async () => { throw new Error("Test offline"); }, submit: (draft: { id: string }) => mockSubmit(draft) }),
}));
// The native adapters (audio, haptics, WebRTC) are replaced; this build has no realtime module.
jest.mock("../native-adapters", () => ({ createNativeAdapters: () => mockAdapters }));

const audio: RecordingAudio = { uri: "file:///cache/spoken.m4a", extension: "m4a", mimeType: "audio/mp4" };
const mockSubmit = jest.fn(async (draft: { id: string }) => ({ clientDraftId: draft.id, logId: "40000000-0000-4000-8000-000000000001", savedAt: "2026-09-17T10:00:00.000Z" }));
const mockSaid: string[] = [];
const mockAdapters = {
  api: { confirm: jest.fn(async () => ({ transcript: "Save", intent: "save" })), session: jest.fn() },
  speaker: { speak: jest.fn(async (text: string) => { mockSaid.push(text); }), stop: jest.fn(async () => {}) },
  connect: null as null | jest.Mock, extract: jest.fn(), requestMicrophone: jest.fn(async () => true), prepareCallAudio: jest.fn(), haptic: jest.fn(), keepAwake: jest.fn(),
  writeRecording: jest.fn(() => ({ uri: "file:///cache/call.wav", mimeType: "audio/wav", extension: "wav" })),
};
const mockRecorder = {
  status: "idle" as RecorderStatus, audio: null as RecordingAudio | null, seconds: 0, metering: null as number | null, levels: [3], error: "",
  start: jest.fn(async () => { mockRecorder.status = "recording"; mockRecorder.audio = null; mockRecorder.seconds = 0; }),
  finish: jest.fn(async () => { mockRecorder.status = "ready"; mockRecorder.audio = audio; }),
  reset: jest.fn(() => { mockRecorder.status = "idle"; mockRecorder.audio = null; mockRecorder.seconds = 0; }),
  load: jest.fn(), pause: jest.fn(), resume: jest.fn(),
};
const readBack: VoiceGuidance = { status: "ready_to_confirm", prompt: "Spraying in Field A on September 17. Say save, or tell me what to change.", missingFields: [] };
const complete: TranscriptionResult = {
  text: "I sprayed field A from eight to ten with two liters of neem oil.", transcript: "I sprayed field A from eight to ten with two liters of neem oil.", missingFields: [], extractionError: null, voice: readBack,
  fields: { ...emptyExtraction, fieldId: workerBootstrap.fields[0].id, activity: "Spraying", workDate: "2026-09-17", startTime: "08:00", endTime: "10:00", notes: "Online voice log created.\n\nSprayed Field A.", product: "Neem oil", amount: 2, unit: "L", details: { product: "Neem oil", amount: 2, unit: "L" } },
};
const Workspace = () => <RecordingWorkspace {...workspaceProps()} />;
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
/** Speech followed by silence, as the recorder's level samples would report it. */
async function speak(view: { rerender(element: React.ReactElement): Promise<void> | void }) {
  for (const [seconds, level] of [[0.2, -20], [0.6, -20], [1, -58], [2, -58], [3, -58], [3.2, -58]]) {
    mockRecorder.seconds = seconds; mockRecorder.metering = level;
    await act(async () => { await view.rerender(<Workspace />); await flush(); });
  }
  await act(async () => { await view.rerender(<Workspace />); await flush(); });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.requireMock("expo-file-system").reset();
  mockSaid.length = 0;
  const recorded = new File(audio.uri); recorded.create(); recorded.write("spoken audio");
  mockRecorder.status = "idle"; mockRecorder.audio = null; mockRecorder.seconds = 0; mockRecorder.metering = null;
});

test("home offers Record and Call mode; Record starts the normal recorder", async () => {
  await render(<Workspace />);
  expect(screen.getByRole("button", { name: "Start call mode" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Write a note" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Start recording" }));
  expect(mockRecorder.start).toHaveBeenCalledTimes(1);
  expect(mockAdapters.requestMicrophone).not.toHaveBeenCalled();
});

test("a spoken log is read back and saved through the review form's own save", async () => {
  jest.mocked(transcribeRecording).mockResolvedValue(complete);
  const view = await render(<Workspace />);
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Start call mode" })); await flush(); });
  expect(mockSaid).toEqual([spoken.opening]);
  expect(screen.getByText("Listening")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Review on screen" })).toBeTruthy();

  await speak(view);
  expect(transcribeRecording).toHaveBeenCalledTimes(1);
  expect(mockSaid.at(-1)).toBe(readBack.prompt);
  await speak(view);
  expect(mockAdapters.api.confirm).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockSaid.at(-1)).toBe(spoken.saved));
  expect(mockSubmit.mock.calls[0][0]).toMatchObject({ field: "FIELD A", activity: "Spraying", workDate: "2026-09-17", startTime: "08:00", endTime: "10:00", product: "Neem oil", amount: "2", unit: "L", transcript: complete.transcript });
  // Only the log's own clip is kept; the spoken "save" is classified and dropped.
  expect((mockSubmit.mock.calls[0][0] as unknown as { clips: unknown[] }).clips).toHaveLength(1);
  expect(mockSaid.at(-1)).toBe(spoken.saved);
  expect(screen.getByText("Saved")).toBeTruthy();
  const [draft] = await listDrafts();
  expect(draft.sync?.logId).toBe("40000000-0000-4000-8000-000000000001");
});

test("once the log is complete the screen offers Tap anywhere to save, and a tap saves it to the black Saved screen", async () => {
  jest.mocked(transcribeRecording).mockResolvedValue(complete);
  const view = await render(<Workspace />);
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Start call mode" })); await flush(); });
  expect(screen.getByText("Speak now. Tap anywhere to stop · Turn by turn")).toBeTruthy();

  await speak(view);
  expect(mockSaid.at(-1)).toBe(readBack.prompt);
  expect(screen.getByText("Speak now. Tap anywhere to save · Turn by turn")).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Listening. Save hands-free log" })); await flush(); });
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  // The spoken confirmation is not waited for.
  expect(mockAdapters.api.confirm).not.toHaveBeenCalled();
  expect(mockSubmit.mock.calls[0][0]).toMatchObject({ field: "FIELD A", activity: "Spraying", startTime: "08:00", endTime: "10:00", product: "Neem oil" });
  await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
});

test("Review on screen stops the session and opens the form with what was extracted", async () => {
  jest.mocked(transcribeRecording).mockResolvedValue({ ...complete, voice: { status: "needs_fields", prompt: "What time did you finish?", missingFields: ["endTime"] } });
  const view = await render(<Workspace />);
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Start call mode" })); await flush(); });
  await speak(view);
  expect(mockSaid.at(-1)).toBe("What time did you finish?");
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Review on screen" })); await flush(); });
  expect(mockRecorder.reset).toHaveBeenCalled();
  expect(screen.queryByText("Listening")).toBeNull();
  expect(screen.getByText(complete.transcript)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Append recording" })).toBeTruthy();
  expect(mockSubmit).not.toHaveBeenCalled();
});

test("the capture screen warms a realtime session before Call mode is tapped", async () => {
  mockAdapters.connect = jest.fn(async () => ({ send: jest.fn(), close: jest.fn() }));
  mockAdapters.api.session.mockResolvedValue({
    clientSecret: "ek_test", expiresAt: new Date(Date.now() + 120_000).toISOString(), model: "gpt-realtime-2.1",
    connectUrl: "https://api.openai.com/v1/realtime/calls", dataChannel: "oai-events", toolName: "check_log", maxSessionSeconds: 300,
  });
  try {
    await render(<Workspace />);
    // Nothing has been tapped: the secret and the audio route are already being prepared.
    await waitFor(() => expect(mockAdapters.api.session).toHaveBeenCalledTimes(1));
    expect(mockAdapters.prepareCallAudio).toHaveBeenCalled();

    await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Start call mode" })); await flush(); });
    // The tap spends the warmed secret rather than minting a second one.
    expect(mockAdapters.api.session).toHaveBeenCalledTimes(1);
    expect(mockAdapters.connect).toHaveBeenCalledTimes(1);
  } finally {
    mockAdapters.connect = null;
    mockAdapters.api.session.mockReset();
  }
});

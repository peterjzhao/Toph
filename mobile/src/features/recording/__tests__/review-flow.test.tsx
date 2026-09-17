import type { TranscriptionResult } from "@toph/contracts/transcription";
import type { MobileBootstrap } from "@toph/contracts/mobile";
import { transcriptResult } from "./transcription-fixture";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import RecordingWorkspace from "../RecordingWorkspace";
import { workspaceProps } from "./workspace-fixture";
import { transcribeRecording } from "../transcribe";
import type { RecorderStatus } from "../use-recorder";
import type { RecordingAudio } from "../local-drafts";
import { tokens } from "@toph/design";
import { File } from "expo-file-system";
import { listDrafts } from "../local-drafts";
import { readActivityItems } from "../activity-catalog";

jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystem());
jest.mock("expo-crypto", () => ({ randomUUID: () => "30000000-0000-4000-8000-000000000001" }));
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
jest.mock("@/lib/api/mobile-client", () => ({
  apiOrigin: () => "https://toph.example", assetUrl: (value: string) => value,
  createMobileClient: () => ({ accounts: async () => { if (mockBootstrap) return mockBootstrap; throw new Error("Test offline"); } }),
}));

const audio = { uri: "file:///cache/one.m4a", extension: "m4a", mimeType: "audio/mp4" };
let mockBootstrap: MobileBootstrap | null = null;
const defaultBootstrap: MobileBootstrap = {
  mode: "shared", revision: 1, maxAudioBytes: 3_800_000,
  farm: { id: "00000000-0000-4000-8000-000000000001", name: "Bays Ranch", timezone: "America/Los_Angeles" },
  fields: [{ id: "20000000-0000-4000-8000-000000000001", name: "FIELD A" }],
  accounts: [{ id: "10000000-0000-4000-8000-000000000001", name: "Isaac Wang", role: "Worker", email: "", phone: "", avatarUrl: null, defaultField: "FIELD A", defaultActivity: "Spraying" }],
};
function Workspace() {
  const bootstrap = mockBootstrap ?? defaultBootstrap;
  return <RecordingWorkspace {...workspaceProps(bootstrap)} />;
}
const mockRecorder = {
  status: "recording" as RecorderStatus, audio: null as RecordingAudio | null,
  seconds: 3, levels: [3, 7, 9], error: "",
  start: jest.fn(async () => { mockRecorder.status = "recording"; mockRecorder.audio = null; }),
  finish: jest.fn(async () => { mockRecorder.status = "stopping"; }),
  reset: jest.fn(() => { mockRecorder.status = "idle"; mockRecorder.audio = null; mockRecorder.seconds = 0; }),
  load: jest.fn(), pause: jest.fn(), resume: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.requireMock("expo-file-system").reset();
  mockBootstrap = null;
  mockRecorder.status = "recording";
  mockRecorder.audio = null;
  mockRecorder.seconds = 3;
});

test.each(["recording", "paused", "requesting"] as const)("cancel from %s resets the recording and clock", async (status) => {
  mockRecorder.status = status;
  await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await fireEvent.press(screen.getByRole("button", { name: "Cancel recording" }));
  expect(mockRecorder.reset).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("0 seconds recorded")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Return to review" })).toBeNull();
});

test("paused recording offers Finish on the main button", async () => {
  mockRecorder.status = "paused";
  await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  expect(screen.getByText("Finish")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Resume recording" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  expect(mockRecorder.finish).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Review log")).toBeNull();
});

test("Back discards all clips, transcript and notes and resets the clock", async () => {
  jest.mocked(transcribeRecording).mockResolvedValue(transcriptResult("Recorded work"));
  const view = await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await screen.findByText("Recorded work");
  await fireEvent.press(screen.getByRole("button", { name: "More details" }));
  await fireEvent.changeText(screen.getByLabelText("Summary"), "Discard these notes");
  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(mockRecorder.reset).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("0 seconds recorded")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Return to review" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Write a note" }));
  expect(screen.queryByText("Recording player")).toBeNull();
  expect(screen.queryByText("Recorded work")).toBeNull();
  expect(screen.getByLabelText("Summary")).toHaveProp("value", "");
  expect(screen.getByLabelText("Summary")).toHaveStyle({ borderColor: tokens.colors.border });
});

test("finish immediately shows the shared review skeleton, then the transcript without changing notes", async () => {
  let complete!: (result: TranscriptionResult) => void;
  jest.mocked(transcribeRecording).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const view = await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  expect(screen.queryByText("Finish")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  expect(screen.queryByText("Review log")).toBeNull();
  expect(screen.getByText("Finishing…")).toBeTruthy();
  expect(screen.getAllByTestId("review-skeleton").length).toBeGreaterThan(5);
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  expect(transcribeRecording).toHaveBeenCalledWith(audio, { signal: expect.anything(), context: expect.objectContaining({ accountId: expect.any(String), referenceDate: expect.any(String) }) });
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Append recording" })).toBeEnabled();
  expect(screen.queryByLabelText("Summary")).toBeNull();
  await act(async () => { complete(transcriptResult("I checked the irrigation in Field A.")); });
  expect(screen.queryByTestId("review-skeleton")).toBeNull();
  expect(screen.getByText("I checked the irrigation in Field A.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "More details" }));
  expect(screen.getByLabelText("Summary")).toHaveProp("value", "");
  for (const label of ["Field", "Activity", "Date", "Start time", "End time", "Summary"]) {
    expect(screen.getByLabelText(label)).toHaveStyle({ borderColor: tokens.colors.warning });
    expect(screen.getByLabelText(label)).toHaveProp("accessibilityHint", "Not found in recording. Review or enter this detail.");
  }
  expect(screen.getByTestId("review-tags")).toHaveStyle({ borderColor: tokens.colors.warning });
  expect(screen.queryByText("Transcription not set up")).toBeNull();
});

test("cancel keeps the recording and offers retry; append goes back to recording", async () => {
  jest.mocked(transcribeRecording).mockImplementation(() => new Promise(() => {}));
  const view = await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  const signal = jest.mocked(transcribeRecording).mock.calls[0][1]!.signal!;
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByText("Recording player")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try transcribing again" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Append recording" }));
  expect(mockRecorder.start).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Finish recording" })).toBeTruthy();
});

test("a completed recording fills every category in the actual review form", async () => {
  const accountId = "10000000-0000-4000-8000-000000000001";
  const fieldId = "20000000-0000-4000-8000-000000000002";
  mockBootstrap = { mode: "shared", revision: 1, maxAudioBytes: 3_800_000,
    farm: { id: accountId, name: "Bays Ranch", timezone: "America/Los_Angeles" },
    fields: [{ id: fieldId, name: "FIELD B" }],
    accounts: [{ id: accountId, name: "Isaac", role: "Worker", email: "", phone: "", avatarUrl: null, defaultField: "FIELD B", defaultActivity: "Spraying" }] };
  jest.mocked(transcribeRecording).mockResolvedValue({ ...transcriptResult("Sprayed Field B."), fields: {
    fieldId, activity: "Fertilizing", workDate: "2026-09-16", startTime: "06:00", endTime: "08:00",
    notes: "Completed the work.", product: "Water", amount: 2, unit: "L", tags: ["Equipment"],
    details: { product: "Water", amount: 2, unit: "L" },
  } });
  const view = await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await screen.findByText("Sprayed Field B.");
  await fireEvent.press(screen.getByRole("button", { name: "More details" }));
  for (const [label, text] of [["Field", "Field B"], ["Activity", "Fertilizing"], ["Date", "09/16/2026"], ["Start time", "06:00 AM"], ["End time", "08:00 AM"], ["Unit", "L"]]) {
    expect(screen.getByLabelText(label)).toHaveProp("accessibilityValue", { text });
  }
  expect(screen.getByLabelText("Summary")).toHaveProp("value", "Completed the work.");
  expect(screen.getByLabelText("Fertilizer")).toHaveProp("accessibilityValue", { text: "Water" });
  expect(screen.getByLabelText("Amount applied")).toHaveProp("value", "2");
  expect(screen.getByRole("togglebutton", { name: "Equipment" })).toHaveProp("accessibilityState", { checked: true });
  for (const label of ["Field", "Activity", "Date", "Start time", "End time", "Summary", "Fertilizer", "Amount applied", "Unit"]) {
    expect(screen.getByLabelText(label)).toHaveStyle({ borderColor: tokens.colors.brand });
  }
  expect(screen.getByTestId("review-tags")).toHaveStyle({ borderColor: tokens.colors.brand });
});

test("append keeps completed audio, transcript and fields visible, then refreshes parse borders", async () => {
  const first = transcriptResult("First recording.");
  first.fields!.notes = "Original notes";
  let complete!: (result: TranscriptionResult) => void;
  jest.mocked(transcribeRecording).mockResolvedValueOnce(first)
    .mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const view = await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await screen.findByText("First recording.");
  await fireEvent.press(screen.getByRole("button", { name: "More details" }));
  expect(screen.getByLabelText("Summary")).toHaveStyle({ borderColor: tokens.colors.brand });
  expect(screen.getByLabelText("Date")).toHaveStyle({ borderColor: tokens.colors.warning });
  await fireEvent.press(screen.getByRole("button", { name: "Append recording" }));
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  // Even while the new file is finishing, existing content stays visible.
  await fireEvent.press(screen.getByRole("button", { name: "More details" }));
  expect(screen.getByText("First recording.")).toBeVisible();
  expect(screen.getByText("Recording player")).toBeVisible();
  expect(screen.getByLabelText("Summary")).toHaveProp("value", "Original notes");
  mockRecorder.status = "ready"; mockRecorder.audio = { ...audio, uri: "file:///cache/two.m4a" };
  await view.rerender(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  expect(screen.getByText("First recording.")).toBeVisible();
  expect(screen.getByText("Recording player")).toBeVisible();
  expect(screen.getAllByTestId("review-skeleton").length).toBeGreaterThan(1);
  expect(screen.queryByLabelText("Date")).toBeNull();
  expect(screen.getByLabelText("Summary")).toHaveStyle({ borderColor: tokens.colors.brand });
  await fireEvent.changeText(screen.getByLabelText("Summary"), "Worker's own notes");
  const second = transcriptResult("Second recording.", "First recording.\n\nSecond recording.");
  second.fields!.workDate = "2026-09-17";
  await act(async () => { complete(second); });
  expect(screen.getByText("First recording.\n\nSecond recording.")).toBeVisible();
  expect(screen.getAllByText("Recording player")).toHaveLength(2);
  expect(screen.queryByTestId("review-skeleton")).toBeNull();
  expect(screen.getByLabelText("Date")).toHaveStyle({ borderColor: tokens.colors.brand });
  expect(screen.getByLabelText("Summary")).toHaveStyle({ borderColor: tokens.colors.warning });
  expect(screen.getByLabelText("Summary")).toHaveProp("value", "Worker's own notes");
});

test("activity forms save a new crop and its quantity on device and reopen them", async () => {
  const first = transcriptResult("Worked in the field.");
  first.fields = { ...first.fields!, activity: "Spraying", product: "Water", amount: 2, unit: "L", workDate: "2026-09-17", startTime: "06:00", endTime: "08:00" };
  jest.mocked(transcribeRecording).mockResolvedValueOnce(first);
  new File(audio.uri).write("AUDIO");
  const view = await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await screen.findByText("Worked in the field.");
  expect(screen.getByLabelText("Summary")).toBeVisible();
  expect(screen.queryByText("Tags")).toBeNull();
  expect(screen.queryByText(/Suggested details|Last transcription|Optional/)).toBeNull();

  await fireEvent.press(screen.getByLabelText("Activity"));
  await fireEvent.press(screen.getByRole("button", { name: "Fertilizing" }));
  expect(screen.getByLabelText("Fertilizer")).toHaveProp("accessibilityValue", { text: "" });
  expect(screen.getByLabelText("Unit")).toHaveProp("accessibilityValue", { text: "kg" });
  await fireEvent.press(screen.getByLabelText("Activity"));
  await fireEvent.press(screen.getByRole("button", { name: "Planting" }));
  expect(screen.queryByLabelText("Product")).toBeNull();
  expect(screen.getByLabelText("Crop / variety")).toHaveProp("accessibilityValue", { text: "" });
  expect(screen.getByLabelText("Plants planted")).toHaveProp("value", "");
  expect(screen.getByLabelText("Unit")).toHaveProp("accessibilityValue", { text: "plants" });
  await fireEvent.press(screen.getByRole("button", { name: "Save log" }));
  expect(screen.getByText("Choose crop / variety.")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Crop / variety"));
  await fireEvent.press(screen.getByRole("button", { name: "Add new…" }));
  await fireEvent.changeText(screen.getByLabelText("New crop / variety"), "Roma tomato");
  await fireEvent.press(screen.getByRole("button", { name: "Save choice" }));
  const { session } = workspaceProps(mockBootstrap ?? undefined);
  expect(readActivityItems("Planting", `${session.farm.id}:${session.account.id}`)).toEqual(["Roma tomato"]);
  await fireEvent.press(screen.getByRole("button", { name: "Save log" }));
  expect(screen.getByText("Enter plants planted greater than zero.")).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("Plants planted"), "50");
  await fireEvent.press(screen.getByRole("button", { name: "Save log" }));
  expect((await listDrafts())[0]).toMatchObject({ activity: "Planting", product: "Roma tomato", amount: "50", unit: "plants" });
  await view.unmount();

  mockRecorder.status = "idle"; mockRecorder.audio = null;
  await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await fireEvent.press(screen.getByRole("tab", { name: "Logs" }));
  await fireEvent.press(screen.getByRole("button", { name: /Planting · Field A/ }));
  expect(screen.getByLabelText("Crop / variety")).toHaveProp("accessibilityValue", { text: "Roma tomato" });
  expect(screen.getByLabelText("Plants planted")).toHaveProp("value", "50");
  await fireEvent.press(screen.getByLabelText("Crop / variety"));
  expect(screen.getByRole("button", { name: "Roma tomato" })).toBeTruthy();
});

test("an oak-tree amendment fills and remembers a new crop while only missing fields skeletonize", async () => {
  const initial = transcriptResult("I was planting in Field A yesterday from six AM to eight AM.");
  initial.fields = { ...initial.fields!, activity: "Planting", fieldId: defaultBootstrap.fields[0].id,
    workDate: "2026-09-16", startTime: "06:00", endTime: "08:00", notes: "Online voice log created.\n\nPlanting took place in Field A yesterday from 6 AM to 8 AM." };
  let complete!: (result: TranscriptionResult) => void;
  jest.mocked(transcribeRecording).mockResolvedValueOnce(initial)
    .mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const view = await render(<Workspace />);
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<Workspace />);
  await screen.findByText(initial.text);
  expect(screen.getByLabelText("Crop / variety")).toHaveStyle({ borderColor: tokens.colors.warning });
  const { session } = workspaceProps(mockBootstrap ?? undefined);
  const catalogScope = `${session.farm.id}:${session.account.id}`;
  expect(readActivityItems("Planting", catalogScope)).toEqual([]);
  expect(screen.getByRole("button", { name: "Append recording" })).toHaveStyle({ backgroundColor: tokens.colors.text, width: "100%" });
  await fireEvent.press(screen.getByRole("button", { name: "Append recording" }));
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = { ...audio, uri: "file:///cache/oaks.m4a" };
  await view.rerender(<Workspace />);
  expect(screen.getByText(initial.text)).toBeVisible();
  expect(screen.getByText("Recording player")).toBeVisible();
  expect(screen.getByLabelText("Field")).toBeVisible();
  expect(screen.getByLabelText("Summary")).toHaveProp("value", initial.fields!.notes);
  expect(screen.queryByLabelText("Crop / variety")).toBeNull();
  expect(screen.queryByLabelText("Plants planted")).toBeNull();
  expect(screen.queryByLabelText("Unit")).toBeNull();
  expect(screen.getByRole("button", { name: "Append recording" })).toHaveStyle({ backgroundColor: tokens.colors.text, width: "100%" });
  const amended = transcriptResult("I planted oak trees.", `${initial.text}\n\nI planted oak trees.`);
  amended.fields = { ...initial.fields!, product: "Oak trees", unit: "plants", notes: "Online voice log created.\n\nOak trees were planted in Field A on September 16 from 6 AM to 8 AM." };
  await act(async () => { complete(amended); });
  expect(screen.getByLabelText("Crop / variety")).toHaveProp("accessibilityValue", { text: "Oak trees" });
  expect(screen.getByLabelText("Crop / variety")).toHaveStyle({ borderColor: tokens.colors.brand });
  expect(screen.getByLabelText("Plants planted")).toHaveProp("value", "");
  expect(screen.getByLabelText("Plants planted")).toHaveStyle({ borderColor: tokens.colors.warning });
  expect(screen.getByLabelText("Summary")).toHaveProp("value", amended.fields!.notes);
  expect(screen.queryByTestId("review-skeleton")).toBeNull();
  expect(readActivityItems("Planting", catalogScope)).toEqual(["Oak trees"]);
  await fireEvent.press(screen.getByLabelText("Crop / variety"));
  expect(screen.getByRole("button", { name: "Oak trees" })).toBeTruthy();
});

test("Record starts a new recording after a saved log instead of reopening it", async () => {
  const result = transcriptResult("Sprayed the north rows.");
  result.fields = { ...result.fields!, activity: "Spraying", product: "Water", amount: 2, unit: "L", workDate: "2026-09-17", startTime: "06:00", endTime: "08:00" };
  jest.mocked(transcribeRecording).mockResolvedValueOnce(result);
  new File(audio.uri).write("AUDIO");
  const view = await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await screen.findByText("Sprayed the north rows.");
  await fireEvent.press(screen.getByRole("button", { name: "Save log" }));
  expect(await listDrafts()).toHaveLength(1);

  await fireEvent.press(screen.getByRole("tab", { name: "Logs" }));
  await fireEvent.press(screen.getByRole("tab", { name: "Record" }));
  expect(mockRecorder.reset).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save log" })).toBeNull();
});

test("Record still returns to an unsaved recording", async () => {
  const view = await render(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await fireEvent.press(screen.getByRole("button", { name: "Finish recording" }));
  mockRecorder.status = "ready"; mockRecorder.audio = audio;
  await view.rerender(<RecordingWorkspace {...workspaceProps(mockBootstrap ?? undefined)} />);
  await fireEvent.press(screen.getByRole("tab", { name: "Logs" }));
  await fireEvent.press(screen.getByRole("tab", { name: "Record" }));
  expect(mockRecorder.reset).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save log" })).toBeTruthy();
});

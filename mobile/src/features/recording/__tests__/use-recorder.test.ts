import { act, renderHook } from "@testing-library/react-native";
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, type RecordingOptions } from "expo-audio";
import { AppState, type AppStateStatus } from "react-native";
import { useRecorder } from "../use-recorder";

jest.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: ".m4a" } },
  getRecordingPermissionsAsync: jest.fn(), requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(), useAudioRecorder: () => mockNativeRecorder,
}));

const mockNativeRecorder = {
  uri: "file:///cache/original.m4a",
  prepareToRecordAsync: jest.fn<Promise<void>, [RecordingOptions?]>(),
  record: jest.fn(), pause: jest.fn(), stop: jest.fn<Promise<void>, []>(),
  getStatus: () => ({ metering: -30 }),
};
const permissionResult = (granted: boolean) => ({ granted, status: granted ? "granted" : "undetermined", canAskAgain: true, expires: "never" }) as Awaited<ReturnType<typeof getRecordingPermissionsAsync>>;
let onAppState: (state: AppStateStatus) => void;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permissionResult(true));
  jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue(permissionResult(true));
  jest.mocked(setAudioModeAsync).mockResolvedValue();
  mockNativeRecorder.stop.mockResolvedValue();
  mockNativeRecorder.uri = "file:///cache/original.m4a";
  let nextClip = 0;
  // Expo iOS creates a new file only when prepare receives options.
  mockNativeRecorder.prepareToRecordAsync.mockImplementation(async options => {
    if (options) mockNativeRecorder.uri = `file:///cache/clip-${++nextClip}.m4a`;
  });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    onAppState = listener;
    return { remove: jest.fn() };
  });
});
afterEach(() => { jest.restoreAllMocks(); });

test("checks permission ahead of the tap without prompting or opening the microphone", async () => {
  const { result } = await renderHook(() => useRecorder());
  expect(getRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  expect(setAudioModeAsync).not.toHaveBeenCalled();
  expect(mockNativeRecorder.prepareToRecordAsync).not.toHaveBeenCalled();
  expect(mockNativeRecorder.record).not.toHaveBeenCalled();
  await act(async () => { await result.current.start(); });
  expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  expect(result.current.status).toBe("recording");
});

test("first-use permission is requested only on Start, and denial never starts recording", async () => {
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permissionResult(false));
  jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue(permissionResult(false));
  const { result } = await renderHook(() => useRecorder());
  expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => { await result.current.start(); });
  expect(requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(result.current.error).toContain("Microphone access is blocked");
  expect(mockNativeRecorder.record).not.toHaveBeenCalled();
});

test("returning from Settings rechecks microphone permission", async () => {
  const { result } = await renderHook(() => useRecorder());
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permissionResult(false));
  jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue(permissionResult(false));
  await act(async () => { onAppState("background"); onAppState("active"); });
  await act(async () => { await result.current.start(); });
  expect(getRecordingPermissionsAsync).toHaveBeenCalledTimes(2);
  expect(mockNativeRecorder.record).not.toHaveBeenCalled();
});

test("each appended recording preserves the previous clip's file", async () => {
  const { result } = await renderHook(() => useRecorder());
  await act(async () => { await result.current.start(); await result.current.finish(); });
  const first = result.current.audio;
  await act(async () => { await result.current.start(); await result.current.finish(); });
  expect(first?.uri).toBe("file:///cache/clip-1.m4a");
  expect(result.current.audio?.uri).toBe("file:///cache/clip-2.m4a");
  expect(result.current.status).toBe("ready");
});

test("cancel during audio setup prevents a late microphone start; repeated taps are ignored", async () => {
  let complete!: () => void;
  jest.mocked(setAudioModeAsync).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const { result } = await renderHook(() => useRecorder());
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.start(); });
  await act(async () => { await result.current.start(); });
  expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
  await act(async () => { result.current.reset(); complete(); await pending; });
  expect(result.current.status).toBe("idle");
  expect(mockNativeRecorder.prepareToRecordAsync).not.toHaveBeenCalled();
  expect(mockNativeRecorder.record).not.toHaveBeenCalled();
});

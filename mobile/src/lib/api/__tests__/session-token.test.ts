import * as SecureStore from "expo-secure-store";
import { clearSessionToken, restoreSessionToken, saveSessionToken, sessionHeaders } from "../session-token";
import { assetHeaders } from "../mobile-client";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only" }));
jest.mock("expo-file-system", () => require("@/features/recording/__tests__/fake-file-system").createFakeFileSystem());
const origin = "https://toph-rho.vercel.app";

beforeEach(async () => {
  await clearSessionToken(); jest.clearAllMocks();
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue();
  jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue();
});

test("persists native tokens in SecureStore and sends them only to the original API origin", async () => {
  await saveSessionToken(origin, "opaque-token");
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(expect.any(String), JSON.stringify({ origin, token: "opaque-token" }), { keychainAccessible: "device-only" });
  expect(sessionHeaders(origin)).toEqual({ Authorization: "Bearer opaque-token" });
  expect(sessionHeaders("https://other-farm.example")).toEqual({});
  expect(assetHeaders(`${origin}/api/recordings/private`)).toEqual({ Authorization: "Bearer opaque-token" });
  expect(assetHeaders("https://third-party.example/recording.mp3")).toEqual({});
  expect(assetHeaders("file:///local-draft.m4a")).toEqual({});
  await clearSessionToken();
  expect(sessionHeaders(origin)).toEqual({});
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
});

test("restores only a well-formed token saved for this configured server", async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({ origin, token: "saved-token" }));
  expect(await restoreSessionToken(origin)).toBe(true);
  expect(sessionHeaders(origin)).toEqual({ Authorization: "Bearer saved-token" });
  expect(await restoreSessionToken("http://127.0.0.1:3000")).toBe(false);
  expect(sessionHeaders(origin)).toEqual({});
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue("broken");
  expect(await restoreSessionToken(origin)).toBe(false);
});

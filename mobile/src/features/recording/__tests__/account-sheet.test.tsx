import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import AccountSheet from "../AccountSheet";
import type { MobileAccount } from "@toph/contracts/mobile";

jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystem());
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("expo-image-manipulator", () => ({ SaveFormat: { JPEG: "jpeg" }, ImageManipulator: { manipulate: () => {
  const context = { crop: () => context, resize: () => context, release: jest.fn(), renderAsync: async () => ({ saveAsync: async () => ({ base64: "/9j/2Q==" }), release: jest.fn() }) };
  return context;
} } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const profile: MobileAccount = { id: "10000000-0000-4000-8000-000000000001", name: "Isaac Wang", email: "", phone: "", role: "Farm worker", defaultField: "FIELD A", defaultActivity: "Spraying", avatarUrl: null };
const other: MobileAccount = { ...profile, id: "10000000-0000-4000-8000-000000000002", name: "Maria Lopez" };
const props = () => ({ profile, accounts: [profile, other], fields: ["FIELD A", "FIELD B"], farmName: "Bays Ranch", connected: true, connectionError: "", logCount: 2, onClose: jest.fn(), onSave: jest.fn(async () => {}), onSwitch: jest.fn(async () => {}), onRefresh: jest.fn(async () => {}), onViewLogs: jest.fn() });

test("switcher searches real accounts and selects the requested account", async () => {
  const callbacks = props(); await render(<AccountSheet {...callbacks} />);
  await fireEvent.press(screen.getByRole("button", { name: "Switch account" }));
  await fireEvent.changeText(screen.getByLabelText("Find an account"), "Maria");
  expect(screen.queryByRole("button", { name: "Switch to Isaac Wang" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Switch to Maria Lopez" }));
  expect(callbacks.onSwitch).toHaveBeenCalledWith(other);
});

test("profile save waits for the server and retains edits after a failed save", async () => {
  const callbacks = props();
  let reject!: (reason: Error) => void;
  callbacks.onSave.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  await render(<AccountSheet {...callbacks} />);
  await fireEvent.changeText(screen.getByLabelText("Name"), "New Name");
  await fireEvent.changeText(screen.getByLabelText("Email"), "worker@example.com");
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(callbacks.onClose).not.toHaveBeenCalled();
  await act(async () => reject(new Error("Connection lost")));
  expect(screen.getByText("Connection lost")).toBeTruthy();
  expect(screen.getByLabelText("Name")).toHaveProp("value", "New Name");
  expect(callbacks.onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "New Name", email: "worker@example.com" }));
});

test("choosing a photo only changes the pending profile and permits removal", async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: "file:///picked.jpg", width: 800, height: 600 }] });
  const callbacks = props(); await render(<AccountSheet {...callbacks} />);
  await fireEvent.press(screen.getByRole("button", { name: "Change photo" }));
  expect(screen.getByRole("button", { name: "Remove photo" })).toBeTruthy();
  expect(callbacks.onSave).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Remove photo" }));
  expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
});

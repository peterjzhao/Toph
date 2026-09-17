import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import AccountGateway from "../AccountGateway";
import { clearSessionToken, restoreSessionToken, saveSessionToken } from "@/lib/api/session-token";
import { workerBootstrap, workspaceProps } from "@/features/recording/__tests__/workspace-fixture";
import type { AccountSession } from "@toph/contracts/accounts";

jest.mock("expo-file-system", () => require("@/features/recording/__tests__/fake-file-system").createFakeFileSystem());
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/api/session-token", () => ({ restoreSessionToken: jest.fn(), saveSessionToken: jest.fn(), clearSessionToken: jest.fn() }));
jest.mock("@/lib/api/mobile-client", () => ({
  apiOrigin: () => "https://toph.example", MobileApiError: class extends Error {},
  createMobileClient: () => Object.fromEntries(["session", "accounts", "login", "join", "sample", "logout"].map(key => [key, (...args: unknown[]) => mockApi[key](...args)])),
}));
jest.mock("@/features/recording/RecordingWorkspace", () => {
  const { Text, Pressable, View } = require("react-native");
  return { __esModule: true, default: ({ session, onSignOut }: { session: AccountSession; onSignOut: () => Promise<void> }) => <View><Text>{session.account.name} recording at {session.farm.name}</Text><Pressable onPress={onSignOut} accessibilityRole="button"><Text>Sign out</Text></Pressable></View> };
});
const mockApi: Record<string, jest.Mock> = Object.fromEntries(["session", "accounts", "login", "join", "sample", "logout"].map(key => [key, jest.fn()]));
const session = workspaceProps().session;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(restoreSessionToken).mockResolvedValue(false);
  jest.mocked(saveSessionToken).mockResolvedValue();
  jest.mocked(clearSessionToken).mockResolvedValue();
  mockApi.accounts.mockResolvedValue(workerBootstrap);
  mockApi.login.mockResolvedValue({ ...session, token: "session-token" });
  mockApi.join.mockResolvedValue({ ...session, token: "session-token" });
  mockApi.sample.mockResolvedValue({ ...session, token: "sample-token" });
  mockApi.session.mockResolvedValue(session);
  mockApi.logout.mockResolvedValue({ ok: true });
});

test("requires explicit login and saves a verified native session before opening the workspace", async () => {
  await render(<AccountGateway />);
  await screen.findByText("Welcome back");
  expect(mockApi.accounts).not.toHaveBeenCalled();
  expect(mockApi.sample).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("Your name"), "Isaac Wang");
  await fireEvent.press(screen.getByRole("button", { name: "Log in" }));
  await screen.findByText("Isaac Wang recording at Bays Ranch");
  expect(mockApi.login).toHaveBeenCalledWith("Isaac Wang");
  expect(saveSessionToken).toHaveBeenCalledWith("https://toph.example", "session-token");
  await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByText("Welcome back");
  expect(mockApi.logout).toHaveBeenCalledTimes(1);
  expect(clearSessionToken).toHaveBeenCalledTimes(1);
});

test("join uses name and farm code and preserves inputs after an invalid code", async () => {
  mockApi.join.mockRejectedValueOnce(new Error("This farm code is not valid."));
  await render(<AccountGateway />);
  await screen.findByText("Welcome back");
  await fireEvent.press(screen.getByRole("tab", { name: "Join a farm" }));
  await fireEvent.changeText(screen.getByLabelText("Your name"), "New Worker");
  await fireEvent.changeText(screen.getByLabelText("Farm join code"), "ABC123");
  await fireEvent.press(screen.getByRole("button", { name: "Create account & join farm" }));
  await screen.findByText("This farm code is not valid.");
  expect(mockApi.join).toHaveBeenCalledWith("New Worker", "ABC123");
  expect(screen.getByLabelText("Your name")).toHaveProp("value", "New Worker");
  expect(screen.getByLabelText("Farm join code")).toHaveProp("value", "ABC123");
  expect(saveSessionToken).not.toHaveBeenCalled();
});

test("restores a token but refuses a bootstrap containing other workers", async () => {
  jest.mocked(restoreSessionToken).mockResolvedValue(true);
  mockApi.accounts.mockResolvedValue({ ...workerBootstrap, accounts: [...workerBootstrap.accounts, { ...workerBootstrap.accounts[0], id: "another-worker" }] });
  await render(<AccountGateway />);
  await screen.findByText("Your farm account could not be verified. Sign out and log in again.");
  expect(screen.queryByText("Isaac Wang recording at Bays Ranch")).toBeNull();
  expect(mockApi.session).toHaveBeenCalledTimes(1);
  expect(mockApi.login).not.toHaveBeenCalled();
});

test("sign-in omits the sample farm and explanatory copy", async () => {
  await render(<AccountGateway />);
  await screen.findByText("Welcome back");
  expect(screen.queryByText("Try Bays Ranch sample")).toBeNull();
  expect(screen.queryByText("Sign in to record your field work and see your logs.")).toBeNull();
  expect(mockApi.sample).not.toHaveBeenCalled();
});

test("an admin identity never mounts the recording workspace", async () => {
  mockApi.login.mockResolvedValueOnce({ ...session, account: { ...session.account, role: "admin" } });
  await render(<AccountGateway />);
  await screen.findByText("Welcome back");
  await fireEvent.changeText(screen.getByLabelText("Your name"), "Farm Admin");
  await fireEvent.press(screen.getByRole("button", { name: "Log in" }));
  await waitFor(() => expect(screen.getByText(/Farm admins sign in to the web dashboard/)).toBeTruthy());
  expect(mockApi.accounts).not.toHaveBeenCalled();
  expect(saveSessionToken).not.toHaveBeenCalled();
});

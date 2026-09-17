import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { useInbox } from "../use-inbox";
import type { MessageInbox } from "@toph/contracts/messages";

const mockMessages = jest.fn(); const mockSend = jest.fn(); const mockRead = jest.fn();
jest.mock("@/lib/api/mobile-client", () => ({ createMobileClient: () => ({
  messages: () => mockMessages(), sendMessage: (body: unknown) => mockSend(body), readMessages: (body: unknown) => mockRead(body),
}) }));
const incoming = { id: "message-one", employeeId: "worker", body: "Check the gate", from: "admin" as const, createdAt: "2026-09-17T12:00:00Z", read: false };
const first: MessageInbox = { revision: 1, messages: [incoming] };
let appState: (state: AppStateStatus) => void;
beforeEach(() => {
  jest.useFakeTimers(); mockMessages.mockReset().mockResolvedValue(first); mockSend.mockReset(); mockRead.mockReset();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => { appState = listener; return { remove: jest.fn() }; });
  mockRead.mockResolvedValue({ revision: 2, messages: [{ ...incoming, read: true }] });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test("keeps closed-inbox messages unread and acknowledges them only when opened", async () => {
  const hook = await renderHook(({ opened }: { opened: boolean }) => useInbox("worker", opened, true), { initialProps: { opened: false } });
  expect(hook.result.current.unreadCount).toBe(1); expect(mockRead).not.toHaveBeenCalled();
  await hook.rerender({ opened: true });
  expect(mockRead).toHaveBeenCalledWith({ employeeId: "worker", messageIds: [incoming.id] });
  expect(hook.result.current.unreadCount).toBe(0);
});
test("pauses polling in the background or offline, then catches up on resume and reconnect", async () => {
  const hook = await renderHook(({ online }: { online: boolean }) => useInbox("worker", false, online), { initialProps: { online: true } });
  expect(mockMessages).toHaveBeenCalledTimes(1);
  await act(async () => { appState("background"); });
  await act(async () => { jest.advanceTimersByTime(20_000); });
  expect(mockMessages).toHaveBeenCalledTimes(1);
  await act(async () => { appState("active"); });
  expect(mockMessages).toHaveBeenCalledTimes(2);
  await hook.rerender({ online: false });
  await act(async () => { jest.advanceTimersByTime(20_000); });
  expect(mockMessages).toHaveBeenCalledTimes(2);
  await hook.rerender({ online: true });
  expect(mockMessages).toHaveBeenCalledTimes(3);
  await hook.unmount();
  await act(async () => { jest.advanceTimersByTime(20_000); });
  expect(mockMessages).toHaveBeenCalledTimes(3);
});
test("a delayed poll cannot erase a newly sent message and polls never overlap", async () => {
  let finish!: (value: MessageInbox) => void;
  mockMessages.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const reply = { ...incoming, id: "reply", body: "Done", from: "employee" as const };
  mockSend.mockResolvedValue({ revision: 2, messages: [incoming, reply] });
  const hook = await renderHook(() => useInbox("worker", false, true));
  await act(async () => { jest.advanceTimersByTime(20_000); });
  expect(mockMessages).toHaveBeenCalledTimes(1);
  await act(async () => { await hook.result.current.send({ id: reply.id, employeeId: "worker", body: reply.body }); });
  await act(async () => { finish(first); });
  expect(hook.result.current.messages).toEqual([incoming, reply]);
});
test("failed read receipts remain unread and can be retried explicitly", async () => {
  mockRead.mockRejectedValueOnce(new Error("Offline"));
  const hook = await renderHook(() => useInbox("worker", true, true));
  expect(hook.result.current.unreadCount).toBe(1);
  expect(hook.result.current.readError).toContain("retry");
  await act(async () => { jest.advanceTimersByTime(5_000); });
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => { await hook.result.current.markRead(); });
  expect(hook.result.current.unreadCount).toBe(0);
});

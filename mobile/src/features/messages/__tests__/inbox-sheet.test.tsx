import { act, fireEvent, render, screen } from "@testing-library/react-native";
import InboxSheet from "../InboxSheet";
import type { useInbox } from "../use-inbox";
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "30000000-0000-4000-8000-000000000001" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
function props() {
  const inbox: ReturnType<typeof useInbox> = { messages: [], unreadCount: 0, loading: false, error: "", readError: "", refresh: jest.fn(async () => {}), markRead: jest.fn(async () => {}), send: jest.fn(async () => {}) };
  return { visible: true, onClose: jest.fn(), employeeId: "worker", farmName: "My farm", online: true, inbox };
}
test("failed send keeps the draft and retries with the same idempotency key", async () => {
  const p = props(); const send = jest.mocked(p.inbox.send); send.mockRejectedValueOnce(new Error("Connection lost"));
  await render(<InboxSheet {...p} />);
  await fireEvent.changeText(screen.getByLabelText("Message to farm admin"), " Gate checked ");
  await fireEvent.press(screen.getByRole("button", { name: "Send message" }));
  expect(screen.getByText("Connection lost")).toBeTruthy();
  expect(screen.getByLabelText("Message to farm admin")).toHaveProp("value", " Gate checked ");
  await fireEvent.press(screen.getByRole("button", { name: "Send message" }));
  expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
  expect(send.mock.calls[0][0]).toMatchObject({ employeeId: "worker", body: "Gate checked" });
  expect(screen.getByLabelText("Message to farm admin")).toHaveProp("value", "");
});
test("a slow send does not erase a newer draft, and closing the inbox retains it", async () => {
  const p = props(); let finish!: () => void;
  jest.mocked(p.inbox.send).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = await render(<InboxSheet {...p} />);
  await fireEvent.changeText(screen.getByLabelText("Message to farm admin"), "First message");
  await fireEvent.press(screen.getByRole("button", { name: "Send message" }));
  await fireEvent.changeText(screen.getByLabelText("Message to farm admin"), "Next message");
  await act(async () => { finish(); });
  expect(screen.getByLabelText("Message to farm admin")).toHaveProp("value", "Next message");
  await view.rerender(<InboxSheet {...p} visible={false} />);
  await view.rerender(<InboxSheet {...p} />);
  expect(screen.getByLabelText("Message to farm admin")).toHaveProp("value", "Next message");
});
test("shows persisted incoming/outgoing messages and disables offline sends", async () => {
  const p = props();
  p.inbox.messages = [
    { id: "1", employeeId: "worker", from: "admin", body: "Check the gate", createdAt: "2026-09-17T12:00:00Z", read: true },
    { id: "2", employeeId: "worker", from: "employee", body: "Done", createdAt: "2026-09-17T12:01:00Z", read: true },
  ];
  await render(<InboxSheet {...p} online={false} />);
  expect(screen.getByText("Check the gate")).toBeTruthy(); expect(screen.getByText("Done")).toBeTruthy(); expect(screen.getByText(/· Read/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("Message to farm admin"), "Unsaved");
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
});

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { MESSAGE_POLL_MS, type MessageInbox, type SendMessageRequest } from "@toph/contracts/messages";
import { createMobileClient } from "@/lib/api/mobile-client";

const api = createMobileClient();

/** Mounted under the account-keyed workspace; private data is discarded on sign-out. */
export function useInbox(employeeId: string, opened: boolean, online: boolean) {
  const [inbox, setInbox] = useState<MessageInbox>({ messages: [], revision: -1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const mounted = useRef(true);
  const refreshing = useRef(false);
  const lastRead = useRef("");
  const accept = useCallback((next: MessageInbox) => {
    if (mounted.current) setInbox(previous => next.revision >= previous.revision ? next : previous);
  }, []);
  const refresh = useCallback(async () => {
    if (refreshing.current || !online) return;
    refreshing.current = true;
    try { accept(await api.messages()); if (mounted.current) setError(""); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not load messages."); }
    finally { refreshing.current = false; if (mounted.current) setLoading(false); }
  }, [accept, online]);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", state => setActive(state === "active"));
    return () => { mounted.current = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!active || !online) return;
    void refresh();
    const timer = setInterval(() => void refresh(), MESSAGE_POLL_MS);
    return () => clearInterval(timer);
  }, [active, online, refresh, opened]);

  const unreadIds = inbox.messages.filter(message => message.from === "admin" && !message.read).map(message => message.id);
  const readKey = unreadIds.join(",");
  const markRead = useCallback(async () => {
    if (!readKey || !opened || !active || !online) return;
    lastRead.current = readKey;
    setReadError("");
    try { accept(await api.readMessages({ employeeId, messageIds: readKey.split(",") })); }
    catch { if (mounted.current) setReadError("Could not save read status. Tap to retry."); }
  }, [readKey, opened, active, online, accept, employeeId]);
  useEffect(() => {
    if (!opened) { lastRead.current = ""; return; }
    if (readKey && lastRead.current !== readKey) void markRead();
  }, [opened, readKey, markRead]);
  const send = useCallback(async (message: SendMessageRequest) => {
    if (!online) throw new Error("You’re offline. Reconnect and send again; your draft is still here.");
    accept(await api.sendMessage(message));
    if (mounted.current) setError("");
  }, [accept, online]);
  return { messages: inbox.messages, unreadCount: unreadIds.length, loading, error, readError, refresh, markRead, send };
}

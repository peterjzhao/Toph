"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AccountSession } from "@/contracts/accounts";
import { currentAccount, accountRequest, AccountRequestError } from "@/lib/account-client";
import type { DashboardData, DashboardResponse, TagDto } from "@/contracts/dashboard";
import type { RealtimeConfigResponse } from "@/contracts/realtime";
import type { WorkspaceResponse, WorkspaceState } from "@/contracts/workspace";
import { MESSAGE_POLL_MS, type MessageInbox, type MessagesResponse, type SendMessageRequest, type ReadMessagesRequest } from "@/contracts/messages";
import { diffDashboard, diffRoster, employeeAvatars, liveUpdateNotice, type DashboardChange, type RosterChange } from "@/lib/realtime/changes";
import { startLiveUpdates } from "@/lib/realtime/live-updates";
import { connectSupabaseChannel } from "@/lib/realtime/supabase-channel";

type WorkspaceContextValue = {
  data: DashboardData; workspace: WorkspaceState; saving: boolean; saveError: string; notice: string;
  /** Employee photos by ID, as reported on each employee's logs; absent until one is set. */
  avatars: Record<string, string>;
  update: <K extends keyof WorkspaceState>(key: K, value: WorkspaceState[K] | ((previous: WorkspaceState[K]) => WorkspaceState[K])) => Promise<boolean>;
  notify: (message: string) => void; reloadDashboard: () => Promise<void>;
  sendMessage: (message: SendMessageRequest) => Promise<void>;
  markMessagesRead: (request: ReadMessagesRequest) => Promise<void>;
  messageError: string;
};

type Context = WorkspaceContextValue & { account: AccountSession; session: AccountSession["account"]; signOut: () => Promise<void>; setLogTags: (id: string, tags: TagDto[]) => void; markReviewed: (id: string) => Promise<void> };
const WorkspaceContext = createContext<Context | null>(null);

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (response.status === 401 && typeof window !== "undefined") window.location.replace("/login");
  if (!response.ok) throw new Error(body.error?.message ?? "Your changes could not be saved. Please try again.");
  return body as T;
}

// Background reads fail fast so a stalled request can never hold up the save queue.
const LIVE_READ_TIMEOUT_MS = 15_000;
const liveRead = (): RequestInit | undefined => typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(LIVE_READ_TIMEOUT_MS) } : undefined;
const DASHBOARD_PAGE_SIZE = 100;

/** Every log for the farm. The API returns at most 100 per request, so later pages are followed. */
async function fetchDashboard(options?: RequestInit): Promise<DashboardData> {
  const url = `/api/dashboard?period=all&limit=${DASHBOARD_PAGE_SIZE}`;
  const first = await requestJson<DashboardResponse>(url, options);
  const logs = new Map(first.data.logs.map(log => [log.id, log]));
  let page = first;
  let offset = page.data.logs.length;
  while (page.meta.pagination.hasMore && page.data.logs.length > 0 && offset < 5_000) {
    page = await requestJson<DashboardResponse>(`${url}&offset=${offset}`, options);
    for (const log of page.data.logs) logs.set(log.id, log);
    offset += page.data.logs.length;
  }
  return { ...first.data, logs: [...logs.values()] };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [state, setState] = useState<WorkspaceResponse | null>(null);
  const dataRef = useRef<DashboardData | null>(null);
  const dashboardRead = useRef(0);
  const stateRef = useRef<WorkspaceResponse | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState("");
  const [account, setAccount] = useState<AccountSession | null>(null);
  const [inbox, setInbox] = useState<MessageInbox | null>(null);
  const [messageError, setMessageError] = useState("");
  const acceptInbox = useCallback((next: MessageInbox) => {
    setInbox(previous => !previous || next.revision >= previous.revision ? next : previous);
  }, []);
  const notify = useCallback((message: string) => setNotice(message), []);
  const setLogTags = useCallback((id: string, tags: TagDto[]) => {
    setData(previous => previous ? { ...previous, logs: previous.logs.map(log => log.id === id ? { ...log, tags } : log) } : previous);
  }, []);

  // Silent reads: no loading state, so filters, open rows, scroll position, and form drafts
  // (all component state below this provider) survive. Each reports what changed, if anything.
  const readDashboard = useCallback(async (options?: RequestInit): Promise<DashboardChange | null> => {
    const read = ++dashboardRead.current;
    const next = await fetchDashboard(options);
    if (read !== dashboardRead.current) return null; // A newer read owns the result.
    const previous = dataRef.current;
    dataRef.current = next; setData(next);
    return previous ? diffDashboard(previous, next) : null;
  }, []);
  const reloadDashboard = useCallback(async () => { await readDashboard(); }, [readDashboard]);

  const readWorkspace = useCallback((options?: RequestInit): Promise<RosterChange | null> => {
    // Reads share the save queue: this tab's own save is always applied before the read that
    // its signal triggers, and an older response can never replace a newer revision.
    const operation = queue.current.then(async () => {
      const latest = await requestJson<WorkspaceResponse>("/api/workspace", options);
      const current = stateRef.current;
      if (!current || latest.revision <= current.revision) return null;
      stateRef.current = latest; setState(latest);
      return diffRoster(current.data, latest.data);
    });
    queue.current = operation.catch(() => undefined);
    return operation;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const read = ++dashboardRead.current;
    try {
      const identity = await currentAccount();
      if (identity.account.role !== "admin") { router.replace("/login?worker=1"); return; }
      if (!identity.farm.setupComplete) { router.replace("/onboarding"); return; }
      setAccount(identity);
      const [dashboard, workspace] = await Promise.all([fetchDashboard(), requestJson<WorkspaceResponse>("/api/workspace")]);
      if (read === dashboardRead.current) { dataRef.current = dashboard; setData(dashboard); }
      setState(workspace); stateRef.current = workspace;
    } catch (cause) {
      if (cause instanceof AccountRequestError && cause.status === 401) router.replace("/login");
      else setError(cause instanceof Error ? cause.message : "The workspace could not be loaded.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { dataRef.current = data; }, [data]);

  // Live updates: a content-free signal (or a rejoin after a dropped connection) asks for the
  // same reads as above. One subscription per tab, for as long as the workspace is mounted.
  const ready = data !== null && state !== null;
  // Authenticated polling works on localhost and for private farms without public topics.
  // Pause in hidden tabs, catch up on focus/reconnect, and never overlap background reads.
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let reading = false;
    async function refresh() {
      if (stopped || reading || document.visibilityState !== "visible") return;
      reading = true;
      try {
        const response = await requestJson<MessagesResponse>("/api/messages", liveRead());
        if (!stopped) {
          acceptInbox(response.data); setMessageError("");
          if (response.data.revision > (stateRef.current?.revision ?? -1)) await readWorkspace(liveRead());
        }
      } catch { if (!stopped) setMessageError("Messages are offline. Reconnecting automatically…"); }
      finally { reading = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), MESSAGE_POLL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [ready, acceptInbox, readWorkspace]);

  const mutateMessages = useCallback(async (action: "" | "/read", body: SendMessageRequest | ReadMessagesRequest) => {
    const response = await requestJson<MessagesResponse>(`/api/messages${action}`, { method: "POST", body: JSON.stringify(body), ...liveRead() });
    acceptInbox(response.data); setMessageError("");
    // The committed response is sufficient to confirm delivery. A subsequent read failure
    // must not turn an accepted send into an apparent failure.
    void readWorkspace(liveRead()).catch(() => undefined);
  }, [acceptInbox, readWorkspace]);
  const sendMessage = useCallback((body: SendMessageRequest) => mutateMessages("", body), [mutateMessages]);
  const markMessagesRead = useCallback((body: ReadMessagesRequest) => mutateMessages("/read", body), [mutateMessages]);
  useEffect(() => {
    if (!ready) return;
    const live = startLiveUpdates({
      loadConfig: async () => (await requestJson<RealtimeConfigResponse>("/api/realtime")).data,
      connect: connectSupabaseChannel,
      refresh: async kinds => {
        const [dashboard, roster] = await Promise.allSettled([
          kinds.has("dashboard") ? readDashboard(liveRead()) : null,
          kinds.has("workspace") ? readWorkspace(liveRead()) : null,
        ]);
        const logs = dashboard.status === "fulfilled" ? dashboard.value : null;
        const team = roster.status === "fulfilled" ? roster.value : null;
        const message = liveUpdateNotice({
          newLogs: logs?.newLogs ?? [], addedEmployeeIds: team?.addedEmployeeIds ?? [],
          changedEmployeeIds: [...(team?.changedEmployeeIds ?? []), ...(logs?.photoEmployeeIds ?? [])],
          nameOf: id => stateRef.current?.data.employees.find(person => person.id === id)?.name,
        });
        if (message) setNotice(message);
        if (dashboard.status === "rejected" || roster.status === "rejected") throw new Error("A live read failed and will be retried.");
      },
    });
    return () => live.stop();
  }, [ready, readDashboard, readWorkspace]);

  // Account changes in another tab must discard this farm's cached view. New farms use
  // bounded polling until authenticated per-farm broadcast channels are available.
  useEffect(() => {
    if (!account || !ready) return;
    let stopped = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const latest = await currentAccount();
        if (stopped) return;
        if (latest.account.id !== account!.account.id || latest.farm.id !== account!.farm.id) { window.location.reload(); return; }
        if (!account!.farm.isDemo) await Promise.all([readDashboard(liveRead()), readWorkspace(liveRead())]);
      } catch (cause) {
        if (cause instanceof AccountRequestError && cause.status === 401) window.location.replace("/login");
      }
    }
    const timer = setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", refresh);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [account, ready, readDashboard, readWorkspace]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4200); return () => clearTimeout(timer); }, [notice]);

  const update = useCallback(<K extends keyof WorkspaceState,>(key: K, value: WorkspaceState[K] | ((previous: WorkspaceState[K]) => WorkspaceState[K])): Promise<boolean> => {
    setPending(count => count + 1);
    const operation = queue.current.then(async () => {
      const current = stateRef.current;
      setSaveError("");
      try {
        if (!current) throw new Error("The workspace is still loading. Please try again.");
        const section = typeof value === "function" ? (value as (previous: WorkspaceState[K]) => WorkspaceState[K])(current.data[key]) : value;
        const response = await fetch("/api/workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patch: { [key]: section }, expectedRevision: current.revision }) });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 409) {
            const latest = await requestJson<WorkspaceResponse>("/api/workspace");
            stateRef.current = latest; setState(latest);
            throw new Error("The workspace changed in another window. The latest changes are loaded; please try saving again.");
          }
          throw new Error(result.error?.message ?? "Your changes could not be saved.");
        }
        stateRef.current = result; setState(result); return true;
      } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Your changes could not be saved."); return false; }
      finally { setPending(count => count - 1); }
    });
    queue.current = operation.catch(() => undefined);
    return operation;
  }, []);

  async function signOut() {
    try {
      await accountRequest("/api/auth/logout", { method: "POST", body: "{}" });
      window.location.assign("/login");
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Could not sign out. Please try again."); }
  }
  async function markReviewed(id: string) {
    if (account?.farm.isDemo) return;
    await requestJson(`/api/logs/${id}/review`, { method: "POST", body: "{}" });
    await reloadDashboard();
  }

  if (loading) return <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", color: "#777" }} role="status">Loading your farm…</div>;
  if (!account && !error) return <div role="status" style={{ padding: 40 }}>Opening your account…</div>;
  if (error || !data || !state || !account) return <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}><div style={{ maxWidth: 430, padding: 30 }}><h1 style={{ fontSize: 22 }}>We couldn’t load the workspace</h1><p style={{ color: "#777", lineHeight: 1.6 }}>{error || "The database is unavailable."}</p><button onClick={() => void load()} style={{ padding: "10px 20px", border: "1px solid #ddd", borderRadius: 8, background: "white" }}>Try again</button></div></div>;
  const displayData: DashboardData = {
    ...data,
    farm: { ...data.farm, name: state.data.settings.farmName, timezone: state.data.settings.timezone },
    logs: data.logs.map(log => {
      const profile = state.data.employees.find(employee => employee.id === log.employee.id);
      return profile ? { ...log, employee: { ...log.employee, name: profile.name } } : log;
    }),
  };
  const workspace = inbox && inbox.revision > state.revision ? { ...state.data, messages: inbox.messages } : state.data;
  return <WorkspaceContext.Provider value={{ data: displayData, workspace, avatars: employeeAvatars(data), saving: pending > 0, saveError, notice, update, notify, reloadDashboard, setLogTags, account, session: account.account, signOut, markReviewed, sendMessage, markMessagesRead, messageError }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace pages must be rendered inside WorkspaceProvider.");
  return context;
}

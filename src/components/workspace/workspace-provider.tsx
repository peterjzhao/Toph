"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { DashboardData, DashboardResponse, TagDto } from "@/contracts/dashboard";
import type { RealtimeConfigResponse } from "@/contracts/realtime";
import type { WorkspaceResponse, WorkspaceState } from "@/contracts/workspace";
import { diffDashboard, diffRoster, employeeAvatars, liveUpdateNotice, type DashboardChange, type RosterChange } from "@/lib/realtime/changes";
import { startLiveUpdates } from "@/lib/realtime/live-updates";
import { connectSupabaseChannel } from "@/lib/realtime/supabase-channel";

type WorkspaceContextValue = {
  data: DashboardData; workspace: WorkspaceState; saving: boolean; saveError: string; notice: string;
  /** Employee photos by ID, as reported on each employee's logs; absent until one is set. */
  avatars: Record<string, string>;
  update: <K extends keyof WorkspaceState>(key: K, value: WorkspaceState[K] | ((previous: WorkspaceState[K]) => WorkspaceState[K])) => Promise<boolean>;
  notify: (message: string) => void; reloadDashboard: () => Promise<void>;
};

type AccountSession = { id: string; name: string; role: string };
type Context = WorkspaceContextValue & { session: AccountSession | null; switchUser: (id: string) => void; signOut: () => void; setLogTags: (id: string, tags: TagDto[]) => void };
const WorkspaceContext = createContext<Context | null>(null);
const SESSION_KEY = "toph.account-session.v1";

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
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
  const [session, setSession] = useState<AccountSession | null>({ id: "admin", name: "Ranch Admin", role: "Admin" });
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
      const [dashboard, workspace] = await Promise.all([fetchDashboard(), requestJson<WorkspaceResponse>("/api/workspace")]);
      if (read === dashboardRead.current) { dataRef.current = dashboard; setData(dashboard); }
      setState(workspace); stateRef.current = workspace;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The workspace could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { dataRef.current = data; }, [data]);

  // Live updates: a content-free signal (or a rejoin after a dropped connection) asks for the
  // same reads as above. One subscription per tab, for as long as the workspace is mounted.
  const ready = data !== null && state !== null;
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

  useEffect(() => { void load();
    try { const stored = localStorage.getItem(SESSION_KEY); if (stored) setSession(JSON.parse(stored)); } catch { /* A fresh browser starts with the administrator. */ }
  }, [load]);
  useEffect(() => {
    if (!state || !session || session.id === "admin") return;
    if (state.data.employees.some(person => person.id === session.id && person.status === "Active")) return;
    // A removed or archived profile cannot remain selected through a saved browser session.
    const admin = { id: "admin", name: state.data.settings.contactName || "Ranch Admin", role: "Admin" };
    setSession(admin);
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(admin)); } catch { /* Keep the in-memory session usable. */ }
  }, [state, session]);
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

  function setAccountSession(next: AccountSession | null) {
    setSession(next);
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* Session remains usable in memory if browser storage is unavailable. */ }
  }
  function switchUser(id: string) {
    const employee = stateRef.current?.data.employees.find(person => person.id === id);
    setAccountSession(employee ? { id: employee.id, name: employee.name, role: employee.role } : { id: "admin", name: stateRef.current?.data.settings.contactName || "Ranch Admin", role: "Admin" });
  }

  if (loading) return <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", color: "#777" }} role="status">Loading Bays Ranch…</div>;
  if (error || !data || !state) return <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}><div style={{ maxWidth: 430, padding: 30 }}><h1 style={{ fontSize: 22 }}>We couldn’t load the workspace</h1><p style={{ color: "#777", lineHeight: 1.6 }}>{error || "The database is unavailable."}</p><button onClick={() => void load()} style={{ padding: "10px 20px", border: "1px solid #ddd", borderRadius: 8, background: "white" }}>Try again</button></div></div>;
  const displayData: DashboardData = {
    ...data,
    farm: { ...data.farm, name: state.data.settings.farmName, timezone: state.data.settings.timezone },
    logs: data.logs.map(log => {
      const profile = state.data.employees.find(employee => employee.id === log.employee.id);
      return profile ? { ...log, employee: { ...log.employee, name: profile.name } } : log;
    }),
  };
  return <WorkspaceContext.Provider value={{ data: displayData, workspace: state.data, avatars: employeeAvatars(data), saving: pending > 0, saveError, notice, update, notify, reloadDashboard, setLogTags, session, switchUser, signOut: () => setAccountSession(null) }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace pages must be rendered inside WorkspaceProvider.");
  return context;
}

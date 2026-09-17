"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { DashboardData, TagDto } from "@/contracts/dashboard";
import type { WorkspaceResponse, WorkspaceState } from "@/contracts/workspace";

type WorkspaceContextValue = {
  data: DashboardData; workspace: WorkspaceState; saving: boolean; saveError: string; notice: string;
  update: <K extends keyof WorkspaceState>(key: K, value: WorkspaceState[K] | ((previous: WorkspaceState[K]) => WorkspaceState[K])) => Promise<boolean>;
  notify: (message: string) => void; reloadDashboard: () => Promise<void>;
};

type DemoSession = { id: string; name: string; role: string };
type Context = WorkspaceContextValue & { session: DemoSession | null; switchUser: (id: string) => void; signOut: () => void; setLogTags: (id: string, tags: TagDto[]) => void };
const WorkspaceContext = createContext<Context | null>(null);
const SESSION_KEY = "toph.demo-session.v1";

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Your changes could not be saved. Please try again.");
  return body as T;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [state, setState] = useState<WorkspaceResponse | null>(null);
  const stateRef = useRef<WorkspaceResponse | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState<DemoSession | null>({ id: "admin", name: "Ranch Admin", role: "Admin" });
  const notify = useCallback((message: string) => setNotice(message), []);
  const setLogTags = useCallback((id: string, tags: TagDto[]) => {
    setData(previous => previous ? { ...previous, logs: previous.logs.map(log => log.id === id ? { ...log, tags } : log) } : previous);
  }, []);

  const reloadDashboard = useCallback(async () => {
    const response = await requestJson<{ data: DashboardData }>("/api/dashboard?period=all");
    setData(response.data);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [dashboard, workspace] = await Promise.all([
        requestJson<{ data: DashboardData }>("/api/dashboard?period=all"),
        requestJson<WorkspaceResponse>("/api/workspace"),
      ]);
      setData(dashboard.data); setState(workspace); stateRef.current = workspace;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The workspace could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load();
    try { const stored = localStorage.getItem(SESSION_KEY); if (stored) setSession(JSON.parse(stored)); } catch { /* A fresh browser starts with the demo administrator. */ }
  }, [load]);
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

  function setDemoSession(next: DemoSession | null) {
    setSession(next);
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* Session remains usable in memory if browser storage is unavailable. */ }
  }
  function switchUser(id: string) {
    const employee = stateRef.current?.data.employees.find(person => person.id === id);
    setDemoSession(employee ? { id: employee.id, name: employee.name, role: employee.role } : { id: "admin", name: stateRef.current?.data.settings.contactName || "Ranch Admin", role: "Admin" });
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
  return <WorkspaceContext.Provider value={{ data: displayData, workspace: state.data, saving: pending > 0, saveError, notice, update, notify, reloadDashboard, setLogTags, session, switchUser, signOut: () => setDemoSession(null) }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace pages must be rendered inside WorkspaceProvider.");
  return context;
}

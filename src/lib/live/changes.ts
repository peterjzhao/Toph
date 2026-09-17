import type { DashboardData } from "../../contracts/dashboard";
import type { WorkspaceState } from "../../contracts/workspace";

export type NewLog = { id: string; employeeId: string; employeeName: string };
export type DashboardChange = { newLogs: NewLog[]; photoEmployeeIds: string[] };
export type RosterChange = { changedEmployeeIds: string[]; addedEmployeeIds: string[] };

/** Employee photos as the dashboard API reports them (on each employee's logs). */
export function employeeAvatars(data: DashboardData): Record<string, string> {
  const avatars: Record<string, string> = {};
  for (const log of data.logs) if (log.employee.avatarUrl) avatars[log.employee.id] = log.employee.avatarUrl;
  return avatars;
}

export function diffDashboard(previous: DashboardData, next: DashboardData): DashboardChange {
  const known = new Set(previous.logs.map((log) => log.id));
  const newLogs = next.logs.filter((log) => !known.has(log.id)).map((log) => ({ id: log.id, employeeId: log.employee.id, employeeName: log.employee.name }));
  const before = employeeAvatars(previous);
  const after = employeeAvatars(next);
  // Only employees already on the page: a first log is announced as a log, not as a photo.
  const present = new Set(previous.logs.map((log) => log.employee.id));
  const photoEmployeeIds = [...new Set(next.logs.map((log) => log.employee.id))].filter((id) => present.has(id) && before[id] !== after[id]);
  return { newLogs, photoEmployeeIds };
}

export function diffRoster(previous: WorkspaceState, next: WorkspaceState): RosterChange {
  const before = new Map(previous.employees.map((employee) => [employee.id, JSON.stringify(employee)]));
  return {
    changedEmployeeIds: next.employees.filter((employee) => before.has(employee.id) && before.get(employee.id) !== JSON.stringify(employee)).map((employee) => employee.id),
    addedEmployeeIds: next.employees.filter((employee) => !before.has(employee.id)).map((employee) => employee.id),
  };
}

/** One short line for the workspace's existing notice area, or null when nothing is worth saying. */
export function liveUpdateNotice(input: { newLogs: NewLog[]; changedEmployeeIds: string[]; addedEmployeeIds: string[]; nameOf: (employeeId: string) => string | undefined }): string | null {
  const { newLogs, nameOf } = input;
  if (newLogs.length === 1) return `New log from ${nameOf(newLogs[0].employeeId) ?? (newLogs[0].employeeName || "your team")}.`;
  if (newLogs.length > 1) return `${newLogs.length} new logs received.`;
  const changed = [...new Set(input.changedEmployeeIds)];
  const added = [...new Set(input.addedEmployeeIds)].filter((id) => !changed.includes(id));
  if (changed.length + added.length > 1) return `${changed.length + added.length} team profiles were updated.`;
  if (changed.length === 1) return `${nameOf(changed[0]) ?? "A team member"}’s profile was updated.`;
  if (added.length === 1) return `${nameOf(added[0]) ?? "A team member"} was added to the team.`;
  return null;
}

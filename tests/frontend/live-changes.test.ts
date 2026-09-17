import { describe, expect, it } from "vitest";
import type { DashboardData, LogDto } from "../../src/contracts/dashboard";
import type { Employee, WorkspaceState } from "../../src/contracts/workspace";
import { diffDashboard, diffRoster, employeeAvatars, liveUpdateNotice } from "../../src/lib/live/changes";

const log = (id: string, employeeId: string, name: string, avatarUrl: string | null = null): LogDto => ({
  id, employee: { id: employeeId, name, avatarUrl }, activity: "Spraying", date: "2026-09-16", field: { id: "f1", name: "FIELD A", mapImageUrl: null },
  startAt: "2026-09-16T13:00:00.000Z", endAt: "2026-09-16T15:00:00.000Z", summary: "", isNew: true, recording: null, tags: [], details: {}, updatedAt: "2026-09-16T15:00:00.000Z",
});
const dashboard = (logs: LogDto[]): DashboardData => ({
  farm: { id: "farm", name: "Bays Ranch", avatarUrl: null, timezone: "America/Los_Angeles" },
  metrics: { recordingsToday: 0, newRecordings: 0, activeWorkers: 12, responseAccuracy: null, asOf: "2026-09-16" },
  newLogCount: 0, logs, filterOptions: { activities: [], fields: [] },
});
const employee = (id: string, name: string, patch: Partial<Employee> = {}): Employee => ({ id, name, role: "Farm worker", email: "", phone: "", status: "Active", joinedAt: "2026-01-01", ...patch });
const roster = (employees: Employee[]) => ({ employees }) as WorkspaceState;

describe("describing what a live read changed", () => {
  it("finds logs that were not on the page before", () => {
    const before = dashboard([log("l1", "e1", "Isaac Wang")]);
    const after = dashboard([log("l1", "e1", "Isaac Wang"), log("l2", "e2", "Maya Patel")]);
    expect(diffDashboard(before, after)).toEqual({ newLogs: [{ id: "l2", employeeId: "e2", employeeName: "Maya Patel" }], photoEmployeeIds: [] });
    expect(diffDashboard(after, after)).toEqual({ newLogs: [], photoEmployeeIds: [] });
  });

  it("notices a changed or removed photo, but not an employee's first appearance", () => {
    const before = dashboard([log("l1", "e1", "Isaac Wang", "data:image/png;base64,AAAA"), log("l2", "e2", "Maya Patel")]);
    const after = dashboard([log("l1", "e1", "Isaac Wang", "data:image/png;base64,BBBB"), log("l2", "e2", "Maya Patel"), log("l3", "e3", "Liam Johnson", "/assets/avatar.jpg")]);
    expect(diffDashboard(before, after).photoEmployeeIds).toEqual(["e1"]);
    expect(diffDashboard(after, dashboard([log("l1", "e1", "Isaac Wang")])).photoEmployeeIds).toEqual(["e1"]);
    expect(employeeAvatars(after)).toEqual({ e1: "data:image/png;base64,BBBB", e3: "/assets/avatar.jpg" });
  });

  it("compares roster details by employee", () => {
    const before = roster([employee("e1", "Isaac Wang"), employee("e2", "Maya Patel")]);
    expect(diffRoster(before, before)).toEqual({ changedEmployeeIds: [], addedEmployeeIds: [] });
    const after = roster([employee("e1", "Isaac Wang", { phone: "555-0101" }), employee("e2", "Maya Patel"), employee("e3", "New Hire")]);
    expect(diffRoster(before, after)).toEqual({ changedEmployeeIds: ["e1"], addedEmployeeIds: ["e3"] });
  });

  it("writes one short notice, preferring new logs", () => {
    const names: Record<string, string> = { e1: "Isaac Wang", e2: "Maya Patel" };
    const nameOf = (id: string) => names[id];
    const none = { newLogs: [], changedEmployeeIds: [], addedEmployeeIds: [], nameOf };
    expect(liveUpdateNotice(none)).toBeNull();
    expect(liveUpdateNotice({ ...none, newLogs: [{ id: "l2", employeeId: "e2", employeeName: "Old Name" }] })).toBe("New log from Maya Patel.");
    expect(liveUpdateNotice({ ...none, newLogs: [{ id: "l2", employeeId: "e9", employeeName: "Unlisted Worker" }] })).toBe("New log from Unlisted Worker.");
    expect(liveUpdateNotice({ ...none, newLogs: [{ id: "l2", employeeId: "e2", employeeName: "" }, { id: "l3", employeeId: "e1", employeeName: "" }], changedEmployeeIds: ["e1"] })).toBe("2 new logs received.");
    expect(liveUpdateNotice({ ...none, changedEmployeeIds: ["e1", "e1"] })).toBe("Isaac Wang’s profile was updated.");
    expect(liveUpdateNotice({ ...none, changedEmployeeIds: ["e1", "e2"] })).toBe("2 team profiles were updated.");
    expect(liveUpdateNotice({ ...none, addedEmployeeIds: ["e2"] })).toBe("Maya Patel was added to the team.");
    expect(liveUpdateNotice({ ...none, changedEmployeeIds: ["e1"], addedEmployeeIds: ["e2"] })).toBe("2 team profiles were updated.");
  });
});

import { expect, test } from "vitest";
import { parseWorkspacePatch, parseWorkspaceState } from "@/server/workspace/validation";

const state = {
  employees: [], schedule: [], reviews: [], messages: [], tickets: [],
  settings: { farmName: "Farm", contactName: "Admin", email: "", timezone: "America/Los_Angeles", notifications: { recordings: true, weekly: true, reminders: true } },
};

test("a payload saved before migration 0016 still reads, without its retired reports list", () => {
  const parsed = parseWorkspaceState({ ...state, reports: [] });
  expect(parsed).toEqual(state);
  expect("reports" in parsed).toBe(false);
});

test("a save can no longer write a reports list", () => {
  expect(() => parseWorkspacePatch({ expectedRevision: 0, patch: { reports: [] } })).toThrow();
  expect(parseWorkspacePatch({ expectedRevision: 0, patch: { tickets: [] } }).patch).toEqual({ tickets: [] });
});

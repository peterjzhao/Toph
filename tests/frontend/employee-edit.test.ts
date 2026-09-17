import { describe, expect, it } from "vitest";
import type { Employee } from "../../src/contracts/workspace";
import { mergeEmployeeEdit } from "../../src/lib/employee-edit";

const original: Employee = { id: "worker", name: "Verification Worker", role: "Farm worker", email: "", phone: "", status: "Active", joinedAt: "2026-04-01" };

describe("saving an employee form across a live update", () => {
  it("preserves mobile name/contact edits when the open web form changes only the role", () => {
    const mobile = { ...original, name: "Verified Mobile Worker", email: "verification@example.com", phone: "555-0101" };
    const draft = { ...original, role: "Field Supervisor" };
    expect(mergeEmployeeEdit(mobile, original, draft)).toEqual({ ...mobile, role: "Field Supervisor" });
    expect(original.role).toBe("Farm worker");
    expect(mobile.role).toBe("Farm worker");
  });

  it("keeps an explicit edit, including clearing a contact field, when that field changed remotely", () => {
    const before = { ...original, phone: "555-0100" };
    const mobile = { ...before, name: "Mobile name", phone: "555-0101", status: "Inactive" as const };
    expect(mergeEmployeeEdit(mobile, before, { ...before, name: "Web name", phone: "" })).toEqual({ ...mobile, name: "Web name", phone: "" });
  });

  it("does not undo remote edits when an unchanged form is saved", () => {
    const mobile = { ...original, name: "New name", role: "Supervisor", email: "new@example.com", phone: "555-0101", status: "Inactive" as const };
    expect(mergeEmployeeEdit(mobile, original, original)).toEqual(mobile);
  });
});

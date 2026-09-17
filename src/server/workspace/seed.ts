import type { WorkspaceState } from "@/contracts/workspace";
import type { Farm } from "@/server/farm-context";

type SeedEmployee = { id: string; display_name: string; is_active: boolean };
type SeedField = { id: string; name: string };

/** Initial workspace state for a farm. Employee IDs/names come from PostgreSQL, never from the browser. */
export function makeWorkspaceSeed(farm: Farm, employees: SeedEmployee[], fields: SeedField[]): WorkspaceState {
  return {
    employees: employees.map((employee) => ({
      id: employee.id, name: employee.display_name, role: "Farm worker", email: "", phone: "",
      status: employee.is_active ? "Active" : "Inactive", joinedAt: "2026-04-01",
    })),
    schedule: employees.slice(0, 3).flatMap((employee, index) => fields[index] ? [{
      id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      title: ["Field inspection", "Harvest preparation", "Irrigation check"][index],
      employeeId: employee.id, fieldId: fields[index].id, date: index === 2 ? "2026-04-30" : "2026-04-29",
      startTime: ["07:00", "08:00", "06:30"][index], endTime: ["09:00", "11:00", "09:30"][index],
      notes: "", status: "Scheduled" as const,
    }] : []),
    reviews: [], reports: [], tickets: [],
    messages: employees.slice(0, 2).map((employee, index) => ({
      id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      employeeId: employee.id,
      body: index === 0 ? "The field inspection is ready for review." : "Can you confirm tomorrow’s harvest assignment?",
      from: "employee", createdAt: `2026-04-29T${index === 0 ? "14:10" : "15:20"}:00.000Z`, read: false,
    })),
    settings: {
      farmName: farm.name, contactName: "Ranch Admin", email: "", timezone: farm.timezone,
      notifications: { recordings: true, weekly: true, reminders: true },
    },
  };
}

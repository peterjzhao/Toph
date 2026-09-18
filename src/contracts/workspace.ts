import type { LogFormSettings } from "./log-form";
export type Employee = { id: string; name: string; role: string; email: string; phone: string; status: "Active" | "Inactive"; joinedAt: string };
export type ScheduleItem = { id: string; title: string; employeeId: string; fieldId: string; date: string; startTime: string; endTime: string; notes: string; status: "Scheduled" | "Completed" };
export type Review = { logId: string; status: "Pending" | "Approved" | "Flagged"; note: string; updatedAt: string };
/** read means the recipient has opened this message, not merely that it was saved. */
export type Message = { id: string; employeeId: string; body: string; from: "admin" | "employee"; createdAt: string; read: boolean; readAt?: string | null };
export type SupportTicket = { id: string; subject: string; category: "General" | "Technical" | "Account"; body: string; status: "Open" | "Closed"; createdAt: string };
export type WorkspaceSettings = { adminAvatar?: string | null; farmName: string; contactName: string; email: string; timezone: string; notifications: { recordings: boolean; weekly: boolean; reminders: boolean };
  /** YYYY-MM-DD the dashboard and Ask Toph treat as today. Absent means the real date. */
  demoDay?: string };
/** The design's "today". Settings' Demo day switch pins a farm to it. */
export const DESIGN_DEMO_DAY = "2026-04-29";
export type WorkspaceState = { employees: Employee[]; schedule: ScheduleItem[]; reviews: Review[]; messages: Message[]; tickets: SupportTicket[]; settings: WorkspaceSettings;
  /** The farm's choices on top of the shared log-form catalog. Absent means the catalog defaults. */
  logForm?: LogFormSettings };
export type WorkspaceResponse = { data: WorkspaceState; revision: number };

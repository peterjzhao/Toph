import "server-only";
import { z } from "zod";
import type { WorkspaceState } from "@/contracts/workspace";
import { validationError } from "@/server/errors";

export const MAX_WORKSPACE_BODY_BYTES = 512 * 1024;
export const MAX_WORKSPACE_STATE_BYTES = 1024 * 1024;
const id = z.string().uuid().transform((value) => value.toLowerCase());
const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => text(max).min(1);
const email = z.union([z.literal(""), z.string().trim().email().max(254)]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Must be a real calendar date (YYYY-MM-DD).");
const instant = z.string().datetime({ offset: true });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const employee = z.object({
  id, name: requiredText(120), role: requiredText(80), email, phone: text(60),
  status: z.enum(["Active", "Inactive"]), joinedAt: date,
}).strict();
const schedule = z.object({
  id, title: requiredText(160), employeeId: id, fieldId: id, date, startTime: time, endTime: time,
  notes: text(4000), status: z.enum(["Scheduled", "Completed"]),
}).strict().refine((item) => item.endTime > item.startTime, {
  message: "End time must be after start time on the same day.", path: ["endTime"],
});
const review = z.object({
  logId: id, status: z.enum(["Pending", "Approved", "Flagged"]), note: text(4000), updatedAt: instant,
}).strict();
const report = z.object({
  id, name: requiredText(160), kind: z.enum(["activity", "compliance", "hours"]), from: date, to: date, createdAt: instant,
}).strict().refine((item) => item.to >= item.from, { message: "End date must be on or after start date.", path: ["to"] });
const message = z.object({
  id, employeeId: id, body: requiredText(4000), from: z.enum(["admin", "employee"]), createdAt: instant, read: z.boolean(), readAt: instant.nullable().optional(),
}).strict();
const ticket = z.object({
  id, subject: requiredText(160), category: z.enum(["General", "Technical", "Account"]),
  body: requiredText(8000), status: z.enum(["Open", "Closed"]), createdAt: instant,
}).strict();
const settings = z.object({
  adminAvatar: z.string().max(150000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).refine(value => {
    const bytes = Buffer.from(value.split(",")[1], "base64");
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }, "Choose a JPEG photo.").nullable().optional(),
  farmName: requiredText(120), contactName: requiredText(120), email,
  timezone: requiredText(100).refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid IANA timezone."),
  notifications: z.object({ recordings: z.boolean(), weekly: z.boolean(), reminders: z.boolean() }).strict(),
}).strict();

export const workspaceSchema = z.object({
  employees: z.array(employee).max(250), schedule: z.array(schedule).max(1000), reviews: z.array(review).max(1000),
  reports: z.array(report).max(250), messages: z.array(message).max(2000), tickets: z.array(ticket).max(250), settings,
}).strict();
const requestSchema = z.object({
  expectedRevision: z.number().int().min(0).max(2147483646),
  // Messages are append-only through the authenticated messaging API. A workspace save
  // must never replace a conversation or forge a worker's reply/read receipt.
  patch: workspaceSchema.omit({ messages: true }).partial().refine((value) => Object.keys(value).length > 0, "Provide at least one section."),
}).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues.slice(0, 20)) fields[issue.path.join(".") || "body"] = issue.message;
    throw validationError("Invalid workspace data.", fields);
  }
  return result.data;
}

export function parseWorkspacePatch(value: unknown): { expectedRevision: number; patch: Partial<WorkspaceState> } {
  return parse(requestSchema, value);
}

export function parseWorkspaceState(value: unknown): WorkspaceState {
  const state = parse(workspaceSchema, value);
  // The old admin-only composer used read=true to mean "saved". Those messages have
  // never been seen by a worker. New recipient acknowledgements carry a server timestamp.
  state.messages = state.messages.map(message => message.from === "admin" && message.read && !message.readAt ? { ...message, read: false } : message);
  for (const section of ["employees", "schedule", "reports", "messages", "tickets"] as const) {
    const values = state[section].map((item) => item.id);
    if (new Set(values).size !== values.length) throw validationError("Duplicate record IDs are not allowed.", { [section]: "IDs must be unique within the section." });
  }
  if (new Set(state.reviews.map((item) => item.logId)).size !== state.reviews.length) {
    throw validationError("Duplicate review log IDs are not allowed.", { reviews: "Keep one review per employee log." });
  }
  if (Buffer.byteLength(JSON.stringify(state), "utf8") > MAX_WORKSPACE_STATE_BYTES) {
    throw validationError("The workspace exceeds the storage limit.", { body: "Keep the total workspace under 1 MiB." });
  }
  return state;
}

import "server-only";
import { z } from "zod";
import type { WorkspaceState } from "@/contracts/workspace";
import { validationError } from "@/server/errors";
import { parseOrThrow } from "@/server/validation/schema";
import { CUSTOM_KEY_PATTERN, MAX_CUSTOM_LOG_FIELDS, logFormCatalog, type ActivityFormDef } from "@/contracts/log-form";

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
  demoDay: date.optional(),
}).strict();

const activity = z.enum(Object.keys(logFormCatalog) as [string, ...string[]]);
/** Switches may only name keys the catalog offers for that activity. */
const catalog: Record<string, ActivityFormDef> = logFormCatalog;
const catalogKeys = (list: "defaults" | "suggested") => z.record(z.string().max(80), z.array(z.string().max(60)).max(60)).superRefine((value, ctx) => {
  for (const [name, keys] of Object.entries(value)) for (const key of keys) {
    if (!catalog[name]?.[list].some(field => field.key === key)) ctx.addIssue({ code: "custom", path: [name], message: `Unknown field: ${key}` });
  }
});
const customField = z.object({
  key: z.string().regex(CUSTOM_KEY_PATTERN), label: requiredText(60), type: z.enum(["text", "number", "select"]),
  options: z.array(requiredText(60)).min(1).max(30).optional(), activities: z.array(activity).min(1).max(30),
}).strict().refine(field => (field.type === "select") === Boolean(field.options), { message: "A select needs options; other types take none.", path: ["options"] })
  .refine(field => new Set(field.options).size === (field.options?.length ?? 0), { message: "Options must be unique.", path: ["options"] });
const logForm = z.object({
  enabled: catalogKeys("suggested"), hidden: catalogKeys("defaults"),
  custom: z.array(customField).max(MAX_CUSTOM_LOG_FIELDS).refine(fields => new Set(fields.map(field => field.key)).size === fields.length, "Custom field keys must be unique."),
}).strict();

export const workspaceSchema = z.object({
  employees: z.array(employee).max(250), schedule: z.array(schedule).max(1000), reviews: z.array(review).max(1000),
  messages: z.array(message).max(2000), tickets: z.array(ticket).max(250), settings, logForm: logForm.optional(),
}).strict();
const requestSchema = z.object({
  expectedRevision: z.number().int().min(0).max(2147483646),
  // Messages are append-only through the authenticated messaging API. A workspace save
  // must never replace a conversation or forge a worker's reply/read receipt.
  patch: workspaceSchema.omit({ messages: true }).partial().refine((value) => Object.keys(value).length > 0, "Provide at least one section."),
}).strict();


export function parseWorkspacePatch(value: unknown): { expectedRevision: number; patch: Partial<WorkspaceState> } {
  return parseOrThrow(requestSchema, value, "Invalid workspace data.");
}

/**
 * Migration 0016 deletes the unused `reports` list from stored payloads. Until a database has run
 * it, reads drop the key here so the strict schema still accepts those payloads.
 */
function withoutRetiredSections(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("reports" in value)) return value;
  const rest: Record<string, unknown> = { ...value };
  delete rest.reports;
  return rest;
}

export function parseWorkspaceState(value: unknown): WorkspaceState {
  const state = parseOrThrow(workspaceSchema, withoutRetiredSections(value), "Invalid workspace data.");
  // The old admin-only composer used read=true to mean "saved". Those messages have
  // never been seen by a worker. New recipient acknowledgements carry a server timestamp.
  state.messages = state.messages.map(message => message.from === "admin" && message.read && !message.readAt ? { ...message, read: false } : message);
  for (const section of ["employees", "schedule", "messages", "tickets"] as const) {
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

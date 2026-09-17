/**
 * Drizzle schema for the private `toph` PostgreSQL schema.
 *
 * This module is pure data definition: no environment reads, no connections. It is imported by
 * the server-only services, the migration/seed scripts, and drizzle-kit (drizzle.config.ts).
 * The reviewed SQL for these definitions lives under drizzle/.
 */
import { sql } from "drizzle-orm";
import type { WorkspaceState } from "@/contracts/workspace";
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const toph = pgSchema("toph");

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const farms = toph.table(
  "farms",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    avatarPath: text("avatar_path"),
    timezone: text("timezone").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check("farms_name_nonempty", sql`length(btrim(name)) > 0`),
    check("farms_timezone_nonempty", sql`length(btrim(timezone)) > 0`),
  ],
);

/** Supplemental page state; original dashboard records remain normalized and unchanged. */
export const workspaceState = toph.table(
  "workspace_state",
  {
    farmId: uuid("farm_id").primaryKey().references(() => farms.id, { onDelete: "restrict" }),
    payload: jsonb("payload").$type<WorkspaceState>().notNull(),
    revision: integer("revision").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check("workspace_state_payload_object", sql`jsonb_typeof(payload) = 'object'`),
    check("workspace_state_revision_nonnegative", sql`revision >= 0`),
    check("workspace_state_payload_size", sql`octet_length(payload::text) <= 1048576`),
  ],
);

export const employees = toph.table(
  "employees",
  {
    id: uuid("id").primaryKey(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    /** Application-relative image path for the employee, e.g. /assets/people/maya.jpg. */
    avatarPath: text("avatar_path"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Lets work_logs reference (farm_id, employee_id) so an employee can never belong to another farm.
    unique("employees_farm_id_id_unique").on(t.farmId, t.id),
    check("employees_display_name_nonempty", sql`length(btrim(display_name)) > 0`),
  ],
);

export const fields = toph.table(
  "fields",
  {
    id: uuid("id").primaryKey(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Application-relative asset path, e.g. /assets/field-map.svg. Null when no map exists. */
    mapImagePath: text("map_image_path"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("fields_farm_id_id_unique").on(t.farmId, t.id),
    check("fields_name_nonempty", sql`length(btrim(name)) > 0`),
  ],
);

export const workLogs = toph.table(
  "work_logs",
  {
    id: uuid("id").primaryKey(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id").notNull(),
    fieldId: uuid("field_id").notNull(),
    activity: text("activity").notNull(),
    /** Business date in the farm timezone; kept separate from the instants below. */
    workDate: date("work_date", { mode: "string" }).notNull(),
    startAt: timestamp("start_at", { withTimezone: true, mode: "date" }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, mode: "date" }).notNull(),
    summary: text("summary").notNull(),
    transcript: text("transcript"),
    isNew: boolean("is_new").notNull().default(false),
    /** Application-relative recording path; null means no recording exists (never a broken URL). */
    recordingPath: text("recording_path"),
    recordingDurationSeconds: doublePrecision("recording_duration_seconds"),
    /** Rendered waveform image for the recording, if one exists. */
    waveformAssetPath: text("waveform_asset_path"),
    /** Null or an array of finite numbers in [0, 1], at most 2,048 samples (see waveform_peaks_valid). */
    waveformPeaks: jsonb("waveform_peaks").$type<number[]>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("work_logs_farm_id_id_unique").on(t.farmId, t.id),
    foreignKey({
      name: "work_logs_employee_fk",
      columns: [t.farmId, t.employeeId],
      foreignColumns: [employees.farmId, employees.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_logs_field_fk",
      columns: [t.farmId, t.fieldId],
      foreignColumns: [fields.farmId, fields.id],
    }).onDelete("restrict"),
    index("work_logs_farm_date_idx").on(t.farmId, t.workDate, t.id),
    index("work_logs_farm_employee_idx").on(t.farmId, t.employeeId),
    index("work_logs_farm_field_idx").on(t.farmId, t.fieldId),
    index("work_logs_farm_activity_idx").on(t.farmId, t.activity),
    check("work_logs_activity_nonempty", sql`length(btrim(activity)) > 0`),
    check("work_logs_end_after_start", sql`end_at > start_at`),
    // A duration needs a recording and must be finite and positive. In PostgreSQL NaN sorts above
    // +Infinity, so the upper bound excludes both special values.
    check(
      "work_logs_recording_duration_valid",
      sql`recording_duration_seconds IS NULL OR (recording_path IS NOT NULL AND recording_duration_seconds > 0 AND recording_duration_seconds < 'Infinity'::double precision)`,
    ),
    check("work_logs_waveform_peaks_valid", sql`waveform_peaks IS NULL OR toph.waveform_peaks_valid(waveform_peaks)`),
  ],
);

export const tags = toph.table(
  "tags",
  {
    id: uuid("id").primaryKey(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "restrict" }),
    /** Display label: trimmed, whitespace-collapsed, NFC, original casing, 1–40 characters. */
    label: text("label").notNull(),
    /** Deterministic lowercase key used for case-insensitive uniqueness within a farm. */
    normalizedLabel: text("normalized_label").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("tags_farm_id_id_unique").on(t.farmId, t.id),
    unique("tags_farm_id_normalized_label_unique").on(t.farmId, t.normalizedLabel),
    check("tags_label_nonempty", sql`length(btrim(label)) > 0`),
    check("tags_label_trimmed", sql`label = btrim(label)`),
    check("tags_label_max_length", sql`length(label) <= 40`),
    check("tags_normalized_label_nonempty", sql`length(normalized_label) > 0`),
  ],
);

export const workLogTags = toph.table(
  "work_log_tags",
  {
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "restrict" }),
    workLogId: uuid("work_log_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "work_log_tags_pk", columns: [t.workLogId, t.tagId] }),
    foreignKey({
      name: "work_log_tags_work_log_fk",
      columns: [t.farmId, t.workLogId],
      foreignColumns: [workLogs.farmId, workLogs.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "work_log_tags_tag_fk",
      columns: [t.farmId, t.tagId],
      foreignColumns: [tags.farmId, tags.id],
    }).onDelete("cascade"),
    index("work_log_tags_farm_tag_log_idx").on(t.farmId, t.tagId, t.workLogId),
  ],
);

/**
 * One row per work log, shaped like the dashboard table: names joined from their owning
 * records (never duplicated) and tags aggregated by a correlated subquery so multiple tags
 * never multiply rows. Private to the toph schema like the tables.
 */
export const dashboardLogs = toph
  .view("dashboard_logs", {
    id: uuid("id").notNull(),
    farmId: uuid("farm_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    employeeName: text("employee_name").notNull(),
    employeeAvatarPath: text("employee_avatar_path"),
    activity: text("activity").notNull(),
    workDate: date("work_date", { mode: "string" }).notNull(),
    fieldId: uuid("field_id").notNull(),
    fieldName: text("field_name").notNull(),
    fieldMapImagePath: text("field_map_image_path"),
    startAt: timestamp("start_at", { withTimezone: true, mode: "date" }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, mode: "date" }).notNull(),
    summary: text("summary").notNull(),
    isNew: boolean("is_new").notNull(),
    recordingPath: text("recording_path"),
    recordingDurationSeconds: doublePrecision("recording_duration_seconds"),
    waveformAssetPath: text("waveform_asset_path"),
    waveformPeaks: jsonb("waveform_peaks").$type<number[]>(),
    tags: jsonb("tags").$type<{ id: string; label: string }[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  })
  .as(
    sql`select
  l.id,
  l.farm_id,
  l.employee_id,
  e.display_name as employee_name,
  e.avatar_path as employee_avatar_path,
  l.activity,
  l.work_date,
  l.field_id,
  f.name as field_name,
  f.map_image_path as field_map_image_path,
  l.start_at,
  l.end_at,
  l.summary,
  l.is_new,
  l.recording_path,
  l.recording_duration_seconds,
  l.waveform_asset_path,
  l.waveform_peaks,
  (
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label) order by t.normalized_label, t.id), '[]'::jsonb)
    from toph.work_log_tags wt
    join toph.tags t on t.id = wt.tag_id and t.farm_id = wt.farm_id
    where wt.work_log_id = l.id
  ) as tags,
  l.created_at,
  l.updated_at
from toph.work_logs l
join toph.employees e on e.id = l.employee_id and e.farm_id = l.farm_id
join toph.fields f on f.id = l.field_id and f.farm_id = l.farm_id`,
  );

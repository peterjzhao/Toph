import "server-only";
/**
 * Regulatory reports: prepare a document from the farm's logs, keep it frozen, list, open, delete.
 *
 * A stored document never changes after it is made, so reopening a report shows exactly what was
 * prepared, even after logs are corrected. Facts come from recorded log values and, when a server
 * key is configured, from each log's own words (./detect). Everything is scoped to the caller's farm.
 */
import { randomUUID } from "node:crypto";
import {
  createReportRequestSchema, MAX_REPORT_DAYS,
  type ReportDocument, type ReportKind, type ReportReadiness, type SavedReportDto, type SavedReportSummary,
} from "@/contracts/reports";
import type { AccountContext } from "@/server/accounts/service";
import { notFound, validationError } from "@/server/errors";
import type { FarmContext } from "@/server/farm-context";
import { reserveTranscription } from "@/server/recordings/quota";
import { isValidCalendarDate } from "@/server/time/zoned";
import { isUuid } from "@/server/validation/ids";
import { assembleReport, INPUT_ACTIVITIES, LOOKBACK_DAYS, mergeFacts, recordedFacts, type ReportLog } from "./assemble";
import { detectionModel, detectReportFacts, type DetectedFact, type DetectionLog } from "./detect";

/** Most logs one report reads. A longer period is split into several reports. */
export const MAX_REPORT_LOGS = 1000;
const MAX_SAVED_REPORTS = 250;

/** Activities whose notes can hold facts a report uses. Labor hours needs only recorded times. */
const DETECTION_ACTIVITIES: Record<ReportKind, ReadonlySet<string>> = {
  "pesticide-use": new Set(["Spraying", "Pest Control"]),
  "food-safety": new Set(["Spraying", "Pest Control", "Fertilizing", "Harvesting", "Irrigation"]),
  "harvest-traceability": new Set(["Harvesting", "Spraying", "Pest Control", "Fertilizing"]),
  "labor-hours": new Set(),
  organic: new Set(["Spraying", "Pest Control", "Fertilizing", "Planting", "Seeding", "Harvesting"]),
  acreage: new Set(["Planting", "Seeding", "Irrigation"]),
  nitrogen: new Set(["Fertilizing", "Irrigation", "Harvesting"]),
};
/** Reports that check harvests against earlier applications. */
const LOOKS_BACK: ReadonlySet<ReportKind> = new Set(["food-safety", "harvest-traceability"]);

type LogRow = {
  id: string; work_date: string; employee_name: string; activity: string; field_name: string;
  start_time: string; end_time: string; hours: string | number; summary: string; notes: string | null;
  details: Record<string, string | number> | null;
};

function toReportLog(row: LogRow): ReportLog {
  return {
    id: row.id, date: row.work_date, employee: row.employee_name, activity: row.activity, field: row.field_name,
    start: row.start_time, end: row.end_time, hours: Math.max(0, Number(row.hours) || 0),
    // Saved mobile notes are the worker-reviewed summary; the view's summary covers other logs.
    notes: row.notes?.trim() || row.summary,
    facts: recordedFacts(row.activity, row.details ?? {}),
  };
}

/** Logs dated from..to, and input applications from the lookback window before `from`. */
export async function loadReportLogs(ctx: FarmContext, from: string, to: string): Promise<{ logs: ReportLog[]; earlier: ReportLog[] }> {
  const select = () => ctx.sql`
    select l.id, l.work_date::text as work_date, l.employee_name, l.activity, l.field_name,
      to_char(l.start_at at time zone ${ctx.farm.timezone}, 'HH24:MI') as start_time,
      to_char(l.end_at at time zone ${ctx.farm.timezone}, 'HH24:MI') as end_time,
      extract(epoch from (l.end_at - l.start_at)) / 3600 as hours,
      l.summary, s.notes, l.details
    from toph.dashboard_logs l
    left join toph.mobile_submissions s on s.log_id = l.id and s.farm_id = l.farm_id
    where l.farm_id = ${ctx.farmId}`;
  const rows = await ctx.sql<LogRow[]>`${select()} and l.work_date between ${from}::date and ${to}::date
    order by l.work_date, l.start_at, l.id limit ${MAX_REPORT_LOGS + 1}`;
  if (rows.length > MAX_REPORT_LOGS) throw validationError(`This period has more than ${MAX_REPORT_LOGS.toLocaleString("en-US")} logs. Choose a shorter period.`);
  const earlier = await ctx.sql<LogRow[]>`${select()}
    and l.work_date >= ${from}::date - ${LOOKBACK_DAYS}::int and l.work_date < ${from}::date
    and l.activity = any(${[...INPUT_ACTIVITIES]}::text[])
    order by l.work_date, l.start_at, l.id limit ${MAX_REPORT_LOGS}`;
  return { logs: rows.map(toReportLog), earlier: earlier.map(toReportLog) };
}

export function toDetectionLog(log: ReportLog): DetectionLog {
  const recorded: Record<string, string | number> = {};
  for (const [key, cell] of Object.entries(log.facts)) if (cell?.value != null) recorded[key] = cell.value;
  return { id: log.id, activity: log.activity, field: log.field, date: log.date, notes: log.notes, recorded };
}

export type GenerateOptions = { apiKey: string | null; signal: AbortSignal; fetcher?: typeof fetch; now?: Date };

export function parseCreateReport(body: unknown) {
  const parsed = createReportRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw validationError(issue?.message ?? "Check the report details.", issue?.path.length ? { [String(issue.path[0])]: issue.message } : undefined);
  }
  const { from, to } = parsed.data;
  if (!isValidCalendarDate(from) || !isValidCalendarDate(to)) throw validationError("Use real calendar dates.");
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > MAX_REPORT_DAYS) throw validationError(`A report covers at most ${MAX_REPORT_DAYS} days.`, { to: "Choose a shorter period." });
  return parsed.data;
}

/** The logs whose notes `kind` reads, and the earlier applications it checks harvests against. */
export function detectionCandidates(kind: ReportKind, logs: readonly ReportLog[], earlier: readonly ReportLog[]): { candidates: ReportLog[]; lookback: ReportLog[] } {
  const wanted = DETECTION_ACTIVITIES[kind];
  const harvested = new Set(logs.filter(log => log.activity === "Harvesting").map(log => log.field));
  const lookback = LOOKS_BACK.has(kind) ? earlier.filter(log => harvested.has(log.field)) : [];
  // Traceability only looks one step back from a harvest, so applications elsewhere are not read.
  const inPeriod = logs.filter(log => wanted.has(log.activity) && (kind !== "harvest-traceability" || log.activity === "Harvesting" || harvested.has(log.field)));
  return { candidates: [...inPeriod, ...lookback].filter(log => log.notes.trim()), lookback };
}

/** Adds detected facts to each log in place; returns how many facts each log gained. */
export function applyDetections(logs: readonly ReportLog[], detected: ReadonlyMap<string, readonly DetectedFact[]>): Map<string, number> {
  const gained = new Map<string, number>();
  for (const log of logs) {
    const before = Object.keys(log.facts).length;
    log.facts = mergeFacts(log.facts, detected.get(log.id) ?? []);
    gained.set(log.id, Object.keys(log.facts).length - before);
  }
  return gained;
}

/** Builds a document for `kind` over from..to, reading log notes with the model when a key is set. */
export async function prepareReportDocument(ctx: FarmContext, kind: ReportKind, from: string, to: string, options: GenerateOptions): Promise<ReportDocument> {
  const { logs, earlier } = await loadReportLogs(ctx, from, to);
  const { candidates, lookback } = detectionCandidates(kind, logs, earlier);
  const useModel = Boolean(options.apiKey) && candidates.length > 0;
  let factsDetected = 0;
  if (useModel) {
    // One report is one request against the farm's AI allowance, however many batches it needs.
    await reserveTranscription(ctx, "The farm's AI limit has been reached. Try again in a minute.");
    const detected = await detectReportFacts(candidates.map(toDetectionLog), options.apiKey!, options.signal, { fetcher: options.fetcher });
    for (const count of applyDetections(candidates, detected).values()) factsDetected += count;
  }
  return assembleReport({
    kind, farm: { name: ctx.farm.name, timezone: ctx.farm.timezone }, period: { from, to },
    generatedAt: (options.now ?? new Date()).toISOString(),
    detection: { method: useModel ? "ai" : "recorded", model: useModel ? detectionModel : null, logsRead: candidates.length, factsDetected },
    logs, earlierApplications: lookback,
  });
}

type ReportRowDb = { id: string; kind: ReportKind; name: string; period_from: string; period_to: string; created_by: string | null; created_at: Date; readiness: ReportReadiness };
const summary = (row: ReportRowDb): SavedReportSummary => ({
  id: row.id, kind: row.kind, name: row.name, from: row.period_from, to: row.period_to,
  createdAt: new Date(row.created_at).toISOString(), createdBy: row.created_by, readiness: row.readiness,
});

export async function generateReport(ctx: AccountContext, body: unknown, options: GenerateOptions): Promise<SavedReportDto> {
  const { kind, name, from, to } = parseCreateReport(body);
  const [{ count }] = await ctx.sql<{ count: number }[]>`select count(*)::int as count from toph.farm_reports where farm_id = ${ctx.farmId}`;
  if (count >= MAX_SAVED_REPORTS) throw validationError(`A farm keeps at most ${MAX_SAVED_REPORTS} reports. Delete an old report first.`);
  const document = await prepareReportDocument(ctx, kind, from, to, options);
  const id = randomUUID();
  const [row] = await ctx.sql<ReportRowDb[]>`
    insert into toph.farm_reports (id, farm_id, kind, name, period_from, period_to, document, created_by)
    values (${id}, ${ctx.farmId}, ${kind}, ${name}, ${from}, ${to}, ${JSON.stringify(document)}::jsonb, ${ctx.account.name})
    returning id, kind, name, period_from::text as period_from, period_to::text as period_to, created_by, created_at, document->'readiness' as readiness`;
  return { ...summary(row), document };
}

export async function listReports(ctx: FarmContext): Promise<SavedReportSummary[]> {
  const rows = await ctx.sql<ReportRowDb[]>`
    select id, kind, name, period_from::text as period_from, period_to::text as period_to, created_by, created_at, document->'readiness' as readiness
    from toph.farm_reports where farm_id = ${ctx.farmId}
    order by created_at desc, id limit ${MAX_SAVED_REPORTS}`;
  return rows.map(summary);
}

export async function getReport(ctx: FarmContext, id: string): Promise<SavedReportDto> {
  if (!isUuid(id)) throw notFound("Report not found.");
  const [row] = await ctx.sql<(ReportRowDb & { document: ReportDocument })[]>`
    select id, kind, name, period_from::text as period_from, period_to::text as period_to, created_by, created_at, document->'readiness' as readiness, document
    from toph.farm_reports where farm_id = ${ctx.farmId} and id = ${id}`;
  if (!row) throw notFound("Report not found.");
  return { ...summary(row), document: row.document };
}

export async function deleteReport(ctx: FarmContext, id: string): Promise<void> {
  if (!isUuid(id)) throw notFound("Report not found.");
  const rows = await ctx.sql`delete from toph.farm_reports where farm_id = ${ctx.farmId} and id = ${id} returning id`;
  if (!rows.length) throw notFound("Report not found.");
}

import "server-only";
/**
 * Dashboard and detail reads. Every query is scoped to the farm in the context. Rows come from
 * the one-row-per-log `toph.dashboard_logs` view, so the page shape is visible in the database
 * as well as in the DTO.
 */
import { and, asc, between, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DashboardData, DashboardMeta, DashboardQuery, LogDto, TagDto } from "@/contracts/dashboard";
import { DASHBOARD_CONTRACT_VERSION } from "@/contracts/dashboard";
import type { FarmContext } from "@/server/farm-context";
import { dashboardLogs, employees, fields, tags, workLogTags, workLogs } from "@/server/db/schema";
import { notFound } from "@/server/errors";
import { instantToLocalDate } from "@/server/time/zoned";
import { validateDashboardQuery, type ParsedDashboardQuery } from "@/server/validation/dashboard-query";
import { parseUuid } from "@/server/validation/ids";
import { containsPattern } from "@/server/validation/like-pattern";

export type DashboardResult = { data: DashboardData; meta: DashboardMeta };

type DateRange = { from: string; to: string } | null;

type ViewRow = typeof dashboardLogs.$inferSelect;

async function attachMobileClips(ctx: FarmContext, logs: LogDto[]): Promise<LogDto[]> {
  const ids = logs.filter(log => log.recording?.url.startsWith("/api/mobile/v1/recordings/")).map(log => log.id);
  if (!ids.length) return logs;
  const clips = await ctx.sql`select id, log_id, duration_seconds from toph.mobile_recordings where farm_id = ${ctx.farmId} and log_id = any(${ids}::uuid[]) order by position`;
  return logs.map(log => {
    const recordings = clips.filter(clip => clip.log_id === log.id).map(clip => ({ url: `/api/mobile/v1/recordings/${clip.id}`, durationSeconds: Number(clip.duration_seconds) }));
    return log.recording && recordings.length ? { ...log, recording: { ...log.recording, clips: recordings } } : log;
  });
}

/** Maps a dashboard_logs row to the page-shaped DTO. Asset paths are application-relative URLs. */
export function toLogDto(row: ViewRow): LogDto {
  return {
    id: row.id,
    employee: { id: row.employeeId, name: row.employeeName, avatarUrl: row.employeeAvatarPath },
    activity: row.activity,
    date: row.workDate,
    field: { id: row.fieldId, name: row.fieldName, mapImageUrl: row.fieldMapImagePath },
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    summary: row.summary,
    isNew: row.isNew,
    recording: row.recordingPath
      ? {
          url: row.recordingPath,
          durationSeconds: row.recordingDurationSeconds === null ? null : Number(row.recordingDurationSeconds),
          waveformAssetUrl: row.waveformAssetPath,
          waveformPeaks: Array.isArray(row.waveformPeaks) ? row.waveformPeaks.map(Number) : null,
        }
      : null,
    tags: (row.tags ?? []).map((tag) => ({ id: tag.id, label: tag.label })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Inclusive business-date bounds for the requested period; `this-month` is the farm's current calendar month. */
export function resolveDateRange(query: ParsedDashboardQuery, today: string): DateRange {
  if (query.period === "all") return null;
  if (query.period === "custom") return { from: query.from as string, to: query.to as string };
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

function buildLogFilter(farmId: string, query: ParsedDashboardQuery, dateRange: DateRange): SQL {
  const conditions: SQL[] = [eq(dashboardLogs.farmId, farmId)];
  if (query.activities.length > 0) conditions.push(inArray(dashboardLogs.activity, query.activities));
  if (query.fieldIds.length > 0) conditions.push(inArray(dashboardLogs.fieldId, query.fieldIds));
  if (dateRange) conditions.push(between(dashboardLogs.workDate, dateRange.from, dateRange.to));
  if (query.q) {
    const pattern = containsPattern(query.q);
    conditions.push(
      or(
        sql`${dashboardLogs.employeeName} ILIKE ${pattern} ESCAPE '\\'`,
        sql`${dashboardLogs.activity} ILIKE ${pattern} ESCAPE '\\'`,
        sql`${dashboardLogs.fieldName} ILIKE ${pattern} ESCAPE '\\'`,
        sql`exists (
          select 1 from ${workLogTags} wt
          join ${tags} t on t.id = wt.tag_id and t.farm_id = wt.farm_id
          where wt.work_log_id = ${dashboardLogs.id} and t.label ILIKE ${pattern} ESCAPE '\\'
        )`,
      ) as SQL,
    );
  }
  return and(...conditions) as SQL;
}

// Sort keys map to fixed column lists; request values never reach SQL as text.
function orderFor(sort: ParsedDashboardQuery["sort"]): SQL[] {
  const dateAsc = [asc(dashboardLogs.workDate), asc(dashboardLogs.startAt), asc(dashboardLogs.id)];
  switch (sort) {
    case "date-desc":
      return [desc(dashboardLogs.workDate), desc(dashboardLogs.startAt), asc(dashboardLogs.id)];
    case "employee-asc":
      return [asc(sql`lower(${dashboardLogs.employeeName})`), ...dateAsc];
    case "activity-asc":
      return [asc(sql`lower(${dashboardLogs.activity})`), ...dateAsc];
    default:
      return dateAsc;
  }
}

/**
 * Metric cards computed from the farm's data as of today in the farm timezone. Response
 * accuracy has no measured source yet and is reported as null.
 */
async function loadMetrics(ctx: FarmContext, today: string): Promise<DashboardData["metrics"]> {
  const [logCounts] = await ctx.db
    .select({
      recordingsToday: sql<number>`count(*)::int`,
      newRecordings: sql<number>`count(*) filter (where ${workLogs.isNew})::int`,
    })
    .from(workLogs)
    .where(and(eq(workLogs.farmId, ctx.farmId), eq(workLogs.workDate, today)));
  const [workerCounts] = await ctx.db
    .select({ activeWorkers: sql<number>`count(*)::int` })
    .from(employees)
    .where(and(eq(employees.farmId, ctx.farmId), eq(employees.isActive, true)));

  return {
    recordingsToday: logCounts?.recordingsToday ?? 0,
    newRecordings: logCounts?.newRecordings ?? 0,
    // Every configured farm has one administrator account, separate from its employee roster.
    activeWorkers: (workerCounts?.activeWorkers ?? 0) + 1,
    responseAccuracy: null,
    asOf: today,
  };
}

/**
 * Loads the dashboard for the context's farm: computed metrics, filtered/sorted/paginated
 * logs with tags, the filtered new-log count, and farm-wide filter options.
 */
export async function getDashboard(ctx: FarmContext, query: DashboardQuery = {}): Promise<DashboardResult> {
  const parsed = validateDashboardQuery(query);
  const today = instantToLocalDate(new Date(), ctx.farm.timezone);
  const dateRange = resolveDateRange(parsed, today);
  const filter = buildLogFilter(ctx.farmId, parsed, dateRange);

  const [counts, rows, metrics, activityRows, fieldRows] = await Promise.all([
    ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        newCount: sql<number>`count(*) filter (where ${dashboardLogs.isNew})::int`,
      })
      .from(dashboardLogs)
      .where(filter),
    ctx.db.select().from(dashboardLogs).where(filter).orderBy(...orderFor(parsed.sort)).limit(parsed.limit).offset(parsed.offset),
    loadMetrics(ctx, today),
    ctx.db
      .select({ activity: workLogs.activity })
      .from(workLogs)
      .where(eq(workLogs.farmId, ctx.farmId))
      .groupBy(workLogs.activity)
      .orderBy(asc(sql`lower(${workLogs.activity})`), asc(workLogs.activity)),
    ctx.db
      .select({ id: fields.id, name: fields.name })
      .from(fields)
      .where(eq(fields.farmId, ctx.farmId))
      .orderBy(asc(fields.name), asc(fields.id)),
  ]);

  const total = counts[0]?.total ?? 0;
  return {
    data: {
      farm: {
        id: ctx.farm.id,
        name: ctx.farm.name,
        avatarUrl: ctx.farm.avatarPath,
        timezone: ctx.farm.timezone,
      },
      metrics,
      newLogCount: counts[0]?.newCount ?? 0,
      logs: await attachMobileClips(ctx, rows.map(toLogDto)),
      filterOptions: {
        activities: activityRows.map((r) => r.activity),
        fields: fieldRows.map((r) => ({ id: r.id, name: r.name })),
      },
    },
    meta: {
      contractVersion: DASHBOARD_CONTRACT_VERSION,
      filters: {
        q: parsed.q ?? null,
        activities: parsed.activities,
        fieldIds: parsed.fieldIds,
        period: parsed.period,
        dateRange,
        sort: parsed.sort,
      },
      pagination: {
        total,
        limit: parsed.limit,
        offset: parsed.offset,
        hasMore: parsed.offset + rows.length < total,
      },
    },
  };
}

/** Loads one log by ID within the context's farm; 400 for a malformed ID, 404 when out of scope. */
export async function getLog(ctx: FarmContext, logId: string): Promise<LogDto> {
  const id = parseUuid(logId, "logId");
  const [row] = await ctx.db
    .select()
    .from(dashboardLogs)
    .where(and(eq(dashboardLogs.farmId, ctx.farmId), eq(dashboardLogs.id, id)))
    .limit(1);
  if (!row) throw notFound("Log not found.");
  return (await attachMobileClips(ctx, [toLogDto(row)]))[0];
}

/** The farm's tag catalog, sorted by normalized label then ID. */
export async function listTags(ctx: FarmContext): Promise<TagDto[]> {
  const rows = await ctx.db
    .select({ id: tags.id, label: tags.label })
    .from(tags)
    .where(eq(tags.farmId, ctx.farmId))
    .orderBy(asc(tags.normalizedLabel), asc(tags.id));
  return rows.map((r) => ({ id: r.id, label: r.label }));
}

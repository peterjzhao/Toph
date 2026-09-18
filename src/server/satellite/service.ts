import "server-only";
/**
 * Database-backed orchestration for the field timeline.
 *
 * Everything here is farm-scoped through the caller's FarmContext: a field, its boundary and its
 * logs can only ever come from the signed-in admin's own farm.
 */
import type { FieldPoint } from "@/contracts/accounts";
import type { FieldAnalysisRequest, FieldAnalysisResult, FieldTimelineDto, Layer } from "@/contracts/satellite";
import { notFound, validationError } from "@/server/errors";
import type { FarmContext } from "@/server/farm-context";
import { dayLabel } from "@/server/ask/farm-question";
import { reserveTranscription } from "@/server/recordings/quota";
import { analyseField, type AnalysisLog } from "./analysis";
import { MAX_CLOUD_COVER, searchAcquisitions } from "./catalog";
import { cdseCredentials, cdseToken } from "./client";
import { parseFarmExtent, readFarmExtent, type ExtentSource, type FarmExtent } from "./extent";
import { renderFrame, type Frame } from "./imagery";
import { createPassCache } from "./pass-cache";
import { fetchFieldStatistics, type FieldObservation } from "./statistics";
import { reserveSatellite } from "./usage";

/** Sentinel-2 reached routine global coverage in 2017; earlier dates return nothing useful. */
export const ARCHIVE_START = "2017-01-01";
const INDEX_NAME = "ndvi";
/** A single analysis window; wider ranges are rejected rather than silently truncated. */
const MAX_ANALYSIS_DAYS = 400;

export type FieldRecord = { id: string; name: string; boundary: FieldPoint[] };

type ExtentRow = {
  extent_min_x: number | null; extent_min_y: number | null;
  extent_max_x: number | null; extent_max_y: number | null; extent_source: string | null;
};

/** Null when this farm's raster has no georeference; the map page then behaves exactly as before. */
export async function loadExtent(ctx: FarmContext): Promise<FarmExtent | null> {
  const rows = await ctx.sql<ExtentRow[]>`
    select extent_min_x, extent_min_y, extent_max_x, extent_max_y, extent_source
    from toph.farm_images where farm_id = ${ctx.farmId}`;
  const row = rows[0];
  if (!row) return null;
  return readFarmExtent({ minX: row.extent_min_x, minY: row.extent_min_y, maxX: row.extent_max_x, maxY: row.extent_max_y, source: row.extent_source });
}

export async function loadField(ctx: FarmContext, fieldId: string): Promise<FieldRecord> {
  const rows = await ctx.sql<{ id: string; name: string; boundary: FieldPoint[] | null }[]>`
    select id, name, boundary from toph.fields where farm_id = ${ctx.farmId} and id = ${fieldId}`;
  const row = rows[0];
  if (!row) throw notFound("That field isn’t on this farm.");
  if (!row.boundary?.length) throw validationError("This field has no saved boundary, so it can’t be measured from orbit.");
  return { id: row.id, name: row.name, boundary: row.boundary };
}

async function token(): Promise<string> {
  return cdseToken(cdseCredentials());
}

/**
 * Records where an existing raster sits on the earth.
 *
 * Used when a farm's aerial was uploaded, or seeded, rather than captured from the map picker, so
 * its extent was never known. The admin frames their own land, which is approximate by nature;
 * `located` records that so the interface can say so.
 */
export async function saveFarmLocation(ctx: FarmContext, bbox: [number, number, number, number], source: ExtentSource = "located"): Promise<FarmExtent> {
  const extent = parseFarmExtent({ minX: bbox[0], minY: bbox[1], maxX: bbox[2], maxY: bbox[3], source });
  const rows = await ctx.sql`
    update toph.farm_images set
      extent_min_x = ${extent.minX}, extent_min_y = ${extent.minY},
      extent_max_x = ${extent.maxX}, extent_max_y = ${extent.maxY},
      extent_source = ${extent.source}, updated_at = now()
    where farm_id = ${ctx.farmId}
    returning farm_id`;
  if (!rows.length) throw notFound("This farm has no map image to place yet.");
  return extent;
}

const passCache = createPassCache();

/**
 * Every usable pass over the farm, for the map's date slider.
 *
 * The page asks once per visit and then moves the slider without asking again; only the frame it
 * settles on is rendered, in the imagery route. One catalogue sweep serves every visit to the same
 * farm and extent until the cache expires, and only a real sweep draws on the farm's allowance.
 */
export async function fieldTimeline(ctx: FarmContext, options: { today: string }): Promise<FieldTimelineDto> {
  const extent = await loadExtent(ctx);
  if (!extent) return { extent: null, today: options.today, passes: [] };
  const key = [ctx.farmId, extent.minX, extent.minY, extent.maxX, extent.maxY, options.today].join("|");
  const passes = await passCache.get(key, async () => {
    await reserveSatellite(ctx);
    return searchAcquisitions(extent, { from: ARCHIVE_START, to: options.today }, await token(), fetch, MAX_CLOUD_COVER);
  });
  return { extent, today: options.today, passes };
}

export async function fieldFrame(ctx: FarmContext, date: string, layer: Layer): Promise<Frame> {
  const extent = await loadExtent(ctx);
  if (!extent) throw notFound("This farm's map has no location yet.");
  await reserveSatellite(ctx);
  return renderFrame(extent, date, layer, await token());
}

/** Keeps a durable record of exactly the readings an analysis was grounded in. */
async function saveStatistics(ctx: FarmContext, fieldId: string, observations: readonly FieldObservation[]) {
  if (!observations.length) return;
  const rows = observations.map(item => ({
    farm_id: ctx.farmId, field_id: fieldId, image_date: item.date, index_name: INDEX_NAME,
    mean: item.mean, min: item.min, max: item.max, std_dev: item.stDev, valid_fraction: item.validFraction,
  }));
  await ctx.sql`
    insert into toph.field_index_stats ${ctx.sql(rows, "farm_id", "field_id", "image_date", "index_name", "mean", "min", "max", "std_dev", "valid_fraction")}
    on conflict (farm_id, field_id, image_date, index_name) do update set
      mean = excluded.mean, min = excluded.min, max = excluded.max,
      std_dev = excluded.std_dev, valid_fraction = excluded.valid_fraction`;
}

async function logsInRange(ctx: FarmContext, fieldId: string, from: string, to: string): Promise<AnalysisLog[]> {
  const rows = await ctx.sql<{
    id: string; work_date: string; employee_name: string; activity: string;
    summary: string; notes: string | null; details: Record<string, string | number> | null;
  }[]>`
    select l.id, l.work_date::text as work_date, l.employee_name, l.activity, l.summary, s.notes, l.details
    from toph.dashboard_logs l
    left join toph.mobile_submissions s on s.log_id = l.id and s.farm_id = l.farm_id
    where l.farm_id = ${ctx.farmId} and l.field_id = ${fieldId}
      and l.work_date >= ${from}::date and l.work_date <= ${to}::date
    order by l.work_date, l.start_at, l.id`;
  return rows.map(row => ({
    id: row.id,
    // Spelled-out dates: the model misreads ISO months, as recorded in Ask Toph.
    day: dayLabel(row.work_date),
    employee: row.employee_name,
    activity: row.activity,
    product: typeof row.details?.product === "string" ? row.details.product : null,
    amount: typeof row.details?.amount === "number" ? row.details.amount : null,
    unit: typeof row.details?.unit === "string" ? row.details.unit : null,
    summary: (row.notes?.trim() || row.summary).slice(0, 600),
  }));
}

export async function fieldAnalysis(ctx: FarmContext, request: FieldAnalysisRequest, apiKey: string, signal: AbortSignal): Promise<FieldAnalysisResult> {
  if (request.from > request.to) throw validationError("Choose a range that ends after it starts.");
  const days = (Date.parse(`${request.to}T00:00:00Z`) - Date.parse(`${request.from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days > MAX_ANALYSIS_DAYS) throw validationError("Choose a range of at most a year.");

  const extent = await loadExtent(ctx);
  if (!extent) throw notFound("This farm's map has no location yet.");
  const field = await loadField(ctx, request.fieldId);

  await reserveSatellite(ctx);
  const observations = await fetchFieldStatistics(field.boundary, extent, { from: request.from, to: request.to }, await token());
  await saveStatistics(ctx, field.id, observations);

  const logs = await logsInRange(ctx, field.id, request.from, request.to);
  const context = { farmName: ctx.farm.name, timezone: ctx.farm.timezone, fieldName: field.name, observations, logs };
  // Only a real model request draws on the shared AI allowance; a field with no clear imagery does not.
  if (observations.length >= 2) await reserveTranscription(ctx, "The farm's AI limit has been reached. Try again in a minute.");
  return analyseField(context, apiKey, signal);
}

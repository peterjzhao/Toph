import "server-only";
/**
 * Per-field index statistics.
 *
 * These numbers, not the pictures, are what the analysis reads and what the interface charts, so
 * an observation only survives when enough of the field was actually visible. A cloud sitting over
 * a field reads as a collapse in vegetation, and that is exactly the input that would produce a
 * confident, wrong claim about work logged that week.
 */
import type { FieldPoint } from "@/contracts/accounts";
import { CDSE_STATISTICS_URL, SENTINEL2_COLLECTION, cdseRequest } from "./client";
import { NDVI_STATISTICS_EVALSCRIPT } from "./evalscripts";
import { fieldGeometry, polygonAreaMercator, type FarmExtent } from "./extent";
import type { DateRange } from "./catalog";

/** Share of the field that must be cloud-free before an observation counts. */
export const MIN_VALID_FRACTION = 0.6;
/** Sentinel-2's native optical resolution, in the EPSG:3857 metres the request is measured in. */
export const STATISTICS_RESOLUTION_METRES = 10;

export type FieldObservation = {
  date: string;
  mean: number; min: number; max: number; stDev: number;
  /** How much of the field was cloud-free, 0–1. Shown to the farmer alongside the value. */
  validFraction: number;
};

type IntervalStats = { min?: unknown; max?: unknown; mean?: unknown; stDev?: unknown; sampleCount?: unknown; noDataCount?: unknown };
type StatisticsInterval = {
  interval?: { from?: unknown };
  error?: unknown;
  outputs?: { ndvi?: { bands?: { B0?: { stats?: IntervalStats } } } };
};

const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * Parses the provider's intervals and drops everything too clouded to trust.
 *
 * `areaMeters` is the field's own EPSG:3857 area, which gives the pixel count a clear day would
 * produce. Comparing against it — rather than against the request's bounding box — means a long
 * thin field is not judged as though it were the square around it.
 */
export function readStatistics(data: readonly unknown[], areaMeters: number): FieldObservation[] {
  const expectedPixels = areaMeters / STATISTICS_RESOLUTION_METRES ** 2;
  if (!(expectedPixels > 0)) return [];
  const observations: FieldObservation[] = [];
  for (const entry of data) {
    const item = entry as StatisticsInterval;
    if (item?.error) continue;
    const from = item?.interval?.from;
    if (typeof from !== "string" || from.length < 10) continue;
    const stats = item?.outputs?.ndvi?.bands?.B0?.stats;
    if (!stats) continue;
    // A fully masked field comes back with the STRING "NaN" in every statistic, so asNumber
    // rejects it here; the valid-fraction guard below would drop it too.
    const mean = asNumber(stats.mean), min = asNumber(stats.min), max = asNumber(stats.max);
    const sampleCount = asNumber(stats.sampleCount), noDataCount = asNumber(stats.noDataCount);
    if (mean === null || min === null || max === null || sampleCount === null || noDataCount === null) continue;
    // Resampling can return marginally more valid pixels than the ideal count, so cap at a whole field.
    const validFraction = Math.min(1, Math.max(0, (sampleCount - noDataCount) / expectedPixels));
    if (validFraction < MIN_VALID_FRACTION) continue;
    observations.push({ date: from.slice(0, 10), mean, min, max, stDev: asNumber(stats.stDev) ?? 0, validFraction });
  }
  return observations.sort((left, right) => left.date.localeCompare(right.date));
}

export async function fetchFieldStatistics(
  boundary: readonly FieldPoint[],
  extent: FarmExtent,
  range: DateRange,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<FieldObservation[]> {
  const { type, coordinates, crs } = fieldGeometry(boundary, extent);
  const response = await cdseRequest(CDSE_STATISTICS_URL, token, {
    input: {
      bounds: { geometry: { type, coordinates }, properties: { crs: crs.properties.name } },
      data: [{ type: SENTINEL2_COLLECTION, dataFilter: { mosaickingOrder: "leastCC" } }],
    },
    aggregation: {
      timeRange: { from: `${range.from}T00:00:00Z`, to: `${range.to}T23:59:59Z` },
      aggregationInterval: { of: "P1D" },
      resx: STATISTICS_RESOLUTION_METRES,
      resy: STATISTICS_RESOLUTION_METRES,
      evalscript: NDVI_STATISTICS_EVALSCRIPT,
    },
    calculations: { ndvi: { statistics: { default: {} } } },
  }, fetcher);
  const body = await response.json().catch(() => null) as { data?: unknown[] } | null;
  return readStatistics(body?.data ?? [], polygonAreaMercator(boundary, extent));
}

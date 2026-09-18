import "server-only";
/**
 * Which Sentinel-2 passes actually exist over a farm.
 *
 * The scrubber is built from this rather than from a calendar, so every stop it offers has real
 * imagery behind it. Searching is metadata only: nothing is rendered here.
 */
import { CDSE_CATALOG_URL, SENTINEL2_COLLECTION, cdseRequest } from "./client";
import { bboxToLngLat, type FarmExtent } from "./extent";

/** Percent cloud over the whole scene. Above this a frame shows weather, not farmland. */
export const MAX_CLOUD_COVER = 40;
const PAGE_SIZE = 100;
/** A guard against a catalogue that keeps offering another page, not an expected limit. */
const MAX_PAGES = 20;

export type Acquisition = { date: string; cloudCover: number };
export type TimelineMonth = { month: string; date: string; cloudCover: number; acquisitions: number };
export type DateRange = { from: string; to: string };

type CatalogFeature = { properties?: { datetime?: unknown; "eo:cloud_cover"?: unknown } };

/** The catalogue answers `Accept: application/json` with 406; it serves GeoJSON. */
const CATALOG_ACCEPT = "application/geo+json";

/**
 * Every pass over the farm in the range, one entry per date, oldest first. A farm straddling two
 * tiles yields two features for the same day; the clearer one wins.
 */
export async function searchAcquisitions(extent: FarmExtent, range: DateRange, token: string, fetcher: typeof fetch = fetch): Promise<Acquisition[]> {
  const clearest = new Map<string, number>();
  // Sent back verbatim: the catalogue reports this as a string ("5"), not a number.
  let next: string | number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await cdseRequest(CDSE_CATALOG_URL, token, {
      collections: [SENTINEL2_COLLECTION],
      bbox: bboxToLngLat(extent),
      datetime: `${range.from}T00:00:00Z/${range.to}T23:59:59Z`,
      limit: PAGE_SIZE,
      // Only the two properties the timeline needs, so the archive sweep stays small.
      fields: { include: ["properties.datetime", "properties.eo:cloud_cover"] },
      ...(next === undefined ? {} : { next }),
    }, fetcher, CATALOG_ACCEPT);
    const body = await response.json().catch(() => null) as { features?: CatalogFeature[]; context?: { next?: unknown } } | null;
    for (const feature of body?.features ?? []) {
      const datetime = feature.properties?.datetime;
      if (typeof datetime !== "string" || datetime.length < 10) continue;
      const date = datetime.slice(0, 10);
      const reported = feature.properties?.["eo:cloud_cover"];
      // An unreported cloud figure is treated as fully clouded: never assume a clear sky.
      const cloudCover = typeof reported === "number" && Number.isFinite(reported) ? reported : 100;
      const existing = clearest.get(date);
      if (existing === undefined || cloudCover < existing) clearest.set(date, cloudCover);
    }
    const following = body?.context?.next;
    if (typeof following !== "number" && typeof following !== "string") break;
    if (following === "" || following === next) break;
    next = following;
  }
  return [...clearest.entries()]
    .map(([date, cloudCover]) => ({ date, cloudCover }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

/** One scrubber stop per month, represented by that month's clearest usable pass. */
export function monthlySpine(acquisitions: readonly Acquisition[]): TimelineMonth[] {
  const months = new Map<string, TimelineMonth>();
  for (const acquisition of acquisitions) {
    if (acquisition.cloudCover > MAX_CLOUD_COVER) continue;
    const month = acquisition.date.slice(0, 7);
    const existing = months.get(month);
    if (!existing) {
      months.set(month, { month, date: acquisition.date, cloudCover: acquisition.cloudCover, acquisitions: 1 });
      continue;
    }
    existing.acquisitions += 1;
    if (acquisition.cloudCover < existing.cloudCover) {
      existing.date = acquisition.date;
      existing.cloudCover = acquisition.cloudCover;
    }
  }
  return [...months.values()].sort((left, right) => left.month.localeCompare(right.month));
}

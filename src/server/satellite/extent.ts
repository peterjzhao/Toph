import "server-only";
/**
 * Geographic extent of a farm's aerial raster, and the arithmetic that turns saved field
 * boundaries into real-world geometry.
 *
 * Field boundaries are stored normalized to the raster ([0,1], origin top-left) because an
 * uploaded image has no trusted geographic meaning on its own. Once a raster carries an extent,
 * those same polygons describe real ground, so no re-segmentation is ever needed.
 */
import type { FieldPoint } from "@/contracts/accounts";
import { validationError } from "@/server/errors";

/** Matches `parseImageryBbox` so the database, the capture API and this module cannot disagree. */
export const WEB_MERCATOR_LIMIT = 20_037_508.34;
export const MIN_SPAN_METERS = 100;
export const MAX_SPAN_METERS = 40_000;
/** Sentinel-2's finest optical bands. Requesting more pixels than this invents detail and costs more. */
export const SENTINEL2_METRES_PER_PIXEL = 10;
const MIN_FRAME_PIXELS = 16;

export const EXTENT_SOURCES = ["capture", "located", "placeholder"] as const;
export type ExtentSource = (typeof EXTENT_SOURCES)[number];

export type FarmExtent = {
  /** EPSG:3857 metres. */
  minX: number; minY: number; maxX: number; maxY: number;
  source: ExtentSource;
};

export const EPSG_3857_URN = "http://www.opengis.net/def/crs/EPSG/0/3857";

export type FieldGeometry = {
  type: "Polygon";
  coordinates: [number, number][][];
  crs: { type: "name"; properties: { name: string } };
};

const invalid = () => validationError("This farm's map extent isn't usable. Set the farm's location again.");

/** Validates an extent from the database or from a setup request. Never trusts either blindly. */
export function parseFarmExtent(value: unknown): FarmExtent {
  if (!value || typeof value !== "object") throw invalid();
  const { minX, minY, maxX, maxY, source } = value as Record<string, unknown>;
  const numbers = [minX, minY, maxX, maxY];
  if (numbers.some(part => typeof part !== "number" || !Number.isFinite(part) || Math.abs(part) > WEB_MERCATOR_LIMIT)) throw invalid();
  if (typeof source !== "string" || !EXTENT_SOURCES.includes(source as ExtentSource)) throw invalid();
  const [west, south, east, north] = numbers as number[];
  const spanX = east - west, spanY = north - south;
  if (spanX < MIN_SPAN_METERS || spanY < MIN_SPAN_METERS) throw invalid();
  if (spanX > MAX_SPAN_METERS || spanY > MAX_SPAN_METERS) throw invalid();
  return { minX: west, minY: south, maxX: east, maxY: north, source: source as ExtentSource };
}

/** Null when a farm has no georeference yet; the map page then behaves exactly as before. */
export function readFarmExtent(value: unknown): FarmExtent | null {
  try {
    return parseFarmExtent(value);
  } catch {
    return null;
  }
}

function assertBoundary(boundary: readonly FieldPoint[]) {
  if (!Array.isArray(boundary) || boundary.length < 3) throw validationError("This field's boundary isn't a polygon.");
  if (boundary.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
    throw validationError("This field's boundary isn't a polygon.");
  }
}

/** Normalized raster point → EPSG:3857. The y-axis flips: image y = 0 is the extent's north edge. */
export function toMercator(point: FieldPoint, extent: FarmExtent): [number, number] {
  return [
    extent.minX + point.x * (extent.maxX - extent.minX),
    extent.maxY - point.y * (extent.maxY - extent.minY),
  ];
}

/** A closed EPSG:3857 ring, so Sentinel Hub needs no reprojection from us. */
export function fieldGeometry(boundary: readonly FieldPoint[], extent: FarmExtent): FieldGeometry {
  assertBoundary(boundary);
  const ring = boundary.map(point => toMercator(point, extent));
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return { type: "Polygon", coordinates: [ring], crs: { type: "name", properties: { name: EPSG_3857_URN } } };
}

/** Tight bbox around one field, so a single field can be framed without the whole farm. */
export function boundaryBbox(boundary: readonly FieldPoint[], extent: FarmExtent): [number, number, number, number] {
  assertBoundary(boundary);
  const points = boundary.map(point => toMercator(point, extent));
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export const extentBbox = (extent: FarmExtent): [number, number, number, number] => [extent.minX, extent.minY, extent.maxX, extent.maxY];

/**
 * Field area in EPSG:3857 square metres — the same distorted units a statistics request is
 * measured in, so dividing by the pixel size gives the field's true pixel count and Mercator's
 * latitude stretch cancels out instead of biasing the cloud guard.
 */
export function polygonAreaMercator(boundary: readonly FieldPoint[], extent: FarmExtent): number {
  assertBoundary(boundary);
  const ring = boundary.map(point => toMercator(point, extent));
  let total = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x1, y1] = ring[index], [x2, y2] = ring[(index + 1) % ring.length];
    total += x1 * y2 - x2 * y1;
  }
  return Math.abs(total) / 2;
}

const EARTH_RADIUS_METERS = 6_378_137;

/**
 * EPSG:3857 → WGS84. The Statistical API takes our metres directly, but a STAC catalogue search
 * is specified in longitude/latitude, so the spine query converts first.
 */
export function bboxToLngLat(bounds: FarmExtent | [number, number, number, number]): [number, number, number, number] {
  const [west, south, east, north] = Array.isArray(bounds) ? bounds : extentBbox(bounds);
  const lng = (x: number) => (x / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const lat = (y: number) => (2 * Math.atan(Math.exp(y / EARTH_RADIUS_METERS)) - Math.PI / 2) * (180 / Math.PI);
  return [lng(west), lat(south), lng(east), lat(north)];
}

/**
 * Output size for a rendered frame. Sentinel-2 resolves 10 m, so a 2 km farm is 200 px: asking
 * for a 1024 px frame would upsample and spend processing units for no extra information.
 */
export function frameSize(bounds: FarmExtent | [number, number, number, number], maxPixels: number): { width: number; height: number } {
  const [west, south, east, north] = Array.isArray(bounds) ? bounds : extentBbox(bounds);
  const spanX = east - west, spanY = north - south;
  const scale = Math.min(1 / SENTINEL2_METRES_PER_PIXEL, maxPixels / Math.max(spanX, spanY));
  return {
    width: Math.min(maxPixels, Math.max(MIN_FRAME_PIXELS, Math.round(spanX * scale))),
    height: Math.min(maxPixels, Math.max(MIN_FRAME_PIXELS, Math.round(spanY * scale))),
  };
}

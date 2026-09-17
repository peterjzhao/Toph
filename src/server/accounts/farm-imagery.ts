import "server-only";
import { ApiError, validationError } from "@/server/errors";
import { imageDimensions } from "./farm-setup";

// USGS NAIP aerial imagery is public domain, so the exported view may be stored as the farm image.
const NAIP_EXPORT = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage";
const CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const WEB_MERCATOR_LIMIT = 20_037_508.34;
const MIN_SPAN_METERS = 100;
const MAX_SPAN_METERS = 40_000;
const LONG_SIDE_PIXELS = 1600;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type FarmImageryRequest = { bbox: [number, number, number, number]; width: number; height: number };

/** Parses `bbox=minX,minY,maxX,maxY` in Web Mercator meters and sizes the export to its aspect ratio. */
export function parseImageryBbox(value: string | null): FarmImageryRequest {
  const parts = (value ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part) || Math.abs(part) > WEB_MERCATOR_LIMIT)) throw validationError("Choose a map view to capture.");
  const [minX, minY, maxX, maxY] = parts;
  const spanX = maxX - minX, spanY = maxY - minY;
  if (spanX < MIN_SPAN_METERS || spanY < MIN_SPAN_METERS) throw validationError("Zoom out a little so your fields are in view.");
  if (spanX > MAX_SPAN_METERS || spanY > MAX_SPAN_METERS) throw validationError("Zoom in closer to your farm before capturing.");
  const scale = LONG_SIDE_PIXELS / Math.max(spanX, spanY);
  const width = Math.round(spanX * scale), height = Math.round(spanY * scale);
  if (width < 200 || height < 200) throw validationError("Choose a less narrow map view.");
  return { bbox: [minX, minY, maxX, maxY], width, height };
}

async function upstream(url: string): Promise<Response> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25_000), cache: "no-store" });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return response;
  } catch {
    throw new ApiError(502, "INTERNAL_ERROR", "The satellite imagery service didn’t respond. Please try again.");
  }
}

export async function fetchFarmImagery(request: FarmImageryRequest): Promise<{ dataUrl: string; width: number; height: number }> {
  for (const quality of [85, 65]) {
    const query = new URLSearchParams({ bbox: request.bbox.join(","), bboxSR: "3857", imageSR: "3857", size: `${request.width},${request.height}`, format: "jpg", compressionQuality: String(quality), f: "image" });
    const response = await upstream(`${NAIP_EXPORT}?${query}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const dimensions = imageDimensions(bytes, "image/jpeg");
    // ArcGIS reports export failures as a JSON body, so trust the decoded header rather than the status.
    if (!dimensions) throw new ApiError(502, "INTERNAL_ERROR", "Satellite imagery isn’t available for this view. Imagery covers the United States.");
    if (bytes.length <= MAX_IMAGE_BYTES) return { dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`, ...dimensions };
  }
  throw validationError("This view is too detailed to save. Zoom in a little and try again.");
}

export type GeocodeResult = { lat: number; lng: number; label: string };

/** Accepts "lat, lng" directly; anything else goes to the keyless US Census geocoder. */
export async function geocodeFarmLocation(input: string | null): Promise<GeocodeResult> {
  const query = (input ?? "").trim();
  if (query.length < 3 || query.length > 200) throw validationError("Enter an address or coordinates.");
  const pair = /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/.exec(query);
  if (pair) {
    const lat = Number(pair[1]), lng = Number(pair[2]);
    if (Math.abs(lat) > 85 || Math.abs(lng) > 180) throw validationError("Those coordinates are out of range. Use latitude, longitude.");
    return { lat, lng, label: `${lat}, ${lng}` };
  }
  const response = await upstream(`${CENSUS_GEOCODER}?${new URLSearchParams({ address: query, benchmark: "Public_AR_Current", format: "json" })}`);
  const body = await response.json().catch(() => null) as { result?: { addressMatches?: { matchedAddress?: string; coordinates?: { x?: number; y?: number } }[] } } | null;
  const match = body?.result?.addressMatches?.[0];
  if (typeof match?.coordinates?.x !== "number" || typeof match.coordinates.y !== "number") throw new ApiError(404, "NOT_FOUND", "We couldn’t find that address. Try a full street address with city and state, or paste coordinates.");
  return { lat: match.coordinates.y, lng: match.coordinates.x, label: match.matchedAddress ?? query };
}

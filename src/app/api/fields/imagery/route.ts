import { isLayer } from "@/contracts/satellite";
import { resolveAccountContext } from "@/server/accounts/service";
import { validationError } from "@/server/errors";
import { handleRoute } from "@/server/http/responses";
import { ARCHIVE_START, fieldFrame } from "@/server/satellite/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/fields/imagery?date=YYYY-MM-DD&layer=true-colour|infrared|ndvi
 *
 * Sentinel-2 for a fixed extent and date never changes, so a frame is immutable and the browser
 * keeps it for the whole scrubbing session. The cache is `private`: the URL is farm-scoped and
 * session-authenticated, so a shared CDN copy would hand one farm's imagery to another.
 */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await resolveAccountContext(request, "admin");
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? "";
    const layer = params.get("layer") ?? "true-colour";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < ARCHIVE_START) throw validationError("Choose a date covered by the satellite archive.");
    if (!isLayer(layer)) throw validationError("Choose an available map layer.");
    const frame = await fieldFrame(ctx, date, layer);
    return new Response(new Uint8Array(frame.bytes), {
      headers: { "Content-Type": frame.contentType, "Cache-Control": "private, max-age=31536000, immutable" },
    });
  });
}

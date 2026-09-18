import { resolveAccountContext } from "@/server/accounts/service";
import { parseImageryBbox } from "@/server/accounts/farm-imagery";
import { readRuntimeConfig } from "@/server/farm-context";
import { readJsonBody } from "@/server/http/body";
import { assertWriteOrigin } from "@/server/http/origin";
import { satelliteRoute } from "@/server/satellite/http";
import { saveFarmLocation } from "@/server/satellite/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/farm/location with `{ "bbox": "minX,minY,maxX,maxY" }` in Web Mercator metres.
 *
 * Places a farm's existing aerial on the earth, for rasters that were uploaded or seeded rather
 * than captured from the map picker. Re-validated here with the same parser the capture path uses,
 * so a client cannot widen the accepted bounds.
 */
export async function POST(request: Request): Promise<Response> {
  return satelliteRoute(async () => {
    assertWriteOrigin(request, readRuntimeConfig().appOrigin);
    const ctx = await resolveAccountContext(request, "admin");
    const body = await readJsonBody(request) as { bbox?: unknown };
    const { bbox } = parseImageryBbox(typeof body?.bbox === "string" ? body.bbox : null);
    return Response.json({ data: await saveFarmLocation(ctx, bbox) }, { headers: { "Cache-Control": "no-store" } });
  });
}
